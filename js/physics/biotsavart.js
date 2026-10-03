/**
 * Biot–Savart kernel for drawing: the field of source records [x,y,z, wx,wy,wz]
 * (point γ_q and weight w = μ0/4π · I · γ'_q / nq, see CoilSet.sources) at many points.
 * Same quadrature as the objective in stage2.js, so the heatmap and the score agree.
 */

/** B (3·N) at `targets` (3·N); accumulate = true adds to B. */
export function fieldAt(recs, nrec, targets, B, accumulate = false) {
  const count = targets.length / 3, end = 6 * nrec;
  for (let i = 0; i < count; i++) {
    const t = 3 * i;
    const x = targets[t], y = targets[t + 1], z = targets[t + 2];
    let bx = 0, by = 0, bz = 0;
    for (let s = 0; s < end; s += 6) {
      const rx = x - recs[s], ry = y - recs[s + 1], rz = z - recs[s + 2];
      const r2 = rx * rx + ry * ry + rz * rz + 1e-12;
      const inv = 1 / (r2 * Math.sqrt(r2));
      const wx = recs[s + 3], wy = recs[s + 4], wz = recs[s + 5];
      bx += (wy * rz - wz * ry) * inv;
      by += (wz * rx - wx * rz) * inv;
      bz += (wx * ry - wy * rx) * inv;
    }
    if (accumulate) { B[t] += bx; B[t + 1] += by; B[t + 2] += bz; }
    else { B[t] = bx; B[t + 1] = by; B[t + 2] = bz; }
  }
}
