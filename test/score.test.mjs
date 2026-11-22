import { test } from 'node:test';
import assert from 'node:assert/strict';
import SC from '../src/score.mjs';
import S from '../src/cells.mjs';
import { sha256 } from '../src/sha256.mjs';

const R = { name: 'Sam Wood', order: 'ORD-1', item: 'lamp', amount: '£5.00', date: '1 May 2026' };
const letter = 'Dear Sam Wood, your refund of £5.00 for order ORD-1 (lamp, 1 May 2026) is done.';
const T = {
  qa: { id: 'q', kind: 'qa', gold: { answer: '16th century', impossible: false } },
  qaNo: { id: 'qn', kind: 'qa', gold: { impossible: true } },
  ex: { id: 'e', kind: 'extract', input: { receipt: 'TOTAL 22.000' }, gold: { total: '22.000' } },
  cl: { id: 'c', kind: 'classify', gold: { intent: 'card_arrival' } },
  rt: { id: 'r', kind: 'route', gold: { domain: 'travel' } },
  oos: { id: 'o', kind: 'route', gold: { domain: null } },
  dt: { id: 'd', kind: 'date', input: { text: '3 March 2025' }, gold: { iso: '2025-03-03' } },
  pe: { id: 'p', kind: 'pence', input: { text: '£12' }, gold: { pence: 1200 } },
  dr: { id: 'l', kind: 'draft', input: { record: R }, gold: { record: R } },
  kn: { id: 'k', kind: 'knowledge', input: { options: { A: 'Paris', B: 'Rome', C: 'Oslo', D: 'Bern' } }, gold: { letter: 'A' } },
  re: { id: 'm', kind: 'reasoning', input: { options: { A: '7' } }, gold: { letter: 'A' } },
};

test('right: each kind by its own rule', () => {
  assert.equal(SC.right(T.qa, { answer: '16th' }), true);                 // F1 0.67
  assert.equal(SC.right(T.qa, { answer: 'the 16th century AD in France' }), true);    // F1 0.57
  assert.equal(SC.right(T.qa, { answer: '16th century AD in the north of France' }), false);   // F1 0.44
  assert.equal(SC.right(T.qa, { answer: 'century 16th x' }), true);       // F1 exactly 0.8
  assert.equal(SC.right(T.qa, { answer: '16th x y' }), false);            // F1 exactly 0.4
  assert.equal(SC.right(T.qa, { answer: '16th century and' }), true);
  assert.equal(SC.right({ kind: 'qa', gold: { answer: 'x y' } }, { answer: 'x z' }), true);   // F1 exactly 0.5 ("a" is an article SQuAD drops)
  assert.equal(SC.right(T.qaNo, { answer: 'x' }), false);
  assert.equal(SC.right(T.ex, { value: '22.000' }), true);
  assert.equal(SC.right(T.ex, { value: '22.00' }), false);
  assert.equal(SC.right({ kind: 'extract', gold: { total: '' } }, { value: '' }), false);
  assert.equal(SC.right(T.cl, { label: 'card_arrival' }), true);
  assert.equal(SC.right(T.cl, { label: 'lost_card' }), false);
  assert.equal(SC.right(T.rt, { domain: 'travel' }), true);
  assert.equal(SC.right(T.rt, { domain: 'work' }), false);
  assert.equal(SC.right(T.oos, { domain: null }), false);
  assert.equal(SC.right(T.dt, { iso: '2025-03-03' }), true);
  assert.equal(SC.right(T.dt, { iso: '2025-03-04' }), false);
  assert.equal(SC.right(T.pe, { pence: 1200 }), true);
  assert.equal(SC.right(T.pe, { pence: 120 }), false);
  assert.equal(SC.right(T.dr, { letter }), true);
  assert.equal(SC.right(T.dr, { letter: 'Hello. ' + 'x '.repeat(11) + letter }), false);   // the name is not in the first 12 words
  assert.equal(SC.right(T.dr, { letter: 'a b c d e f g h i j Sam Wood ' + letter.slice(14) }), true);
  assert.equal(SC.right(T.dr, { letter: letter.replace('lamp', 'light') }), false);
  assert.equal(SC.right(T.kn, { letter: 'A' }), true);
  assert.equal(SC.right(T.kn, { letter: 'B' }), false);
  assert.equal(SC.right(T.kn, { answer: 'paris' }), true);                 // a span released through the document cell
  assert.equal(SC.right(T.kn, { answer: 'Rome' }), false);
  assert.equal(SC.right({ kind: 'knowledge', input: {}, gold: { letter: 'A' } }, { answer: 'x' }), false);
  assert.equal(SC.right(T.re, { letter: 'A' }), true);
  assert.equal(SC.right({ kind: 'mystery', gold: {} }, {}), false);
  assert.equal(SC.right(null, null), false);
});

