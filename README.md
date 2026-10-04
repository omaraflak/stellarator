# Stellarator

A browser game about designing the magnet coils of a stellarator. It ends on research records: the coil-design benchmark of Wechsung et al. (PNAS 2022) for the Landreman–Paul precise QA plasma, posed and scored exactly as the paper does, with the physics checked against the research code [SIMSOPT](https://github.com/hiddenSymmetries/simsopt). A design that beats a record there is better than the best published coils for that problem, and it exports in a form SIMSOPT loads directly.

## Run

```bash
npm start
```

Then open http://localhost:8080. It needs Node 18 or later and has no dependencies; Three.js r170 loads from jsDelivr. `server.js` is only a static file server, because browsers won't load ES modules or the physics workers from `file://`. Any static server works, e.g. `python3 -m http.server 8080`.

The game opens on a title screen: Play (or Continue), Levels, and How it works. Arrow keys and Enter work too. Behind the menu turns a ★★★ coil set for Level 04, made in-game with Relax and checked in SIMSOPT.

Earning a star completes a level: a card offers the next level, or you can keep improving. Every play of a level saves its best buildable design to "Best runs" automatically, with no name to enter. Runs, progress and in-progress designs stay in the browser's local storage on this computer; nothing is sent anywhere.

## Levels

| Level | Target | Coils you design | Tools |
| --- | --- | --- | --- |
| Training · Field Lines | rotating ellipse, 3 periods | 3 (no symmetry) | drag, Smooth |
| 01 · The Circle | rotating ellipse, 2 periods | 1 (×4 by symmetry) | drag, Smooth |
| 02 · The Twist | rotating ellipse, 5 periods | 2 (×20) | + Relax |
| 03 · The Port Squeeze | rotating ellipse, 3 periods, 3 ports | 4 (×12) | + Relax |
| 04 · Precise QA | Landreman–Paul precise QA | 4 (×16) and their currents | + Relax, current control |
| Research records · Precise QA, 18 / 20 / 22 / 24 m | Landreman–Paul precise QA | 4 (×16) and their currents | the same |

The first four levels are tutorials on simplified targets (1 m major radius). They use the same engine as the rest, plus a per-coil length cap and a stronger curvature penalty, so the coils stay compact on targets with no tight clearances.

### Level 04: the real plasma, tutorial settings

- **Target**: the precisely quasi-axisymmetric vacuum field of M. Landreman & E. Paul, *Phys. Rev. Lett.* 128, 035001 (2022). The boundary is SIMSOPT's `tests/test_files/input.LandremanPaul2021_QA`, read with `SurfaceRZFourier.from_vmec_input`.
- **Setup**: that of SIMSOPT's tutorial script `examples/2_Intermediate/stage_two_optimization.py`. 4 base `CurveXYZFourier` coils of order 5, repeated by `coils_via_symmetries` (nfp = 2, stellarator symmetry: 16 coils); coil 1's current is fixed. The objective is `SquaredFlux` on a 32 × 32 half-period grid plus weighted penalties: coil length (1e-7), coil–coil distance ≥ 0.1 m, coil–surface distance ≥ 0.3 m, curvature ≤ 5 /m, mean-square curvature ≤ 5 /m².
- **Stars**: ★ 1 %, ★★ 0.1391 %, ★★★ 0.0441 %: the result of running that script unmodified. The script is a demonstration, so there is no published record to beat here.

### Research records: the best published coils

The four record levels use the exact formulation of F. Wechsung, M. Landreman, A. Giuliani, A. Cerfon & G. Stadler, *Precise stellarator quasi-symmetry can be achieved with electromagnetic coils*, PNAS 119, e2202084119 (2022), on the same plasma:

- **Coils**: 4 base `CurveXYZFourier` coils of order 16 with 160 quadrature points each, 16 coils by symmetry; coil 1's current is fixed.
- **Objective**: `SquaredFlux(definition="local")` = ½∫(B·n/|B|)² ds on the same 32 × 32 half-period grid.
- **Limits**, each met to 0.1 %: total length of the 4 base coils ≤ the budget (18, 20, 22 or 24 m), curvature ≤ 5 /m, mean-square curvature ≤ 5 /m², coil–coil distance ≥ 0.1 m. As in the paper, there is no coil–plasma distance limit.
- **Records**: the paper's coils (from github.com/florianwechsung/CoilsForPreciseQS), recomputed with SIMSOPT 1.11.1 and with this game's physics (agreement ~1e-12):

| Budget | Field error | Worst point | Local squared flux |
| --- | --- | --- | --- |
| 18 m | 0.0911 % | 0.326 % | 4.76e-6 |
| 20 m | 0.0322 % | 0.124 % | 6.23e-7 |
| 22 m | 0.0111 % | 0.0421 % | 7.70e-8 |
| 24 m | 0.00435 % | 0.0159 % | 1.17e-8 |

  Gil et al., *Phys. Rev. E* 114, 025202 (2026) re-optimized this benchmark with a different method and did not beat these at equal length.
- **Stars**: ★ 3× the record, ★★ 1.5×, ★★★ within 2 %.
- **✦ New record**: field error at least 1 % below the record, with the paper's objective and the worst point no worse, and every limit met. The game then checks the exact design twice more before awarding it:
  1. a fine check on a 256 × 64 full-torus grid with 4× the coil quadrature, which must also beat the record's fine-check value by 1 %;
  2. field-line tracing, in which all 8 traced lines must stay inside the plasma.

  A design that passes is better than the best published design for that budget under identical rules. Whether it matters beyond that, for example on particle losses, which the paper also studied, is for researchers to judge.
- **Relax** runs the paper's optimizer schedule: L-BFGS in rounds of 500 iterations, raising the weight of any limit still broken by more than 0.1 % and shrinking the length weight. From the starting circles, a full run of the paper's 14,000 iterations (headless, about 16–18 minutes) ends 0.47 % above the 18 m record and 0.67 % above the 24 m record: ★★★, but not ✦. The 18 m run is within 0.5 % after about 2 minutes. That is about what the paper's own method gives from one start, so a ✦ needs a better design, not just more Relax.

## Tools

| Input | Action |
| --- | --- |
| Hover a coil | Shows its 8 handles |
| Drag a handle | Bend the coil: adds a smooth bump made from the curve's own Fourier modes, so the handle moves exactly with the cursor |
| Click a coil, then drag it | Move the whole coil |
| `Shift` while dragging | Fine control (0.2× speed) |
| Drag empty space / right-drag / wheel | Orbit / pan / zoom |
| Relax (`R`) | Runs L-BFGS on the level's objective from your design, with exact gradients. Stop keeps the coils where they are |
| Smooth (`S`) | Damps the higher Fourier harmonics (selected coil, or all) |
| Link coils (`L`) | Apply every edit to all coils, each in its own frame |
| Current − / + | Level 04 and the records: the selected coil's current (1 %, Shift 0.1 %) |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z` | Undo / redo |
| `M` `B` `X` | Level menu, best runs, export |
| `⋯` menu | Show all coils, field lines, heatmap, sparks, Export JSON |

On symmetric levels you only design the base coils; their rotated and mirrored copies are drawn as faint outlines. Red tube segments break a limit (too close, too bent, through a port).

## Physics

Everything is computed in the browser, in plain JavaScript that mirrors SIMSOPT:

- `public/js/physics/rzsurface.js`: `SurfaceRZFourier` evaluation and SIMSOPT's quadrature grids (`full torus`, `field period`, `half period`).
- `public/js/physics/coilset.js`: `CurveXYZFourier`, `create_equally_spaced_curves`, `coils_via_symmetries`, and the Biot–Savart sources.
- `public/js/physics/stage2.js`: the stage-2 objective and every penalty, with exact analytic gradients.
- `public/js/physics/lbfgs.js`: L-BFGS with a strong-Wolfe line search; `relax.js` runs it on a level's objective (with the paper's penalty schedule on record levels).
- `public/js/physics/tracer.js`: field-line tracing (RK4) for the Poincaré section and the rotational transform ι.

