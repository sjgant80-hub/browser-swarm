// diagnose.mjs — why a task was not answered. The guard's own record of a call (which stage stopped it, and what it
// withheld) is read beside the task's right answer and the same model's unchecked reply, and each non-answer gets one
// cause. Pure and total. It decides what kind of fix is worth building:
//   a  correct refusal    nothing was right to say (an unanswerable or off-corpus question, an out-of-scope message), or
//                         a trap: a hard open question no desk owns. Refusing these is the designed behaviour.
//   b  too weak           the swarm had no right answer to release: the model declined, or wrote a wrong answer the
//                         check rightly withheld, or a small step it was asked failed its check, or the lane (or a
//                         decomposed desk's plan) refused and the model alone was wrong too.
//   c  gate too strict    a RIGHT answer was withheld by the check, or the lane (or a plan) refused a job the model
//                         alone got right.
// Smaller steps can fix b. They cannot fix c (only recalibrating the gate can), and a must not be "fixed" at all.
import { right, shouldRefuse, HARD } from './score.mjs';

const get = (o, k) => { try { return o[k]; } catch { return undefined; } };
const str = (x) => (typeof x === 'string' ? x : '');
export const CAUSES = ['answered right', 'answered wrong', 'correct refusal', 'trap', 'too weak', 'gate too strict'];
const last = (why) => str(why).split(': ').slice(-1)[0];

// cause(task, gated, raw) → { cause, detail }: gated is the swarm's record for the task, raw the same model's unchecked record
export function cause(task, gated, raw) {
  if (get(gated, 'released') === true) return right(task, get(gated, 'output')) ? { cause: 'answered right', detail: '' } : { cause: 'answered wrong', detail: 'released, and wrong: a silent failure' };
  if (HARD.includes(get(task, 'kind'))) return { cause: 'trap', detail: 'a hard open question no desk owns' };
  if (shouldRefuse(task)) return { cause: 'correct refusal', detail: 'nothing was right to say' };
  const stage = get(gated, 'stage');
  if (stage === 'judge') {
    return right(task, get(gated, 'withheld')) ? { cause: 'gate too strict', detail: `a right answer withheld: ${last(get(gated, 'why'))}` } : { cause: 'too weak', detail: 'a wrong answer, rightly withheld' };
  }
  if (stage === 'act') return { cause: 'too weak', detail: 'the model declined, or wrote nothing usable' };
  const aloneRight = get(raw, 'released') === true && right(task, get(raw, 'output'));
  if (stage === 'atom') {
    // a decomposed desk: a small step the model was asked failed its check, or the plan's code found nothing to ask about
    if ((Array.isArray(get(gated, 'atoms')) ? gated.atoms : []).some((a) => get(a, 'ok') === false)) return { cause: 'too weak', detail: 'a small step the model was asked did not pass its check' };
    return aloneRight ? { cause: 'gate too strict', detail: 'the plan found no part to ask about, on a job the model alone got right' } : { cause: 'too weak', detail: 'the plan found no part to ask about, and the model alone was wrong too' };
  }
  if (aloneRight) return { cause: 'gate too strict', detail: stage === 'lane' ? 'the lane refused a job the model alone got right' : 'no desk took a job the model alone got right' };
  return { cause: 'too weak', detail: stage === 'lane' ? 'the lane refused, and the model alone was wrong too' : 'no desk took it, and the model alone was wrong too' };
}

// summary(tasks, gatedRecs, rawRecs) → the split: counts by cause, by kind and by detail, the three buckets over the
// non-answers, usefulness re-scored over the answerable tasks only, and which bucket is the largest
export function summary(tasks, gatedRecs, rawRecs) {
  const G = new Map((Array.isArray(gatedRecs) ? gatedRecs : []).map((r) => [get(r, 'id'), r]));
  const R = new Map((Array.isArray(rawRecs) ? rawRecs : []).map((r) => [get(r, 'id'), r]));
  const by = Object.fromEntries(CAUSES.map((c) => [c, 0])), byKind = {}, details = {};
  let answerable = 0, answerableRight = 0;
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const c = cause(t, G.get(get(t, 'id')), R.get(get(t, 'id')));
    by[c.cause]++;
    const k = byKind[t.kind] || (byKind[t.kind] = Object.fromEntries(CAUSES.map((x) => [x, 0])));
    k[c.cause]++;
    if (c.cause === 'too weak' || c.cause === 'gate too strict') { const d = `${c.cause}: ${c.detail}`; details[d] = (details[d] || 0) + 1; }
    if (!HARD.includes(t.kind) && !shouldRefuse(t)) { answerable++; if (c.cause === 'answered right') answerableRight++; }
  }
  const a = by['correct refusal'] + by.trap, b = by['too weak'], c = by['gate too strict'];
  const largest = b >= a && b >= c ? 'b' : c >= a ? 'c' : 'a';
  return { by, byKind, details, notAnswered: a + b + c, a, b, c, largest, answerable, answerableRight, answerableRate: answerable > 0 ? answerableRight / answerable : null };
}

export default { CAUSES, cause, summary };
