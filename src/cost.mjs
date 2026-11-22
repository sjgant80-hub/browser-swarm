// cost.mjs — the buyer's own cost case, computed from what was measured and what was published. Pure and total.
//   tokens(records) → the mean prompt and reply tokens per task the swarm's model was sent, from a recorded tab run
//   costCase(o) → what the same work would cost on a frontier API at its published price, and what the silent failures
//                 the gate removed would cost at the BUYER's own figure. Nothing is assumed that the buyer does not enter.
const get = (o, k) => { try { return o[k]; } catch { return undefined; } };
const fin = (x) => Number.isFinite(x);
const pos = (x) => (fin(x) && x >= 0 ? x : null);

// tokens(records) → { prompt, reply, tasks } means over the records' model calls (a call with no count is left out)
export function tokens(records) {
  let p = 0, r = 0, np = 0, nr = 0, tasks = 0;
  for (const rec of Array.isArray(records) ? records : []) {
    const calls = Array.isArray(get(rec, 'calls')) ? rec.calls.filter((c) => get(c, 'cached') !== true) : [];
    if (calls.length === 0) continue;
    tasks++;
    for (const c of calls) {
      if (fin(get(c, 'prompt'))) { p += c.prompt; np++; }
      if (fin(get(c, 'reply'))) { r += c.reply; nr++; }
    }
  }
  return { prompt: np ? p / np : null, reply: nr ? r / nr : null, tasks, callsPerTask: tasks ? (np || nr) / tasks : null };
}

// costCase({ prompt, reply, callsPerTask, tasksPerMonth, price: { in, out } per million, silentSwarm, silentRaw (rates),
//            costPerSilent }) → { apiPerTask, apiPerMonth, silentAvoidedPerMonth, silentCostAvoided }; null where an input is missing
export function costCase(o) {
  const x = o && typeof o === 'object' ? o : {};
  const prompt = pos(x.prompt), reply = pos(x.reply), calls = pos(x.callsPerTask), tasks = pos(x.tasksPerMonth);
  const pin = pos(get(x.price, 'in')), pout = pos(get(x.price, 'out'));
  const apiPerTask = [prompt, reply, calls, pin, pout].every((v) => v !== null) ? calls * (prompt * pin + reply * pout) / 1e6 : null;
  const apiPerMonth = apiPerTask !== null && tasks !== null ? apiPerTask * tasks : null;
  const ss = pos(x.silentSwarm), sr = pos(x.silentRaw), cps = pos(x.costPerSilent);
  const silentAvoidedPerMonth = ss !== null && sr !== null && tasks !== null ? Math.max(0, sr - ss) * tasks : null;
  const silentCostAvoided = silentAvoidedPerMonth !== null && cps !== null ? silentAvoidedPerMonth * cps : null;
  return { apiPerTask, apiPerMonth, silentAvoidedPerMonth, silentCostAvoided };
}

export default { tokens, costCase };
