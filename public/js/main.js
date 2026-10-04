/**
 * Stellarator: game controller.
 *
 * Every level is a SIMSOPT stage-2 problem (see game/levels.js). The player's design is
 * SIMSOPT's own degree-of-freedom vector: Fourier coefficients of the base coils plus
 * their currents. Data flow for every edit:
 *
 *   drag / tool / Relax → Design (DOFs) → CoilSet (base curves + symmetric copies)
 *     → tubes and handles redrawn on the main thread
 *     → field worker: heatmap on the plasma, exact stage-2 metrics, limit alerts
 *     → judge (stars; on record levels, the ✦ check) → HUD
 *     → (once the design settles) tracer worker: field lines + Poincaré section
 *
 * Interaction is direct manipulation: hover a coil to show its handles, drag a handle to
 * bend the coil, drag a selected coil to move it, drag empty space to orbit. Drags move
 * in the plane facing the camera, so the handle stays under the cursor (Shift: fine).
 */
import * as THREE from 'three';
import { createStage } from './render/stage.js';
import { PlasmaView } from './render/plasma.js';
import { CoilView } from './render/coils.js';
import { FieldLinesView } from './render/fieldlines.js';
import { Sparks } from './render/sparks.js';
import { PortView } from './render/ports.js';
import { makeSurface, quadGrid, displayMesh } from './physics/rzsurface.js';
import { CoilSet } from './physics/coilset.js';
import { coilSpec } from './game/problem.js';
import { PhysicsEngine, Relaxer, Tracer } from './physics/engine.js';
import { LEVELS, levelById, levelCode, levelName, LIMIT_TOLERANCE } from './game/levels.js';
import { Design, HANDLES } from './game/design.js';
import { judge, passesFineCheck, pct, RECORD_MARGIN } from './game/scoring.js';
import { buildExport, parseImport } from './game/export.js';
import { scoreboard } from './game/leaderboard.js';
import { SHOWCASE_QA } from './game/showcase.js';
import { Hud } from './ui/hud.js';
import { PoincarePanel } from './ui/poincare.js';

/* ------------------------------------------------------------------ storage */
const STORE = {
  progress: 'stellarator:progress:v1',
  last: 'stellarator:last:v1',
  design: (key) => `stellarator:design:v1:${key}`,
};
const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
};

/* ------------------------------------------------------------------ setup */
const hud = new Hud();
let stage;
try {
  stage = createStage(document.getElementById('stage'));
} catch (err) {
  showFatal('This game needs WebGL, and the browser could not start it. Close and reopen the tab (or the browser), and check that hardware acceleration is turned on.', err);
  throw err;
}
const { scene, camera, controls, renderer } = stage;
const canvas = renderer.domElement;
const engine = new PhysicsEngine();
const relaxer = new Relaxer();
const tracer = new Tracer();
const poincare = new PoincarePanel(document.getElementById('poincare'), document.getElementById('poincare-status'));

/** Display grid for the plasma heatmap (full torus). */
const DISPLAY = { nphi: 128, ntheta: 40 };
/** Tube samples per coil. */
const NR = 160;
/** Field-line tracing for the Poincaré section. */
const TRACE = { lines: 8, transits: 40 };
/** Iterations per press of Relax (it can be stopped at any time); record levels run longer. */
const RELAX_ITERS = 400;
const RELAX_ITERS_RECORD = 2000;
/** Largest displacement a single drag can make (m) and the Shift slow-down factor. */
const MAX_DRAG = 0.5;
const FINE = 0.2;

const S = {
  level: null, design: null, cs: null, surface: null, dispGrid: null,
  K: 0, nbase: 0,
  render: null, handles: null, alert: null,
  result: null, metrics: null, verdict: null, lastStars: -1, lastResearch: false,
  views: null,
  sel: -1, hover: { coil: -1, point: -1 },
  linked: false, showAll: false, portDims: [],
  dragging: false, dragId: 0, relaxing: false, relaxState: null,
  check: null, lastBeat: false, // record levels: the ✦ check of the current design
  attract: false, // title screen: a showcase design in the background, nothing saved or scored
  toggles: { lines: true, heat: true, sparks: true },
  tutorial: new Set(),
  runId: '', levelKey: '', fps: 60, loading: false,
  traceTimer: 0, traceLines: [],
};

const baseOf = (c) => S.cs.ops[c].base;
const label = (b) => b + 1;
const on = (id, ev, fn) => document.getElementById(id).addEventListener(ev, fn);

/* ------------------------------------------------------------------ levels */

function disposeViews() {
  if (!S.views) return;
  const v = S.views;
  scene.remove(v.plasma.mesh, v.coils.group, v.lines.group, v.sparks.points);
  v.plasma.dispose(); v.coils.dispose(); v.lines.dispose(); v.sparks.dispose();
  if (v.ports) { scene.remove(v.ports.group); v.ports.dispose(); }
  S.views = null;
}

async function loadLevel(level, opts = {}) {
  if (S.loading) return;
  S.loading = true;
  try {
    gesture = null;
    relaxer.stop();
    tracer.cancel();
    clearTimeout(S.traceTimer);
    S.relaxing = false;
    S.relaxState = null;
    S.check = null;
    S.lastBeat = false;
    S.sel = -1;
    S.hover = { coil: -1, point: -1 };
    S.linked = false;
    hud.setLinked(false);
    disposeViews();
    S.attract = !!opts.attract;
    S.level = level;
    S.levelKey = level.id;
    S.design = new Design(level);
    const saved = opts.design ?? (S.attract ? null : load(STORE.design(S.levelKey), null));
    if (saved?.dofs?.length === S.design.dofs.length && saved?.currents?.length === S.design.currents.length
      && saved.dofs.every(Number.isFinite) && saved.currents.every(Number.isFinite)) {
      S.design.dofs.set(saved.dofs);
      S.design.currents.set(saved.currents);
    }
    const c = level.coils;
    S.cs = new CoilSet(coilSpec(level), S.design.dofs, S.design.currents);
    S.K = S.cs.ncoils;
    S.nbase = c.nbase;
    S.render = { pts: new Float64Array(3 * S.K * NR), kappa: new Float64Array(S.K * NR) };
    S.handles = new Float32Array(3 * S.nbase * HANDLES);
    S.alert = new Uint8Array(S.K * NR);
    S.result = null; S.metrics = null; S.verdict = null; S.lastStars = -1; S.lastResearch = false;
    S.tutorial = new Set();
    S.runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    S.surface = makeSurface(level.surface);
    S.dispGrid = quadGrid(S.surface, 'full torus', DISPLAY.nphi, DISPLAY.ntheta);
    await engine.init(level, DISPLAY, LIMIT_TOLERANCE);

    const views = {
      plasma: new PlasmaView(displayMesh(S.surface, S.dispGrid)),
      coils: new CoilView(S.K, S.nbase, HANDLES, NR, { tube: 0.018, handle: 0.026 }),
      lines: new FieldLinesView(),
      sparks: new Sparks(S.dispGrid),
      ports: level.ports.length ? new PortView(level.ports) : null,
    };
    S.views = views;
    scene.add(views.plasma.mesh, views.coils.group, views.lines.group, views.sparks.points);
    if (views.ports) scene.add(views.ports.group);
    applyToggles();
    views.coils.setOrbitColors(S.cs.ops.map((op) => op.base));
    updateCopies();
    refreshGeometry();
    refreshCoilStyles();

    hud.setLevel(level);
    hud.setHistory(false, false);
    hud.setRelaxing(false, level.relax);
    poincare.start({ boundary: null }, TRACE.lines);
    updateNextButton();
    if (!S.attract) save(STORE.last, { id: level.id });
    focusCamera();
  } finally {
    S.loading = false;
  }
  requestEval(null, false);
  updateHint();
  updateCoilChip();
}

