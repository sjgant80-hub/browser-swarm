import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, KERNELS, rewrite, body } from '../scripts/make-page.mjs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const LF = (s) => s.split('\r\n').join('\n');

test('index.html is exactly the build of page/ and the kernels', () => {
  assert.equal(LF(read('index.html')), build(fileURLToPath(root).replace(/[\\/]$/, '')));
});

test('every kernel is inlined byte for byte, its imports read from the scopes above it', () => {
  const html = LF(read('index.html'));
  for (const [ns, file] of KERNELS) {
    const { code } = body(read(file), file);
    assert.ok(html.includes(`const ${ns} = (() => {\n${code}\n`), `${file} is not inlined as built`);
    for (const line of LF(read(file)).split('\n')) {
      if (line.startsWith('import ')) assert.ok(rewrite(line, file), `${file}: an import the page cannot inline: ${line}`);
      else if (!line.startsWith('export default ')) assert.ok(code.includes(line.replace(/^export /, '')), `${file}: a line changed: ${line}`);
    }
  }
  assert.equal(rewrite("import { a, b as c } from '../vendor/docdec-gate.mjs';", 'src/x.mjs'), 'const { a, b: c } = GATE;');
  assert.equal(rewrite("import C from './checks.mjs';", 'src/x.mjs'), 'const C = CHECKS;');
  assert.equal(rewrite('const x = 1;', 'src/x.mjs'), null);
  assert.throws(() => rewrite("import X from './nowhere.mjs';", 'src/x.mjs'), /cannot inline/);
});

test('the page code runs: the inlined kernels decide as the modules do', async () => {
  const html = LF(read('index.html'));
  const kernels = html.slice(html.indexOf('<script type="module">') + 22, html.indexOf('// page/app.js'));
  const mod = await import('data:text/javascript;base64,' + Buffer.from(kernels + '\nexport { CELLS, SWARM, SCORE, CLAIMS, SHA, COST };').toString('base64'));
  const S = (await import('../src/cells.mjs')).default, SW = await import('../src/swarm.mjs');
  const j = (p) => JSON.parse(read(p));
  const a = mod.CELLS.prepare(j('data/corpus.json'), j('data/banking-index.json'), j('data/departments.json'), j('data/settings.json'));
  const b = S.prepare(j('data/corpus.json'), j('data/banking-index.json'), j('data/departments.json'), j('data/settings.json'));
  const run = j('data/runs/node-llama3.2_1b-dev.json'), dev = new Map(j('data/suite.json').dev.map((t) => [t.id, t]));
  for (const rec of [...run.records.gated, ...run.records.raw]) {
    const x = await mod.SWARM.replay(dev.get(rec.id), rec, a), y = await SW.replay(dev.get(rec.id), rec, b);
    assert.deepEqual(x, y, rec.id);
  }
  assert.equal(mod.SHA.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('every id and binding the page script uses is on the page, and every binding is filled by the script', () => {
  const tpl = read('page/template.html'), app = read('page/app.js');
  const ids = new Set([...tpl.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(m[1]), `#${m[1]} is used by the script but not on the page`);
  const bound = new Set([...tpl.matchAll(/data-bind="([^"]+)"/g)].map((m) => m[1]));
  const set = new Set([...app.matchAll(/bind\('([^']+)'/g)].map((m) => m[1]));
  for (const k of bound) assert.ok(set.has(k), `data-bind="${k}" is never filled`);
  for (const k of set) assert.ok(bound.has(k), `the script fills "${k}", which is not on the page`);
});

test('the page says what it is and how to use it, with no private name and no price', () => {
  const tpl = read('page/template.html');
  for (const h of ['id="start"', 'id="results"', 'id="claims"', 'id="how"', 'id="attacks"', 'id="blueprint"', 'id="adopt"', 'id="brochure"', 'id="paper"']) assert.ok(tpl.includes(h), h);
  assert.ok(!/[◊κφ]/.test(tpl + read('page/app.js')), 'no private symbols on the public page');
  assert.ok(!/estate-metabolism|kar-swarm|si-didy|\.si-didy/.test(tpl + read('page/app.js')), 'no private repository names');
  assert.ok(/supplied by <a href="https:\/\/www\.ai-nativesolutions\.com">AI Native Solutions<\/a>/.test(tpl));
  assert.ok(existsSync(new URL('data/published.json', root)));
});
