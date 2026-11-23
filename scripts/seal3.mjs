// seal3.mjs — freeze the fix before it reads a sealed task: the atoms, the plans, the code readers, the claims kernel
// and the claims file, the settings and the adoption table the tuning data chose, and the fresh sealed set. Writes
// SEAL3.json (a SHA-256 of each file's bytes, and of seal 2, which still holds for the first build's code).
// test/seal.test.mjs then fails if any sealed byte changes; every run of the fix records this seal's own hash.
//   node scripts/seal3.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');
export const SEALED3 = [
  'src/atoms.mjs', 'src/assembly.mjs', 'src/read.mjs', 'src/claims2.mjs', 'CLAIMS-2.md',
  'data/settings2.json', 'data/adoption.json', 'data/test2.json', 'data/tune2.json',
];
if (process.argv[1] && process.argv[1].endsWith('seal3.mjs')) {
  const files = Object.fromEntries(SEALED3.map((f) => {
    const b = readFileSync(f);
    if (b.includes(13)) throw new Error(`${f} has a carriage return: seal 3 hashes LF bytes only`);
    return [f, sha(b)];
  }));
  const seal2 = readFileSync('SEAL2.json');
  if (seal2.includes(13)) throw new Error('SEAL2.json has a carriage return');
  writeFileSync('SEAL3.json', JSON.stringify({ v: 'browser-swarm-seal/3', note: 'the decomposed build, frozen before it read a task of either sealed set; a run of the fix counts only when its seal3Sha256 equals the SHA-256 of this file and its sealSha256 equals seal2', seal2: sha(seal2), files }, null, 1) + '\n');
  console.log(`SEAL3.json: ${SEALED3.length} files · seal sha256 ${sha(readFileSync('SEAL3.json')).slice(0, 12)}`);
}
