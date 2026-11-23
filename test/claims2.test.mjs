import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import C2 from '../src/claims2.mjs';

const rows = (spec) => spec.flatMap(([kind, n, correct]) => Array.from({ length: n }, (_, i) => ({ id: `${kind}${i}`, kind, correct: typeof correct === 'function' ? correct(i) : correct })));
const arm = (o) => ({ all: { silent: o.silent, tasks: 410, silentRate: o.silent / 410, medianMs: o.ms ?? 3000 }, bounded: { accuracy: o.acc, tasks: 330, correct: Math.round(o.acc * 330) }, rows: o.rows || [], venue: o.venue ?? 'tab' });

test('every bar is the one CLAIMS-2.md registered', () => {
  const f = new URL('../CLAIMS-2.md', import.meta.url);
  const md = readFileSync(f, 'utf8');
  for (const [id, bar] of Object.entries(C2.BARS)) assert.ok(md.includes(bar), `${id}: ${bar}`);
});

test('adopted: no more silent failures, and a higher score (right minus twice silent), or the desk stays as it was', () => {
  const c = (right, silent) => ({ right, silent });
  assert.equal(C2.score(c(117, 9)), 99); assert.equal(C2.score(c(7, 0)), 7); assert.equal(C2.score(null), null); assert.equal(C2.score(c('7', 0)), null); assert.equal(C2.score(c(7, 0.5)), null); assert.equal(C2.score({}), null);
  assert.equal(C2.adopted(c(16, 0), c(32, 0)), true); assert.equal(C2.adopted(c(8, 1), c(22, 0)), true); assert.equal(C2.adopted(c(8, 1), c(22, 1)), true);
  assert.equal(C2.adopted(c(117, 9), c(116, 1)), true, 'fewer right, far fewer silent failures: adopted');
  assert.equal(C2.adopted(c(12, 4), c(7, 1)), true, 'score 5 against 4');
  assert.equal(C2.adopted(c(12, 4), c(6, 1)), false, 'a tie on the score stays as it was');
  assert.equal(C2.adopted(c(29, 0), c(25, 0)), false, 'fewer right, the same silent failures');
  assert.equal(C2.adopted(c(29, 2), c(40, 3)), false, 'one more silent failure is never adopted, whatever the score');
  assert.equal(C2.adopted(c(29, 2), c(34, 6)), false);
  for (const bad of [[null, c(1, 0)], [c(0, 0), null], [c('0', 0), c(1, 0)], [c(0, 0), c(1.5, 0)], [c(0, '0'), c(1, 0)], [c(0, 0), c(1, null)], [{}, c(1, 0)]]) { assert.equal(C2.adopted(bad[0], bad[1]), false); assert.equal(C2.firstRule(bad[0], bad[1]), false); }
  // the rule this work started with, kept to show what it would have chosen
  assert.equal(C2.firstRule(c(117, 9), c(119, 8)), true); assert.equal(C2.firstRule(c(16, 0), c(32, 0)), true, 'the same number of silent failures is no more'); assert.equal(C2.firstRule(c(117, 9), c(116, 1)), false, 'it rejects a safer plan that answers less');
  assert.equal(C2.firstRule(c(12, 4), c(7, 1)), false); assert.equal(C2.firstRule(c(8, 0), c(22, 1)), false); assert.equal(C2.firstRule(c(8, 1), c(8, 1)), false);
  assert.match(C2.RULE, /no more silent failures than the one-call form and a higher score/); assert.match(C2.FIRST_RULE, /more right answers and no more silent failures/);
});

test('pairedRight and rightOf: per-task correctness, on the named kinds only', () => {
  const a = { rows: rows([['qa', 10, (i) => i < 4], ['date', 5, true]]) }, b = { rows: rows([['qa', 10, (i) => i < 9], ['date', 5, false], ['zz', 3, true]]) };
  assert.deepEqual(C2.pairedRight(a, b, ['qa']), { aOnly: 0, bOnly: 5, p: 0.0625 });
  assert.deepEqual(C2.pairedRight(a, b, ['date']), { aOnly: 5, bOnly: 0, p: 0.0625 });
  const both = C2.pairedRight(a, b, ['qa', 'date']);
  assert.deepEqual([both.aOnly, both.bOnly, both.p], [5, 5, 1]);
  assert.deepEqual(C2.pairedRight(null, null, ['qa']), { aOnly: 0, bOnly: 0, p: 1 });
  assert.deepEqual(C2.pairedRight(a, { rows: [{ id: 'new', kind: 'qa', correct: true }] }, ['qa']), { aOnly: 0, bOnly: 0, p: 1 }, 'a task only one build ran is not a pair');
  assert.deepEqual(C2.rightOf(b, ['qa']), { right: 9, of: 10 }); assert.deepEqual(C2.rightOf(b, ['qa', 'date']), { right: 9, of: 15 }); assert.deepEqual(C2.rightOf(null, ['qa']), { right: 0, of: 0 });
  assert.deepEqual(C2.rightOf({ rows: [{ kind: 'qa', correct: 'yes' }] }, ['qa']), { right: 0, of: 1 });
  assert.deepEqual(C2.REAL, ['qa', 'extract', 'classify', 'route']); assert.equal(C2.BOUNDED.length, 7); assert.equal(C2.HALFWAY, 0.472);
});

