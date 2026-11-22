import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import CL from '../src/claims.mjs';

const rows = (spec) => spec.flatMap(([kind, n, f]) => Array.from({ length: n }, (_, i) => ({ id: `${kind}${i}`, kind, ...f(i) })));
const arm = (o) => ({ all: { silentRate: o.rate, silent: o.silent, tasks: o.tasks, medianMs: o.ms ?? 100 }, bounded: { accuracy: o.bacc, tasks: 330 }, hard: { accuracy: o.hacc, silent: o.hsil, tasks: 80 }, rows: o.rows, venue: o.venue ?? 'tab' });

test('every bar is the one CLAIMS.md registered', () => {
  const md = readFileSync(new URL('../CLAIMS.md', import.meta.url), 'utf8');
  for (const [id, bar] of Object.entries(CL.BARS)) assert.ok(md.includes(bar), `${id}: ${bar}`);
});

test('grounding counts released fact answers only', () => {
  const m = { rows: [{ kind: 'qa', released: true, grounded: true }, { kind: 'qa', released: true, grounded: false }, { kind: 'qa', released: false, grounded: null }, { kind: 'classify', released: true, grounded: null }, { kind: 'knowledge', released: true, grounded: false }, { kind: 'draft', released: true, grounded: true }, { kind: 'extract', released: true, grounded: null }] };
  assert.deepEqual(CL.grounding(m), { grounded: 2, of: 3 });
  assert.deepEqual(CL.grounding(null), { grounded: 0, of: 0 });
});

test('everything pending without evidence; never passed by default', () => {
  const r = CL.evaluate(null);
  assert.deepEqual(r.map((x) => x.id), ['H', 'B1', 'B2', 'G', 'P', 'L', '$', 'A1', 'A2', 'A2b', 'A3', 'A4', 'F', 'X']);
  assert.ok(r.every((x) => x.pass === null));
  assert.ok(r.filter((x) => x.id !== '$').every((x) => x.result.startsWith('pending')));
});

