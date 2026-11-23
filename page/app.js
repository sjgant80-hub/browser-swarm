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

const S = { system: 'v1', canRun: false, data: null, ctx: null, engine: null, model: null, gpu: null, local: null, view: 'published', attacksLocal: null, foldLocal: null, busy: false, onToken: null, inbox: [], work: [], counts: {} };
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
  if (split === 'test2') return S.data.test2.test;
  if (split === 'dev') return suite.dev;
  return ORDER.flatMap((k) => suite.dev.filter((t) => t.kind === k).slice(0, 2));
}
const SPLIT_NAMES = { test: 'sealed test', test2: 'fresh test', dev: 'dev', sample: 'sample' };
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
    $('viewBar').innerHTML = `<b>Showing your run on this device</b> (${BUILD_NAMES[L.system] || BUILD_NAMES.v1}). ${A.tasks.length} of ${A.pool.length} ${SPLIT_NAMES[L.split] || L.split} tasks${L.complete ? '' : ' so far'}. ${esc(sourceOf(L))}. Every number below is from this run, except the 7B and frontier columns, which are the published ones on the same tasks. <button class="ghost" type="button" data-act="view-published">Show the published runs</button>`;
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
    ? `The frontier bar covers the ${A.frontier.all.tasks} tasks its run reached: a seeded sample across every kind, stopped by the spend caps. On exactly those tasks, the swarm released a wrong answer as if right ${A.swarmF.all.silent} times (${pct(A.swarmF.all.silentRate)}) and was right on ${pct(A.swarmF.all.accuracy)}. The frontier model did so ${A.frontier.all.silent} times (${pct(A.frontier.all.silentRate)}) and was right on ${pct(A.frontier.all.accuracy)}. It is far more accurate, and its errors still arrive looking like answers. ${(() => { const p = SCORE.pairedSilent(A.swarmF, A.frontier); return p.p < 0.05 ? `The swarm's lower rate of silent failures is statistically significant on these tasks (exact McNemar p = ${p.p.toPrecision(2)}).` : `On this sample the swarm's lower rate of silent failures is <b>not</b> statistically significant (exact McNemar p = ${p.p.toPrecision(2)}): it is not shown to beat the frontier model on this measure.`; })()} ${(() => {
      // a fairness note: every arm is handed the desks' own prompts, so on banking messages it picks from a five-label shortlist
      const T = new Map(A.tasks.map((t) => [t.id, t])), sil = new Set(A.frontier.rows.filter((r) => r.silent && r.kind === 'classify').map((r) => r.id));
      const off = S.data.runs.frontier.records.raw.filter((r) => sil.has(r.id) && r.output && Array.isArray(r.output.labels) && !r.output.labels.includes(T.get(r.id).gold.intent)).length;
      return `One caveat: every arm is handed the desks' own prompts. Of the frontier model's ${A.frontier.all.silent} silent failures, ${sil.size} were banking messages, and in ${off} of those the right label was not on the five-label shortlist it was given, where the right reply was "none".`;
    })()}`
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
function renderDiagnosis(A) {
  const run = A.tab;
  if (!run || !run.records.gated.length) { $('diagnosis').innerHTML = NM; return; }
  const d = DIAG.summary(A.tasks, run.records.gated, run.records.raw), n = d.notAnswered || 1;
  const row = (name, count, what) => `<tr><td><b>${name}</b></td><td class="num">${count}</td><td class="num">${pct(count / n, 0)}</td><td class="small">${what}</td></tr>`;
  const kinds = ORDER.filter((k) => d.byKind[k]);
  const verdict = d.largest === 'b' ? 'The largest cause is <b>too weak</b>: the swarm had no right answer to release. That is the cause smaller steps can fix, so the fix to build is decomposition, with every check left exactly as it is.'
    : d.largest === 'c' ? 'The largest cause is <b>the gate</b>: right answers were withheld. The fix is to recalibrate the checks, not to add cells.'
      : 'The largest cause is <b>correct refusal</b>: the swarm is more useful than its headline accuracy suggests.';
  $('diagnosis').innerHTML = `<table><thead><tr><th>cause</th><th class="num">tasks</th><th class="num">of the ${d.notAnswered} not answered</th><th>what it means</th></tr></thead><tbody>`
    + row('Correct refusal', d.a, `${d.by.trap} hard open questions no desk owns, and ${d.by['correct refusal']} tasks where nothing was right to say. Refusing these is the designed behaviour.`)
    + row('Too weak', d.b, 'The model declined, or wrote a wrong answer the check rightly withheld, or the lane refused and the model alone was wrong too.')
    + row('Gate too strict', d.c, 'A right answer was withheld by a check, or the lane refused a job the model alone got right.')
    + `</tbody></table><p>${verdict}</p><p class="small">Usefulness over the ${d.answerable} answerable bounded tasks only: ${d.answerableRight} right (${pct(d.answerableRate)}). Leaving out the tasks it was right to refuse does not flatter it.</p>`
    + '<table><thead><tr><th>kind</th><th class="num">answered right</th><th class="num">answered wrong</th><th class="num">correct refusal</th><th class="num">too weak</th><th class="num">gate too strict</th></tr></thead><tbody>'
    + kinds.map((k) => { const x = d.byKind[k]; return `<tr><td>${esc(KIND_NAMES[k])}</td><td class="num">${x['answered right']}</td><td class="num">${x['answered wrong'] ? `<span class="fail">${x['answered wrong']}</span>` : 0}</td><td class="num">${x['correct refusal'] + x.trap}</td><td class="num">${x['too weak']}</td><td class="num">${x['gate too strict']}</td></tr>`; }).join('')
    + '</tbody></table><details><summary>Each cause in detail</summary><ul class="small">' + Object.entries(d.details).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li>${v} · ${esc(k)}</li>`).join('') + '</ul></details>';
}
// ── the fix: the decomposed build, beside the first build ──
// each desk's plan, in words: what code does, and what the model is asked
const PLAN_TEXT = {
  'docs-answer': 'Two readings that must agree. The model reads the whole paragraph, as the first build does, and separately reads only the one sentence that best matches the question (picked by code). Each phrase must be the text\'s own words. Only the words both readings give are released; if they differ, or either finds no answer, the desk refuses.',
  'receipt-total': 'Code finds the lines that say "total" and carry an amount. The model copies the amount off each line; it must be printed on that line. If the lines differ, the model is asked which line is the final total.',
  'banking-intent': 'The word index shortlists the likeliest intents. The model is asked yes or no for each one; it must say yes to the first and no to the others.',
  department: 'The word index ranks the departments. The model is asked yes or no for the first two; it must say yes to the first and no to the second.',
  'iso-date': 'Code reads the date off the text, in the written forms that need no guess. No model is asked. The first build\'s check, which is separate code, must agree.',
  pence: 'Code reads the amount off the text, in the written forms that need no guess. No model is asked. The first build\'s check, which is separate code, must agree.',
  'refund-letter': 'Code fills the letter from the record\'s own fields. No model is asked. The first build\'s check must pass.',
};
const gateCell = (files) => {
  const G = S.data.gates && S.data.gates.files ? S.data.gates.files : {}, got = files.map((f) => G[f]);
  if (got.some((g) => !g)) return '<span class="pend">built; its mutation gate is not recorded yet</span>';
  const k = got.reduce((a, g) => a + g.killed, 0), n = got.reduce((a, g) => a + g.total, 0), ig = got.reduce((a, g) => a + (g.ignored || 0), 0);
  return got.every((g) => g.clean === true) ? `<span class="pass">built, gated ${k}/${n}${ig ? ` (${ig} equivalent, with its reason)` : ''}</span>` : `<span class="fail">built, gate not clean: ${k}/${n}</span>`;
};
const BUILD_NAMES = { v1: 'the first build', v2: 'the decomposed build', v3: 'the follow-up build' };
const BOUNDED_KINDS = ['qa', 'extract', 'classify', 'route', 'date', 'pence', 'draft'];
const meanMs = (recs) => (recs.length ? recs.reduce((a, r) => a + (Number(r.ms) || 0), 0) / recs.length : null);
const callsPer = (recs) => { const n = recs.map((r) => (r.calls || []).filter((c) => !c.cached).length); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; };
function fixArms() {
  const P = S.data.runs, test = S.data.suite.test, fresh = S.data.test2 ? S.data.test2.test : [];
  const M = (run, tasks, venue) => (run && run.records && run.records.gated && tasks.length && tasks.every((t) => ids(run.records.gated).has(t.id)) ? SCORE.metrics(tasks, run.records.gated, { ctx: S.ctx, arm: 'gated', venue, model: run.model }) : null);
  const v2 = M(P.tab2, test, 'tab');
  const released = (run, tasks) => tasks.filter((t) => { const r = run.records.gated.find((x) => x.id === t.id); return r && r.released === true; }).length;
  const traps = v2 ? { hard: released(P.tab2, test.filter((t) => SCORE.HARD.includes(t.kind))), unanswerable: released(P.tab2, test.filter((t) => SCORE.shouldRefuse(t))) } : null;
  return { test, fresh, v1: M(P.tab, test, 'tab'), v2, traps, v1fresh: M(P.fresh1, fresh, 'tab'), v2fresh: M(P.fresh2, fresh, 'tab'), v3fresh: M(P.follow, fresh, 'tab'), v3seen: M(P.followSeen, test, 'tab'), gated7: M(P.big, test, 'node') };
}
function renderFix() {
  const P = S.data.runs, F = fixArms(), ad = S.data.adoption;
  const V = CLAIMS2.evaluate(F), verdict = Object.fromEntries(V.map((v) => [v.id, v]));
  const NAMES2 = { D1: 'Safety holds', D2: 'Usefulness climbs', D3: 'The traps still refuse', D4: 'Latency, the price', D5: 'Fresh tasks: safety', D6: 'Fresh tasks: more right, all bounded work', D7: 'Fresh tasks: more right, real-data work only' };
  const parts = [];
  // which desks were decomposed, decided on tuning data before the seal
  if (ad && Array.isArray(ad.desks)) {
    const cell = (c) => `${c.right} right, ${c.silent ? `<span class="fail">${c.silent} silent</span>` : '0 silent'}<br><span class="small muted">score ${CLAIMS2.score(c)}</span>`;
    const tried = ad.desks.filter((d) => Array.isArray(d.tried) && d.tried.length);
    parts.push('<h3>Which desks were decomposed</h3><p class="small">' + esc(CLAIMS2.RULE) + '</p>'
      + '<table><thead><tr><th>desk</th><th>the plan</th><th class="num">tuning tasks</th><th>first build, one call</th><th>decomposed plan</th><th class="num">model calls per task</th><th>decision</th><th>under the first rule</th></tr></thead><tbody>'
      + ad.desks.map((d) => { const yes = CLAIMS2.adopted(d.v1, d.v2); return `<tr><td>${esc(deskName(d.desk))}</td><td class="small">${esc(PLAN_TEXT[d.desk] || '')}</td><td class="num">${d.tasks}</td><td>${cell(d.v1)}</td><td>${cell(d.v2)}</td><td class="num">${d.v2.callsPerTask}</td><td>${yes ? '<span class="pass">decomposed</span>' : '<span class="fail">not adopted</span>: kept as one call'}<br><span class="small muted">${esc(d.why)}</span></td><td class="small">${d.firstRuleWould ? esc(d.firstRuleWould) : CLAIMS2.firstRule(d.v1, d.v2) ? 'adopted this plan' : 'kept as one call'}</td></tr>`; }).join('')
      + '</tbody></table>'
      + `<p class="small"><b>The rule changed once, before the seal.</b> This work started with a simpler rule: ${esc(CLAIMS2.FIRST_RULE)}. The tuning data showed a case it had not allowed for: a plan that answers a little less and is wrong far less often. That rule would have turned the safer plan down, so it was replaced by the rule above before any sealed task was read. The last column shows what the first rule would have chosen.</p>`
      + (tried.length ? '<p class="small"><b>Also tried, and not chosen.</b></p><ul class="small">' + tried.map((d) => d.tried.map((x) => `<li>${esc(deskName(d.desk))}: ${esc(x.plan)}: ${x.right} right, ${x.silent} silent failures on the same ${d.tasks} tuning tasks (score ${CLAIMS2.score(x)}). ${esc(x.why || '')}</li>`).join('')).join('') + '</ul>' : '')
      + ad.desks.filter((d) => d.note).map((d) => `<p class="small muted">${esc(deskName(d.desk))}: ${esc(d.note)}</p>`).join('')
      + `<p class="small muted">${esc(ad.note)}</p>`);
  } else parts.push(`<p>${NM}: the tuning comparison that decides which desks are decomposed.</p>`);
  parts.push('<h3>The claims for the fix</h3><table><thead><tr><th>claim</th><th>bar</th><th>result</th><th>verdict</th></tr></thead><tbody>'
    + V.map((v) => `<tr><td><b>${v.id}</b> ${esc(NAMES2[v.id])}</td><td class="small">${esc(CLAIMS2.BARS[v.id])}</td><td class="small">${esc(v.result.replace(/^pending: /, 'Not measured yet: '))}</td><td>${badge(v)}</td></tr>`).join('') + '</tbody></table>');
  // the follow-up claim (CLAIMS-3.md): registered after D1 failed, judged on the fresh 410 only
  if (F.v2) {
    const E = CLAIMS3.evaluate(F.v3fresh), NAMES3 = { E1: 'Safety, on tasks never seen', E2: 'Usefulness, on tasks never seen' };
    const d1 = verdict.D1;
    parts.push('<h3 id="followup">The follow-up, registered after the result above</h3>'
      + `<p>${d1.pass === false ? 'The safety claim (D1) failed, and it stays failed.' : 'The claims above stand as they are.'} The wrong answers pointed at one desk: the banking desk, whose yes-or-no plan had been adopted on tuning data by one point of score. So one more claim was registered, <b>after</b> seeing that result and <b>before</b> any result on the fresh 410 was known: the same build with the banking desk put back to one call, judged on the fresh tasks only. It was committed while both fresh-set runs were still in progress: <a href="https://github.com/sjgant80-hub/browser-swarm/blob/main/CLAIMS-3.md">CLAIMS-3.md</a>. No new model run was made for it. On every task the follow-up build makes the model calls one of the two registered runs already holds, so its record is assembled from those runs and every decision is decided again by its own code.</p>`
      + '<table><thead><tr><th>claim</th><th>bar</th><th>result</th><th>verdict</th></tr></thead><tbody>'
      + E.map((v) => `<tr><td><b>${v.id}</b> ${esc(NAMES3[v.id])}</td><td class="small">${esc(CLAIMS3.BARS[v.id])}</td><td class="small">${esc(v.result.replace(/^pending: /, 'Not measured yet: '))}</td><td>${badge(v)}</td></tr>`).join('') + '</tbody></table>'
      + (F.v3fresh && F.v1fresh ? `<p>On the fresh 410 the follow-up build released ${F.v3fresh.all.released} answers, ${F.v3fresh.all.silent} of them wrong, and got ${pct(F.v3fresh.bounded.accuracy)} of the bounded work right. The first build, on the same tasks: ${F.v1fresh.all.released} released, ${F.v1fresh.all.silent} wrong, ${pct(F.v1fresh.bounded.accuracy)} right.</p>` : '')
      + (F.v3seen ? `<p class="small muted">Seen data, not a claim: on the sealed 410, which is where the failure was seen and this build was chosen, the follow-up build comes to ${F.v3seen.all.silent} silent failures and ${pct(F.v3seen.bounded.accuracy)} of the bounded work right.</p>` : ''));
    bind('hl.follow', F.v3fresh ? `A follow-up was then registered before any fresh result was known: the same build with the banking desk put back. On 410 fresh tasks it got ${pct(F.v3fresh.bounded.accuracy)} of the bounded work right with ${F.v3fresh.all.silent} silent failures: safety ${E[0].pass ? '<span class="pass">holds</span>' : '<span class="fail">fails</span>'}, usefulness ${E[1].pass ? '<span class="pass">reaches its bar</span>' : '<span class="fail">misses its bar</span>'}. <a href="#followup">The follow-up</a>.` : 'A follow-up claim is registered and not measured yet.');
  } else bind('hl.follow', '');
  // side by side, per kind, on each sealed set
  const side = (title, tasks, a, b, runA, runB) => {
    if (!a || !b) return `<h3>${title}</h3><p>${NM}</p>`;
    const kinds = ORDER.filter((k) => a.byKind[k]);
    const cp = (run, k) => { const c = callsPer(run.records.gated.filter((r) => r.kind === k)); return c === null ? '—' : c.toFixed(1); };
    return `<h3>${title}</h3><table><thead><tr><th>kind</th><th class="num">tasks</th><th class="num">first build: right</th><th class="num">silent</th><th class="num">decomposed: right</th><th class="num">silent</th><th class="num">calls per task, before → after</th><th class="num">median time, before → after</th></tr></thead><tbody>`
      + kinds.map((k) => { const x = a.byKind[k], y = b.byKind[k]; return `<tr><td>${esc(KIND_NAMES[k])}</td><td class="num">${x.tasks}</td><td class="num">${x.correct}</td><td class="num">${x.silent ? `<span class="fail">${x.silent}</span>` : 0}</td><td class="num"><b>${y.correct}</b></td><td class="num">${y.silent ? `<span class="fail">${y.silent}</span>` : 0}</td><td class="num">${cp(runA, k)} → ${cp(runB, k)}</td><td class="num">${(x.medianMs / 1000).toFixed(1)} s → ${(y.medianMs / 1000).toFixed(1)} s</td></tr>`; }).join('')
      + `<tr><td><b>all bounded work</b></td><td class="num">${a.bounded.tasks}</td><td class="num">${a.bounded.correct} (${pct(a.bounded.accuracy)})</td><td class="num">${a.bounded.silent}</td><td class="num"><b>${b.bounded.correct} (${pct(b.bounded.accuracy)})</b></td><td class="num">${b.bounded.silent}</td><td class="num">${callsPer(runA.records.gated).toFixed(1)} → ${callsPer(runB.records.gated).toFixed(1)}</td><td class="num">${(a.all.medianMs / 1000).toFixed(1)} s → ${(b.all.medianMs / 1000).toFixed(1)} s</td></tr></tbody></table>`;
  };
  parts.push(side('On the sealed 410, a second read of that set', F.test, F.v1, F.v2, P.tab, P.tab2));
  parts.push(side('On 410 fresh tasks neither build had seen', F.fresh, F.v1fresh, F.v2fresh, P.fresh1, P.fresh2));
  // where the gain came from and where the wrong answers are, kind by kind, for one pair of runs
  const whereOf = (a, b, runB, label) => {
    const kinds = BOUNDED_KINDS.filter((k) => a.byKind[k] && b.byKind[k]);
    const noModel = kinds.filter((k) => callsPer(runB.records.gated.filter((r) => r.kind === k)) === 0);
    const gain = (ks) => ks.reduce((n, k) => n + b.byKind[k].correct - a.byKind[k].correct, 0);
    const each = kinds.filter((k) => !noModel.includes(k)).map((k) => `${esc(KIND_NAMES[k])} ${b.byKind[k].correct - a.byKind[k].correct >= 0 ? '+' : '−'}${Math.abs(b.byKind[k].correct - a.byKind[k].correct)}`).join(', ');
    const sil = (m) => kinds.filter((k) => m.byKind[k].silent).map((k) => `${esc(KIND_NAMES[k])} ${m.byKind[k].silent}`).join(', ') || 'none';
    return `<p><b>Where the change came from${label}.</b> The decomposed build got ${gain(kinds) >= 0 ? gain(kinds) + ' more' : -gain(kinds) + ' fewer'} bounded tasks right than the first build. Of that, ${gain(noModel)} came on the desks where no model is asked (${noModel.map((k) => esc(KIND_NAMES[k])).join(', ')}): code doing the job, which says nothing about the model. On the desks where the model is still asked: ${each}. <b>Where the wrong answers are:</b> the decomposed build's silent failures by kind: ${sil(b)}. The first build's: ${sil(a)}.</p>`;
  };
  // what moved, and the road not taken
  if (F.v1 && F.v2) {
    const d1 = DIAG.summary(F.test, P.tab.records.gated, P.tab.records.raw), d2 = DIAG.summary(F.test, P.tab2.records.gated, P.tab.records.raw);
    const g7 = F.gated7;
    parts.push(`<h3>What moved</h3><p>On the sealed 410 the decomposed build answered ${F.v2.all.released} tasks where the first build answered ${F.v1.all.released}. "Too weak" went from ${d1.b} tasks to ${d2.b}; "gate too strict" went from ${d1.c} to ${d2.c}; correct refusals from ${d1.a} to ${d2.a}. Silent failures went from ${F.v1.all.silent} to ${F.v2.all.silent}.</p>`
      + (() => { const slow = ORDER.filter((k) => F.v2.byKind[k]).map((k) => [k, F.v2.byKind[k].medianMs]).sort((a, b) => b[1] - a[1])[0]; return `<p><b>Time, said straight.</b> The median time per task went from ${(F.v1.all.medianMs / 1000).toFixed(2)} s to ${(F.v2.all.medianMs / 1000).toFixed(2)} s, and the mean from ${(meanMs(P.tab.records.gated) / 1000).toFixed(2)} s to ${(meanMs(P.tab2.records.gated) / 1000).toFixed(2)} s. The median is low because many tasks now need no model call, or are refused before the model runs. The slowest kind in the decomposed build is ${esc(KIND_NAMES[slow[0]])}, at a median ${(slow[1] / 1000).toFixed(1)} s per task. The whole sealed set took ${P.tab2.seconds} s in the tab (the first build's run, which also made the unchecked arm from the same calls: ${P.tab.seconds} s).</p>`; })()
      + `<p><b>Counted two ways.</b> The registered bar counts silent failures per task, and on that count the decomposed build ${verdict.D1.pass ? 'held the line' : 'did worse than the first build'}: ${F.v2.all.silent} in ${F.v2.all.tasks} against ${F.v1.all.silent}${F.v2fresh && F.v1fresh ? `, and ${F.v2fresh.all.silent} against ${F.v1fresh.all.silent} on the fresh tasks` : ''}. It also answers far more. Per answer released, the first build was wrong in ${F.v1.all.silent} of ${F.v1.all.released} (${pct(F.v1.all.silentAmongReleased)}) and the decomposed build in ${F.v2.all.silent} of ${F.v2.all.released} (${pct(F.v2.all.silentAmongReleased)})${F.v2fresh && F.v1fresh ? `; on the fresh tasks, ${F.v1fresh.all.silent} of ${F.v1fresh.all.released} (${pct(F.v1fresh.all.silentAmongReleased)}) and ${F.v2fresh.all.silent} of ${F.v2fresh.all.released} (${pct(F.v2fresh.all.silentAmongReleased)})` : ''}. So each released answer is about as likely to be wrong as before, and there are more of them. That does not rescue the claim: the claim was per task, and it stays as registered.</p>`
      + whereOf(F.v1, F.v2, P.tab2, ' on the sealed 410')
      + (F.v1fresh && F.v2fresh ? whereOf(F.v1fresh, F.v2fresh, P.fresh2, ' on the fresh 410') : '')
      + (g7 ? `<p><b>The road not taken.</b> A model seven times larger behind the first build's checks got ${pct(g7.bounded.accuracy)} of the bounded work right with ${g7.all.silent} silent failures, at a median ${(g7.all.medianMs / 1000).toFixed(1)} s per task on a laptop processor and with no browser. The decomposed 1B got ${pct(F.v2.bounded.accuracy)} with ${F.v2.all.silent}, in a browser tab, at a median ${(F.v2.all.medianMs / 1000).toFixed(1)} s. ${F.v2.bounded.accuracy >= g7.bounded.accuracy ? 'On this suite the small model, decomposed, matches or beats the larger one on usefulness.' : 'The larger model is still the more useful one. If usefulness matters more than running in a tab, it is the honest choice.'}</p>` : ''));
  }
  const made = [['The decomposed build on the sealed 410', P.tab2], ['The first build on the fresh 410', P.fresh1], ['The decomposed build on the fresh 410', P.fresh2]].filter(([, r]) => r);
  if (made.length) {
    const hosts = (r) => [...new Set((r.privacy && Array.isArray(r.privacy.observed) ? r.privacy.observed : []).map((u) => { try { return new URL(u).host; } catch { return String(u); } }))];
    parts.push('<h3>How these runs were made</h3><ul class="small">' + made.map(([name, r]) => `<li>${name}: ${esc(sourceOf(r))}, ${r.seconds} s of work in ${r.segments} sitting${r.segments === 1 ? '' : 's'}. ${r.segments > 1 ? 'The browser discarded the tab while it ran; the run saves every task and picked up where it stopped. ' : ''}Network requests counted by the browser while it ran: ${r.privacy ? r.privacy.requests : 'not counted'}${r.privacy && r.privacy.requests ? ` (to ${hosts(r).map(esc).join(', ')}: this computer itself, where the measurement saved the run file before it)` : ''}.</li>`).join('') + '</ul><p class="small muted">Each of these files holds every model reply. This page decides all of them again from those replies when you press "Re-judge the published runs" in step 6, and the repository does the same on every push.</p>');
  }
  $('fixBody').innerHTML = parts.join('');
  bind('fix.default', S.followHolds === true ? 'The follow-up build is the default here: both of its claims passed on tasks it had never seen.' : S.fixHolds === true ? 'The decomposed build is the default here, because its two headline claims (safety held, usefulness up) both passed on the sealed tasks.' : S.fixHolds === false ? `The first build stays the default here: the decomposed build did not pass both of its headline claims${S.followHolds === false ? ', and nor did the follow-up build' : ''}.` : 'The first build is the default until the decomposed build has been measured on the sealed tasks.');
  bind('bp.atoms', gateCell(['src/atoms.mjs'])); bind('bp.assembly', gateCell(['src/assembly.mjs'])); bind('bp.read', gateCell(['src/read.mjs'])); bind('bp.fixclaims', gateCell(['src/diagnose.mjs', 'src/claims2.mjs']));
  bind('hl.swarm2', F.v2 ? `${pct(F.v2.all.silentRate)} <span class="muted">(${F.v2.all.silent} of ${F.v2.all.tasks})</span>` : NM);
  bind('hl.acc2', F.v2 ? `${pct(F.v2.bounded.accuracy)} <span class="muted">(${F.v2.bounded.correct} of ${F.v2.bounded.tasks})</span>` : NM);
  // the buyer's two sentences about the decomposed build: what it answered, and how often it was wrong
  bind('b.fix', F.v2 ? `The decomposed build, on the same ${F.v2.all.tasks} sealed tasks: it released ${F.v2.all.released} answers, ${F.v2.all.silent} of them wrong, and got ${pct(F.v2.bounded.accuracy)} of the bounded work right (the first build: ${F.v1 ? pct(F.v1.bounded.accuracy) : '?'}).${F.v2fresh ? ` On ${F.v2fresh.all.tasks} fresh tasks it released ${F.v2fresh.all.released}, ${F.v2fresh.all.silent} of them wrong, and got ${pct(F.v2fresh.bounded.accuracy)} of the bounded work right.` : ''}` : 'The decomposed build is not measured yet.');
  bind('b.fixboard', F.v2 ? `Breaking each job into smaller checked steps then took the share of bounded work done right from ${F.v1 ? pct(F.v1.bounded.accuracy) : '?'} to ${pct(F.v2.bounded.accuracy)}, with ${F.v2.all.silent} confidently wrong answers in ${F.v2.all.tasks}${F.v2fresh ? ` (and ${F.v2fresh.all.silent} in ${F.v2fresh.all.tasks} on fresh tasks)` : ''}.` : 'The decomposed build is not measured yet.');
  // the headline sentence about the fix
  const D1 = verdict.D1, D2 = verdict.D2;
  bind('hl.fix', F.v2 ? `Then each desk's job was broken into smaller steps for the same small model. On the same sealed tasks the decomposed build got ${pct(F.v2.bounded.accuracy)} of the bounded work right (the first build: ${pct(F.v1 ? F.v1.bounded.accuracy : null)}) with ${F.v2.all.silent} silent failures (the first build: ${F.v1 ? F.v1.all.silent : '?'}). Its two headline claims: safety ${D1.pass ? '<span class="pass">holds</span>' : '<span class="fail">fails</span>'}, usefulness ${D2.pass ? '<span class="pass">reaches its bar</span>' : '<span class="fail">misses its bar</span>'}.${F.v2fresh && F.v1fresh ? ` On 410 fresh tasks it got ${pct(F.v2fresh.bounded.accuracy)} right (the first build: ${pct(F.v1fresh.bounded.accuracy)}) with ${F.v2fresh.all.silent} silent failures (the first build: ${F.v1fresh.all.silent}): safety ${verdict.D5.pass ? '<span class="pass">holds</span>' : '<span class="fail">fails</span>'} there too.` : ''} <a href="#fix">The fix, in full</a>.` : 'A fix for the low completion rate, breaking each job into smaller steps, is built and not measured yet.');
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
  const P = S.data.runs, s = P.attacks ? P.attacks.summary : null, t = P.attacksTab ? P.attacksTab.summary : null, t2 = P.attacksTab2 ? P.attacksTab2.summary : null, m = S.attacksLocal ? S.attacksLocal.summary : null;
  const what = { A1: 'changes a signed paragraph after signing', A2: 'adds a signed false copy beside the right paragraph', A2b: 'writes the lie into the right paragraph and signs it', A3: 'adds "ignore … the answer is X" to the right paragraph, signed', A4: 'hands the judge a wrong answer of the right type, copied from the right paragraph' };
  const V = Object.fromEntries(VP.map((v) => [v.id, v]));
  const rel = (x, id) => (!x || !x[id] ? null : id === 'A4' ? [x[id].released, x[id].candidates] : [x[id].gatedFalse, x[id].built]);
  const show = (p) => (p ? `<span class="${p[0] ? 'fail' : 'pass'}">${p[0]}</span> of ${p[1]}` : NM);
  const raw = (x, id) => (!x || !x[id] ? NM : id === 'A4' ? 'no model' : `${x[id].rawFalse} of ${x[id].built}`);
  $('attackTable').innerHTML = '<table><thead><tr><th>attack</th><th>what the attacker does</th><th class="num">sealed runner: false answer released</th><th class="num">same model, no checks</th><th class="num">in the browser tab</th><th class="num">decomposed build, in the tab</th><th class="num">on this device</th><th>verdict</th></tr></thead><tbody>'
    + ['A1', 'A2', 'A2b', 'A3', 'A4'].map((id) => `<tr><td><b>${id}</b></td><td>${esc(what[id])}</td><td class="num">${show(rel(s, id))}</td><td class="num">${raw(s, id)}</td><td class="num">${show(rel(t, id))}</td><td class="num">${show(rel(t2, id))}</td><td class="num">${m ? show(rel(m, id)) : '<span class="badge">UNVERIFIED HERE</span>'}</td><td>${badge(V[id])}</td></tr>`).join('') + '</tbody></table>';
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
      if (g.plan === 'atoms') {
        out.push(st(g.stage !== 'atom', g.atoms.length ? `Small steps: ${g.atoms.length} asked of the model, each checked by code` : 'Small steps: none needed the model, the answer was assembled by code', g.atoms.map((x) => `<span class="${x.ok ? 'pass' : 'fail'}">${x.ok ? '✓' : '✗'}</span> ${esc(ATOM.ATOMS[x.atom] ? ATOM.ATOMS[x.atom].what : x.atom === 'phrase-from-paragraph' ? 'reads the whole paragraph, as the first build does' : x.atom)}: <code>${esc(String(x.said).slice(0, 80))}</code>${x.ok ? '' : ` <span class="muted">(${esc(x.why)})</span>`}`).join('<br>') || '<span class="muted">no model call</span>'));
      } else out.push(st(true, 'The model wrote', g.calls.map((c) => `<code>${esc(String(c.text).slice(0, 300))}</code>`).join(' · ') || '<span class="muted">(nothing)</span>'));
      if (g.stage === 'atom') out.push(st(false, 'Nothing assembled', esc(String(g.why).replace(/^a step did not pass, so nothing was assembled: /, ''))));
      else if (g.stage === 'act') out.push(st(false, 'The model declined', esc(String(g.why).replace(/^the act refused: /, ''))));
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
    const g = await runGated(S.system, t, call, S.ctx), r = t.noDesk ? null : await SWARM.raw(t, call, S.ctx);
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
  renderViewBar(A); renderHeadline(A, V); renderSix(A); renderMoney(A); renderKinds(A); renderDiagnosis(A); renderFix(); renderClaims(VP, VM); renderAttacks(VP); renderCost(A); renderWalk(); renderDesks(); renderGauges(); renderInbox();
  await renderTrace(A);
}

