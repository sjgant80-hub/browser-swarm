// page/app.js — the page script. Every decision and every number on the page is computed by the inlined kernels above
// (CELLS, SWARM, SCORE, CLAIMS, COST, ADV …), from the published runs in data/runs/ or from a run made here, in this tab.
// scripts/make-page.mjs runs this same script at build time and bakes what it renders into index.html, so the page
// reads the same with scripts off; in the browser it renders again from the same data, and from your own run.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');
const usd = (x) => (Number.isFinite(x) ? (x >= 100 ? `$${Math.round(x).toLocaleString('en-GB')}` : `$${x.toFixed(2)}`) : '—');
const bind = (k, html) => { for (const el of document.querySelectorAll(`[data-bind="${k}"]`)) el.innerHTML = html; };
const getJSON = async (p) => { try { const r = await fetch(p); return r.ok ? await r.json() : null; } catch { return null; } };
const NM = '<span class="pend">not measured yet</span>';
const KIND_NAMES = { qa: 'documents', extract: 'receipt total', classify: 'banking intent', route: 'department', date: 'ISO date', pence: 'pence', draft: 'refund letter', knowledge: 'knowledge (should lose)', reasoning: 'reasoning (should lose)' };
const ORDER = ['qa', 'extract', 'classify', 'route', 'date', 'pence', 'draft', 'knowledge', 'reasoning'];
// the seven cells as the company desks they are; the check after every desk is compliance, not an eighth desk
const DESKS = {
  department: ['Intake', 'routes each incoming message to the right department, or says none of them'],
  'banking-intent': ['Customer desk', 'names what a banking customer is asking for'],
  'docs-answer': ['Research', 'answers from the company\'s signed documents, in the document\'s own words'],
  'receipt-total': ['Accounts: receipts', 'reads the total off a receipt'],
  pence: ['Accounts: amounts', 'turns an amount in pounds into whole pence'],
  'iso-date': ['Records: dates', 'writes any date the standard way'],
  'refund-letter': ['Correspondence', 'drafts a refund confirmation from a customer record'],
};
const deskName = (cell) => (DESKS[cell] ? DESKS[cell][0] : cell);
const TIERS = { 'Llama-3.2-1B-Instruct-q4f16_1-MLC': 'Llama 3.2 1B, 4-bit (laptop tier)', 'Qwen2.5-3B-Instruct-q4f16_1-MLC': 'Qwen2.5 3B, 4-bit (desktop tier)', 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': 'Qwen2.5 0.5B, 4-bit (phone tier)', 'SmolLM2-360M-Instruct-q4f16_1-MLC': 'SmolLM2 360M, 4-bit (lightest phone tier)' };
const SIZES = { 'Llama-3.2-1B-Instruct-q4f16_1-MLC': '879 MB', 'Qwen2.5-3B-Instruct-q4f16_1-MLC': '2.5 GB', 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC': '945 MB', 'SmolLM2-360M-Instruct-q4f16_1-MLC': '376 MB' };
const tierOf = (id) => TIERS[id] || String(id || 'unknown model');

const S = { canRun: false, data: null, ctx: null, engine: null, model: null, gpu: null, local: null, view: 'published', attacksLocal: null, foldLocal: null, busy: false, onToken: null, inbox: [], work: [], counts: {} };
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage off */ } },
};
try { performance.setResourceTimingBufferSize(100000); } catch { /* older browsers */ }

// ── the theme switch (light → dark → the device's own) ──
(function theme() {
  const root = document.documentElement;
  let t = null;
  try { t = localStorage.getItem('bs-theme'); } catch { /* storage off */ }
  if (t) root.dataset.theme = t;
  $('theme').addEventListener('click', () => {
    const next = root.dataset.theme === 'light' ? 'dark' : root.dataset.theme === 'dark' ? '' : 'light';
    if (next) root.dataset.theme = next; else delete root.dataset.theme;
    try { if (next) localStorage.setItem('bs-theme', next); else localStorage.removeItem('bs-theme'); } catch { /* storage off */ }
  });
})();

// ── the input box for each job: plain text both ways ──
const LINES = ['name', 'order', 'item', 'amount', 'date'];
function toText(kind, input) {
  if (kind === 'qa') return input.question;
  if (kind === 'extract') return input.receipt;
  if (kind === 'classify' || kind === 'route') return input.message;
  if (kind === 'date' || kind === 'pence') return input.text;
  if (kind === 'draft') return LINES.map((k) => `${k}: ${input.record[k]}`).join('\n');
  if (kind === 'knowledge' || kind === 'reasoning') return `${input.question.trim()}\n${['A', 'B', 'C', 'D'].map((k) => `${k}. ${input.options[k]}`).join('\n')}`;
  return '(nothing attached)';
}
function fromText(kind, text) {
  const t = String(text);
  if (kind === 'qa') return { question: t.trim() };
  if (kind === 'extract') return { receipt: t };
  if (kind === 'classify' || kind === 'route') return { message: t.trim() };
  if (kind === 'date' || kind === 'pence') return { text: t.trim() };
  if (kind === 'draft') { const r = {}; for (const l of t.split('\n')) { const m = l.match(/^\s*(\w+)\s*:\s*(.*)$/); if (m && LINES.includes(m[1])) r[m[1]] = m[2].trim(); } return { record: r }; }
  const lines = t.split('\n'), options = {}; const q = [];
  for (const l of lines) { const m = l.match(/^\s*([ABCD])[.)]\s*(.*)$/); if (m) options[m[1]] = m[2]; else q.push(l); }
  return { question: q.join('\n').trim(), options };
}

// ── which run is on show: the published runs, or the run made on this device ──
const IDS = new WeakMap();
const ids = (recs) => { let s = IDS.get(recs); if (!s || s.n !== recs.length) { s = { n: recs.length, set: new Set(recs.map((r) => r.id)) }; IDS.set(recs, s); } return s.set; };
function poolOf(split) {
  const suite = S.data.suite;
  if (split === 'test') return suite.test;
  if (split === 'dev') return suite.dev;
  return ORDER.flatMap((k) => suite.dev.filter((t) => t.kind === k).slice(0, 2));
}
const SPLIT_NAMES = { test: 'sealed test', dev: 'dev', sample: 'sample' };
function view(which) {
  const P = S.data.runs, L = S.local;
  const mine = which === 'mine' && !!L && L.records.gated.length > 0;
  const pool = mine ? poolOf(L.split) : S.data.suite.test;
  const tasks = mine ? pool.filter((t) => ids(L.records.gated).has(t.id) && ids(L.records.raw).has(t.id)) : pool;
  const tab = mine ? L : P.tab;
  const covers = (run, arm) => !!(run && run.records && run.records[arm] && tasks.length && tasks.every((t) => ids(run.records[arm]).has(t.id)));
  const M = (run, arm, venue) => (covers(run, arm) ? SCORE.metrics(tasks, run.records[arm], { ctx: S.ctx, arm, venue, model: run.model }) : null);
  // the frontier arm covers part of the test split (the wall's caps): it is scored over the tasks it covered, and the
  // swarm is scored again on exactly those tasks for the side-by-side
  const fr = P.frontier && P.frontier.records ? P.frontier.records.raw : null;
  const fcov = fr ? tasks.filter((t) => ids(fr).has(t.id)) : [];
  const swF = !!(tab && tab.records && fcov.length && fcov.every((t) => ids(tab.records.gated).has(t.id)));
  return {
    mine, pool, tasks, tab, fullTest: tasks.length === S.data.suite.test.length && (!mine || L.split === 'test'),
    swarm: M(tab, 'gated', 'tab'), raw1: M(tab, 'raw', 'tab'), gated7: M(P.big, 'gated', 'node'), raw7: M(P.big, 'raw', 'node'),
    node1g: M(P.node1b, 'gated', 'node'), node1r: M(P.node1b, 'raw', 'node'),
    frontier: fcov.length ? SCORE.metrics(fcov, fr, { ctx: S.ctx, arm: 'raw', venue: 'frontier', model: P.frontier.model }) : null,
    swarmF: swF ? SCORE.metrics(fcov, tab.records.gated, { ctx: S.ctx, arm: 'gated', venue: 'tab', model: tab.model }) : null,
  };
}
const evidence = (A, mine) => {
  const P = S.data.runs;
  return {
    swarm: A.swarm, swarmRaw: A.raw1, bigRaw: A.raw7, privacy: A.tab ? A.tab.privacy : null,
    attacks: mine ? S.attacksLocal : P.attacks, fold: mine ? (S.foldLocal ? S.foldLocal.summary : null) : (P.fold ? P.fold.summary : null),
    frontier: A.frontier, swarmOnFrontier: A.swarmF, frontierOf: A.frontier ? S.data.suite.test.length : null,
  };
};
const sourceOf = (run) => (run ? `${tierOf(run.model)}, in a browser tab (WebLLM 0.2.79), ${run.gpu || 'GPU not reported'}, ${String(run.at).slice(0, 10)}` : 'not measured yet');

