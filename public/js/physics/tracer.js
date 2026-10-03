/**
 * Field-line tracing for Poincaré plots: the standard check that a coil set really
 * produces nested magnetic surfaces (not just a small B·n on the target).
 *
 * Field lines are integrated in cylindrical coordinates with φ as the time variable,
 *   dR/dφ = R·B_R / B_φ ,   dZ/dφ = R·B_Z / B_φ ,
 * using classical RK4 with a fixed step and the exact Biot–Savart field of the coils
 * (same quadrature as the objective). Because the coils are nfp-periodic, every plane
 * φ = k·2π/nfp is equivalent, so a puncture is recorded once per field period.
 */
/** B at one point from source records [x,y,z, wx,wy,wz] (w already includes μ0/4π·I/nq). */
function fieldAtPoint(recs, n, x, y, z, out) {
  let bx = 0, by = 0, bz = 0;
  const end = 6 * n;
  for (let s = 0; s < end; s += 6) {
    const rx = x - recs[s], ry = y - recs[s + 1], rz = z - recs[s + 2];
    const r2 = rx * rx + ry * ry + rz * rz;
    const inv = 1 / (r2 * Math.sqrt(r2));
    const wx = recs[s + 3], wy = recs[s + 4], wz = recs[s + 5];
    bx += (wy * rz - wz * ry) * inv;
    by += (wz * rx - wx * rz) * inv;
    bz += (wx * ry - wy * rx) * inv;
  }
  out[0] = bx; out[1] = by; out[2] = bz;
}

/** Point-in-polygon (even-odd) for a closed (R, Z) polygon. */
function inside(poly, R, Z) {
  let c = false;
  const n = poly.R.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ri = poly.R[i], zi = poly.Z[i], rj = poly.R[j], zj = poly.Z[j];
    if ((zi > Z) !== (zj > Z) && R < ((rj - ri) * (Z - zi)) / (zj - zi) + ri) c = !c;
  }
  return c;
}

/**
 * Traces one field line from (R0, Z0) at φ = 0.
 * opts: { nfp, periods (field periods to follow), steps (per field period),
 *         boundary: {R, Z} cross-section at φ = 0 (for loss detection),
 *         keep3d: number of steps whose 3D points are kept for drawing }
 * Returns { punctures: [R, Z, …], lostAt (period index or −1), pts3d: Float32Array }.
 */
export function traceLine(recs, n, R0, Z0, opts) {
  const { nfp, periods, steps, boundary, bounds, axis, keep3d = 0, margin = 0.05 } = opts;
  const h = (2 * Math.PI) / nfp / steps;
  const B = [0, 0, 0];
  const deriv = (phi, R, Z, out) => {
    const c = Math.cos(phi), s = Math.sin(phi);
    fieldAtPoint(recs, n, R * c, R * s, Z, B);
    const BR = B[0] * c + B[1] * s, Bphi = -B[0] * s + B[1] * c;
    out[0] = (R * BR) / Bphi;
    out[1] = (R * B[2]) / Bphi;
  };
  const k1 = [0, 0], k2 = [0, 0], k3 = [0, 0], k4 = [0, 0];
  let R = R0, Z = Z0, phi = 0;
  const punctures = [R0, Z0];
  // Rotational transform: poloidal angle (about the axis guess) gained per toroidal transit.
  let theta = Math.atan2(Z0 - axis[1], R0 - axis[0]), turned = 0;
  const pts3d = new Float32Array(3 * keep3d);
  let kept = 0, lostAt = -1;
  // Loss: leaving a box around the whole plasma (`bounds`, all φ), or ending a field
  // period outside the φ = 0 boundary by more than `margin` of its size.
  const { rmin, rmax, zmax } = bounds;
  let br0 = Infinity, br1 = -Infinity;
  for (let i = 0; i < boundary.R.length; i++) { br0 = Math.min(br0, boundary.R[i]); br1 = Math.max(br1, boundary.R[i]); }
  const span = br1 - br0;
  for (let p = 0; p < periods && lostAt < 0; p++) {
    for (let k = 0; k < steps; k++) {
      if (kept < keep3d) { pts3d[3 * kept] = R * Math.cos(phi); pts3d[3 * kept + 1] = R * Math.sin(phi); pts3d[3 * kept + 2] = Z; kept++; }
      deriv(phi, R, Z, k1);
      deriv(phi + h / 2, R + (h / 2) * k1[0], Z + (h / 2) * k1[1], k2);
      deriv(phi + h / 2, R + (h / 2) * k2[0], Z + (h / 2) * k2[1], k3);
      deriv(phi + h, R + h * k3[0], Z + h * k3[1], k4);
      R += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      Z += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      phi += h;
      if (!Number.isFinite(R) || !Number.isFinite(Z) || R < rmin - span || R > rmax + span || Math.abs(Z) > zmax + span) { lostAt = p; break; }
    }
    if (lostAt >= 0) break;
    punctures.push(R, Z);
    const th = Math.atan2(Z - axis[1], R - axis[0]);
    let d = th - theta;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    turned += d; theta = th;
    // Outside the target boundary by more than `margin` of its size counts as lost.
    if (!inside(boundary, R, Z)) {
      const dmin = minDist(boundary, R, Z);
      if (dmin > margin * span) lostAt = p;
    }
  }
  const transits = (punctures.length / 2 - 1) / nfp;
  return { punctures: Float32Array.from(punctures), lostAt, pts3d: pts3d.subarray(0, 3 * kept), iota: transits > 0 ? turned / (2 * Math.PI * transits) : 0 };
}

function minDist(poly, R, Z) {
  let m = Infinity;
  for (let i = 0; i < poly.R.length; i++) m = Math.min(m, Math.hypot(poly.R[i] - R, poly.Z[i] - Z));
  return m;
}

/** Extent of the plasma over all φ, from a full-torus quadGrid. */
export function plasmaBounds(grid) {
  let rmin = Infinity, rmax = -Infinity, zmax = 0;
  for (let k = 0; k < grid.count; k++) {
    const R = Math.hypot(grid.positions[3 * k], grid.positions[3 * k + 1]);
    rmin = Math.min(rmin, R); rmax = Math.max(rmax, R); zmax = Math.max(zmax, Math.abs(grid.positions[3 * k + 2]));
  }
  return { rmin, rmax, zmax };
}

/**
 * Start points on the φ = 0 plane: from near the magnetic axis (approximated by the
 * boundary centroid) out to the boundary point at θ = 0.
 */
export function startPoints(boundary, count, outer = 0.98) {
  let cR = 0, cZ = 0;
  for (let i = 0; i < boundary.R.length; i++) { cR += boundary.R[i]; cZ += boundary.Z[i]; }
  cR /= boundary.R.length; cZ /= boundary.Z.length;
  const eR = boundary.R[0], eZ = boundary.Z[0];
  const out = [];
  for (let i = 1; i <= count; i++) {
    const s = (outer * i) / count;
    out.push([cR + s * (eR - cR), cZ + s * (eZ - cZ)]);
  }
  return { starts: out, axis: [cR, cZ] };
}

