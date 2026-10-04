/**
 * Published target plasma boundaries (SIMSOPT SurfaceRZFourier layout: rc[m][n + ntor],
 * zs[m][n + ntor], with R = Σ rc cos(mθ − nfp·n·φ), Z = Σ zs sin(mθ − nfp·n·φ)).
 *
 * LANDREMAN_PAUL_QA: the "precise quasi-axisymmetry" vacuum configuration of
 *   M. Landreman & E. Paul, "Magnetic fields with precise quasisymmetry for plasma
 *   confinement", Phys. Rev. Lett. 128, 035001 (2022), arXiv:2108.03711.
 * Coefficients are those of SIMSOPT's tests/test_files/input.LandremanPaul2021_QA,
 * read with SurfaceRZFourier.from_vmec_input (SIMSOPT 1.11.1). Zero pressure and zero
 * plasma current, so the coils alone must make B·n = 0 on this surface.
 *
 * REFERENCE_QA: SIMSOPT's stage-two example (examples/2_Intermediate/
 * stage_two_optimization.py) run unmodified: 4 base coils, Fourier order 5, nfp = 2 with
 * stellarator symmetry (16 coils), 100 kA, two L-BFGS rounds of 400 iterations.
 */

export const LANDREMAN_PAUL_QA = {
  nfp: 2, mpol: 5, ntor: 5,
  rc: [
    [0, 0, 0, 0, 0, 1.000000000000000, 0.1635736469509085, 0.01153464403265224, 0.0001660825542716507, -0.00004289839778893124, -0.000007088365208037713],
    [-0.000001234892163278594, 0.00005885906939720765, 0.001177705088726893, 0.006117449935928349, 0.03695998128952078, 0.1658776713857751, -0.1088789497913388, -0.02128857374166514, -0.002300157572693968, -0.00002627971451624495, -0.000003624748429446710],
    [3.429971812740527e-7, 0.00004850684989433037, -0.00001629464724791329, 0.0006490349497379012, 0.00003445618605450382, 0.01582563423506581, 0.02546788563643479, 0.003589988783905243, 0.002023292416997494, 0.0001334125199187403, 0.000007495835691917963],
    [0.000002595971377554895, -0.00002752586825793088, -0.00006881215658169502, 0.0001851061354443457, -0.0009499158045035575, 0.0006789213877319417, 0.0001278256592588691, 0.0001216640222421739, -0.0008824623427313230, -0.00008290455528140711, -0.000007724473257867983],
    [-4.525265993447933e-7, -0.000003765525591663771, 0.00001302918803102485, -0.00009479666265169178, 0.0002264194360369701, -0.0003151153789937265, 0.0003296873412220537, 0.0003702513915656681, 0.0001391783522713434, 0.000006688738405012066, 0.00001339256039281701],
    [-4.605122542160908e-7, 0.000004705334806798627, -0.000003907227055013670, 0.000001564971051544039, 0.00001512725785055272, 0.00002685611719517791, -0.00006524317753178391, -0.00003537817812851590, 0.00003342938698620821, -0.000009745754270559217, -0.000001976517490730610],
  ],
  zs: [
    [0, 0, 0, 0, 0, 0, -0.1253658594586452, -0.01143100828466809, -0.0001836705489992535, 0.00006379980554947428, 0.000006424749751809887],
    [0.000001650698547431063, 0.00007747703517376636, 0.0008768242973159689, 0.006917463886154144, 0.03357703036173842, 0.2153938070783234, 0.08004202421496563, 0.01941805377930779, 0.002043310207615721, 0.00009515817827817248, 0.000002237608189340047],
    [0.000003653065246955757, 0.00002581277522578798, 0.00009255771223110816, 0.0003952687065376200, -0.001331440902105533, 0.01561378330710932, 0.00008409380325679782, -0.007162905352448011, -0.001623525685575538, -0.0002144823958959020, -0.000003041995113869397],
    [7.546398657171724e-7, -0.00001293908425979845, -0.0001146639773380277, 0.0002034757712275398, -0.001194121521590374, 0.002074912419441758, 0.001453779212226518, 0.001751939663468610, 0.0004283901601890926, 0.0001361192934036727, 0.000008518581946796281],
    [-4.025242836970244e-7, -0.000005091039705513993, 0.000002938909520741841, -0.00002244078515714136, -0.00002520850733246328, 0.00009320140252262431, -0.00002042044185495455, 0.00004064784880640345, -0.00001361278177512208, -0.00006608364805280040, -0.000004386750839649032],
    [-1.918844832075774e-7, 0.000004045952798129327, 0.000001473135558324792, -0.000004697232422054022, 0.00002716682965888606, 0.00004010578314605041, 0.00001623461963012973, -0.00003511150206275442, 0.00002352419744940536, 0.000001637637084327691, 4.498757881413679e-8],
  ],
};

