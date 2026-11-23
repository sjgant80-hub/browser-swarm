import { test } from 'node:test';
import assert from 'node:assert/strict';
import ASM from '../src/assembly.mjs';
import S from '../src/cells.mjs';
import { caller } from '../src/swarm.mjs';
import { sha256 } from '../src/sha256.mjs';

const P = [{ id: 'nor#0', text: 'Rollo founded the duchy of Normandy in 911. The Normans later spoke a dialect of French.' }, { id: 'par#0', text: 'Paris is the capital of France. The river Seine runs through Paris.' }];
const ctx = S.prepare({ paragraphs: P.map((p) => ({ ...p, sha256: sha256(p.text) })) },
  { intents: [{ intent: 'card_arrival', terms: { card: 2, arrived: 3 } }, { intent: 'lost_card', terms: { card: 2, lost: 4 } }, { intent: 'top_up', terms: { card: 1, top: 3 } }] },
  { departments: [{ id: 'banking', label: 'banking', examples: ['balance'], terms: { balance: 3, money: 1 } }, { id: 'travel', label: 'travel', examples: ['flight'], terms: { flight: 4, money: 1 } }] }, { qa: { minScore: 1, minCoverage: 0, requireFocus: false } });
// a stand-in model: the first rule whose pattern matches the LAST message answers; every call is counted
const model = (rules) => { const seen = []; return { seen, ask: async (messages, maxTokens) => { const u = messages[messages.length - 1].content; seen.push({ u, maxTokens, sys: messages[0].content }); const r = rules.find(([re]) => re.test(u)); if (!r) throw new Error('no rule for ' + u); return { text: r[1], ms: 5 }; } }; };
const T = (kind, request, input) => ({ id: `${kind}:1`, kind, request, input });
const ALL = { desks: Object.fromEntries(S.CELLS.map((c) => [c.name, 'atoms'])) };
const run = (task, rules, o) => {
  const opts = { ...ALL, ...(o || {}) };
  if (rules.every((x) => typeof x === 'string')) { const seen = []; let i = 0; return ASM.assemble(task, caller(async (messages) => { seen.push(messages[messages.length - 1].content + '#' + i); return { text: rules[i++] ?? '', ms: 5 }; }), ctx, opts).then((r) => ({ r, seen })); }
  const m = model(rules); return ASM.assemble(task, caller(m.ask), ctx, opts).then((r) => ({ r, seen: m.seen }));
};
const REQ = { qa: 'Answer this question from our documents.', extract: 'Pull the total amount from this receipt.', classify: 'Which banking intent is this customer message?', route: 'Which department should handle this message?', date: 'Convert this date to ISO format.', pence: 'Convert this money amount to pence.', draft: 'Draft a refund confirmation from this record.' };

test('agree: the words two readings share, or nothing', () => {
  assert.equal(ASM.agree('Rollo', 'Rollo'), 'Rollo'); assert.equal(ASM.agree('Constant factors', 'constant factors.'), 'constant factors.');
  assert.equal(ASM.agree('Turing', 'the Turing machine'), 'Turing', 'one phrase whole inside the other: the shared, shorter one');
  assert.equal(ASM.agree(' a Turing machine ', 'Turing'), 'Turing'); assert.equal(ASM.agree('"Rollo"', 'rollo'), 'rollo');
  assert.equal(ASM.agree('Latin', "Sant'Eufemia"), ''); assert.equal(ASM.agree('incursions', 'Norse war bands'), '');
  assert.equal(ASM.agree('ring', 'Turing'), '', 'a part of a word is not a shared phrase'); assert.equal(ASM.agree('Turing machine', 'machine Turing'), '');
  for (const [a, b] of [['', 'x'], ['x', ''], ['...', 'x'], ['x', '?'], [null, 'x'], ['x', undefined], [null, null], ['...', '?'], ['', ''], ['!', '!']]) assert.equal(ASM.agree(a, b), '', `${a} and ${b}`);
});