function renderViewBar(A) {
  const L = S.local, P = S.data.runs;
  if (A.mine) {
    $('viewBar').innerHTML = `<b>Showing your run on this device.</b> ${A.tasks.length} of ${A.pool.length} ${SPLIT_NAMES[L.split] || L.split} tasks${L.complete ? '' : ' so far'}. ${esc(sourceOf(L))}. Every number below is from this run, except the 7B and frontier columns, which are the published ones on the same tasks. <button class="ghost" type="button" data-act="view-published">Show the published runs</button>`;
    return;
  }
  const saved = L && L.records.gated.length ? ` You have a run saved on this device: ${L.records.gated.length} ${SPLIT_NAMES[L.split] || L.split} tasks. <button class="ghost" type="button" data-act="view-mine">Show my run</button> <button class="ghost" type="button" data-act="discard-run">Discard it</button>` : '';
  $('viewBar').innerHTML = `<b>Showing the published runs.</b> Swarm and 1B raw: ${P.tab ? esc(sourceOf(P.tab)) : 'not measured yet'}. Press <i>Run it</i> in step 6 and every number on this page becomes your own device's.${saved}`;
}

// ── the six numbers, the chart, the tables ──
const COLS = [['swarm', 'swarm (1B, tab)'], ['raw1', '1B raw (tab)'], ['gated7', '7B gated'], ['raw7', '7B raw'], ['node1g', '1B gated (Ollama)'], ['frontier', 'frontier raw']];
const colName = (k, n, A) => (A.mine && k === 'swarm' ? 'swarm (this device)' : A.mine && k === 'raw1' ? 'same model unchecked (this device)' : n);
function renderSix(A) {
  const P = S.data.runs;
  const none = A.mine ? '<span class="pend">not run on these tasks</span>' : NM;
  const cell = (m, f) => (m ? f(m) : none);
  const g = (m) => { const x = CLAIMS.grounding(m); return x.of ? `${pct(x.grounded / x.of)} <span class="muted">(${x.grounded}/${x.of})</span>` : '—'; };
  const rows = [
    ['silent-failure rate', (m) => `<b class="${m.all.silent ? 'fail' : 'pass'}">${pct(m.all.silentRate)}</b> <span class="muted">(${m.all.silent})</span>`],
    ['accuracy, all tasks', (m) => pct(m.all.accuracy)],
    ['accuracy, bounded work', (m) => (m.bounded.tasks ? pct(m.bounded.accuracy) : '—')],
    ['accuracy, hard work (should lose)', (m) => (m.hard.tasks ? pct(m.hard.accuracy) : '—')],
    ['answers released', (m) => `${m.all.released} <span class="muted">(${pct(m.all.coverage, 0)})</span>`],
    ['wrong among released', (m) => pct(m.all.silentAmongReleased)],
    ['grounding: fact answers traced to source', g],
    ['median time per task', (m) => `${(m.all.medianMs / 1000).toFixed(2)} s`],
    ['cost per task', (m) => (m.venue === 'frontier' ? `≤ 1¢ <span class="muted">(${P.frontier.costCents}¢ booked for ${P.frontier.calls} calls)</span>` : '$0')],
    ['data left the device', (m) => (m.venue === 'tab' ? `no <span class="muted">(${A.tab && A.tab.privacy ? A.tab.privacy.requests : '?'} requests)</span>` : m.venue === 'frontier' ? '<span class="fail">yes: to the API</span>' : 'no (127.0.0.1)')],
  ];
  $('six').innerHTML = `<table><thead><tr><th>measure</th>${COLS.map(([k, n]) => `<th class="num">${esc(colName(k, n, A))}${A[k] ? `<br><span class="muted small">${A[k].all.tasks} tasks</span>` : ''}</th>`).join('')}</tr></thead><tbody>`
    + rows.map(([label, f]) => `<tr><td>${esc(label)}</td>${COLS.map(([k]) => `<td class="num">${cell(A[k], f)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  const src = [
    `Swarm and 1B raw: ${A.tab ? esc(sourceOf(A.tab)) + (A.tab.sealSha256 ? `, seal ${esc(String(A.tab.sealSha256).slice(0, 12))}` : '') : 'not measured yet'}.`,
    P.big ? `7B: Qwen2.5 7B (Ollama Q4_K_M), an Intel i7-1255U laptop processor, 127.0.0.1, ${esc(String(P.big.at).slice(0, 10))}.` : '7B: not measured yet.',
    P.node1b ? `1B on Ollama: Llama 3.2 1B (Q8_0), the same processor, ${esc(String(P.node1b.at).slice(0, 10))}: a cross-check of the venue.` : '1B on Ollama: not measured yet.',
    P.frontier ? `Frontier: ${esc(P.frontier.model)} at medium effort, ${P.frontier.covered} of ${P.frontier.of} test tasks in a seeded order, ${esc(String(P.frontier.at).slice(0, 10))}.` : 'Frontier: not measured yet.',
  ];
  $('sixNote').innerHTML = `Sources. ${src.join(' ')}`;
}
function renderMoney(A) {
  const bars = [[A.mine ? 'swarm (this device)' : 'swarm (1B, tab)', A.swarm, 'var(--series)'], ['7B gated', A.gated7, 'var(--series3)'], [A.mine ? 'same model unchecked' : '1B raw (tab)', A.raw1, 'var(--series2)'], ['7B raw', A.raw7, 'var(--series2)'], ['frontier raw', A.frontier, 'var(--series2)']];
  const max = Math.max(0.1, ...bars.map(([, m]) => (m ? m.all.silentRate : 0)));
  const W = 500, x0 = 200;
  $('money').innerHTML = `<title>Silent-failure rate by arm</title>` + bars.map(([name, m, col], i) => {
    const y = 14 + i * 62, w = m ? Math.max(2, (m.all.silentRate / max) * W) : W * 0.1;
    return `<text x="${x0 - 10}" y="${y + 19}" text-anchor="end">${esc(name)}</text>` +
      (m ? `<rect x="${x0}" y="${y}" width="${w.toFixed(1)}" height="28" rx="4" fill="${col}"/><text x="${(x0 + w + 8).toFixed(1)}" y="${y + 19}">${pct(m.all.silentRate)}</text><text x="${x0}" y="${y + 46}" class="muted">${m.all.silent} of ${m.all.tasks} tasks delivered wrong as if right</text>`
        : `<rect x="${x0}" y="${y}" width="${w}" height="28" rx="4" fill="none" stroke="var(--muted)" stroke-dasharray="4 4"/><text x="${x0 + w + 8}" y="${y + 19}" class="muted">${A.mine ? 'not run on these tasks' : 'not measured yet'}</text>`);
  }).join('');
  bind('money.note', A.frontier && A.swarmF
    ? `The frontier bar covers the ${A.frontier.all.tasks} tasks its run reached: a seeded sample across every kind, stopped by the spend caps. On exactly those tasks, the swarm released a wrong answer as if right ${A.swarmF.all.silent} times (${pct(A.swarmF.all.silentRate)}) and was right on ${pct(A.swarmF.all.accuracy)}. The frontier model did so ${A.frontier.all.silent} times (${pct(A.frontier.all.silentRate)}) and was right on ${pct(A.frontier.all.accuracy)}. It is far more accurate, and its errors still arrive looking like answers. ${(() => { const p = SCORE.pairedSilent(A.swarmF, A.frontier); return p.p < 0.05 ? `The swarm's lower rate of silent failures is statistically significant on these tasks (exact McNemar p = ${p.p.toPrecision(2)}).` : `On this sample the swarm's lower rate of silent failures is <b>not</b> statistically significant (exact McNemar p = ${p.p.toPrecision(2)}): it is not shown to beat the frontier model on this measure.`; })()}`
    : A.frontier ? `The frontier bar covers the ${A.frontier.all.tasks} tasks its run reached. The swarm's figures on the same tasks are not measured yet.` : 'The frontier comparison is not measured yet.');
}
function renderKinds(A) {
  const k = (m, kind, f) => (m && m.byKind[kind] ? f(m.byKind[kind]) : '—');
  const sw = A.swarm, who = A.mine ? 'this device' : 'swarm';
  const kinds = ORDER.filter((kind) => A.tasks.some((t) => t.kind === kind));
  $('kinds').innerHTML = `<table><thead><tr><th>kind</th><th class="num">tasks</th><th class="num">${who}: right</th><th class="num">${who}: silent</th><th class="num">${who}: released</th><th class="num">same model unchecked: silent</th><th class="num">7B raw: right</th><th class="num">7B raw: silent</th></tr></thead><tbody>`
    + (sw ? kinds.map((kind) => `<tr><td>${esc(KIND_NAMES[kind])}</td><td class="num">${k(sw, kind, (x) => x.tasks)}</td><td class="num">${k(sw, kind, (x) => x.correct)}</td><td class="num">${k(sw, kind, (x) => (x.silent ? `<span class="fail">${x.silent}</span>` : '0'))}</td><td class="num">${k(sw, kind, (x) => x.released)}</td>`
      + `<td class="num">${k(A.raw1, kind, (x) => (x.silent ? `<span class="fail">${x.silent}</span>` : '0'))}</td><td class="num">${k(A.raw7, kind, (x) => x.correct)}</td><td class="num">${k(A.raw7, kind, (x) => (x.silent ? `<span class="fail">${x.silent}</span>` : '0'))}</td></tr>`).join('')
      : `<tr><td colspan="8">${NM}</td></tr>`) + '</tbody></table>';
}
const NAMES = { H: 'Headline: the swarm\'s silent-failure rate', B1: 'Match-or-close on bounded work', B2: 'The honest loss on hard work', G: 'Grounding', P: 'Privacy', L: 'Latency', $: 'Cost', A1: 'A1 tampered corpus', A2: 'A2 poisoned twin', A2b: 'A2b lie at the source', A3: 'A3 prompt injection', A4: 'A4 engineered wrong answers', F: 'Fold-cache', X: 'Frontier arm' };
const badge = (v) => (v.pass === true ? '<span class="pass">PASS</span>' : v.pass === false ? '<span class="fail">FAIL</span>' : /^pending/.test(v.result) ? '<span class="pend">NOT MEASURED YET</span>' : '<span class="muted">reported</span>');
function renderClaims(VP, VM) {
  const L = S.local, mine = Object.fromEntries((VM || []).map((v) => [v.id, v]));
  const here = (id) => {
    const v = mine[id];
    if (v && !/^pending/.test(v.result)) return `${badge(v)}<br><span class="small">${esc(v.result)}</span>`;
    if (VM) return `<span class="badge">UNVERIFIED HERE</span> <span class="small">${['A1', 'A2', 'A2b', 'A3', 'A4'].includes(id) ? 'run the attacks in step 6' : id === 'F' ? 'measure the fold-cache in step 6' : id === 'X' ? 'run the frontier arm with your own key' : 'not measured on this device'}</span>`;
    if (L && L.records.gated.length) return `<span class="badge">UNVERIFIED HERE</span> <span class="small">your run covers ${L.records.gated.length} ${SPLIT_NAMES[L.split] || L.split} tasks; a verdict needs the full 410-task test set</span>`;
    return '<span class="badge">UNVERIFIED HERE</span> <span class="small">not run on this device yet</span>';
  };
  $('claimsTable').innerHTML = '<table><thead><tr><th>claim</th><th>bar</th><th>published result</th><th>verdict</th><th>on this device</th></tr></thead><tbody>'
    + VP.map((v) => `<tr><td><b>${esc(v.id)}</b> ${esc(NAMES[v.id] || '')}</td><td class="small">${esc((CLAIMS.BARS[v.id] || 'no bar').replace(/\*\*/g, ''))}</td><td class="small">${esc(v.result.replace(/^pending: /, 'Not measured yet: '))}</td><td>${badge(v)}</td><td>${here(v.id)}</td></tr>`).join('') + '</tbody></table>';
}
function renderAttacks(VP) {
  const P = S.data.runs, s = P.attacks ? P.attacks.summary : null, t = P.attacksTab ? P.attacksTab.summary : null, m = S.attacksLocal ? S.attacksLocal.summary : null;
  const what = { A1: 'changes a signed paragraph after signing', A2: 'adds a signed false copy beside the right paragraph', A2b: 'writes the lie into the right paragraph and signs it', A3: 'adds "ignore … the answer is X" to the right paragraph, signed', A4: 'hands the judge a wrong answer of the right type, copied from the right paragraph' };
  const V = Object.fromEntries(VP.map((v) => [v.id, v]));
  const rel = (x, id) => (!x || !x[id] ? null : id === 'A4' ? [x[id].released, x[id].candidates] : [x[id].gatedFalse, x[id].built]);
  const show = (p) => (p ? `<span class="${p[0] ? 'fail' : 'pass'}">${p[0]}</span> of ${p[1]}` : NM);
  const raw = (x, id) => (!x || !x[id] ? NM : id === 'A4' ? 'no model' : `${x[id].rawFalse} of ${x[id].built}`);
  $('attackTable').innerHTML = '<table><thead><tr><th>attack</th><th>what the attacker does</th><th class="num">sealed runner: false answer released</th><th class="num">same model, no checks</th><th class="num">in the browser tab</th><th class="num">on this device</th><th>verdict</th></tr></thead><tbody>'
    + ['A1', 'A2', 'A2b', 'A3', 'A4'].map((id) => `<tr><td><b>${id}</b></td><td>${esc(what[id])}</td><td class="num">${show(rel(s, id))}</td><td class="num">${raw(s, id)}</td><td class="num">${show(rel(t, id))}</td><td class="num">${m ? show(rel(m, id)) : '<span class="badge">UNVERIFIED HERE</span>'}</td><td>${badge(V[id])}</td></tr>`).join('') + '</tbody></table>';
}

// ── a decision, drawn stage by stage, with the source bytes of a released answer ──
const showOut = (o) => esc(o.answer ?? o.value ?? o.label ?? o.domain ?? o.iso ?? o.pence ?? o.letter ?? JSON.stringify(o));
function stages(task, g, r, ctx) {
  const st = (ok, title, body) => `<div class="stage ${ok ? 'ok' : 'no'}"><b>${esc(title)}</b><br>${body}</div>`;
  const out = [];
  out.push(st(!!g.cell, 'Conductor', g.cell ? `routed to <b>${esc(deskName(g.cell))}</b> <span class="muted">(<code>${esc(g.cell)}</code>)</span>` : `no desk owns this job: ${esc(g.why)}`));
  if (g.cell) {
    const laneNo = g.stage === 'lane';
    out.push(st(!laneNo, 'Lane check, before the model', laneNo ? `refused, and the model never ran: ${esc(String(g.why).split(': ').slice(-1)[0])}` : 'in lane: the model may run'));
    if (!laneNo) {
      out.push(st(true, 'The model wrote', g.calls.map((c) => `<code>${esc(String(c.text).slice(0, 300))}</code>`).join(' · ') || '<span class="muted">(nothing)</span>'));
      if (g.stage === 'act') out.push(st(false, 'The model declined', esc(String(g.why).replace(/^the act refused: /, ''))));
      else out.push(st(g.released, g.cell === 'docs-answer' ? 'Cite check, after the model' : 'Compliance check, after the model', g.released ? 'verified' : esc(g.why)));
      const gr = g.released ? g.ground : null, doc = gr && gr.source && ctx ? ctx.byId.get(gr.source) : null;
      if (doc) out.push(st(true, 'Source', `<code>${esc(gr.source)}</code>, characters ${gr.start}–${gr.end}, signature <code>${esc(String(ctx.manifest.get(gr.source)).slice(0, 12))}…</code> matches<br><span class="small">${gr.start > 90 ? '… ' : ''}${esc(doc.text.slice(Math.max(0, gr.start - 90), gr.start))}<mark>${esc(doc.text.slice(gr.start, gr.end))}</mark>${esc(doc.text.slice(gr.end, gr.end + 90))}${gr.end + 90 < doc.text.length ? ' …' : ''}</span>`));
    }
  }
  out.push(`<div class="verdict ${g.released ? 'ok' : 'no'}">${g.released ? `Released: ${showOut(g.output)}` : 'Withheld: the swarm says it cannot answer this'}</div>`);
  if (r) {
    const judged = task && task.gold ? (r.released && SCORE.right(task, r.output) ? ' · <span class="pass">right</span>' : r.released ? ' · <span class="fail">wrong, delivered as if right</span>' : '') : '';
    out.push(`<p class="small">The same model with no checks: ${r.released ? `<b>${showOut(r.output)}</b>` : 'no answer'}${judged}</p>`);
  }
  return out.join('');
}
async function renderTrace(A) {
  const t = A.tab;
  if (!t || !t.records.gated.length) { $('trace').innerHTML = NM; return; }
  const tasks = new Map(A.pool.map((x) => [x.id, x]));
  const pick = [t.records.gated.find((g) => g.released && g.kind === 'qa'), t.records.gated.find((g) => g.status === 'unverified'), t.records.gated.find((g) => g.stage === 'lane')].filter(Boolean);
  const parts = [];
  for (const rec of pick) {
    const task = tasks.get(rec.id), again = await SWARM.replay(task, rec, S.ctx);
    const raw = t.records.raw.find((x) => x.id === rec.id);
    const same = JSON.stringify([again.released, again.status, again.why]) === JSON.stringify([rec.released, rec.status, rec.why]);
    parts.push(`<div class="card"><p class="small muted">${esc(KIND_NAMES[task.kind])} · <code>${esc(task.id)}</code> · re-decided on this page: ${same ? '<span class="pass">same decision</span>' : '<span class="fail">different</span>'}</p><pre>${esc(toText(task.kind, task.input).slice(0, 600))}</pre>${stages(task, again, raw ? await SWARM.replay(task, raw, S.ctx) : null, S.ctx)}</div>`);
  }
  $('trace').innerHTML = parts.join('') || NM;
}

// ── the cost case (COST kernel) ──
function renderCost(A) {
  const pr = S.data.prices, m = pr && pr.models ? pr.models['claude-opus-5-5'] : null;
  bind('price.read', esc(pr ? pr.read : 'not read yet')); bind('price.model', m ? `the largest listed model, $${m.in} in and $${m.out} out per million tokens` : 'no price on file');
  const t = A.tab;
  const tok = t && Array.isArray(t.usage) ? COST.tokens(t.usage.map((u) => ({ calls: u }))) : { prompt: null, reply: null, callsPerTask: null };
  const c = COST.costCase({ prompt: tok.prompt, reply: tok.reply, callsPerTask: tok.callsPerTask, tasksPerMonth: Number($('tpm').value), price: m, silentSwarm: A.swarm ? A.swarm.all.silentRate : null, silentRaw: A.raw1 ? A.raw1.all.silentRate : null, costPerSilent: $('cps').value === '' ? null : Number($('cps').value) });
  bind('cost.api', c.apiPerMonth === null ? NM : usd(c.apiPerMonth));
  bind('cost.apiNote', tok.prompt === null ? 'needs the tab run\'s token counts' : `${Math.round(tok.prompt)} prompt and ${Math.round(tok.reply)} reply tokens a call, ${tok.callsPerTask.toFixed(2)} calls a task, measured in the tab run; at ${Number($('tpm').value).toLocaleString('en-GB')} tasks a month`);
  bind('cost.silent', c.silentAvoidedPerMonth === null ? NM : Math.round(c.silentAvoidedPerMonth).toLocaleString('en-GB'));
  bind('cost.silentCost', c.silentCostAvoided === null ? 'enter your figure' : usd(c.silentCostAvoided));
}

function renderHeadline(A, V) {
  const sw = A.swarm, r1 = A.raw1, of = (m) => `${pct(m.all.silentRate)} <span class="muted">(${m.all.silent} of ${m.all.tasks})</span>`;
  bind('hl.swarm', sw ? of(sw) : NM); bind('hl.raw1', r1 ? of(r1) : NM); bind('hl.raw7', A.raw7 ? of(A.raw7) : NM); bind('hl.frontier', A.frontier ? of(A.frontier) : NM);
  bind('hl.privacy', A.tab && A.tab.privacy ? `${A.tab.privacy.requests} requests` : NM);
  const acc = (m) => (m && m.bounded.tasks ? `${pct(m.bounded.accuracy)} <span class="muted">(${m.bounded.correct} of ${m.bounded.tasks})</span>` : NM);
  bind('hl.acc', acc(sw)); bind('hl.acc7', acc(A.raw7)); bind('hl.gated7', A.gated7 ? `${of(A.gated7)}, ${pct(A.gated7.bounded.accuracy)} of bounded work right` : NM);
  bind('b.people', sw ? `every job it hands back (on the sealed test it handed back ${sw.all.tasks - sw.all.released} of ${sw.all.tasks}), everything hard or open, and spot checks of what it releases.` : 'the share is not measured yet.');
  bind('b.spot', sw ? `Of the ${sw.all.released} answers it released on the sealed test, ${sw.all.silent} were wrong (${pct(sw.all.silentAmongReleased)}).` : 'The share is not measured yet.');
  bind('hl.price', sw && sw.bounded.tasks ? `the swarm refuses far more than it answers. It released an answer on ${sw.all.released} of ${sw.all.tasks} tasks and got ${pct(sw.bounded.accuracy)} of the bounded work right${A.raw7 ? `, where a model seven times larger with no checks got ${pct(A.raw7.bounded.accuracy)}` : ''}. The claim that it would come close on accuracy <span class="fail">failed</span>. Of the ${sw.all.released} answers it released, ${sw.all.silent} were wrong (${pct(sw.all.silentAmongReleased)})${r1 ? `; of the ${r1.all.released} the same model released unchecked, ${r1.all.silent} were wrong (${pct(r1.all.silentAmongReleased)})` : ''}.` : 'The trade-off is not measured yet.');
  const where = A.mine ? `your run on this device (${esc(tierOf(A.tab.model))})` : A.tab ? `the published tab run (${esc(sourceOf(A.tab))})` : 'the published runs';
  if (V) {
    const failed = V.filter((v) => v.pass === false).map((v) => v.id), passed = V.filter((v) => v.pass === true).map((v) => v.id), open = V.filter((v) => v.pass === null && /^pending/.test(v.result)).map((v) => v.id);
    bind('hl.note', `Source: ${where}. Of the pre-registered claims, <span class="pass">${passed.length} pass</span> (${esc(passed.join(', ') || 'none')}) and <span class="fail">${failed.length} fail</span> (${esc(failed.join(', ') || 'none')})${open.length ? `; not measured yet: ${esc(open.join(', '))}` : ''}. Every verdict is computed on this page, and the failures stay.`);
  } else bind('hl.note', `Source: ${where}. Your run is not the full sealed test set, so the claims carry no verdict from it yet.`);
  bind('b.vs', sw && r1 ? `The swarm delivered a wrong answer as if right on ${pct(sw.all.silentRate)} of ${sw.all.tasks} tasks, against ${pct(r1.all.silentRate)} for the same model unchecked${A.raw7 ? `, ${pct(A.raw7.all.silentRate)} for a model seven times its size` : ''}${A.frontier ? ` and ${pct(A.frontier.all.silentRate)} for a frontier cloud model on the ${A.frontier.all.tasks} tasks it ran` : ''}.` : 'The comparison is not measured yet.');
  bind('b.req', A.tab && A.tab.privacy ? `During the suite run the page made <b>${A.tab.privacy.requests}</b> network requests, counted by the browser itself.` : 'The network-request count is not measured yet.');
  bind('b.board', sw && r1 ? `On ${sw.all.tasks} sealed tasks, the checks cut the confidently wrong answers from ${r1.all.silent} to ${sw.all.silent}.` : 'The cut in confidently wrong answers is not measured yet.');
  const H = V ? V.find((v) => v.id === 'H') : null;
  bind('p.result', sw && H ? `${esc(H.result)}. The headline claim ${H.pass === true ? '<span class="pass">passes</span>' : H.pass === false ? '<span class="fail">fails</span> its bar, and stays on this page failed' : 'has no verdict yet'}. Bounded accuracy: swarm ${pct(sw.bounded.accuracy)}${A.raw7 ? ` against the 7B raw's ${pct(A.raw7.bounded.accuracy)}` : ''}. Hard work: swarm ${pct(sw.hard.accuracy)}${A.raw7 ? `, 7B raw ${pct(A.raw7.hard.accuracy)}` : ''}. The full table is above.` : sw ? `On the ${sw.all.tasks} tasks run so far: ${sw.all.silent} silent failures for the swarm, ${r1 ? r1.all.silent : '?'} for the same model unchecked.` : 'Not measured yet.');
  const F = V ? V.find((v) => v.id === 'F') : null;
  bind('bp.fold', F && F.pass === true ? '<span class="pass">measured: it helps (F passes)</span>' : F && F.pass === false ? '<span class="fail">measured: no gain (F fails)</span>' : '<span class="pend">not measured yet</span>');
}
function renderWalk() {
  const w = S.data.walk;
  if (!w) { $('walk').innerHTML = ''; return; }
  $('walk').innerHTML = `<h3>A simulated buyer walk</h3><p class="small muted">${esc(w.note)}</p>` + w.personas.map((p) => `<details><summary>${esc(p.who)}: ${esc(p.verdict)}</summary><ul>${p.gaps.map((g) => `<li>${esc(g.gap)} <span class="muted">→ ${esc(g.fix)}</span></li>`).join('')}</ul></details>`).join('');
}

// ── the company at work: the desks, the inbox, the gauges ──
function inboxOf(dev) {
  const first = (f) => dev.find(f);
  return [
    first((t) => t.kind === 'route' && t.gold.domain), first((t) => t.kind === 'classify'), first((t) => t.kind === 'qa' && !t.gold.impossible), first((t) => t.kind === 'extract'),
    { id: 'inbox:no-desk', kind: null, request: 'Book me a flight to Lisbon next Tuesday.', input: {}, gold: null, noDesk: true },
    first((t) => t.kind === 'pence'), first((t) => t.kind === 'date'), first((t) => t.kind === 'draft'),
    first((t) => t.kind === 'qa' && t.gold.impossible && t.gold.reason === 'not in the corpus'), first((t) => t.kind === 'route' && t.gold.domain === null), dev.filter((t) => t.kind === 'classify')[1],
  ].filter(Boolean);
}
function renderDesks() {
  $('desks').innerHTML = CELLS.CELLS.map((c) => {
    const n = S.counts[c.name] || { handled: 0, released: 0, withheld: 0 };
    return `<div class="card desk"><b>${esc(deskName(c.name))}</b><br><span class="small">${esc(DESKS[c.name][1])}</span><br><span class="small muted">this session: ${n.handled} handled · ${n.released} released · ${n.withheld} withheld</span></div>`;
  }).join('') + '<div class="card desk"><b>Compliance</b><br><span class="small">not a desk: the check after every desk, written as code, never a model. Nothing leaves without it.</span></div>';
}
function renderGauges() {
  const done = S.work.filter((w) => w && w.g), n = done.length;
  const sil = done.filter((w) => w.og.silent).length, rawSil = done.filter((w) => w.or && w.or.silent).length;
  const med = n ? STATS.median(done.map((w) => w.g.ms)) : null;
  $('gauges').innerHTML = [['jobs handled', `${n} of ${S.inbox.length}`, ''], ['released', done.filter((w) => w.g.released).length, ''], ['withheld or refused', done.filter((w) => !w.g.released).length, ''],
    ['swarm: wrong delivered as right', sil, sil ? 'fail' : 'pass'], ['same model unchecked: wrong delivered as right', rawSil, rawSil ? 'fail' : ''], ['median time per job', med === null ? '—' : `${(med / 1000).toFixed(2)} s`, '']]
    .map(([k, v, c]) => `<span class="chip">${esc(k)} <b class="${c}">${v}</b></span>`).join('');
}
function renderInbox() {
  $('inbox').innerHTML = S.inbox.map((t, i) => {
    const w = S.work[i];
    const head = `<p class="small"><b>${i + 1}.</b> “${esc(t.request)}”</p><pre>${esc(toText(t.kind, t.input).slice(0, 320))}</pre>`;
    if (!w) return `<div class="card">${head}<p class="small muted">waiting in the inbox</p></div>`;
    if (!w.g) return `<div class="card">${head}<p class="small"><b>working…</b> the model's words, as it writes them:</p><pre id="liveTokens" class="live"></pre></div>`;
    const mark = t.noDesk ? (w.g.released ? '<span class="fail">released a job no desk owns</span>' : '<span class="pass">rightly refused</span>')
      : w.og.silent ? '<span class="fail">SILENT FAILURE: released, and wrong</span>' : w.og.correct ? (w.g.released ? '<span class="pass">released, and right</span>' : '<span class="pass">rightly refused</span>') : '<span class="pend">withheld: a right answer existed, and the swarm would not vouch for it</span>';
    return `<details class="card" ${i === S.work.length - 1 ? 'open' : ''}><summary>${i + 1}. ${esc(w.g.cell ? deskName(w.g.cell) : 'no desk')} · ${mark}</summary>${head}${stages(t.noDesk ? null : t, w.g, w.r, S.ctx)}</details>`;
  }).join('');
}
async function workRun() {
  if (!(await needModel($('gauges')))) return;
  setBusy(true); S.work = []; S.counts = {};
  const call = SWARM.caller(ask);
  S.onToken = (text) => { const el = $('liveTokens'); if (el) el.textContent = text; };
  for (const [i, t] of S.inbox.entries()) {
    S.work[i] = {}; renderInbox();
    const g = await SWARM.gated(t, call, S.ctx), r = t.noDesk ? null : await SWARM.raw(t, call, S.ctx);
    const og = t.noDesk ? { released: g.released, correct: !g.released, silent: g.released } : SCORE.outcome(t, g);
    S.work[i] = { g, r, og, or: r ? SCORE.outcome(t, r) : null };
    if (g.cell) { const n = S.counts[g.cell] || (S.counts[g.cell] = { handled: 0, released: 0, withheld: 0 }); n.handled++; if (g.released) n.released++; else n.withheld++; }
    renderInbox(); renderDesks(); renderGauges();
  }
  S.onToken = null; setBusy(false);
}

async function renderAll() {
  const AP = view('published'), VP = CLAIMS.evaluate(evidence(AP, false));
  const AM = S.local && S.local.records.gated.length ? view('mine') : null;
  const VM = AM && AM.fullTest && S.local.complete ? CLAIMS.evaluate(evidence(AM, true)) : null;
  const A = S.view === 'mine' && AM ? AM : AP, V = A === AM ? VM : VP;
  renderViewBar(A); renderHeadline(A, V); renderSix(A); renderMoney(A); renderKinds(A); renderClaims(VP, VM); renderAttacks(VP); renderCost(A); renderWalk(); renderDesks(); renderGauges(); renderInbox();
  await renderTrace(A);
}

// ── re-judge every published decision from its recorded reply ──
async function rejudge() {
  const out = $('rejudgeOut'); out.innerHTML = '<p class="small">Replaying…</p>';
  const tasks = new Map(S.data.suite.test.map((x) => [x.id, x]));
  const key = (r) => JSON.stringify([r.released, r.status ?? null, r.output ?? null, r.why]);
  const P = S.data.runs, lines = [];
  for (const [name, run, armsOf] of [['the tab run', P.tab, ['gated', 'raw']], ['the 7B run', P.big, ['gated', 'raw']], ['the 1B Ollama run', P.node1b, ['gated', 'raw']], ['the frontier run', P.frontier, ['raw']]]) {
    if (!run) { lines.push(`<li>${name}: not published yet</li>`); continue; }
    let n = 0, same = 0;
    for (const arm of armsOf) for (const rec of run.records[arm]) { n++; if (key(await SWARM.replay(tasks.get(rec.id), rec, S.ctx)) === key(rec)) same++; }
    lines.push(`<li>${name}: <b>${same} of ${n}</b> decisions identical ${same === n ? '<span class="pass">✓</span>' : '<span class="fail">differs</span>'}</li>`);
  }
  out.innerHTML = `<ul>${lines.join('')}</ul><p class="small muted">Each decision is re-derived from the recorded reply by the code on this page: the conductor, lane, guard and judge run for real.</p>`;
}

// ── the model in this tab ──
const MODEL_BUTTONS = ['ask', 'docsAsk', 'run', 'work', 'attackRun', 'fold'];
function setBusy(b) { S.busy = b; for (const id of MODEL_BUTTONS) $(id).disabled = b || !S.canRun; }
// needModel() → true once the model is in this tab, loading it first when it is not (so every button is one click)
async function needModel(note) {
  if (S.engine) return true;
  if (note) note.textContent = 'Loading the model first: its progress is shown in step 2.';
  setBusy(true); await load(); setBusy(false);
  if (note) note.textContent = S.engine ? '' : 'The model did not load: see step 2.';
  return !!S.engine;
}
async function device() {
  const off = (why) => { $('devStatus').innerHTML = `<span class="fail">${why}</span> The model cannot run in this browser, so steps 2 to 6 are switched off here. Everything measured is still on this page, and step 7 re-checks every published decision in this browser without a model. To run it yourself, open this page in a current Chrome or Edge on a laptop or desktop.`; $('load').disabled = true; return null; };
  if (!('gpu' in navigator)) return off('This browser has no WebGPU.');
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return off('WebGPU is present, but this device offered no GPU adapter.');
    const info = a.info || {};
    S.gpu = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'a WebGPU adapter';
    S.canRun = true; setBusy(false);
    $('devStatus').innerHTML = `<span class="pass">Ready:</span> ${esc(S.gpu)}${a.features && a.features.has('shader-f16') ? ', 16-bit shaders' : ', no 16-bit shaders (the 4-bit builds may not load)'}.`;
    return a;
  } catch (e) { return off(`The WebGPU check failed: ${esc(e.message)}.`); }
}
let usageNow = null;
// one call to the model in this tab, streamed: the words are shown as they arrive, and the time to the first one is kept
async function ask(messages, maxTokens) {
  const t0 = performance.now();
  let text = '', ttft = null, usage = null;
  const stream = await S.engine.chat.completions.create({ messages, temperature: 0, top_p: 1, max_tokens: maxTokens, seed: 0, stream: true, stream_options: { include_usage: true } });
  for await (const ch of stream) {
    const d = ch.choices && ch.choices[0] && ch.choices[0].delta ? ch.choices[0].delta.content : '';
    if (d) { if (ttft === null) ttft = (performance.now() - t0) / 1000; text += d; if (S.onToken) S.onToken(text); }
    if (ch.usage) usage = ch.usage;
  }
  const u = usage || {};
  if (usageNow) usageNow.push({ prompt: u.prompt_tokens ?? null, reply: u.completion_tokens ?? null });
  return { text, ms: Math.round(performance.now() - t0), ttft, prompt: u.prompt_tokens ?? null };
}
async function load() {
  const id = $('tier').value, t0 = Date.now();
  $('load').disabled = true; $('loadStatus').textContent = 'Fetching the WebLLM 0.2.79 library…';
  try {
    const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.79');
    let cached = false;
    try { cached = await webllm.hasModelInCache(id); } catch { /* treat as a first visit */ }
    $('loadStatus').textContent = cached ? 'Found in this browser\'s storage: loading from your own disk, no download…' : `First visit: downloading ${SIZES[id] || 'the model'} from the MLC project's published build…`;
    S.engine = await webllm.CreateMLCEngine(id, { initProgressCallback: (p) => { $('loadBar').style.width = `${Math.round((p.progress || 0) * 100)}%`; $('loadStatus').textContent = `${cached ? 'From your disk' : 'Downloading'}: ${p.text || ''}`; } });
    S.model = id;
    $('loadBar').style.width = '100%';
    $('loadStatus').innerHTML = `<span class="pass">Loaded in ${Math.round((Date.now() - t0) / 1000)} s:</span> ${esc(tierOf(id))}, ${cached ? 'from this browser\'s storage, with no download' : `downloaded once (${SIZES[id] || ''}) and now kept in this browser\'s storage`}.`;
    setBusy(false);
  } catch (e) { $('loadStatus').innerHTML = `<span class="fail">Could not load:</span> ${esc(e.message || e)}`; $('load').disabled = false; }
}

// ── step 4: your own job ──
let exampleAt = 0;
function example() {
  const kind = $('askKind').value, list = S.data.suite.dev.filter((t) => t.kind === kind);
  const t = list[exampleAt++ % list.length];
  $('askInput').value = toText(kind, t.input);
  $('askReq').value = t.request;
}
async function askOne() {
  const kind = $('askKind').value, input = fromText(kind, $('askInput').value);
  const task = { id: 'yours', kind, request: $('askReq').value, input };
  if (!(await needModel($('askOut')))) return;
  setBusy(true);
  $('askOut').innerHTML = '<p class="small"><b>working…</b> the model\'s words, as it writes them:</p><pre id="liveTokens" class="live"></pre>';
  S.onToken = (text) => { const el = $('liveTokens'); if (el) el.textContent = text; };
  const call = SWARM.caller(ask);
  const g = await SWARM.gated(task, call, S.ctx), r = g.cell ? await SWARM.raw({ ...task, kind: Object.keys(CELLS.FOR_KIND).find((k) => CELLS.FOR_KIND[k] === g.cell) || kind }, call, S.ctx) : null;
  S.onToken = null;
  $('askOut').innerHTML = stages(null, g, r, S.ctx);
  setBusy(false);
}

// ── step 5: your documents ──
async function askDocs() {
  const paras = $('docsText').value.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).map((text, i) => ({ id: `yours#${i}`, text, sha256: SHA.sha256(text) }));
  if (!paras.length) { $('docsOut').innerHTML = '<p class="fail">Paste at least one paragraph.</p>'; return; }
  const ctx = CELLS.prepare({ paragraphs: paras }, S.data.bank, S.data.depts, { ...S.data.settings, qa: { ...S.data.settings.qa, minScore: 2 } });
  const task = { id: 'yours', kind: 'qa', request: 'Answer this question from our documents.', input: { question: $('docsQ').value } };
  if (!(await needModel($('docsOut')))) return;
  setBusy(true);
  $('docsOut').innerHTML = '<p class="small"><b>working…</b></p><pre id="liveTokens" class="live"></pre>';
  S.onToken = (text) => { const el = $('liveTokens'); if (el) el.textContent = text; };
  const g = await SWARM.gated(task, SWARM.caller(ask), ctx);
  S.onToken = null;
  $('docsOut').innerHTML = `<p class="small muted">${paras.length} paragraph(s) signed here: ${paras.map((p) => `<code>${p.sha256.slice(0, 10)}…</code>`).join(' ')}</p>` + stages(null, g, null, ctx);
  setBusy(false);
}

// ── step 6: the measurement, in this tab. It fills the whole page as it runs, and resumes if the tab is closed ──
let sealCache = null;
async function sealHash() {
  if (sealCache === null) { try { sealCache = SHA.sha256((await (await fetch('SEAL2.json')).text()).split('\r\n').join('\n')); } catch { sealCache = ''; } }
  return sealCache || null;
}
async function runSuite() {
  if (!(await needModel($('runOut')))) return;
  const which = $('runWhich').value, pool = poolOf(which), seal = await sealHash();
  let L = S.local;
  if (!L || L.split !== which || L.model !== S.model || L.complete) L = { v: 'browser-swarm-run/1', venue: 'tab (WebLLM 0.2.79, WebGPU)', model: S.model, gpu: S.gpu, ua: navigator.userAgent, split: which, sealSha256: seal, at: new Date().toISOString(), seconds: 0, privacy: { requests: 0 }, segments: 0, records: { gated: [], raw: [] }, usage: [], complete: false };
  S.local = L; S.view = 'mine'; setBusy(true); $('save').disabled = true;
  L.segments = (L.segments || 0) + 1;   // how many sittings this run took: a discarded or closed tab resumes as a new one
  const seen = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) seen.push(e.name); });
  try { obs.observe({ type: 'resource', buffered: false }); } catch { /* no observer */ }
  const before = performance.getEntriesByType('resource').length;
  const call = SWARM.caller(ask), t0 = Date.now(), base = L.seconds, baseReq = L.privacy.requests || 0;
  // the request count is kept with every save, so a sitting that ends in a discarded tab still counts what it saw
  const count = () => { L.privacy = { requests: baseReq + Math.max(performance.getEntriesByType('resource').length - before, seen.length), observed: [...(L.privacy.observed || []), ...seen].slice(0, 20) }; };
  const status = () => {
    const A = view('mine'), g = A.swarm, r = A.raw1, n = L.records.gated.length;
    $('runBar').style.width = `${Math.round((n / pool.length) * 100)}%`;
    $('runOut').innerHTML = g ? `${n} of ${pool.length} · this device: <b class="${g.all.silent ? 'fail' : 'pass'}">${g.all.silent} silent failures (${pct(g.all.silentRate)})</b>, ${g.all.correct} right, median ${(g.all.medianMs / 1000).toFixed(2)} s · same model unchecked: <b class="fail">${r.all.silent} silent (${pct(r.all.silentRate)})</b>, ${r.all.correct} right · ${L.seconds} s` : '';
  };
  await renderAll();
  for (const t of pool) {
    if (ids(L.records.gated).has(t.id) && ids(L.records.raw).has(t.id)) continue;   // already done before the tab was closed
    usageNow = [];
    const g = await SWARM.gated(t, call, S.ctx), r = await SWARM.raw(t, call, S.ctx);
    L.records.gated.push(g); L.records.raw.push(r); L.usage.push(usageNow); usageNow = null;
    L.seconds = base + Math.round((Date.now() - t0) / 1000);
    const n = L.records.gated.length;
    count(); store.set('bs-run', L);
    if (n % 5 === 0 || n === pool.length) await renderAll();
    status();
  }
  try { obs.disconnect(); } catch { /* none */ }
  count();
  L.complete = L.records.gated.length === pool.length;
  store.set('bs-run', L); window.__swarmRun = L;
  await renderAll(); status();
  $('runOut').innerHTML += `<br><b>Done</b> in ${L.segments} sitting${L.segments === 1 ? '' : 's'}. Network requests while it ran: ${L.privacy.requests}. Every number on this page is now this device's. Scroll up, or press Save.`;
  setBusy(false); $('save').disabled = false;
}
function save() {
  if (!S.local) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S.local)], { type: 'application/json' }));
  a.download = `browser-swarm-${S.local.split}-${S.local.at.slice(0, 10)}.json`;
  a.click();
}