/** Results of the unmodified SIMSOPT reference run (see header). */
export const REFERENCE_QA = {
  fieldErrorRound1: 1.39052e-3,  // ⟨|B·n|⟩/⟨|B|⟩ after the first round (length weight 1e-6)
  fieldError: 4.40940e-4,        // after the second round (length weight 1e-7): the reference run's design
  maxRatio: 1.7503e-3,           // max |B·n|/|B|
  totalLength: 19.468675,        // m, sum of the 4 base coils
  ccMin: 0.100116, csMin: 0.300668, kappaMax: 5.0034, mscMax: 4.5906,
};

/**
 * PNAS_QA_RECORDS: the best published coil sets for the Landreman–Paul QA plasma, from
 *   F. Wechsung, M. Landreman, A. Giuliani, A. Cerfon & G. Stadler, "Precise stellarator
 *   quasi-symmetry can be achieved with electromagnetic coils", PNAS 119, e2202084119 (2022).
 * Formulation: 4 base CurveXYZFourier coils of order 16 (160 quadrature points), nfp = 2 with
 * stellarator symmetry, first current fixed; minimise SquaredFlux(definition="local") on a
 * 32 × 32 half-period grid (half-cell shift) subject to Σ L ≤ budget, κ ≤ 5 /m, MSC ≤ 5 /m²,
 * coil–coil distance ≥ 0.1 m, each met to 0.1 %. No coil–plasma distance limit.
 * Coils: github.com/florianwechsung/CoilsForPreciseQS (archive.zip, minimizers/
 * output_well_False_lengthbound_{L}_kap_5.0_msc_5.0_dist_0.1_fil_0_ig_{k}_order_16_expquad).
 * Gil et al., Phys. Rev. E 114, 025202 (2026) re-evaluated these sets and did not beat them
 * at equal length.
 *
 * Every number below was recomputed with SIMSOPT 1.11.1 from those files (and matches this
 * game's own physics to ~1e-12). `fine` is the verification check: a 256 × 64 full-torus
 * grid with 4 × the coil quadrature points (640 per coil).
 */
export const PNAS_QA_RECORDS = {
  18: { fieldError: 9.11229e-4, maxRatio: 3.25600e-3, JfLocal: 4.76054e-6, fine: { fieldError: 9.125911e-4, maxRatio: 3.368888e-3 },
    totalLength: 18.00973, ccMin: 0.13287, csMin: 0.27130, kappaMax: 4.4669, msc: 4.9783 },
  20: { fieldError: 3.21832e-4, maxRatio: 1.24204e-3, JfLocal: 6.23489e-7, fine: { fieldError: 3.215181e-4, maxRatio: 1.247379e-3 },
    totalLength: 20.01197, ccMin: 0.11311, csMin: 0.28677, kappaMax: 5.0003, msc: 5.0000 },
  22: { fieldError: 1.11131e-4, maxRatio: 4.21493e-4, JfLocal: 7.70366e-8, fine: { fieldError: 1.111655e-4, maxRatio: 4.335154e-4 },
    totalLength: 22.01336, ccMin: 0.10000, csMin: 0.30241, kappaMax: 5.0003, msc: 5.0000 },
  24: { fieldError: 4.34990e-5, maxRatio: 1.59168e-4, JfLocal: 1.16557e-8, fine: { fieldError: 4.351049e-5, maxRatio: 1.623375e-4 },
    totalLength: 24.00471, ccMin: 0.10000, csMin: 0.30709, kappaMax: 5.0001, msc: 5.0000 },
};
