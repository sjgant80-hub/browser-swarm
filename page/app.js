// page/app.js — the page script. Every decision and every number on the page is computed by the inlined kernels above
// (CELLS, SWARM, SCORE, CLAIMS, COST …), from the published runs in data/runs/ or from a run made here, in this tab.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : '—');
const usd = (x) => (Number.isFinite(x) ? (x >= 100 ? `$${Math.round(x).toLocaleString('en-GB')}` : `$${x.toFixed(2)}`) : '—');
const bind = (k, html) => { for (const el of document.querySelectorAll(`[data-bind="${k}"]`)) el.innerHTML = html; };
const getJSON = async (p) => { try { const r = await fetch(p); return r.ok ? await r.json() : null; } catch { return null; } };
const KIND_NAMES = { qa: 'documents', extract: 'receipt total', classify: 'banking intent', route: 'department', date: 'ISO date', pence: 'pence', draft: 'refund letter', knowledge: 'knowledge (should lose)', reasoning: 'reasoning (should lose)' };
const ORDER = ['qa', 'extract', 'classify', 'route', 'date', 'pence', 'draft', 'knowledge', 'reasoning'];

const S = { data: null, ctx: null, engine: null, model: null, run: null, fold: null };
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
  return `${input.question.trim()}\n${['A', 'B', 'C', 'D'].map((k) => `${k}. ${input.options[k]}`).join('\n')}`;
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
const REQUEST = Object.fromEntries(ORDER.map((k) => [k, null]));