/** Copies (coils generated by symmetry) are drawn faintly unless "Show all coils" is on (or on the title). */
function updateCopies() {
  const ghosts = new Set();
  if (!S.showAll && !S.attract) for (let c = S.nbase; c < S.K; c++) ghosts.add(c);
  S.views.coils.setGhosts(ghosts);
  document.getElementById('row-copies').hidden = S.K === S.nbase;
  document.getElementById('tg-copies').checked = S.showAll;
  // Ports inside the sector the base coils cover stay in focus; ports by copied coils are dimmed.
  const c = S.level.coils, sector = (2 * Math.PI) / (c.nfp * (c.stellsym ? 2 : 1));
  S.portDims = S.level.ports.map((p) => {
    const ph = (Math.atan2(p.dir[1], p.dir[0]) + 2 * Math.PI) % (2 * Math.PI);
    return S.showAll || S.K === S.nbase || ph < sector ? 1 : 0.35;
  });
  S.views.ports?.update(S.metrics?.portsBlocked ?? [], S.portDims);
}

/** Frames the coils the player designs: a 3/4 view of their sector, or the whole machine. */
function focusCamera() {
  const R0 = S.level.surface.rc[0][S.level.surface.ntor];
  if (S.nbase >= S.K) {
    camera.position.set(0.13 * R0, -3.6 * R0, 2.2 * R0);
    controls.target.set(0, 0, 0);
  } else {
    let sx = 0, sy = 0;
    for (let b = 0; b < S.nbase; b++) { sx += Math.cos(S.design.angle(b)); sy += Math.sin(S.design.angle(b)); }
    const phi = Math.atan2(sy, sx), r = 0.4 * R0;
    const az = phi - 0.6, el = 0.55, dist = 4.4 * R0;
    controls.target.set(r * Math.cos(phi), r * Math.sin(phi), 0);
    camera.position.set(controls.target.x + dist * Math.cos(el) * Math.cos(az), controls.target.y + dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el));
  }
  controls.update();
}

/* ------------------------------------------------------------------ geometry pipeline */
const _p = new Float64Array(3 * NR), _k = new Float64Array(NR);

/** Re-samples the given base coils (default: all) and their copies; redraws tubes and handles. */
function refreshGeometry(bases = null) {
  const { cs, design, render } = S;
  cs.dofs.set(design.dofs);
  cs.currents.set(design.currents);
  const list = bases ?? [...Array(S.nbase).keys()];
  cs.update(list);
  const kmax = S.level.limits.kappaMax;
  for (const b of list) {
    cs.sampleBase(b, NR, _p, _k);
    for (let j = 0; j < HANDLES; j++) S.handles.set(design.handle(b, j), 3 * (b * HANDLES + j));
    for (const c of cs.coilsOf(b)) {
      const M = cs.ops[c].M, o = 3 * c * NR;
      for (let i = 0; i < NR; i++) {
        const x = _p[3 * i], y = _p[3 * i + 1], z = _p[3 * i + 2];
        render.pts[o + 3 * i] = M[0] * x + M[1] * y + M[2] * z;
        render.pts[o + 3 * i + 1] = M[3] * x + M[4] * y + M[5] * z;
        render.pts[o + 3 * i + 2] = M[6] * x + M[7] * y + M[8] * z;
        render.kappa[c * NR + i] = _k[i];
      }
      S.views.coils.updateCoil(c, render.pts, render.kappa, kmax, S.alert);
    }
  }
  S.views.coils.updatePoints(S.handles);
}

function requestEval(moving, fast) {
  engine.evaluate({
    dofs: Float64Array.from(S.design.dofs), currents: Float64Array.from(S.design.currents),
    moving, fast, dragId: S.dragId,
  });
}

function onDesignChanged(touched, fast) {
  refreshGeometry([...touched]);
  requestEval([...touched], fast);
  markTraceStale();
  updateCoilChip();
}

engine.onResult = (r) => {
  if (!S.views || S.loading) return;
  S.result = r;
  S.metrics = r.metrics;
  S.views.plasma.setLeak(r.bn);
  S.views.sparks.setField(r.bn);
  // Per-quadrature-point alerts → tube samples.
  const nq = S.cs.nq;
  for (let c = 0; c < S.K; c++) {
    let changed = false;
    for (let i = 0; i < NR; i++) {
      const a = r.alerts[c * nq + Math.floor((i * nq) / NR)];
      if (S.alert[c * NR + i] !== a) { S.alert[c * NR + i] = a; changed = true; }
    }
    if (changed) S.views.coils.updateFlags(c, S.render.kappa, S.level.limits.kappaMax, S.alert);
  }
  S.verdict = judge(S.level, S.metrics, baseOf);
  if (S.check?.passed && S.check.key === designKey()) S.verdict.beat = true;
  hud.setMetrics(S.level, S.metrics, S.verdict, statusInfo(), alertsFor(S.verdict));
  S.views.ports?.update(S.metrics.portsBlocked, S.portDims);
  if (!r.fast && !S.dragging && !S.relaxing) onFullResult();
};

function statusInfo() {
  return {
    backend: engine.backend, ms: S.result?.ms, mode: S.result?.mode, fps: S.fps,
    currents: S.level?.coils.freeCurrents ? Array.from(S.design.currents) : null,
    checking: !!(S.check && !S.check.done),
  };
}

