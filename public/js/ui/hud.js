/**
 * HUD: everything DOM except the Poincaré canvas. The game controller pushes state in;
 * the HUD never reads physics. Kept small: level + next goal, the field error with stars,
 * plain-language alerts, a one-line hint and the tools. Engineering numbers live behind
 * "Engineering details".
 */
import { pct, RECORD_MARGIN } from '../game/scoring.js';
import { levelCode } from '../game/levels.js';

const $ = (id) => document.getElementById(id);

/** The ✦ threshold of a record level (beat the record by RECORD_MARGIN). */
const recordTarget = (level) => (1 - RECORD_MARGIN) * level.record.fieldError;

export class Hud {
  constructor() {
    this.el = {
      code: $('level-code'), title: $('level-title'), goal: $('goal'),
      err: $('tm-err'), stars: $('tm-stars'), research: $('tm-research'), trackFill: $('track-fill'), trackTicks: $('track-ticks'),
      score: $('tm-score'), details: $('details'), alerts: $('alerts'), hint: $('hint'), toasts: $('toasts'),
    };
    this.level = null;
    this.alertKey = '';
    this.hintKey = '';
  }

  setLevel(level) {
    this.level = level;
    this.el.code.textContent = levelCode(level);
    this.el.title.textContent = level.title;
    // Progress track: log scale from 30 % error (left) to just beyond the hardest target (right).
    const hardest = level.record ? recordTarget(level) : level.stars?.[2] ?? 1e-3;
    this.lo = Math.log10(0.3);
    this.hi = Math.log10(hardest / 1.6);
    this.el.trackTicks.innerHTML = '';
    const ticks = (level.stars ?? []).map((t) => ({ t, cls: 'tick' }));
    if (level.record) ticks.push({ t: recordTarget(level), cls: 'tick research' });
    for (const { t, cls } of ticks) {
      const d = document.createElement('div');
      d.className = cls;
      d.style.left = `${this.pos(t) * 100}%`;
      this.el.trackTicks.appendChild(d);
    }
    this.el.stars.hidden = !level.stars;
    this.el.research.hidden = true;
    this.el.alerts.innerHTML = '';
    this.alertKey = '';
    this.fillBriefing(level);
  }

  pos(err) {
    return Math.max(0, Math.min(1, (Math.log10(Math.max(err, 1e-9)) - this.lo) / (this.hi - this.lo)));
  }

