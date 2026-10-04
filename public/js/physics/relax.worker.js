/**
 * Relax worker: runs relax() (L-BFGS on the level's stage-2 objective, exact gradients)
 * from the player's current design and streams progress back.
 *   → { type: 'run', level, dofs, currents, maxIter, state }
 *   ← { type: 'progress', dofs, currents, it, J } (about 4 per second),
 *     then { type: 'done', dofs, currents, it, reason, state }
 * The optimiser loop is synchronous, so the main thread stops a run by terminating the worker.
 */
import { relax } from './relax.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ping') { self.postMessage({ type: 'pong' }); return; }
  if (msg.type !== 'run') return;
  const post = (type, r, extra) => {
    self.postMessage({ type, dofs: Float64Array.from(r.dofs), currents: Float64Array.from(r.currents), ...extra });
  };
  const res = relax(msg.level, msg.dofs, msg.currents, {
    maxIter: msg.maxIter,
    state: msg.state,
    onProgress: (p) => post('progress', p, { it: p.it, J: p.J }),
  });
  post('done', res, { it: res.it, reason: res.reason, state: res.state });
};
