// claims2.mjs — the verdict on every claim about the decomposition fix (CLAIMS-2.md), computed from the recorded runs.
// Pure and total. The bars are CLAIMS-2.md's, word for word in BARS; test/claims2.test.mjs checks the file still says
// each one. A claim whose evidence is missing is pending (pass: null), never passed or failed by default.
import { mcnemar } from '../vendor/stats.mjs';

const get = (o, k) => { try { return o[k]; } catch { return undefined; } };
const num = (x) => (Number.isFinite(x) ? x : null);
const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
export const REAL = ['qa', 'extract', 'classify', 'route'];
export const BOUNDED = ['qa', 'extract', 'classify', 'route', 'date', 'pence', 'draft'];
export const HALFWAY = 0.472;   // halfway from the first build's 33.9% to the 7B behind the same checks' 60.6%
export const BARS = {
  D1: 'at most 5 silent failures on the sealed 410 (1.2%, the rate the first build already met)',
  D2: 'at least 47.2% of the 330 bounded tasks right: halfway from the first build\'s 33.9% to the 60.6% of the 7B behind the same checks',
  D3: 'no answer released on the 80 hard tasks, and at most 2 on the 30 tasks where nothing is right to say (the first build released 2)',
  D4: 'median time per task at most 5 s in the tab (the first build\'s bar)',
  D5: 'on the fresh 410: at most 5 silent failures',
  D6: 'on the fresh 410: right on more bounded tasks than the first build, by an exact two-sided McNemar test on per-task correctness, p < 0.05',
  D7: 'on the fresh 410: right on more of the real-data tasks (documents, receipts, banking messages, routing) than the first build, by the same test, p < 0.05',
};

// The adoption rule, desk by desk, on that desk's tuning tasks. v1 and v2 are { right, silent } counts on the same tasks.
// score: the measure seal 2 used to choose every cell's release rule: a silent failure counts as twice as bad as a refusal.
export const RULE = 'A desk switches to a decomposed plan only if, on its tuning tasks, the plan has no more silent failures than the one-call form and a higher score, where the score is right answers minus twice the silent failures (the measure seal 2 used to choose each desk\'s release rule). Otherwise the desk stays as it was.';
export const FIRST_RULE = 'more right answers and no more silent failures than the one-call form';
const count = (o, k) => (Number.isInteger(get(o, k)) ? o[k] : null);
export function score(c) {
  const r = count(c, 'right'), s = count(c, 'silent');
  return r === null || s === null ? null : r - 2 * s;
}
// adopted(v1, v2) → true when the decomposed plan earned its place by RULE
export function adopted(v1, v2) {
  const a = score(v1), b = score(v2);
  return a !== null && b !== null && v2.silent <= v1.silent && b > a;
}
// firstRule(v1, v2) → what the rule this work started with would have decided (shown beside the rule that was used)
export function firstRule(v1, v2) {
  return score(v1) !== null && score(v2) !== null && v2.right > v1.right && v2.silent <= v1.silent;
}

// pairedRight(ma, mb, kinds) → { aOnly, bOnly, p }: tasks of those kinds only A got right, only B got right, exact McNemar
export function pairedRight(ma, mb, kinds) {
  const ok = (r) => kinds.includes(get(r, 'kind'));
  const A = new Map((Array.isArray(get(ma, 'rows')) ? ma.rows : []).filter(ok).map((r) => [r.id, r.correct === true]));
  let aOnly = 0, bOnly = 0;
  for (const r of (Array.isArray(get(mb, 'rows')) ? mb.rows : []).filter(ok)) {
    if (!A.has(r.id)) continue;
    const a = A.get(r.id), b = r.correct === true;
    if (a && !b) aOnly++;
    if (!a && b) bOnly++;
  }
  return { aOnly, bOnly, p: mcnemar(aOnly, bOnly) };
}
// rightOf(m, kinds) → { right, of } over those kinds
export function rightOf(m, kinds) {
  const rows = (Array.isArray(get(m, 'rows')) ? m.rows : []).filter((r) => kinds.includes(get(r, 'kind')));
  return { right: rows.filter((r) => r.correct === true).length, of: rows.length };
}
// more right, and by more than chance: the same rule the first build's claims used
const beats = (p) => Math.sign(p.bOnly - p.aOnly) === 1 && p.p < 0.05;
const pending = (id, why) => ({ id, pass: null, result: `pending: ${why}` });