test('everything pending without evidence', () => {
  const r = C2.evaluate(null);
  assert.deepEqual(r.map((x) => x.id), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
  assert.ok(r.every((x) => x.pass === null && x.result.startsWith('pending')));
});

test('the verdicts at and around every bar', () => {
  const win = rows([['qa', 20, true], ['date', 5, true]]), lose = rows([['qa', 20, false], ['date', 5, true]]);
  const v1 = arm({ silent: 5, acc: 0.339, rows: lose }), v2 = arm({ silent: 5, acc: 0.472, rows: win, ms: 5000 });
  const ev = { v1, v2, traps: { hard: 0, unanswerable: 2 }, v1fresh: arm({ silent: 4, acc: 0.3, rows: lose }), v2fresh: arm({ silent: 5, acc: 0.5, rows: win }) };
  const v = Object.fromEntries(C2.evaluate(ev).map((x) => [x.id, x]));
  for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) assert.equal(v[id].pass, true, `${id}: ${v[id].result}`);
  assert.match(v.D1.result, /^5 silent failures of 410 \(1\.2%\); the first build: 5$/);
  assert.match(v.D2.result, /^47\.2% of the 330 bounded tasks right \(156\); the first build: 33\.9% \(112\)$/);
  assert.match(v.D3.result, /^0 answers released on the 80 hard tasks; 2 on the 30/);
  assert.match(v.D4.result, /^median 5\.00 s per task; the first build: 3\.00 s$/);
  assert.match(v.D5.result, /^5 silent failures of 410 \(1\.2%\); the first build on the same tasks: 4$/);
  assert.match(v.D6.result, /^decomposed 25 of 25 bounded tasks right, first build 5; 20 tasks only the decomposed build got right, 0 only the first build, p = /);
  assert.match(v.D7.result, /^decomposed 20 of 20 real-data tasks right, first build 0; 20 tasks only/);
  const off = (patch) => Object.fromEntries(C2.evaluate({ ...ev, ...patch }).map((x) => [x.id, x.pass]));
  assert.equal(off({ v2: arm({ silent: 6, acc: 0.472, rows: win }) }).D1, false);
  assert.equal(off({ v2: { ...v2, all: { ...v2.all, silent: 'x' } } }).D1, false);
  assert.equal(off({ v2: arm({ silent: 5, acc: 0.4719, rows: win }) }).D2, false);
  assert.equal(off({ v2: { ...v2, bounded: { accuracy: null, tasks: 330, correct: 0 } } }).D2, false);
  assert.equal(off({ traps: { hard: 1, unanswerable: 0 } }).D3, false);
  assert.equal(off({ traps: { hard: 0, unanswerable: 3 } }).D3, false);
  assert.equal(off({ traps: { hard: 0 } }).D3, null); assert.equal(off({ traps: { unanswerable: 0 } }).D3, null); assert.equal(off({ traps: null }).D3, null);
  assert.equal(off({ v2: arm({ silent: 5, acc: 0.472, rows: win, ms: 5001 }) }).D4, false);
  assert.equal(off({ v2: arm({ silent: 5, acc: 0.472, rows: win, venue: 'node' }) }).D4, null);
  assert.equal(off({ v2: { ...v2, all: { ...v2.all, medianMs: null } } }).D4, null);
  assert.equal(off({ v2fresh: arm({ silent: 6, acc: 0.5, rows: win }) }).D5, false);
  assert.equal(off({ v2fresh: { ...ev.v2fresh, all: { ...ev.v2fresh.all, silent: 1.5 } } }).D5, false);
  assert.equal(off({ v2fresh: arm({ silent: 5, acc: 0.3, rows: lose }) }).D6, false, 'no task only the decomposed build got right');
  assert.equal(off({ v1fresh: arm({ silent: 4, acc: 0.5, rows: win }), v2fresh: arm({ silent: 5, acc: 0.3, rows: lose }) }).D6, false, 'the first build better is not a pass');
  const few = rows([['qa', 5, true], ['qa2', 0, true]]).map((r, i) => ({ ...r, id: `qa${i}` })), none = few.map((r) => ({ ...r, correct: false }));
  assert.equal(off({ v1fresh: arm({ silent: 0, acc: 0.3, rows: none }), v2fresh: arm({ silent: 0, acc: 0.5, rows: few }) }).D6, false, 'five discordant pairs cannot reach p < 0.05');
  assert.equal(off({ v1fresh: null }).D6, null); assert.equal(off({ v2fresh: null }).D7, null); assert.equal(off({ v2fresh: null }).D5, null);
  const noV1 = Object.fromEntries(C2.evaluate({ v2, traps: ev.traps }).map((x) => [x.id, x]));
  assert.equal(noV1.D1.result, '5 silent failures of 410 (1.2%)'); assert.equal(noV1.D2.result, '47.2% of the 330 bounded tasks right (156)'); assert.equal(noV1.D4.result, 'median 5.00 s per task');
  const slowV1 = Object.fromEntries(C2.evaluate({ ...ev, v1: { ...v1, all: { ...v1.all, medianMs: null } } }).map((x) => [x.id, x]));
  assert.equal(slowV1.D4.result, 'median 5.00 s per task');
  const noF1 = C2.evaluate({ v2fresh: ev.v2fresh }).find((x) => x.id === 'D5');
  assert.equal(noF1.result, '5 silent failures of 410 (1.2%)');
});
