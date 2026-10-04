/**
 * Export / import in SIMSOPT's own terms. A design *is* a SIMSOPT DOF vector, so the
 * export is exact: base CurveXYZFourier coefficients (SIMSOPT order) and currents, the
 * symmetry used by coils_via_symmetries, and the target surface coefficients. The
 * embedded script rebuilds the coils in SIMSOPT and recomputes the field error.
 */

const r = (v, d = 12) => Number(v.toPrecision(d));

export function dofNames(order) {
  const names = [];
  for (const x of ['x', 'y', 'z']) {
    names.push(`${x}c(0)`);
    for (let m = 1; m <= order; m++) names.push(`${x}s(${m})`, `${x}c(${m})`);
  }
  return names;
}

export function buildExport({ level, design, metrics, verdict }) {
  const c = level.coils, nd = design.nd;
  const base = [];
  for (let b = 0; b < design.nbase; b++) {
    base.push({ dofs: Array.from(design.dofs.subarray(b * nd, (b + 1) * nd), (v) => r(v)), current: r(design.currents[b]) });
  }
  const S = level.surface;
  return {
    format: 'stellarator-game/simsopt-stage2@1',
    exported_at: new Date().toISOString(),
    level: { id: level.id, name: `${level.name}: ${level.title}` },
    target: { source: level.plasmaSource ?? 'tutorial rotating ellipse', vacuum: true },
    objective: level.flux === 'local'
      ? 'SquaredFlux(definition="local") = ½∫(B·n/|B|)² ds, as in Wechsung et al., PNAS 2022'
      : 'SquaredFlux (quadratic flux) plus weighted penalties, as in SIMSOPT\'s stage_two_optimization.py',
    record: level.record
      ? { source: level.record.source, budget_m: level.record.budget, field_error: level.record.fieldError, field_error_fine_check: level.record.fine.fieldError }
      : undefined,
    surface: { nfp: S.nfp, mpol: S.mpol, ntor: S.ntor, stellsym: true, rc: S.rc, zs: S.zs, layout: 'rc[m][n + ntor], zs[m][n + ntor]' },
    scoring_grid: { ...level.scoring },
    coils: {
      type: 'CurveXYZFourier', order: c.order, numquadpoints: c.quadpoints ?? 15 * c.order,
      nfp: c.nfp, stellsym: c.stellsym,
      dof_order: dofNames(c.order),
      base_curves: base,
      note: 'Rebuild with coils_via_symmetries(curves, currents, nfp, stellsym); flipped coils carry −current.',
    },
    limits: { ...level.limits },
    metrics: {
      field_error: metrics.fieldError, max_BdotN_over_B: metrics.maxRatio, squared_flux_Jf: metrics.Jf,
      squared_flux_local: metrics.JfLocal, mean_B_tesla: metrics.B_mean, coil_coil_min: metrics.ccMin, coil_surface_min: metrics.csMin,
      kappa_max: metrics.kappaMax, msc: metrics.msc, lengths: metrics.lengths, total_length: metrics.totalLength,
    },
    verdict: { valid: verdict.valid, stars: verdict.stars, new_record: verdict.beat },
    simsopt_script: [
      'import json, numpy as np',
      'from simsopt.geo import CurveXYZFourier, SurfaceRZFourier',
      'from simsopt.field import Current, coils_via_symmetries, BiotSavart',
      'from simsopt.objectives import SquaredFlux',
      "d = json.load(open('stellarator-design.json'))",
      "c, S, g = d['coils'], d['surface'], d['scoring_grid']",
      'curves = []',
      "for bc in c['base_curves']:",
      "    curve = CurveXYZFourier(c['numquadpoints'], c['order'])",
      "    curve.x = np.array(bc['dofs'])",
      '    curves.append(curve)',
      "currents = [Current(bc['current']) for bc in c['base_curves']]",
      "coils = coils_via_symmetries(curves, currents, c['nfp'], c['stellsym'])",
      "qp, qt = SurfaceRZFourier.get_quadpoints(nphi=g['nphi'], ntheta=g['ntheta'], range=g['range'], nfp=S['nfp'])",
      "s = SurfaceRZFourier(nfp=S['nfp'], stellsym=True, mpol=S['mpol'], ntor=S['ntor'], quadpoints_phi=qp, quadpoints_theta=qt)",
      "for m in range(S['mpol'] + 1):",
      "    for n in range(-S['ntor'], S['ntor'] + 1):",
      "        s.set_rc(m, n, S['rc'][m][n + S['ntor']]); s.set_zs(m, n, S['zs'][m][n + S['ntor']])",
      'bs = BiotSavart(coils); bs.set_points(s.gamma().reshape((-1, 3)))',
      'B = bs.B().reshape(s.gamma().shape)',
      'Bn = np.abs(np.sum(B * s.unitnormal(), axis=2))',
      "print('field error <|B.n|>/<|B|> =', Bn.mean() / np.linalg.norm(B, axis=2).mean())",
      "print('local squared flux =', SquaredFlux(s, bs, definition='local').J())",
    ],
  };
}

/** Reads base curves and currents from an export. Returns { dofs, currents } or throws. */
export function parseImport(text, level) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('That is not valid JSON.'); }
  const c = d?.coils;
  if (!c?.base_curves) throw new Error('No coils found. Paste a design exported from this game.');
  const lc = level.coils;
  if (c.order !== lc.order || c.nfp !== lc.nfp || c.stellsym !== lc.stellsym || c.base_curves.length !== lc.nbase) {
    throw new Error(`This level uses ${lc.nbase} base coils of order ${lc.order}; the design does not match.`);
  }
  const nd = 3 * (2 * lc.order + 1);
  const dofs = new Float64Array(lc.nbase * nd), currents = new Float64Array(lc.nbase);
  c.base_curves.forEach((bc, b) => {
    if (!Array.isArray(bc.dofs) || bc.dofs.length !== nd || !bc.dofs.every(Number.isFinite)) throw new Error(`Coil ${b + 1} needs ${nd} Fourier coefficients.`);
    if (!Number.isFinite(bc.current)) throw new Error(`Coil ${b + 1} has no valid current.`);
    dofs.set(bc.dofs, b * nd);
    currents[b] = bc.current;
  });
  if (!lc.freeCurrents) currents.fill(lc.current);
  return { dofs, currents };
}