  fillBriefing(level) {
    $('brief-code').textContent = levelCode(level);
    $('brief-title').textContent = level.title;
    $('brief-text').textContent = level.brief;
    const list = $('brief-stars');
    list.innerHTML = '';
    const rows = (level.stars ?? []).map((t, i) => [`${'★'.repeat(i + 1)}`, `field error ≤ ${pct(t)}`]);
    if (level.record) {
      rows.push(['✦', `beat the record (${pct(level.record.fieldError)}, ${level.record.cite}) by ${RECORD_MARGIN * 100} %, confirmed by a finer check and field-line tracing`]);
    }
    for (const [s, text] of rows) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="st">${s}</span><span>${text}</span>`;
      list.appendChild(li);
    }
    list.hidden = !rows.length;
    const L = level.limits;
    const parts = [`coils ≥ ${L.ccMin} m apart`];
    if (L.csMin) parts.push(`≥ ${L.csMin} m from the plasma`);
    parts.push(`curvature ≤ ${L.kappaMax} /m`);
    if (L.mscMax != null) parts.push(`mean-square curvature ≤ ${L.mscMax} /m²`);
    if (L.lengthMax != null) parts.push(`each coil ≤ ${L.lengthMax} m long`);
    if (L.totalLengthMax != null) parts.push(`all coils together ≤ ${L.totalLengthMax} m`);
    if (level.ports.length) parts.push(`${level.ports.length} ports kept clear`);
    const tol = L.tol != null ? ` Limits must hold to ${L.tol * 100} %.` : '';
    $('brief-limits').textContent = `Stars need a buildable design: ${parts.join(' · ')}.${tol}`;
  }

  /** m: stage-2 metrics; v: judge() verdict; extra: { backend, ms, mode, fps, currents, checking }; alerts: strings. */
  setMetrics(level, m, v, extra, alerts) {
    const e = this.el;
    e.err.textContent = pct(m.fieldError);
    e.err.parentElement.classList.toggle('hot', m.fieldError > 0.05);
    if (level.stars) {
      e.stars.innerHTML = level.stars.map((_, i) => `<span class="${i < v.stars ? 'on' : ''}">★</span>`).join('');
      e.stars.setAttribute('aria-label', `${v.stars} of 3 stars`);
      [...e.trackTicks.children].forEach((t, i) => {
        const thr = i < level.stars.length ? level.stars[i] : recordTarget(level);
        t.classList.toggle('met', v.valid && m.fieldError <= thr);
      });
    }
    e.research.hidden = !v.beat;
    e.trackFill.style.width = `${this.pos(m.fieldError) * 100}%`;
    e.score.textContent = v.valid ? v.score.toLocaleString('en-US') : '–';
    this.setGoal(level, m, v, extra);
    this.setAlerts(alerts);
    this.lastDetails = [level, m, extra];
    if (!e.details.hidden) this.fillDetails(level, m, extra);
  }

  setGoal(level, m, v, extra) {
    let html;
    if (!v.valid) html = 'Fix the red warnings to earn stars.';
    else if (v.beat) html = '<b>✦ New record.</b> Export it and check it in SIMSOPT.';
    else if (extra.checking) html = 'Possible new record: <b>checking</b> on a finer grid and tracing field lines…';
    else if (v.stars < 3) html = `Reach <b>${pct(level.stars[v.stars])}</b> field error for ${'★'.repeat(v.stars + 1)}`;
    else if (level.record) html = `Record: <b>${pct(level.record.fieldError)}</b> (${level.record.cite}). Beat it by ${RECORD_MARGIN * 100} % for ✦`;
    else html = '<b>★★★</b> Every star earned.';
    if (this.el.goal.innerHTML !== html) this.el.goal.innerHTML = html;
  }

  setAlerts(list) {
    const key = list.join('|');
    if (key === this.alertKey) return;
    this.alertKey = key;
    this.el.alerts.innerHTML = '';
    const shown = list.length > 2 ? [list[0], `${list.length - 1} more limits broken`] : list;
    for (const text of shown) {
      const d = document.createElement('div');
      d.className = 'alert';
      d.textContent = text;
      this.el.alerts.appendChild(d);
    }
  }

  toggleDetails() {
    const d = this.el.details;
    d.hidden = !d.hidden;
    $('btn-details').setAttribute('aria-expanded', String(!d.hidden));
    if (!d.hidden && this.lastDetails) this.fillDetails(...this.lastDetails);
  }

  fillDetails(level, m, extra) {
    const L = level.limits, rec = level.record, tol = L.tol ?? 0.005;
    const f = (v, d = 3) => v.toFixed(d);
    const kmax = Math.max(...m.kappaMax), mmax = Math.max(...m.msc);
    const rows = [
      ['Field error ⟨|B·n|⟩/⟨|B|⟩', `${pct(m.fieldError)}${rec ? ` (record ${pct(rec.fieldError)})` : ''}`, false],
      ['Worst |B·n|/|B|', `${pct(m.maxRatio)}${rec ? ` (record ${pct(rec.maxRatio)})` : ''}`, false],
    ];
    if (rec) rows.push(['Local squared flux (objective)', `${m.JfLocal.toExponential(3)} (record ${rec.JfLocal.toExponential(3)})`, false]);
    else rows.push(['Squared flux J_f', `${m.Jf.toExponential(3)} T²m²`, false]);
    rows.push(
      ['Mean |B|', `${f(m.B_mean)} T`, false],
      ['Closest coils', `${f(m.ccMin)} m (≥ ${L.ccMin})`, m.ccMin < L.ccMin * (1 - tol)],
      L.csMin ? ['Coil–plasma gap', `${f(m.csMin)} m (≥ ${L.csMin})`, m.csMin < L.csMin * (1 - tol)] : ['Coil–plasma gap', `${f(m.csMin)} m (no limit)`, false],
      ['Max curvature', `${f(kmax, 2)} /m (≤ ${L.kappaMax})`, kmax > L.kappaMax * (1 + tol)],
    );
    if (L.mscMax != null) rows.push(['Max mean-square curvature', `${f(mmax, 2)} /m² (≤ ${L.mscMax})`, mmax > L.mscMax * (1 + tol)]);
    if (L.totalLengthMax != null) rows.push(['Total coil length', `${f(m.totalLength, 3)} m (budget ${L.totalLengthMax})`, m.totalLength > L.totalLengthMax * (1 + tol)]);
    else rows.push(['Total coil length', `${f(m.totalLength, 2)} m${level.reference ? ` (SIMSOPT run ${level.reference.totalLength.toFixed(2)})` : ''}`, false]);
    if (extra.currents) rows.push(['Coil currents', extra.currents.map((I) => (I / 1000).toFixed(1)).join(', ') + ' kA', false]);
    const solver = [
      extra.backend?.startsWith('worker') ? 'web worker' : 'main thread',
      Number.isFinite(extra.ms) ? `${extra.ms.toFixed(0)} ms ${extra.mode ?? ''}`.trim() : '',
      Number.isFinite(extra.fps) ? `${Math.round(extra.fps)} fps` : '',
    ].filter(Boolean).join(' · ');
    this.el.details.innerHTML = rows.map(([k, v, bad]) => `<dt>${k}</dt><dd class="${bad ? 'bad' : ''}">${v}</dd>`).join('') + `<div class="solver">solver: ${solver}</div>`;
  }

  setHint(text, step = null) {
    const key = `${step}|${text}`;
    if (key === this.hintKey) return;
    this.hintKey = key;
    this.el.hint.innerHTML = '';
    if (step) {
      const s = document.createElement('span');
      s.className = 'step';
      s.textContent = step;
      this.el.hint.appendChild(s);
    }
    this.el.hint.appendChild(document.createTextNode(text));
  }

  setLinked(on) {
    $('btn-link').setAttribute('aria-pressed', String(on));
  }

  setRelaxing(on, available) {
    const b = $('btn-relax');
    b.hidden = !available;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.lbl').textContent = on ? 'Stop' : 'Relax';
    b.querySelector('.ico').textContent = on ? '■' : '✦';
  }

  setHistory(canUndo, canRedo) {
    $('btn-undo').disabled = !canUndo;
    $('btn-redo').disabled = !canRedo;
  }

  toast(text, kind = '', ms = 2600) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 2) this.el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), ms);
  }
}
