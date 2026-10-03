/**
 * Main-thread side of the three workers:
 *
 *   PhysicsEngine  field worker (heatmap, exact metrics, alerts). Coalesces requests: at
 *                  most one in flight, newer requests replace queued ones, so dragging never
 *                  builds a backlog. Falls back to running FieldSolver on the main thread.
 *   Relaxer        local optimiser runs (stoppable at any time).
 *   Tracer         field lines and Poincaré section (restarted when the design changes).
 *
 * Workers start as module workers. Where a host refuses those, the same modules are
 * bundled into one classic script (each module wrapped in its own scope) and started
 * from a Blob URL.
 */
import { FieldSolver } from './fieldsolver.js';

const here = (p) => new URL(p, import.meta.url).href;

// Worker entry points and the modules they need, dependencies first (for bundling).
const FIELD = [here('./rzsurface.js'), here('./coilset.js'), here('../game/problem.js'), here('./biotsavart.js'), here('./stage2.js'), here('./fieldsolver.js'), here('./worker.js')];
const RELAX = [here('./rzsurface.js'), here('./coilset.js'), here('../game/problem.js'), here('./stage2.js'), here('./lbfgs.js'), here('./relax.worker.js')];
const TRACE = [here('./rzsurface.js'), here('./coilset.js'), here('./tracer.js'), here('./tracer.worker.js')];

const bundles = new Map();

/** Concatenates ES modules into one classic script with a tiny module registry. */
async function bundle(urls) {
  const key = urls.join('|');
  if (bundles.has(key)) return bundles.get(key);
  let code = 'const __reg = {};\n';
  for (const url of urls) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`could not load ${url}`);
    let src = await r.text();
    const header = [];
    src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_, names, from) => {
      header.push(`const {${names}} = __reg[${JSON.stringify(new URL(from, url).href)}];`);
      return '';
    });
    const exported = [];
    src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z0-9_$]+)/gm, (_, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    });
    code += `__reg[${JSON.stringify(url)}] = (() => {\n${header.join('\n')}\n${src}\nreturn { ${exported.join(', ')} };\n})();\n`;
  }
  const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  bundles.set(key, blobUrl);
  return blobUrl;
}

/** Resolves once the worker answers a ping; rejects on error or after a timeout. */
function probe(w) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { w.terminate(); reject(new Error('worker timeout')); }, 6000);
    w.onerror = (e) => { clearTimeout(timer); w.terminate(); reject(new Error(e.message || 'worker error')); };
    w.onmessage = (e) => { if (e.data.type === 'pong') { clearTimeout(timer); w.onerror = null; w.onmessage = null; resolve(w); } };
    w.postMessage({ type: 'ping' });
  });
}

const workerKind = new Map();

/** Starts a worker for `files` (last entry is the worker script). Returns { worker, kind }. */
export async function spawn(files) {
  const entry = files[files.length - 1];
  if (workerKind.get(entry) !== 'blob') {
    try {
      const worker = await probe(new Worker(entry, { type: 'module' }));
      workerKind.set(entry, 'module');
      return { worker, kind: 'worker' };
    } catch (err) {
      console.warn('[physics] module worker unavailable, bundling instead:', err.message ?? err);
    }
  }
  const worker = await probe(new Worker(await bundle(files)));
  workerKind.set(entry, 'blob');
  return { worker, kind: 'worker-blob' };
}

/* ------------------------------------------------------------------ field */
export class PhysicsEngine {
  constructor() {
    this.worker = null;
    this.local = null;
    this.inflight = false;
    this.queued = null;
    this.nextId = 1;
    this.minValidId = 0;
    this.backend = 'pending';
    this.onResult = () => {};
  }

  async init(level, display, tol) {
    if (!this.worker && this.backend !== 'main-thread') {
      try {
        const { worker, kind } = await spawn(FIELD);
        this.worker = worker;
        this.backend = kind;
      } catch (err) {
        console.warn('[physics] no field worker, computing on the main thread:', err.message ?? err);
        this.backend = 'main-thread';
      }
    }
    this.minValidId = this.nextId; // drop results computed for the previous level
    this.queued = null;
    this.inflight = false;
    if (this.worker) {
      await new Promise((resolve) => {
        this.worker.onmessage = (e) => {
          if (e.data.type === 'ready') { this.worker.onmessage = (ev) => this.handle(ev.data); resolve(); } else this.handle(e.data);
        };
        this.worker.postMessage({ type: 'init', level, display, tol });
      });
    } else {
      this.local = new FieldSolver();
      this.local.init(level, display, tol);
    }
  }

  evaluate(req) {
    const r = { ...req, type: 'eval', id: this.nextId++ };
    if (this.inflight) this.queued = r; else this.send(r);
    return r.id;
  }

  send(r) {
    this.inflight = true;
    if (this.worker) this.worker.postMessage(r);
    else {
      const solver = this.local;
      setTimeout(() => this.handle({ type: 'result', ...solver.evaluate(r) }), 0);
    }
  }

  handle(msg) {
    if (msg.type !== 'result') return;
    this.inflight = false;
    if (this.queued) { const q = this.queued; this.queued = null; this.send(q); }
    if (msg.id >= this.minValidId) this.onResult(msg);
  }
}

/* ------------------------------------------------------------------ relax */
export class Relaxer {
  constructor() { this.worker = null; this.running = false; }

  /** Runs the optimiser; onProgress/onDone receive { dofs, currents, it, J, reason }. */
  async start(level, dofs, currents, maxIter, onProgress, onDone) {
    this.stop();
    this.running = true;
    const { worker } = await spawn(RELAX);
    if (!this.running) { worker.terminate(); return; }
    this.worker = worker;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m);
      else if (m.type === 'done') { this.running = false; this.worker = null; worker.terminate(); onDone(m); }
    };
    worker.onerror = (e) => { this.running = false; this.worker = null; onDone({ error: e.message || 'optimiser failed' }); };
    worker.postMessage({ type: 'run', level, dofs, currents, maxIter });
  }

  stop() {
    this.running = false;
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }
}

/* ------------------------------------------------------------------ tracing */
export class Tracer {
  constructor() { this.worker = null; this.generation = 0; }

  /** Traces field lines for a design; handlers receive the worker's messages. Cancels any earlier run. */
  async trace(level, dofs, currents, opts, handlers) {
    this.cancel();
    const gen = ++this.generation;
    const { worker } = await spawn(TRACE);
    if (gen !== this.generation) { worker.terminate(); return; }
    this.worker = worker;
    worker.onmessage = (e) => {
      if (gen !== this.generation) return;
      const m = e.data;
      if (m.type === 'start') handlers.start?.(m);
      else if (m.type === 'line') handlers.line?.(m);
      else if (m.type === 'done') { this.worker = null; worker.terminate(); handlers.done?.(); }
    };
    worker.postMessage({ type: 'trace', level, dofs, currents, lines: opts.lines, transits: opts.transits });
  }

  cancel() {
    this.generation++;
    if (this.worker) { this.worker.terminate(); this.worker = null; }
  }
}
