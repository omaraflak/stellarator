/**
 * Field worker: display heatmap, exact stage-2 metrics and limit alerts, off the UI thread.
 *   → { type: 'init', level, display, tol }   ← { type: 'ready' }
 *   → { type: 'eval', ...request }            ← { type: 'result', ...result }
 *   → { type: 'verify', id, dofs, currents }  ← { type: 'verified', id, fieldError, maxRatio, ms }
 * The main thread keeps at most one request in flight, so no queue is needed here.
 */
import { FieldSolver } from './fieldsolver.js';

const solver = new FieldSolver();

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ping') self.postMessage({ type: 'pong' });
  else if (msg.type === 'init') { solver.init(msg.level, msg.display, msg.tol); self.postMessage({ type: 'ready' }); }
  else if (msg.type === 'verify') self.postMessage({ type: 'verified', ...solver.verify(msg) });
  else if (msg.type === 'eval') {
    const r = solver.evaluate(msg);
    self.postMessage({ type: 'result', ...r }, [r.bn.buffer, r.alerts.buffer]);
  }
};