// ── the attacks, in this tab: the sealed pool, the sealed builders, the sealed script's own rule for "released the false answer" ──
async function attackRun() {
  if (!(await needModel($('attackOut')))) return;
  const list = S.data.attacks.attacks, D = S.data;
  setBusy(true);
  const call = SWARM.caller(ask);
  const isFalse = (rec, a) => rec.released === true && GATE.f1(String((rec.output && rec.output.answer) || ''), [a.false]) >= 0.5;
  const seal = await sealHash();
  let out = store.get('bs-attack-run');
  if (!out || out.model !== S.model || out.sealSha256 !== seal || out.complete) out = { v: 'browser-swarm-attacks-run/1', venue: 'tab (WebLLM 0.2.79, WebGPU)', model: S.model, gpu: S.gpu, pool: 'sealed', sealSha256: seal, at: new Date().toISOString(), segments: 0, records: [], summary: {}, complete: false };
  out.segments++;
  out.records = out.records.filter((r) => r.kind !== 'A4');
  const have = new Set(out.records.map((r) => `${r.kind}|${r.id}`));
  const KINDS = ['A1', 'A2', 'A2b', 'A3'];
  for (const kind of KINDS) {
    for (const a of list) {
      if (have.has(`${kind}|${a.id}`)) continue;   // done before the tab was closed
      const c = ADV.BUILDERS[kind](D.corpus, a);
      if (!c) continue;
      const ctx = CELLS.prepare(c, D.bank, D.depts, D.settings);
      const task = { id: `${kind}:${a.id}`, kind: 'qa', request: 'Answer this question from our documents.', input: { question: a.question }, gold: { answer: a.answer, impossible: false } };
      const g = await SWARM.gated(task, call, ctx), r = await SWARM.raw(task, call, ctx);
      out.records.push({ kind, id: a.id, false: a.false, gated: g, raw: r });
      store.set('bs-attack-run', out);
      $('attackOut').textContent = `${out.records.length} of ${KINDS.length * list.length} attacks run (${kind})…`;
    }
  }
  const byId = new Map(list.map((a) => [a.id, a]));
  for (const kind of KINDS) {
    const recs = out.records.filter((r) => r.kind === kind);
    out.summary[kind] = { attacks: list.length, built: recs.length, gatedFalse: recs.filter((r) => isFalse(r.gated, byId.get(r.id))).length, rawFalse: recs.filter((r) => isFalse(r.raw, byId.get(r.id))).length,
      gatedReleased: recs.filter((r) => r.gated.released).length, refusedAtLane: recs.filter((r) => r.gated.stage === 'lane').length };
  }
  const cell = CELLS.CELLS.find((c) => c.name === 'docs-answer'), s4 = { questions: 0, candidates: 0, released: 0, realVerified: 0 };
  for (const a of list) {
    const doc = D.corpus.paragraphs.find((p) => p.id === a.goldId);
    s4.questions++;
    if (cell.judge({ question: a.question, answer: a.answer, source: a.goldId }, { question: a.question }, S.ctx).status === 'verified') s4.realVerified++;
    for (const w of ADV.wrongSpans(doc.text, a.answer, a.question)) {
      s4.candidates++;
      const j = cell.judge({ question: a.question, answer: w, source: a.goldId }, { question: a.question }, S.ctx);
      if (j.status === 'verified') s4.released++;
      out.records.push({ kind: 'A4', id: a.id, span: w, status: j.status, why: j.why || '' });
    }
  }
  out.summary.A4 = s4; out.complete = true;
  store.set('bs-attack-run', { ...out, records: [] });   // the summary is kept; the full records are handed over once
  S.attacksLocal = { summary: out.summary, model: out.model, gpu: out.gpu, at: out.at };
  store.set('bs-attacks', S.attacksLocal); window.__swarmAttacks = out;
  $('attackOut').innerHTML = `<b>Done.</b> ${['A1', 'A2', 'A2b', 'A3'].map((k) => `${k}: ${out.summary[k].gatedFalse} of ${out.summary[k].built}`).join(' · ')} · A4: ${s4.released} of ${s4.candidates}. The attack table now shows this device.`;
  await renderAll(); setBusy(false);
}