// ── re-judge every published decision from its recorded reply ──
async function rejudge() {
  const out = $('rejudgeOut'); out.innerHTML = '<p class="small">Replaying…</p>';
  const tasks = new Map([...S.data.suite.test, ...(S.data.test2 ? S.data.test2.test : [])].map((x) => [x.id, x]));
  const key = (r) => JSON.stringify([r.released, r.status ?? null, r.output ?? null, r.why]);
  const again = (rec, run) => (rec.arm === 'assembled' ? ASM.replay(tasks.get(rec.id), rec, S.ctx, (run.system === 'v3' ? S.data.settings3 : S.data.settings2) || {}) : SWARM.replay(tasks.get(rec.id), rec, S.ctx));
  const P = S.data.runs, lines = [];
  for (const [name, run, armsOf] of [['the tab run', P.tab, ['gated', 'raw']], ['the 7B run', P.big, ['gated', 'raw']], ['the 1B Ollama run', P.node1b, ['gated', 'raw']], ['the frontier run', P.frontier, ['raw']], ['the decomposed build on the sealed 410', P.tab2, ['gated']], ['the first build on the fresh 410', P.fresh1, ['gated']], ['the decomposed build on the fresh 410', P.fresh2, ['gated']], ['the follow-up build on the fresh 410', P.follow, ['gated']], ['the follow-up build on the sealed 410', P.followSeen, ['gated']]]) {
    if (!run) { lines.push(`<li>${name}: not published yet</li>`); continue; }
    let n = 0, same = 0;
    for (const arm of armsOf) for (const rec of run.records[arm]) { n++; if (key(await again(rec, run)) === key(rec)) same++; }
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
  const g = await runGated(S.system, task, call, S.ctx), r = g.cell ? await SWARM.raw({ ...task, kind: Object.keys(CELLS.FOR_KIND).find((k) => CELLS.FOR_KIND[k] === g.cell) || kind }, call, S.ctx) : null;
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
  const g = await runGated(S.system, task, SWARM.caller(ask), ctx);
  S.onToken = null;
  $('docsOut').innerHTML = `<p class="small muted">${paras.length} paragraph(s) signed here: ${paras.map((p) => `<code>${p.sha256.slice(0, 10)}…</code>`).join(' ')}</p>` + stages(null, g, null, ctx);
  setBusy(false);
}

// ── step 6: the measurement, in this tab. It fills the whole page as it runs, and resumes if the tab is closed ──
const sealCache = {};
async function sealHash(file = 'SEAL2.json') {
  if (sealCache[file] === undefined) { try { const r = await fetch(file); sealCache[file] = r.ok ? SHA.sha256((await r.text()).split('\r\n').join('\n')) : ''; } catch { sealCache[file] = ''; } }
  return sealCache[file] || null;
}
// which build answers: the first build (one call per job) or the decomposed one (atoms, by the desks that adopted them)
const runGated = (system, t, call, ctx) => (system === 'v2' ? ASM.assemble(t, call, ctx, S.data.settings2 || {}) : system === 'v3' ? ASM.assemble(t, call, ctx, S.data.settings3 || {}) : SWARM.gated(t, call, ctx));
const runKey = (system) => (system === 'v1' ? 'bs-run' : `bs-run-${system}`);
// runSet({ system, split, raw, ui }) → the run record. With ui it is the visitor's run: it becomes the run on show and
// the page re-renders as it goes. Without ui it is a quiet run kept under its own key (how the published sets were made).
async function runSet({ system = S.system, split = 'test', raw = true, ui = false } = {}) {
  const pool = poolOf(split), key = ui ? runKey(system) : `bs-set-${system}-${split}`;
  let L = ui ? S.local : store.get(key);
  if (!L || L.split !== split || L.model !== S.model || L.system !== system || L.complete) {
    L = { v: 'browser-swarm-run/2', venue: 'tab (WebLLM 0.2.79, WebGPU)', model: S.model, gpu: S.gpu, ua: navigator.userAgent, system, split, sealSha256: await sealHash('SEAL2.json'), seal3Sha256: await sealHash('SEAL3.json'),
      at: new Date().toISOString(), seconds: 0, privacy: { requests: 0 }, segments: 0, records: raw ? { gated: [], raw: [] } : { gated: [] }, usage: [], complete: false };
  }
  if (ui) { S.local = L; S.view = 'mine'; $('save').disabled = true; }
  S.quiet = L;
  L.segments = (L.segments || 0) + 1;   // how many sittings this run took: a discarded or closed tab resumes as a new one
  const seen = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) seen.push(e.name); });
  try { obs.observe({ type: 'resource', buffered: false }); } catch { /* no observer */ }
  const before = performance.getEntriesByType('resource').length;
  const call = SWARM.caller(ask), t0 = Date.now(), base = L.seconds, baseReq = L.privacy.requests || 0;
  // the request count is kept with every save, so a sitting that ends in a discarded tab still counts what it saw
  const count = () => { L.privacy = { requests: baseReq + Math.max(performance.getEntriesByType('resource').length - before, seen.length), observed: [...(L.privacy.observed || []), ...seen].slice(0, 20) }; };
  const status = () => {
    if (!ui) return;
    const A = view('mine'), g = A.swarm, r = A.raw1, n = L.records.gated.length;
    $('runBar').style.width = `${Math.round((n / pool.length) * 100)}%`;
    $('runOut').innerHTML = g ? `${n} of ${pool.length} · this device: <b class="${g.all.silent ? 'fail' : 'pass'}">${g.all.silent} silent failures (${pct(g.all.silentRate)})</b>, ${g.all.correct} right, median ${(g.all.medianMs / 1000).toFixed(2)} s${r ? ` · same model unchecked: <b class="fail">${r.all.silent} silent (${pct(r.all.silentRate)})</b>, ${r.all.correct} right` : ''} · ${L.seconds} s` : '';
  };
  if (ui) await renderAll();
  for (const t of pool) {
    if (ids(L.records.gated).has(t.id) && (!raw || ids(L.records.raw).has(t.id))) continue;   // already done before the tab was closed
    usageNow = [];
    const g = await runGated(system, t, call, S.ctx);
    L.records.gated.push(g);
    if (raw) L.records.raw.push(await SWARM.raw(t, call, S.ctx));
    L.usage.push(usageNow); usageNow = null;
    L.seconds = base + Math.round((Date.now() - t0) / 1000);
    count(); store.set(key, L);
    if (ui && (L.records.gated.length % 5 === 0 || L.records.gated.length === pool.length)) await renderAll();
    status();
  }
  try { obs.disconnect(); } catch { /* none */ }
  count();
  L.complete = L.records.gated.length === pool.length;
  store.set(key, L);
  return L;
}
async function runSuite() {
  if (!(await needModel($('runOut')))) return;
  setBusy(true);
  const L = await runSet({ system: S.system, split: $('runWhich').value, raw: true, ui: true });
  window.__swarmRun = L;
  await renderAll();
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
const attackKey = () => (S.system === 'v1' ? 'bs-attack-run' : `bs-attack-run-${S.system}`);
async function attackRun() {
  if (!(await needModel($('attackOut')))) return;
  const list = S.data.attacks.attacks, D = S.data;
  setBusy(true);
  const call = SWARM.caller(ask);
  const isFalse = (rec, a) => rec.released === true && GATE.f1(String((rec.output && rec.output.answer) || ''), [a.false]) >= 0.5;
  const seal = await sealHash();
  let out = store.get(attackKey());
  if (!out || out.model !== S.model || out.sealSha256 !== seal || out.complete || (out.system || 'v1') !== S.system) out = { v: 'browser-swarm-attacks-run/1', venue: 'tab (WebLLM 0.2.79, WebGPU)', system: S.system, seal3Sha256: await sealHash('SEAL3.json'), model: S.model, gpu: S.gpu, pool: 'sealed', sealSha256: seal, at: new Date().toISOString(), segments: 0, records: [], summary: {}, complete: false };
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
      const g = await runGated(S.system, task, call, ctx), r = await SWARM.raw(task, call, ctx);
      out.records.push({ kind, id: a.id, false: a.false, gated: g, raw: r });
      store.set(attackKey(), out);
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
  store.set(attackKey(), { ...out, records: [] });   // the summary is kept; the full records are handed over once
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
  for (const k of ['tab', 'big', 'node1b', 'attacks', 'attacksTab', 'fold', 'frontier', 'tab2', 'fresh1', 'fresh2', 'attacksTab2', 'follow', 'followSeen']) runs[k] = P[k] ? await getJSON(P[k]) : null;
  const test2 = await getJSON('data/test2.json'), adoption = await getJSON('data/adoption.json'), gates = await getJSON('data/gates.json');
  const settings2 = await getJSON('data/settings2.json'), settings3 = await getJSON('data/settings3.json');
  S.data = { suite, corpus, bank, depts, settings, settings2, settings3, test2, adoption, gates, prices, attacks, runs, walk: P.walk ? await getJSON(P.walk) : null };
  S.ctx = CELLS.prepare(corpus, bank, depts, settings);
  S.inbox = inboxOf(suite.dev);
  S.fixHolds = (() => { const v = CLAIMS2.evaluate(fixArms()), ok = (id) => v.find((x) => x.id === id).pass; return ok('D1') === null || ok('D2') === null ? null : ok('D1') === true && ok('D2') === true; })();
  S.followHolds = CLAIMS3.holds(CLAIMS3.evaluate(fixArms().v3fresh));
  S.system = S.followHolds === true ? 'v3' : S.fixHolds === true ? 'v2' : 'v1';
  $('system').value = S.system;
  const saved = store.get(runKey(S.system));
  if (saved && saved.records && Array.isArray(saved.records.gated) && saved.records.gated.length) S.local = saved;
  S.attacksLocal = store.get('bs-attacks'); S.foldLocal = store.get('bs-fold');
  $('askKind').innerHTML = ORDER.map((k) => `<option value="${k}">${esc(KIND_NAMES[k])}</option>`).join('');
  $('askKind').value = 'qa';
  $('askKind').addEventListener('change', () => { exampleAt = 0; example(); });
  $('askExample').addEventListener('click', example);
  example();
  $('docsText').value = corpus.paragraphs.slice(0, 2).map((p) => p.text).join('\n\n');
  $('docsQ').value = 'Who gave their name to Normandy?';
  $('system').addEventListener('change', () => { S.system = ['v2', 'v3'].includes($('system').value) ? $('system').value : 'v1'; const sv = store.get(runKey(S.system)); S.local = sv && sv.records && Array.isArray(sv.records.gated) && sv.records.gated.length ? sv : null; S.view = 'published'; renderAll(); });
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
    else if (act === 'discard-run') { S.local = null; S.view = 'published'; store.del(runKey(S.system)); }
    else return;
    renderAll();
  });
  await renderAll();
  await device();
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js'); } catch { /* not served */ }
  document.documentElement.dataset.ready = '1';
})();
// a probe for BUILDING the cells, on building material only: the dev split and the tuning pools, never a test split
async function probe({ system = 'v2', split = 'dev', kinds = null, limit = 0, opts = null } = {}) {
  if (!['dev', 'tune', 'tune2'].includes(split)) throw new Error('the probe reads only the dev split and the tuning pools');
  if (!(await needModel())) return null;
  let pool = split === 'dev' ? S.data.suite.dev : (await getJSON(`data/${split}.json`)).tasks;
  if (kinds) pool = pool.filter((t) => kinds.includes(t.kind));
  if (limit > 0) { const per = {}; pool = pool.filter((t) => (per[t.kind] = (per[t.kind] || 0) + 1) <= limit); }
  const call = SWARM.caller(ask), recs = [];
  window.__probe = { done: 0, of: pool.length, result: null };
  for (const t of pool) { recs.push(system === 'v2' ? await ASM.assemble(t, call, S.ctx, opts || S.data.settings2 || {}) : await SWARM.gated(t, call, S.ctx)); window.__probe.done = recs.length; }
  const m = SCORE.metrics(pool, recs, { ctx: S.ctx }), T = new Map(pool.map((t) => [t.id, t]));
  const byKind = Object.fromEntries(Object.entries(m.byKind).map(([k, x]) => { const c = recs.filter((r) => r.kind === k).map((r) => r.calls.filter((y) => !y.cached).length); return [k, { tasks: x.tasks, right: x.correct, silent: x.silent, released: x.released, medianMs: x.medianMs, callsPerTask: +(c.reduce((p, q) => p + q, 0) / (c.length || 1)).toFixed(2) }]; }));
  const rows = recs.map((r) => { const t = T.get(r.id), o = SCORE.outcome(t, r); return { kind: r.kind, how: o.silent ? 'WRONG' : o.correct ? (r.released ? 'right' : 'refused-right') : 'held', atoms: (r.atoms || r.calls || []).map((a) => (a.atom ? `${a.atom}=${String(a.said).slice(0, 40)}${a.ok ? '' : ' ✗'}` : String(a.text).slice(0, 40))), why: r.released ? '' : String(r.why).split(': ').slice(-1)[0].slice(0, 80), input: JSON.stringify(t.input).slice(0, 110), gold: JSON.stringify(t.gold).slice(0, 70) }; });
  window.__probe.result = { system, split, byKind, rows };
  return window.__probe.result;
}
window.__swarm = { ready, foldMeasure, rejudge, renderAll, probe, runSet, needModel, S };
