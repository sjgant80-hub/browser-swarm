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
