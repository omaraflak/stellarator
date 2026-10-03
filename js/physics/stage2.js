/**
 * The stage-2 coil problem, term for term as in SIMSOPT
 * (examples/2_Intermediate/stage_two_optimization.py):
 *
 *   J = Jf + w_L Σ L_i + w_cc·Jcc + w_cs·Jcs + w_κ Σ Jκ_i + w_msc Σ ½·max(MSC_i − MSC_max, 0)²
 *
 *   Jf   = ½ ∫ (B·n̂)² ds = ½ mean_grid[(B·n̂)²·|n|]                       SquaredFlux
 *   L_i  = mean_q |γ'|                                                       CurveLength
 *   Jcc  = Σ_{i, j<min(i,nbase)} mean_{q,r} |γ'_i||γ'_j| max(d_cc − |γ_i − γ_j|, 0)²   CurveCurveDistance
 *   Jcs  = Σ_coils mean_{q,s} |γ'||n_s| max(d_cs − |γ − x_s|, 0)²             CurveSurfaceDistance
 *   Jκ_i = ½ mean_q max(κ − κ_max, 0)²·|γ'|                                  LpCurveCurvature(p=2)
 *   MSC_i = mean_q(κ²|γ'|) / mean_q|γ'|                                       MeanSquaredCurvature
 *
 * plus, for the tutorial levels only: a per-coil length cap ½·max(L_i − L_max, 0)² (the
 * QuadraticPenalty pattern SIMSOPT uses for length limits) and a port keep-out penalty.
 * `evaluate` returns J, every term, the headline metrics and (optionally) the exact
 * gradient with respect to the base-curve DOFs and base currents.
 */
import { MU0_OVER_4PI } from './coilset.js';

export const REFERENCE_WEIGHTS = { length: 1e-7, cc: 1000, cs: 10, curvature: 1e-6, msc: 1e-6, port: 1 };

/** Biot–Savart at every grid point. B: 3·NS. */
export function fieldOnGrid(cs, pts, NS, B) {
  const { nq, ncoils, G, G1, I } = cs;
  B.fill(0);
  for (let c = 0; c < ncoils; c++) {
    const w = (MU0_OVER_4PI * I[c]) / nq, base = 3 * nq * c;
    for (let q = 0; q < nq; q++) {
      const k = base + 3 * q;
      const gx = G[k], gy = G[k + 1], gz = G[k + 2];
      const tx = w * G1[k], ty = w * G1[k + 1], tz = w * G1[k + 2];
      for (let i = 0; i < NS; i++) {
        const t3 = 3 * i;
        const rx = pts[t3] - gx, ry = pts[t3 + 1] - gy, rz = pts[t3 + 2] - gz;
        const r2 = rx * rx + ry * ry + rz * rz;
        const inv = 1 / (r2 * Math.sqrt(r2));
        B[t3] += (ty * rz - tz * ry) * inv;
        B[t3 + 1] += (tz * rx - tx * rz) * inv;
        B[t3 + 2] += (tx * ry - ty * rx) * inv;
      }
    }
  }
}

/**
 * problem = { grid, ccMin, csMin, kappaMax, mscMax, weights, ports? }
 * grid: quadGrid() result for the scoring surface.
 */
