/**
 * Limited-memory BFGS with a strong-Wolfe line search (Nocedal & Wright, Alg. 7.4 with
 * the bracketing/zoom line search of Alg. 3.5–3.6 and cubic interpolation).
 * Used by "Relax", the local optimiser the player can run on their own design.
 *
 * f(x) → { f, g } ; options: { m, maxIter, onIter(it, x, f) → false to stop }.
 */

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

export function lbfgs(f, x0, { m = 30, maxIter = 200, gtol = 1e-14, onIter = null } = {}) {
  const n = x0.length;
  let x = Float64Array.from(x0);
  let { f: fx, g } = f(x);
  const S = [], Y = [], RHO = [];
  let evals = 1, it = 0, reason = 'max iterations';
  for (; it < maxIter; it++) {
    if (Math.sqrt(dot(g, g)) < gtol) { reason = 'gradient small'; break; }
    // Two-loop recursion: d = −H·g
    const q = Float64Array.from(g), alpha = new Float64Array(S.length);
    for (let i = S.length - 1; i >= 0; i--) {
      alpha[i] = RHO[i] * dot(S[i], q);
      for (let j = 0; j < n; j++) q[j] -= alpha[i] * Y[i][j];
    }
    const gamma = S.length ? dot(S[S.length - 1], Y[Y.length - 1]) / dot(Y[Y.length - 1], Y[Y.length - 1]) : 1 / Math.max(1, Math.sqrt(dot(g, g)));
    for (let j = 0; j < n; j++) q[j] *= gamma;
    for (let i = 0; i < S.length; i++) {
      const beta = RHO[i] * dot(Y[i], q);
      for (let j = 0; j < n; j++) q[j] += S[i][j] * (alpha[i] - beta);
    }
    const d = q.map((v) => -v);
    let dg = dot(d, g);
    if (dg >= 0) { // not a descent direction: reset memory, use steepest descent
      S.length = Y.length = RHO.length = 0;
      for (let j = 0; j < n; j++) d[j] = -g[j] / Math.max(1, Math.sqrt(dot(g, g)));
      dg = dot(d, g);
    }
    const ls = lineSearch(f, x, fx, g, d, dg);
    evals += ls.evals;
    if (!ls.ok) { reason = 'line search failed'; break; }
    const s = new Float64Array(n), y = new Float64Array(n);
    for (let j = 0; j < n; j++) { s[j] = ls.x[j] - x[j]; y[j] = ls.g[j] - g[j]; }
    const sy = dot(s, y);
    if (sy > 1e-300) {
      S.push(s); Y.push(y); RHO.push(1 / sy);
      if (S.length > m) { S.shift(); Y.shift(); RHO.shift(); }
    }
    const fprev = fx;
    x = ls.x; fx = ls.f; g = ls.g;
    if (onIter && onIter(it + 1, x, fx) === false) { reason = 'stopped'; it++; break; }
    if (Math.abs(fprev - fx) <= 1e-15 * Math.max(Math.abs(fx), Math.abs(fprev), 1e-300)) { reason = 'converged'; it++; break; }
  }
  return { x, f: fx, g, iterations: it, evals, reason };
}

function lineSearch(f, x, f0, g0, d, dg0, c1 = 1e-4, c2 = 0.9) {
  const n = x.length;
  const at = (a) => {
    const xa = new Float64Array(n);
    for (let j = 0; j < n; j++) xa[j] = x[j] + a * d[j];
    const r = f(xa);
    return { a, x: xa, f: r.f, g: r.g, dg: dot(r.g, d) };
  };
  let evals = 0;
  let prev = { a: 0, f: f0, dg: dg0 };
  let a = 1;
  for (let i = 0; i < 20; i++) {
    const cur = at(a); evals++;
    if (!Number.isFinite(cur.f) || cur.f > f0 + c1 * a * dg0 || (i > 0 && cur.f >= prev.f)) {
      const z = zoom(at, f0, dg0, prev, cur, c1, c2); evals += z.evals;
      return { ...z.best, ok: z.ok, evals };
    }
    if (Math.abs(cur.dg) <= -c2 * dg0) return { ...cur, ok: true, evals };
    if (cur.dg >= 0) {
      const z = zoom(at, f0, dg0, cur, prev, c1, c2); evals += z.evals;
      return { ...z.best, ok: z.ok, evals };
    }
    prev = cur;
    a *= 2;
  }
  return { ok: false, evals };
}

function zoom(at, f0, dg0, lo, hi, c1, c2) {
  let evals = 0;
  let best = lo.x ? lo : null;
  for (let i = 0; i < 25; i++) {
    // Cubic interpolation between lo and hi, safeguarded to the middle 80 %.
    let a = cubicMin(lo, hi);
    const left = Math.min(lo.a, hi.a), right = Math.max(lo.a, hi.a), w = right - left;
    if (!Number.isFinite(a) || a < left + 0.1 * w || a > right - 0.1 * w) a = 0.5 * (lo.a + hi.a);
    const cur = at(a); evals++;
    if (!Number.isFinite(cur.f) || cur.f > f0 + c1 * a * dg0 || cur.f >= lo.f) {
      hi = cur;
    } else {
      if (Math.abs(cur.dg) <= -c2 * dg0) return { best: cur, ok: true, evals };
      if (cur.dg * (hi.a - lo.a) >= 0) hi = lo;
      lo = cur;
      best = cur;
    }
    if (Math.abs(hi.a - lo.a) < 1e-14) break;
  }
  // Accept the best sufficient-decrease point found, if any.
  return best && best.f < f0 ? { best, ok: true, evals } : { best: null, ok: false, evals };
}

function cubicMin(p, q) {
  if (p.dg === undefined || q.dg === undefined) return NaN;
  const d1 = p.dg + q.dg - (3 * (p.f - q.f)) / (p.a - q.a);
  const disc = d1 * d1 - p.dg * q.dg;
  if (disc < 0) return NaN;
  const d2 = Math.sign(q.a - p.a) * Math.sqrt(disc);
  return q.a - (q.a - p.a) * ((q.dg + d2 - d1) / (q.dg - p.dg + 2 * d2));
}
