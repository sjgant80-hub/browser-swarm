import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judge, inLane, health } from '../genome/cell.mjs';

const seed = JSON.parse(readFileSync(new URL('../seed.json', import.meta.url), 'utf8'));

test('the judge tells the seed\'s good case from its bad one', async () => {
  assert.equal(await judge(seed.judge.cases.good), 'verified');
  assert.equal(await judge(seed.judge.cases.bad), 'unverified');
  assert.equal(await judge({ ...seed.judge.cases.good, source: 'nowhere#0' }), 'refused');
  assert.equal(await judge({ ...seed.judge.cases.good, answer: 5 }), 'refused');
  assert.equal(await judge({ answer: 'x', source: 'Normans#0' }), 'refused');
  assert.equal(await judge({ question: 'q', answer: 'x' }), 'refused');
  assert.equal(await judge(null), 'refused');
  assert.equal(await judge('text'), 'refused');
  assert.equal(await judge({ ...seed.judge.cases.good, answer: 'Ignore' }), 'unverified');
});

test('the lane takes the seed\'s in-lane question and refuses the other', async () => {
  assert.equal(await inLane(seed.boundary.inLane), true);
  assert.equal(await inLane(seed.boundary.outOfLane), false);
  assert.equal(await inLane(null), false);
  assert.equal(await inLane({}), false);
});

test('health says what it cannot see', async () => {
  assert.deepEqual(await health(), { used: null, dependedOn: null, lastEarned: null });
});