// ── the published runs → the six numbers, the claims, the tables ──
function metricsOf(run, arm, venue) {
  if (!run || !run.records || !run.records[arm]) return null;
  return SCORE.metrics(S.data.suite.test, run.records[arm], { ctx: S.ctx, arm, venue, model: run.model });
}
function arms() {
  const P = S.data.runs;
  return {
    swarm: metricsOf(P.tab, 'gated', 'tab'), raw1: metricsOf(P.tab, 'raw', 'tab'),
    raw7: metricsOf(P.big, 'raw', 'node'), gated7: metricsOf(P.big, 'gated', 'node'),
    node1g: metricsOf(P.node1b, 'gated', 'node'), node1r: metricsOf(P.node1b, 'raw', 'node'),
  };
}
const COLS = [['swarm', 'swarm (1B, tab)'], ['raw1', '1B raw (tab)'], ['gated7', '7B gated'], ['raw7', '7B raw'], ['node1g', '1B gated (Ollama)'], ['frontier', 'frontier']];
function renderSix(A) {
  const head = $('six').querySelector('thead tr');
  head.innerHTML = '<th>measure</th>' + COLS.map(([, n]) => `<th class="num">${esc(n)}</th>`).join('');
  const cell = (m, f) => (m ? f(m) : '<span class="pend">pending</span>');
  const g = (m) => { const x = CLAIMS.grounding(m); return x.of ? `${pct(x.grounded / x.of)} <span class="muted">(${x.grounded}/${x.of})</span>` : '—'; };
  const rows = [
    ['silent-failure rate, all 410', (m) => `<b>${pct(m.all.silentRate)}</b> <span class="muted">(${m.all.silent})</span>`],
    ['accuracy, all 410', (m) => pct(m.all.accuracy)],
    ['accuracy, the 330 bounded', (m) => pct(m.bounded.accuracy)],
    ['accuracy, the 80 hard (should lose)', (m) => pct(m.hard.accuracy)],
    ['answers released', (m) => `${m.all.released} <span class="muted">(${pct(m.all.coverage, 0)})</span>`],
    ['wrong among released', (m) => pct(m.all.silentAmongReleased)],
    ['grounding: fact answers traced to source', g],
    ['median time per task', (m) => `${(m.all.medianMs / 1000).toFixed(2)} s`],
    ['cost per task', (m) => (m.venue === 'tab' || m.venue === 'node' ? '$0' : '—')],
    ['data left the device', (m) => (m.venue === 'tab' ? `no <span class="muted">(${S.data.runs.tab && S.data.runs.tab.privacy ? S.data.runs.tab.privacy.requests : '?'} requests)</span>` : 'no (127.0.0.1)')],
  ];
  $('six').querySelector('tbody').innerHTML = rows.map(([label, f]) => `<tr><td>${esc(label)}</td>${COLS.map(([k]) => `<td class="num">${k === 'frontier' ? '<span class="pend">pending</span>' : cell(A[k], f)}</td>`).join('')}</tr>`).join('');
  const t = S.data.runs.tab;
  $('sixNote').textContent = t ? `Tab run: ${t.model}, ${t.gpu ? t.gpu : 'GPU not reported'}, ${t.at.slice(0, 10)}, seal ${String(t.sealSha256).slice(0, 12)}. 7B and Ollama runs: this laptop's CPU (Intel i7-1255U), 127.0.0.1.` : 'The tab run is not published yet. The 7B and Ollama columns come from this laptop\'s CPU on 127.0.0.1.';
}
function renderMoney(A) {
  const bars = [['swarm (1B, tab)', A.swarm, 'var(--series)'], ['7B gated', A.gated7, 'var(--series3)'], ['1B raw (tab)', A.raw1, 'var(--series2)'], ['7B raw', A.raw7, 'var(--series2)'], ['frontier raw', null, 'var(--line)']];
  const max = Math.max(0.1, ...bars.map(([, m]) => (m ? m.all.silentRate : 0)));
  const W = 560, x0 = 170;
  $('money').innerHTML = `<title>Silent-failure rate by arm, filled from the published runs</title>` + bars.map(([name, m, col], i) => {
    const y = 18 + i * 46, w = m ? Math.max(2, (m.all.silentRate / max) * W) : W * 0.12;
    return `<text x="${x0 - 10}" y="${y + 19}" text-anchor="end">${esc(name)}</text>` +
      (m ? `<rect x="${x0}" y="${y}" width="${w.toFixed(1)}" height="28" rx="4" fill="${col}"/><text x="${(x0 + w + 8).toFixed(1)}" y="${y + 19}">${pct(m.all.silentRate)} · ${m.all.silent} of ${m.all.tasks}</text>`
        : `<rect x="${x0}" y="${y}" width="${w}" height="28" rx="4" fill="none" stroke="var(--muted)" stroke-dasharray="4 4"/><text x="${x0 + w + 8}" y="${y + 19}" class="muted">pending: needs an API key (claim X)</text>`);
  }).join('');
}
function renderKinds(A) {
  const k = (m, kind, f) => (m && m.byKind[kind] ? f(m.byKind[kind]) : '—');
  $('kinds').querySelector('tbody').innerHTML = ORDER.map((kind) => {
    const sw = A.swarm || A.node1g;
    return `<tr><td>${esc(KIND_NAMES[kind])}</td><td class="num">${k(sw, kind, (x) => x.tasks)}</td><td class="num">${k(sw, kind, (x) => x.correct)}</td><td class="num">${k(sw, kind, (x) => x.silent)}</td><td class="num">${k(sw, kind, (x) => x.released)}</td>` +
      `<td class="num">${k(A.raw1 || A.node1r, kind, (x) => x.silent)}</td><td class="num">${k(A.raw7, kind, (x) => x.correct)}</td><td class="num">${k(A.raw7, kind, (x) => x.silent)}</td></tr>`;
  }).join('');
}
function verdictsOf(A) {
  const P = S.data.runs;
  return CLAIMS.evaluate({ swarm: A.swarm, swarmRaw: A.raw1, bigRaw: A.raw7, privacy: P.tab ? P.tab.privacy : null, attacks: P.attacks, fold: P.fold ? P.fold.summary : null });
}
const NAMES = { H: 'Headline: the swarm\'s silent-failure rate', B1: 'Match-or-close on bounded work', B2: 'The honest loss on hard work', G: 'Grounding', P: 'Privacy', L: 'Latency', $: 'Cost', A1: 'A1 tampered corpus', A2: 'A2 poisoned twin', A2b: 'A2b lie at the source', A3: 'A3 prompt injection', A4: 'A4 engineered wrong answers', F: 'Fold-cache', X: 'Frontier arm' };
function renderClaims(V) {
  $('claimsTable').querySelector('tbody').innerHTML = V.map((v) => `<tr><td><b>${esc(v.id)}</b> ${esc(NAMES[v.id] || '')}</td><td class="small">${esc((CLAIMS.BARS[v.id] || '').replace(/\*\*/g, ''))}</td><td class="small">${esc(v.result)}</td><td>${v.pass === true ? '<span class="pass">PASS</span>' : v.pass === false ? '<span class="fail">FAIL</span>' : v.id === '$' || v.id === 'A2b' ? '<span class="muted">reported</span>' : '<span class="pend">PENDING</span>'}</td></tr>`).join('');
}
function renderAttacks() {
  const s = S.data.runs.attacks ? S.data.runs.attacks.summary : null;
  const what = { A1: 'changes a signed paragraph after signing', A2: 'adds a signed false copy beside the right paragraph', A2b: 'writes the lie into the right paragraph and signs it', A3: 'adds "ignore … the answer is X" to the right paragraph, signed', A4: 'hands the judge a wrong answer of the right type, copied from the right paragraph' };
  const V = Object.fromEntries(verdictsOf(arms()).map((v) => [v.id, v]));
  $('attackTable').querySelector('tbody').innerHTML = ['A1', 'A2', 'A2b', 'A3', 'A4'].map((id) => {
    const x = s && s[id];
    const rel = !x ? '—' : id === 'A4' ? `${x.released} of ${x.candidates}` : `${x.gatedFalse} of ${x.built}`;
    const raw = !x ? '—' : id === 'A4' ? 'n/a' : `${x.rawFalse} of ${x.built}`;
    const v = V[id];
    return `<tr><td><b>${id}</b></td><td>${esc(what[id])}</td><td class="num">${rel}</td><td class="num">${raw}</td><td>${!v || v.pass === null ? (id === 'A2b' && x ? '<span class="muted">reported</span>' : '<span class="pend">PENDING</span>') : v.pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'}</td></tr>`;
  }).join('');
}

