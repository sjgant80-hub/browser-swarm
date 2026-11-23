import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import D from '../src/diagnose.mjs';

const date = { id: 'd', kind: 'date', input: { text: '3 March 2025' }, gold: { iso: '2025-03-03' } };
const off = { id: 'q', kind: 'qa', gold: { impossible: true } };
const oos = { id: 'r', kind: 'route', gold: { domain: null } };
const hard = { id: 'k', kind: 'knowledge', gold: { letter: 'A' } };
const good = { iso: '2025-03-03' }, bad = { iso: '2025-03-04' };

test('cause: one cause for every way a task can end', () => {
  assert.deepEqual(D.cause(date, { released: true, output: good }, null), { cause: 'answered right', detail: '' });
  assert.equal(D.cause(date, { released: true, output: bad }, null).cause, 'answered wrong');
  assert.equal(D.cause(hard, { released: false, stage: 'lane' }, { released: true, output: { letter: 'A' } }).cause, 'trap');
  assert.equal(D.cause(hard, { released: true, output: { letter: 'A' } }, null).cause, 'answered right');
  assert.equal(D.cause(off, { released: false, stage: 'lane' }, null).cause, 'correct refusal');
  assert.equal(D.cause(oos, { released: false, stage: 'act' }, null).cause, 'correct refusal');
  assert.equal(D.cause(off, { released: true, output: { answer: 'x' } }, null).cause, 'answered wrong');
  assert.deepEqual(D.cause(date, { released: false, stage: 'judge', withheld: good, why: 'its judge said unverified, so the output is withheld: the day 3 is not in the text' }, null), { cause: 'gate too strict', detail: 'a right answer withheld: the day 3 is not in the text' });
  assert.deepEqual(D.cause(date, { released: false, stage: 'judge', withheld: bad }, null), { cause: 'too weak', detail: 'a wrong answer, rightly withheld' });
  assert.equal(D.cause(date, { released: false, stage: 'judge' }, { released: true, output: good }).cause, 'too weak', 'a judge-stage refusal is judged on what was withheld, not on the raw arm');
  assert.deepEqual(D.cause(date, { released: false, stage: 'act' }, { released: true, output: good }), { cause: 'too weak', detail: 'the model declined, or wrote nothing usable' });
  assert.deepEqual(D.cause(date, { released: false, stage: 'lane' }, { released: true, output: good }), { cause: 'gate too strict', detail: 'the lane refused a job the model alone got right' });
  assert.deepEqual(D.cause(date, { released: false, stage: 'lane' }, { released: true, output: bad }), { cause: 'too weak', detail: 'the lane refused, and the model alone was wrong too' });
  assert.equal(D.cause(date, { released: false, stage: 'lane' }, { released: false, output: good }).cause, 'too weak');
  assert.deepEqual(D.cause(date, { released: false, stage: 'conductor' }, { released: true, output: good }), { cause: 'gate too strict', detail: 'no desk took a job the model alone got right' });
  assert.deepEqual(D.cause(date, { released: false, stage: 'conductor' }, null), { cause: 'too weak', detail: 'no desk took it, and the model alone was wrong too' });
  assert.equal(D.cause(date, null, null).cause, 'too weak');
  assert.deepEqual(D.cause(date, { released: false, stage: 'atom', atoms: [{ ok: true }, { ok: false }] }, { released: true, output: good }), { cause: 'too weak', detail: 'a small step the model was asked did not pass its check' });
  assert.deepEqual(D.cause(date, { released: false, stage: 'atom', atoms: [{ ok: true }] }, { released: true, output: good }), { cause: 'gate too strict', detail: 'the plan found no part to ask about, on a job the model alone got right' });
  assert.deepEqual(D.cause(date, { released: false, stage: 'atom', atoms: 'x' }, { released: true, output: bad }), { cause: 'too weak', detail: 'the plan found no part to ask about, and the model alone was wrong too' });
  assert.equal(D.cause(date, { released: false, stage: 'atom' }, null).cause, 'too weak');
  assert.equal(D.cause(date, { released: false, stage: 'atom', atoms: [{ ok: 0 }] }, { released: true, output: good }).cause, 'gate too strict', 'only a step that failed counts as the model being too weak');
  assert.equal(D.cause(date, { released: 'yes', output: good }, null).cause, 'too weak');
});

