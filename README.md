# Stellarator

A browser game about designing the magnet coils of a stellarator. Its final level is the real stage-2 coil problem, posed and scored exactly as the research code [SIMSOPT](https://github.com/hiddenSymmetries/simsopt) poses it. A design that wins there is a real coil solution, and it exports in a form SIMSOPT loads directly.

## Run

```bash
npm start
```

Then open http://localhost:8080. It needs Node 18 or later and has no dependencies; Three.js r170 loads from jsDelivr. `server.js` is only a static file server, because browsers won't load ES modules or the physics workers from `file://`. Any static server works, e.g. `python3 -m http.server 8080`.

The game opens on a title screen: Play (or Continue), Levels, and How it works. Arrow keys and Enter work too. Behind the menu turns a ★★★ coil set for the research level, made in-game with Relax and checked in SIMSOPT.

Earning a star completes a level: a card offers the next level, or you can keep improving. Every play of a level saves its best buildable design to "Best runs" automatically, with no name to enter. Runs, progress and in-progress designs stay in the browser's local storage on this computer; nothing is sent anywhere.

## Levels

| Level | Target | Coils you design | Tools |
| --- | --- | --- | --- |
| Training · Field Lines | rotating ellipse, 3 periods | 3 (no symmetry) | drag, Smooth |
| 1 · The Circle | rotating ellipse, 2 periods | 1 (×4 by symmetry) | drag, Smooth |
| 2 · The Twist | rotating ellipse, 5 periods | 2 (×20) | + Relax |
| 3 · The Port Squeeze | rotating ellipse, 3 periods, 3 ports | 4 (×12) | + Relax |
| Research · Precise QA | Landreman–Paul precise QA | 4 (×16) and their currents | + Relax, current control |

The first four levels are tutorials on simplified targets (1 m major radius). They use the same engine, objective and limits as the research level, plus a per-coil length cap and a stronger curvature penalty, so the coils stay compact on targets with no tight clearances.

### The research level is the real problem

- **Target**: the precisely quasi-axisymmetric vacuum field of M. Landreman & E. Paul, *Phys. Rev. Lett.* 128, 035001 (2022). The boundary is SIMSOPT's `tests/test_files/input.LandremanPaul2021_QA`, read with `SurfaceRZFourier.from_vmec_input`.
- **Coils**: 4 base `CurveXYZFourier` curves of order 5 (75 quadrature points), repeated by `coils_via_symmetries` with nfp = 2 and stellarator symmetry: 16 coils. Currents start at 100 kA; coil 1's current is fixed, as in SIMSOPT's example, so the trivial zero-field answer is excluded.
- **Objective and limits**: those of SIMSOPT's `examples/2_Intermediate/stage_two_optimization.py`. The objective is `SquaredFlux` on a 32 × 32 half-period grid plus penalties: coil length (weight 1e-7), coil–coil distance ≥ 0.1 m, coil–surface distance ≥ 0.3 m, curvature ≤ 5 /m, and mean-square curvature ≤ 5 /m².
- **Score**: the field error ⟨|B·n̂|⟩ / ⟨|B|⟩ on that grid, the number SIMSOPT's example prints.
- **Stars**: ★ 1 %, ★★ 0.1391 % (SIMSOPT's first round), ★★★ 0.0441 % (the published design: 4.4094e-4 with 19.47 m of coil). Every limit must hold to within 0.5 %, because the published design sits exactly on them.
- **Research tier ✦**: beat the published field error by 5 % (≤ 0.0419 %) within the same limits, with no more total coil length than the published design. That is a new result.

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
| Current − / + | Research level: the selected coil's current (1 %, Shift 0.1 %) |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z` | Undo / redo |
| `M` `B` `X` | Level menu, best runs, export |
| `⋯` menu | Show all coils, field lines, heatmap, sparks, Export JSON |

On symmetric levels you only design the base coils; their rotated and mirrored copies are drawn as faint outlines. Red tube segments break a limit (too close, too bent, through a port).

## Physics

Everything is computed in the browser, in plain JavaScript that mirrors SIMSOPT:

- `public/js/physics/rzsurface.js`: `SurfaceRZFourier` evaluation and SIMSOPT's quadrature grids (`full torus`, `field period`, `half period`).
- `public/js/physics/coilset.js`: `CurveXYZFourier`, `create_equally_spaced_curves`, `coils_via_symmetries`, and the Biot–Savart sources.
- `public/js/physics/stage2.js`: the stage-2 objective and every penalty, with exact analytic gradients.
- `public/js/physics/lbfgs.js`: L-BFGS with a strong-Wolfe line search (Relax).
- `public/js/physics/tracer.js`: field-line tracing (RK4) for the Poincaré section and the rotational transform ι.

Checks against SIMSOPT 1.11.1:

- The objective, each term and the gradients agree to machine precision.
- Relax, started from SIMSOPT's circles, reproduces the published design.
- A design exported from the running game recomputes in SIMSOPT to 10 significant digits: field error, distances, curvatures and lengths.

The Poincaré panel traces 8 field lines for 40 transits once a design settles. Nested closed curves with all lines inside mean the coils make good magnetic surfaces; the published QA design shows ι ≈ 0.42 at the edge.

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