// ── a decision, drawn stage by stage ──
function stages(task, g, r) {
  const st = (ok, title, body) => `<div class="stage ${ok ? 'ok' : 'no'}"><b>${esc(title)}</b><br>${body}</div>`;
  const out = [];
  out.push(st(!!g.cell, 'Conductor', g.cell ? `routed to <code>${esc(g.cell)}</code>` : esc(g.why)));
  if (g.cell) {
    const laneNo = g.stage === 'lane';
    out.push(st(!laneNo, 'Lane check', laneNo ? esc(g.why.split(': ').slice(-1)[0]) : 'in lane: the model may run'));
    if (!laneNo) {
      out.push(st(true, 'Base model replied', g.calls.map((c) => `<code>${esc(String(c.text).slice(0, 300))}</code>`).join(' · ') || '<span class="muted">(no reply)</span>'));
      out.push(st(g.released, 'Judge', g.released ? 'verified' + (g.ground && g.ground.source ? `: characters ${g.ground.start}–${g.ground.end} of <code>${esc(g.ground.source)}</code>` : '') : esc(g.why)));
    }
  }
  const show = (o) => esc(o.answer ?? o.value ?? o.label ?? o.domain ?? o.iso ?? o.pence ?? o.letter ?? JSON.stringify(o));
  out.push(`<div class="verdict ${g.released ? 'ok' : 'no'}">${g.released ? `Released: ${show(g.output)}` : 'Withheld: the swarm says it cannot answer this'}</div>`);
  if (r) out.push(`<p class="small">The same model with no checks: ${r.released ? `<b>${show(r.output)}</b>` : 'no answer'}${task && task.gold ? ` · ${r.released && SCORE.right(task, r.output) ? '<span class="pass">right</span>' : r.released ? '<span class="fail">wrong, delivered as if right</span>' : ''}` : ''}</p>`);
  return out.join('');
}
async function renderTrace() {
  const t = S.data.runs.tab || S.data.runs.node1b;
  if (!t) { $('trace').innerHTML = '<p class="pend">The tab run is not published yet.</p>'; return; }
  const tasks = new Map(S.data.suite.test.map((x) => [x.id, x]));
  const pick = [t.records.gated.find((g) => g.released && g.kind === 'qa'), t.records.gated.find((g) => g.status === 'unverified'), t.records.gated.find((g) => g.stage === 'lane' && (g.kind === 'knowledge' || g.kind === 'reasoning'))].filter(Boolean);
  const parts = [];
  for (const rec of pick) {
    const task = tasks.get(rec.id), again = await SWARM.replay(task, rec, S.ctx);
    const raw = t.records.raw.find((x) => x.id === rec.id);
    const same = JSON.stringify([again.released, again.status, again.why]) === JSON.stringify([rec.released, rec.status, rec.why]);
    parts.push(`<div class="card"><p class="small muted">${esc(KIND_NAMES[task.kind])} · <code>${esc(task.id)}</code> · re-decided on this page: ${same ? '<span class="pass">same decision</span>' : '<span class="fail">different</span>'}</p><pre>${esc(toText(task.kind, task.input).slice(0, 600))}</pre>${stages(task, again, raw ? await SWARM.replay(task, raw, S.ctx) : null)}</div>`);
  }
  $('trace').innerHTML = parts.join('');
}

