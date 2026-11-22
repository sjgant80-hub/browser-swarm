// run-node.mjs — run both arms (the swarm, gated; and the same model raw) over a split, on a model served by Ollama on
// 127.0.0.1. Nothing leaves this machine. Greedy decoding (temperature 0, seed 0), a 4,096-token context.
//   node scripts/run-node.mjs --model llama3.2:1b --split dev [--only qa,route] [--limit 5] [--out data/runs/x.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { caller, gated, raw } from '../src/swarm.mjs';
import S from '../src/cells.mjs';
import { metrics } from '../src/score.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('--model', 'llama3.2:1b'), SPLIT = arg('--split', 'dev'), ONLY = arg('--only', ''), LIMIT = Number(arg('--limit', '0'));
const HOST = 'http://127.0.0.1:11434';
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const SEAL = createHash('sha256').update(readFileSync('SEAL2.json')).digest('hex');   // the run records which seal it ran under
const suite = rd('data/suite.json');
const ctx = S.prepare(rd('data/corpus.json'), rd('data/banking-index.json'), rd('data/departments.json'), rd('data/settings.json'));
let tasks = SPLIT === 'tune' ? rd('data/tune.json').tasks : suite[SPLIT];
if (ONLY) tasks = tasks.filter((t) => ONLY.split(',').includes(t.kind));
if (LIMIT > 0) { const per = {}; tasks = tasks.filter((t) => (per[t.kind] = (per[t.kind] || 0) + 1) <= LIMIT); }

async function ask(messages, maxTokens) {
  const t0 = performance.now();
  const r = await fetch(`${HOST}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: false, keep_alive: '30m', options: { temperature: 0, seed: 0, num_predict: maxTokens, num_ctx: 4096 } }) });
  if (!r.ok) throw new Error(`ollama ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  return { text: j.message ? j.message.content : '', ms: Math.round(performance.now() - t0), ttft: j.prompt_eval_duration ? Math.round(j.prompt_eval_duration / 1e6) : null, prompt: j.prompt_eval_count || null };
}

const tags = await (await fetch(`${HOST}/api/tags`)).json();
const digest = ((tags.models || []).find((m) => m.name === MODEL || m.model === MODEL) || {}).digest || null;
const call = caller(ask);
const recs = { gated: [], raw: [] };
const t0 = Date.now();
for (const [i, t] of tasks.entries()) {
  const g = await gated(t, call, ctx);
  const r = await raw(t, call, ctx);
  recs.gated.push(g); recs.raw.push(r);
  if ((i + 1) % 10 === 0 || i === tasks.length - 1) process.stderr.write(`${i + 1}/${tasks.length} ${Math.round((Date.now() - t0) / 1000)}s\n`);
}
const m = { gated: metrics(tasks, recs.gated, { ctx, arm: 'gated', venue: 'node', model: MODEL }), raw: metrics(tasks, recs.raw, { ctx, arm: 'raw', venue: 'node', model: MODEL }) };
const out = arg('--out', `data/runs/node-${MODEL.replace(/[^a-z0-9.]+/gi, '_')}-${SPLIT}${ONLY ? '-' + ONLY.replace(/,/g, '+') : ''}${LIMIT ? '-l' + LIMIT : ''}.json`);
mkdirSync('data/runs', { recursive: true });
writeFileSync(out, JSON.stringify({ v: 'browser-swarm-run/1', venue: 'node (Ollama, 127.0.0.1)', model: MODEL, digest, split: SPLIT, sealSha256: SEAL, suiteSha256: suite.testSha256, at: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), records: recs, metrics: { gated: { ...m.gated, rows: undefined }, raw: { ...m.raw, rows: undefined } } }, null, 1) + '\n');
const line = (a) => `${a.arm.padEnd(5)} acc ${(a.all.accuracy * 100).toFixed(1)}% · silent ${(a.all.silentRate * 100).toFixed(1)}% · released ${a.all.released}/${a.all.tasks} · grounded ${a.all.groundedRate === null ? '-' : (a.all.groundedRate * 100).toFixed(0) + '%'} · median ${a.all.medianMs} ms`;
console.log(`${MODEL} ${SPLIT} (${tasks.length} tasks, ${Math.round((Date.now() - t0) / 1000)} s) → ${out}\n${line(m.gated)}\n${line(m.raw)}`);
for (const k of Object.keys(m.gated.byKind)) { const g = m.gated.byKind[k], r = m.raw.byKind[k]; console.log(`  ${k.padEnd(10)} gated acc ${(g.accuracy * 100).toFixed(0)}% silent ${g.silent}/${g.tasks} | raw acc ${(r.accuracy * 100).toFixed(0)}% silent ${r.silent}/${r.tasks}`); }