/** Broken limits in plain words, naming the coils the player designs. */
function alertsFor(v) {
  const f2 = (x) => x.toFixed(2), f3 = (x) => x.toFixed(3);
  return v.broken.map((b) => {
    const [a, c] = b.coils;
    switch (b.kind) {
      case 'cc': return a === c
        ? `Coil ${label(a)} is too close to one of its copies (${f3(b.value)} m, need ≥ ${b.limit} m).`
        : `Coils ${label(Math.min(a, c))} and ${label(Math.max(a, c))} are too close (${f3(b.value)} m, need ≥ ${b.limit} m).`;
      case 'cs': return `Coil ${label(a)} is too close to the plasma (${f3(b.value)} m, need ≥ ${b.limit} m).`;
      case 'kappa': return `Coil ${label(a)} bends too sharply (${f2(b.value)} /m, limit ${b.limit}). Try Smooth.`;
      case 'msc': return `Coil ${label(a)} is too wiggly overall (mean-square curvature ${f2(b.value)}, limit ${b.limit}). Try Smooth.`;
      case 'length': return `Coil ${label(a)} is too long (${f2(b.value)} m, limit ${b.limit} m).`;
      case 'budget': return `All coils together are too long (${f2(b.value)} m, budget ${b.limit} m).`;
      case 'port': return `${S.level.ports[b.port].name} is blocked by a coil.`;
      default: return 'An engineering limit is broken.';
    }
  });
}

/** After an exact solve of a settled design: stars, saved runs, progress, tracing, record check. */
function onFullResult() {
  if (S.attract) { scheduleTrace(); return; }
  const v = S.verdict, m = S.metrics;
  const earned = S.lastStars >= 0 && v.stars > S.lastStars;
  S.lastStars = v.stars;
  if (v.stars >= 1) markTutorial('goal');
  if (v.valid) saveRun(v, m);
  save(STORE.design(S.levelKey), { dofs: Array.from(S.design.dofs), currents: Array.from(S.design.currents) });
  hud.setHistory(S.design.undoStack.length > 0, S.design.redoStack.length > 0);
  updateNextButton();
  if (v.candidate) startRecordCheck();
  else S.check = null;
  scheduleTrace();
  if (earned) showComplete();
}

function saveRun(v, m) {
  scoreboard.record({
    run: S.runId, level: S.level.id, score: v.score, stars: v.stars, beat: v.beat,
    fieldError: m.fieldError, length: m.totalLength, ccMin: m.ccMin, csMin: m.csMin,
    dofs: Array.from(S.design.dofs), currents: Array.from(S.design.currents), savedAt: new Date().toISOString(),
  });
  const progress = load(STORE.progress, {});
  const p = progress[S.level.id] ?? { stars: 0, beat: false, best: null };
  if (v.stars > p.stars || (v.beat && !p.beat) || p.best == null || m.fieldError < p.best) {
    progress[S.level.id] = { stars: Math.max(p.stars, v.stars), beat: p.beat || v.beat, best: Math.min(p.best ?? Infinity, m.fieldError) };
    save(STORE.progress, progress);
  }
}

/* ------------------------------------------------------------------ record check */
// On a record level, a design that beats the published record on the scoring grid is only
// a candidate. It earns ✦ after two more checks of that exact design: the fine check
// (a 256 × 64 full-torus grid and 4 × the coil quadrature, in the field worker) and
// field-line tracing with every traced line staying inside the plasma.
const designKey = () => `${S.level.id}|${S.design.dofs.join(',')}|${S.design.currents.join(',')}`;

function startRecordCheck() {
  const key = designKey();
  if (S.check?.key === key) return;
  S.check = { key, fine: null, lost: null, done: false, passed: false };
  engine.verify(Float64Array.from(S.design.dofs), Float64Array.from(S.design.currents)).then((fine) => {
    if (S.check?.key !== key) return;
    S.check.fine = fine;
    finishRecordCheck();
  });
}

function finishRecordCheck() {
  const c = S.check;
  if (!c || c.done || !c.fine || c.lost == null) return;
  c.done = true;
  const rec = S.level.record;
  if (!passesFineCheck(S.level, c.fine)) {
    hud.toast(`Close: on the fine check this design gives ${pct(c.fine.fieldError)}, the record ${pct(rec.fine.fieldError)}. Not a new record yet.`, '', 5000);
  } else if (c.lost > 0) {
    hud.toast(`${c.lost} traced field line${c.lost > 1 ? 's leave' : ' leaves'} the plasma, so this design can't count as a record.`, '', 5000);
  } else {
    c.passed = true;
    S.verdict.beat = true;
    saveRun(S.verdict, S.metrics);
    if (!S.lastBeat) { S.lastBeat = true; showComplete(); }
  }
  hud.setMetrics(S.level, S.metrics, S.verdict, statusInfo(), alertsFor(S.verdict));
}

/* ------------------------------------------------------------------ tracing */
function markTraceStale() {
  clearTimeout(S.traceTimer);
  tracer.cancel();
  S.views?.lines.setStale(true);
  poincare.stale();
}

function scheduleTrace() {
  markTraceStale();
  S.traceTimer = setTimeout(() => {
    if (!S.views || S.dragging || S.relaxing) return;
    S.traceLines = [];
    const key = S.level.record ? designKey() : null;
    tracer.trace(S.level, Float64Array.from(S.design.dofs), Float64Array.from(S.design.currents), TRACE, {
      start: (m) => poincare.start(m, TRACE.lines),
      line: (m) => { poincare.add(m); S.traceLines[m.index] = { pts: m.pts3d, lost: m.lostAt >= 0 }; },
      done: () => {
        S.views?.lines.setLines(S.traceLines.filter(Boolean));
        poincare.done();
        if (key && S.check?.key === key) { S.check.lost = S.traceLines.filter((l) => l?.lost).length; finishRecordCheck(); }
      },
    }).catch((err) => console.warn('[trace]', err));
  }, 450);
}

/* ------------------------------------------------------------------ level flow */
function nextLevelAfter(level) {
  if (level.kind === 'record') return null; // the four budgets are side by side, not a sequence
  const i = LEVELS.findIndex((l) => l.id === level.id);
  return LEVELS[i + 1] ?? null;
}

function updateNextButton() {
  const btn = document.getElementById('btn-next');
  const stars = load(STORE.progress, {})[S.level?.id]?.stars ?? 0;
  const next = S.level && nextLevelAfter(S.level);
  btn.hidden = !(stars >= 1 && next);
  if (next) btn.textContent = `Next: ${next.title} →`;
}