// ── the cost case (COST kernel) ──
function renderCost(A) {
  const pr = S.data.prices, m = pr && pr.models ? pr.models['claude-opus-5-5'] : null;
  bind('price.read', esc(pr ? pr.read : '—')); bind('price.model', m ? `the largest listed model, $${m.in} in and $${m.out} out per million tokens` : '—');
  const t = S.data.runs.tab;
  const tok = t && Array.isArray(t.usage) ? COST.tokens(t.usage.map((u) => ({ calls: u }))) : { prompt: null, reply: null, callsPerTask: null };
  const c = COST.costCase({ prompt: tok.prompt, reply: tok.reply, callsPerTask: tok.callsPerTask, tasksPerMonth: Number($('tpm').value), price: m, silentSwarm: A.swarm ? A.swarm.all.silentRate : null, silentRaw: A.raw1 ? A.raw1.all.silentRate : null, costPerSilent: $('cps').value === '' ? null : Number($('cps').value) });
  bind('cost.api', usd(c.apiPerMonth));
  bind('cost.apiNote', tok.prompt === null ? 'pending: needs the tab run\'s token counts' : `${Math.round(tok.prompt)} prompt and ${Math.round(tok.reply)} reply tokens a call, ${tok.callsPerTask.toFixed(2)} calls a task, measured`);
  bind('cost.silent', c.silentAvoidedPerMonth === null ? '—' : Math.round(c.silentAvoidedPerMonth).toLocaleString('en-GB'));
  bind('cost.silentCost', c.silentCostAvoided === null ? 'enter your figure' : usd(c.silentCostAvoided));
}

