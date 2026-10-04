/**
 * Levels. Every level is a SIMSOPT stage-2 problem: a target boundary
 * (SurfaceRZFourier), a coil set (CurveXYZFourier base curves + symmetry), the
 * SquaredFlux objective on a quadrature grid, and engineering limits.
 *
 *   tutorial  simplified "rotating ellipse" targets at 1 m scale, to learn the controls.
 *   practice  Level 04: the real Landreman–Paul precise QA plasma with the settings of
 *             SIMSOPT's stage-two example (a tutorial script). ★★★ means "as good as
 *             SIMSOPT's own reference run" (see targets.js).
 *   record    the research benchmark of Wechsung et al., PNAS 2022, for the same plasma,
 *             at four total-coil-length budgets. ★★★ means "within 2 % of the best
 *             published design"; ✦ means "beat it", checked as described in scoring.js.
 *
 * The headline metric everywhere is the normalised field error ⟨|B·n̂|⟩ / ⟨|B|⟩ on the
 * scoring grid, the quantity SIMSOPT prints as ⟨B·n⟩ divided by ⟨B⟩.
 *
 * Tutorial star thresholds were set from each level's starting error and what Relax
 * reaches from the starting coils (Node, 300 iterations): training 0.251 → 0.114,
 * circle 0.198 → 0.065 (no Relax in either: ★★★ is set for hand-made designs),
 * twist 0.329 → 0.010, ports 0.182 (ports blocked) → 0.0054.
 */
import { rotatingEllipse } from '../physics/rzsurface.js';
import { REFERENCE_WEIGHTS } from '../physics/stage2.js';
import { LANDREMAN_PAUL_QA, REFERENCE_QA, PNAS_QA_RECORDS } from './targets.js';

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

/** Limits are met within this relative tolerance (SIMSOPT's reference run sits on them). */
export const LIMIT_TOLERANCE = 0.005;

/** Where the real plasma comes from (shown in exports). */
const LP_QA_SOURCE = 'SIMSOPT tests/test_files/input.LandremanPaul2021_QA (Landreman & Paul, PRL 128, 035001, 2022)';
const PNAS_SOURCE = 'Wechsung, Landreman, Giuliani, Cerfon & Stadler, PNAS 119, e2202084119 (2022)';

/**
 * Starting penalty weights for the record levels' Relax. Relax raises a weight 3× after
 * any round that ends with its limit broken by more than 0.1 %, as the paper's optimiser
 * did (Wechsung et al.'s driver.py), and lowers the small linear length weight 100×.
 */
const RECORD_WEIGHTS = { length: 1e-5, cc: 1e4, cs: 0, curvature: 1e-5, msc: 1e-3, lengthTotal: 1e-2, arclength: 1e-7 };

/** A record level: the PNAS 2022 formulation at one total-coil-length budget. */
function recordLevel(budget) {
  const rec = PNAS_QA_RECORDS[budget];
  return {
    id: `record-${budget}`,
    code: `R${budget}`,
    kind: 'record',
    name: 'Research record',
    title: `Precise QA · ${budget} m`,
    brief:
      `The research version of Level 04: the coil setup of Wechsung et al. (PNAS 2022), the best published coils for this plasma. ` +
      `Smoother coils (Fourier order 16), all four coils together at most ${budget} m long, and the paper's objective. ` +
      `Their design reaches ${(rec.fieldError * 100).toPrecision(3)} % field error. Get within 2 % of it for ★★★; beat it for ✦. ` +
      'Relax runs the same schedule as the paper\'s optimiser; from the starting coils it needs several minutes, and each press continues where the last one stopped.',
    surface: LANDREMAN_PAUL_QA,
    plasmaSource: LP_QA_SOURCE,
    scoring: { range: 'half period', nphi: 32, ntheta: 32 },
    flux: 'local',
    coils: { nbase: 4, nfp: 2, stellsym: true, order: 16, quadpoints: 160, R0: 1.1, R1: 0.6, current: 1e5, freeCurrents: true, currentScale: 1e5 },
    limits: { ccMin: 0.1, kappaMax: 5, mscMax: 5, totalLengthMax: budget, tol: 0.001 },
    weights: RECORD_WEIGHTS,
    continuation: true,
    // 3×, 1.5× and within 2 % of the published field error.
    stars: [3, 1.5, 1.02].map((f) => f * rec.fieldError),
    record: { budget, source: PNAS_SOURCE, cite: 'Wechsung et al., PNAS 2022', ...rec },
    relax: true,
    ports: [],
  };
}

/**
 * Tutorial objective: the reference terms plus a firm per-coil length cap and a stronger
 * curvature penalty, because the toy targets have no tight clearances to keep coils small.
 */
const TUTORIAL_WEIGHTS = { ...REFERENCE_WEIGHTS, curvature: 5e-3, lengthMax: 1 };

export const LEVELS = [
  {
    id: 'training',
    kind: 'tutorial',
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
    kind: 'tutorial',
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
    relax: false,
    ports: [],
  },
  {
    id: 'twist',
    kind: 'tutorial',
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
    relax: true,
    ports: [],
  },
  {
    id: 'ports',
    kind: 'tutorial',
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
    relax: true,
    ports: radialPorts([15, 135, 255], { r0: 4 / 3, length: 1, radius: 0.14, margin: 0.02 }),
  },
  {
    id: 'qa',
    code: '04',
    kind: 'practice',
    name: 'Level 4',
    title: 'Precise QA',
    brief:
      'The real plasma: the precisely quasi-axisymmetric shape of Landreman & Paul (2022), 1 m major radius. ' +
      'Coils, objective and limits follow SIMSOPT\'s stage-two example, a tutorial script, so ★★★ means you matched SIMSOPT\'s own run of it. ' +
      'The record levels after this one use the full research setup.',
    surface: LANDREMAN_PAUL_QA,
    plasmaSource: LP_QA_SOURCE,
    scoring: { range: 'half period', nphi: 32, ntheta: 32 },
    coils: { nbase: 4, nfp: 2, stellsym: true, order: 5, R0: 1, R1: 0.5, current: 1e5, freeCurrents: true },
    limits: { ccMin: 0.1, csMin: 0.3, kappaMax: 5, mscMax: 5 },
    weights: REFERENCE_WEIGHTS,
    // 1 %, then SIMSOPT's first-round result, then its final result (rounded up to the
    // displayed precision so the reference run itself earns ★★★).
    stars: [1e-2, 1.391e-3, 4.41e-4],
    reference: REFERENCE_QA,
    relax: true,
    ports: [],
  },
  ...[18, 20, 22, 24].map(recordLevel),
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) ?? null;
}

/** Short label for a level: "Training", "Level 02", "Research record". */
export function levelCode(level) {
  if (level.kind === 'record') return 'Research record';
  return level.code === 'T' ? 'Training' : `Level ${level.code}`;
}

/** Full name: "Level 02 · The Twist", "Research record · Precise QA · 18 m". */
export const levelName = (level) => `${levelCode(level)} · ${level.title}`;
