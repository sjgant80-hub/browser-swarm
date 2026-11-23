// assembly.mjs — the swarm, decomposed. The conductor and each desk's lane check are the first build's, unchanged. What
// changes is the middle: a desk no longer asks the model for its whole answer in one reply. A plan, written as code,
// breaks the job into atoms (src/atoms.mjs); every atom goes through the estate's guard on its own (asked, then
// checked, and withheld if its check fails); and the verified atoms are assembled, by code, into the desk's answer,
// which then faces the desk's judge exactly as before. A wrong atom is withheld, so a chain with a weak step refuses:
// compounding error becomes compounding refusal, never a wrong answer assembled from bad parts.
// No model plans and no model assembles. The base model only answers atoms.
import { route } from '../vendor/route.mjs';
import { gated } from './swarm.mjs';
import { decide } from '../vendor/guard.mjs';
import { bestSentence, findSpan } from '../vendor/docdec-gate.mjs';
import S from './cells.mjs';
import { deptRank } from './cells.mjs';
import C from './checks.mjs';
import { ATOMS } from './atoms.mjs';
import { readDate, readPence } from './read.mjs';

const get = (o, k) => { try { return o[k]; } catch { return undefined; } };
const str = (x) => (typeof x === 'string' ? x : '');
const words = (label) => str(label).split('_').join(' ');
// how many candidates the label desks put to the yes/no atoms (chosen on the tuning pool; data/settings2.json)
// desks: which desks use their decomposed plan. A desk left out, or set to anything but 'atoms', keeps the first build's
// one-call form: a plan is adopted desk by desk, only where the tuning data showed it earns its place (SEAL3.md).
export const DEFAULTS = { topics: 3, departments: 2, totalLines: 4, desks: {} };
const ATOM_SEED = { boundary: { run: 'tab:atom:lane', escalate: 'the desk' }, act: { run: 'tab:atom:act', carries: [] }, judge: { run: 'tab:atom:judge' } };
const callRow = (c) => ({ ms: c.ms, ttft: c.ttft, prompt: c.prompt, cached: c.cached, text: c.text, ...(c.error ? { error: c.error } : {}) });

// one atom through the guard: the model is asked, the reply is read, the value is checked by code; only a verified value comes back
async function runAtom(name, args, call, trace, atom = ATOMS[name]) {
  const runs = { lane: { code: 0, out: JSON.stringify({ inLane: true }) } };
  const c = await call(atom.messages(args), atom.maxTokens);
  const p = atom.parse(c.text, args);
  let why = get(p, 'why') || '';
  if (get(p, 'value') !== undefined) {
    runs.act = { code: 0, out: JSON.stringify({ output: { value: p.value } }) };
    why = atom.check(p.value, args);
    runs.judge = { code: 0, out: JSON.stringify({ status: why ? 'unverified' : 'verified' }) };
  } else runs.act = { code: 1, out: JSON.stringify({ why }) };
  const d = decide(ATOM_SEED, runs, args);
  trace.calls.push(callRow(c));
  trace.atoms.push({ atom: name, said: c.text, value: get(p, 'value') ?? null, ok: d.released === true, why: d.released ? '' : why });
  return d.released === true ? { ok: true, value: p.value } : { ok: false, why: `${name}: ${why}` };
}

// agree(a, b) → the words two readings share, when they are the same words or one phrase sits whole inside the other; else ''
export function agree(a, b) {
  const x = C.norm(a), y = C.norm(b);
  if (x + y === '') return '';
  if (` ${x} `.includes(` ${y} `)) return str(b).trim();
  return ` ${y} `.includes(` ${x} `) ? str(a).trim() : '';
}
// the first build's own reader, asked as an atom: the same prompt over the whole paragraph, read the same way
const paragraphReading = (cell, input, lane, ctx) => ({
  maxTokens: cell.maxTokens,
  messages: () => cell.messages(input, lane, ctx),
  parse: (raw) => { const p = cell.parse([raw], input, lane); return get(p, 'output') !== undefined ? { value: p.output.answer } : { why: get(p, 'why') || '' }; },
  check: (v) => (findSpan(ctx.byId.get(get(lane, 'source')).text, v) ? '' : 'the phrase is not the paragraph\'s own words'),
});

