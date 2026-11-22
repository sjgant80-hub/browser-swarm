// swarm.mjs — the conductor and the guard, around any base model. ask(messages, maxTokens) is the only thing that
// differs between the tab (WebLLM on WebGPU) and Node (Ollama on 127.0.0.1): it returns { text, ms, ttft? }.
//   gated(task, call, ctx) → the SWARM: the estate's conductor picks the cell whose lane fits the request (or refuses);
//                            the estate's guard runs the cell's lane check, then its act (the model), then its judge,
//                            and releases only what the judge verified (vendor/route.mjs and vendor/guard.mjs, unchanged)
//   raw(task, call, ctx)   → the SAME model on the SAME prompt for that task, with no lane and no judge: whatever it says
//                            is delivered. The two arms share model calls through call(), so they differ only in the gate.
import { route } from '../vendor/route.mjs';
import { plan, decide } from '../vendor/guard.mjs';
import S from './cells.mjs';

const get = (o, k) => { try { return o[k]; } catch { return undefined; } };   // null or undefined → undefined
const HARD = new Set(['knowledge', 'reasoning']);

// caller(ask) → call(messages, maxTokens): each distinct request is asked once; a repeat gets the first answer and its
// timing, marked cached. Errors come back as an empty reply with the error, never a throw.
export function caller(ask) {
  const memo = new Map();
  return (messages, maxTokens) => {
    const key = JSON.stringify([messages, maxTokens]);
    if (memo.has(key)) return memo.get(key).then((r) => ({ ...r, cached: true }));
    const p = Promise.resolve().then(() => ask(messages, maxTokens)).then(
      (r) => ({ text: typeof get(r, 'text') === 'string' ? r.text : '', ms: Number(get(r, 'ms')) || 0, ttft: Number(get(r, 'ttft')) || null, prompt: Number(get(r, 'prompt')) || null, cached: false }),
      (e) => ({ text: '', ms: 0, ttft: null, prompt: null, cached: false, error: String((e && e.message) || e).slice(0, 200) }));
    memo.set(key, p);
    return p;
  };
}

const callRow = (c) => ({ ms: c.ms, ttft: c.ttft, prompt: c.prompt, cached: c.cached, text: c.text, ...(c.error ? { error: c.error } : {}) });

export async function gated(task, call, ctx) {
  const base = { id: get(task, 'id'), kind: get(task, 'kind'), arm: 'gated' };
  const r = route(S.index(), { need: get(task, 'request') });
  if (r.status !== 'routed') return { ...base, cell: null, stage: 'conductor', status: 'refused', released: false, why: r.why, calls: [], ms: 0 };
  const cell = S.CELLS.find((c) => c.name === r.cell);
  const seed = S.seedOf(cell), input = get(task, 'input'), runs = {}, calls = [];
  const lane = cell.lane_(input, ctx, true);
  runs.lane = { code: 0, out: JSON.stringify(lane) };
  let step = plan(seed, runs, input), ground = null;
  if (step && step.step === 'act') {
    const raws = [];
    for (let p = 0; p < cell.passes; p++) { const c = await call(cell.messages(input, lane, ctx, p), cell.maxTokens); calls.push(callRow(c)); raws.push(c.text); }
    const a = cell.parse(raws, input, lane, ctx);
    runs.act = get(a, 'output') !== undefined ? { code: 0, out: JSON.stringify({ output: a.output }) } : { code: 1, out: JSON.stringify({ why: get(a, 'why') || '' }) };
    step = plan(seed, runs, input);
    if (step && step.step === 'judge') { const j = cell.judge(step.input, input, ctx, lane); runs.judge = { code: 0, out: JSON.stringify(j) }; ground = get(j, 'ground') || null; }
  }
  const d = decide(seed, runs, input);
  const judged = runs.judge ? JSON.parse(runs.judge.out) : null;
  return {
    ...base, cell: cell.name, stage: d.stage, status: d.status, released: d.released === true,
    ...(d.released ? { output: d.output, ground } : { withheld: get(d, 'withheld') }),
    why: d.released ? '' : (judged && judged.why ? `${d.reason}: ${judged.why}` : d.status === 'refused' && d.stage === 'lane' ? `${d.reason}: ${get(lane, 'why') || ''}` : d.reason),
    calls, ms: calls.reduce((a, c) => a + c.ms, 0),
  };
}

export async function raw(task, call, ctx) {
  const base = { id: get(task, 'id'), kind: get(task, 'kind'), arm: 'raw' };
  const input = get(task, 'input');
  const cell = HARD.has(base.kind) ? S.MCQ : S.CELLS.find((c) => c.name === S.FOR_KIND[base.kind]);
  if (!cell) return { ...base, cell: null, released: false, why: 'no prompt for this kind', calls: [], ms: 0 };
  // the plain pipeline still needs its context: the best document (whatever its score) or the top banking intents
  const lane = cell.name === 'docs-answer' || cell.name === 'banking-intent' ? cell.lane_(input, ctx, false) : { inLane: true };
  const c = await call(cell.messages(input, lane, ctx, 0), cell.maxTokens);
  const a = cell.parse([c.text], input, lane, ctx);
  const out = get(a, 'output');
  return { ...base, cell: cell.name, released: out !== undefined, ...(out !== undefined ? { output: out } : {}), why: out !== undefined ? '' : get(a, 'why') || '', calls: [callRow(c)], ms: c.ms };
}

// replay(task, rec, ctx) → the same arm decided again from a recorded run: the model's recorded replies are handed back in
// the order they were asked, with their recorded timings, and the conductor, lane, guard and judge run for real. This is
// how anyone re-derives a published run's every decision without a model: the replies are data, the decisions are code.
export async function replay(task, rec, ctx) {
  const calls = Array.isArray(get(rec, 'calls')) ? rec.calls : [];
  let i = 0;
  const call = async () => { const c = calls[i++] || {}; return { text: typeof c.text === 'string' ? c.text : '', ms: Number(c.ms) || 0, ttft: c.ttft ?? null, prompt: c.prompt ?? null, cached: c.cached === true }; };
  return get(rec, 'arm') === 'raw' ? raw(task, call, ctx) : gated(task, call, ctx);
}

export default { caller, gated, raw, replay };
