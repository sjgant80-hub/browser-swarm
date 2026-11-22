// cell.mjs — Browser Swarm's three answers for the estate genome's birth check (seed.json, genome/).
//
// judge  the documents cell's own judge (src/cells.mjs), run on an answer record { question, answer, source } over the
//        signed corpus: verified when the answer is the source's own words in the sentence that best matches the
//        question, with enough of the question's words, and not in a sentence that gives orders; unverified when it is
//        not; refused when the input is not an answer record or its source is not in the signed corpus.
// lane   the documents cell's lane check, the same code the swarm runs before any model: a question is in lane when
//        a signed paragraph clears the bar chosen on the tuning pool (data/settings.json).
// health the repository cannot see its page's visitors or callers from inside it, so it says so.
import { readFileSync } from 'node:fs';
import S from '../src/cells.mjs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const ctx = S.prepare(read('../data/corpus.json'), read('../data/banking-index.json'), read('../data/departments.json'), read('../data/settings.json'));
const docs = S.CELLS.find((c) => c.name === 'docs-answer');
const str = (x) => typeof x === 'string';

export async function judge(input) {
  const rec = input !== null && typeof input === 'object' && str(input.question) && str(input.answer) && str(input.source);
  if (!rec || !ctx.byId.has(input.source)) return 'refused';
  const j = docs.judge(input, { question: input.question }, ctx);
  return j.status === 'verified' ? 'verified' : j.status === 'refused' ? 'refused' : 'unverified';
}

export async function inLane(input) {
  return input !== null && typeof input === 'object' && docs.lane_({ question: input.question }, ctx).inLane === true;
}

export async function health() {
  return { used: null, dependedOn: null, lastEarned: null };
}