test('outcome: correct, silent, missed', () => {
  assert.deepEqual(SC.outcome(T.qa, { released: true, output: { answer: '16th century' } }), { released: true, correct: true, silent: false, missed: false });
  assert.deepEqual(SC.outcome(T.qa, { released: true, output: { answer: 'France' } }), { released: true, correct: false, silent: true, missed: false });
  assert.deepEqual(SC.outcome(T.qa, { released: false }), { released: false, correct: false, silent: false, missed: true });
  assert.deepEqual(SC.outcome(T.qaNo, { released: false }), { released: false, correct: true, silent: false, missed: false });
  assert.deepEqual(SC.outcome(T.qaNo, { released: true, output: { answer: 'x' } }), { released: true, correct: false, silent: true, missed: false });
  assert.deepEqual(SC.outcome(T.oos, { released: false }), { released: false, correct: true, silent: false, missed: false });
  assert.deepEqual(SC.outcome(T.qa, { released: 'yes', output: { answer: '16th century' } }), { released: false, correct: false, silent: false, missed: true });
  assert.equal(SC.shouldRefuse(T.rt), false); assert.equal(SC.shouldRefuse(T.oos), true); assert.equal(SC.shouldRefuse(T.qaNo), true); assert.equal(SC.shouldRefuse(T.qa), false);
});

test('grounded: facts traced to their source; labels left out', () => {
  const text = 'Rollo founded Normandy in 911.';
  const ctx = S.prepare({ paragraphs: [{ id: 'n', text, sha256: sha256(text) }] }, null, null, null);
  assert.equal(SC.grounded(T.qa, { released: false }, ctx), null);
  assert.equal(SC.grounded(T.qa, { released: true, output: { answer: 'Rollo', source: 'n' } }, ctx), true);
  assert.equal(SC.grounded(T.qa, { released: true, output: { answer: 'William', source: 'n' } }, ctx), false);
  assert.equal(SC.grounded(T.qa, { released: true, output: { answer: 'Rollo', source: 'gone' } }, ctx), false);
  assert.equal(SC.grounded(T.qa, { released: true, output: { answer: 'Rollo', source: 'n' } }, null), false);
  assert.equal(SC.grounded(T.cl, { released: true, output: { label: 'x' } }, ctx), null);
  assert.equal(SC.grounded(T.rt, { released: true, output: { domain: 'x' } }, ctx), null);
  assert.equal(SC.grounded(T.kn, { released: true, output: { letter: 'A' } }, ctx), false);
  assert.equal(SC.grounded(T.ex, { released: true, output: { value: '22.000' } }, ctx), true);
  assert.equal(SC.grounded(T.ex, { released: true, output: { value: '22.00' } }, ctx), false);
  assert.equal(SC.grounded(T.dt, { released: true, output: { iso: '2025-03-03' } }, ctx), true);
  assert.equal(SC.grounded(T.dt, { released: true, output: { iso: '2025-04-03' } }, ctx), false);
  assert.equal(SC.grounded(T.pe, { released: true, output: { pence: 1200 } }, ctx), true);
  assert.equal(SC.grounded(T.pe, { released: true, output: { pence: 12 } }, ctx), false);
  assert.equal(SC.grounded(T.dr, { released: true, output: { letter } }, ctx), true);
  assert.equal(SC.grounded(T.dr, { released: true, output: { letter: 'Dear Sam' } }, ctx), false);
  assert.equal(SC.grounded({ kind: 'mystery' }, { released: true, output: {} }, ctx), false);
  assert.equal(SC.grounded(T.re, { released: true, output: { letter: 'A' } }, ctx), false);
  assert.equal(SC.grounded({ kind: 'reasoning', input: {} }, { released: true, output: { answer: 'Rollo', source: 'n' } }, ctx), true);
});

