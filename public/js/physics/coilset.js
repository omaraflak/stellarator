/**
 * Coils exactly as SIMSOPT represents them in stage-2 optimisation:
 *
 *   base curves  CurveXYZFourier of order N:
 *     x(t) = xc0 + Σ_{m=1..N} xs_m sin(2πmt) + xc_m cos(2πmt),  t ∈ [0, 1)   (same for y, z)
 *     DOF order per curve: [xc0, xs1, xc1, …, xsN, xcN, yc0, …, zc0, …]  (3·(2N+1) values)
 *     sampled at nq quadrature points t_q = q / nq (SIMSOPT's default nq = 15·N; spec.nq overrides)
 *   all coils    coils_via_symmetries(base, nfp, stellsym): for k in 0..nfp−1, for flip in
 *                [no, yes], for each base curve: γ ↦ F·R(2πk/nfp)·γ when flipped (else R·γ),
 *                and the current is negated on flipped coils.
 *   field        Biot–Savart with SIMSOPT's quadrature: B(x) = μ0/4π Σ_c I_c (1/nq) Σ_q γ'_q × (x − γ_q)/|x − γ_q|³
 *
 * A design is therefore just SIMSOPT's DOF vector: the base-curve coefficients plus
 * the base currents, and it exports without any fitting.
 */

const TAU = Math.PI * 2;
export const MU0_OVER_4PI = 1e-7;

export const dofsPerCurve = (order) => 3 * (2 * order + 1);

/** Basis values and t-derivatives for every quadrature point, in DOF order. */
export function fourierBasis(order, nq) {
  const nb = 2 * order + 1;
  const v = new Float64Array(nq * nb), d1 = new Float64Array(nq * nb), d2 = new Float64Array(nq * nb), d3 = new Float64Array(nq * nb);
  for (let q = 0; q < nq; q++) {
    const t = q / nq, o = q * nb;
    v[o] = 1;
    for (let m = 1; m <= order; m++) {
      const w = TAU * m, s = Math.sin(w * t), c = Math.cos(w * t);
      v[o + 2 * m - 1] = s; d1[o + 2 * m - 1] = w * c; d2[o + 2 * m - 1] = -w * w * s; d3[o + 2 * m - 1] = -w * w * w * c;
      v[o + 2 * m] = c; d1[o + 2 * m] = -w * s; d2[o + 2 * m] = -w * w * c; d3[o + 2 * m] = w * w * w * s;
    }
  }
  return { order, nq, nb, v, d1, d2, d3 };
}

/** Evaluates a basis table on one curve's DOFs (offset `off`) into `out` (3·nq), xyz interleaved. */
export function evalCurve(dofs, off, basis, table, out, outOff = 0) {
  const { nq, nb } = basis;
  for (let q = 0; q < nq; q++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      const a = off + c * nb, row = q * nb;
      for (let k = 0; k < nb; k++) s += dofs[a + k] * table[row + k];
      out[outOff + 3 * q + c] = s;
    }
  }
}

/** SIMSOPT create_equally_spaced_curves(ncurves, nfp, stellsym, R0, R1, order). */
export function equallySpacedCurves(ncurves, nfp, stellsym, R0, R1, order) {
  const nd = dofsPerCurve(order), nb = 2 * order + 1;
  const dofs = new Float64Array(ncurves * nd);
  for (let i = 0; i < ncurves; i++) {
    const angle = ((i + 0.5) * TAU) / ((stellsym ? 2 : 1) * nfp * ncurves);
    const o = i * nd;
    dofs[o + 0] = Math.cos(angle) * R0;          // xc(0)
    dofs[o + 2] = Math.cos(angle) * R1;          // xc(1)
    dofs[o + nb + 0] = Math.sin(angle) * R0;     // yc(0)
    dofs[o + nb + 2] = Math.sin(angle) * R1;     // yc(1)
    dofs[o + 2 * nb + 1] = -R1;                  // zs(1)
  }
  return dofs;
}

/**
 * Symmetry operations in SIMSOPT order. Each maps a base curve to one coil:
 * { base, M (row-major 3×3, p_coil = M·p_base), sign (current factor) }.
 */
export function symmetryOps(nbase, nfp, stellsym) {
  const ops = [];
  for (let k = 0; k < nfp; k++) {
    const a = (TAU * k) / nfp, c = Math.cos(a), s = Math.sin(a);
    for (const flip of stellsym ? [false, true] : [false]) {
      // RotatedCurve: gamma @ (Rᵀ·F)  ⇔  p ↦ F·R·p
      const M = flip ? [c, -s, 0, -s, -c, 0, 0, 0, -1] : [c, -s, 0, s, c, 0, 0, 0, 1];
      for (let i = 0; i < nbase; i++) ops.push({ base: i, M, sign: flip ? -1 : 1, k, flip });
    }
  }
  return ops;
}

export const applyM = (M, x, y, z, out, o) => {
  out[o] = M[0] * x + M[1] * y + M[2] * z;
  out[o + 1] = M[3] * x + M[4] * y + M[5] * z;
  out[o + 2] = M[6] * x + M[7] * y + M[8] * z;
};

