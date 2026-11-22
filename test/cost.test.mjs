import { test } from 'node:test';
import assert from 'node:assert/strict';
import K from '../src/cost.mjs';

test('tokens: means over uncached calls with counts', () => {
  const recs = [
    { calls: [{ prompt: 100, reply: 10 }, { prompt: 300, reply: 30, cached: false }] },
    { calls: [{ prompt: 200, reply: 20, cached: true }] },
    { calls: [] }, null, { calls: 'x' },
    { calls: [{ prompt: 'n', reply: null }] },
  ];
  assert.deepEqual(K.tokens(recs), { prompt: 200, reply: 20, tasks: 2, callsPerTask: 1 });
  assert.deepEqual(K.tokens([{ calls: [{ reply: 6 }, { reply: 4 }] }]), { prompt: null, reply: 5, tasks: 1, callsPerTask: 2 });
  assert.deepEqual(K.tokens(null), { prompt: null, reply: null, tasks: 0, callsPerTask: null });
  assert.deepEqual(K.tokens([{ calls: [{ prompt: 0, reply: 0 }] }]), { prompt: 0, reply: 0, tasks: 1, callsPerTask: 1 });
});

test('costCase: the frontier price of the same work, and the silent failures the gate removed', () => {
  const c = K.costCase({ prompt: 500, reply: 20, callsPerTask: 1.2, tasksPerMonth: 10000, price: { in: 4, out: 20 }, silentSwarm: 0.03, silentRaw: 0.4, costPerSilent: 15 });
  assert.equal(c.apiPerTask, 1.2 * (500 * 4 + 20 * 20) / 1e6);
  assert.equal(c.apiPerMonth, c.apiPerTask * 10000);
  assert.ok(Math.abs(c.silentAvoidedPerMonth - 3700) < 1e-9);
  assert.ok(Math.abs(c.silentCostAvoided - 55500) < 1e-6);
  const none = K.costCase({ prompt: 500, reply: 20, callsPerTask: 1, price: { in: 4, out: 20 }, silentSwarm: 0.03, silentRaw: 0.4 });
  assert.deepEqual([none.apiPerMonth, none.silentAvoidedPerMonth, none.silentCostAvoided], [null, null, null]);
  assert.equal(none.apiPerTask, (500 * 4 + 20 * 20) / 1e6);
  assert.equal(K.costCase({ ...c, prompt: -1, reply: 20, callsPerTask: 1, price: { in: 4, out: 20 } }).apiPerTask, null);
  assert.equal(K.costCase({ prompt: 1, reply: 1, callsPerTask: 1, price: { in: 4 } }).apiPerTask, null);
  assert.equal(K.costCase({ prompt: 0, reply: 0, callsPerTask: 0, price: { in: 0, out: 0 }, tasksPerMonth: 0 }).apiPerMonth, 0);
  const worse = K.costCase({ tasksPerMonth: 100, silentSwarm: 0.5, silentRaw: 0.4, costPerSilent: 1 });
  assert.deepEqual([worse.silentAvoidedPerMonth, worse.silentCostAvoided], [0, 0]);
  assert.equal(K.costCase({ tasksPerMonth: 100, silentSwarm: 0.1, silentRaw: 0.4 }).silentCostAvoided, null);
  assert.equal(K.costCase({ tasksPerMonth: 100, silentSwarm: null, silentRaw: 0.4, costPerSilent: 1 }).silentAvoidedPerMonth, null);
  assert.equal(K.costCase({ tasksPerMonth: 100, silentSwarm: 0.1, silentRaw: Infinity, costPerSilent: 1 }).silentAvoidedPerMonth, null);
  assert.deepEqual(K.costCase(null), { apiPerTask: null, apiPerMonth: null, silentAvoidedPerMonth: null, silentCostAvoided: null });
  assert.deepEqual(K.costCase('x'), { apiPerTask: null, apiPerMonth: null, silentAvoidedPerMonth: null, silentCostAvoided: null });
});
