// publish-fix.mjs — take the fix's runs a browser tab made and publish them, after checking each one: it must be the
// complete set it says it is, made under seal 2 and seal 3, by the build it says, with every task answered once; and
// every decision in it must replay identically from its recorded replies with the code here. Nothing is edited: the
// files are copied as saved.
//   node scripts/publish-fix.mjs <dir with tab2.json, fresh1.json, fresh2.json (any of them)>
//   node scripts/publish-fix.mjs --check     check the published ones again, in place (CI does this on every push)
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { replay } from '../src/swarm.mjs';
import ASM from '../src/assembly.mjs';
import S from '../src/cells.mjs';

const CHECK = process.argv[2] === '--check', dir = CHECK ? null : process.argv[2];
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const seal2 = hash('SEAL2.json'), seal3 = hash('SEAL3.json');
const pub = rd('data/published.json'), settings2 = rd('data/settings2.json');
const fail = (why) => { console.error(`not published: ${why}`); process.exit(1); };
const ctx = S.prepare(rd('data/corpus.json'), rd('data/banking-index.json'), rd('data/departments.json'), rd('data/settings.json'));
const key = (r) => JSON.stringify([r.released, r.status ?? null, r.output ?? null, r.why]);
// name → [the build that must have made it, the split, the task list, where it is published]
export const RUNS = {
  tab2: ['v2', 'test', () => rd('data/suite.json').test, 'data/runs/tab2-test.json'],
  fresh1: ['v1', 'test2', () => rd('data/test2.json').test, 'data/runs/fresh1-test2.json'],
  fresh2: ['v2', 'test2', () => rd('data/test2.json').test, 'data/runs/fresh2-test2.json'],
};
for (const [name, [system, split, tasksOf, out]] of Object.entries(RUNS)) {
  const f = CHECK ? pub[name] : dir ? join(dir, `${name}.json`) : null;
  if (!f || !existsSync(f)) continue;
  const run = rd(f), list = tasksOf(), tasks = new Map(list.map((t) => [t.id, t])), recs = run.records && run.records.gated;
  if (run.system !== system || run.split !== split || run.complete !== true) fail(`${name} is not the complete ${split} set by the ${system} build`);
  if (run.sealSha256 !== seal2) fail(`${name} records seal 2 as ${String(run.sealSha256).slice(0, 12)}, this repository's is ${seal2.slice(0, 12)}`);
  if (run.seal3Sha256 !== seal3) fail(`${name} records seal 3 as ${String(run.seal3Sha256).slice(0, 12)}, this repository's is ${seal3.slice(0, 12)}`);
  if (!Array.isArray(recs) || recs.length !== list.length || !list.every((t) => recs.filter((r) => r.id === t.id).length === 1)) fail(`${name} does not answer every task exactly once`);
  let differ = 0;
  for (const rec of recs) {
    const again = rec.arm === 'assembled' ? await ASM.replay(tasks.get(rec.id), rec, ctx, settings2) : await replay(tasks.get(rec.id), rec, ctx);
    if (key(again) !== key(rec)) differ++;
  }
  if (system === 'v2' && !recs.every((r) => r.arm === 'assembled')) fail(`${name} holds a record the decomposed build did not make`);
  if (system === 'v1' && recs.some((r) => r.arm === 'assembled')) fail(`${name} holds a record the first build did not make`);
  if (differ) fail(`${name}: ${differ} decisions do not replay from their recorded replies`);
  if (!CHECK) { copyFileSync(f, out); pub[name] = out; }
  console.log(`${name}: ${run.model}, ${run.gpu}, ${run.seconds} s in ${run.segments} sitting(s), ${run.privacy.requests} network requests; ${recs.length} decisions replay identically`);
}
if (!CHECK) writeFileSync('data/published.json', JSON.stringify(pub, null, 1) + '\n');