function showComplete() {
  const v = S.verdict, m = S.metrics, level = S.level, rec = level.record;
  const next = nextLevelAfter(level);
  document.getElementById('complete-code').textContent = levelName(level);
  document.getElementById('complete-title').textContent = v.beat ? 'New record'
    : v.stars === 3 ? (rec ? 'Record matched' : 'Level mastered') : v.stars === 2 ? 'Two stars' : 'Level complete';
  document.getElementById('complete-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < v.stars ? 'on' : ''}">★</span>`).join('')
    + (rec ? `<span class="research${v.beat ? ' on' : ''}">✦</span>` : '');
  document.getElementById('complete-stats').textContent = `field error ${pct(m.fieldError)} · ${m.totalLength.toFixed(2)} m of coil · score ${v.score.toLocaleString('en-US')}`;
  let note;
  if (v.beat) {
    note = `Your coils beat the best published design for this budget (${rec.cite}: ${pct(rec.fieldError)}) under the same rules, and passed the fine-grid and field-line checks. ` +
      'Export the JSON from the More menu to check it in SIMSOPT. ';
  } else if (v.stars < 3) note = `Reach ${pct(level.stars[v.stars])} for the next star, or move on. `;
  else if (rec) note = `Within 2 % of the published record. ✦ needs at most ${pct((1 - RECORD_MARGIN) * rec.fieldError)}, confirmed by the fine checks. `;
  else note = '';
  document.getElementById('complete-note').textContent = `${note}Saved to your best runs.`;
  const go = document.getElementById('complete-next');
  go.textContent = next ? `Next: ${next.title} →` : 'Back to the levels';
  openOverlay('complete');
  go.focus();
}

/** Fades to black showing a caption, runs `work`, then fades back in. */
async function transition(code, title, work) {
  const fade = document.getElementById('fade');
  closeOverlays();
  document.getElementById('fade-code').textContent = code;
  document.getElementById('fade-title').textContent = title;
  fade.hidden = false;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  fade.classList.add('in');
  await new Promise((r) => setTimeout(r, 420));
  try {
    await work();
  } finally {
    await new Promise((r) => setTimeout(r, 500));
    fade.classList.remove('in');
    setTimeout(() => { fade.hidden = true; }, 420);
  }
}

async function goToLevel(level) {
  if (S.loading) return;
  await transition(levelCode(level), level.title, async () => {
    leaveTitle();
    await loadLevel(level);
  });
  openOverlay('briefing');
}

function goToNextLevel() {
  const next = S.level && nextLevelAfter(S.level);
  if (next) goToLevel(next).catch(reportError);
  else openMenu();
}

/* ------------------------------------------------------------------ title screen */
// Behind the menu: the showcase ★★★ coil set for Precise QA, seen by a slowly circling
// camera (fly-in on arrival). The machine is shifted right so the menu has room.
const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const titleItems = [...titleEl.querySelectorAll('.title-item')];
const titleCam = { t: 0 };

/** Where Play / Continue goes: the last level played, else Training. */
const playLevel = () => levelFrom(load(STORE.last, null)) ?? LEVELS[0];

function fillTitle() {
  const last = levelFrom(load(STORE.last, null));
  document.getElementById('ti-play-label').textContent = last ? 'Continue' : 'Play';
  document.getElementById('ti-play-sub').textContent = last ? levelName(last) : 'Start with the training level';
  const { stars, max, beat } = progressSummary();
  document.getElementById('ti-levels-sub').textContent = stars || beat
    ? `★ ${stars} / ${max} earned${beat ? ` · ✦ ${beat}` : ''}`
    : 'From training to the published research records';
  document.getElementById('title-caption').textContent = `Behind the menu: a ★★★ coil set for the Precise QA plasma · field error ${pct(SHOWCASE_QA.fieldError)}`;
}

function progressSummary() {
  const progress = load(STORE.progress, {});
  let stars = 0, max = 0, beat = 0;
  for (const l of LEVELS) {
    if (!l.stars) continue;
    max += 3;
    stars += Math.min(3, progress[l.id]?.stars ?? 0);
    if (progress[l.id]?.beat) beat++;
  }
  return { stars, max, beat, records: LEVELS.filter((l) => l.record).length };
}

function setTitleActive(i) {
  titleItems.forEach((b, k) => b.classList.toggle('is-active', k === i));
  titleItems[i]?.focus({ preventScroll: true });
}

function enterTitle() {
  titleCam.t = 0;
  controls.enabled = false;
  stopCameraInertia();
  fillTitle();
  app.classList.add('is-title');
  titleEl.hidden = false;
  titleEl.classList.remove('show');
  void titleEl.offsetWidth; // restart the entrance animation
  titleEl.classList.add('show');
  setTitleActive(0);
}

function leaveTitle() {
  if (titleEl.hidden) return;
  app.classList.remove('is-title');
  titleEl.hidden = true;
  controls.enabled = true;
  camera.clearViewOffset();
}

/** Loads the showcase scene and shows the title (with a fade when coming from a level). */
async function showTitle() {
  if (S.loading) return;
  await transition('', 'Stellarator', async () => {
    await loadLevel(levelById('qa'), { design: SHOWCASE_QA, attract: true });
    enterTitle();
  });
}

function updateTitleCamera(dt) {
  titleCam.t += dt;
  const t = titleCam.t, k = 1 - (1 - Math.min(1, t / 3.4)) ** 3; // ease-out fly-in
  const r = 11.5 + (6 - 11.5) * k, el = 1.0 + (0.52 - 1.0) * k, az = -2.6 + 0.7 * k + 0.045 * t;
  camera.position.set(r * Math.cos(el) * Math.cos(az), r * Math.cos(el) * Math.sin(az), r * Math.sin(el));
  camera.lookAt(0, 0, 0);
  const W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
  camera.setViewOffset(W, H, -0.2 * W, 0.02 * H, W, H);
}

titleItems.forEach((b, i) => b.addEventListener('pointerenter', () => setTitleActive(i)));
on('ti-play', 'click', () => goToLevel(playLevel()).catch(reportError));
on('ti-levels', 'click', () => openMenu());
on('ti-how', 'click', () => openOverlay('howto'));
on('how-play', 'click', () => (S.attract ? goToLevel(playLevel()).catch(reportError) : closeOverlays()));
on('menu-main', 'click', () => showTitle().catch(reportError));

/* ------------------------------------------------------------------ selection & styling */
function followersOf(k) {
  if (k < 0) return [];
  const out = [];
  for (let c = 0; c < S.K; c++) if (c !== k && (S.linked || baseOf(c) === k)) out.push(c);
  return out;
}

function refreshCoilStyles() {
  if (!S.views) return;
  S.views.coils.setState({
    selected: S.sel,
    hovered: S.hover.coil,
    hoverPoint: S.hover.point,
    dragPoint: gesture?.kind === 'drag' && gesture.j >= 0 ? [gesture.k, gesture.j] : null,
    followers: followersOf(S.sel),
  });
}

function selectCoil(k) {
  S.sel = k;
  refreshCoilStyles();
  updateHint();
  updateCoilChip();
}

function clearSelection() {
  S.sel = -1;
  refreshCoilStyles();
  updateHint();
  updateCoilChip();
}

function updateHint() {
  if (!S.level) return;
  if (S.relaxing) { hud.setHint('Relax is optimising your design. Press Stop to keep the current coils.'); return; }
  const tut = S.level.tutorial;
  if (tut) {
    const i = tut.findIndex((s) => !S.tutorial.has(s.id));
    if (i >= 0) { hud.setHint(tut[i].text, `Step ${i + 1}/${tut.length}`); return; }
  }
  if (gesture?.kind === 'drag') { hud.setHint('Hold Shift for fine control.'); return; }
  const linked = S.linked ? ' Every coil follows.' : '';
  const copies = S.nbase < S.K && !S.showAll ? ' Faint coils are symmetric copies.' : '';
  if (S.sel >= 0) {
    const cur = S.level.coils.freeCurrents ? ' Its current is set below.' : '';
    hud.setHint(`Coil ${label(S.sel)}: drag a glowing point to bend it, or drag the coil to move it.${cur}${linked}`);
  } else hud.setHint(`Hover a coil and drag one of its glowing points.${copies}${linked}${S.level.relax ? ' Relax polishes your design.' : ''}`);
}

function markTutorial(step) {
  if (!S.level?.tutorial || S.tutorial.has(step)) return;
  S.tutorial.add(step);
  updateHint();
}

/** Current control for the selected coil (Level 04 and the records: currents are free, coil 1 is the fixed reference). */
function updateCoilChip() {
  const chip = document.getElementById('coilchip');
  const show = !!S.level?.coils.freeCurrents && S.sel >= 0;
  chip.hidden = !show;
  if (!show) return;
  const fixed = S.sel === 0;
  document.getElementById('coilchip-name').textContent = `Coil ${label(S.sel)} current${fixed ? ' (fixed reference)' : ''}`;
  document.getElementById('coilchip-value').textContent = `${(S.design.currents[S.sel] / 1000).toFixed(2)} kA`;
  document.getElementById('cur-up').disabled = fixed;
  document.getElementById('cur-down').disabled = fixed;
}

let lastCurrentEdit = 0;
function nudgeCurrent(sign, fine) {
  if (S.sel <= 0 || !S.level.coils.freeCurrents) return;
  stopRelax();
  const now = performance.now();
  if (now - lastCurrentEdit > 700) S.design.checkpoint();
  lastCurrentEdit = now;
  S.design.setCurrent(S.sel, S.design.currents[S.sel] * (1 + sign * (fine ? 0.001 : 0.01)));
  onDesignChanged(new Set([S.sel]), false);
  hud.setHistory(true, false);
}

/* ------------------------------------------------------------------ picking */
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/**
 * Screen-space picking among the coils the player designs (the base curves are coils
 * 0…nbase−1): the nearest coil within `radius` px of its drawn centreline, and the
 * nearest handle on that coil, the selected coil or the hovered one.
 * Returns { coil, point } (point −1 for the tube) or null.
 */
function pick(cx, cy, radius) {
  const rect = canvas.getBoundingClientRect();
  const x = cx - rect.left, y = cy - rect.top, W = rect.width, H = rect.height;
  const proj = (px, py, pz) => { _v.set(px, py, pz).project(camera); return [((_v.x + 1) / 2) * W, ((1 - _v.y) / 2) * H, _v.z]; };
  let coil = -1, best = radius, bestZ = Infinity;
  const pts = S.render.pts;
  for (let k = 0; k < S.nbase; k++) {
    let prev = null;
    for (let i = 0; i <= NR; i += 2) {
      const o = 3 * (k * NR + (i % NR));
      const cur = proj(pts[o], pts[o + 1], pts[o + 2]);
      if (prev && prev[2] < 1 && cur[2] < 1) {
        const d = segDist(x, y, prev[0], prev[1], cur[0], cur[1]), z = (prev[2] + cur[2]) / 2;
        if (d < best - 1 || (d < best + 1 && z < bestZ)) { best = d; bestZ = z; coil = k; }
      }
      prev = cur;
    }
  }
  let point = null, bestP = radius + 6;
  for (const k of new Set([coil, S.sel, S.hover.coil])) {
    if (k < 0 || k >= S.nbase) continue;
    for (let j = 0; j < HANDLES; j++) {
      const o = 3 * (k * HANDLES + j);
      const [sx, sy, sz] = proj(S.handles[o], S.handles[o + 1], S.handles[o + 2]);
      if (sz >= 1) continue;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestP) { bestP = d; point = [k, j]; }
    }
  }
  if (point) return { coil: point[0], point: point[1] };
  return coil >= 0 ? { coil, point: -1 } : null;
}

