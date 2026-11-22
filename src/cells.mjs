// cells.mjs — the swarm's specialists. One base model, many cells: a cell is not a second model, it is a CARD the base
// model is run under. Each card has the four parts the estate's guard needs (vendor/guard.mjs):
//   lane     know-boundary BEFORE the call: does this input belong to me? (out of lane → refused, the model never runs)
//   messages what the base model is asked, built only from the input (and what the lane check retrieved)
//   parse    the model's reply → the cell's output, or the cell's own refusal ("none")
//   judge    verify AFTER: a check that never asks a model. Only "verified" is released; the rest is withheld.
// Pure and synchronous: the orchestrator (src/swarm.mjs) makes the model calls. Cards share nothing but the base model.
import { tokens, idf, route as rank } from '../vendor/docdec-kernel.mjs';
import { parseReader, findSpan, sentenceAround, bestSentence } from '../vendor/docdec-gate.mjs';
import { sha256 } from './sha256.mjs';
import C from './checks.mjs';

const str = (x) => (typeof x === 'string' ? x : '');
const get = (o, k) => { try { return o[k]; } catch { return undefined; } };   // null or undefined → undefined
const obj = (x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x : {});
const yes = (extra) => ({ inLane: true, ...extra });
const no = (why) => ({ inLane: false, status: 'refused', why, escalate: 'kar' });
const sys = (content) => ({ role: 'system', content });
const user = (content) => ({ role: 'user', content });

// the settings the dev split chose (data/settings.json, frozen at seal 2); these are the fallbacks for tests
export const DEFAULTS = { qa: { minScore: 8, minCoverage: 0.3, requireFocus: false, twin: 0.6, minCover: 0.3 }, shortlist: 5 };

// prepare(corpus, bankingIndex, departments, settings) → the context every cell reads: the signed corpus with its terms
// and idf, the banking shortlist index, the departments. Anything malformed becomes empty, never a throw.
export function prepare(corpus, bankingIndex, departments, settings) {
  const paras = Array.isArray(get(corpus, 'paragraphs')) ? corpus.paragraphs.filter((p) => typeof get(p, 'id') === 'string' && typeof get(p, 'text') === 'string') : [];
  const docs = paras.map((p) => ({ id: p.id, text: p.text, terms: tokens(p.text) }));
  const manifest = new Map(paras.map((p) => [p.id, str(p.sha256)]));
  const intents = (Array.isArray(get(bankingIndex, 'intents')) ? bankingIndex.intents : []).filter((i) => typeof get(i, 'intent') === 'string')
    .map((i) => ({ intent: i.intent, terms: obj(get(i, 'terms')) }));
  const depts = (Array.isArray(get(departments, 'departments')) ? departments.departments : []).filter((d) => typeof get(d, 'id') === 'string')
    .map((d) => ({ id: d.id, label: str(get(d, 'label')) || d.id, examples: Array.isArray(get(d, 'examples')) ? d.examples.filter((e) => typeof e === 'string') : [], terms: obj(get(d, 'terms')) }));
  const s = obj(settings);
  return { docs, byId: new Map(docs.map((d) => [d.id, d])), idf: idf(docs), manifest, intents, depts, qa: { ...DEFAULTS.qa, ...obj(get(s, 'qa')) }, shortlistK: Number.isInteger(get(s, 'shortlist')) ? s.shortlist : DEFAULTS.shortlist };
}

// signed(doc, ctx) → the document's text still hashes to what the corpus manifest signed for its id
export const signed = (doc, ctx) => !!doc && sha256(doc.text) === get(ctx, 'manifest').get(doc.id);

