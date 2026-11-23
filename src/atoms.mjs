// atoms.mjs — the smallest steps. An atom is ONE narrow question to the base model, with its own check written as code.
// A desk no longer asks the model to do its whole job in one reply: it asks for atoms and assembles them (assembly.mjs).
// Pure and synchronous: each atom says what to ask (messages), how to read the reply (parse → { value } or { why }),
// and how to check the value against what it was given (check → '' when it holds, else the reason).
// Each atom shows the model a few worked examples as earlier turns of the conversation. The examples are invented
// here; none comes from a test split, a dev split or a tuning pool. (Measured in the browser venue while tuning: with
// no examples the 4-bit 1B echoed the prompt or guessed; with them as earlier turns it answers in the asked form.)
// There were five more atoms, for the parts of a date and of an amount. On the tuning tasks the model got them wrong
// too often (a date's three parts together on 25 of 40), and code can read those texts exactly, so they were removed:
// the date and pence desks are read by code (read.mjs) and ask no model.
import { parseReader, findSpan } from '../vendor/docdec-gate.mjs';
import C from './checks.mjs';

const str = (x) => (typeof x === 'string' ? x : '');
const first = (raw) => str(raw).split('\n')[0].trim();
const turns = (system, shots, query) => [{ role: 'system', content: system }, ...shots.flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]), { role: 'user', content: query }];
// yesNo(raw) → 'yes' | 'no' | null: the reply's first word, whatever its case or trailing punctuation
export const yesNo = (raw) => { const m = first(raw).toLowerCase().match(/^(yes|no)\b/); return m ? m[1] : null; };
// whole(raw) → the first whole number on the reply's first line, or null (so "5th" reads as 5 and "none" as nothing)
export const whole = (raw) => { const l = first(raw); if (/^none\b/i.test(l)) return null; const m = l.match(/\d+/); return m && Number.isSafeInteger(Number(m[0])) ? Number(m[0]) : null; };
// amountsOn(line) → the amounts printed on a line, as printed
export const amountsOn = (line) => str(line).match(/\d[\d.,]*\d|\d/g) || [];

const DEPT = {
  banking: 'banking (for example: freeze account, routing, pin change, bill due, pay bill, account blocked)',
  travel: 'travel (for example: plug type, travel notification, translate, flight status, international visa, timezone)',
  dining: 'kitchen and dining (for example: food last, confirm reservation, how busy, ingredients list, calories, nutrition info)',
};