export function evaluate(cs, problem, wantGrad = false) {
  const { grid, weights: W } = problem;
  const { nq, nbase, ncoils, G, G1, I, g1, g2, ops, basis } = cs;
  const NS = grid.count, pts = grid.positions, un = grid.unit, absn = grid.absn;

  // ---------- squared flux ----------
  const B = new Float64Array(3 * NS);
  fieldOnGrid(cs, pts, NS, B);
  let Jf = 0, sumBn = 0, sumB = 0, maxRatio = 0;
  const v = wantGrad ? new Float64Array(3 * NS) : null;
  for (let i = 0; i < NS; i++) {
    const t = 3 * i;
    const bn = B[t] * un[t] + B[t + 1] * un[t + 1] + B[t + 2] * un[t + 2];
    const bm = Math.hypot(B[t], B[t + 1], B[t + 2]);
    Jf += bn * bn * absn[i];
    sumBn += Math.abs(bn); sumB += bm;
    if (Math.abs(bn) / bm > maxRatio) maxRatio = Math.abs(bn) / bm;
    if (v) {
      const s = (bn * absn[i]) / NS;
      v[t] = s * un[t]; v[t + 1] = s * un[t + 1]; v[t + 2] = s * un[t + 2];
    }
  }
  Jf = (0.5 * Jf) / NS;

  // Gradients with respect to all-coil points/tangents and base second derivatives.
  const gG = wantGrad ? new Float64Array(3 * nq * ncoils) : null;
  const gT = wantGrad ? new Float64Array(3 * nq * ncoils) : null;
  const gI = wantGrad ? new Float64Array(ncoils) : null;
  const gB2 = wantGrad ? new Float64Array(3 * nq * nbase) : null;
  const gT1base = wantGrad ? new Float64Array(3 * nq * nbase) : null;

  if (wantGrad) {
    // Adjoint of Biot–Savart: v_i = dJf/dB_i.
    for (let c = 0; c < ncoils; c++) {
      const w = (MU0_OVER_4PI * I[c]) / nq, base = 3 * nq * c;
      let sI = 0;
      for (let q = 0; q < nq; q++) {
        const k = base + 3 * q;
        const gx = G[k], gy = G[k + 1], gz = G[k + 2];
        const tx = G1[k], ty = G1[k + 1], tz = G1[k + 2];
        let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, s = 0;
        for (let i = 0; i < NS; i++) {
          const t3 = 3 * i;
          const rx = pts[t3] - gx, ry = pts[t3 + 1] - gy, rz = pts[t3 + 2] - gz;
          const vx = v[t3], vy = v[t3 + 1], vz = v[t3 + 2];
          const r2 = rx * rx + ry * ry + rz * rz;
          const inv3 = 1 / (r2 * Math.sqrt(r2)), inv5 = inv3 / r2;
          // r × v
          ax += (ry * vz - rz * vy) * inv3; ay += (rz * vx - rx * vz) * inv3; az += (rx * vy - ry * vx) * inv3;
          // v × t
          const cx = vy * tz - vz * ty, cy = vz * tx - vx * tz, cz = vx * ty - vy * tx;
          const rc = rx * cx + ry * cy + rz * cz; // r·(v×t) = v·(t×r)
          s += rc * inv3;
          bx += cx * inv3 - 3 * rc * rx * inv5;
          by += cy * inv3 - 3 * rc * ry * inv5;
          bz += cz * inv3 - 3 * rc * rz * inv5;
        }
        gT[k] += w * ax; gT[k + 1] += w * ay; gT[k + 2] += w * az;
        gG[k] -= w * bx; gG[k + 1] -= w * by; gG[k + 2] -= w * bz;
        sI += s;
      }
      gI[c] += (MU0_OVER_4PI / nq) * sI;
    }
  }

  // ---------- coil-coil distance (all pairs for the metric, SIMSOPT pairs for J) ----------
  const dcc = problem.ccMin;
  let Jcc = 0, ccMin = Infinity, ccPair = [0, 0];
  for (let i = 0; i < ncoils; i++) {
    for (let j = 0; j < i; j++) {
      const counted = j < Math.min(i, nbase);
      const bi = 3 * nq * i, bj = 3 * nq * j;
      for (let q = 0; q < nq; q++) {
        const a = bi + 3 * q;
        const xi = G[a], yi = G[a + 1], zi = G[a + 2];
        const li = Math.hypot(G1[a], G1[a + 1], G1[a + 2]);
        for (let r = 0; r < nq; r++) {
          const b = bj + 3 * r;
          const dx = xi - G[b], dy = yi - G[b + 1], dz = zi - G[b + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < ccMin) { ccMin = d; ccPair = [i, j]; }
          if (!counted || d >= dcc) continue;
          const lj = Math.hypot(G1[b], G1[b + 1], G1[b + 2]);
          const e = dcc - d, n2 = nq * nq;
          Jcc += (li * lj * e * e) / n2;
          if (!wantGrad) continue;
          // d/dγ_i of e² = −2e·(γ_i − γ_j)/d ; d/dγ'_i of |γ'_i| = γ'_i/|γ'_i|
          const f = (-2 * li * lj * e) / (d * n2);
          gG[a] += W.cc * f * dx; gG[a + 1] += W.cc * f * dy; gG[a + 2] += W.cc * f * dz;
          gG[b] -= W.cc * f * dx; gG[b + 1] -= W.cc * f * dy; gG[b + 2] -= W.cc * f * dz;
          const hi = (W.cc * lj * e * e) / (li * n2), hj = (W.cc * li * e * e) / (lj * n2);
          gT[a] += hi * G1[a]; gT[a + 1] += hi * G1[a + 1]; gT[a + 2] += hi * G1[a + 2];
          gT[b] += hj * G1[b]; gT[b + 1] += hj * G1[b + 1]; gT[b + 2] += hj * G1[b + 2];
        }
      }
    }
  }

  // ---------- coil-surface distance ----------
  const dcs = problem.csMin;
  let Jcs = 0, csMin = Infinity, csCoil = 0;
  for (let c = 0; c < ncoils; c++) {
    const base = 3 * nq * c;
    for (let q = 0; q < nq; q++) {
      const a = base + 3 * q;
      const x = G[a], y = G[a + 1], z = G[a + 2];
      const lc = Math.hypot(G1[a], G1[a + 1], G1[a + 2]);
      for (let s = 0; s < NS; s++) {
        const t3 = 3 * s;
        const dx = x - pts[t3], dy = y - pts[t3 + 1], dz = z - pts[t3 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < csMin) { csMin = d; csCoil = c; }
        if (d >= dcs) continue;
        const e = dcs - d, n2 = nq * NS;
        Jcs += (lc * absn[s] * e * e) / n2;
        if (!wantGrad) continue;
        const f = (W.cs * -2 * lc * absn[s] * e) / (d * n2);
        gG[a] += f * dx; gG[a + 1] += f * dy; gG[a + 2] += f * dz;
        const h = (W.cs * absn[s] * e * e) / (lc * n2);
        gT[a] += h * G1[a]; gT[a + 1] += h * G1[a + 1]; gT[a + 2] += h * G1[a + 2];
      }
    }
  }

  // ---------- port keep-out (tutorial level only) ----------
  let Jport = 0;
  const portsBlocked = [];
  for (const [pi, p] of (problem.ports ?? []).entries()) {
    const before = Jport;
    const lim = p.radius + p.margin;
    for (let c = 0; c < ncoils; c++) {
      for (let q = 0; q < nq; q++) {
        const a = 3 * nq * c + 3 * q;
        const rx = G[a] - p.start[0], ry = G[a + 1] - p.start[1], rz = G[a + 2] - p.start[2];
        const t = rx * p.dir[0] + ry * p.dir[1] + rz * p.dir[2];
        if (t < -p.margin || t > p.length + p.margin) continue;
        const px = rx - t * p.dir[0], py = ry - t * p.dir[1], pz = rz - t * p.dir[2];
        const rho = Math.hypot(px, py, pz);
        if (rho >= lim) continue;
        Jport += ((lim - rho) ** 2) / nq;
        if (wantGrad && rho > 1e-12) {
          const f = (W.port * -2 * (lim - rho)) / (nq * rho);
          gG[a] += f * px; gG[a + 1] += f * py; gG[a + 2] += f * pz;
        }
      }
    }
    if (Jport > before) portsBlocked.push(pi);
  }

  // ---------- per-base-curve terms: length, curvature, mean squared curvature ----------
  const lengths = new Float64Array(nbase), kappaMax = new Float64Array(nbase), msc = new Float64Array(nbase), Jcurv = new Float64Array(nbase);
  const k0 = problem.kappaMax, mscMax = problem.mscMax, Lmax = problem.lengthMax ?? Infinity;
  let Jmsc = 0, Jlmax = 0;
  for (let b = 0; b < nbase; b++) {
    const off = 3 * nq * b;
    let L = 0, A = 0, Jk = 0, kmax = 0;
    const kap = new Float64Array(nq), la = new Float64Array(nq);
    for (let q = 0; q < nq; q++) {
      const o = off + 3 * q;
      const ax = g1[o], ay = g1[o + 1], az = g1[o + 2], bx = g2[o], by = g2[o + 1], bz = g2[o + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const an = Math.hypot(ax, ay, az), cn = Math.hypot(cx, cy, cz);
      const k = cn / (an * an * an);
      kap[q] = k; la[q] = an;
      L += an; A += k * k * an;
      const e = Math.max(k - k0, 0);
      Jk += 0.5 * e * e * an;
      if (k > kmax) kmax = k;
    }
    L /= nq; A /= nq; Jk /= nq;
    const M = A / L;
    lengths[b] = L; msc[b] = M; Jcurv[b] = Jk; kappaMax[b] = kmax;
    const excess = Math.max(M - mscMax, 0);
    Jmsc += 0.5 * excess * excess;
    const over = Math.max(L - Lmax, 0);
    Jlmax += 0.5 * over * over;
    if (!wantGrad) continue;
    for (let q = 0; q < nq; q++) {
      const o = off + 3 * q;
      const ax = g1[o], ay = g1[o + 1], az = g1[o + 2], bx = g2[o], by = g2[o + 1], bz = g2[o + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const an = la[q], cn = Math.hypot(cx, cy, cz), k = kap[q];
      // dκ/da = (b×c)/(|c||a|³) − 3κ a/|a|² ;  dκ/db = (c×a)/(|c||a|³)
      let dka = [0, 0, 0], dkb = [0, 0, 0];
      if (cn > 1e-300) {
        const s = 1 / (cn * an * an * an);
        dka = [(by * cz - bz * cy) * s - (3 * k * ax) / (an * an), (bz * cx - bx * cz) * s - (3 * k * ay) / (an * an), (bx * cy - by * cx) * s - (3 * k * az) / (an * an)];
        dkb = [(cy * az - cz * ay) * s, (cz * ax - cx * az) * s, (cx * ay - cy * ax) * s];
      }
      const ua = [ax / an, ay / an, az / an];
      const e = Math.max(k - k0, 0);
      for (let d = 0; d < 3; d++) {
        // length (linear weight, plus the optional cap)
        let ga = ((W.length + (W.lengthMax ?? 0) * over) * ua[d]) / nq;
        // curvature Lp (p = 2)
        ga += (W.curvature * (e * an * dka[d] + 0.5 * e * e * ua[d])) / nq;
        let gb = (W.curvature * e * an * dkb[d]) / nq;
        // mean squared curvature: MSC = A/L
        if (excess > 0) {
          const dA_da = (2 * k * an * dka[d] + k * k * ua[d]) / nq, dL_da = ua[d] / nq;
          const dA_db = (2 * k * an * dkb[d]) / nq;
          ga += W.msc * excess * (dA_da / L - (A * dL_da) / (L * L));
          gb += W.msc * excess * (dA_db / L);
        }
        gT1base[o + d] += ga;
        gB2[o + d] += gb;
      }
    }
  }

  let totalLength = 0;
  for (const L of lengths) totalLength += L;
  const J = Jf + W.length * totalLength + W.cc * Jcc + W.cs * Jcs + W.curvature * Jcurv.reduce((a, b) => a + b, 0) + W.msc * Jmsc
    + (W.port ?? 0) * Jport + (W.lengthMax ?? 0) * Jlmax;

  const metrics = {
    J, Jf, Jcc, Jcs, Jport, Jlmax, Jcurv: Array.from(Jcurv),
    BdotN_mean: sumBn / NS, B_mean: sumB / NS, fieldError: sumBn / sumB, maxRatio,
    lengths: Array.from(lengths), totalLength, kappaMax: Array.from(kappaMax), msc: Array.from(msc),
    ccMin, csMin, ccPair, csCoil, portsBlocked,
  };
  if (!wantGrad) return { J, metrics };

  // ---------- chain rule to base DOFs ----------
  const nd = cs.nd, nb = basis.nb;
  const grad = new Float64Array(nbase * nd + nbase);
  // all coils → base curves
  const gGb = new Float64Array(3 * nq * nbase), gTb = Float64Array.from(gT1base);
  ops.forEach((op, c) => {
    const M = op.M, src = 3 * nq * c, dst = 3 * nq * op.base;
    for (let q = 0; q < nq; q++) {
      const i = src + 3 * q, o = dst + 3 * q;
      // Mᵀ·g
      gGb[o] += M[0] * gG[i] + M[3] * gG[i + 1] + M[6] * gG[i + 2];
      gGb[o + 1] += M[1] * gG[i] + M[4] * gG[i + 1] + M[7] * gG[i + 2];
      gGb[o + 2] += M[2] * gG[i] + M[5] * gG[i + 1] + M[8] * gG[i + 2];
      gTb[o] += M[0] * gT[i] + M[3] * gT[i + 1] + M[6] * gT[i + 2];
      gTb[o + 1] += M[1] * gT[i] + M[4] * gT[i + 1] + M[7] * gT[i + 2];
      gTb[o + 2] += M[2] * gT[i] + M[5] * gT[i + 1] + M[8] * gT[i + 2];
    }
    grad[nbase * nd + op.base] += op.sign * gI[c];
  });
  for (let b = 0; b < nbase; b++) {
    for (let d = 0; d < 3; d++) {
      for (let k = 0; k < nb; k++) {
        let s = 0;
        for (let q = 0; q < nq; q++) {
          const o = 3 * nq * b + 3 * q + d, row = q * nb + k;
          s += gGb[o] * basis.v[row] + gTb[o] * basis.d1[row] + gB2[o] * basis.d2[row];
        }
        grad[b * nd + d * nb + k] = s;
      }
    }
  }
  return { J, metrics, grad };
}

/**
 * Per quadrature point of every coil: 1 where that point breaks a limit (too close to
 * another coil or to the plasma, inside a port, or bent beyond the curvature limit).
 * Used to paint the offending tube segments red.
 */
export function alertFlags(cs, problem, tol = 0) {
  const { nq, nbase, ncoils, G, g1, g2, ops } = cs;
  const flags = new Uint8Array(ncoils * nq);
  const pts = problem.grid.positions, NS = problem.grid.count;
  const dcc = problem.ccMin * (1 - tol), dcs = problem.csMin * (1 - tol);
  for (let i = 0; i < ncoils; i++) {
    for (let j = 0; j < i; j++) {
      for (let q = 0; q < nq; q++) {
        const a = 3 * (i * nq + q);
        for (let r = 0; r < nq; r++) {
          const b = 3 * (j * nq + r);
          const dx = G[a] - G[b], dy = G[a + 1] - G[b + 1], dz = G[a + 2] - G[b + 2];
          if (dx * dx + dy * dy + dz * dz < dcc * dcc) { flags[i * nq + q] = 1; flags[j * nq + r] = 1; }
        }
      }
    }
  }
  for (let c = 0; c < ncoils; c++) {
    for (let q = 0; q < nq; q++) {
      const a = 3 * (c * nq + q);
      for (let s = 0; s < NS; s++) {
        const dx = G[a] - pts[3 * s], dy = G[a + 1] - pts[3 * s + 1], dz = G[a + 2] - pts[3 * s + 2];
        if (dx * dx + dy * dy + dz * dz < dcs * dcs) { flags[c * nq + q] = 1; break; }
      }
      for (const p of problem.ports ?? []) {
        const rx = G[a] - p.start[0], ry = G[a + 1] - p.start[1], rz = G[a + 2] - p.start[2];
        const t = rx * p.dir[0] + ry * p.dir[1] + rz * p.dir[2];
        if (t < -p.margin || t > p.length + p.margin) continue;
        const rho = Math.hypot(rx - t * p.dir[0], ry - t * p.dir[1], rz - t * p.dir[2]);
        if (rho < p.radius + p.margin) flags[c * nq + q] = 1;
      }
    }
  }
  const kmax = problem.kappaMax * (1 + tol);
  for (let b = 0; b < nbase; b++) {
    for (let q = 0; q < nq; q++) {
      const o = 3 * (b * nq + q);
      const ax = g1[o], ay = g1[o + 1], az = g1[o + 2], bx = g2[o], by = g2[o + 1], bz = g2[o + 2];
      const k = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / Math.hypot(ax, ay, az) ** 3;
      if (k > kmax) ops.forEach((op, c) => { if (op.base === b) flags[c * nq + q] = 1; });
    }
  }
  return flags;
}
