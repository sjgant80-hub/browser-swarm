import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caller, gated, raw, replay } from '../src/swarm.mjs';
import S from '../src/cells.mjs';
import { sha256 } from '../src/sha256.mjs';

const P = [{ id: 'nor#0', text: 'Rollo founded the duchy of Normandy in 911. The Normans later spoke a dialect of French.' }, { id: 'par#0', text: 'Paris is the capital of France. The river Seine runs through Paris.' }];
const ctx = S.prepare({ paragraphs: P.map((p) => ({ ...p, sha256: sha256(p.text) })) },
  { intents: [{ intent: 'card_arrival', terms: { card: 2, arrived: 3 } }, { intent: 'lost_card', terms: { card: 2, lost: 4 } }] },
  { departments: [{ id: 'banking', label: 'banking', examples: [] }, { id: 'travel', label: 'travel', examples: [] }] }, { qa: { minScore: 1, minCoverage: 0, requireFocus: false } });
// a stand-in model: replies by the first rule whose pattern the last message matches; counts its calls
const model = (rules) => { const seen = []; const ask = async (messages, maxTokens) => { seen.push({ messages, maxTokens }); const u = messages[messages.length - 1].content; const r = rules.find(([re]) => re.test(u)); if (!r) throw new Error('no rule'); return { text: r[1], ms: 7, ttft: 3, prompt: 11 }; }; return { ask, seen }; };
const T = (kind, request, input) => ({ id: `${kind}:1`, kind, request, input });

test('caller asks each distinct request once and marks repeats cached', async () => {
  const m = model([[/./, 'hi']]);
  const call = caller(m.ask);
  const a = await call([{ role: 'user', content: 'x' }], 5), b = await call([{ role: 'user', content: 'x' }], 5), c = await call([{ role: 'user', content: 'x' }], 6);
  assert.deepEqual([a.cached, b.cached, c.cached], [false, true, false]);
  assert.equal(m.seen.length, 2);
  assert.deepEqual(a, { text: 'hi', ms: 7, ttft: 3, prompt: 11, cached: false });
  const bad = await caller(async () => { throw new Error('boom'); })([], 1);
  assert.deepEqual([bad.text, bad.ms, bad.error], ['', 0, 'boom']);
  const odd = await caller(async () => ({ text: 5, ms: 'x' }))([], 1);
  assert.deepEqual(odd, { text: '', ms: 0, ttft: null, prompt: null, cached: false });
  const err = await caller(async () => { throw 'plain'; })([], 1);
  assert.equal(err.error, 'plain');
});

test('gated: verified is released with its grounding', async () => {
  const m = model([[/Question:/, 'Rollo']]);
  const r = await gated(T('qa', 'Answer this question from our documents.', { question: 'Who founded the duchy of Normandy?' }), caller(m.ask), ctx);
  assert.equal(r.released, true); assert.equal(r.status, 'verified'); assert.equal(r.cell, 'docs-answer'); assert.equal(r.arm, 'gated');
  assert.deepEqual(r.output, { question: 'Who founded the duchy of Normandy?', answer: 'Rollo', source: 'nor#0' });
  assert.deepEqual(r.ground, { source: 'nor#0', start: 0, end: 5, text: 'Rollo' });
  assert.equal(r.why, ''); assert.equal(r.ms, 7); assert.equal(r.calls.length, 1); assert.equal(m.seen[0].maxTokens, 24);
});

