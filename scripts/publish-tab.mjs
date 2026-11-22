// publish-tab.mjs — take the runs a browser tab made (saved from the page) and publish them, after checking each one:
// the suite run must be the complete sealed test split under this repository's seal, and every decision in it must
// replay identically from its recorded replies with the code here. Nothing is edited: the files are copied as saved.
//   node scripts/publish-tab.mjs <dir with tab.json [attacks.json] [fold.json]>
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { replay } from '../src/swarm.mjs';
import S from '../src/cells.mjs';

const dir = process.argv[2];
const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const seal = createHash('sha256').update(readFileSync('SEAL2.json')).digest('hex');
const pub = rd('data/published.json');
const fail = (why) => { console.error(`not published: ${why}`); process.exit(1); };

const tabFile = join(dir, 'tab.json');
if (existsSync(tabFile)) {
  const run = rd(tabFile), test = rd('data/suite.json').test, tasks = new Map(test.map((t) => [t.id, t]));
  if (run.split !== 'test' || run.complete !== true) fail('the tab run is not the complete test split');
  if (run.sealSha256 !== seal) fail(`the tab run records seal ${String(run.sealSha256).slice(0, 12)}, this repository's is ${seal.slice(0, 12)}`);
  for (const arm of ['gated', 'raw']) if (run.records[arm].length !== test.length || !test.every((t) => run.records[arm].some((r) => r.id === t.id))) fail(`the ${arm} arm does not cover every test task once`);
  const ctx = S.prepare(rd('data/corpus.json'), rd('data/banking-index.json'), rd('data/departments.json'), rd('data/settings.json'));
  const key = (r) => JSON.stringify([r.released, r.status ?? null, r.output ?? null, r.why]);
  let differ = 0;
  for (const arm of ['gated', 'raw']) for (const rec of run.records[arm]) if (key(await replay(tasks.get(rec.id), rec, ctx)) !== key(rec)) differ++;
  if (differ) fail(`${differ} decisions do not replay from their recorded replies`);
  copyFileSync(tabFile, 'data/runs/tab-test.json');
  pub.tab = 'data/runs/tab-test.json';
  console.log(`tab run: ${run.model}, ${run.gpu}, ${run.seconds} s, ${run.privacy.requests} network requests; 820 decisions replay identically`);
}
for (const [name, key, out] of [['attacks.json', 'attacksTab', 'data/runs/attacks-tab.json'], ['fold.json', 'fold', 'data/runs/fold-tab.json']]) {
  const f = join(dir, name);
  if (!existsSync(f)) continue;
  const run = rd(f);
  if (name === 'attacks.json' && (run.pool !== 'sealed' || run.sealSha256 !== seal)) fail('the attack run is not the sealed pool under this seal');
  copyFileSync(f, out);
  pub[key] = out;
  console.log(`${name}: ${JSON.stringify(run.summary).slice(0, 300)}`);
}
writeFileSync('data/published.json', JSON.stringify(pub, null, 1) + '\n');
