/**
 * Design: the player's coils as SIMSOPT degrees of freedom (Fourier coefficients of the
 * base curves, plus base currents), with undo/redo. Symmetric copies are never edited:
 * they are derived from the base curves, exactly as coils_via_symmetries does.
 *
 * Editing: each base coil carries H handles at t = j/H. Dragging handle j by Δ adds a
 * smooth, band-limited bump to the curve: Δ·w(t − t_j), with w a periodic Gaussian
 * (von Mises) projected onto the curve's Fourier modes and normalised so the handle
 * moves by exactly Δ. Neighbouring handles move by about half as much.
 */
import { initialDesign } from './problem.js';
import { dofsPerCurve } from '../physics/coilset.js';

const TAU = Math.PI * 2;
const HISTORY_LIMIT = 120;
export const HANDLES = 8;

/** Fourier weights of the normalised bump (index m = 0..order). */
function bumpWeights(order, H) {
  const kappa = Math.LN2 / (1 - Math.cos(TAU / H)); // weight ½ at the neighbouring handle
  const n = 512, A = new Float64Array(order + 1);
  for (let i = 0; i < n; i++) {
    const tau = i / n, w = Math.exp(kappa * (Math.cos(TAU * tau) - 1));
    for (let m = 0; m <= order; m++) A[m] += (m === 0 ? 1 : 2) * w * Math.cos(TAU * m * tau) / n;
  }
  const P0 = A.reduce((s, v) => s + v, 0);
  return A.map((v) => v / P0);
}

export class Design {
  constructor(level) {
    this.level = level;
    this.nbase = level.coils.nbase;
    this.order = level.coils.order;
    this.nd = dofsPerCurve(this.order);
    const d = initialDesign(level);
    this.dofs = d.dofs;
    this.currents = d.currents;
    this.bump = bumpWeights(this.order, HANDLES);
    this.undoStack = [];
    this.redoStack = [];
  }

  snapshot() {
    return { dofs: Float64Array.from(this.dofs), currents: Float64Array.from(this.currents) };
  }

  restore(s) {
    this.dofs.set(s.dofs);
    this.currents.set(s.currents);
  }

  checkpoint() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.restore(this.undoStack.pop());
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.restore(this.redoStack.pop());
    return true;
  }

  reset() {
    this.checkpoint();
    this.restore(initialDesign(this.level));
  }

  load(dofs, currents) {
    if (dofs.length !== this.dofs.length || currents.length !== this.currents.length) throw new Error('Design size does not match this level.');
    this.checkpoint();
    this.dofs.set(dofs);
    this.currents.set(currents);
  }

  /** Point on base curve b at parameter t. */
  point(b, t, dofs = this.dofs) {
    const nb = 2 * this.order + 1, off = b * this.nd, p = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const a = off + c * nb;
      p[c] = dofs[a];
      for (let m = 1; m <= this.order; m++) p[c] += dofs[a + 2 * m - 1] * Math.sin(TAU * m * t) + dofs[a + 2 * m] * Math.cos(TAU * m * t);
    }
    return p;
  }

  handle(b, j, dofs = this.dofs) {
    return this.point(b, j / HANDLES, dofs);
  }

  /** Toroidal angle of base coil b (of its centre). */
  angle(b, dofs = this.dofs) {
    const nb = 2 * this.order + 1, off = b * this.nd;
    return Math.atan2(dofs[off + nb], dofs[off]);
  }

  /**
   * The coils an edit applies to, each with the rotation (about z) that carries the
   * edited coil's frame onto it. Linked edits keep every coil's own shape and apply the
   * same change relative to each coil's position around the machine.
   */
  targets(b, linked, base) {
    if (!linked) return [{ coil: b, c: 1, s: 0 }];
    const a0 = this.angle(b, base);
    return [...Array(this.nbase).keys()].map((k) => {
      const da = this.angle(k, base) - a0;
      return { coil: k, c: Math.cos(da), s: Math.sin(da) };
    });
  }

  /** Moves handle j of coil b by world displacement d, starting from `base` DOFs. */
  deformHandle(base, b, j, d, linked) {
    this.dofs.set(base);
    const nb = 2 * this.order + 1, tj = j / HANDLES, w = this.bump;
    for (const t of this.targets(b, linked, base)) {
      const D = [t.c * d[0] - t.s * d[1], t.s * d[0] + t.c * d[1], d[2]];
      const off = t.coil * this.nd;
      for (let c = 0; c < 3; c++) {
        const a = off + c * nb;
        this.dofs[a] += D[c] * w[0];
        for (let m = 1; m <= this.order; m++) {
          this.dofs[a + 2 * m - 1] += D[c] * w[m] * Math.sin(TAU * m * tj);
          this.dofs[a + 2 * m] += D[c] * w[m] * Math.cos(TAU * m * tj);
        }
      }
    }
    return this.touched(b, linked);
  }

  /** Translates coil b (its constant Fourier terms) by d, starting from `base` DOFs. */
  moveCoil(base, b, d, linked) {
    this.dofs.set(base);
    const nb = 2 * this.order + 1;
    for (const t of this.targets(b, linked, base)) {
      const D = [t.c * d[0] - t.s * d[1], t.s * d[0] + t.c * d[1], d[2]];
      for (let c = 0; c < 3; c++) this.dofs[t.coil * this.nd + c * nb] += D[c];
    }
    return this.touched(b, linked);
  }

  /**
   * Smoothing for Fourier coils: damp the higher harmonics (m ≥ 2) of the chosen coils.
   * Removes kinks and curvature peaks while leaving the coil's centre and size alone.
   */
  smooth(coils) {
    const nb = 2 * this.order + 1;
    for (const b of coils) {
      for (let c = 0; c < 3; c++) {
        const a = b * this.nd + c * nb;
        for (let m = 2; m <= this.order; m++) {
          const f = Math.exp(-0.04 * (m - 1) * (m - 1));
          this.dofs[a + 2 * m - 1] *= f;
          this.dofs[a + 2 * m] *= f;
        }
      }
    }
    return new Set(coils);
  }

  setCurrent(b, amps) {
    this.currents[b] = amps;
  }

  touched(b, linked) {
    return new Set(linked ? [...Array(this.nbase).keys()] : [b]);
  }
}
