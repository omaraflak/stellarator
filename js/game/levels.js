/**
 * Levels. Every level is a SIMSOPT stage-2 problem: a target boundary
 * (SurfaceRZFourier), a coil set (CurveXYZFourier base curves + symmetry), the
 * SquaredFlux objective on a quadrature grid, and engineering limits.
 *
 *   Tutorials  simplified "rotating ellipse" targets at 1 m scale, to learn the controls.
 *   Research   the real benchmark: Landreman–Paul precise QA with the exact settings of
 *              SIMSOPT's stage-two example. Its star thresholds come from that published
 *              run (see targets.js), so ★★★ means "as good as the published design" and
 *              the research tier means "better than it".
 *
 * The headline metric everywhere is the normalised field error ⟨|B·n̂|⟩ / ⟨|B|⟩ on the
 * scoring grid, the quantity SIMSOPT's example prints as ⟨B·n⟩ divided by ⟨B⟩.
 *
 * Tutorial star thresholds were set from each level's starting error and what Relax
 * reaches from the starting coils (Node, 300 iterations): training 0.251 → 0.114,
 * circle 0.198 → 0.065 (no Relax in either: ★★★ is set for hand-made designs),
 * twist 0.329 → 0.010, ports 0.182 (ports blocked) → 0.0054.
 */
import { rotatingEllipse } from '../physics/rzsurface.js';
import { REFERENCE_WEIGHTS } from '../physics/stage2.js';
import { LANDREMAN_PAUL_QA, REFERENCE_QA } from './targets.js';

const deg = Math.PI / 180;

/** Radial keep-out cylinders on the outboard midplane (tutorial port level). */
function radialPorts(anglesDeg, { r0, length, radius, margin }) {
  return anglesDeg.map((a, i) => ({
    name: `Port ${String.fromCharCode(65 + i)}`,
    start: [r0 * Math.cos(a * deg), r0 * Math.sin(a * deg), 0],
    dir: [Math.cos(a * deg), Math.sin(a * deg), 0],
    length, radius, margin,
  }));
}

/** Limits are met within this relative tolerance (the published design sits on them). */
export const LIMIT_TOLERANCE = 0.005;

/**
 * Tutorial objective: the reference terms plus a firm per-coil length cap and a stronger
 * curvature penalty, because the toy targets have no tight clearances to keep coils small.
 */
const TUTORIAL_WEIGHTS = { ...REFERENCE_WEIGHTS, curvature: 5e-3, lengthMax: 1 };