function rayHit(e, plane) {
  const rect = canvas.getBoundingClientRect();
  _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

/* ------------------------------------------------------------------ direct manipulation */
let gesture = null;
const stageEl = document.getElementById('stage');

function stopCameraInertia() {
  controls._sphericalDelta?.set(0, 0, 0);
  controls._panOffset?.set(0, 0, 0);
  if ('_scale' in controls) controls._scale = 1;
}

// Capture phase on the canvas's parent: runs before OrbitControls sees the event, so a
// drag that starts on a handle or on the selected coil never also orbits the camera.
stageEl.addEventListener('pointerdown', (e) => {
  if (!S.views || S.loading || S.attract) return;
  if (gesture?.kind === 'drag') { e.stopPropagation(); return; }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const hit = pick(e.clientX, e.clientY, 12);
  if (hit && (hit.point >= 0 || hit.coil === S.sel)) {
    e.stopPropagation();
    e.preventDefault();
    beginDrag(e, hit);
  } else {
    gesture = { kind: 'click', id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), hit };
  }
}, true);

window.addEventListener('pointermove', (e) => {
  if (gesture?.kind === 'drag') { if (e.pointerId === gesture.id) dragTo(e); return; }
  if (e.target === canvas && !e.buttons) queueHover(e);
}, true);