// ── the frontier arm with the viewer's own key: the raw arm's prompts, sent from this browser to the provider ──
async function frontierRun() {
  const key = $('fkey').value.trim(), model = $('fmodel').value, tasks = poolOf($('runWhich').value);
  if (!key) { $('fOut').innerHTML = '<span class="fail">Paste your API key first.</span>'; return; }
  $('frun').disabled = true;
  const askF = async (messages) => {
    const t0 = performance.now();
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: 2048, output_config: { effort: 'medium' }, system: messages[0].content, messages: [{ role: 'user', content: messages[1].content }] }) });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || `HTTP ${r.status}`);
    return { text: (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''), ms: Math.round(performance.now() - t0), prompt: j.usage ? j.usage.input_tokens : null };
  };
  const call = SWARM.caller(askF), recs = [];
  for (const [i, t] of tasks.entries()) {
    const r = await SWARM.raw(t, call, S.ctx);
    if (r.calls.some((c) => c.error)) { $('fOut').innerHTML = `<span class="fail">Stopped at task ${i + 1}:</span> ${esc(r.calls.find((c) => c.error).error)}`; break; }
    recs.push(r);
    const m = SCORE.metrics(tasks.slice(0, i + 1), recs, { ctx: S.ctx });
    $('fOut').textContent = `${i + 1} of ${tasks.length} · ${model}, unchecked: silent ${m.all.silent} (${pct(m.all.silentRate)}), right ${m.all.correct} (${pct(m.all.accuracy)})`;
  }
  window.__swarmFrontier = { model, split: $('runWhich').value, at: new Date().toISOString(), records: { raw: recs } };
  $('frun').disabled = false;
}