// retrieve(question, ctx, gated) → { doc } | { why }. Gated: DocDec's grounded router with the frozen bar, then the
// signature check, then the twin check (two near-identical sources that differ: one may be a poisoned copy). Not gated
// (the plain pipeline the raw arm uses): the best-scoring document, whatever its score.
export function retrieve(question, ctx, gated) {
  const docs = Array.isArray(get(ctx, 'docs')) ? ctx.docs : [];
  if (docs.length === 0) return { why: 'not in your documents: there are none' };
  const q = tokens(question);
  if (!gated) {
    const best = docs.map((d) => ({ d, s: q.filter((t) => d.terms.includes(t)).reduce((a, t) => a + (ctx.idf.get(t) || 0), 0) }))
      .sort((a, b) => b.s - a.s || a.d.id.localeCompare(b.d.id, 'en'))[0];
    return { doc: best.d };
  }
  const r = rank(q, docs, ctx.idf, { minScore: ctx.qa.minScore, minCoverage: ctx.qa.minCoverage, requireFocus: ctx.qa.requireFocus });
  if (r.abstain) return { why: r.why };
  const doc = ctx.byId.get(r.answer);
  if (!signed(doc, ctx)) return { why: 'the source does not match the signed corpus' };
  const twin = docs.find((d) => d.id !== doc.id && d.text !== doc.text && C.jaccard(d.terms, doc.terms) >= ctx.qa.twin);
  if (twin) return { why: `two sources nearly match and say different things (${doc.id}, ${twin.id})` };
  return { doc };
}

// the banking shortlist: each intent scored by the summed weights of the message's words; the top k with a score above 0
export function shortlist(message, ctx, k, always) {
  const ws = [...new Set((str(message).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 2))];
  const scored = (Array.isArray(get(ctx, 'intents')) ? ctx.intents : []).map((i) => ({ intent: i.intent, s: ws.reduce((a, w) => a + (Number(i.terms[w]) || 0), 0) }))
    .filter((x) => always === true || x.s > 0).sort((a, b) => b.s - a.s || a.intent.localeCompare(b.intent, 'en'));
  return scored.slice(0, Number.isInteger(k) && k > 0 ? k : 5).map((x) => x.intent);
}

// deptRank(message, ctx) → the department ids, best first, by the summed weights of the message's words (CLINC150 train)
export function deptRank(message, ctx) {
  const ws = [...new Set((str(message).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 2))];
  return (Array.isArray(get(ctx, 'depts')) ? ctx.depts : []).map((d) => ({ id: d.id, s: ws.reduce((a, w) => a + (Number(d.terms[w]) || 0), 0) }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id, 'en')).map((x) => x.id);
}

const listOf = (labels) => labels.map((l) => `- ${l.split('_').join(' ')}`).join('\n');