const endGesture = (e) => {
  if (!gesture || e.pointerId !== gesture.id) return;
  const g = gesture;
  gesture = null;
  if (g.kind === 'drag') { endDrag(); return; }
  const isClick = e.type === 'pointerup' && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6 && performance.now() - g.t < 600;
  if (isClick) { if (g.hit) selectCoil(g.hit.coil); else clearSelection(); }
};
window.addEventListener('pointerup', endGesture, true);
window.addEventListener('pointercancel', endGesture, true);
canvas.addEventListener('pointerleave', () => {
  if (gesture) return;
  S.hover = { coil: -1, point: -1 };
  refreshCoilStyles();
  canvas.style.cursor = '';
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function beginDrag(e, hit) {
  stopRelax();
  const k = hit.coil, j = hit.point;
  stopCameraInertia();
  controls.enabled = false;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  S.design.checkpoint();
  S.dragId++;
  S.dragging = true;
  S.sel = k;
  const base = Float64Array.from(S.design.dofs);
  const nb = 2 * S.design.order + 1, off = k * S.design.nd;
  const anchor = j >= 0 ? new THREE.Vector3(...S.design.handle(k, j)) : new THREE.Vector3(base[off], base[off + nb], base[off + 2 * nb]);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), anchor);
  const start = rayHit(e, plane) ?? anchor.clone();
  gesture = { kind: 'drag', id: e.pointerId, k, j, base, plane, start, raw: new THREE.Vector3(), applied: new THREE.Vector3() };
  canvas.style.cursor = 'grabbing';
  markTraceStale();
  refreshCoilStyles();
  updateHint();
  updateCoilChip();
}

function dragTo(e) {
  const g = gesture;
  const hit = rayHit(e, g.plane);
  if (!hit) return;
  const raw = hit.sub(g.start);
  g.applied.addScaledVector(_v2.copy(raw).sub(g.raw), e.shiftKey ? FINE : 1);
  g.raw.copy(raw);
  if (g.applied.length() > MAX_DRAG) g.applied.setLength(MAX_DRAG);
  const d = [g.applied.x, g.applied.y, g.applied.z];
  const touched = g.j >= 0
    ? S.design.deformHandle(g.base, g.k, g.j, d, S.linked)
    : S.design.moveCoil(g.base, g.k, d, S.linked);
  refreshGeometry([...touched]);
  requestEval([...touched], true);
}

function endDrag() {
  S.dragging = false;
  controls.enabled = true;
  canvas.style.cursor = '';
  requestEval(null, false);
  hud.setHistory(true, false);
  markTutorial('drag');
  refreshCoilStyles();
  updateHint();
}

let hoverQueued = null;
function queueHover(e) {
  if (!S.views || S.loading || S.attract) return;
  if (!hoverQueued) requestAnimationFrame(updateHover);
  hoverQueued = { x: e.clientX, y: e.clientY };
}

function updateHover() {
  const h = hoverQueued;
  hoverQueued = null;
  if (!h || !S.views || gesture?.kind === 'drag') return;
  const hit = pick(h.x, h.y, 12);
  const coil = hit?.coil ?? -1, point = hit?.point ?? -1;
  if (coil !== S.hover.coil || point !== S.hover.point) {
    S.hover = { coil, point };
    refreshCoilStyles();
  }
  canvas.style.cursor = point >= 0 ? 'grab' : coil >= 0 ? (coil === S.sel ? 'move' : 'pointer') : '';
}

let userOrbit = false;
controls.addEventListener('start', () => { userOrbit = true; });
controls.addEventListener('end', () => { userOrbit = false; });
controls.addEventListener('change', () => { if (userOrbit && !S.dragging && S.views) markTutorial('orbit'); });

/* ------------------------------------------------------------------ tools */
const allBases = () => new Set(Array.from({ length: S.nbase }, (_, b) => b));

function smooth() {
  if (!S.views) return;
  stopRelax();
  S.design.checkpoint();
  const coils = S.sel >= 0 && !S.linked ? [S.sel] : [...allBases()];
  onDesignChanged(S.design.smooth(coils), false);
  hud.setHistory(true, false);
  hud.toast(coils.length === 1 ? `Coil ${label(coils[0])} smoothed` : 'All coils smoothed', '', 1400);
  markTutorial('smooth');
}

function undo() {
  stopRelax();
  if (S.views && S.design.undo()) onDesignChanged(allBases(), false);
}
function redo() {
  stopRelax();
  if (S.views && S.design.redo()) onDesignChanged(allBases(), false);
}
function reset() {
  if (!S.views) return;
  stopRelax();
  S.design.reset();
  S.relaxState = null;
  onDesignChanged(allBases(), false);
  hud.setHistory(true, false);
  hud.toast('Back to the starting coils. Undo restores your design.', '', 2600);
}

function toggleLinked() {
  S.linked = !S.linked;
  hud.setLinked(S.linked);
  refreshCoilStyles();
  updateHint();
  hud.toast(S.linked ? 'Linked: every edit now applies to all coils' : 'Unlinked: edits apply to one coil', '', 1800);
}

/** Relax: local L-BFGS on the level's own objective, from the current design. */
function toggleRelax() {
  if (!S.views || !S.level.relax) return;
  if (S.relaxing) { stopRelax(true); return; }
  S.design.checkpoint();
  hud.setHistory(true, false);
  S.relaxing = true;
  hud.setRelaxing(true, true);
  markTraceStale();
  updateHint();
  const iters = S.level.continuation ? RELAX_ITERS_RECORD : RELAX_ITERS;
  relaxer.start(S.level, Float64Array.from(S.design.dofs), Float64Array.from(S.design.currents), iters, S.relaxState,
    (m) => {
      if (!S.relaxing) return;
      S.design.dofs.set(m.dofs);
      S.design.currents.set(m.currents);
      refreshGeometry();
      requestEval(null, false);
      updateCoilChip();
      hud.setHint(`Relaxing… iteration ${m.it}. Press Stop to keep the current coils.`);
    },
    (m) => {
      if (!S.relaxing) return;
      if (m.dofs) { S.design.dofs.set(m.dofs); S.design.currents.set(m.currents); }
      if (m.state) S.relaxState = m.state;
      finishRelax(m.error ? `Relax failed: ${m.error}` : `Relax finished after ${m.it} iterations`);
    },
  ).catch((err) => finishRelax(`Relax could not start: ${err.message ?? err}`));
}

function stopRelax(announce = false) {
  if (!S.relaxing) return;
  relaxer.stop();
  finishRelax(announce ? 'Relax stopped; your current coils are kept' : null);
}