test('documents: two readings, the whole paragraph and ONE sentence, and only what both give is assembled', async () => {
  const q = T('qa', REQ.qa, { question: 'Who founded the duchy of Normandy?' });
  const { r, seen } = await run(q, [[/^Passage:/, 'Rollo'], [/^Sentence: /, 'Rollo']]);
  assert.equal(r.released, true); assert.equal(r.arm, 'assembled'); assert.equal(r.cell, 'docs-answer');
  assert.deepEqual(r.output, { question: q.input.question, answer: 'Rollo', source: 'nor#0' });
  assert.deepEqual(r.ground, { source: 'nor#0', start: 0, end: 5, text: 'Rollo' });
  assert.equal(seen.length, 2); assert.equal(seen[0].maxTokens, 24);
  assert.equal(seen[0].u, 'Passage:\nRollo founded the duchy of Normandy in 911. The Normans later spoke a dialect of French.\n\nQuestion: Who founded the duchy of Normandy?\nAnswer:', 'the first reading is the first build\'s own prompt');
  assert.equal(seen[0].sys, S.CELLS.find((c) => c.name === 'docs-answer').system);
  assert.equal(seen[1].u, 'Sentence: Rollo founded the duchy of Normandy in 911.\nQuestion: Who founded the duchy of Normandy?');
  assert.deepEqual(r.atoms, [{ atom: 'phrase-from-paragraph', said: 'Rollo', value: 'Rollo', ok: true, why: '' }, { atom: 'phrase-from-sentence', said: 'Rollo', value: 'Rollo', ok: true, why: '' }]);
  // the whole-paragraph reading has a veto, and is asked first: if it finds nothing, the sentence is never read
  const veto = await run(q, [[/^Passage:/, 'none'], [/^Sentence: /, 'Rollo']]);
  assert.deepEqual([veto.r.released, veto.r.stage, veto.r.status, veto.seen.length], [false, 'atom', 'refused', 1]);
  assert.equal(veto.r.why, 'a step did not pass, so nothing was assembled: phrase-from-paragraph: the reader found no answer in the source');
  const made = (await run(q, [[/^Passage:/, 'William the Bold'], [/./, 'Rollo']])).r;
  assert.equal(made.stage, 'atom'); assert.match(made.why, /phrase-from-paragraph: the phrase is not the paragraph's own words/); assert.equal(made.atoms[0].ok, false); assert.equal(made.atoms.length, 1);
  const none = (await run(q, [[/^Passage:/, 'Rollo'], [/./, 'none']])).r;
  assert.deepEqual([none.released, none.stage, none.status], [false, 'atom', 'refused']);
  assert.equal(none.why, 'a step did not pass, so nothing was assembled: phrase-from-sentence: the sentence does not answer it');
  const elsewhere = (await run(q, [[/^Passage:/, 'Rollo'], [/./, 'French']])).r;
  assert.equal(elsewhere.stage, 'atom'); assert.match(elsewhere.why, /phrase-from-sentence: the phrase is not the sentence's own words/);
  const differ = (await run(q, [[/^Passage:/, 'The Normans'], [/./, 'Rollo']])).r;
  assert.deepEqual([differ.released, differ.stage], [false, 'atom']); assert.equal(differ.why, 'a step did not pass, so nothing was assembled: the two readings disagree'); assert.equal(differ.atoms.length, 2);
  const inside = (await run(q, [[/^Passage:/, 'Rollo founded'], [/./, 'Rollo']])).r;
  assert.equal(inside.released, true); assert.equal(inside.output.answer, 'Rollo', 'the shared words are what is released');
  const judged = (await run(q, [[/./, 'the duchy']])).r;
  assert.deepEqual([judged.released, judged.stage, judged.status], [false, 'judge', 'unverified']); assert.match(judged.why, /withheld: the question asks who/);
  assert.deepEqual(judged.withheld, { question: q.input.question, answer: 'the duchy', source: 'nor#0' });
  const m = model([[/./, 'x']]);
  const off = await ASM.assemble(T('qa', REQ.qa, { question: 'What is a banana?' }), caller(m.ask), ctx, ALL);
  assert.deepEqual([off.stage, off.status, off.released], ['lane', 'refused', false]); assert.match(off.why, /out of lane.*not in your documents/); assert.equal(m.seen.length, 0);
  const lost = await ASM.assemble(T('x', 'Book me a flight to Lisbon.', {}), caller(m.ask), ctx, ALL);
  assert.deepEqual([lost.stage, lost.cell, lost.released, lost.atoms.length], ['conductor', null, false, 0]);
});

test('receipts: one amount per total line, and a pick only when they differ', async () => {
  const one = await run(T('extract', REQ.extract, { receipt: 'ITEM 10,000\nSUBTOTAL 10,000\nTOTAL 11,000\nCASH 20,000' }), [[/Line: TOTAL 11,000/, '$11000']]);
  assert.equal(one.r.released, true); assert.deepEqual(one.r.output, { value: '11,000' }); assert.equal(one.seen.length, 1, 'the subtotal line is never asked about');
  const two = await run(T('extract', REQ.extract, { receipt: 'TOTAL 120,000\nTOTAL DISC 20,000\nGRAND TOTAL 100,000' }), [[/Line: TOTAL 120,000/, '120,000'], [/Line: TOTAL DISC/, '20,000'], [/Line: GRAND TOTAL/, '100,000'], [/^1\. TOTAL 120,000\n2\. TOTAL DISC 20,000\n3\. GRAND TOTAL 100,000$/, '3']]);
  assert.deepEqual(two.r.output, { value: '100,000' }); assert.equal(two.seen.length, 4); assert.equal(two.r.released, true);
  assert.deepEqual(two.r.atoms.map((a) => a.atom), ['amount-on-line', 'amount-on-line', 'amount-on-line', 'which-total']);
  const same = await run(T('extract', REQ.extract, { receipt: 'x\nTOTAL 9,900\nGRAND TOTAL 9,900' }), [[/Line:/, '9,900']]);
  assert.deepEqual(same.r.output, { value: '9,900' }); assert.equal(same.seen.length, 2, 'the same amount on both lines needs no pick');
  const cut = await run(T('extract', REQ.extract, { receipt: 'TOTAL 1,000\nTOTAL 2,000\nTOTAL 3,000' }), [[/Line: TOTAL 1,000/, '1,000'], [/Line: TOTAL 2,000/, '2,000'], [/^1\./, '2']], { totalLines: 2 });
  assert.deepEqual(cut.r.output, { value: '2,000' }); assert.equal(cut.seen.length, 3, 'only the first two total lines are read');
  const small = await run(T('extract', REQ.extract, { receipt: 'TEA 9.90\nTOTAL 9.90' }), [[/Line: TOTAL 9.90/, '9.90']]);
  assert.equal(small.r.released, true, 'an amount of three digits is an amount'); assert.deepEqual(small.r.output, { value: '9.90' });
  const tiny = await run(T('extract', REQ.extract, { receipt: 'TEA 9.90\nTOTAL QTY 12' }), [[/./, '12']]);
  assert.match(tiny.r.why, /no total line carries an amount/, 'two digits on a total line is a count, not an amount'); assert.equal(tiny.seen.length, 0);
  const noLine = await run(T('extract', REQ.extract, { receipt: 'a\nTotal items 2\nb' }), [[/./, '2']]);
  assert.equal(noLine.r.stage, 'atom'); assert.match(noLine.r.why, /no total line carries an amount/); assert.equal(noLine.seen.length, 0);
  const unread = await run(T('extract', REQ.extract, { receipt: 'a\nTOTAL 11,000' }), [[/./, 'none']]);
  assert.match(unread.r.why, /no amount could be read off a total line/);
  const badPick = await run(T('extract', REQ.extract, { receipt: 'TOTAL 1,000\nTOTAL 2,000' }), [[/Line: TOTAL 1,000/, '1,000'], [/Line: TOTAL 2,000/, '2,000'], [/^1\./, '7']]);
  assert.match(badPick.r.why, /which-total: there is no line with that number/);
  const holed = await run(T('extract', REQ.extract, { receipt: 'TOTAL 1,000\nTOTAL 2,000' }), [[/Line: TOTAL 1,000/, 'none'], [/Line: TOTAL 2,000/, '2,000']]);
  assert.deepEqual(holed.r.output, { value: '2,000' }, 'one readable amount needs no pick');
  const pickedUnread = await run(T('extract', REQ.extract, { receipt: 'TOTAL 1,000\nTOTAL 2,000\nTOTAL 3,000' }), [[/Line: TOTAL 1,000/, 'none'], [/Line: TOTAL 2,000/, '2,000'], [/Line: TOTAL 3,000/, '3,000'], [/^1\./, '1']]);
  assert.match(pickedUnread.r.why, /the amount on the chosen line could not be read/);
  const wrong = await run(T('extract', REQ.extract, { receipt: 'x 5,000\nTotal 5,000 of 9,000 points' }), [[/./, '9,000']]);
  assert.equal(wrong.r.released, true, 'a number on a total line passes the first build\'s judge: the judge is unchanged');
});

test('banking intent: yes to the first label, no to the next ones, and the index must rank it first', async () => {
  const t = T('classify', REQ.classify, { message: 'my card arrived' });
  const ok = await run(t, [[/Topic: card arrival/, 'Yes.'], [/Topic: lost card/, 'no'], [/Topic: top up/, 'No']]);
  assert.equal(ok.r.released, true); assert.deepEqual(ok.r.output, { message: 'my card arrived', label: 'card_arrival', labels: ['card_arrival', 'lost_card', 'top_up'], votes: ['yes', 'no', 'no'] }); assert.equal(ok.seen.length, 3);
  const no = await run(t, [[/./, 'no']]);
  assert.equal(no.seen.length, 1, 'a no to the first label ends it'); assert.match(no.r.why, /said no to the word index's first label/); assert.equal(no.r.stage, 'atom');
  const both = await run(t, [[/./, 'yes']]);
  assert.equal(both.seen.length, 2); assert.match(both.r.why, /said yes to more than one label/);
  const mumble = await run(t, [[/./, 'I would say']]);
  assert.match(mumble.r.why, /about-topic: neither yes nor no/);
  const two = await run(t, [[/Topic: card arrival/, 'yes'], [/./, 'no']], { topics: 2 });
  assert.equal(two.seen.length, 2); assert.deepEqual(two.r.output.votes, ['yes', 'no']); assert.equal(two.r.released, true);
  const J = ASM.JUDGES['banking-intent'];
  assert.equal(J({ label: 'a', labels: ['a', 'b'], votes: ['yes', 'no'] }).status, 'verified');
  assert.match(J({ label: 'c', labels: ['a', 'b'], votes: ['yes'] }).why, /not on the shortlist/);
  assert.match(J({ label: 'b', labels: ['a', 'b'], votes: ['yes'] }).why, /ranks another intent first/);
  assert.match(J({ label: 'a', labels: ['a', 'b'], votes: ['yes', 'yes'] }).why, /did not single this label out/);
  assert.match(J({ label: 'a', labels: ['a', 'b'], votes: ['no'] }).why, /did not single/);
  assert.match(J({ label: 'a', labels: ['a', 'b'], votes: [] }).why, /did not single/);
  assert.match(J({ label: 'a', labels: ['a', 'b'] }).why, /did not single/);
  assert.match(J({ label: 'a' }).why, /not on the shortlist/);
});

test('department: yes to the index\'s first, no to its second', async () => {
  const t = T('route', REQ.route, { message: 'what is my balance' });
  const ok = await run(t, [[/Department: banking \(for example: balance\)/, 'yes'], [/Department: travel/, 'no']]);
  assert.equal(ok.r.released, true); assert.deepEqual(ok.r.output, { message: 'what is my balance', domain: 'banking', votes: ['yes', 'no'] });
  const no = await run(t, [[/./, 'No.']]);
  assert.equal(no.seen.length, 1); assert.match(no.r.why, /said no to the word index's first department/);
  const both = await run(t, [[/./, 'yes']]);
  assert.match(both.r.why, /said yes to more than one department/);
  const one = await run(t, [[/./, 'yes']], { departments: 1 });
  assert.equal(one.seen.length, 1); assert.equal(one.r.released, true);
  const J = ASM.JUDGES.department;
  assert.equal(J({ domain: 'banking', votes: ['yes', 'no'] }, { message: 'what is my balance' }, ctx).status, 'verified');
  assert.match(J({ domain: 'moon', votes: ['yes'] }, { message: 'x' }, ctx).why, /not one of the departments/);
  assert.match(J({ domain: 'travel', votes: ['yes'] }, { message: 'what is my balance' }, ctx).why, /ranks another department first/);
  assert.match(J({ domain: 'banking', votes: ['yes', 'yes'] }, { message: 'what is my balance' }, ctx).why, /did not single this department out/);
  assert.match(J({ domain: 'banking', votes: [] }, { message: 'what is my balance' }, ctx).why, /did not single/);
  assert.match(J({ domain: 'banking' }, { message: 'what is my balance' }, {}).why, /not one of/);
});

test('dates and amounts: read by code, checked by the first build\'s separate check, no model asked', async () => {
  const d = await run(T('date', REQ.date, { text: 'the 20th of May 2016' }), []);
  assert.equal(d.seen.length, 0); assert.equal(d.r.released, true); assert.deepEqual(d.r.output, { text: 'the 20th of May 2016', iso: '2016-05-20' });
  assert.deepEqual([d.r.plan, d.r.atoms.length, d.r.calls.length, d.r.ms, d.r.cell], ['atoms', 0, 0, 0, 'iso-date']); assert.deepEqual(d.r.ground, { text: '2016-05-20' });
  const unread = await run(T('date', REQ.date, { text: 'some time in 2016' }), []);
  assert.deepEqual([unread.r.released, unread.r.stage, unread.r.status], [false, 'atom', 'refused']);
  assert.equal(unread.r.why, 'a step did not pass, so nothing was assembled: the date is not written in a form the code reads without a guess');
  assert.equal((await run(T('date', REQ.date, { text: 'the 20th of May' }), [])).r.stage, 'lane');
  const p = await run(T('pence', REQ.pence, { text: '1,979.99 pounds' }), []);
  assert.equal(p.seen.length, 0); assert.equal(p.r.released, true); assert.deepEqual(p.r.output, { text: '1,979.99 pounds', pence: 197999 }); assert.deepEqual(p.r.ground, { text: '197999' });
  const odd = await run(T('pence', REQ.pence, { text: '£12.5' }), []);
  assert.deepEqual([odd.r.released, odd.r.stage], [false, 'atom']); assert.equal(odd.r.why, 'a step did not pass, so nothing was assembled: the amount is not written in a form the code reads without a guess');
  // the reader and the first build's check are separate code: where they disagree, nothing is released
  const split = await run(T('pence', REQ.pence, { text: '3 pounds and 9p' }), []);
  assert.deepEqual([split.r.released, split.r.stage, split.r.status], [false, 'judge', 'unverified']); assert.match(split.r.why, /withheld: the text does not say 3 pounds and 9 pence/);
  assert.deepEqual(split.r.withheld, { text: '3 pounds and 9p', pence: 309 });
});

test('the refund letter is assembled by code: no model is asked', async () => {
  const R = { name: 'Sam Wood', order: 'ORD-1', item: 'lamp', amount: '£5.00', date: '1 May 2026' };
  const { r, seen } = await run(T('draft', REQ.draft, { record: R }), []);
  assert.equal(seen.length, 0); assert.equal(r.released, true); assert.deepEqual(r.atoms, []); assert.equal(r.ms, 0);
  assert.equal(r.output.letter, 'Dear Sam Wood, your refund of £5.00 for order ORD-1 (lamp, bought on 1 May 2026) has been processed.');
  const missing = await run(T('draft', REQ.draft, { record: { ...R, item: '' } }), []);
  assert.equal(missing.r.stage, 'lane');
});

test('replay: an assembled record decided again from its replies alone', async () => {
  const t = T('classify', REQ.classify, { message: 'my card arrived' });
  let i = 0; const answers = ['yes', 'no', 'no'];
  const r = await ASM.assemble(t, caller(async () => ({ text: answers[i++], ms: 9, ttft: 0.1, prompt: 40 })), ctx, ALL);
  assert.deepEqual([r.released, r.plan, r.calls.length, r.ms], [true, 'atoms', 3, 27]);
  assert.deepEqual(r.calls[0], { ms: 9, ttft: 0.1, prompt: 40, cached: false, text: 'yes' });
  assert.deepEqual(await ASM.replay(t, r, ctx, ALL), r);
  const lost = await ASM.replay(t, { calls: [{ text: 'yes' }] }, ctx, ALL);
  assert.equal(lost.released, false, 'a missing reply is an empty reply'); assert.equal(lost.calls.length, 2);
  assert.equal((await ASM.replay(t, null, ctx)).released, false);
  assert.deepEqual(ASM.DEFAULTS, { topics: 3, departments: 2, totalLines: 4, desks: {} });
  for (const odd of ['atoms', 7, null, undefined, true]) assert.equal((await ASM.assemble(t, caller(async () => ({ text: 'card_arrival', ms: 1 })), ctx, odd)).plan, 'one call', String(odd));
  // a desk whose plan was not adopted answers in one call, exactly as the first build does
  const d = T('date', REQ.date, { text: 'the 20th of May 2016' });
  const one = await ASM.assemble(d, caller(async () => ({ text: '2016-05-20', ms: 3 })), ctx);
  assert.deepEqual([one.released, one.plan, one.arm, one.calls.length, one.atoms.length], [true, 'one call', 'assembled', 1, 0]);
  assert.deepEqual(one.output, { text: 'the 20th of May 2016', iso: '2016-05-20' });
  const other = await ASM.assemble(d, caller(async () => ({ text: '2016-05-20', ms: 3 })), ctx, { desks: { 'iso-date': 'one-call', pence: 'atoms' } });
  assert.equal(other.plan, 'one call');
  assert.deepEqual(await ASM.replay(d, one, ctx), one);
});
