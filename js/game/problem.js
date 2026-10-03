/**
 * Turns a level definition into the objects the physics needs: the target surface, its
 * scoring quadrature grid, the coil-set spec, the stage-2 problem (limits, weights,
 * ports) and the starting design. Shared by the game, the workers and Node scripts.
 */
import { makeSurface, quadGrid } from '../physics/rzsurface.js';
import { equallySpacedCurves } from '../physics/coilset.js';

export function buildProblem(level) {
  const surface = makeSurface(level.surface);
  const { range, nphi, ntheta } = level.scoring;
  const grid = quadGrid(surface, range, nphi, ntheta);
  const c = level.coils;
  const spec = { nbase: c.nbase, order: c.order, nfp: c.nfp, stellsym: c.stellsym };
  const L = level.limits;
  const problem = {
    grid,
    ccMin: L.ccMin, csMin: L.csMin, kappaMax: L.kappaMax, mscMax: L.mscMax ?? 1e9, lengthMax: L.lengthMax ?? Infinity,
    weights: { port: 0, ...level.weights },
    ports: level.ports ?? [],
  };
  return { surface, grid, spec, problem };
}

/** SIMSOPT's starting point: equally spaced circular coils at the level's current. */
export function initialDesign(level) {
  const c = level.coils;
  return {
    dofs: equallySpacedCurves(c.nbase, c.nfp, c.stellsym, c.R0, c.R1, c.order),
    currents: new Float64Array(c.nbase).fill(c.current),
  };
}

/** Optimiser variables: all curve DOFs, plus the base currents after the first when free. */
export function packDesign(level, dofs, currents) {
  const free = level.coils.freeCurrents ? currents.length - 1 : 0;
  const x = new Float64Array(dofs.length + free);
  x.set(dofs);
  for (let i = 0; i < free; i++) x[dofs.length + i] = currents[i + 1];
  return x;
}

export function unpackDesign(level, x, dofs, currents) {
  dofs.set(x.subarray(0, dofs.length));
  if (level.coils.freeCurrents) for (let i = 1; i < currents.length; i++) currents[i] = x[dofs.length + i - 1];
}

/** Gradient in optimiser variables from stage2.evaluate's gradient (dofs…, currents…). */
export function packGradient(level, grad, ndofs, nbase) {
  const free = level.coils.freeCurrents ? nbase - 1 : 0;
  const g = new Float64Array(ndofs + free);
  g.set(grad.subarray(0, ndofs));
  for (let i = 0; i < free; i++) g[ndofs + i] = grad[ndofs + i + 1];
  return g;
}
