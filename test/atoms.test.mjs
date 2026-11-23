import { test } from 'node:test';
import assert from 'node:assert/strict';
import A from '../src/atoms.mjs';

const { ATOMS, yesNo, whole, amountsOn } = A;
const last = (m) => m[m.length - 1].content;

test('yesNo, whole, amountsOn', () => {
  assert.equal(yesNo('Yes.'), 'yes'); assert.equal(yesNo('no, it is not'), 'no'); assert.equal(yesNo('  YES\nno'), 'yes');
  assert.equal(yesNo('Answer: Yes'), null); assert.equal(yesNo('yesterday'), null); assert.equal(yesNo(null), null); assert.equal(yesNo('nothing'), null);
  assert.equal(whole('5th'), 5); assert.equal(whole('12'), 12); assert.equal(whole('none'), null); assert.equal(whole('None at all 4'), null);
  assert.equal(whole('x\n7'), null); assert.equal(whole('day 21 of'), 21); assert.equal(whole('99999999999999999999'), null); assert.equal(whole(''), null);
  assert.deepEqual(amountsOn('TOTAL 3 ITEMS 87.000'), ['3', '87.000']); assert.deepEqual(amountsOn('x'), []); assert.deepEqual(amountsOn(null), []);
  assert.deepEqual(amountsOn('Rp 1,250,000.'), ['1,250,000']);
});

test('every atom shows its worked examples as earlier turns, then the query', () => {
  for (const [name, a] of Object.entries(ATOMS)) {
    const m = a.messages({ sentence: 'S', question: 'Q', line: 'L', lines: ['a', 'b'], message: 'M', topic: 'T', department: 'D', text: 'X' });
    assert.equal(m[0].role, 'system', name); assert.equal(m[0].content, a.system, name);
    assert.equal(m.length, 2 + 2 * a.shots.length, name);
    for (let i = 0; i < a.shots.length; i++) { assert.deepEqual(m[1 + 2 * i], { role: 'user', content: a.shots[i][0] }, name); assert.deepEqual(m[2 + 2 * i], { role: 'assistant', content: a.shots[i][1] }, name); }
    assert.equal(m[m.length - 1].role, 'user', name);
    assert.ok(a.shots.length >= 3 && typeof a.what === 'string' && Number.isInteger(a.maxTokens), name);
    // every worked example is one its own atom would read and pass
    for (const [u, ans] of a.shots) { const p = a.parse(ans, {}); assert.ok(p.value !== undefined || /^none$/.test(ans), `${name}: the example answer "${ans}" does not parse`); assert.ok(u.length > 0); }
  }
  assert.equal(last(ATOMS['phrase-from-sentence'].messages({ sentence: 'S.', question: 'Q?' })), 'Sentence: S.\nQuestion: Q?');
  assert.equal(last(ATOMS['amount-on-line'].messages({ line: 'TOTAL 5' })), 'Line: TOTAL 5');
  assert.equal(last(ATOMS['which-total'].messages({ lines: ['x', 'y'] })), '1. x\n2. y');
  assert.equal(last(ATOMS['which-total'].messages({})), '');
  assert.equal(last(ATOMS['about-topic'].messages({ message: 'm', topic: 't' })), 'Message: m\nTopic: t');
  assert.equal(last(ATOMS['about-department'].messages({ message: 'm', department: 'd' })), 'Message: m\nDepartment: d');
});

test('phrase-from-sentence', () => {
  const a = ATOMS['phrase-from-sentence'], s = 'Rollo founded the duchy in 911.';
  assert.deepEqual(a.parse('"Rollo."'), { value: 'Rollo' });
  assert.deepEqual(a.parse('Answer: Rollo'), { value: 'Rollo' });
  assert.deepEqual(a.parse('  answer :  the duchy'), { value: 'the duchy' });
  assert.match(a.parse('none').why, /does not answer/);
  assert.match(a.parse('').why, /does not answer/);
  assert.equal(a.check('rollo', { sentence: s }), '');
  assert.match(a.check('William', { sentence: s }), /not the sentence's own words/);
  assert.match(a.check('Rollo', {}), /not the sentence's own words/);
});

test('amount-on-line: read, and read back in the line\'s own form', () => {
  const a = ATOMS['amount-on-line'];
  assert.deepEqual(a.parse('45,000', { line: 'TOTAL 45,000' }), { value: '45,000' });
  assert.deepEqual(a.parse('$45000', { line: 'TOTAL 45,000' }), { value: '45,000' }, 'the right digits in another format snap to the printed amount');
  assert.deepEqual(a.parse('22.00', { line: 'TOTAL 22.000' }), { value: '22.00' }, 'different digits are not snapped');
  assert.deepEqual(a.parse('1000', { line: 'A 1,000 B 10.00' }), { value: '1000' }, 'two printed amounts share the digits: not settled');
  assert.deepEqual(a.parse('1000', { line: 'A 1,000 B 1,000' }), { value: '1,000' }, 'the same amount printed twice is one amount');
  assert.match(a.parse('none', { line: 'x' }).why, /no amount/);
  assert.equal(a.check('45,000', { line: 'TOTAL 45,000' }), '');
  assert.match(a.check('45000', { line: 'TOTAL 45,000' }), /not printed on the line/);
  assert.match(a.check('5,000', { line: 'TOTAL 45,000' }), /not printed/);
  assert.match(a.check('5', {}), /not printed/);
});

test('which-total', () => {
  const a = ATOMS['which-total'];
  assert.deepEqual(a.parse('2'), { value: 2 }); assert.deepEqual(a.parse('Line 3.'), { value: 3 }); assert.match(a.parse('none').why, /no line number/);
  assert.equal(a.check(1, { lines: ['x', 'y'] }), ''); assert.equal(a.check(2, { lines: ['x', 'y'] }), '');
  assert.match(a.check(3, { lines: ['x', 'y'] }), /no line/); assert.match(a.check(0, { lines: ['x'] }), /no line/); assert.match(a.check(1.5, { lines: ['x', 'y'] }), /no line/); assert.match(a.check(1, {}), /no line/);
});

test('the yes/no atoms', () => {
  for (const n of ['about-topic', 'about-department']) {
    const a = ATOMS[n];
    assert.deepEqual(a.parse('Yes.'), { value: 'yes' }); assert.deepEqual(a.parse('no'), { value: 'no' }); assert.match(a.parse('I would say').why, /neither yes nor no/);
    assert.equal(a.check('yes', {}), '');
  }
});