export const LEVELS = [
  {
    id: 'training',
    code: 'T',
    name: 'Training',
    title: 'Field Lines',
    brief:
      'Three coils sit around a gently twisted plasma. Glowing lines are traced magnetic field lines. ' +
      'Where the field pierces the surface the plasma flares orange. Bend the coils to calm it.',
    surface: rotatingEllipse({ R0: 1, a: 1 / 3, delta: 0.05, nfp: 3 }),
    scoring: { range: 'full torus', nphi: 96, ntheta: 32 },
    coils: { nbase: 3, nfp: 1, stellsym: false, order: 5, R0: 1, R1: 0.6, current: 1e5, freeCurrents: false },
    limits: { ccMin: 0.1, csMin: 0.1, kappaMax: 9, mscMax: null, lengthMax: 6 },
    weights: TUTORIAL_WEIGHTS,
    stars: [0.22, 0.17, 0.14],
    research: null,
    relax: false,
    ports: [],
    tutorial: [
      { id: 'orbit', text: 'Drag empty space to orbit the reactor. Scroll to zoom.' },
      { id: 'drag', text: 'Hover a coil, then drag one of its glowing points. Orange plasma means the field leaks through it.' },
      { id: 'smooth', text: 'Press Smooth to iron sharp bends out of your coils.' },
      { id: 'goal', text: 'Bring the field error down to earn the first star.' },
    ],
  },
  {
    id: 'circle',
    code: '01',
    name: 'Level 1',
    title: 'The Circle',
    brief:
      'Four flat, circular coils and a plasma with a slight two-period twist. ' +
      'You design one coil; symmetry copies it to the other three.',
    surface: rotatingEllipse({ R0: 1, a: 1 / 3, delta: 0.05, nfp: 2 }),
    scoring: { range: 'half period', nphi: 32, ntheta: 32 },
    coils: { nbase: 1, nfp: 2, stellsym: true, order: 5, R0: 1, R1: 0.6, current: 1e5, freeCurrents: false },
    limits: { ccMin: 0.1, csMin: 0.1, kappaMax: 9, mscMax: null, lengthMax: 6 },
    weights: TUTORIAL_WEIGHTS,
    stars: [0.16, 0.11, 0.08],
    research: null,
    relax: false,
    ports: [],
  },
  {
    id: 'twist',
    code: '02',
    name: 'Level 2',
    title: 'The Twist',
    brief:
      'Twenty modular coils around a five-period rotating ellipse, the layout of Wendelstein 7-X. ' +
      'You design 2 coil shapes. New tool: Relax runs a local optimiser on your design; ' +
      'shape the coils first, then let it polish.',
    surface: rotatingEllipse({ R0: 1, a: 1 / 3, delta: 0.1, nfp: 5 }),
    scoring: { range: 'half period', nphi: 32, ntheta: 32 },
    coils: { nbase: 2, nfp: 5, stellsym: true, order: 5, R0: 1, R1: 0.6, current: 1e5, freeCurrents: false },
    limits: { ccMin: 0.0667, csMin: 0.1, kappaMax: 9, mscMax: null, lengthMax: 6 },
    weights: TUTORIAL_WEIGHTS,
    stars: [0.1, 0.03, 0.013],
    research: null,
    relax: true,
    ports: [],
  },
  {
    id: 'ports',
    code: '03',
    name: 'Level 3',
    title: 'The Port Squeeze',
    brief:
      'You design 4 coils, one field period. Bend coil 1 around its amber keep-out cylinder; ' +
      'its copies then clear the other two ports. Relax respects the ports too.',
    surface: rotatingEllipse({ R0: 1, a: 1 / 3, delta: 0.0833, nfp: 3 }),
    scoring: { range: 'field period', nphi: 32, ntheta: 32 },
    coils: { nbase: 4, nfp: 3, stellsym: false, order: 5, R0: 1, R1: 0.6, current: 1e5, freeCurrents: false },
    limits: { ccMin: 0.0833, csMin: 0.1, kappaMax: 9, mscMax: null, lengthMax: 6 },
    weights: { ...TUTORIAL_WEIGHTS, port: 100 },
    stars: [0.05, 0.015, 0.007],
    research: null,
    relax: true,
    ports: radialPorts([15, 135, 255], { r0: 4 / 3, length: 1, radius: 0.14, margin: 0.02 }),
  },
  {
    id: 'qa',
    code: 'QA',
    name: 'Research',
    title: 'Precise QA',
    real: true,
    brief:
      'The real benchmark. Target: the precisely quasi-axisymmetric plasma of Landreman & Paul (2022), 1 m major radius. ' +
      'Coils, objective and limits are exactly those of SIMSOPT\'s stage-two example, so your design is a real stage-2 solution. ' +
      '★★★ matches the published design; the research tier beats it with no more coil.',
    surface: LANDREMAN_PAUL_QA,
    scoring: { range: 'half period', nphi: 32, ntheta: 32 },
    coils: { nbase: 4, nfp: 2, stellsym: true, order: 5, R0: 1, R1: 0.5, current: 1e5, freeCurrents: true },
    limits: { ccMin: 0.1, csMin: 0.3, kappaMax: 5, mscMax: 5 },
    weights: REFERENCE_WEIGHTS,
    // 1 %, then SIMSOPT's first-round result, then the published design (rounded up to the
    // displayed precision so the published design itself earns ★★★).
    stars: [1e-2, 1.391e-3, 4.41e-4],
    // Beat the published field error by ≥ 5 % within the same limits and no more total coil length.
    research: { fieldError: 0.95 * REFERENCE_QA.fieldError, maxLength: REFERENCE_QA.totalLength },
    reference: REFERENCE_QA,
    relax: true,
    ports: [],
  },
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) ?? null;
}