function renderHeadline(A, V) {
  const sw = A.swarm || A.node1g, r1 = A.raw1 || A.node1r;
  bind('hl.swarm', sw ? pct(sw.all.silentRate) : 'pending'); bind('hl.raw1', r1 ? pct(r1.all.silentRate) : 'pending'); bind('hl.raw7', A.raw7 ? pct(A.raw7.all.silentRate) : 'pending');
  bind('hl.privacy', S.data.runs.tab && S.data.runs.tab.privacy ? `${S.data.runs.tab.privacy.requests} requests` : 'pending');
  const failed = V.filter((v) => v.pass === false).map((v) => v.id), passed = V.filter((v) => v.pass === true).map((v) => v.id);
  bind('hl.note', `Of the pre-registered claims, ${passed.length} pass (${esc(passed.join(', ') || 'none')}) and ${failed.length} fail (${esc(failed.join(', ') || 'none')}). The rest are pending or reported. Every verdict is computed on this page. ${A.swarm ? '' : 'The tab run is not published yet, so the swarm figures shown come from the same 1B on Ollama.'}`);
  bind('b.vs', sw && r1 ? `swarm delivered a wrong answer as if right on ${pct(sw.all.silentRate)} of 410 tasks, against ${pct(r1.all.silentRate)} for the same model unchecked${A.raw7 ? ` and ${pct(A.raw7.all.silentRate)} for a model seven times its size` : ''}.` : 'numbers are pending the published runs.');
  bind('b.req', S.data.runs.tab && S.data.runs.tab.privacy ? String(S.data.runs.tab.privacy.requests) : '(pending the tab run)');
  bind('b.board', sw && r1 ? `On 410 sealed tasks, it cut the confidently wrong answers from ${r1.all.silent} to ${sw.all.silent}.` : '');
  const H = V.find((v) => v.id === 'H');
  bind('p.result', sw ? `${esc(H.result)}. The headline claim ${H.pass === true ? 'passes' : H.pass === false ? '<b>fails</b> its bar' : 'is pending'}. Bounded accuracy: swarm ${pct(sw.bounded.accuracy)}${A.raw7 ? ` against the 7B raw's ${pct(A.raw7.bounded.accuracy)}` : ''}. Hard work: swarm ${pct(sw.hard.accuracy)}${A.raw7 ? `, 7B raw ${pct(A.raw7.hard.accuracy)}` : ''}. The full table is above.` : 'pending the published runs.');
  const F = V.find((v) => v.id === 'F');
  bind('bp.fold', F.pass === true ? '<span class="pass">measured: it helps (F passes)</span>' : F.pass === false ? '<span class="fail">measured: no gain (F fails)</span>' : '<span class="pend">pending its measurement</span>');
}
function renderWalk() {
  const w = S.data.walk;
  if (!w) return;
  $('walk').innerHTML = `<h3>A simulated buyer walk</h3><p class="small muted">${esc(w.note)}</p>` + w.personas.map((p) => `<details><summary>${esc(p.who)}: ${esc(p.verdict)}</summary><ul>${p.gaps.map((g) => `<li>${esc(g.gap)} <span class="muted">→ ${esc(g.fix)}</span></li>`).join('')}</ul></details>`).join('');
}
function renderAll() {
  const A = arms(), V = verdictsOf(A);
  renderHeadline(A, V); renderSix(A); renderMoney(A); renderKinds(A); renderClaims(V); renderAttacks(); renderCost(A); renderWalk();
  return renderTrace();
}

// ── re-judge every published decision from its recorded reply ──
async function rejudge() {
  const out = $('rejudgeOut'); out.innerHTML = '<p class="small">Replaying…</p>';
  const tasks = new Map(S.data.suite.test.map((x) => [x.id, x]));
  const key = (r) => JSON.stringify([r.released, r.status ?? null, r.output ?? null, r.why]);
  const lines = [];
  for (const [name, run] of [['tab run', S.data.runs.tab], ['7B run', S.data.runs.big], ['1B Ollama run', S.data.runs.node1b]]) {
    if (!run) { lines.push(`<li>${name}: not published yet</li>`); continue; }
    let n = 0, same = 0;
    for (const arm of ['gated', 'raw']) for (const rec of run.records[arm]) { n++; if (key(await SWARM.replay(tasks.get(rec.id), rec, S.ctx)) === key(rec)) same++; }
    lines.push(`<li>${name}: <b>${same} of ${n}</b> decisions identical ${same === n ? '<span class="pass">✓</span>' : '<span class="fail">differs</span>'}</li>`);
  }
  out.innerHTML = `<ul>${lines.join('')}</ul><p class="small muted">Each decision is re-derived from the recorded reply by the code on this page: the conductor, lane, guard and judge run for real.</p>`;
}

// ── the model in this tab ──
async function device() {
  if (!('gpu' in navigator)) { $('devStatus').innerHTML = '<span class="fail">No WebGPU in this browser.</span> Use a current Chrome or Edge on a laptop or desktop. Steps 5 and 6 still work.'; return null; }
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) { $('devStatus').innerHTML = '<span class="fail">WebGPU is present but no GPU adapter was offered.</span>'; return null; }
    const info = a.info || {};
    S.gpu = [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'a WebGPU adapter';
    $('devStatus').innerHTML = `<span class="pass">Ready:</span> ${esc(S.gpu)}${a.features && a.features.has('shader-f16') ? ', 16-bit shaders' : ', no 16-bit shaders (the 4-bit model may not load)'}.`;
    return a;
  } catch (e) { $('devStatus').textContent = `WebGPU check failed: ${e.message}`; return null; }
}
let usageNow = null;
async function ask(messages, maxTokens) {
  const t0 = performance.now();
  const r = await S.engine.chat.completions.create({ messages, temperature: 0, top_p: 1, max_tokens: maxTokens, seed: 0 });
  const u = r.usage || {}, x = u.extra || {};
  if (usageNow) usageNow.push({ prompt: u.prompt_tokens, reply: u.completion_tokens });
  return { text: r.choices && r.choices[0] ? r.choices[0].message.content : '', ms: Math.round(performance.now() - t0), ttft: x.time_to_first_token_s ?? null, prompt: u.prompt_tokens ?? null };
}
async function load() {
  const id = $('tier').value;
  $('load').disabled = true; $('loadStatus').textContent = 'Loading WebLLM 0.2.79…';
  try {
    const webllm = await import('https://esm.run/@mlc-ai/web-llm@0.2.79');
    S.engine = await webllm.CreateMLCEngine(id, { initProgressCallback: (p) => { $('loadBar').style.width = `${Math.round((p.progress || 0) * 100)}%`; $('loadStatus').textContent = p.text || ''; } });
    S.model = id;
    $('loadBar').style.width = '100%'; $('loadStatus').innerHTML = `<span class="pass">Loaded:</span> ${esc(id)}. It is now in this browser's storage.`;
    for (const b of ['ask', 'docsAsk', 'run', 'fold']) if ($(b)) $(b).disabled = false;
  } catch (e) { $('loadStatus').innerHTML = `<span class="fail">Could not load:</span> ${esc(e.message || e)}`; $('load').disabled = false; }
}

