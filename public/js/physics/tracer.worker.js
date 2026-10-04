/**
 * Tracer worker: field lines and a Poincaré section for the current design.
 *   → { type: 'trace', level, dofs, currents, lines, transits }
 *   ← { type: 'line', index, punctures, lostAt, pts3d } for each line, then { type: 'done' }
 * A newer design cancels a run by terminating the worker (the loop is synchronous).
 */
import { makeSurface, quadGrid, crossSection } from './rzsurface.js';
import { CoilSet } from './coilset.js';
import { coilSpec } from '../game/problem.js';
import { traceLine, startPoints, plasmaBounds } from './tracer.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'ping') { self.postMessage({ type: 'pong' }); return; }
  if (msg.type !== 'trace') return;
  const { level } = msg;
  const surface = makeSurface(level.surface);
  const c = level.coils;
  const cs = new CoilSet(coilSpec(level), msg.dofs, msg.currents);
  const { recs, count } = cs.sources();
  const boundary = crossSection(surface, 0, 256);
  const bounds = plasmaBounds(quadGrid(surface, 'full torus', 64, 32));
  // Sections at φ = k·2π/P are equivalent for a field with P-fold symmetry.
  const P = c.nfp, steps = Math.max(32, Math.round(192 / P));
  const { starts, axis } = startPoints(boundary, msg.lines, 0.97);
  self.postMessage({ type: 'start', boundary: { R: Array.from(boundary.R), Z: Array.from(boundary.Z) }, axis, perTransit: P });
  starts.forEach(([R, Z], index) => {
    const r = traceLine(recs, count, R, Z, { nfp: P, periods: msg.transits * P, steps, boundary, bounds, axis, keep3d: 2 * P * steps });
    self.postMessage({ type: 'line', index, punctures: r.punctures, lostAt: r.lostAt, pts3d: r.pts3d, iota: r.iota }, [r.punctures.buffer]);
  });
  self.postMessage({ type: 'done' });
};
