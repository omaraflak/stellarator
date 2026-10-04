/**
 * Judging a design from its stage-2 metrics (physics/stage2.js):
 *
 *   valid      every engineering limit met (within the level's tolerance: 0.5 % on the
 *              tutorial and practice levels, 0.1 % on the record levels as in the paper)
 *   stars      how many of the level's field-error thresholds the design reaches
 *   candidate  (record levels) beats the published record on the scoring grid: field error
 *              at least RECORD_MARGIN lower, and no worse on the paper's own objective
 *              (local squared flux) or on the worst point of the surface
 *   score      1000·log10(1 / field error): each decade of error removed is worth 1000
 *
 * A candidate becomes a new record (✦) only after two more checks, run by the game:
 * passesFineCheck() on a much finer surface grid with finer coil quadrature, and field-line
 * tracing with every traced line staying inside the plasma.
 *
 * Pure functions (no DOM), so designs can also be judged offline in Node.
 */
import { LIMIT_TOLERANCE } from './levels.js';

/** A record counts as beaten only by at least this relative margin on the field error. */
export const RECORD_MARGIN = 0.01;

/** Broken limits, each naming the base coil(s) involved. `baseOf(c)` maps a coil to its base curve. */
export function violations(level, m, baseOf) {
  const L = level.limits, tol = L.tol ?? LIMIT_TOLERANCE, out = [];
  if (m.ccMin < L.ccMin * (1 - tol)) out.push({ kind: 'cc', coils: [baseOf(m.ccPair[0]), baseOf(m.ccPair[1])], value: m.ccMin, limit: L.ccMin });
  if (L.csMin && m.csMin < L.csMin * (1 - tol)) out.push({ kind: 'cs', coils: [baseOf(m.csCoil)], value: m.csMin, limit: L.csMin });
  m.kappaMax.forEach((k, b) => { if (k > L.kappaMax * (1 + tol)) out.push({ kind: 'kappa', coils: [b], value: k, limit: L.kappaMax }); });
  if (L.mscMax != null) m.msc.forEach((v, b) => { if (v > L.mscMax * (1 + tol)) out.push({ kind: 'msc', coils: [b], value: v, limit: L.mscMax }); });
  if (L.lengthMax != null) m.lengths.forEach((v, b) => { if (v > L.lengthMax * (1 + tol)) out.push({ kind: 'length', coils: [b], value: v, limit: L.lengthMax }); });
  if (L.totalLengthMax != null && m.totalLength > L.totalLengthMax * (1 + tol)) out.push({ kind: 'budget', coils: [], value: m.totalLength, limit: L.totalLengthMax });
  for (const p of m.portsBlocked ?? []) out.push({ kind: 'port', port: p, coils: [] });
  return out;
}

export function judge(level, m, baseOf) {
  const broken = violations(level, m, baseOf);
  const valid = broken.length === 0;
  let stars = 0;
  if (valid && level.stars) for (const t of level.stars) if (m.fieldError <= t) stars++;
  const rec = level.record;
  const candidate = !!(valid && rec && m.fieldError <= (1 - RECORD_MARGIN) * rec.fieldError
    && m.JfLocal <= rec.JfLocal && m.maxRatio <= rec.maxRatio);
  return {
    valid,
    broken,
    stars,
    candidate,
    beat: false, // set by the game once a candidate passes every check
    score: valid ? Math.round(1000 * Math.log10(1 / Math.max(m.fieldError, 1e-9))) : 0,
  };
}

/** The fine check: `fine` = { fieldError, maxRatio } on the verification grid, against the record's. */
export function passesFineCheck(level, fine) {
  const rec = level.record.fine;
  return fine.fieldError <= (1 - RECORD_MARGIN) * rec.fieldError && fine.maxRatio <= rec.maxRatio;
}

/** "0.0441 %" style formatting of a field error. */
export function pct(err) {
  const p = 100 * err;
  if (p >= 10) return `${p.toFixed(1)} %`;
  if (p >= 1) return `${p.toFixed(2)} %`;
  if (p >= 0.1) return `${p.toFixed(3)} %`;
  if (p >= 0.01) return `${p.toFixed(4)} %`;
  return `${p.toFixed(5)} %`;
}