export const CELLS = [
  {
    name: 'docs-answer', lane: { id: 'answer-from-documents', accepts: 'answer a question from our documents' }, maxTokens: 24, passes: 1, carries: ['question'],
    purpose: 'answers a question with the shortest phrase copied from the one signed source that holds it, or refuses',
    system: 'You answer questions using only the passage given. Reply with the shortest exact phrase copied from the passage that answers the question. If the passage does not answer it, reply: none',
    lane_(input, ctx, gated = true) {
      const q = str(get(input, 'question')).trim();
      if (q === '') return no('no question was given');
      const r = retrieve(q, ctx, gated);
      return r.doc ? yes({ source: r.doc.id }) : no(r.why);
    },
    messages(input, lane, ctx) {
      const doc = ctx.byId.get(get(lane, 'source'));
      return [sys(this.system), user(`Passage:\n${doc ? doc.text : ''}\n\nQuestion: ${str(get(input, 'question')).trim()}\nAnswer:`)];
    },
    parse(raws, input, lane) {
      const r = parseReader(raws[0]);
      return r.none ? { why: 'the reader found no answer in the source' } : { output: { question: get(input, 'question'), answer: r.phrase, source: get(lane, 'source') } };
    },
    judge(output, input, ctx) {
      const doc = ctx.byId.get(get(output, 'source'));
      if (!signed(doc, ctx)) return { status: 'refused', why: 'the source does not match the signed corpus' };
      const span = findSpan(doc.text, get(output, 'answer'));
      if (!span) return { status: 'unverified', why: "the answer is not the source's own words" };
      const sent = sentenceAround(doc.text, span.start, span.end) || { text: '' };
      if (C.isInstruction(sent.text)) return { status: 'unverified', why: 'the answer sits in a sentence that gives orders, which is not evidence' };
      const kind = C.answerKind(get(input, 'question'), span.text);
      if (kind) return { status: 'unverified', why: kind };
      // the second key, chosen by code and not by the model: the answer must sit in the sentence that best matches the
      // question (DocDec's own sentence chooser), and that sentence must carry enough of the question's words
      const best = bestSentence(doc.text, get(input, 'question'));
      if (span.start < best.start || span.end > best.end) return { status: 'unverified', why: 'the answer is not in the sentence that best matches the question' };
      const q = tokens(get(input, 'question')), own = new Set(tokens(span.text)), st = new Set(tokens(sent.text));
      const shared = q.filter((t) => st.has(t) && !own.has(t)).length;
      if (q.length === 0 || shared / q.length < ctx.qa.minCover) return { status: 'unverified', why: "the answer's sentence carries too few of the question's words" };
      return { status: 'verified', ground: { source: doc.id, start: span.start, end: span.end, text: span.text } };
    },
  },
  {
    name: 'receipt-total', lane: { id: 'receipt-total', accepts: 'pull the total amount from a shop receipt' }, maxTokens: 16, passes: 1, carries: [],
    purpose: 'reads the grand total printed on a receipt, checked against the receipt itself',
    system: 'You read shop receipts. Reply with the grand total amount exactly as printed on the receipt, digits and separators only. If there is no total, reply: none',
    lane_(input) {
      const r = str(get(input, 'receipt'));
      if (r.split('\n').filter((l) => l.trim()).length < 2) return no('this is not a receipt: fewer than two lines');
      return /total/i.test(r) ? yes() : no('the receipt prints no total');
    },
    messages(input) { return [sys(this.system), user(`Receipt:\n${str(get(input, 'receipt'))}\n\nGrand total:`)]; },
    parse(raws) { const v = C.firstAmount(raws[0]); return v ? { output: { value: v } } : { why: 'the reader found no total' }; },
    judge(output, input) {
      const why = C.totalOnReceipt(get(input, 'receipt'), get(output, 'value'));
      return why ? { status: 'unverified', why } : { status: 'verified', ground: { text: get(output, 'value') } };
    },
  },
  {
    name: 'banking-intent', lane: { id: 'banking-intent', accepts: 'the banking intent of a customer message' }, maxTokens: 12, passes: 2, carries: ['message'],
    purpose: 'names the banking intent of a customer message from a shortlist, only when two readings agree and the word index ranks it first',
    system: 'You sort banking customer messages. Choose the one label from the list that fits the message. Reply with the label only, or none if no label fits.',
    lane_(input, ctx, gated = true) {
      const m = str(get(input, 'message')).trim();
      if (m === '' || m.length > 400) return no('not a customer message');
      const list = shortlist(m, ctx, ctx.shortlistK, !gated);
      return list.length ? yes({ labels: list }) : no('no banking intent shares a word with this message');
    },
    messages(input, lane, ctx, pass) {
      const labels = Array.isArray(get(lane, 'labels')) ? lane.labels.slice() : [];
      return [sys(this.system), user(`Message: ${str(get(input, 'message')).trim()}\nLabels:\n${listOf(pass === 1 ? labels.reverse() : labels)}\nLabel:`)];
    },
    parse(raws, input, lane) {
      const labels = Array.isArray(get(lane, 'labels')) ? lane.labels : [];
      const a = C.pickLabel(raws[0], labels), b = C.pickLabel(raws[1], labels);   // no second reading → null
      return a ? { output: { message: get(input, 'message'), label: a, second: b, labels } } : { why: 'the reader chose no label' };
    },
    judge(output) {
      const labels = Array.isArray(get(output, 'labels')) ? output.labels : [];
      if (!labels.includes(get(output, 'label'))) return { status: 'unverified', why: 'the label is not on the shortlist' };
      if (get(output, 'second') !== get(output, 'label')) return { status: 'unverified', why: 'two readings, with the list in opposite orders, disagree' };
      return labels[0] === get(output, 'label') ? { status: 'verified', ground: { text: get(output, 'label') } } : { status: 'unverified', why: 'the word index ranks another intent first' };
    },
  },
  {
    name: 'department', lane: { id: 'department', accepts: 'which department should handle a customer message' }, maxTokens: 8, passes: 1, carries: ['message'],
    purpose: 'routes a message to one of ten departments when the model and the department word index agree, or says none of them',
    system: 'You route customer messages to a department. Choose one department from the list. Reply with the department name only, or none if no department fits.',
    lane_(input) {
      const m = str(get(input, 'message')).trim();
      return m === '' || m.length > 400 ? no('not a customer message') : yes();
    },
    messages(input, lane, ctx) {
      const d = Array.isArray(get(ctx, 'depts')) ? ctx.depts : [];
      const lines = d.map((x) => `- ${x.label} (${x.examples.join(', ')})`).join('\n');
      return [sys(this.system), user(`Message: ${str(get(input, 'message')).trim()}\nDepartments:\n${lines}\nDepartment:`)];
    },
    parse(raws, input, lane, ctx) {
      const labels = (Array.isArray(get(ctx, 'depts')) ? ctx.depts : []).map((d) => d.label);
      const a = C.pickLabel(raws[0], labels);
      return a ? { output: { message: get(input, 'message'), domain: ctx.depts.find((d) => d.label === a).id } } : { why: 'no department fits' };
    },
    judge(output, input, ctx) {
      if (!(Array.isArray(get(ctx, 'depts')) ? ctx.depts : []).some((d) => d.id === get(output, 'domain'))) return { status: 'unverified', why: 'not one of the departments' };
      return deptRank(get(input, 'message'), ctx)[0] === get(output, 'domain') ? { status: 'verified', ground: { text: get(output, 'domain') } } : { status: 'unverified', why: 'the department word index ranks another department first' };
    },
  },
  {
    name: 'iso-date', lane: { id: 'iso-date', accepts: 'convert a date to iso format' }, maxTokens: 16, passes: 1, carries: ['text'],
    purpose: 'writes a date as YYYY-MM-DD, checked by reading it back against the words it came from',
    system: 'You convert dates to ISO 8601 (YYYY-MM-DD). Reply with the date only. If there is no date, reply: none',
    lane_(input) { return /\b(1[0-9]|20)\d{2}\b/.test(str(get(input, 'text'))) ? yes() : no('there is no four-digit year to convert'); },
    messages(input) { return [sys(this.system), user(`Text: ${str(get(input, 'text'))}\nISO date:`)]; },
    parse(raws, input) { const iso = C.isoDate(raws[0]); return iso ? { output: { text: get(input, 'text'), iso } } : { why: 'the reader wrote no real date' }; },
    judge(output, input) { const why = C.dateInText(get(output, 'iso'), get(input, 'text')); return why ? { status: 'unverified', why } : { status: 'verified', ground: { text: get(output, 'iso') } }; },
  },
  {
    name: 'pence', lane: { id: 'pence', accepts: 'convert a money amount to pence' }, maxTokens: 12, passes: 1, carries: ['text'],
    purpose: 'turns an amount in pounds into whole pence, checked by reading it back against the amount as written',
    system: 'You convert money amounts in pounds to a whole number of pence. Reply with the number only. If there is no amount, reply: none',
    lane_(input) { const t = str(get(input, 'text')); return /\d/.test(t) && /£|gbp|pound|pence|\dp\b/i.test(t) ? yes() : no('there is no amount in pounds or pence'); },
    messages(input) { return [sys(this.system), user(`Amount: ${str(get(input, 'text'))}\nPence:`)]; },
    parse(raws, input) { const p = C.firstInteger(raws[0]); return p === null ? { why: 'the reader wrote no number' } : { output: { text: get(input, 'text'), pence: p } }; },
    judge(output, input) { const why = C.penceInText(get(output, 'pence'), get(input, 'text')); return why ? { status: 'unverified', why } : { status: 'verified', ground: { text: String(get(output, 'pence')) } }; },
  },
  {
    name: 'refund-letter', lane: { id: 'refund-letter', accepts: 'draft a refund confirmation from a customer record' }, maxTokens: 120, passes: 1, carries: ['record'],
    purpose: 'drafts a short refund confirmation that states every fact of the record word for word and adds none',
    system: 'You fill in a refund confirmation template from a customer record. Copy each fact exactly as the record gives it and add nothing else. The template is: Dear <name>, your refund of <amount> for order <order> (<item>, bought on <date>) has been processed.',
    lane_(input) {
      const r = get(input, 'record');
      return ['name', 'order', 'item', 'amount', 'date'].every((k) => str(get(r, k)).trim() !== '') ? yes() : no('the record is missing a fact');
    },
    messages(input) {
      const r = obj(get(input, 'record'));
      return [sys(this.system), user(`Record:\nname: ${str(r.name)}\norder: ${str(r.order)}\nitem: ${str(r.item)}\namount: ${str(r.amount)}\ndate: ${str(r.date)}\n\nLetter:`)];
    },
    parse(raws, input) { const l = str(raws[0]).trim().slice(0, 1200); return l ? { output: { record: get(input, 'record'), letter: l } } : { why: 'the reader wrote nothing' }; },
    judge(output) { const why = C.letterFacts(get(output, 'letter'), get(output, 'record')); return why ? { status: 'unverified', why } : { status: 'verified', ground: { text: 'every fact of the record' } }; },
  },
];

