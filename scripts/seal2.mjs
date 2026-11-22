// seal2.mjs — freeze everything that can change an answer: the kernels, the vendored estate code, the settings and data
// the dev split and the tuning pool chose, and the runners. Writes SEAL2.json (a SHA-256 of each file's bytes) and
// vendor/PROVENANCE.json (where each vendored file came from, byte for byte). test/seal.test.mjs then fails if any
// sealed byte changes; every test-split run records the seal's own hash.
//   node scripts/seal2.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');
export const SEALED = [
  ...readdirSync('src').filter((f) => f.endsWith('.mjs')).sort().map((f) => `src/${f}`),
  ...readdirSync('vendor').filter((f) => f.endsWith('.mjs')).sort().map((f) => `vendor/${f}`),
  'data/settings.json', 'data/corpus.json', 'data/banking-index.json', 'data/departments.json', 'data/suite.json', 'data/attacks.json',
  'scripts/run-node.mjs', 'scripts/replay.mjs', 'scripts/attack.mjs',
];
export const VENDOR = [
  { file: 'vendor/guard.mjs', repo: 'sjgant80-hub/estate-genome', path: 'src/guard.mjs', gate: 'estate-genome data/gates.json: src/guard.mjs CLEAN 34/34' },
  { file: 'vendor/route.mjs', repo: 'sjgant80-hub/estate-genome', path: 'src/route.mjs', gate: 'estate-genome data/gates.json: src/route.mjs CLEAN 16/16' },
  { file: 'vendor/docdec-kernel.mjs', repo: 'sjgant80-hub/docdecdemo', path: 'kernel.mjs', gate: 'docdecdemo data/v2/gates.json' },
  { file: 'vendor/docdec-gate.mjs', repo: 'sjgant80-hub/docdecdemo', path: 'src/gate.mjs', gate: 'docdecdemo data/v2/gates.json' },
  { file: 'vendor/stats.mjs', repo: 'sjgant80-hub/docdecdemo', path: 'src/stats.mjs', gate: 'docdecdemo data/v2/gates.json' },
];
if (process.argv[1] && process.argv[1].endsWith('seal2.mjs')) {
  const commit = JSON.parse(process.argv[2] || '{}');
  const files = Object.fromEntries(SEALED.map((f) => {
    const b = readFileSync(f);
    if (b.includes(13)) throw new Error(`${f} has a carriage return: seal 2 hashes LF bytes only`);
    return [f, sha(b)];
  }));
  writeFileSync('SEAL2.json', JSON.stringify({ v: 'browser-swarm-seal/2', note: 'every file that can change an answer, frozen before the test split was read; a test-split run counts only when its sealSha256 equals the SHA-256 of this file', files }, null, 1) + '\n');
  writeFileSync('vendor/PROVENANCE.json', JSON.stringify({ v: 'browser-swarm-vendor/1', note: 'each vendored file is byte for byte the file at that commit of its home repository, where it is mutation-gated', files: VENDOR.map((v) => ({ ...v, commit: commit[v.repo] || null, sha256: sha(readFileSync(v.file)) })) }, null, 1) + '\n');
  console.log(`SEAL2.json: ${SEALED.length} files · seal sha256 ${sha(readFileSync('SEAL2.json')).slice(0, 12)}`);
}
