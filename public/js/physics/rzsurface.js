/**
 * Target plasma boundary as a SIMSOPT/VMEC `SurfaceRZFourier`:
 *
 *   R(φ,θ) = Σ_{m=0..mpol} Σ_{n=−ntor..ntor} rc[m][n] cos(mθ − nfp·n·φ)
 *   Z(φ,θ) = Σ                              zs[m][n] sin(mθ − nfp·n·φ)
 *   x = R cos φ,  y = R sin φ,   φ = 2π·phi,  θ = 2π·theta
 *
 * phi, theta are SIMSOPT "quadpoints" in [0, 1). Derivatives are taken with respect to
 * those quadpoints (so they include the 2π factors), and the normal is
 * n = ∂γ/∂phi × ∂γ/∂theta, exactly as `Surface.normal()` in SIMSOPT. With this
 * normalisation, mean(f·|n|) over a quadrature grid is SIMSOPT's surface integral.
 */

const TAU = Math.PI * 2;

/** rc, zs: nested arrays [m][n + ntor] (SIMSOPT layout). */
export function makeSurface({ nfp, mpol, ntor, rc, zs }) {
  const modes = [];
  for (let m = 0; m <= mpol; m++) {
    for (let n = -ntor; n <= ntor; n++) {
      const r = rc[m][n + ntor], z = zs[m][n + ntor];
      if (r !== 0 || z !== 0) modes.push({ m, n, rc: r, zs: z });
    }
  }
  return { nfp, mpol, ntor, rc, zs, modes };
}

/** Evaluates point and quadpoint derivatives at (phi, theta). */
export function surfacePoint(s, phi, theta, o = {}) {
  const ph = TAU * phi, th = TAU * theta;
  let R = 0, Z = 0, Rp = 0, Rt = 0, Zp = 0, Zt = 0;
  for (const { m, n, rc, zs } of s.modes) {
    const a = m * th - s.nfp * n * ph;
    const c = Math.cos(a), sn = Math.sin(a);
    R += rc * c; Z += zs * sn;
    // d/dtheta (quadpoint) = 2π·m·d/da ; d/dphi (quadpoint) = −2π·nfp·n·d/da
    Rt += -rc * sn * TAU * m; Zt += zs * c * TAU * m;
    Rp += rc * sn * TAU * s.nfp * n; Zp += -zs * c * TAU * s.nfp * n;
  }
  const cp = Math.cos(ph), sp = Math.sin(ph);
  o.R = R; o.Z = Z;
  o.x = R * cp; o.y = R * sp; o.z = Z;
  // ∂γ/∂phi includes the rotation of the (R, φ) frame: d/dphi (R cos φ) = Rp cos φ − R sin φ · 2π
  o.px = Rp * cp - R * sp * TAU; o.py = Rp * sp + R * cp * TAU; o.pz = Zp;
  o.tx = Rt * cp; o.ty = Rt * sp; o.tz = Zt;
  return o;
}

/** SIMSOPT quadpoint rules for each `range`. */
export function quadpointsPhi(nfp, range, nphi) {
  const out = new Float64Array(nphi);
  for (let j = 0; j < nphi; j++) {
    if (range === 'full torus') out[j] = j / nphi;
    else if (range === 'field period') out[j] = j / (nphi * nfp);
    else out[j] = ((j + 0.5) * 0.5) / (nfp * nphi); // half period, shifted by half a cell
  }
  return out;
}

/**
 * Quadrature grid on the surface (SIMSOPT ordering: phi outer, theta inner).
 * Returns positions, normals n (non-unit), unit normals and |n|.
 */
export function quadGrid(s, range, nphi, ntheta) {
  const phis = quadpointsPhi(s.nfp, range, nphi);
  const count = nphi * ntheta;
  const positions = new Float64Array(3 * count);
  const normals = new Float64Array(3 * count);
  const unit = new Float64Array(3 * count);
  const absn = new Float64Array(count);
  const o = {};
  for (let i = 0; i < nphi; i++) {
    for (let j = 0; j < ntheta; j++) {
      surfacePoint(s, phis[i], j / ntheta, o);
      const k = i * ntheta + j, t = 3 * k;
      positions[t] = o.x; positions[t + 1] = o.y; positions[t + 2] = o.z;
      const nx = o.py * o.tz - o.pz * o.ty, ny = o.pz * o.tx - o.px * o.tz, nz = o.px * o.ty - o.py * o.tx;
      const l = Math.hypot(nx, ny, nz) || 1e-300;
      normals[t] = nx; normals[t + 1] = ny; normals[t + 2] = nz;
      unit[t] = nx / l; unit[t + 1] = ny / l; unit[t + 2] = nz / l;
      absn[k] = l;
    }
  }
  return { range, nphi, ntheta, count, phis, positions, normals, unit, absn };
}

