/**
 * Stage: renderer, camera, orbit controls, bloom post-processing and the backdrop.
 * The physics uses z-up coordinates, so the camera does too.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.id = 'stage-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03060c);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 300);
  camera.up.set(0, 0, 1);
  camera.position.set(0.13, -3.6, 2.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.minDistance = 0.8;
  controls.maxDistance = 12;
  controls.target.set(0, 0, 0);
  // Left = rotate, right = pan, wheel = zoom (OrbitControls defaults, stated for clarity).
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.45);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  addBackdrop(scene);

  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  return { renderer, scene, camera, controls, composer, bloom, resize };
}

/** Star field and a faint polar floor grid under the machine. */
function addBackdrop(scene) {
  const n = 1800;
  const pos = new Float32Array(3 * n);
  const col = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 60;
    const s = Math.sqrt(1 - u * u);
    pos[3 * i] = r * s * Math.cos(a); pos[3 * i + 1] = r * s * Math.sin(a); pos[3 * i + 2] = r * u;
    const b = 0.35 + Math.random() * 0.65;
    col[3 * i] = 0.6 * b; col[3 * i + 1] = 0.72 * b; col[3 * i + 2] = 0.95 * b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
  scene.add(stars);

  const grid = new THREE.PolarGridHelper(2.7, 24, 8, 128, 0x1a3350, 0x0e1c2e);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -0.9;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  grid.material.depthWrite = false;
  scene.add(grid);
}
