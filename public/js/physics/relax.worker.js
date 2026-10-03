/**
 * Relax worker: runs the local optimiser (L-BFGS on the level's stage-2 objective, exact
 * gradients) from the player's current design and streams progress back.
 *   → { type: 'run', level, dofs, currents, maxIter }
 *   ← { type: 'progress', dofs, currents, it, J } (about 4 per second), then { type: 'done', … }
 * The optimiser loop is synchronous, so the main thread stops a run by terminating the worker.
 */
import { buildProblem, packDesign, unpackDesign, packGradient } from '../game/problem.js';
import { CoilSet } from './coilset.js';
import { evaluate } from './stage2.js';
import { lbfgs } from './lbfgs.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ping') { self.postMessage({ type: 'pong' }); return; }
  if (msg.type !== 'run') return;
  const { level } = msg;
  const { spec, problem } = buildProblem(level);
  const cs = new CoilSet(spec, msg.dofs, msg.currents);
  const f = (x) => {
    unpackDesign(level, x, cs.dofs, cs.currents);
    cs.update();
    const r = evaluate(cs, problem, true);
    return { f: r.J, g: packGradient(level, r.grad, cs.dofs.length, cs.nbase) };
  };
  let last = performance.now();
  const post = (type, extra) => {
    self.postMessage({ type, dofs: Float64Array.from(cs.dofs), currents: Float64Array.from(cs.currents), ...extra });
  };
  const res = lbfgs(f, packDesign(level, cs.dofs, cs.currents), {
    m: 50,
    maxIter: msg.maxIter,
    onIter: (it, x, fx) => {
      const now = performance.now();
      if (now - last > 250) {
        last = now;
        unpackDesign(level, x, cs.dofs, cs.currents);
        post('progress', { it, J: fx });
      }
    },
  });
  unpackDesign(level, res.x, cs.dofs, cs.currents);
  post('done', { it: res.iterations, J: res.f, reason: res.reason });
};