/**
 * Full-torus display mesh with duplicated seams (for smooth shading and texture-free
 * shader patterns). `map[r]` gives the physics grid vertex of render vertex r.
 * The physics grid is quadGrid(s, 'full torus', nPhi, nTheta).
 */
export function displayMesh(s, grid) {
  const { nphi, ntheta } = grid;
  const W = ntheta + 1, H = nphi + 1, n = W * H;
  const pos = new Float32Array(3 * n), nor = new Float32Array(3 * n), ang = new Float32Array(2 * n);
  const map = new Int32Array(n);
  const o = {};
  for (let ip = 0; ip < H; ip++) {
    for (let it = 0; it < W; it++) {
      const r = ip * W + it, phys = (ip % nphi) * ntheta + (it % ntheta);
      surfacePoint(s, ip / nphi, it / ntheta, o);
      map[r] = phys;
      pos[3 * r] = o.x; pos[3 * r + 1] = o.y; pos[3 * r + 2] = o.z;
      // Outward normal for lighting (SIMSOPT's n may point inward depending on orientation).
      const sgn = outwardSign(grid, phys);
      nor[3 * r] = sgn * grid.unit[3 * phys]; nor[3 * r + 1] = sgn * grid.unit[3 * phys + 1]; nor[3 * r + 2] = sgn * grid.unit[3 * phys + 2];
      ang[2 * r] = (2 * Math.PI * it) / ntheta; ang[2 * r + 1] = (2 * Math.PI * ip) / nphi;
    }
  }
  const idx = [];
  for (let ip = 0; ip < nphi; ip++) {
    for (let it = 0; it < ntheta; it++) {
      const a = ip * W + it, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { pos, nor, ang, map, idx, count: n };
}

/** +1 if the grid normal points away from the magnetic axis region, else −1. */
function outwardSign(grid, k) {
  const t = 3 * k;
  const x = grid.positions[t], y = grid.positions[t + 1];
  const R = Math.hypot(x, y) || 1;
  // Compare with the radial direction from the cross-section centre (approximated by the
  // grid's mean major radius at this point's toroidal angle is overkill; the boundary is
  // star-shaped about its centre, so use the local centroid computed once).
  const c = grid.centre ?? (grid.centre = centroidOf(grid));
  const dx = R - c.R, dz = grid.positions[t + 2] - c.Z;
  const nR = (grid.unit[t] * x + grid.unit[t + 1] * y) / R, nZ = grid.unit[t + 2];
  return nR * dx + nZ * dz >= 0 ? 1 : -1;
}

function centroidOf(grid) {
  let R = 0, Z = 0;
  for (let k = 0; k < grid.count; k++) {
    R += Math.hypot(grid.positions[3 * k], grid.positions[3 * k + 1]);
    Z += grid.positions[3 * k + 2];
  }
  return { R: R / grid.count, Z: Z / grid.count };
}

/** Boundary cross-section at toroidal angle φ (radians): arrays of R and Z. */
export function crossSection(s, phiRad, n = 128) {
  const R = new Float64Array(n), Z = new Float64Array(n);
  const o = {};
  for (let j = 0; j < n; j++) {
    surfacePoint(s, phiRad / (2 * Math.PI), j / n, o);
    R[j] = o.R; Z[j] = o.Z;
  }
  return { R, Z };
}

/**
 * The toy tutorial surfaces in SIMSOPT form:
 *   R = R0 + a cosθ + Δ cos(θ − nfp φ),  Z = a sinθ − Δ sin(θ − nfp φ)   (rotating ellipse)
 */
export function rotatingEllipse({ R0, a, delta, nfp }) {
  const rc = [[0, R0, 0], [0, a, delta]];
  const zs = [[0, 0, 0], [0, a, -delta]];
  return { nfp, mpol: 1, ntor: 1, rc, zs };
}