Checks against SIMSOPT 1.11.1:

- Both objectives (SIMSOPT's example and the PNAS paper's local squared flux), each penalty term and the gradients agree to machine precision (relative differences ~1e-12 or less).
- On the paper's own coils, every record metric and the fine check agree with SIMSOPT.
- Relax, started from SIMSOPT's circles on Level 04, reproduces SIMSOPT's own run of its example.
- A design exported from the running game recomputes in SIMSOPT to 10 significant digits: field error, distances, curvatures and lengths.

The Poincaré panel traces 8 field lines for 40 transits once a design settles. Nested closed curves with all lines inside mean the coils make good magnetic surfaces; good designs for this plasma show ι ≈ 0.42 at the edge.

Solves run in Web Workers: one for the field and metrics, one for Relax, one for tracing. Module workers are used where allowed; otherwise the same modules are bundled into a Blob worker. During a drag only the moving coils are recomputed against a cached field of the others, which is exact, so the numbers you see while dragging are the ones you keep.

## Export

Export JSON is the design in SIMSOPT's own terms. It holds:

- the base-curve `CurveXYZFourier` coefficients (SIMSOPT DOF order) and currents;
- the symmetry, the target surface and the scoring grid;
- the metrics, and a `simsopt_script` that rebuilds the coils and recomputes the field error.

Exported designs can be imported back into the same level.

## Publish

The game is a static site with no build step: everything served lives in `public/`. It must be served over http(s), because ES modules and Web Workers don't load from `file://`. `server.js` is only for local play.

**Cloudflare Workers** (configured in `wrangler.jsonc` as an assets-only Worker named `stellarator`):

```bash
npx wrangler deploy
```

With Workers Builds (connected to this repository), use the build command `npm run build` (a syntax check of the game files; there is no bundling), the deploy command `npx wrangler deploy` and the path `/`. The Worker's name in the dashboard must match the `name` in `wrangler.jsonc`.

Any other static host works too: point it at `public/` with no build command.

Three.js loads from jsDelivr and the fonts from Google Fonts, so visitors need those reachable. Scores and progress stay in each visitor's browser.

## Layout

```
public/                 everything that is deployed
  index.html, favicon.svg, css/
  js/physics            surface, coil set, stage-2 objective, L-BFGS, Biot–Savart, tracer, workers
  js/render             stage + bloom, plasma shader, coil tubes, field lines, sparks, ports
  js/game               levels, published targets, design + undo, scoring, export, best runs (local)
  js/ui                 HUD, Poincaré panel
server.js               local static server (npm start)
wrangler.jsonc          Cloudflare Workers config (npx wrangler deploy)
```