function finishRelax(message) {
  if (!S.relaxing) return;
  S.relaxing = false;
  hud.setRelaxing(false, S.level.relax);
  refreshGeometry();
  requestEval(null, false);
  updateHint();
  updateCoilChip();
  if (message) hud.toast(message, '', 2400);
}

function applyToggles() {
  if (!S.views) return;
  S.views.lines.group.visible = S.toggles.lines;
  S.views.plasma.setHeatmap(S.toggles.heat);
  S.views.sparks.enabled = S.toggles.sparks;
  S.views.sparks.points.visible = S.toggles.sparks;
  document.getElementById('tg-lines').checked = S.toggles.lines;
  document.getElementById('tg-heat').checked = S.toggles.heat;
  document.getElementById('tg-sparks').checked = S.toggles.sparks;
}

function setMoreOpen(open) {
  document.getElementById('more').hidden = !open;
  document.getElementById('btn-more').setAttribute('aria-expanded', String(open));
}

const boardLevel = () => (S.level && !S.attract ? S.level.id : LEVELS[0].id);
on('btn-menu', 'click', () => openMenu());
on('goal', 'click', () => openOverlay('briefing'));
on('brief-go', 'click', closeOverlays);
on('btn-next', 'click', goToNextLevel);
on('complete-next', 'click', goToNextLevel);
on('complete-stay', 'click', closeOverlays);
on('btn-smooth', 'click', smooth);
on('btn-relax', 'click', toggleRelax);
on('btn-undo', 'click', undo);
on('btn-redo', 'click', redo);
on('btn-reset', 'click', reset);
on('btn-link', 'click', toggleLinked);
on('btn-board', 'click', () => openBoard(boardLevel()));
on('btn-details', 'click', () => hud.toggleDetails());
on('btn-more', 'click', (e) => { e.stopPropagation(); setMoreOpen(document.getElementById('more').hidden); });
on('more', 'click', (e) => e.stopPropagation());
document.addEventListener('click', () => setMoreOpen(false));
on('tg-copies', 'change', (e) => { S.showAll = e.target.checked; if (S.views) { updateCopies(); refreshCoilStyles(); updateHint(); } });
on('tg-lines', 'change', (e) => { S.toggles.lines = e.target.checked; applyToggles(); });
on('tg-heat', 'change', (e) => { S.toggles.heat = e.target.checked; applyToggles(); });
on('tg-sparks', 'change', (e) => { S.toggles.sparks = e.target.checked; applyToggles(); });
on('btn-export', 'click', () => { setMoreOpen(false); openExport(); });
on('cur-up', 'click', (e) => nudgeCurrent(1, e.shiftKey));
on('cur-down', 'click', (e) => nudgeCurrent(-1, e.shiftKey));

window.addEventListener('keydown', (e) => {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const overlayOpen = [...document.querySelectorAll('.overlay')].some((o) => !o.hidden);
  if (S.attract) {
    // Title screen: arrows move through the menu, Enter picks, Escape closes a sheet.
    if (overlayOpen) { if (e.key === 'Escape') closeOverlays(); return; }
    if (titleEl.hidden) return;
    const i = Math.max(0, titleItems.findIndex((b) => b.classList.contains('is-active')));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setTitleActive((i + (e.key === 'ArrowDown' ? 1 : titleItems.length - 1)) % titleItems.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      titleItems[i].click();
    }
    return;
  }
  if (e.key === 'Escape') {
    setMoreOpen(false);
    if (overlayOpen) closeOverlays(); else clearSelection();
    return;
  }
  if (overlayOpen || !S.views) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod || e.altKey) return;
  if (k === 's') smooth();
  else if (k === 'r') toggleRelax();
  else if (k === 'l') toggleLinked();
  else if (k === 'm') openMenu();
  else if (k === 'b') openBoard(boardLevel());
  else if (k === 'x') openExport();
  else if (k === 'f') { S.toggles.lines = !S.toggles.lines; applyToggles(); }
  else if (k === 'h') { S.toggles.heat = !S.toggles.heat; applyToggles(); }
});

/* ------------------------------------------------------------------ overlays */
function openOverlay(id) {
  closeOverlays();
  document.getElementById(id).hidden = false;
}
function closeOverlays() {
  for (const o of document.querySelectorAll('.overlay')) o.hidden = true;
}
for (const o of document.querySelectorAll('.overlay')) {
  o.addEventListener('click', (e) => { if (e.target === o && S.views) o.hidden = true; });
  for (const b of o.querySelectorAll('[data-close]')) b.addEventListener('click', () => { o.hidden = true; });
}

function openMenu() {
  const progress = load(STORE.progress, {});
  const wrap = document.getElementById('level-cards');
  wrap.innerHTML = '';
  const starRow = (p, withRecord) => [0, 1, 2].map((i) => `<span class="${i < (p?.stars ?? 0) ? 'on' : ''}">★</span>`).join('')
    + (withRecord ? `<span class="${p?.beat ? 'on' : ''}">✦</span>` : '');
  const current = (level) => !S.attract && S.level?.id === level.id;
  for (const level of LEVELS.filter((l) => !l.record)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `level-card${current(level) ? ' is-current' : ''}`;
    const c = level.coils, K = c.nbase * c.nfp * (c.stellsym ? 2 : 1);
    b.innerHTML = `
      <span class="lc-code">${levelCode(level).toUpperCase()}</span>
      <span class="lc-title"></span>
      <span class="lc-text"></span>
      <span class="lc-meta"><span>${K} coils${c.nbase < K ? ` · ${c.nbase} to design` : ''}${level.ports.length ? ' · ports' : ''}</span><span class="lc-stars">${starRow(progress[level.id], false)}</span></span>`;
    b.querySelector('.lc-title').textContent = level.title;
    b.querySelector('.lc-text').textContent = level.brief.split('. ')[0] + '.';
    b.addEventListener('click', () => goToLevel(level).catch(reportError));
    wrap.appendChild(b);
  }
  // The record levels: one card, one button per coil-length budget.
  const records = LEVELS.filter((l) => l.record);
  if (records.length) {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML = `
      <div class="rc-intro">
        <span class="lc-code">RESEARCH RECORDS</span>
        <span class="lc-title">Precise QA, as published</span>
        <span class="lc-text">The coil setup of ${records[0].record.cite}, the best published coils for this plasma. Pick a total coil length; more coil buys accuracy. ★★★ is within 2 % of the record, ✦ beats it.</span>
      </div>`;
    for (const level of records) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `level-card rc-budget${current(level) ? ' is-current' : ''}`;
      b.innerHTML = `
        <span class="lc-code">≤ ${level.record.budget} m OF COIL</span>
        <span class="rc-record mono">record ${pct(level.record.fieldError)}</span>
        <span class="lc-meta"><span>${progress[level.id]?.best ? `best ${pct(progress[level.id].best)}` : 'not played'}</span><span class="lc-stars">${starRow(progress[level.id], true)}</span></span>`;
      b.addEventListener('click', () => goToLevel(level).catch(reportError));
      card.appendChild(b);
    }
    wrap.appendChild(card);
  }
  const { stars, max, beat, records: nrec } = progressSummary();
  document.getElementById('menu-progress').textContent = `★ ${stars} / ${max} · ✦ ${beat} / ${nrec}`;
  // From the title, "Back" returns to it; in a level, the menu can also lead back to the title.
  document.getElementById('menu-close').textContent = S.attract ? 'Back' : 'Back to the reactor';
  document.getElementById('menu-close').hidden = !S.views;
  document.getElementById('menu-main').hidden = !S.views || S.attract;
  openOverlay('menu');
}
on('menu-close', 'click', closeOverlays);