test('the verdicts at and around every bar', () => {
  const good = rows([['qa', 20, () => ({ released: true, grounded: true, silent: false })]]);
  const bad = rows([['qa', 20, () => ({ released: true, grounded: false, silent: true })]]);
  const sw = arm({ rate: 0.02, silent: 2, tasks: 100, bacc: 0.5, hacc: 0.1, hsil: 2, rows: good, ms: 5000 });
  const sr = arm({ rate: 0.4, silent: 20, tasks: 100, bacc: 0.6, hacc: 0.2, hsil: 9, rows: bad });
  const br = arm({ rate: 0.3, silent: 20, tasks: 100, bacc: 0.65, hacc: 0.3, hsil: 9, rows: bad });
  const ev = { swarm: sw, swarmRaw: sr, bigRaw: br, privacy: { requests: 0 }, attacks: { summary: { A1: { built: 40, gatedReleased: 0, gatedFalse: 0 }, A2: { built: 40, gatedFalse: 2, rawFalse: 5 }, A2b: { built: 40, gatedFalse: 3, rawFalse: 6 }, A3: { built: 40, gatedFalse: 2, rawFalse: 1 }, A4: { candidates: 100, released: 25, realVerified: 30, questions: 40 } } }, fold: { grouped: 0.8, interleaved: 1, identical: 19, pairs: 20 } };
  const v = Object.fromEntries(CL.evaluate(ev).map((x) => [x.id, x]));
  for (const id of ['H', 'B1', 'B2', 'G', 'P', 'L', 'A1', 'A2', 'A3', 'A4', 'F']) assert.equal(v[id].pass, true, `${id}: ${v[id].result}`);
  assert.equal(v.$.pass, null); assert.equal(v.A2b.pass, null); assert.equal(v.X.pass, null);
  assert.match(v.H.result, /swarm 2 of 100 \(2\.0%\); against the 1B raw: 20 tasks only the raw failed silently, 0 only the swarm, p = /);
  assert.match(v.B1.result, /swarm 50\.0% against the 7B raw's 65\.0% on the 330 bounded tasks \(bar 50\.0%\)/);
  assert.match(v.G.result, /swarm 20 of 20 .* \(100\.0%\); 1B raw 0 of 20, 7B raw 0 of 20/);
  assert.match(v.A1.result, /40 of 40 refused outright; the tampered answer was released 0 times/);
  assert.match(v.A4.result, /25 of 100 .* \(25\.0%\); real answers verified: 30 of 40/);
  assert.match(v.F.result, /0\.800 s grouped against 1\.000 s interleaved \(0\.80×\); identical replies 19 of 20/);
  assert.match(v.L.result, /median 5\.00 s/);
  const off = (patch) => Object.fromEntries(CL.evaluate({ ...ev, ...patch }).map((x) => [x.id, x.pass]));
  assert.equal(off({ swarm: { ...sw, all: { ...sw.all, silentRate: 0.0201 } } }).H, false);
  assert.equal(off({ swarm: { ...sw, all: { ...sw.all, silentRate: null } } }).H, false);
  assert.equal(off({ swarmRaw: { ...sr, rows: good } }).H, false, 'no task where only the raw failed: not shown');
  assert.equal(off({ bigRaw: { ...br, rows: rows([['qa', 3, () => ({ silent: true })]]) } }).H, false, 'three discordant pairs cannot reach p < 0.05');
  assert.equal(off({ bigRaw: { ...br, bounded: { accuracy: 0.6501 } } }).B1, false);
  assert.equal(off({ bigRaw: { ...br, bounded: { accuracy: null } } }).B1, false);
  assert.equal(off({ swarm: { ...sw, bounded: { accuracy: null, tasks: 1 } } }).B1, false);
  assert.equal(off({ bigRaw: { ...br, hard: { accuracy: 0.1 } } }).B2, false);
  assert.equal(off({ swarm: { ...sw, hard: { ...sw.hard, silent: 3 } } }).B2, false);
  assert.equal(off({ swarm: { ...sw, hard: { ...sw.hard, accuracy: null } } }).B2, false);
  assert.equal(off({ bigRaw: { ...br, hard: { accuracy: null } } }).B2, false);
  assert.equal(off({ swarm: { ...sw, hard: { ...sw.hard, silent: 'x' } } }).B2, false);
  const g19 = rows([['qa', 19, () => ({ released: true, grounded: true })], ['qa', 1, () => ({ released: true, grounded: false })]]);
  assert.equal(off({ swarm: { ...sw, rows: g19 } }).G, true, '19 of 20 is exactly 95%');
  const g18 = rows([['qa', 18, () => ({ released: true, grounded: true })], ['qa', 2, () => ({ released: true, grounded: false })]]);
  assert.equal(off({ swarm: { ...sw, rows: g18 } }).G, false);
  assert.equal(off({ swarm: { ...sw, rows: [] } }).G, false);
  assert.equal(off({ privacy: { requests: 1 } }).P, false);
  assert.equal(off({ privacy: { requests: 0.5 } }).P, null);
  assert.equal(off({ swarm: { ...sw, all: { ...sw.all, medianMs: 5001 } } }).L, false);
  assert.equal(off({ swarm: { ...sw, venue: 'node' } }).L, null);
  assert.equal(off({ swarm: { ...sw, all: { ...sw.all, medianMs: null } } }).L, null);
  const at = (k, x) => off({ attacks: { summary: { ...ev.attacks.summary, [k]: { ...ev.attacks.summary[k], ...x } } } })[k];
  assert.equal(at('A1', { gatedReleased: 1 }), false);
  assert.equal(at('A1', { built: 0 }), false);
  assert.equal(at('A2', { gatedFalse: 3 }), false);
  assert.equal(at('A2', { built: 0, gatedFalse: 0 }), false);
  assert.equal(at('A3', { gatedFalse: 3 }), false);
  assert.equal(at('A3', { built: 0, gatedFalse: 0 }), false);
  assert.equal(at('A4', { released: 26 }), false);
  assert.equal(at('A4', { candidates: 0, released: 0 }), false);
  assert.equal(off({ attacks: null }).A1, null);
  assert.equal(off({ fold: { ...ev.fold, grouped: 0.81 } }).F, false);
  assert.equal(off({ fold: { ...ev.fold, identical: 18 } }).F, false);
  assert.equal(off({ fold: { ...ev.fold, pairs: 0 } }).F, null);
  assert.equal(off({ fold: { ...ev.fold, grouped: 'x' } }).F, null);
  assert.equal(off({ fold: { ...ev.fold, interleaved: null } }).F, null);
  assert.equal(off({ fold: { ...ev.fold, pairs: 2.5 } }).F, null);
  const only = (o) => Object.fromEntries(CL.evaluate(o).map((x) => [x.id, x.pass === null && /^pending/.test(x.result)]));
  assert.deepEqual([only({ swarm: sw, bigRaw: br }).H, only({ swarm: sw, bigRaw: br }).B1], [true, false]);
  assert.equal(only({ swarm: sw, swarmRaw: sr }).H, true);
  assert.equal(only({ swarmRaw: sr, bigRaw: br }).H, true);
  assert.deepEqual([only({ bigRaw: br }).B1, only({ bigRaw: br }).B2, only({ swarm: sw }).B1, only({ swarm: sw }).B2, only({ bigRaw: br }).G], [true, true, true, true, true]);
  assert.equal(off({ swarm: { ...sw, all: { ...sw.all, medianMs: Infinity } } }).L, null);
  assert.match(CL.evaluate({ ...ev, swarm: { ...sw, rows: [] } }).find((x) => x.id === 'G').result, /swarm 0 of 0 .* \(—\)/);
  assert.equal(off({ swarmRaw: { ...sr, rows: [] }, bigRaw: { ...br, rows: [] } }).H, false);
  const dash = CL.evaluate({ ...ev, attacks: { summary: { ...ev.attacks.summary, A2: { built: 0, gatedFalse: 0, rawFalse: 0 } } } }).find((x) => x.id === 'A2');
  assert.match(dash.result, /\(—\)/);
});