// evaluate(ev) → [{ id, pass, result }]. ev: { v1, v2 } are metrics() results with rows on the sealed 410; { v1fresh,
// v2fresh } the same on the fresh 410; traps: { hard, unanswerable } = answers the decomposed build released there
export function evaluate(ev) {
  const e = ev || {}, v1 = get(e, 'v1'), v2 = get(e, 'v2'), f1 = get(e, 'v1fresh'), f2 = get(e, 'v2fresh'), out = [];
  if (!v2) out.push(pending('D1', 'needs the decomposed build on the sealed 410'), pending('D2', 'needs the decomposed build on the sealed 410'));
  else {
    const s = get(get(v2, 'all'), 'silent');
    out.push({ id: 'D1', pass: Number.isInteger(s) && s <= 5, result: `${s} silent failures of ${v2.all.tasks} (${pct(num(v2.all.silentRate))})${v1 ? `; the first build: ${v1.all.silent}` : ''}` });
    const a = num(get(get(v2, 'bounded'), 'accuracy'));
    out.push({ id: 'D2', pass: a !== null && a >= HALFWAY, result: `${pct(a)} of the ${v2.bounded.tasks} bounded tasks right (${v2.bounded.correct})${v1 ? `; the first build: ${pct(num(v1.bounded.accuracy))} (${v1.bounded.correct})` : ''}` });
  }
  const t = get(e, 'traps');
  out.push(Number.isInteger(get(t, 'hard')) && Number.isInteger(get(t, 'unanswerable')) ? { id: 'D3', pass: t.hard === 0 && t.unanswerable <= 2, result: `${t.hard} answers released on the 80 hard tasks; ${t.unanswerable} on the 30 where nothing is right to say` } : pending('D3', 'needs the decomposed build on the sealed 410'));
  const ms = num(get(get(v2, 'all'), 'medianMs'));
  out.push(v2 && ms !== null && get(v2, 'venue') === 'tab' ? { id: 'D4', pass: ms <= 5000, result: `median ${(ms / 1000).toFixed(2)} s per task${v1 && num(get(v1.all, 'medianMs')) !== null ? `; the first build: ${(v1.all.medianMs / 1000).toFixed(2)} s` : ''}` } : pending('D4', 'needs the decomposed build in the tab'));
  if (!f2) out.push(pending('D5', 'needs the decomposed build on the fresh 410'));
  else { const s = get(get(f2, 'all'), 'silent'); out.push({ id: 'D5', pass: Number.isInteger(s) && s <= 5, result: `${s} silent failures of ${f2.all.tasks} (${pct(num(f2.all.silentRate))})${f1 ? `; the first build on the same tasks: ${f1.all.silent}` : ''}` }); }
  for (const [id, kinds, name] of [['D6', BOUNDED, 'bounded'], ['D7', REAL, 'real-data']]) {
    if (!f1 || !f2) { out.push(pending(id, 'needs both builds on the fresh 410')); continue; }
    const p = pairedRight(f1, f2, kinds), a = rightOf(f1, kinds), b = rightOf(f2, kinds);
    out.push({ id, pass: beats(p), result: `decomposed ${b.right} of ${b.of} ${name} tasks right, first build ${a.right}; ${p.bOnly} tasks only the decomposed build got right, ${p.aOnly} only the first build, p = ${p.p.toPrecision(3)}` });
  }
  return out;
}

export default { REAL, BOUNDED, HALFWAY, BARS, RULE, FIRST_RULE, score, adopted, firstRule, pairedRight, rightOf, evaluate };