// ── step 3: ask ──
let exampleAt = 0;
function example() {
  const kind = $('askKind').value, list = S.data.suite.dev.filter((t) => t.kind === kind);
  const t = list[exampleAt++ % list.length];
  $('askInput').value = toText(kind, t.input);
  REQUEST[kind] = t.request;
}
async function askOne() {
  const kind = $('askKind').value, input = fromText(kind, $('askInput').value);
  const task = { id: 'yours', kind, request: REQUEST[kind] || S.data.suite.dev.find((t) => t.kind === kind).request, input };
  $('askOut').innerHTML = '<p class="small">Asking…</p>';
  const call = SWARM.caller(ask);
  const g = await SWARM.gated(task, call, S.ctx), r = await SWARM.raw(task, call, S.ctx);
  $('askOut').innerHTML = `<p class="small muted">Request: “${esc(task.request)}”</p>` + stages(null, g, r);
}

// ── step 4: your documents ──
async function askDocs() {
  const paras = $('docsText').value.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean).map((text, i) => ({ id: `yours#${i}`, text, sha256: SHA.sha256(text) }));
  if (!paras.length) { $('docsOut').innerHTML = '<p class="fail">Paste at least one paragraph.</p>'; return; }
  const ctx = CELLS.prepare({ paragraphs: paras }, S.data.bank, S.data.depts, { ...S.data.settings, qa: { ...S.data.settings.qa, minScore: 2 } });
  const task = { id: 'yours', kind: 'qa', request: 'Answer this question from our documents.', input: { question: $('docsQ').value } };
  const call = SWARM.caller(ask);
  const g = await SWARM.gated(task, call, ctx);
  $('docsOut').innerHTML = `<p class="small muted">${paras.length} paragraph(s) signed here: ${paras.map((p) => `<code>${p.sha256.slice(0, 10)}…</code>`).join(' ')}</p>` + stages(null, g, null);
}