// PLANS[desk](input, lane, ctx, atom, opts) → { output } assembled from verified atoms, or { why }
export const PLANS = {
  // two readings that must agree. The model reads the whole paragraph (the first build's reader, unchanged) and,
  // separately, only the ONE sentence that best matches the question (chosen by code). On tuning data the two readings
  // made different mistakes, so only the words both give are assembled; if they differ, or either finds nothing, the desk refuses
  async 'docs-answer'(input, lane, ctx, atom) {
    const doc = ctx.byId.get(get(lane, 'source')), question = str(get(input, 'question')).trim();
    const whole = await atom('phrase-from-paragraph', {}, paragraphReading(S.CELLS.find((c) => c.name === 'docs-answer'), input, lane, ctx));
    if (!whole.ok) return { why: whole.why };
    const one = await atom('phrase-from-sentence', { sentence: bestSentence(doc.text, question).text, question });
    if (!one.ok) return { why: one.why };
    const shared = agree(whole.value, one.value);
    return shared ? { output: { question: get(input, 'question'), answer: shared, source: lane.source } } : { why: 'the two readings disagree' };
  },
  // code finds the lines that say "total" and carry an amount; the reader copies the amount off each one line; if they
  // differ, one more atom picks the line that is the final total
  async 'receipt-total'(input, lane, ctx, atom, opts) {
    const amountish = (l) => (l.match(/\d[\d.,]*\d|\d/g) || []).some((x) => C.digits(x).length >= 3);
    const lines = str(get(input, 'receipt')).split('\n').filter((l) => /total/i.test(l) && !/sub\s*-?\s*total/i.test(l) && amountish(l)).slice(0, opts.totalLines);
    if (lines.length === 0) return { why: 'no total line carries an amount' };
    const read = [];
    for (const line of lines) { const a = await atom('amount-on-line', { line }); read.push(a.ok ? a.value : null); }
    const got = [...new Set(read.filter((v) => v !== null))];
    if (got.length === 0) return { why: 'no amount could be read off a total line' };
    if (got.length === 1) return { output: { value: got[0] } };
    const w = await atom('which-total', { lines });
    if (!w.ok) return { why: w.why };
    return read[w.value - 1] === null ? { why: 'the amount on the chosen line could not be read' } : { output: { value: read[w.value - 1] } };
  },
  // the word index proposes; yes/no atoms dispose: the first label must get a yes and the next ones a no
  async 'banking-intent'(input, lane, ctx, atom, opts) {
    const labels = Array.isArray(get(lane, 'labels')) ? lane.labels : [], message = str(get(input, 'message')).trim(), votes = [];
    for (const [i, label] of labels.slice(0, opts.topics).entries()) {
      const a = await atom('about-topic', { message, topic: words(label) });
      if (!a.ok) return { why: a.why };
      votes.push(a.value);
      if (a.value !== (i === 0 ? 'yes' : 'no')) return { why: i === 0 ? 'the reader said no to the word index\'s first label' : 'the reader said yes to more than one label' };
    }
    return votes.length ? { output: { message: get(input, 'message'), label: labels[0], labels, votes } } : { why: 'no label to ask about' };
  },
  async department(input, lane, ctx, atom, opts) {
    const message = str(get(input, 'message')).trim(), rank = deptRank(message, ctx).slice(0, opts.departments), votes = [];
    for (const [i, id] of rank.entries()) {
      const d = ctx.depts.find((x) => x.id === id);
      const a = await atom('about-department', { message, department: `${d.label} (for example: ${d.examples.join(', ')})` });
      if (!a.ok) return { why: a.why };
      votes.push(a.value);
      if (a.value !== (i === 0 ? 'yes' : 'no')) return { why: i === 0 ? 'the reader said no to the word index\'s first department' : 'the reader said yes to more than one department' };
    }
    return votes.length ? { output: { message: get(input, 'message'), domain: rank[0], votes } } : { why: 'no department to ask about' };
  },
  // no atom at all on these two desks: code reads the text exactly (read.mjs), and the reading then faces the first
  // build's check, which is separate code. A text in a form the reader does not know gets no answer.
  async 'iso-date'(input) {
    const iso = readDate(get(input, 'text'));
    return iso ? { output: { text: get(input, 'text'), iso } } : { why: 'the date is not written in a form the code reads without a guess' };
  },
  async pence(input) {
    const pence = readPence(get(input, 'text'));
    return pence === null ? { why: 'the amount is not written in a form the code reads without a guess' } : { output: { text: get(input, 'text'), pence } };
  },
  // no atom here either: every fact is already a field of the record, so the letter is assembled by code and no model is asked
  async 'refund-letter'(input) {
    const r = get(input, 'record') || {};
    return { output: { record: get(input, 'record'), letter: `Dear ${str(r.name)}, your refund of ${str(r.amount)} for order ${str(r.order)} (${str(r.item)}, bought on ${str(r.date)}) has been processed.` } };
  },
};

