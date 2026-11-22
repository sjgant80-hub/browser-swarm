// replay.mjs — decide a recorded run again with the code as it is now: every recorded model reply is handed back in
// order, the conductor, lanes, guard and judges run for real, and the metrics are recomputed. With --check it fails
// unless every decision equals the recorded one (how CI proves a published run still follows from its replies).
//   node scripts/replay.mjs data/runs/<run>.json [--check]
import { readFileSync } from 'node:fs';
import { replay } from '../src/swarm.mjs';
import S from '../src/cells.mjs';
import { metrics } from '../src/score.mjs';

const file = process.argv[2], CHECK = process.argv.includes('--check');
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const run = rd(file);
const pool = run.split === 'tune' ? rd('data/tune.json').tasks : run.split === 'attacks' ? [] : rd('data/suite.json')[run.split];
const tasks = new Map(pool.map((t) => [t.id, t]));
const ctx = S.prepare(rd('data/corpus.json'), rd('data/banking-index.json'), rd('data/departments.json'), rd('data/settings.json'));
const key = (r) => JSON.stringify([r.released, r.status ?? null, r.output ?? null, r.why]);
let differ = 0;
const out = {};
for (const arm of ['gated', 'raw']) {
  const recs = [];
  for (const rec of run.records[arm]) {
    const t = tasks.get(rec.id);
    const again = await replay(t, rec, ctx);
    if (key(again) !== key(rec)) { differ++; if (differ <= 5) console.error(`differs: ${arm} ${rec.id}\n  was ${key(rec).slice(0, 200)}\n  now ${key(again).slice(0, 200)}`); }
    recs.push(again);
  }
  out[arm] = metrics([...tasks.values()].filter((t) => recs.some((r) => r.id === t.id)), recs, { ctx, arm });
}
const line = (a) => `${a.arm.padEnd(5)} acc ${(a.all.accuracy * 100).toFixed(1)}% · silent ${a.all.silent}/${a.all.tasks} (${(a.all.silentRate * 100).toFixed(1)}%) · released ${a.all.released}`;
console.log(`${file}\n${line(out.gated)}\n${line(out.raw)}`);
for (const k of Object.keys(out.gated.byKind)) { const g = out.gated.byKind[k]; console.log(`  ${k.padEnd(10)} gated right ${g.correct} silent ${g.silent} released ${g.released} of ${g.tasks}`); }
console.log(`${differ} decision(s) differ from the recording`);
if (CHECK && differ > 0) process.exitCode = 1;
