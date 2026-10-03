/**
 * Traced magnetic field lines (from the tracer worker): each line is drawn faintly for its
 * first transits, with bright heads gliding along it so the field's direction and twist
 * are visible. Lines that leave the plasma are orange. While a new trace is running the
 * old lines dim, so they never misrepresent the current design.
 */
import * as THREE from 'three';

const HEADS_PER_LINE = 3;
const SPEED = 0.9; // metres per second along the line

export class FieldLinesView {
  constructor() {
    this.group = new THREE.Group();
    this.lines = [];
    this.stale = false;
    this.lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 });
    this.headMat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: 9 }, uDim: { value: 1 } },
      vertexShader: /* glsl */ `
        uniform float uSize;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uDim;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a * uDim, a);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.lineMesh = null;
    this.heads = null;
  }

  /** list: [{ pts: Float32Array (3·n), lost: bool }] */
  setLines(list) {
    this.clear();
    this.lines = list.filter((l) => l.pts.length >= 6).map((l) => {
      const n = l.pts.length / 3, cum = new Float32Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(l.pts[3 * i] - l.pts[3 * i - 3], l.pts[3 * i + 1] - l.pts[3 * i - 2], l.pts[3 * i + 2] - l.pts[3 * i - 1]);
      return { ...l, n, cum, len: cum[n - 1] };
    });
    if (!this.lines.length) return;
    let segs = 0;
    for (const l of this.lines) segs += l.n - 1;
    const pos = new Float32Array(segs * 6), col = new Float32Array(segs * 6);
    let q = 0;
    for (const l of this.lines) {
      const [r, g, b] = l.lost ? [1.0, 0.45, 0.15] : [0.45, 0.85, 1.0];
      for (let i = 0; i < l.n - 1; i++) {
        for (let c = 0; c < 3; c++) { pos[q + c] = l.pts[3 * i + c]; pos[q + 3 + c] = l.pts[3 * i + 3 + c]; }
        col[q] = col[q + 3] = r * 0.35; col[q + 1] = col[q + 4] = g * 0.35; col[q + 2] = col[q + 5] = b * 0.35;
        q += 6;
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.lineMesh = new THREE.LineSegments(lg, this.lineMat);
    this.lineMesh.frustumCulled = false;
    this.lineMesh.renderOrder = 3;

    const H = this.lines.length * HEADS_PER_LINE;
    this.headPos = new Float32Array(3 * H);
    const hcol = new Float32Array(3 * H);
    this.phase = new Float32Array(H);
    this.lines.forEach((l, i) => {
      for (let h = 0; h < HEADS_PER_LINE; h++) {
        const k = i * HEADS_PER_LINE + h;
        this.phase[k] = (h + Math.random() * 0.5) / HEADS_PER_LINE;
        const [r, g, b] = l.lost ? [1.6, 0.7, 0.25] : [1.2, 1.6, 1.8];
        hcol[3 * k] = r; hcol[3 * k + 1] = g; hcol[3 * k + 2] = b;
      }
    });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute('color', new THREE.BufferAttribute(hcol, 3));
    this.heads = new THREE.Points(hg, this.headMat);
    this.heads.frustumCulled = false;
    this.heads.renderOrder = 4;
    this.group.add(this.lineMesh, this.heads);
    this.setStale(false);
  }

  setStale(stale) {
    this.stale = stale;
    this.lineMat.opacity = stale ? 0.15 : 0.55;
    this.headMat.uniforms.uDim.value = stale ? 0.25 : 1;
  }

  update(dt) {
    if (!this.heads) return;
    this.lines.forEach((l, i) => {
      for (let h = 0; h < HEADS_PER_LINE; h++) {
        const k = i * HEADS_PER_LINE + h;
        this.phase[k] = (this.phase[k] + (SPEED * dt) / l.len) % 1;
        const s = this.phase[k] * l.len;
        let lo = 0, hi = l.n - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (l.cum[mid] < s) lo = mid; else hi = mid; }
        const t = (s - l.cum[lo]) / Math.max(1e-9, l.cum[hi] - l.cum[lo]);
        for (let c = 0; c < 3; c++) this.headPos[3 * k + c] = l.pts[3 * lo + c] + t * (l.pts[3 * hi + c] - l.pts[3 * lo + c]);
      }
    });
    this.heads.geometry.attributes.position.needsUpdate = true;
  }

  clear() {
    if (this.lineMesh) { this.group.remove(this.lineMesh); this.lineMesh.geometry.dispose(); this.lineMesh = null; }
    if (this.heads) { this.group.remove(this.heads); this.heads.geometry.dispose(); this.heads = null; }
    this.lines = [];
  }

  dispose() {
    this.clear();
    this.lineMat.dispose();
    this.headMat.dispose();
  }
}