// the plain multiple-choice prompt the raw arms get for the two families no cell owns (the swarm has no such cell)
export const MCQ = {
  name: 'multiple-choice', maxTokens: 6, system: 'Answer the multiple-choice question. Reply with the letter of the correct option only.',
  messages(input) {
    const o = obj(get(input, 'options'));
    return [sys(this.system), user(`Question: ${str(get(input, 'question')).trim()}\nA. ${str(o.A)}\nB. ${str(o.B)}\nC. ${str(o.C)}\nD. ${str(o.D)}\nAnswer:`)];
  },
  parse(raws, input) { const l = C.mcqLetter(raws[0], get(input, 'options')); return l ? { output: { letter: l } } : { why: 'no letter' }; },
};

// which cell a task kind is meant for (the raw arms are handed the right cell; the swarm finds it through its conductor)
export const FOR_KIND = { qa: 'docs-answer', extract: 'receipt-total', classify: 'banking-intent', route: 'department', date: 'iso-date', pence: 'pence', draft: 'refund-letter' };

// index() → the cells as the estate genome's conductor reads them (vendor/route.mjs): admitted cells with their lanes
export const index = () => ({ cells: CELLS.map((c) => ({ name: c.name, verdict: 'cell', lane: { id: c.lane.id, accepts: c.lane.accepts }, purpose: c.purpose, escalate: 'kar' })) });

// seedOf(cell) → the cell's part of a seed.json, as the guard reads it: it declares a lane check, an act and a judge
export const seedOf = (cell) => ({ name: cell.name, boundary: { run: `tab:${cell.name}:lane`, escalate: 'kar' }, act: { run: `tab:${cell.name}:act`, carries: cell.carries }, judge: { run: `tab:${cell.name}:judge` } });

export default { DEFAULTS, prepare, signed, retrieve, shortlist, deptRank, CELLS, MCQ, FOR_KIND, index, seedOf };
