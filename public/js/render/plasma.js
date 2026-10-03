/**
 * Plasma core: the target surface drawn as a glowing, semi-transparent containment
 * field. A custom shader maps the local normal field |B·n̂|/|B| to colour on a log
 * scale (10⁻³ calm cyan … 0.2 solar-flare orange), so progress stays visible all the way
 * down to research-grade designs. Leaky regions also "boil" slightly.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uGain;
  attribute float aLeak;
  attribute vec2 aAngle;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vLeak;
  varying vec2 vAngle;
  void main() {
    // log10 |B·n̂/|B||: −3 (calm) … −0.7 (fully hot)
    float L = clamp((log(abs(aLeak) + 1e-7) / log(10.0) + 3.0) / 2.3, 0.0, 1.0);
    float wobble = 0.004 * sin(uTime * 1.7 + aAngle.y * 9.0 + aAngle.x * 2.0);
    float boil = L * L * (0.012 + 0.006 * sin(uTime * 5.0 + aAngle.x * 11.0 + aAngle.y * 23.0));
    vec3 p = position + normal * (wobble + boil);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vLeak = L;
    vAngle = aAngle;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uHeat;
  uniform float uOpacity;
  uniform vec3 uDeep;
  uniform vec3 uCalm;
  uniform vec3 uHot;
  uniform vec3 uFlare;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vLeak;
  varying vec2 vAngle;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    float fres = pow(1.0 - abs(dot(n, v)), 2.3);
    float L = vLeak * uHeat;

    // Field-aligned striations drifting around the torus.
    float s1 = sin(vAngle.y * 40.0 - uTime * 1.6 + 0.9 * sin(vAngle.x * 3.0 + uTime * 0.4));
    float s2 = sin(vAngle.x * 12.0 + vAngle.y * 5.0 + uTime * 0.5);
    float stria = 0.5 + 0.35 * s1 * (0.6 + 0.4 * s2);
    float pulse = 0.85 + 0.15 * sin(uTime * 1.3);

    vec3 calm = mix(uDeep, uCalm, 0.2 + 0.8 * fres) * (0.6 + 0.5 * stria) * pulse;
    float flick = 0.85 + 0.15 * sin(uTime * 7.0 + vAngle.x * 17.0 + vAngle.y * 31.0);
    vec3 hot = mix(uHot, uFlare, smoothstep(0.9, 1.0, L)) * (0.42 + 0.25 * flick) * (0.7 + 0.3 * stria);
    float heat = smoothstep(0.1, 0.75, L);
    vec3 col = mix(calm, hot, heat);

    float alpha = uOpacity * (0.05 + 0.42 * fres + 0.05 * stria) + heat * (0.07 + 0.2 * fres);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

export class PlasmaView {
  /** mesh: rzsurface.displayMesh() of the full-torus display grid. */
  constructor(mesh) {
    const n = mesh.count;
    this.map = mesh.map;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.nor, 3));
    g.setAttribute('aAngle', new THREE.BufferAttribute(mesh.ang, 2));
    this.leak = new Float32Array(n).fill(0.3);
    this.leakTarget = new Float32Array(n).fill(0.3);
    this.leakAttr = new THREE.BufferAttribute(this.leak, 1);
    this.leakAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLeak', this.leakAttr);
    g.setIndex(mesh.idx);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uGain: { value: 1 },
        uHeat: { value: 1.0 },
        uOpacity: { value: 1.0 },
        uDeep: { value: new THREE.Color(0x032a4a) },
        uCalm: { value: new THREE.Color(0x3fe6ff) },
        uHot: { value: new THREE.Color(0xff4a0a) },
        uFlare: { value: new THREE.Color(0xffe3a0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.renderOrder = 2;
  }

  /** New normal-field values from the solver (signed B·n̂/|B| per physics vertex). */
  setLeak(bn) {
    const { map, leakTarget } = this;
    for (let r = 0; r < map.length; r++) leakTarget[r] = bn[map[r]];
  }

  /** Eases the displayed values towards the latest solve so the field "flows". */
  update(time, dt) {
    this.material.uniforms.uTime.value = time;
    const k = Math.min(1, dt * 10);
    const { leak, leakTarget } = this;
    for (let r = 0; r < leak.length; r++) leak[r] += (leakTarget[r] - leak[r]) * k;
    this.leakAttr.needsUpdate = true;
  }

  setHeatmap(on) {
    this.material.uniforms.uHeat.value = on ? 1 : 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
