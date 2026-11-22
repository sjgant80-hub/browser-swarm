// score.mjs — what each arm's answer was worth, by rules written before the test split was read (CLAIMS.md). Pure.
//   outcome(task, rec)  → { released, correct, silent, missed }
//     correct  the task's right outcome: the right answer released, or, where nothing is right to say, nothing released
//     silent   a SILENT FAILURE: something released as if correct that is not right (the headline number)
//     missed   a right answer existed and nothing was released (an honest refusal: it costs accuracy, never trust)
//   grounded(task, rec, ctx) → true / false for a released fact the source can be checked against; null for a label
//   metrics(tasks, recs, opts) → the six numbers for one arm, overall and per kind
import { findSpan, f1, em } from '../vendor/docdec-gate.mjs';
import { mcnemar, median } from '../vendor/stats.mjs';
import C from './checks.mjs';

const get = (o, k) => { try { return o[k]; } catch { return undefined; } };   // null or undefined → undefined
const str = (x) => (typeof x === 'string' ? x : '');
export const BOUNDED = ['qa', 'extract', 'classify', 'route', 'date', 'pence', 'draft'];
export const HARD = ['knowledge', 'reasoning'];
export const FACT_KINDS = ['qa', 'extract', 'date', 'pence', 'draft', 'knowledge', 'reasoning'];

// right(task, output) → the released output is the right answer for the task
export function right(task, output) {
  const k = get(task, 'kind'), g = get(task, 'gold') || {}, o = output || {};
  if (k === 'qa') return g.impossible !== true && f1(str(get(o, 'answer')), [str(g.answer)]) >= 0.5;
  if (k === 'extract') return C.digits(get(o, 'value')) !== '' && C.digits(get(o, 'value')) === C.digits(g.total);
  if (k === 'classify') return get(o, 'label') === g.intent;
  if (k === 'route') return g.domain !== null && get(o, 'domain') === g.domain;
  if (k === 'date') return get(o, 'iso') === g.iso;
  if (k === 'pence') return get(o, 'pence') === g.pence;
  if (k === 'draft') {
    const l = str(get(o, 'letter'));
    return C.letterFacts(l, g.record) === '' && (l.match(/\S+/g) || []).slice(0, 12).join(' ').includes(str(get(g.record, 'name')));
  }
  if (k === 'knowledge' || k === 'reasoning') {
    if (typeof get(o, 'letter') === 'string') return o.letter === g.letter;
    const opt = get(get(get(task, 'input'), 'options'), g.letter);   // a span released through the document cell
    return typeof opt === 'string' && em(str(get(o, 'answer')), [opt]) === 1;
  }
  return false;
}

// shouldRefuse(task) → nothing is right to release (an unanswerable or off-corpus question, an out-of-scope message)
export const shouldRefuse = (task) => (get(task, 'kind') === 'qa' && get(get(task, 'gold'), 'impossible') === true) || (get(task, 'kind') === 'route' && get(get(task, 'gold'), 'domain') === null);

export function outcome(task, rec) {
  const released = get(rec, 'released') === true;
  const ok = released && right(task, get(rec, 'output'));
  const correct = shouldRefuse(task) ? !released : ok;
  return { released, correct, silent: released && !ok, missed: !released && !shouldRefuse(task) };
}

// grounded(task, rec, ctx) → can the released answer be traced to its source by a check anyone can run? Labels (intent,
// department) are not facts from a source, so they are left out (null). A multiple-choice letter has no source: false.
export function grounded(task, rec, ctx) {
  if (get(rec, 'released') !== true) return null;
  const k = get(task, 'kind'), o = get(rec, 'output') || {}, input = get(task, 'input') || {};
  if (k === 'classify' || k === 'route') return null;
  if (HARD.includes(k) && typeof get(o, 'letter') === 'string') return false;   // a multiple-choice letter (a draft's letter is a letter to a customer)
  if (typeof get(o, 'answer') === 'string') { const doc = get(ctx, 'byId') && ctx.byId.get(get(o, 'source')); return !!doc && findSpan(doc.text, o.answer) !== null; }
  if (k === 'extract') return C.printed(input.receipt, get(o, 'value'));
  if (k === 'date') return C.dateInText(get(o, 'iso'), input.text) === '';
  if (k === 'pence') return C.penceInText(get(o, 'pence'), input.text) === '';
  if (k === 'draft') return C.letterFacts(get(o, 'letter'), input.record) === '';
  return false;
}

const rate = (n, d) => (d > 0 ? n / d : null);

// tally(rows) → the counts and rates for a set of { outcome, ground, ms } rows
function tally(rows) {
  const n = rows.length, rel = rows.filter((r) => r.o.released);
  const g = rows.filter((r) => r.g !== null);
  return {
    tasks: n, released: rel.length, correct: rows.filter((r) => r.o.correct).length, silent: rows.filter((r) => r.o.silent).length,
    missed: rows.filter((r) => r.o.missed).length, accuracy: rate(rows.filter((r) => r.o.correct).length, n), coverage: rate(rel.length, n),
    silentRate: rate(rows.filter((r) => r.o.silent).length, n), silentAmongReleased: rate(rows.filter((r) => r.o.silent).length, rel.length),
    groundedRate: rate(g.filter((r) => r.g === true).length, g.length), groundedOf: g.length, medianMs: median(rows.map((r) => r.ms)),
  };
}

// metrics(tasks, recs, opts) → { all, bounded, hard, byKind, rows }. opts: { ctx, costUsd, leftDevice, venue, model, arm }
export function metrics(tasks, recs, opts) {
  const o = opts || {};
  const byId = new Map((Array.isArray(recs) ? recs : []).map((r) => [get(r, 'id'), r]));
  const rows = (Array.isArray(tasks) ? tasks : []).map((t) => {
    const r = byId.get(get(t, 'id')) || { released: false, ms: 0 };
    return { id: t.id, kind: t.kind, o: outcome(t, r), g: grounded(t, r, o.ctx), ms: Number(get(r, 'ms')) || 0 };
  });
  const kinds = [...BOUNDED, ...HARD];
  return {
    arm: o.arm || null, venue: o.venue || null, model: o.model || null, costUsd: typeof o.costUsd === 'number' ? o.costUsd : 0, leftDevice: o.leftDevice === true,
    all: tally(rows), bounded: tally(rows.filter((r) => BOUNDED.includes(r.kind))), hard: tally(rows.filter((r) => HARD.includes(r.kind))),
    byKind: Object.fromEntries(kinds.map((k) => [k, tally(rows.filter((r) => r.kind === k))]).filter(([, v]) => v.tasks > 0)),
    rows: rows.map((r) => ({ id: r.id, kind: r.kind, released: r.o.released, correct: r.o.correct, silent: r.o.silent, grounded: r.g })),
  };
}

// pairedSilent(a, b) → exact McNemar on the per-task silent-failure indicator: b = tasks where arm A failed silently and
// arm B did not, c = the reverse. A lower silent rate for A is shown when c > b and p < alpha.
export function pairedSilent(ma, mb) {
  const A = new Map((get(ma, 'rows') || []).map((r) => [r.id, r.silent])), B = (get(mb, 'rows') || []);
  let b = 0, c = 0;
  for (const r of B) { if (!A.has(r.id)) continue; if (A.get(r.id) && !r.silent) b++; if (!A.get(r.id) && r.silent) c++; }
  return { aOnly: b, bOnly: c, p: mcnemar(b, c) };
}

export default { BOUNDED, HARD, FACT_KINDS, right, shouldRefuse, outcome, grounded, metrics, pairedSilent };