/* ----- export / import ----- */
function exportText() {
  const data = buildExport({ level: S.level, design: S.design, metrics: S.metrics, verdict: S.verdict });
  // One line per numeric array keeps the file readable.
  return JSON.stringify(data, null, 2).replace(/\[\s+([-\d.e+,\s]+?)\s+\]/g, (_, body) => `[${body.replace(/\s+/g, ' ')}]`);
}

function openExport() {
  if (!S.metrics) return;
  document.getElementById('export-text').value = exportText();
  document.getElementById('export-status').textContent = '';
  document.getElementById('import-status').textContent = '';
  openOverlay('export');
}
on('export-copy', 'click', async () => {
  const ta = document.getElementById('export-text');
  const status = document.getElementById('export-status');
  try {
    await navigator.clipboard.writeText(ta.value);
    status.textContent = 'Copied to the clipboard.';
  } catch {
    ta.focus();
    ta.select();
    status.textContent = 'Copy blocked here. The text is selected: press Ctrl+C (⌘C on Mac).';
  }
});
on('export-save', 'click', () => {
  const name = 'stellarator-design.json';
  saveText(name, document.getElementById('export-text').value);
  document.getElementById('export-status').textContent = `Downloading ${name}.`;
});
on('import-go', 'click', () => {
  const status = document.getElementById('import-status');
  try {
    const { dofs, currents } = parseImport(document.getElementById('import-text').value, S.level);
    stopRelax();
    S.design.load(dofs, currents);
    onDesignChanged(allBases(), false);
    hud.setHistory(true, false);
    closeOverlays();
    hud.toast('Design imported. Undo restores your previous coils.');
  } catch (err) {
    status.textContent = err.message;
  }
});

function saveText(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ----- best runs (local to this browser) ----- */
function openBoard(levelId) {
  openOverlay('board');
  const tabs = document.getElementById('board-tabs');
  tabs.innerHTML = '';
  for (const l of LEVELS) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'tab';
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', String(l.id === levelId));
    t.textContent = l.record ? `Record · ${l.record.budget} m` : l.code === 'T' ? 'Training' : `${l.code} · ${l.title}`;
    t.addEventListener('click', () => openBoard(l.id));
    tabs.appendChild(t);
  }
  document.getElementById('board-source').textContent = scoreboard.label;
  const rows = document.getElementById('board-rows');
  rows.innerHTML = '';
  const list = scoreboard.list(levelId).filter((e) => Number.isFinite(e.fieldError));
  if (!list.length) {
    rows.innerHTML = '<tr><td colspan="7" class="empty">No runs on this level yet. Any buildable design you make is saved here automatically.</td></tr>';
    return;
  }
  const when = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  list.forEach((e, i) => {
    const tr = document.createElement('tr');
    const current = e.run === S.runId;
    if (current) tr.className = 'mine';
    const cells = [
      String(i + 1), current ? 'This run' : when(e.savedAt), Number(e.score).toLocaleString('en-US'), pct(e.fieldError),
      `${Number(e.length).toFixed(2)} m`, `${Number(e.ccMin).toFixed(3)} m`, ('★'.repeat(Number(e.stars) || 0) || '–') + (e.beat ? ' ✦' : ''),
    ];
    cells.forEach((c, ci) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (ci >= 2 && ci <= 5) td.className = 'num';
      tr.appendChild(td);
    });
    rows.appendChild(tr);
  });
}

/* ------------------------------------------------------------------ loop */
let last = performance.now(), time = 0, detailTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  S.fps += (1 / Math.max(dt, 1e-3) - S.fps) * 0.05;
  if (S.attract && !titleEl.hidden) updateTitleCamera(dt); else controls.update();
  const v = S.views;
  if (v && !S.loading) {
    v.plasma.update(time, dt);
    v.coils.tick(time);
    v.lines.update(dt);
    v.sparks.update(dt);
    detailTimer += dt;
    if (detailTimer > 1 && S.metrics) { detailTimer = 0; hud.setMetrics(S.level, S.metrics, S.verdict, statusInfo(), alertsFor(S.verdict)); }
  }
  stage.composer.render();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ boot */
function reportError(err) {
  const where = String(err?.stack ?? '').split('\n').find((l) => l.includes('.js')) ?? '';
  showFatal(`Could not start the reactor: ${err?.message || err}. ${where.trim()} Reload the page to try again.`, err);
}

/** Replaces the loading screen with an error message. */
function showFatal(message, err) {
  console.error(err);
  const boot = document.getElementById('boot') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'boot', className: 'boot' }));
  boot.classList.remove('gone');
  boot.classList.add('failed');
  boot.innerHTML = '<div class="boot-ring" aria-hidden="true"></div><div class="mono" id="boot-text"></div>';
  boot.querySelector('#boot-text').textContent = message;
}

function levelFrom(desc) {
  return desc?.id ? levelById(desc.id) : null;
}

async function start() {
  requestAnimationFrame(frame);
  try {
    await loadLevel(levelById('qa'), { design: SHOWCASE_QA, attract: true });
    enterTitle();
  } catch (err) {
    // Without the title scene the game still starts, on the training level.
    console.warn('[boot] title scene failed; starting on Training.', err);
    S.loading = false;
    leaveTitle();
    await loadLevel(LEVELS[0]);
  }
  const boot = document.getElementById('boot');
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 500);
}

start().catch(reportError);
