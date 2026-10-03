/**
 * Poincaré panel: where traced field lines pierce the φ = 0 plane, over the target
 * boundary. Nested closed curves inside the outline mean the coils make good magnetic
 * surfaces; dots that stay put mean no rotational transform; scattered or escaping points
 * mean islands, chaos or lost field lines.
 */
const COLORS = ['#7fe8ff', '#9d8cff', '#5cf2b0', '#ffd27a', '#ff9de2', '#8fb7ff', '#c7f27a', '#ffb38a'];

export class PoincarePanel {
  constructor(canvas, status) {
    this.canvas = canvas;
    this.status = status;
    this.ctx = canvas.getContext('2d');
    this.boundary = null;
    this.lines = [];
    this.total = 0;
    this.tracing = false;
  }

  start({ boundary, perTransit }, total) {
    this.boundary = boundary;
    this.perTransit = perTransit;
    this.lines = [];
    this.total = total;
    this.tracing = true;
    this.draw();
  }

  add(line) {
    this.lines[line.index] = line;
    this.draw();
  }

  done() {
    this.tracing = false;
    this.draw();
  }

  stale() {
    this.tracing = true;
    this.draw();
  }

  draw() {
    const { canvas, ctx, boundary } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!boundary) return;
    // Fit the boundary with a margin, equal scales on both axes.
    let r0 = Infinity, r1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < boundary.R.length; i++) { r0 = Math.min(r0, boundary.R[i]); r1 = Math.max(r1, boundary.R[i]); z0 = Math.min(z0, boundary.Z[i]); z1 = Math.max(z1, boundary.Z[i]); }
    const pad = 0.25 * Math.max(r1 - r0, z1 - z0);
    r0 -= pad; r1 += pad; z0 -= pad; z1 += pad;
    const k = Math.min(w / (r1 - r0), h / (z1 - z0));
    const cx = w / 2 - (k * (r0 + r1)) / 2, cy = h / 2 + (k * (z0 + z1)) / 2;
    const X = (R) => cx + k * R, Y = (Z) => cy - k * Z;
    const css = getComputedStyle(canvas);
    ctx.strokeStyle = css.getPropertyValue('--plasma') || '#3fe6ff';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= boundary.R.length; i++) {
      const j = i % boundary.R.length;
      if (i === 0) ctx.moveTo(X(boundary.R[j]), Y(boundary.Z[j])); else ctx.lineTo(X(boundary.R[j]), Y(boundary.Z[j]));
    }
    ctx.stroke();
    ctx.globalAlpha = this.tracing ? 0.35 : 1;
    let lost = 0, done = 0;
    this.lines.forEach((l, i) => {
      if (!l) return;
      done++;
      if (l.lostAt >= 0) lost++;
      ctx.fillStyle = l.lostAt >= 0 ? '#ff7a1f' : COLORS[i % COLORS.length];
      const p = l.punctures;
      for (let q = 0; q < p.length; q += 2) {
        const x = X(p[q]), y = Y(p[q + 1]);
        if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
        ctx.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
      }
    });
    ctx.globalAlpha = 1;
    if (this.status) {
      const iota = this.edgeIota();
      let text, bad = false;
      if (this.tracing && done < this.total) text = `Tracing field lines… ${done}/${this.total}`;
      else if (lost) { text = `${lost} of ${this.total} field lines leave the plasma`; bad = true; }
      else if (!(iota > 0.02)) { text = 'No twist (ι ≈ 0): field lines close on themselves'; bad = true; }
      else text = `All ${this.total} field lines stay inside · ι ≈ ${iota.toFixed(2)}`;
      this.status.textContent = text;
      this.status.classList.toggle('bad', bad && !this.tracing);
      this.iota = iota;
    }
  }

  /**
   * Rotational transform at the edge: poloidal turns per toroidal transit of the outermost
   * confined line, measured about the magnetic axis (estimated as the centroid of the
   * innermost line's punctures, which circles the axis closely).
   */
  edgeIota() {
    const ok = this.lines.filter((l) => l && l.lostAt < 0);
    if (ok.length < 2) return NaN;
    const inner = ok[0].punctures, outer = ok[ok.length - 1].punctures;
    let aR = 0, aZ = 0;
    for (let q = 0; q < inner.length; q += 2) { aR += inner[q]; aZ += inner[q + 1]; }
    aR /= inner.length / 2; aZ /= inner.length / 2;
    let prev = Math.atan2(outer[1] - aZ, outer[0] - aR), turned = 0;
    for (let q = 2; q < outer.length; q += 2) {
      const th = Math.atan2(outer[q + 1] - aZ, outer[q] - aR);
      let d = th - prev;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      turned += d; prev = th;
    }
    const transits = (outer.length / 2 - 1) / (this.perTransit || 1);
    return transits > 0 ? Math.abs(turned) / (2 * Math.PI * transits) : NaN;
  }
}