// ── step 5: the measurement, in this tab ──
async function runSuite() {
  const which = $('runWhich').value, suite = S.data.suite;
  const tasks = which === 'test' ? suite.test : which === 'dev' ? suite.dev : ORDER.flatMap((k) => suite.dev.filter((t) => t.kind === k).slice(0, 2));
  $('run').disabled = true; $('save').disabled = true;
  const seen = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) seen.push(e.name); });
  try { obs.observe({ type: 'resource', buffered: false }); } catch { /* no observer */ }
  const before = performance.getEntriesByType('resource').length;
  const call = SWARM.caller(ask), recs = { gated: [], raw: [] }, usage = [], t0 = Date.now();
  for (const [i, t] of tasks.entries()) {
    usageNow = [];
    recs.gated.push(await SWARM.gated(t, call, S.ctx));
    recs.raw.push(await SWARM.raw(t, call, S.ctx));
    usage.push(usageNow); usageNow = null;
    $('runBar').style.width = `${Math.round(((i + 1) / tasks.length) * 100)}%`;
    if (i % 3 === 2 || i === tasks.length - 1) {
      const g = SCORE.metrics(tasks.slice(0, i + 1), recs.gated, { ctx: S.ctx }), r = SCORE.metrics(tasks.slice(0, i + 1), recs.raw, { ctx: S.ctx });
      $('runOut').innerHTML = `${i + 1} of ${tasks.length} · swarm silent ${g.all.silent} (${pct(g.all.silentRate)}), right ${g.all.correct}, median ${(g.all.medianMs / 1000).toFixed(2)} s · same model unchecked: silent ${r.all.silent} (${pct(r.all.silentRate)}), right ${r.all.correct} · ${Math.round((Date.now() - t0) / 1000)} s`;
    }
  }
  try { obs.disconnect(); } catch { /* none */ }
  const after = performance.getEntriesByType('resource').length;
  const sealText = await (await fetch('SEAL2.json')).text().catch(() => '');
  S.run = { v: 'browser-swarm-run/1', venue: 'tab (WebLLM 0.2.79, WebGPU)', model: S.model, gpu: S.gpu || null, ua: navigator.userAgent, split: which === 'sample' ? 'dev-sample' : which, sealSha256: sealText ? SHA.sha256(sealText.split('\r\n').join('\n')) : null, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), privacy: { requests: Math.max(after - before, seen.length), resourcesBefore: before, resourcesAfter: after, observed: seen.length }, records: recs, usage };
  window.__swarmRun = S.run;
  $('runOut').innerHTML += `<br><b>Done.</b> Network requests while it ran: ${S.run.privacy.requests}.`;
  $('run').disabled = false; $('save').disabled = false;
}
function save() {
  if (!S.run) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S.run)], { type: 'application/json' }));
  a.download = `browser-swarm-${S.run.split}-${S.run.at.slice(0, 10)}.json`;
  a.click();
}

