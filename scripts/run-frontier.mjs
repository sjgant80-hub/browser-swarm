// run-frontier.mjs — claim X: the frontier arm, raw, on the sealed test split. Every call goes through Kar's spend wall
// (kar-spendwall tools/ask.mjs, job "measure"), which allows it only under Simon's written approval on file and only
// under that approval's cap, the daily cap and Kar's stop. The key never passes through here.
// The prompts are the raw arm's own (src/swarm.mjs raw()): exactly what every other arm was asked. The tasks run in a
// seeded order (sha256 of "frontier:" + id), so a run the cap stops early is a fair sample across every kind. It
// resumes where it stopped: rerun to continue on a later day.
//   node scripts/run-frontier.mjs --approval frontier-baseline-2026-11-22 [--wall ../kar-spendwall]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { caller, raw } from '../src/swarm.mjs';
import S from '../src/cells.mjs';
import { metrics } from '../src/score.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const APPROVAL = arg('--approval', ''), WALL = resolve(arg('--wall', '../kar-spendwall'));
if (!APPROVAL) { console.error('usage: node scripts/run-frontier.mjs --approval <id>'); process.exit(2); }
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const SEAL = sha(readFileSync('SEAL2.json'));
const ctx = S.prepare(rd('data/corpus.json'), rd('data/banking-index.json'), rd('data/departments.json'), rd('data/settings.json'));
const test = rd('data/suite.json').test;
const order = test.map((t) => ({ t, k: sha(`frontier:${t.id}`) })).sort((a, b) => (a.k < b.k ? -1 : 1)).map((x) => x.t);
const OUT = 'data/runs/frontier-raw-test.json';
const prev = existsSync(OUT) ? rd(OUT) : null;
const done = new Map((prev ? prev.records.raw : []).map((r) => [r.id, r]));
const STOP = new Set(['day', 'stop', 'off', 'approval', 'key', 'config', 'price', 'big', 'clock']);
let stopped = null, model = prev ? prev.model : null, costCents = prev ? prev.costCents : 0, calls = prev ? prev.calls : 0;

// one call through the wall: the system prompt and the user message, exactly as the other arms were asked
async function ask(messages) {
  const t0 = Date.now();
  const req = { job: 'measure', evidence: { approval: APPROVAL }, system: messages[0].content, prompt: messages[1].content };
  const r = spawnSync(process.execPath, [join(WALL, 'tools', 'ask.mjs')], { input: JSON.stringify(req), encoding: 'utf8', cwd: WALL, timeout: 300000 });
  let o = null;
  try { o = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { o = null; }
  if (!o) throw new Error(`the wall gave no answer (exit ${r.status})`);
  if (!o.ok) {
    if (STOP.has(o.code)) { stopped = `${o.code}: ${o.why}`; throw new Error(stopped); }
    if (Number.isInteger(o.costCents)) { costCents += o.costCents; calls++; }
    throw new Error(`${o.code}: ${o.why || 'no text'}`);
  }
  costCents += o.costCents; calls++; model = o.model;
  return { text: o.text, ms: Date.now() - t0 };
}

const call = caller(ask);
const recs = [], errors = [];
for (const t of order) {
  if (done.has(t.id)) { recs.push(done.get(t.id)); continue; }
  if (stopped) break;
  const r = await raw(t, call, ctx);
  if (stopped) break;          // the wall refused this one: it is not recorded, and the run stops here
  // an API error is not the model declining to answer: it is kept out of the scored tasks and retried on the next run
  if (r.calls.some((c) => c.error)) { errors.push({ id: t.id, error: r.calls.find((c) => c.error).error }); continue; }
  recs.push(r);
  if (recs.length % 10 === 0) process.stderr.write(`${recs.length}/${order.length} · ${calls} calls · ${costCents}c booked\n`);
}
const byId = new Map(recs.map((r) => [r.id, r]));
const covered = test.filter((t) => byId.has(t.id));
const m = metrics(covered, recs, { ctx, arm: 'raw', venue: 'frontier', model });
mkdirSync('data/runs', { recursive: true });
writeFileSync(OUT, JSON.stringify({
  v: 'browser-swarm-run/1', venue: 'frontier API through kar-spendwall (job measure)', model, effort: 'medium (Simon\'s wall setting)', approval: APPROVAL,
  split: 'test', arm: 'raw', sealSha256: SEAL, at: new Date().toISOString(), order: 'sha256("frontier:" + id)', covered: covered.length, of: test.length,
  complete: covered.length === test.length, stoppedBy: stopped, errors, calls, costCents, records: { raw: recs }, metrics: { raw: { ...m, rows: undefined } },
}, null, 1) + '\n');
console.log(`frontier raw: ${covered.length} of ${test.length} tasks · ${calls} calls · ${costCents} cents booked by the wall${stopped ? ` · stopped by the wall: ${stopped}` : ''}`);
console.log(`silent ${m.all.silent}/${m.all.tasks} (${(m.all.silentRate * 100).toFixed(1)}%) · accuracy ${(m.all.accuracy * 100).toFixed(1)}% · released ${m.all.released}`);
