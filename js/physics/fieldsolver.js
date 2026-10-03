/**
 * FieldSolver: answers "evaluate this design" for the game. Runs in a Web Worker
 * (worker.js), or on the main thread if workers are unavailable.
 *
 * For every request it returns
 *   bn       B·n̂/|B| on the full-torus display grid (the plasma heatmap)
 *   metrics  the exact stage-2 metrics on the level's scoring grid (stage2.evaluate)
 *   alerts   per coil quadrature point: 1 where an engineering limit is broken
 *
 * Interactive speed-up: during a drag only the coils generated from the moving base
 * curves change, so the display field of every other coil is cached once per drag
 * ("background") and only the moving coils are re-evaluated. This is exact.
 */
import { buildProblem } from '../game/problem.js';
import { CoilSet } from './coilset.js';
import { quadGrid } from './rzsurface.js';
import { evaluate, alertFlags } from './stage2.js';
import { fieldAt } from './biotsavart.js';

export class FieldSolver {
  /** level: plain level object; display: { nphi, ntheta }; tol: limit tolerance for alerts. */
  init(level, display, tol) {
    const { surface, spec, problem } = buildProblem(level);
    this.level = level;
    this.spec = spec;
    this.problem = problem;
    this.tol = tol;
    this.disp = quadGrid(surface, 'full torus', display.nphi, display.ntheta);
    const V = this.disp.count;
    this.B = new Float64Array(3 * V);
    this.Bbg = new Float64Array(3 * V);
    this.cs = null;
    this.dragId = null;
  }

  evaluate(req) {
    const t0 = performance.now();
    const { dofs, currents, moving, fast, dragId } = req;
    if (!this.cs) this.cs = new CoilSet(this.spec, dofs, currents);
    else { this.cs.dofs.set(dofs); this.cs.currents.set(currents); this.cs.update(); }
    const cs = this.cs, pts = this.disp.positions;
    let mode = 'exact';
    if (fast && moving?.length) {
      const set = new Set(moving);
      const movingCoils = [], others = [];
      cs.ops.forEach((op, c) => (set.has(op.base) ? movingCoils : others).push(c));
      if (dragId !== this.dragId) {
        const bg = cs.sources(null, others);
        if (bg.count) fieldAt(bg.recs, bg.count, pts, this.Bbg); else this.Bbg.fill(0);
        this.dragId = dragId;
      }
      const mv = cs.sources(null, movingCoils);
      this.B.set(this.Bbg);
      fieldAt(mv.recs, mv.count, pts, this.B, true);
      mode = 'incremental';
    } else {
      const all = cs.sources();
      fieldAt(all.recs, all.count, pts, this.B);
      this.dragId = null;
    }
    const V = this.disp.count, un = this.disp.unit, B = this.B;
    const bn = new Float32Array(V);
    for (let i = 0; i < V; i++) {
      const t = 3 * i;
      const m = Math.hypot(B[t], B[t + 1], B[t + 2]) || 1e-300;
      bn[i] = (B[t] * un[t] + B[t + 1] * un[t + 1] + B[t + 2] * un[t + 2]) / m;
    }
    const { metrics } = evaluate(cs, this.problem);
    const alerts = alertFlags(cs, this.problem, this.tol);
    return { id: req.id, fast: !!fast, mode, bn, metrics, alerts, ms: performance.now() - t0 };
  }
}
