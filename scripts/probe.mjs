// probe.mjs — try the decomposed swarm (or the first build) on BUILDING material only: the dev split and the tuning
// pools. It refuses the test splits. On a model served by Ollama on 127.0.0.1 it is a plumbing check and a cross-check;
// the cells are tuned in the browser venue (the page's own probe), because that is where they are measured.
//   node scripts/probe.mjs --model llama3.2:1b --system v2 --split dev [--kinds date,pence] [--limit 5] [--show]
import { readFileSync } from 'node:fs';
import { caller, gated } from '../src/swarm.mjs';
import { assemble } from '../src/assembly.mjs';
import S from '../src/cells.mjs';
import { metrics, right } from '../src/score.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'llama3.2:1b'), SYSTEM = arg('--system', 'v2'), SPLIT = arg('--split', 'dev'), KINDS = arg('--kinds', ''), LIMIT = Number(arg('--limit', '0')), SHOW = process.argv.includes('--show');
if (!['dev', 'tune', 'tune2'].includes(SPLIT)) { console.error('probe.mjs only reads the dev split and the tuning pools'); process.exit(2); }
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ctx = S.prepare(rd('data/corpus.json'), rd('data/banking-index.json'), rd('data/departments.json'), rd('data/settings.json'));
let opts = {}; try { opts = rd('data/settings2.json'); } catch { /* defaults */ }
let tasks = SPLIT === 'dev' ? rd('data/suite.json').dev : rd(`data/${SPLIT}.json`).tasks;
if (KINDS) tasks = tasks.filter((t) => KINDS.split(',').includes(t.kind));
if (LIMIT > 0) { const per = {}; tasks = tasks.filter((t) => (per[t.kind] = (per[t.kind] || 0) + 1) <= LIMIT); }
async function ask(messages, maxTokens) {
  const t0 = performance.now();
  const r = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, stream: false, keep_alive: '10m', options: { temperature: 0, seed: 0, num_predict: maxTokens, num_ctx: 4096 } }) });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const j = await r.json();
  return { text: j.message ? j.message.content : '', ms: Math.round(performance.now() - t0) };
}
const call = caller(ask), recs = [];
for (const t of tasks) {
  const r = SYSTEM === 'v2' ? await assemble(t, call, ctx, opts) : await gated(t, call, ctx);
  recs.push(r);
  if (SHOW) console.log(`${t.kind} ${r.released ? (right(t, r.output) ? 'RIGHT' : 'WRONG!') : 'held'} · ${(r.atoms || []).map((a) => `${a.atom}=${JSON.stringify(a.said).slice(0, 30)}${a.ok ? '' : '✗'}`).join(' ')} ${r.released ? '' : '· ' + String(r.why).slice(-70)}`);
}
const m = metrics(tasks, recs, { ctx });
console.log(`${SYSTEM} · ${MODEL} · ${SPLIT} (${tasks.length} tasks)`);
for (const [k, x] of Object.entries(m.byKind)) {
  const calls = recs.filter((r) => r.kind === k).map((r) => r.calls.filter((c) => !c.cached).length);
  console.log(`  ${k.padEnd(9)} right ${String(x.correct).padStart(3)}/${x.tasks} · silent ${x.silent} · released ${x.released} · calls/task ${(calls.reduce((a, b) => a + b, 0) / (calls.length || 1)).toFixed(1)} · median ${x.medianMs} ms`);
}