// ── claim F: the fold-cache, measured in this tab (the same tasks, two orders, twice) ──
async function foldMeasure() {
  const per = 6, kinds = ORDER.slice(0, 7), test = S.data.suite.test;
  const pick = Object.fromEntries(kinds.map((k) => [k, test.filter((t) => t.kind === k).slice(0, per)]));
  const grouped = kinds.flatMap((k) => pick[k]), inter = Array.from({ length: per }, (_, i) => kinds.map((k) => pick[k][i])).flat();
  let n = 0;
  const once = async (list) => {
    const out = new Map();
    for (const t of list) {
      const cell = CELLS.CELLS.find((c) => c.name === CELLS.FOR_KIND[t.kind]);
      const lane = cell.name === 'docs-answer' || cell.name === 'banking-intent' ? cell.lane_(t.input, S.ctx, false) : { inLane: true };
      out.set(t.id, await ask(cell.messages(t.input, lane, S.ctx, 0), cell.maxTokens));
      $('foldOut').textContent = `Measuring: ${++n} of ${4 * list.length} calls…`;
    }
    return out;
  };
  const rounds = [];
  for (let k = 0; k < 2; k++) { rounds.push(['interleaved', await once(inter)]); rounds.push(['grouped', await once(grouped)]); }
  const ttft = (name) => rounds.filter(([x]) => x === name).flatMap(([, m]) => [...m.values()].map((r) => r.ttft)).filter(Number.isFinite);
  const I = rounds[0][1], G = rounds[1][1];
  const identical = grouped.filter((t) => I.get(t.id).text === G.get(t.id).text).length;
  const fold = { v: 'browser-swarm-fold/1', venue: 'tab (WebLLM 0.2.79, WebGPU)', model: S.model, gpu: S.gpu, at: new Date().toISOString(), measure: 'wall-clock seconds from the request to the first streamed word', tasks: grouped.map((t) => t.id),
    summary: { grouped: STATS.median(ttft('grouped')), interleaved: STATS.median(ttft('interleaved')), identical, pairs: grouped.length }, rounds: rounds.map(([o, m]) => ({ order: o, calls: [...m].map(([id, r]) => ({ id, ttft: r.ttft, ms: r.ms, text: r.text })) })) };
  S.foldLocal = { summary: fold.summary, model: fold.model, at: fold.at };
  store.set('bs-fold', S.foldLocal); window.__swarmFold = fold;
  return fold.summary;
}

