/**
 * Judging a design from its stage-2 metrics (physics/stage2.js):
 *
 *   valid      every engineering limit met (within LIMIT_TOLERANCE, because the
 *              published design itself sits exactly on the limits)
 *   stars      how many of the level's field-error thresholds the design reaches
 *   research   (research level only) field error below the research threshold with
 *              total coil length no longer than the published design's
 *   score      1000·log10(1 / field error): each decade of error removed is worth 1000
 *
 * Pure functions (no DOM), so designs can also be judged offline in Node.
 */
import { LIMIT_TOLERANCE } from './levels.js';

/** Broken limits, each naming the base coil(s) involved. `baseOf(c)` maps a coil to its base curve. */
export function violations(level, m, baseOf) {
  const L = level.limits, tol = LIMIT_TOLERANCE, out = [];
  if (m.ccMin < L.ccMin * (1 - tol)) out.push({ kind: 'cc', coils: [baseOf(m.ccPair[0]), baseOf(m.ccPair[1])], value: m.ccMin, limit: L.ccMin });
  if (m.csMin < L.csMin * (1 - tol)) out.push({ kind: 'cs', coils: [baseOf(m.csCoil)], value: m.csMin, limit: L.csMin });
  m.kappaMax.forEach((k, b) => { if (k > L.kappaMax * (1 + tol)) out.push({ kind: 'kappa', coils: [b], value: k, limit: L.kappaMax }); });
  if (L.mscMax != null) m.msc.forEach((v, b) => { if (v > L.mscMax * (1 + tol)) out.push({ kind: 'msc', coils: [b], value: v, limit: L.mscMax }); });
  if (L.lengthMax != null) m.lengths.forEach((v, b) => { if (v > L.lengthMax * (1 + tol)) out.push({ kind: 'length', coils: [b], value: v, limit: L.lengthMax }); });
  for (const p of m.portsBlocked ?? []) out.push({ kind: 'port', port: p, coils: [] });
  return out;
}

export function judge(level, m, baseOf) {
  const broken = violations(level, m, baseOf);
  const valid = broken.length === 0;
  let stars = 0;
  if (valid && level.stars) for (const t of level.stars) if (m.fieldError <= t) stars++;
  const research = !!(valid && level.research && m.fieldError <= level.research.fieldError && m.totalLength <= level.research.maxLength);
  return {
    valid,
    broken,
    stars,
    research,
    score: valid ? Math.round(1000 * Math.log10(1 / Math.max(m.fieldError, 1e-9))) : 0,
  };
}

/** "0.0441 %" style formatting of a field error. */
export function pct(err) {
  const p = 100 * err;
  if (p >= 10) return `${p.toFixed(1)} %`;
  if (p >= 1) return `${p.toFixed(2)} %`;
  if (p >= 0.1) return `${p.toFixed(3)} %`;
  return `${p.toFixed(4)} %`;
}