test('summary: the three buckets, the largest, and usefulness over answerable tasks', () => {
  const tasks = [date, { ...date, id: 'd2' }, { ...date, id: 'd3' }, { ...date, id: 'd4' }, off, hard];
  const gated = [{ id: 'd', released: true, output: good }, { id: 'd2', released: false, stage: 'act' }, { id: 'd3', released: false, stage: 'judge', withheld: good, why: 'x: y' }, { id: 'd4', released: true, output: bad }, { id: 'q', released: false, stage: 'lane' }, { id: 'k', released: false, stage: 'lane' }];
  const s = D.summary(tasks, gated, []);
  assert.deepEqual(s.by, { 'answered right': 1, 'answered wrong': 1, 'correct refusal': 1, trap: 1, 'too weak': 1, 'gate too strict': 1 });
  assert.deepEqual([s.a, s.b, s.c, s.notAnswered], [2, 1, 1, 4]);
  assert.equal(s.largest, 'a');
  assert.deepEqual([s.answerable, s.answerableRight, s.answerableRate], [4, 1, 0.25]);
  assert.deepEqual(s.byKind.date, { 'answered right': 1, 'answered wrong': 1, 'correct refusal': 0, trap: 0, 'too weak': 1, 'gate too strict': 1 });
  assert.deepEqual(s.details, { 'too weak: the model declined, or wrote nothing usable': 1, 'gate too strict: a right answer withheld: y': 1 });
  const weak = D.summary([date, { ...date, id: 'd2' }, off], [{ id: 'd', released: false, stage: 'act' }, { id: 'd2', released: false, stage: 'act' }, { id: 'q', released: false }], null);
  assert.deepEqual([weak.a, weak.b, weak.c, weak.largest], [1, 2, 0, 'b']);
  const tie = D.summary([date, off], [{ id: 'd', released: false, stage: 'act' }, { id: 'q', released: false }], null);
  assert.equal(tie.largest, 'b', 'a tie between a and b goes to b: the one a fix can move');
  const strict = D.summary([date, { ...date, id: 'd2' }, off], [{ id: 'd', released: false, stage: 'judge', withheld: good }, { id: 'd2', released: false, stage: 'judge', withheld: good }, { id: 'q', released: false }], null);
  assert.deepEqual([strict.c, strict.largest], [2, 'c']);
  const ca = D.summary([date, off], [{ id: 'd', released: false, stage: 'judge', withheld: good }, { id: 'q', released: false }], null);
  assert.equal(ca.largest, 'c', 'a tie between a and c goes to c');
  const cb = D.summary([date, { ...date, id: 'd2' }], [{ id: 'd', released: false, stage: 'judge', withheld: good }, { id: 'd2', released: false, stage: 'act' }], null);
  assert.equal(cb.largest, 'b', 'a tie between b and c goes to b');
  const none = D.summary(null, null, null);
  assert.deepEqual([none.notAnswered, none.answerable, none.answerableRate, none.largest], [0, 0, null, 'b']);
  assert.deepEqual(D.CAUSES, ['answered right', 'answered wrong', 'correct refusal', 'trap', 'too weak', 'gate too strict']);
});

test('on the published sealed run: the split the page shows', () => {
  const rd = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
  const run = rd('data/runs/tab-test.json'), s = D.summary(rd('data/suite.json').test, run.records.gated, run.records.raw);
  assert.deepEqual([s.a, s.b, s.c, s.notAnswered, s.largest], [108, 182, 31, 321, 'b']);
  assert.deepEqual([s.by['answered right'], s.by['answered wrong'], s.answerable, s.answerableRight], [84, 5, 300, 84]);
});