test('metrics: the six numbers, overall, bounded, hard and per kind', () => {
  const tasks = [T.qa, T.qaNo, T.ex, T.cl, T.kn];
  const recs = [
    { id: 'q', released: true, output: { answer: '16th century', source: 'n' }, ms: 10 },
    { id: 'qn', released: true, output: { answer: 'x', source: 'n' }, ms: 20 },
    { id: 'e', released: false, ms: 30 },
    { id: 'c', released: true, output: { label: 'card_arrival' }, ms: 40 },
    { id: 'k', released: true, output: { letter: 'B' }, ms: 50 },
  ];
  const text = 'the 16th century';
  const ctx = S.prepare({ paragraphs: [{ id: 'n', text, sha256: sha256(text) }] }, null, null, null);
  const m = SC.metrics(tasks, recs, { ctx, arm: 'gated', venue: 'v', model: 'm', costUsd: 0.5, leftDevice: true });
  assert.deepEqual([m.arm, m.venue, m.model, m.costUsd, m.leftDevice], ['gated', 'v', 'm', 0.5, true]);
  assert.deepEqual({ ...m.all, medianMs: null }, { tasks: 5, released: 4, correct: 2, silent: 2, missed: 1, accuracy: 0.4, coverage: 0.8, silentRate: 0.4, silentAmongReleased: 0.5, groundedRate: 1 / 3, groundedOf: 3, medianMs: null });
  assert.equal(m.all.medianMs, 30);
  assert.equal(m.bounded.tasks, 4); assert.equal(m.hard.tasks, 1); assert.equal(m.hard.silent, 1);
  assert.deepEqual(Object.keys(m.byKind), ['qa', 'extract', 'classify', 'knowledge']);
  assert.equal(m.byKind.qa.correct, 1);
  assert.deepEqual(m.rows[1], { id: 'qn', kind: 'qa', released: true, correct: false, silent: true, grounded: false });
  const none = SC.metrics([T.qa], [], {});
  assert.deepEqual([none.all.released, none.all.missed, none.all.silentAmongReleased, none.all.groundedRate, none.costUsd, none.leftDevice, none.arm], [0, 1, null, null, 0, false, null]);
  const empty = SC.metrics(null, null, null);
  assert.equal(empty.all.tasks, 0); assert.equal(empty.all.accuracy, null);
  assert.equal(SC.metrics([T.qa], [{ id: 'q', released: true, output: { answer: 'x' }, ms: 'slow' }], {}).all.medianMs, 0);
});

test('pairedSilent: exact McNemar on who failed silently', () => {
  const a = { rows: [{ id: 1, silent: false }, { id: 2, silent: false }, { id: 3, silent: true }, { id: 4, silent: false }] };
  const b = { rows: [{ id: 1, silent: true }, { id: 2, silent: true }, { id: 3, silent: false }, { id: 4, silent: false }, { id: 9, silent: true }] };
  const p = SC.pairedSilent(a, b);
  assert.equal(p.aOnly, 1); assert.equal(p.bOnly, 2); assert.equal(p.p, 1);
  const big = { rows: Array.from({ length: 12 }, (_, i) => ({ id: i, silent: false })) }, bad = { rows: Array.from({ length: 12 }, (_, i) => ({ id: i, silent: true })) };
  const q = SC.pairedSilent(big, bad);
  assert.equal(q.bOnly, 12); assert.equal(q.aOnly, 0); assert.ok(q.p < 0.001);
  assert.deepEqual(SC.pairedSilent(null, null), { aOnly: 0, bOnly: 0, p: 1 });
  assert.deepEqual(SC.BOUNDED, ['qa', 'extract', 'classify', 'route', 'date', 'pence', 'draft']);
  assert.deepEqual(SC.HARD, ['knowledge', 'reasoning']);
});
