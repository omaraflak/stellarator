/**
 * Coils as thick neon tubes plus their control points as glowing spheres.
 *
 * Tubes are rebuilt in place (no reallocation) whenever a coil changes. Frames use
 * parallel transport with the closing twist spread evenly along the loop, so a
 * closed coil has no seam. Per-vertex attributes carry the local bend (κ/κmax) and an
 * alert flag (collision, port or plasma contact) so the shader can paint
 * over-stressed or clashing segments bright red.
 */
import * as THREE from 'three';

const RADIAL = 10;
export const ORBIT_COLORS = [0x8f7dff, 0xe46cff, 0x6f9dff, 0xc9b8ff, 0xb46bff, 0x7fb4ff];

const vertexShader = /* glsl */ `
  attribute float aStress;
  attribute float aAlert;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vStress;
  varying float vAlert;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vStress = aStress;
    vAlert = aAlert;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSelected;
  uniform float uHover;
  uniform float uGhost;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vStress;
  varying float vAlert;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
    float diff = 0.3 + 0.7 * max(dot(n, L), 0.0);
    float spec = pow(max(dot(reflect(-L, n), v), 0.0), 24.0);
    float rim = pow(1.0 - abs(dot(n, v)), 2.0);
    float glow = 0.08 + 0.55 * uSelected + 0.3 * uHover;
    vec3 col = uColor * (0.2 + 0.45 * diff) + uColor * rim * (0.75 + uSelected) + vec3(spec) * 0.5 + uColor * glow;
    // Symmetric copies are drawn as faint outlines; their clashes still glow red below.
    col *= mix(1.0, 0.055, uGhost);

    // Bend stress: amber as κ approaches the limit, hot red past it.
    float pulse = 0.55 + 0.45 * sin(uTime * 9.0);
    float warn = smoothstep(0.8, 1.0, vStress) * (1.0 - step(1.0, vStress)) * (1.0 - 0.85 * uGhost);
    col = mix(col, vec3(1.0, 0.68, 0.2) * 1.4, warn * 0.6);
    float bad = max(step(1.0, vStress), vAlert);
    col = mix(col, vec3(1.0, 0.1, 0.2) * (1.4 + 1.2 * pulse), bad);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class CoilView {
  /**
   * K coils drawn as tubes (Nr samples each); the first `editable` coils (the base curves)
   * carry M drag handles each. tube / handle: radii in metres.
   */
  constructor(K, editable, M, Nr, { tube = 0.02, handle = 0.026 } = {}) {
    this.K = K; this.E = editable; this.M = M; this.Nr = Nr;
    this.tube = tube;
    this.group = new THREE.Group();
    this.tubes = [];
    this.materials = [];
    const idx = new (Nr * RADIAL > 65000 ? Uint32Array : Uint16Array)(Nr * RADIAL * 6);
    let q = 0;
    for (let i = 0; i < Nr; i++) {
      const i2 = (i + 1) % Nr;
      for (let r = 0; r < RADIAL; r++) {
        const r2 = (r + 1) % RADIAL;
        const a = i * RADIAL + r, b = i2 * RADIAL + r, c = i2 * RADIAL + r2, d = i * RADIAL + r2;
        idx[q++] = a; idx[q++] = b; idx[q++] = d;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
    for (let k = 0; k < K; k++) {
      const g = new THREE.BufferGeometry();
      const nV = Nr * RADIAL;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * nV), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(3 * nV), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aStress', new THREE.BufferAttribute(new Float32Array(nV), 1).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aAlert', new THREE.BufferAttribute(new Float32Array(nV), 1).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader, fragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(ORBIT_COLORS[0]) },
          uTime: { value: 0 }, uSelected: { value: 0 }, uHover: { value: 0 }, uGhost: { value: 0 },
        },
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.userData.coil = k;
      this.tubes.push(mesh);
      this.materials.push(mat);
      this.group.add(mesh);
    }

    // Control points.
    const sphere = new THREE.SphereGeometry(handle, 18, 12);
    this.points = new THREE.InstancedMesh(sphere, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), editable * M);
    this.points.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.pointPos = new Float32Array(3 * editable * M);
    this.coilColors = [];
    this.state = null;

    // Scratch buffers for frames.
    this.T = new Float64Array(3 * Nr);
    this.N = new Float64Array(3 * Nr);
  }

  setOrbitColors(orbit) {
    this.coilColors = [];
    for (let k = 0; k < this.K; k++) {
      const c = new THREE.Color(ORBIT_COLORS[orbit[k] % ORBIT_COLORS.length]);
      this.coilColors.push(c);
      this.materials[k].uniforms.uColor.value.copy(c);
    }
    this.refreshPointStyles();
  }

  /**
   * Rebuilds coil k's tube from its render samples.
   * pts: Float64Array of samples (coil k at offset 3·k·Nr), kappa likewise (k·Nr),
   * alert: Uint8Array per sample (1 = collision/port/plasma contact).
   */
  updateCoil(k, pts, kappa, kappaMax, alert) {
    const { Nr, T, N } = this;
    const base = 3 * k * Nr;
    // Tangents by central differences on the closed loop.
    for (let i = 0; i < Nr; i++) {
      const a = base + 3 * ((i - 1 + Nr) % Nr), b = base + 3 * ((i + 1) % Nr);
      let tx = pts[b] - pts[a], ty = pts[b + 1] - pts[a + 1], tz = pts[b + 2] - pts[a + 2];
      const l = Math.hypot(tx, ty, tz) || 1;
      T[3 * i] = tx / l; T[3 * i + 1] = ty / l; T[3 * i + 2] = tz / l;
    }
    // Initial normal: any vector perpendicular to T0.
    let ax = Math.abs(T[0]) < 0.9 ? 1 : 0, ay = ax ? 0 : 1, az = 0;
    let d = ax * T[0] + ay * T[1] + az * T[2];
    let nx = ax - d * T[0], ny = ay - d * T[1], nz = az - d * T[2];
    let nl = Math.hypot(nx, ny, nz);
    N[0] = nx / nl; N[1] = ny / nl; N[2] = nz / nl;
    const transport = (src, ti, out) => {
      const tx = T[ti], ty = T[ti + 1], tz = T[ti + 2];
      const dd = src[0] * tx + src[1] * ty + src[2] * tz;
      let x = src[0] - dd * tx, y = src[1] - dd * ty, z = src[2] - dd * tz;
      const l = Math.hypot(x, y, z) || 1;
      out[0] = x / l; out[1] = y / l; out[2] = z / l;
    };
    const tmp = [0, 0, 0];
    for (let i = 1; i < Nr; i++) {
      transport([N[3 * i - 3], N[3 * i - 2], N[3 * i - 1]], 3 * i, tmp);
      N[3 * i] = tmp[0]; N[3 * i + 1] = tmp[1]; N[3 * i + 2] = tmp[2];
    }
    // Closing twist: transport the last frame back to T0 and measure the angle.
    transport([N[3 * Nr - 3], N[3 * Nr - 2], N[3 * Nr - 1]], 0, tmp);
    const cx = tmp[1] * N[2] - tmp[2] * N[1], cy = tmp[2] * N[0] - tmp[0] * N[2], cz = tmp[0] * N[1] - tmp[1] * N[0];
    const twist = Math.atan2(cx * T[0] + cy * T[1] + cz * T[2], tmp[0] * N[0] + tmp[1] * N[1] + tmp[2] * N[2]);

    const g = this.tubes[k].geometry;
    const P = g.attributes.position.array, Nn = g.attributes.normal.array;
    const S = g.attributes.aStress.array, A = g.attributes.aAlert.array;
    for (let i = 0; i < Nr; i++) {
      const tx = T[3 * i], ty = T[3 * i + 1], tz = T[3 * i + 2];
      let n0x = N[3 * i], n0y = N[3 * i + 1], n0z = N[3 * i + 2];
      // Rotate the normal about T by the distributed twist correction.
      const ang = (twist * i) / Nr, c = Math.cos(ang), s = Math.sin(ang);
      const bx = ty * n0z - tz * n0y, by = tz * n0x - tx * n0z, bz = tx * n0y - ty * n0x;
      const ux = c * n0x + s * bx, uy = c * n0y + s * by, uz = c * n0z + s * bz;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      const px = pts[base + 3 * i], py = pts[base + 3 * i + 1], pz = pts[base + 3 * i + 2];
      const stress = kappa[k * this.Nr + i] / kappaMax;
      const al = alert ? alert[k * this.Nr + i] : 0;
      for (let r = 0; r < RADIAL; r++) {
        const a = (2 * Math.PI * r) / RADIAL, ca = Math.cos(a), sa = Math.sin(a);
        const ox = ca * ux + sa * vx, oy = ca * uy + sa * vy, oz = ca * uz + sa * vz;
        const v = i * RADIAL + r;
        P[3 * v] = px + this.tube * ox; P[3 * v + 1] = py + this.tube * oy; P[3 * v + 2] = pz + this.tube * oz;
        Nn[3 * v] = ox; Nn[3 * v + 1] = oy; Nn[3 * v + 2] = oz;
        S[v] = stress; A[v] = al;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.aStress.needsUpdate = true;
    g.attributes.aAlert.needsUpdate = true;
    g.computeBoundingSphere();
  }

  /** Re-uploads only the stress/alert attributes (constraints changed, shape did not). */
  updateFlags(k, kappa, kappaMax, alert) {
    const g = this.tubes[k].geometry;
    const S = g.attributes.aStress.array, A = g.attributes.aAlert.array;
    for (let i = 0; i < this.Nr; i++) {
      const stress = kappa[k * this.Nr + i] / kappaMax;
      const al = alert ? alert[k * this.Nr + i] : 0;
      for (let r = 0; r < RADIAL; r++) { S[i * RADIAL + r] = stress; A[i * RADIAL + r] = al; }
    }
    g.attributes.aStress.needsUpdate = true;
    g.attributes.aAlert.needsUpdate = true;
  }

  updatePoints(ctrl) {
    this.pointPos.set(ctrl);
    this.refreshPointStyles();
  }

  /**
   * Coils in `ghosts` (symmetric copies of the coils being designed) are drawn faintly
   * with additive blending, so the coils you edit stand out.
   */
  setGhosts(ghosts) {
    for (let k = 0; k < this.K; k++) {
      const g = ghosts.has(k);
      const mat = this.materials[k];
      if ((mat.uniforms.uGhost.value === 1) === g) continue;
      mat.uniforms.uGhost.value = g ? 1 : 0;
      mat.transparent = g;
      mat.depthWrite = !g;
      mat.blending = g ? THREE.AdditiveBlending : THREE.NormalBlending;
      mat.needsUpdate = true;
      this.tubes[k].renderOrder = g ? 1 : 0;
    }
  }

  /**
   * Interaction state. Control points are shown only on the selected and hovered coils,
   * so the scene stays readable; followers (coils that copy the selected one through
   * symmetry or "Link coils") get a soft highlight.
   */
  setState(state) {
    this.state = { selected: -1, hovered: -1, hoverPoint: -1, dragPoint: null, followers: [], ...state };
    this.refreshPointStyles();
  }

  refreshPointStyles() {
    const { K, M, E } = this;
    const { selected, hovered, hoverPoint, dragPoint, followers } = this.state ?? { selected: -1, hovered: -1, hoverPoint: -1, dragPoint: null, followers: [] };
    const fset = new Set(followers);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const white = new THREE.Color(0xffffff);
    for (let k = 0; k < K; k++) {
      const base = this.coilColors[k] ?? new THREE.Color(ORBIT_COLORS[0]);
      this.materials[k].uniforms.uSelected.value = k === selected ? 1 : fset.has(k) ? 0.3 : 0;
      this.materials[k].uniforms.uHover.value = k === hovered && k !== selected ? 1 : 0;
      const show = k === selected || k === hovered;
      if (k >= E) continue;
      for (let j = 0; j < M; j++) {
        const i = k * M + j;
        let s = show ? 1 : 0;
        c.copy(base).lerp(white, 0.55).multiplyScalar(1.5);
        if (dragPoint && dragPoint[0] === k && dragPoint[1] === j) { s = 1.6; c.setRGB(3, 3, 3); }
        else if (k === hovered && j === hoverPoint) { s = 1.5; c.setRGB(2.4, 2.4, 2.4); }
        m.makeScale(s, s, s);
        m.setPosition(this.pointPos[3 * i], this.pointPos[3 * i + 1], this.pointPos[3 * i + 2]);
        this.points.setMatrixAt(i, m);
        this.points.setColorAt(i, c);
      }
    }
    this.points.instanceMatrix.needsUpdate = true;
    if (this.points.instanceColor) this.points.instanceColor.needsUpdate = true;
  }

  tick(time) {
    for (const mat of this.materials) mat.uniforms.uTime.value = time;
  }

  dispose() {
    for (const t of this.tubes) { t.geometry.dispose(); t.material.dispose(); }
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