/**
 * A coil set: base DOFs + base currents, evaluated on demand.
 * spec = { nbase, order, nfp, stellsym, nq? }  (nfp/stellsym of the coil symmetry; nq quadrature points per coil)
 */
export class CoilSet {
  constructor(spec, dofs, currents) {
    this.spec = spec;
    this.nbase = spec.nbase;
    this.order = spec.order;
    this.nq = spec.nq ?? 15 * spec.order;
    this.nd = dofsPerCurve(spec.order);
    this.basis = fourierBasis(spec.order, this.nq);
    this.ops = symmetryOps(spec.nbase, spec.nfp, spec.stellsym);
    this.ncoils = this.ops.length;
    this.dofs = Float64Array.from(dofs);
    this.currents = Float64Array.from(currents);
    const nq = this.nq;
    // Base-curve geometry (for curvature, length and editing).
    this.g = new Float64Array(3 * nq * this.nbase);
    this.g1 = new Float64Array(3 * nq * this.nbase);
    this.g2 = new Float64Array(3 * nq * this.nbase);
    this.g3 = new Float64Array(3 * nq * this.nbase);
    // All coils (after symmetry).
    this.G = new Float64Array(3 * nq * this.ncoils);
    this.G1 = new Float64Array(3 * nq * this.ncoils);
    this.I = new Float64Array(this.ncoils);
    this.update();
  }

  /** Recomputes geometry for the listed base curves (default: all). */
  update(bases = null) {
    const { nq, nd, basis } = this;
    const list = bases ?? [...Array(this.nbase).keys()];
    for (const b of list) {
      const off = b * nd, o = 3 * nq * b;
      evalCurve(this.dofs, off, basis, basis.v, this.g, o);
      evalCurve(this.dofs, off, basis, basis.d1, this.g1, o);
      evalCurve(this.dofs, off, basis, basis.d2, this.g2, o);
      evalCurve(this.dofs, off, basis, basis.d3, this.g3, o);
    }
    const set = new Set(list);
    this.ops.forEach((op, c) => {
      this.I[c] = op.sign * this.currents[op.base];
      if (!set.has(op.base)) return;
      const src = 3 * nq * op.base, dst = 3 * nq * c;
      for (let q = 0; q < nq; q++) {
        const i = src + 3 * q;
        applyM(op.M, this.g[i], this.g[i + 1], this.g[i + 2], this.G, dst + 3 * q);
        applyM(op.M, this.g1[i], this.g1[i + 1], this.g1[i + 2], this.G1, dst + 3 * q);
      }
    });
  }

  /** Coils generated from base curve b. */
  coilsOf(b) {
    const out = [];
    this.ops.forEach((op, c) => { if (op.base === b) out.push(c); });
    return out;
  }

  /**
   * Biot–Savart sources as [x,y,z, wx,wy,wz] records (w = μ0/4π · I · γ'/nq), the
   * format the field kernel consumes. `coils`: optional subset.
   */
  sources(out = null, coils = null) {
    const { nq } = this;
    const list = coils ?? [...Array(this.ncoils).keys()];
    const rec = out && out.length >= 6 * nq * list.length ? out : new Float64Array(6 * nq * list.length);
    let n = 0;
    for (const c of list) {
      const w = (MU0_OVER_4PI * this.I[c]) / nq, base = 3 * nq * c;
      for (let q = 0; q < nq; q++) {
        const i = base + 3 * q, o = 6 * n++;
        rec[o] = this.G[i]; rec[o + 1] = this.G[i + 1]; rec[o + 2] = this.G[i + 2];
        rec[o + 3] = w * this.G1[i]; rec[o + 4] = w * this.G1[i + 1]; rec[o + 5] = w * this.G1[i + 2];
      }
    }
    return { recs: rec, count: n };
  }

  /** Dense samples of base curve b at `n` points (for drawing tubes), plus curvature. */
  sampleBase(b, n, pts, kappa, po = 0, ko = 0) {
    const { order, nd } = this, nb = 2 * order + 1, off = b * nd;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const p = [0, 0, 0], d1 = [0, 0, 0], d2 = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const a = off + c * nb;
        p[c] = this.dofs[a];
        for (let m = 1; m <= order; m++) {
          const w = TAU * m, s = Math.sin(w * t), co = Math.cos(w * t);
          const xs = this.dofs[a + 2 * m - 1], xc = this.dofs[a + 2 * m];
          p[c] += xs * s + xc * co;
          d1[c] += w * (xs * co - xc * s);
          d2[c] += -w * w * (xs * s + xc * co);
        }
      }
      pts[po + 3 * i] = p[0]; pts[po + 3 * i + 1] = p[1]; pts[po + 3 * i + 2] = p[2];
      if (kappa) {
        const cx = d1[1] * d2[2] - d1[2] * d2[1], cy = d1[2] * d2[0] - d1[0] * d2[2], cz = d1[0] * d2[1] - d1[1] * d2[0];
        const sp = Math.hypot(d1[0], d1[1], d1[2]) || 1e-300;
        kappa[ko + i] = Math.hypot(cx, cy, cz) / (sp * sp * sp);
      }
    }
  }
}