test('gated: the judge withholds, the lane refuses, the conductor refuses, the act refuses', async () => {
  const wrong = await gated(T('qa', 'Answer this question from our documents.', { question: 'Who founded the duchy of Normandy?' }), caller(model([[/./, 'William']]).ask), ctx);
  assert.equal(wrong.released, false); assert.equal(wrong.status, 'unverified');
  assert.match(wrong.why, /its judge said unverified, so the output is withheld: the answer is not the source's own words/);
  assert.deepEqual(wrong.withheld, { question: 'Who founded the duchy of Normandy?', answer: 'William', source: 'nor#0' });
  const m = model([[/./, 'x']]);
  const out = await gated(T('qa', 'Answer this question from our documents.', { question: 'What is a banana?' }), caller(m.ask), ctx);
  assert.equal(out.stage, 'lane'); assert.equal(out.status, 'refused'); assert.match(out.why, /out of lane.*: not in your documents/); assert.equal(m.seen.length, 0, 'out of lane: the model never ran');
  const none = await gated(T('x', 'Book me a flight to Lisbon.', {}), caller(m.ask), ctx);
  assert.deepEqual([none.stage, none.status, none.released, none.cell], ['conductor', 'refused', false, null]); assert.match(none.why, /no admitted cell/);
  const said = await gated(T('qa', 'Answer this question from our documents.', { question: 'Who founded the duchy of Normandy?' }), caller(model([[/./, 'none']]).ask), ctx);
  assert.equal(said.stage, 'act'); assert.equal(said.status, 'refused'); assert.equal(said.why, 'the act refused: the reader found no answer in the source');
});

test('gated: two readings, both asked; disagreement withheld', async () => {
  const m = model([[/- card arrival\n- lost card/, 'card arrival'], [/- lost card\n- card arrival/, 'lost card']]);
  const r = await gated(T('classify', 'Which banking intent is this customer message?', { message: 'my card arrived lost' }), caller(m.ask), ctx);
  assert.equal(r.calls.length, 2); assert.equal(r.released, false); assert.match(r.why, /disagree/); assert.equal(r.ms, 14);
  const ok = await gated(T('classify', 'Which banking intent is this customer message?', { message: 'my card arrived' }), caller(model([[/./, 'card arrival']]).ask), ctx);
  assert.equal(ok.released, true); assert.equal(ok.output.label, 'card_arrival');
});

test('gated: the guard refuses an output that answers a different input', async () => {
  const cell = S.CELLS.find((c) => c.name === 'iso-date');
  const keep = cell.parse;
  cell.parse = (raws) => ({ output: { text: 'another text', iso: '2025-03-03' } });
  try {
    const r = await gated(T('date', 'Convert this date to ISO format.', { text: '3 March 2025' }), caller(model([[/./, '2025-03-03']]).ask), ctx);
    assert.equal(r.released, false); assert.equal(r.status, 'unverified'); assert.match(r.why, /"text" came back changed/);
  } finally { cell.parse = keep; }
});

test('raw: whatever the model says is delivered; shared calls are cached', async () => {
  const m = model([[/\nD\. /, 'B'], [/Question:/, 'Rollo'], [/ISO date/, '2025-03-04']]);
  const call = caller(m.ask);
  const task = T('qa', 'Answer this question from our documents.', { question: 'Who founded the duchy of Normandy?' });
  await gated(task, call, ctx);
  const r = await raw(task, call, ctx);
  assert.equal(r.released, true); assert.equal(r.arm, 'raw'); assert.equal(r.calls[0].cached, true); assert.equal(m.seen.length, 1);
  const off = await raw(T('qa', 'x', { question: 'What is a banana?' }), call, ctx);
  assert.equal(off.released, true, 'the plain pipeline answers from its best document, whatever its score');
  const mc = await raw({ id: 'k', kind: 'knowledge', input: { question: 'Q', options: { A: '1', B: '2', C: '3', D: '4' } } }, call, ctx);
  assert.deepEqual([mc.cell, mc.output], ['multiple-choice', { letter: 'B' }]);
  const rz = await raw({ id: 'r', kind: 'reasoning', input: { question: 'Q', options: {} } }, call, ctx);
  assert.equal(rz.cell, 'multiple-choice');
  const d = await raw(T('date', 'x', { text: '3 March 2025' }), call, ctx);
  assert.equal(d.released, true); assert.equal(d.output.iso, '2025-03-04', 'raw delivers a wrong date the gate would withhold');
  const g = await gated(T('date', 'Convert this date to ISO format.', { text: '3 March 2025' }), call, ctx);
  assert.equal(g.released, false);
  const none = await raw(T('date', 'x', { text: 'no date here' }), caller(model([[/./, 'none']]).ask), ctx);
  assert.deepEqual([none.released, none.why], [false, 'the reader wrote no real date']);
  assert.equal(none.output, undefined);
  const odd = await raw({ id: 'z', kind: 'mystery', input: {} }, call, ctx);
  assert.deepEqual([odd.released, odd.cell, odd.why], [false, null, 'no prompt for this kind']);
  const bank = await raw(T('classify', 'x', { message: 'hello' }), caller(model([[/- card arrival\n- lost card/, 'lost card']]).ask), ctx);
  assert.equal(bank.output.label, 'lost_card');
});

test('replay: a recorded run decided again from its replies alone', async () => {
  const m = model([[/- card arrival\n- lost card/, 'card arrival'], [/- lost card\n- card arrival/, 'card arrival'], [/Question:/, 'Rollo']]);
  const call = caller(m.ask);
  const tasks = [T('classify', 'Which banking intent is this customer message?', { message: 'my card arrived' }), { id: 'q', kind: 'qa', request: 'Answer this question from our documents.', input: { question: 'Who founded the duchy of Normandy?' } }];
  for (const t of tasks) {
    const g = await gated(t, call, ctx), r = await raw(t, call, ctx);
    const g2 = await replay(t, g, ctx), r2 = await replay(t, r, ctx);
    assert.deepEqual(g2, g); assert.deepEqual(r2, r);
  }
  const lost = await replay(tasks[1], { arm: 'gated', calls: [{ text: 'William', ms: 9 }] }, ctx);
  assert.equal(lost.released, false); assert.equal(lost.calls[0].ms, 9);
  const short = await replay(tasks[0], { arm: 'gated', calls: [{ text: 'card arrival' }] }, ctx);
  assert.equal(short.released, false, 'a missing second reading is an empty reply'); assert.equal(short.calls[1].text, '');
  const junk = await replay(tasks[1], { calls: [{ text: 5, ms: 'x', cached: 'yes' }] }, ctx);
  assert.deepEqual([junk.arm, junk.calls[0].text, junk.calls[0].ms, junk.calls[0].cached, junk.calls[0].ttft], ['gated', '', 0, false, null]);
  const kept = await replay(tasks[1], { arm: 'gated', calls: [{ text: 'Rollo', ms: 1, ttft: 4, prompt: 30, cached: true }] }, ctx);
  assert.deepEqual([kept.calls[0].ttft, kept.calls[0].prompt, kept.calls[0].cached], [4, 30, true]);
  const none = await replay(tasks[1], null, ctx);
  assert.equal(none.released, false);
});