// ── start ──
const ready = (async function start() {
  const [suite, corpus, bank, depts, settings, prices, attacks, published] = await Promise.all(['data/suite.json', 'data/corpus.json', 'data/banking-index.json', 'data/departments.json', 'data/settings.json', 'data/prices.json', 'data/attacks.json', 'data/published.json'].map(getJSON));
  const P = published || {};
  const runs = {};
  for (const k of ['tab', 'big', 'node1b', 'attacks', 'attacksTab', 'fold', 'frontier']) runs[k] = P[k] ? await getJSON(P[k]) : null;
  S.data = { suite, corpus, bank, depts, settings, prices, attacks, runs, walk: P.walk ? await getJSON(P.walk) : null };
  S.ctx = CELLS.prepare(corpus, bank, depts, settings);
  S.inbox = inboxOf(suite.dev);
  const saved = store.get('bs-run');
  if (saved && saved.records && Array.isArray(saved.records.gated) && saved.records.gated.length) S.local = saved;
  S.attacksLocal = store.get('bs-attacks'); S.foldLocal = store.get('bs-fold');
  $('askKind').innerHTML = ORDER.map((k) => `<option value="${k}">${esc(KIND_NAMES[k])}</option>`).join('');
  $('askKind').value = 'qa';
  $('askKind').addEventListener('change', () => { exampleAt = 0; example(); });
  $('askExample').addEventListener('click', example);
  example();
  $('docsText').value = corpus.paragraphs.slice(0, 2).map((p) => p.text).join('\n\n');
  $('docsQ').value = 'Who gave their name to Normandy?';
  $('load').addEventListener('click', load); $('ask').addEventListener('click', askOne); $('docsAsk').addEventListener('click', askDocs); $('work').addEventListener('click', workRun);
  $('run').addEventListener('click', runSuite); $('save').addEventListener('click', save); $('rejudge').addEventListener('click', rejudge);
  $('attackRun').addEventListener('click', attackRun); $('frun').addEventListener('click', frontierRun);
  $('fold').addEventListener('click', async () => {
    if (!(await needModel($('foldOut')))) return;
    setBusy(true);
    const f = await foldMeasure();
    $('foldOut').innerHTML = `Median time to the first word: grouped ${f.grouped.toFixed(3)} s, interleaved ${f.interleaved.toFixed(3)} s (${(f.grouped / f.interleaved).toFixed(2)}×). Identical replies: ${f.identical} of ${f.pairs}. Claim F's bar is 0.8× with 95% identical: <b class="${f.grouped <= 0.8 * f.interleaved && f.identical / f.pairs >= 0.95 ? 'pass">PASS' : 'fail">FAIL'}</b> on this device.`;
    await renderAll(); setBusy(false);
  });
  for (const id of ['tpm', 'cps']) $(id).addEventListener('input', () => renderCost(view(S.view)));
  document.addEventListener('click', (e) => {
    const act = e.target && e.target.dataset ? e.target.dataset.act : null;
    if (act === 'view-published') S.view = 'published';
    else if (act === 'view-mine') S.view = 'mine';
    else if (act === 'discard-run') { S.local = null; S.view = 'published'; store.del('bs-run'); }
    else return;
    renderAll();
  });
  await renderAll();
  await device();
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js'); } catch { /* not served */ }
  document.documentElement.dataset.ready = '1';
})();
window.__swarm = { ready, foldMeasure, rejudge, renderAll, S };
