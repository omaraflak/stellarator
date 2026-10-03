/**
 * Diagnostic-port keep-out zones: faint translucent cylinders with static hazard bands
 * and thin rim outlines. Kept deliberately quiet (no animation, nothing bright enough to
 * bloom) so they mark space without pulling focus. A blocked port only tints red; the
 * coil segment cutting through it glows red, and that is the real signal.
 *
 * Ports that are symmetric copies of the one next to the coils being designed are drawn
 * dimmer still, the same way copied coils are.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uAlert;
  uniform float uDim;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.8);
    float band = smoothstep(0.45, 0.55, fract(vUv.x * 10.0 + vUv.y * 6.0));
    vec3 col = mix(vec3(1.0, 0.66, 0.22), vec3(1.0, 0.28, 0.3), uAlert) * 0.6;
    float a = (0.025 + 0.035 * band + 0.16 * fres) * uDim;
    gl_FragColor = vec4(col, a);
  }
`;

const AMBER = new THREE.Color(0xc98a3a);
const RED = new THREE.Color(0xd2454f);

export class PortView {
  constructor(ports) {
    this.group = new THREE.Group();
    this.items = ports.map((p) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader, fragmentShader,
        uniforms: { uAlert: { value: 0 }, uDim: { value: 1 } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.length, 40, 1, true), mat);
      // Cylinder axis is +Y; align it with the port direction and centre it.
      const dir = new THREE.Vector3(...p.dir).normalize();
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      mesh.position.set(...p.start).addScaledVector(dir, p.length / 2);
      this.group.add(mesh);

      const ringMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.4, depthWrite: false });
      for (const t of [0, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(p.radius, 0.008, 6, 64), ringMat);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        ring.position.set(...p.start).addScaledVector(dir, p.length * t);
        this.group.add(ring);
      }
      return { mat, ringMat };
    });
  }

  /** blocked: indices of ports a coil cuts through; dims: per-port brightness (1 = in focus). */
  update(blocked, dims) {
    this.items.forEach((it, i) => {
      const on = blocked.includes(i);
      const dim = dims?.[i] ?? 1;
      it.mat.uniforms.uAlert.value = on ? 1 : 0;
      it.mat.uniforms.uDim.value = dim;
      it.ringMat.color.copy(on ? RED : AMBER);
      it.ringMat.opacity = 0.4 * dim;
    });
  }

  dispose() {
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }
}
