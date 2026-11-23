import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const rd = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('every sealed file still has the bytes seal 2 froze', () => {
  const seal = rd('SEAL2.json');
  assert.ok(Object.keys(seal.files).length >= 15);
  for (const [f, h] of Object.entries(seal.files)) assert.equal(sha(readFileSync(new URL(`../${f}`, import.meta.url))), h, `${f} changed after seal 2`);
});

test('every vendored file is recorded with the hash it has', () => {
  const p = rd('vendor/PROVENANCE.json');
  for (const v of p.files) {
    assert.equal(sha(readFileSync(new URL(`../${v.file}`, import.meta.url))), v.sha256, v.file);
    assert.match(v.commit, /^[0-9a-f]{40}$/, `${v.file} names the commit it came from`);
  }
});

test('every test-split run records this seal', () => {
  const seal = sha(readFileSync(new URL('../SEAL2.json', import.meta.url)));
  const dir = new URL('../data/runs/', import.meta.url);
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const r = rd(`data/runs/${f}`);
    if (r.split === 'test' || r.pool === 'sealed') assert.equal(r.sealSha256, seal, `${f} was not run under seal 2`);
  }
});

test('every file seal 3 froze still has its bytes, and seal 3 names the seal 2 that still holds', () => {
  const seal = rd('SEAL3.json');
  assert.ok(Object.keys(seal.files).length >= 9);
  for (const [f, h] of Object.entries(seal.files)) assert.equal(sha(readFileSync(new URL(`../${f}`, import.meta.url))), h, `${f} changed after seal 3`);
  assert.equal(seal.seal2, sha(readFileSync(new URL('../SEAL2.json', import.meta.url))));
  for (const f of ['src/atoms.mjs', 'src/assembly.mjs', 'src/read.mjs', 'src/claims2.mjs', 'CLAIMS-2.md', 'data/settings2.json', 'data/adoption.json', 'data/test2.json']) assert.ok(seal.files[f], `${f} is sealed`);
});

test('every run of the fix records seal 2 and seal 3, and is the build and the set it is published as', () => {
  const s2 = sha(readFileSync(new URL('../SEAL2.json', import.meta.url))), s3 = sha(readFileSync(new URL('../SEAL3.json', import.meta.url)));
  const pub = rd('data/published.json');
  for (const [name, system, split] of [['tab2', 'v2', 'test'], ['fresh1', 'v1', 'test2'], ['fresh2', 'v2', 'test2']]) {
    if (!pub[name]) continue;
    const r = rd(pub[name]);
    assert.deepEqual([r.system, r.split, r.complete, r.sealSha256, r.seal3Sha256], [system, split, true, s2, s3], name);
    assert.equal(r.records.gated.length, 410, name);
  }
});

test('the adoption table follows the rule, and the settings follow the table', async () => {
  const { adopted } = await import('../src/claims2.mjs');
  const ad = rd('data/adoption.json'), set = rd('data/settings2.json');
  assert.equal(ad.desks.length, 7);
  for (const d of ad.desks) assert.equal(set.desks[d.desk] === 'atoms', adopted(d.v1, d.v2), d.desk);
  assert.deepEqual(Object.keys(set.desks).sort(), ad.desks.map((d) => d.desk).sort());
});
