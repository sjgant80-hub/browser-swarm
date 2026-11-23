// compose-followup.mjs — the follow-up build's record on a set, assembled from the two registered runs (CLAIMS-3.md).
// The follow-up build is the decomposed build with the banking desk back to one call (data/settings3.json). On every
// task it makes exactly the model calls one registered run already holds: the first build's for a banking message, the
// decomposed build's for everything else. So no model is run here. For each task the recorded replies are handed to the
// follow-up build's own code (assembly.mjs under settings3), and the record counts only if the decision that comes out
// is the one the source run recorded. One decision that differs and nothing is written.
//   node scripts/compose-followup.mjs            compose both sets from the published runs
//   node scripts/compose-followup.mjs --check    compose again and compare with the published files (CI does this)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ASM from '../src/assembly.mjs';
import S from '../src/cells.mjs';
import { sourceOf } from '../src/claims3.mjs';

const CHECK = process.argv[2] === '--check';
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const pub = rd('data/published.json'), settings3 = rd('data/settings3.json');
const ctx = S.prepare(rd('data/corpus.json'), rd('data/banking-index.json'), rd('data/departments.json'), rd('data/settings.json'));
const key = (r) => JSON.stringify([r.released, r.status ?? null, r.output ?? null, r.why]);
// name → [the first build's run, the decomposed build's run, the task list, where the composed record is published, what it is]
const SETS = {
  follow: ['fresh1', 'fresh2', () => rd('data/test2.json').test, 'data/runs/followup-test2.json', 'test2'],
  followSeen: ['tab', 'tab2', () => rd('data/suite.json').test, 'data/runs/followup-test.json', 'test'],
};
let bad = 0;
for (const [name, [firstKey, decomposedKey, tasksOf, out, split]] of Object.entries(SETS)) {
  if (!pub[firstKey] || !pub[decomposedKey]) { console.log(`${name}: waits for ${!pub[firstKey] ? firstKey : decomposedKey}`); continue; }
  const first = rd(pub[firstKey]), decomposed = rd(pub[decomposedKey]), tasks = tasksOf();
  const byId = { first: new Map(first.records.gated.map((r) => [r.id, r])), decomposed: new Map(decomposed.records.gated.map((r) => [r.id, r])) };
  const records = [], from = { first: 0, decomposed: 0 };
  let differ = 0;
  for (const t of tasks) {
    const src = sourceOf(t), rec = byId[src].get(t.id);
    if (!rec) { differ++; continue; }
    const again = await ASM.replay(t, rec, ctx, settings3);
    if (key(again) !== key(rec)) { differ++; if (differ <= 5) console.error(`differs: ${t.id}\n  recorded ${key(rec).slice(0, 160)}\n  follow-up ${key(again).slice(0, 160)}`); }
    records.push(again); from[src]++;
  }
  if (differ) { console.error(`${name}: ${differ} decisions differ, nothing written`); bad++; continue; }
  const run = {
    v: 'browser-swarm-run/2', composed: true, system: 'v3', split, complete: true, venue: decomposed.venue, model: decomposed.model, gpu: decomposed.gpu,
    note: 'Assembled, not run: the first build\'s recorded replies for the banking tasks and the decomposed build\'s for the rest, each decided again by the follow-up build\'s code (scripts/compose-followup.mjs). Every decision equals the one its source run recorded.',
    from: { first: pub[firstKey], decomposed: pub[decomposedKey], firstSha256: hash(pub[firstKey]), decomposedSha256: hash(pub[decomposedKey]), tasksFromFirst: from.first, tasksFromDecomposed: from.decomposed },
    settings3Sha256: hash('data/settings3.json'), sealSha256: decomposed.sealSha256, seal3Sha256: decomposed.seal3Sha256, records: { gated: records },
  };
  const text = JSON.stringify(run) + '\n';
  if (CHECK) {
    if (!pub[name] || !existsSync(pub[name]) || readFileSync(pub[name], 'utf8') !== text) { console.error(`${name}: the published file is not what composing gives now`); bad++; } else console.log(`${name}: ${records.length} decisions, composed again, identical to the published file`);
  } else {
    writeFileSync(out, text); pub[name] = out;
    console.log(`${name}: ${records.length} decisions (${from.first} from the first build's run, ${from.decomposed} from the decomposed build's), every one equal to its source`);
  }
}
if (!CHECK) writeFileSync('data/published.json', JSON.stringify(pub, null, 1) + '\n');
if (bad) process.exitCode = 1;