// ── claim F: the fold-cache, measured in this tab (exposed for the published run; same tasks, two orders, twice) ──
async function foldMeasure() {
  const per = 6, kinds = ORDER.slice(0, 7), test = S.data.suite.test;
  const pick = Object.fromEntries(kinds.map((k) => [k, test.filter((t) => t.kind === k).slice(0, per)]));
  const grouped = kinds.flatMap((k) => pick[k]), inter = Array.from({ length: per }, (_, i) => kinds.map((k) => pick[k][i])).flat();
  const once = async (list) => {
    const out = new Map();
    for (const t of list) {
      const cell = CELLS.CELLS.find((c) => c.name === CELLS.FOR_KIND[t.kind]);
      const lane = cell.name === 'docs-answer' || cell.name === 'banking-intent' ? cell.lane_(t.input, S.ctx, false) : { inLane: true };
      const r = await ask(cell.messages(t.input, lane, S.ctx, 0), cell.maxTokens);
      out.set(t.id, r);
    }
    return out;
  };
  const rounds = [];
  for (let k = 0; k < 2; k++) { rounds.push(['interleaved', await once(inter)]); rounds.push(['grouped', await once(grouped)]); }
  const med = (xs) => STATS.median(xs);
  const ttft = (name) => rounds.filter(([n]) => n === name).flatMap(([, m]) => [...m.values()].map((r) => r.ttft)).filter(Number.isFinite);
  const I = rounds[0][1], G = rounds[1][1];
  const identical = grouped.filter((t) => I.get(t.id).text === G.get(t.id).text).length;
  S.fold = { v: 'browser-swarm-fold/1', model: S.model, at: new Date().toISOString(), tasks: grouped.map((t) => t.id), summary: { grouped: med(ttft('grouped')), interleaved: med(ttft('interleaved')), identical, pairs: grouped.length }, rounds: rounds.map(([n, m]) => ({ order: n, calls: [...m].map(([id, r]) => ({ id, ttft: r.ttft, ms: r.ms, text: r.text })) })) };
  window.__swarmFold = S.fold;
  return S.fold.summary;
}

// ── start ──
(async function start() {
  const [suite, corpus, bank, depts, settings, prices, published] = await Promise.all(['data/suite.json', 'data/corpus.json', 'data/banking-index.json', 'data/departments.json', 'data/settings.json', 'data/prices.json', 'data/published.json'].map(getJSON));
  const P = published || {};
  const runs = {};
  for (const k of ['tab', 'big', 'node1b', 'attacks', 'fold']) runs[k] = P[k] ? await getJSON(P[k]) : null;
  S.data = { suite, corpus, bank, depts, settings, prices, runs, walk: P.walk ? await getJSON(P.walk) : null };
  S.ctx = CELLS.prepare(corpus, bank, depts, settings);
  $('askKind').innerHTML = ORDER.map((k) => `<option value="${k}">${esc(KIND_NAMES[k])}</option>`).join('');
  $('askKind').addEventListener('change', () => { exampleAt = 0; example(); });
  $('askExample').addEventListener('click', example);
  example();
  $('docsText').value = corpus.paragraphs.slice(0, 2).map((p) => p.text).join('\n\n');
  $('docsQ').value = 'Who gave their name to Normandy?';
  $('load').addEventListener('click', load); $('ask').addEventListener('click', askOne); $('docsAsk').addEventListener('click', askDocs);
  $('run').addEventListener('click', runSuite); $('save').addEventListener('click', save); $('rejudge').addEventListener('click', rejudge);
  $('fold').addEventListener('click', async () => {
    $('fold').disabled = true; $('foldOut').textContent = 'Measuring: 42 tasks, in two orders, twice (about 4 minutes)…';
    const f = await foldMeasure();
    $('foldOut').innerHTML = `Median time to first token: grouped ${f.grouped.toFixed(3)} s, interleaved ${f.interleaved.toFixed(3)} s (${(f.grouped / f.interleaved).toFixed(2)}×). Identical replies: ${f.identical} of ${f.pairs}. Claim F's bar is 0.8× with 95% identical.`;
    $('fold').disabled = false;
  });
  for (const id of ['tpm', 'cps']) $(id).addEventListener('input', () => renderCost(arms()));
  window.__swarm = { foldMeasure, rejudge, S };
  await renderAll();
  await device();
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js'); } catch { /* not served */ }
  document.documentElement.dataset.ready = '1';
})();