export const ATOMS = {
  'phrase-from-sentence': {
    what: 'copies the answering phrase out of one sentence', maxTokens: 24,
    system: 'Reply with the shortest exact phrase from the sentence that answers the question. Copy it word for word. If the sentence does not answer the question, reply: none',
    shots: [
      ['Sentence: The bridge was finished in 1932 by a team of forty engineers.\nQuestion: When was the bridge finished?', '1932'],
      ['Sentence: Rivers carry silt from the hills down to the delta.\nQuestion: Who discovered the delta?', 'none'],
      ['Sentence: The museum, which opened in 1901, is run by the city council.\nQuestion: Who runs the museum?', 'the city council'],
      ['Sentence: Copper conducts heat about twenty times better than stainless steel.\nQuestion: What conducts heat better than stainless steel?', 'Copper'],
    ],
    messages(a) { return turns(this.system, this.shots, `Sentence: ${str(a.sentence)}\nQuestion: ${str(a.question)}`); },
    parse(raw) { const r = parseReader(str(raw).replace(/^\s*answer\s*:\s*/i, '')); return r.none ? { why: 'the sentence does not answer it' } : { value: r.phrase }; },
    check(v, a) { return findSpan(str(a.sentence), v) ? '' : 'the phrase is not the sentence\'s own words'; },
  },
  'amount-on-line': {
    what: 'copies the amount printed on one receipt line', maxTokens: 14,
    system: 'Reply with the amount of money on the receipt line, exactly as printed. The amount only.',
    shots: [['Line: TOTAL 45,000', '45,000'], ['Line: Total : 12.500', '12.500'], ['Line: GRAND TOTAL Rp 1,250,000', '1,250,000'], ['Line: TOTAL 3 ITEMS 87.000', '87.000'], ['Line: Total 9.90', '9.90']],
    messages(a) { return turns(this.system, this.shots, `Line: ${str(a.line)}`); },
    // the amount is read back in the line's own form: when the reply has the right digits in another format, the one
    // printed amount with those digits is the value (two printed amounts with the same digits would not be settled)
    parse(raw, a) {
      const v = C.firstAmount(raw);
      if (!v) return { why: 'no amount was read' };
      if (C.printed(str(a.line), v)) return { value: v };
      const same = [...new Set(amountsOn(a.line).filter((t) => C.digits(t) === C.digits(v)))];
      return { value: same.length === 1 ? same[0] : v };
    },
    check(v, a) { return C.printed(str(a.line), v) ? '' : 'that amount is not printed on the line'; },
  },
  'which-total': {
    what: 'picks the final total among a few receipt lines', maxTokens: 4,
    system: 'These lines are from one shop receipt. Reply with the number of the line that is the final total the customer paid. The number only.',
    shots: [['1. TOTAL ITEMS 3\n2. TOTAL 45,000', '2'], ['1. TOTAL 120,000\n2. TOTAL DISC -20,000\n3. GRAND TOTAL 100,000', '3'], ['1. Total 18.000\n2. Total Qty 2', '1']],
    messages(a) { return turns(this.system, this.shots, (Array.isArray(a.lines) ? a.lines : []).map((l, i) => `${i + 1}. ${l}`).join('\n')); },
    parse(raw) { const n = whole(raw); return n === null ? { why: 'no line number was read' } : { value: n }; },
    check(v, a) { return Number.isInteger(v) && v >= 1 && v <= (Array.isArray(a.lines) ? a.lines.length : 0) ? '' : 'there is no line with that number'; },
  },
  'about-topic': {
    what: 'says yes or no: is this message about this topic', maxTokens: 3,
    system: 'Is the customer message about this exact topic? Reply yes or no only.',
    shots: [
      ['Message: I lost my card yesterday.\nTopic: lost or stolen card', 'yes'], ['Message: I lost my card yesterday.\nTopic: exchange rate', 'no'],
      ['Message: How long does a transfer take to arrive?\nTopic: transfer timing', 'yes'], ['Message: How long does a transfer take to arrive?\nTopic: card payment fee charged', 'no'],
      ['Message: Why was I charged twice for one purchase?\nTopic: top up failed', 'no'], ['Message: Why was I charged twice for one purchase?\nTopic: transaction charged twice', 'yes'],
    ],
    messages(a) { return turns(this.system, this.shots, `Message: ${str(a.message)}\nTopic: ${str(a.topic)}`); },
    parse(raw) { const v = yesNo(raw); return v ? { value: v } : { why: 'neither yes nor no' }; },
    check() { return ''; },
  },
  'about-department': {
    what: 'says yes or no: does this message belong to this department', maxTokens: 3,
    system: 'Does the message belong to this department? Reply yes or no only.',
    shots: [
      [`Message: what is the balance of my savings account\nDepartment: ${DEPT.banking}`, 'yes'], [`Message: what is the balance of my savings account\nDepartment: ${DEPT.travel}`, 'no'],
      [`Message: is my flight to denver on time\nDepartment: ${DEPT.dining}`, 'no'], [`Message: is my flight to denver on time\nDepartment: ${DEPT.travel}`, 'yes'],
      [`Message: what colour is the sky on mars\nDepartment: ${DEPT.banking}`, 'no'], [`Message: how many calories are in a bagel\nDepartment: ${DEPT.dining}`, 'yes'],
    ],
    messages(a) { return turns(this.system, this.shots, `Message: ${str(a.message)}\nDepartment: ${str(a.department)}`); },
    parse(raw) { const v = yesNo(raw); return v ? { value: v } : { why: 'neither yes nor no' }; },
    check() { return ''; },
  },
};

export default { ATOMS, yesNo, whole, amountsOn };
