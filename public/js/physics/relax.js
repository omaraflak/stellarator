/**
 * Relax: L-BFGS on a level's own objective, from the player's design, with exact gradients.
 *
 * Levels with `continuation` (the record levels) follow the schedule of Wechsung et al.'s
 * optimiser (PNAS 2022, driver.py): L-BFGS runs in rounds; after each round the small
 * linear length weight drops 100× (and the initial coil–coil push 10⁴×), and any limit
 * still broken by more than 0.1 % has its penalty weight tripled. That state carries over
 * from one press of Relax to the next, so repeated presses continue the same schedule.
 *
 * Shared by the Relax worker and by headless (Node) runs.
 */
import { buildProblem, packDesign, unpackDesign, packGradient } from '../game/problem.js';
import { CoilSet } from './coilset.js';
import { evaluate } from './stage2.js';
import { lbfgs } from './lbfgs.js';

/** L-BFGS iterations per continuation round. */
export const ROUND_ITERS = 500;
const LIMIT_SLACK = 1e-3;

/**
 * Runs up to `maxIter` iterations. `state` ({ weights, round }) continues an earlier run;
 * onProgress({ it, J, dofs, currents }) is called at most every `every` ms.
 * Returns { dofs, currents, it, reason, state }.
 */
export function relax(level, dofs, currents, { maxIter, state = null, onProgress = null, every = 250 }) {
  const { spec, problem } = buildProblem(level);
  const cs = new CoilSet(spec, dofs, currents);
  const st = state ? { weights: { ...state.weights }, round: state.round } : { weights: { ...problem.weights }, round: 0 };
  const f = (x) => {
    unpackDesign(level, x, cs.dofs, cs.currents);
    cs.update();
    problem.weights = st.weights;
    const r = evaluate(cs, problem, true);
    return { f: r.J, g: packGradient(level, r.grad, cs.dofs.length, cs.nbase) };
  };

  let x = packDesign(level, cs.dofs, cs.currents), done = 0, reason = 'max iterations', last = performance.now();
  const onIter = (it, xi, fx) => {
    if (!onProgress || performance.now() - last < every) return;
    last = performance.now();
    unpackDesign(level, xi, cs.dofs, cs.currents);
    onProgress({ it: done + it, J: fx, dofs: cs.dofs, currents: cs.currents });
  };

  if (!level.continuation) {
    const res = lbfgs(f, x, { m: 50, maxIter, onIter });
    x = res.x; done = res.iterations; reason = res.reason;
  } else {
    while (done < maxIter) {
      const res = lbfgs(f, x, { m: 50, maxIter: Math.min(ROUND_ITERS, maxIter - done), onIter });
      x = res.x; done += res.iterations; reason = res.reason;
      // End of a round: adjust the penalty weights from the limits as they now stand.
      unpackDesign(level, x, cs.dofs, cs.currents);
      cs.update();
      problem.weights = st.weights;
      const m = evaluate(cs, problem).metrics, L = level.limits, W = st.weights;
      if (st.round === 0) W.cc *= 1e-4;
      W.length *= 0.01;
      if (Math.max(...m.kappaMax) > L.kappaMax * (1 + LIMIT_SLACK)) W.curvature *= 3;
      if (Math.max(...m.msc) > L.mscMax * (1 + LIMIT_SLACK)) W.msc *= 3;
      if (m.ccMin < L.ccMin * (1 - LIMIT_SLACK)) W.cc *= 3;
      if (L.totalLengthMax != null && m.totalLength > L.totalLengthMax * (1 + LIMIT_SLACK)) W.lengthTotal *= 3;
      st.round++;
      if (res.iterations === 0) break;
    }
  }
  unpackDesign(level, x, cs.dofs, cs.currents);
  return { dofs: cs.dofs, currents: cs.currents, it: done, reason, state: st };
}
