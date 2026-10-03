/**
 * Solar-flare sparks: short-lived particles thrown off wherever the field pierces the
 * plasma surface. Emission sites are chosen by rejection sampling on |B·n̂|/|B|, and
 * sparks fly along +n̂ where flux leaves the surface and −n̂ where it enters.
 */
import * as THREE from 'three';

const POOL = 900;
const THRESHOLD = 0.15;

export class Sparks {
  constructor(surface) {
    this.surface = surface;
    this.bn = null;
    this.pos = new Float32Array(3 * POOL);
    this.vel = new Float32Array(3 * POOL);
    this.life = new Float32Array(POOL);
    this.maxLife = new Float32Array(POOL).fill(1);
    this.col = new Float32Array(3 * POOL);
    this.size = new Float32Array(POOL);
    this.cursor = 0;
    this.enabled = true;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aSize;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 14.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setField(bn) {
    this.bn = bn;
  }

  emit(i, sign, strength) {
    const s = this.surface, t = 3 * i, q = this.cursor;
    this.cursor = (this.cursor + 1) % POOL;
    // `s` is the display quadrature grid (1 m machine): unit normals in s.unit.
    const nx = s.unit[t], ny = s.unit[t + 1], nz = s.unit[t + 2];
    this.pos[3 * q] = s.positions[t] + nx * 0.01;
    this.pos[3 * q + 1] = s.positions[t + 1] + ny * 0.01;
    this.pos[3 * q + 2] = s.positions[t + 2] + nz * 0.01;
    const sp = 0.4 + Math.random() * 0.7 * strength;
    this.vel[3 * q] = nx * sign * sp + (Math.random() - 0.5) * 0.3;
    this.vel[3 * q + 1] = ny * sign * sp + (Math.random() - 0.5) * 0.3;
    this.vel[3 * q + 2] = nz * sign * sp + (Math.random() - 0.5) * 0.3;
    this.maxLife[q] = this.life[q] = 0.35 + Math.random() * 0.6;
  }

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    const bn = this.bn;
    if (bn && this.enabled) {
      // ~1100 candidate sites per second; acceptance ∝ how far |B·n̂| exceeds the threshold.
      const tries = Math.round(1100 * dt);
      const V = this.surface.count;
      for (let n = 0; n < tries; n++) {
        const i = (Math.random() * V) | 0;
        const v = Math.abs(bn[i]);
        if (v < THRESHOLD) continue;
        const p = Math.min(1, (v - THRESHOLD) / 0.3);
        if (Math.random() < p * 0.8) this.emit(i, Math.sign(bn[i]), p);
      }
    }
    for (let q = 0; q < POOL; q++) {
      if (this.life[q] <= 0) { this.size[q] = 0; continue; }
      this.life[q] -= dt;
      const f = Math.max(0, this.life[q] / this.maxLife[q]);
      for (let c = 0; c < 3; c++) {
        this.vel[3 * q + c] *= 1 - 0.9 * dt;
        this.pos[3 * q + c] += this.vel[3 * q + c] * dt;
      }
      // White-hot → orange → deep red as the spark cools.
      this.col[3 * q] = 1.6 * f + 0.6;
      this.col[3 * q + 1] = 1.3 * f * f + 0.12;
      this.col[3 * q + 2] = 0.7 * f * f * f;
      this.size[q] = 0.5 + 1.6 * f;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
