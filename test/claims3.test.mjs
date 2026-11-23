import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import C3 from '../src/claims3.mjs';

const m = (silent, acc, tasks = 410) => ({ all: { silent, tasks }, bounded: { accuracy: acc, tasks: 330, correct: Math.round(acc * 330) } });

test('every bar is the one CLAIMS-3.md registered', () => {
  const md = readFileSync(new URL('../CLAIMS-3.md', import.meta.url), 'utf8');
  for (const [id, bar] of Object.entries(C3.BARS)) assert.ok(md.includes(bar), `${id}: ${bar}`);
  assert.deepEqual(Object.keys(C3.BARS), ['E1', 'E2']);
});

test('sourceOf: the first build\'s calls for a banking message, the decomposed build\'s for everything else', () => {
  assert.equal(C3.sourceOf({ kind: 'classify' }), 'first');
  for (const kind of ['qa', 'extract', 'route', 'date', 'pence', 'draft', 'knowledge', 'reasoning']) assert.equal(C3.sourceOf({ kind }), 'decomposed', kind);
  assert.equal(C3.sourceOf(null), 'decomposed'); assert.equal(C3.sourceOf({}), 'decomposed');
});

test('evaluate: the verdicts at and around both bars, and pending without the evidence', () => {
  const at = C3.evaluate(m(5, 0.472));
  assert.deepEqual(at, [{ id: 'E1', pass: true, result: '5 silent failures of 410 (1.2%)' }, { id: 'E2', pass: true, result: '47.2% of the 330 bounded tasks right (156)' }]);
  assert.deepEqual(C3.evaluate(m(6, 0.4719)).map((v) => v.pass), [false, false]);
  assert.deepEqual(C3.evaluate(m(0, 0.6)).map((v) => v.pass), [true, true]);
  assert.deepEqual(C3.evaluate(m(6, 0.6)).map((v) => v.pass), [false, true]); assert.deepEqual(C3.evaluate(m(0, 0.2)).map((v) => v.pass), [true, false]);
  assert.equal(C3.evaluate(m(2, 0.5, 200))[0].result, '2 silent failures of 200 (1.0%)');
  for (const bad of [null, undefined, {}, m('5', 0.5), m(5.5, 0.5), m(5, null), m(5, NaN), { all: { silent: 1 } }, { bounded: { accuracy: 0.5 } }]) {
    const v = C3.evaluate(bad);
    assert.deepEqual(v.map((x) => [x.id, x.pass]), [['E1', null], ['E2', null]]); assert.ok(v.every((x) => x.result.startsWith('pending')));
  }
});

test('holds: every claim passed, one failed, or still pending', () => {
  assert.equal(C3.holds(C3.evaluate(m(5, 0.472))), true); assert.equal(C3.holds(C3.evaluate(m(6, 0.6))), false); assert.equal(C3.holds(C3.evaluate(m(0, 0.2))), false);
  assert.equal(C3.holds(C3.evaluate(null)), null); assert.equal(C3.holds([]), null); assert.equal(C3.holds(null), null);
  assert.equal(C3.holds([{ pass: true }, { pass: null }]), null); assert.equal(C3.holds([{ pass: false }, { pass: null }]), null, 'pending until every claim has its evidence');
  assert.equal(C3.holds([{ pass: true }, { pass: 'yes' }]), false); assert.equal(C3.holds([{ pass: true }]), true);
});
