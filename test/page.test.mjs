import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build, page, KERNELS, BAKED, rewrite, body } from '../scripts/make-page.mjs';

const root = new URL('..', import.meta.url);
const ROOT = fileURLToPath(root).replace(/[\\/]$/, '');
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const LF = (s) => s.split('\r\n').join('\n');
const html = LF(read('index.html'));
const visible = html.slice(html.indexOf('<body>'), html.indexOf('<script type="module">'));

test('index.html is exactly the build of page/ and the kernels, baked from the published runs', async () => {
  assert.equal(html, await page(ROOT));
});

test('every kernel is inlined byte for byte, its imports read from the scopes above it', () => {
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
  const built = build(ROOT);
  const kernels = built.slice(built.indexOf('<script type="module">') + 22, built.indexOf('// page/app.js'));
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

test('nothing ships as a bare placeholder: every fill target is baked, and an unmeasured value says so', () => {
  assert.ok(!/>\s*…\s*</.test(visible), 'an element whose whole content is an ellipsis is on the page');
  for (const id of BAKED) {
    const m = visible.match(new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id}"[^>]*>`));
    assert.ok(m, `#${id} is on the page`);
  }
  const tpl = read('page/template.html');
  const bound = [...tpl.matchAll(/data-bind="([^"]+)"/g)].map((m) => m[1]);
  for (const k of bound) {
    const inTpl = tpl.match(new RegExp(`data-bind="${k.replace(/[.$]/g, '\\$&')}"[^>]*>([^<]*)<`))[1];
    const m = visible.match(new RegExp(`data-bind="${k.replace(/[.$]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</(?:span|b|p|td)>`));
    assert.ok(m, `data-bind="${k}" is on the built page`);
    if (m[1] === inTpl) assert.match(m[1], /not measured yet|not filled in yet/, `data-bind="${k}" was not baked and does not say it is unmeasured`);
  }
  // the published 7B run is baked into the static page, so a reader with scripts off sees a measured number
  assert.match(visible, /a 7× larger model with no checks <b data-bind="hl\.raw7">14\.4% <span class="muted">\(59 of 410\)<\/span><\/b>/);
});

test('every id and binding the page script uses is on the page, and every binding is filled by the script', () => {
  const tpl = read('page/template.html'), app = read('page/app.js');
  const ids = new Set([...tpl.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of app.matchAll(/\$\('([^']+)'\)/g)) if (m[1] !== 'liveTokens') assert.ok(ids.has(m[1]), `#${m[1]} is used by the script but not on the page`);
  const bound = new Set([...tpl.matchAll(/data-bind="([^"]+)"/g)].map((m) => m[1]));
  const set = new Set([...app.matchAll(/bind\('([^']+)'/g)].map((m) => m[1]));
  for (const k of bound) assert.ok(set.has(k), `data-bind="${k}" is never filled`);
  for (const k of set) assert.ok(bound.has(k), `the script fills "${k}", which is not on the page`);
  // a fill target holds plain text only, so the bake can write into it
  for (const k of [...BAKED.map((id) => `id="${id}"`), ...[...bound].map((b) => `data-bind="${b}"`)]) {
    assert.match(tpl, new RegExp(`<([a-z0-9]+)\\b[^>]*\\s${k.replace(/[.$]/g, '\\$&')}[^>]*>[^<]*</\\1>`), `${k} must hold plain text in the template`);
  }
});

test('the page says what it is and how to use it, with no private symbols and no price list', () => {
  const tpl = read('page/template.html');
  for (const h of ['id="start"', 'id="results"', 'id="claims"', 'id="how"', 'id="attacks"', 'id="blueprint"', 'id="adopt"', 'id="brochure"', 'id="paper"']) assert.ok(tpl.includes(h), h);
  assert.ok(!/[◊κφ]/.test(tpl + read('page/app.js')), 'no private symbols on the public page');
  assert.ok(/supplied by <a href="https:\/\/www\.ai-nativesolutions\.com">AI Native Solutions<\/a>/.test(tpl));
  assert.ok(existsSync(new URL('data/published.json', root)));
});

test('no private repository name is in anything this repository ships (checked by hash: the names are not listed here)', () => {
  const banned = new Set(JSON.parse(read('data/private-names.sha256.json')).sha256);
  assert.ok(banned.size >= 50);
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const files = ['index.html', 'README.md', 'CLAIMS.md', 'SEAL2.md', 'CLAIMS-2.md', 'SEAL3.md', 'CLAIMS-3.md', 'data/adoption.json', 'data/settings2.json', 'NOTICE', 'seed.json', 'sw.js', 'manifest.webmanifest', 'data/published.json', 'data/settings.json', 'data/prices.json'];
  for (const dir of ['src', 'scripts', 'test', 'page', 'genome', 'vendor', '.github/workflows']) for (const f of readdirSync(new URL(`${dir}/`, root))) files.push(`${dir}/${f}`);
  const seen = new Set();
  for (const f of files) {
    for (const tok of read(f).toLowerCase().match(/[a-z0-9_]+(?:-[a-z0-9_]*)*/g) || []) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      const parts = tok.split('-');
      for (let i = 0; i < parts.length; i++) for (let k = i + 1; k <= parts.length; k++) {
        const run = parts.slice(i, k).join('-');
        if (run.length >= 5) assert.ok(!banned.has(sha(run)), `${f} carries a private repository name (a ${run.length}-letter run in "${tok.slice(0, 4)}…")`);
      }
    }
  }
});

test('no two elements of the page share an id', () => {
  const html = read('page/template.html'), seen = new Map();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([id]) => id), []);
  assert.ok(seen.size > 40);
});
