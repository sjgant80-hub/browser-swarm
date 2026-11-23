// claims3.mjs — the follow-up claim (CLAIMS-3.md): the decomposed build with the banking desk back to one call, judged
// on the fresh 410 only. Pure and total. The bars are CLAIMS-3.md's, word for word in BARS; test/claims3.test.mjs
// checks the file still says each one. A claim whose evidence is missing is pending (pass: null).
import { HALFWAY } from './claims2.mjs';

const get = (o, k) => { try { return o[k]; } catch { return undefined; } };
const pct = (x) => `${(x * 100).toFixed(1)}%`;
export const BARS = {
  E1: 'at most 5 silent failures on the fresh 410',
  E2: 'at least 47.2% of the 330 bounded tasks of the fresh 410 right',
};
// sourceOf(task) → which registered run holds the follow-up build's model calls for a task: the first build's for a
// banking message (that desk is back to one call), the decomposed build's for everything else
export const sourceOf = (task) => (get(task, 'kind') === 'classify' ? 'first' : 'decomposed');

// evaluate(m) → [{ id, pass, result }]: m is the metrics() result of the follow-up build's record on the fresh 410
export function evaluate(m) {
  const all = get(m, 'all'), bounded = get(m, 'bounded');
  const s = get(all, 'silent'), a = get(bounded, 'accuracy');
  if (!Number.isInteger(s) || !Number.isFinite(a)) return Object.keys(BARS).map((id) => ({ id, pass: null, result: 'pending: needs both registered runs on the fresh 410' }));
  return [
    { id: 'E1', pass: s <= 5, result: `${s} silent failures of ${all.tasks} (${pct(s / all.tasks)})` },
    { id: 'E2', pass: a >= HALFWAY, result: `${pct(a)} of the ${bounded.tasks} bounded tasks right (${bounded.correct})` },
  ];
}
// holds(verdicts) → true when every claim passed, false when one failed, null while any is pending
export function holds(verdicts) {
  const v = Array.isArray(verdicts) ? verdicts : [];
  if (v.length === 0 || v.some((x) => get(x, 'pass') === null)) return null;
  return v.every((x) => get(x, 'pass') === true);
}

export default { BARS, sourceOf, evaluate, holds };