// the two label desks' judge for the decomposed form: the same two keys as before (the word index ranks it first; the
// model's reading agrees), where the model's reading is now the yes/no atoms: yes to this one, no to the others asked
export const JUDGES = {
  'banking-intent'(output) {
    const labels = Array.isArray(get(output, 'labels')) ? output.labels : [], votes = Array.isArray(get(output, 'votes')) ? output.votes : [];
    if (!labels.includes(get(output, 'label'))) return { status: 'unverified', why: 'the label is not on the shortlist' };
    if (labels[0] !== get(output, 'label')) return { status: 'unverified', why: 'the word index ranks another intent first' };
    return votes[0] === 'yes' && votes.slice(1).every((v) => v === 'no') ? { status: 'verified', ground: { text: output.label } } : { status: 'unverified', why: 'the yes/no atoms did not single this label out' };
  },
  department(output, input, ctx) {
    const votes = Array.isArray(get(output, 'votes')) ? output.votes : [];
    if (!(Array.isArray(get(ctx, 'depts')) ? ctx.depts : []).some((d) => d.id === get(output, 'domain'))) return { status: 'unverified', why: 'not one of the departments' };
    if (deptRank(get(input, 'message'), ctx)[0] !== get(output, 'domain')) return { status: 'unverified', why: 'the department word index ranks another department first' };
    return votes[0] === 'yes' && votes.slice(1).every((v) => v === 'no') ? { status: 'verified', ground: { text: output.domain } } : { status: 'unverified', why: 'the yes/no atoms did not single this department out' };
  },
};

// assemble(task, call, ctx, opts) → the decomposed swarm's record for one task (the same shape as the first build's,
// plus the atoms it asked and what each came to)
export async function assemble(task, call, ctx, opts) {
  const o = { ...DEFAULTS, ...(typeof opts === 'object' ? opts : {}) };
  const base = { id: get(task, 'id'), kind: get(task, 'kind'), arm: 'assembled' };
  const r = route(S.index(), { need: get(task, 'request') });
  if (r.status !== 'routed') return { ...base, cell: null, stage: 'conductor', status: 'refused', released: false, why: r.why, atoms: [], calls: [], ms: 0 };
  const cell = S.CELLS.find((c) => c.name === r.cell), seed = S.seedOf(cell), input = get(task, 'input');
  // a desk whose decomposed plan was not adopted answers as the first build does, in one call
  if (get(o.desks, cell.name) !== 'atoms') return { ...(await gated(task, call, ctx)), arm: 'assembled', plan: 'one call', atoms: [] };
  const lane = cell.lane_(input, ctx, true), runs = { lane: { code: 0, out: JSON.stringify(lane) } }, trace = { atoms: [], calls: [] };
  let made = null, judged = null;
  if (get(lane, 'inLane') === true) {
    made = await PLANS[cell.name](input, lane, ctx, (name, args, atom) => runAtom(name, args, call, trace, atom), o);
    runs.act = get(made, 'output') !== undefined ? { code: 0, out: JSON.stringify({ output: made.output }) } : { code: 1, out: JSON.stringify({ why: made.why }) };
    if (get(made, 'output') !== undefined) {
      judged = (JUDGES[cell.name] || ((out) => cell.judge(out, input, ctx, lane)))(made.output, input, ctx);
      runs.judge = { code: 0, out: JSON.stringify(judged) };
    }
  }
  const d = decide(seed, runs, input);
  return {
    ...base, cell: cell.name, plan: 'atoms', stage: d.stage === 'act' ? 'atom' : d.stage, status: d.status, released: d.released === true,
    ...(d.released ? { output: d.output, ground: get(judged, 'ground') || null } : { withheld: get(d, 'withheld') }),
    why: d.released ? '' : (judged && judged.why ? `${d.reason}: ${judged.why}` : d.stage === 'lane' ? `${d.reason}: ${get(lane, 'why') || ''}` : `a step did not pass, so nothing was assembled: ${get(made, 'why') || ''}`),
    atoms: trace.atoms, calls: trace.calls, ms: trace.calls.reduce((a, c) => a + c.ms, 0),
  };
}

// replay(task, rec, ctx, opts) → the same record decided again from its recorded replies, in the order they were asked
export async function replay(task, rec, ctx, opts) {
  const calls = Array.isArray(get(rec, 'calls')) ? rec.calls : [];
  let i = 0;
  const call = async () => { const c = calls[i++] || {}; return { text: typeof c.text === 'string' ? c.text : '', ms: Number(c.ms) || 0, ttft: c.ttft ?? null, prompt: c.prompt ?? null, cached: c.cached === true }; };
  return assemble(task, call, ctx, opts);
}

export default { DEFAULTS, PLANS, JUDGES, agree, assemble, replay };
