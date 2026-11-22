// build-suite.mjs — build the task suite from real, openly licensed data, plus two generated families whose answers are
// computed by this script. The selection is fixed by a seed: every item is ordered by sha256(SEED + ':' + its id) and the
// test split takes the first ones, the dev split the next ones, so anyone with the same sources re-derives the same suite.
// The dev split is for building the cells; the test split is read once, after the claims and the code are sealed.
//   node scripts/build-suite.mjs [--sources <dir>] [--docdec <docdecdemo dir>]
// writes data/suite.json, data/corpus.json and data/banking-index.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = arg('--sources', process.env.SWARM_SOURCES || 'sources');
const DOCDEC = arg('--docdec', process.env.SWARM_DOCDEC || '../docdecdemo');
export const SEED = 'browser-swarm-1';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const fileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const order = (items, key) => items.map((x) => ({ x, k: sha(`${SEED}:${key(x)}`) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((o) => o.x);
const take = (items, key, nTest, nDev, nTune = 0) => { const o = order(items, key); return { test: o.slice(0, nTest), dev: o.slice(nTest, nTest + nDev), tune: o.slice(nTest + nDev, nTest + nDev + nTune) }; };

// a small CSV reader (quoted fields, doubled quotes, commas and newlines inside quotes)
function csv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const sources = [];
// a source is recorded by its path inside the dataset as its publisher ships it, never by where it sits on this machine
const slash = (p) => p.split('\\').join('/');
const source = (name, file, license, url) => {
  const f = slash(file), d = slash(DOCDEC), s = slash(SRC);
  sources.push({ name, file: f.startsWith(d + '/') ? 'docdecdemo/' + f.slice(d.length + 1) : f.startsWith(s + '/') ? f.slice(s.length + 1) : f.split('/').slice(-2).join('/'), sha256: fileSha(file), license, url });
};

// ── qa: DocDec's corpus (130 SQuAD 2.0 paragraphs) and its questions ──
const evalFile = join(DOCDEC, 'eval-data.json');
const ev = JSON.parse(readFileSync(evalFile, 'utf8'));
source('DocDec eval set (SQuAD 2.0 subset)', evalFile, 'CC BY-SA 4.0', 'https://rajpurkar.github.io/SQuAD-explorer/');
const paragraphs = ev.paragraphs.map((p) => ({ id: p.id, text: p.text, sha256: sha(p.text) }));
const root = sha(paragraphs.map((p) => `${p.id}\t${p.sha256}`).join('\n'));
const answerable = ev.questions.filter((q) => !q.impossible && typeof q.answerText === 'string' && q.answerText.trim());
const impossible = ev.questions.filter((q) => q.impossible);
const offCorpus = ev.outOfScope;
const qa = {
  a: take(answerable, (q) => q.qid, 40, 10, 80), u: take(impossible, (q) => q.qid, 10, 3, 30), o: take(offCorpus, (q) => q.qid, 10, 2, 80),
};
const qaTask = (q, kind) => ({
  id: `qa:${q.qid}`, kind: 'qa', request: 'Answer this question from our documents.', input: { question: q.text },
  gold: kind === 'a' ? { answer: q.answerText, goldId: q.goldId, impossible: false } : { impossible: true, reason: kind === 'u' ? 'unanswerable from its paragraph' : 'not in the corpus' },
});

// ── extract: CORD v2 receipts, the printed total ──
const cordFile = join(SRC, 'cord-v2', 'cord-v2-ground-truth.jsonl');
source('CORD v2 receipts', cordFile, 'CC BY 4.0', 'https://github.com/clovaai/cord');
function receiptText(gt) {
  const rows = new Map();
  for (const line of Array.isArray(gt.valid_line) ? gt.valid_line : []) {
    for (const w of Array.isArray(line.words) ? line.words : []) {
      if (typeof w.text !== 'string' || !w.quad) continue;
      const r = rows.get(w.row_id) || { y: [], words: [] };
      r.y.push(w.quad.y1); r.words.push({ x: w.quad.x1, t: w.text }); rows.set(w.row_id, r);
    }
  }
  return [...rows.values()].map((r) => ({ y: r.y.reduce((a, b) => a + b, 0) / r.y.length, t: r.words.sort((a, b) => a.x - b.x).map((w) => w.t).join(' ') }))
    .sort((a, b) => a.y - b.y).map((r) => r.t).join('\n');
}
let cordSkipped = 0;
const receipts = [];
for (const line of readFileSync(cordFile, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const o = JSON.parse(line), gt = JSON.parse(o.ground_truth);
  const total = gt.gt_parse && gt.gt_parse.total && gt.gt_parse.total.total_price;
  const text = receiptText(gt);
  if (typeof total !== 'string' || !/\d/.test(total) || !text.includes(total) || text.length > 1800) { cordSkipped++; continue; }
  receipts.push({ id: `${o.split}-${o.row}`, text, total });
}
const ex = take(receipts, (r) => r.id, 50, 10);
const exTask = (r) => ({ id: `extract:cord-${r.id}`, kind: 'extract', request: 'Pull the total amount from this receipt.', input: { receipt: r.text }, gold: { total: r.total } });

// ── classify: Banking77 (77 intents); the cell's shortlist index is built from the TRAIN split only ──
const bdir = join(SRC, 'polyai', 'banking_data');
source('Banking77 test', join(bdir, 'test.csv'), 'CC BY 4.0', 'https://github.com/PolyAI-LDN/task-specific-datasets');
source('Banking77 train (shortlist index only)', join(bdir, 'train.csv'), 'CC BY 4.0', 'https://github.com/PolyAI-LDN/task-specific-datasets');
const btest = csv(readFileSync(join(bdir, 'test.csv'), 'utf8')).slice(1).map(([text, intent], i) => ({ id: `b77-test-${i}`, text, intent }));
const btrain = csv(readFileSync(join(bdir, 'train.csv'), 'utf8')).slice(1).map(([text, intent]) => ({ text, intent }));
const cl = take(btest, (b) => b.id, 60, 15, 120);
const clTask = (b) => ({ id: `classify:${b.id}`, kind: 'classify', request: 'Which banking intent is this customer message?', input: { message: b.text }, gold: { intent: b.intent } });
// index: per intent, the 40 terms with the highest summed tf-idf over its training messages (weights to 3 decimals)
const WORD = (t) => (t.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length >= 2);
const df = new Map();
for (const b of btrain) for (const w of new Set(WORD(b.text))) df.set(w, (df.get(w) || 0) + 1);
const byIntent = new Map();
for (const b of btrain) {
  const m = byIntent.get(b.intent) || new Map();
  for (const w of WORD(b.text)) m.set(w, (m.get(w) || 0) + Math.log(btrain.length / (df.get(w) || 1)));
  byIntent.set(b.intent, m);
}
const intents = [...byIntent.keys()].sort();
const bankingIndex = {
  v: 'browser-swarm-banking-index/1', from: 'Banking77 train.csv', license: 'CC BY 4.0', idf: {},
  intents: intents.map((it) => ({ intent: it, terms: Object.fromEntries([...byIntent.get(it)].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 40).map(([w, v]) => [w, Math.round(v * 1000) / 1000])) })),
};

// ── route: CLINC150 domains (10) plus out-of-scope ──
const cfile = join(SRC, 'clinc150', 'data_full.json');
source('CLINC150', cfile, 'CC BY 3.0', 'https://github.com/clinc/oos-eval');
const clinc = JSON.parse(readFileSync(cfile, 'utf8'));
const domains = JSON.parse(readFileSync(join(SRC, 'clinc150', 'domains.json'), 'utf8'));
const domainOf = new Map(); for (const [d, list] of Object.entries(domains)) for (const it of list) domainOf.set(it, d);
const inScope = clinc.test.map(([text, intent], i) => ({ id: `clinc-test-${i}`, text, domain: domainOf.get(intent) || null })).filter((x) => x.domain);
const oos = clinc.oos_test.map(([text], i) => ({ id: `clinc-oos-${i}`, text, domain: null }));
const rt = { i: take(inScope, (x) => x.id, 50, 10, 80), o: take(oos, (x) => x.id, 10, 3, 20) };
// each department is described to the model by its first six CLINC150 intent names (read from domains.json, not written by hand)
const departments = { v: 'browser-swarm-departments/1', from: 'CLINC150 domains.json', license: 'CC BY 3.0',
  departments: Object.entries(domains).map(([id, list]) => ({ id, label: id.split('_').join(' '), examples: list.slice(0, 6).map((x) => x.split('_').join(' ')) })) };
const rtTask = (x) => ({ id: `route:${x.id}`, kind: 'route', request: 'Which department should handle this message?', input: { message: x.text }, gold: { domain: x.domain } });

// ── transform: dates and money amounts, generated by this script with their answers ──
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261122);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ord = (d) => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');
const pad = (n) => String(n).padStart(2, '0');
const DATE_FORMS = [
  (d, m, y) => `${d} ${MONTHS[m]} ${y}`, (d, m, y) => `${MONTHS[m]} ${d}, ${y}`, (d, m, y) => `the ${ord(d)} of ${MONTHS[m]} ${y}`,
  (d, m, y) => `${pad(d)}/${pad(m + 1)}/${y} (day first)`, (d, m, y, w) => `${DAYS[w]} ${d} ${MONTHS[m]} ${y}`, (d, m, y) => `${ord(d)} ${MONTHS[m].slice(0, 3)} ${y}`,
  (d, m, y) => `${y}.${pad(m + 1)}.${pad(d)}`, (d, m, y) => `delivered on ${d} ${MONTHS[m]}, ${y}`,
];
const dates = [];
for (let i = 0; i < 400; i++) {
  const y = 1990 + Math.floor(rnd() * 41), m = Math.floor(rnd() * 12), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), d = 1 + Math.floor(rnd() * dim);
  const w = new Date(Date.UTC(y, m, d)).getUTCDay();
  dates.push({ id: `gen-date-${i}`, text: pick(DATE_FORMS)(d, m, y, w), iso: `${y}-${pad(m + 1)}-${pad(d)}` });
}
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MONEY_FORMS = [
  (p) => `£${comma(Math.floor(p / 100))}.${pad(p % 100)}`, (p) => `£${Math.floor(p / 100)}.${pad(p % 100)}`, (p) => `${comma(Math.floor(p / 100))}.${pad(p % 100)} pounds`,
  (p) => `GBP ${Math.floor(p / 100)}.${pad(p % 100)}`, (p) => `${Math.floor(p / 100)} pounds ${p % 100} pence`, (p) => `a charge of £${comma(Math.floor(p / 100))}.${pad(p % 100)}`,
];
const money = [];
for (let i = 0; i < 400; i++) {
  const p = rnd() < 0.15 ? 1 + Math.floor(rnd() * 99) : 100 + Math.floor(rnd() * 250000);
  const text = p < 100 && rnd() < 0.5 ? `${p}p` : pick(MONEY_FORMS)(p);
  money.push({ id: `gen-money-${i}`, text, pence: p });
}
const dt = take(dates, (x) => x.id, 25, 8), mo = take(money, (x) => x.id, 25, 8);
const dtTask = (x) => ({ id: `date:${x.id}`, kind: 'date', request: 'Convert this date to ISO format.', input: { text: x.text }, gold: { iso: x.iso } });
const moTask = (x) => ({ id: `pence:${x.id}`, kind: 'pence', request: 'Convert this money amount to pence.', input: { text: x.text }, gold: { pence: x.pence } });

// ── draft: refund confirmations from generated test records (fictional people, labelled as generated) ──
const FIRST = ['Sam', 'Alex', 'Priya', 'Tom', 'Aisha', 'Ben', 'Chloe', 'Daniel', 'Ella', 'Faisal', 'Grace', 'Hannah', 'Imran', 'Jack', 'Kiran', 'Laura', 'Nina', 'Oliver', 'Ruth', 'Zara'];
const LAST = ['Taylor', 'Patel', 'Jones', 'Khan', 'Evans', 'Smith', 'Murphy', 'Hughes', 'Ali', 'Walker', 'Clarke', 'Reid', 'Shah', 'Price', 'Wood'];
const ITEMS = ['kettle', 'desk lamp', 'rain jacket', 'blender', 'phone case', 'running shoes', 'toaster', 'bookshelf', 'headphones', 'backpack', 'garden hose', 'coffee grinder'];
const records = [];
for (let i = 0; i < 300; i++) {
  const p = 199 + Math.floor(rnd() * 29800), y = 2025 + Math.floor(rnd() * 2), m = Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 28);
  records.push({ id: `gen-record-${i}`, record: { name: `${pick(FIRST)} ${pick(LAST)}`, order: `ORD-${100000 + Math.floor(rnd() * 900000)}`, item: pick(ITEMS), amount: `£${Math.floor(p / 100)}.${pad(p % 100)}`, date: `${d} ${MONTHS[m]} ${y}` } });
}
const dr = take(records, (x) => x.id, 50, 10);
const drTask = (x) => ({ id: `draft:${x.id}`, kind: 'draft', request: 'Draft a refund confirmation from this record.', input: { record: x.record }, gold: { record: x.record } });

// ── the two families the swarm should LOSE on: MMLU, closed book ──
const mdir = join(SRC, 'mmlu', 'data', 'test');
const mmlu = (subjects) => subjects.flatMap((s) => {
  const f = join(mdir, `${s}_test.csv`); source(`MMLU ${s}`, f, 'MIT', 'https://github.com/hendrycks/test');
  return csv(readFileSync(f, 'utf8')).map(([question, A, B, C, D, letter], i) => ({ id: `mmlu-${s}-${i}`, subject: s, question, options: { A, B, C, D }, letter }));
});
const know = take(mmlu(['global_facts', 'high_school_geography', 'prehistory', 'world_religions', 'nutrition', 'astronomy']), (x) => x.id, 40, 8);
const reas = take(mmlu(['elementary_mathematics', 'high_school_mathematics']), (x) => x.id, 40, 8);
const mcTask = (kind) => (x) => ({ id: `${kind}:${x.id}`, kind, request: 'Answer this multiple-choice question.', input: { question: x.question, options: x.options, subject: x.subject }, gold: { letter: x.letter } });

const split = (s) => [
  ...qa.a[s].map((q) => qaTask(q, 'a')), ...qa.u[s].map((q) => qaTask(q, 'u')), ...qa.o[s].map((q) => qaTask(q, 'o')),
  ...ex[s].map(exTask), ...cl[s].map(clTask), ...rt.i[s].map(rtTask), ...rt.o[s].map(rtTask), ...dt[s].map(dtTask), ...mo[s].map(moTask),
  ...dr[s].map(drTask), ...know[s].map(mcTask('knowledge')), ...reas[s].map(mcTask('reasoning')),
];
const test = split('test'), dev = split('dev');
// the tuning pool: the next items in the same seeded order, for choosing the lane bar and the classifier rule (never the test split)
const tune = [...qa.a.tune.map((q) => qaTask(q, 'a')), ...qa.u.tune.map((q) => qaTask(q, 'u')), ...qa.o.tune.map((q) => qaTask(q, 'o')), ...cl.tune.map(clTask), ...rt.i.tune.map(rtTask), ...rt.o.tune.map(rtTask)];
const ids = new Set(); for (const t of [...test, ...dev]) { if (ids.has(t.id)) throw new Error('duplicate id ' + t.id); ids.add(t.id); }
const count = (xs) => Object.fromEntries([...new Set(xs.map((t) => t.kind))].map((k) => [k, xs.filter((t) => t.kind === k).length]));
const suite = {
  v: 'browser-swarm-suite/1', seed: SEED, note: 'Selection by sha256(seed:id). The dev split builds the cells; the test split is read once, after both seals. Dates, money amounts and refund records are GENERATED by scripts/build-suite.mjs (fictional people); everything else is a published dataset.',
  sources, skipped: { cordReceiptsWithoutAVerbatimTotal: cordSkipped }, counts: { test: count(test), dev: count(dev) }, testSha256: sha(JSON.stringify(test)), dev, test,
};
writeFileSync('data/suite.json', JSON.stringify(suite, null, 1) + '\n');
writeFileSync('data/corpus.json', JSON.stringify({ v: 'browser-swarm-corpus/1', from: 'DocDec eval set (SQuAD 2.0 subset)', license: 'CC BY-SA 4.0', root, paragraphs }, null, 1) + '\n');
writeFileSync('data/banking-index.json', JSON.stringify(bankingIndex) + '\n');
// the attack pool: the 40 answerable questions after test, dev and tuning in the same order; each one's false answer is
// the next one's real answer (a real answer from elsewhere in the corpus, so it reads like an answer)
// Positions 130-169 are the ATTACK-DEV pool: an A4 preview was read on them before seal 1 (disclosed in CLAIMS.md), so
// they may be used to build the defences. Positions 170-209 are the sealed attack pool, read once after seal 2.
const attackPool = (from) => {
  const pool = order(answerable, (q) => q.qid).slice(from, from + 40);
  return pool.map((q, i) => ({ id: `attack:${q.qid}`, question: q.text, goldId: q.goldId, answer: q.answerText,
    false: [...pool.slice(i + 1), ...pool.slice(0, i)].find((o) => o.answerText.toLowerCase() !== q.answerText.toLowerCase() && !ev.paragraphs.find((p) => p.id === q.goldId).text.includes(o.answerText)).answerText }));
};
const note = 'answerable questions after the test, dev and tuning items in the same seeded order; false = another question\'s real answer, not in this paragraph';
writeFileSync('data/attacks-dev.json', JSON.stringify({ v: 'browser-swarm-attacks/1', note: `${note}. ATTACK-DEV: positions 130-169, read before seal 1; for building the defences only`, attacks: attackPool(130) }, null, 1) + '\n');
writeFileSync('data/attacks.json', JSON.stringify({ v: 'browser-swarm-attacks/1', note: `${note}. SEALED: positions 170-209, read once after seal 2`, attacks: attackPool(170) }, null, 1) + '\n');
writeFileSync('data/tune.json', JSON.stringify({ v: 'browser-swarm-tune/1', note: 'the items after test and dev in the same seeded order; used only to choose settings', tasks: tune }, null, 1) + '\n');
writeFileSync('data/departments.json', JSON.stringify(departments, null, 1) + '\n');
console.log(`test ${test.length} ${JSON.stringify(suite.counts.test)}\ndev ${dev.length} ${JSON.stringify(suite.counts.dev)}\ncorpus ${paragraphs.length} root ${root.slice(0, 12)} · cord skipped ${cordSkipped} · test sha ${suite.testSha256.slice(0, 12)}`);
