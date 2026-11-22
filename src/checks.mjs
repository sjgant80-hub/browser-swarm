// checks.mjs — the checks the cells' judges are built from. Pure and total: any input gives an answer, never a throw.
// Each check looks only at the output and the input the cell was given (and the signed corpus). None asks a model.

const str = (x) => (typeof x === 'string' ? x : '');
const get = (o, k) => { try { return o[k]; } catch { return undefined; } };   // null or undefined → undefined (only fixed field names are read)
export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// digits(s) → only the digits of s
export const digits = (s) => str(s).replace(/[^0-9]/g, '');

// norm(s) → lowercase, underscores and hyphens as spaces, punctuation dropped, spaces squeezed (how labels are compared)
export const norm = (s) => str(s).toLowerCase().replace(/[_-]/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// pickLabel(raw, labels) → the label the model named, or null. "none" (or nothing) → null. A label matches when the
// reply, normalised, IS it, or when exactly one label appears in the reply's first line as whole words.
export function pickLabel(raw, labels) {
  const line = norm(str(raw).split('\n')[0]);
  const list = Array.isArray(labels) ? labels.filter((l) => typeof l === 'string') : [];
  if (line === '' || /^none\b/.test(line)) return null;
  const exact = list.find((l) => norm(l) === line);
  if (exact !== undefined) return exact;
  const hits = list.filter((l) => norm(l) !== '' && ` ${line} `.includes(` ${norm(l)} `));
  const longest = hits.sort((a, b) => norm(b).length - norm(a).length);
  if (longest.length === 0) return null;
  // one label inside another ("card" in "card arrival") counts once: keep the longest, refuse a tie of unrelated ones
  const top = longest[0];
  return longest.every((l) => l === top || norm(top).includes(norm(l))) ? top : null;
}

// firstAmount(raw) → the first run of digits with , or . inside it on the reply's first line, as printed ('' if none)
export function firstAmount(raw) {
  const line = str(raw).split('\n')[0];
  if (/^\s*none\b/i.test(line)) return '';
  const m = line.match(/\d[\d.,]*\d|\d/);
  return m ? m[0].replace(/[.,]$/, '') : '';
}

// totalOnReceipt(receipt, value) → '' when the value is printed on a total line of the receipt, else the reason it is not.
// A total line says "total" and is not a subtotal; the value must have at least 3 digits (a receipt total, not a count).
export function totalOnReceipt(receipt, value) {
  const v = str(value).trim();
  if (digits(v).length < 3) return 'the value has fewer than 3 digits, so it is not a receipt total';
  const lines = str(receipt).split('\n');
  if (!lines.some((l) => printed(l, v))) return 'the value is not printed on the receipt';
  const ok = lines.some((l) => printed(l, v) && /total/i.test(l) && !/sub\s*-?\s*total/i.test(l));
  return ok ? '' : 'the value is printed, but not on a total line';
}

// printed(text, value) → the value is in the text as a whole number: "22.00" is not printed in "22.000", nor "200" in "1,200"
export function printed(text, value) {
  const v = str(value).trim();
  if (v === '') return false;
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9.,])${esc}(?![0-9]|[.,][0-9])`).test(str(text));
}

// isoDate(raw) → the first YYYY-MM-DD in the reply that is a real calendar date, else ''
export function isoDate(raw) {
  const m = str(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return '';
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= days ? m[0] : '';
}

// dateInText(iso, text) → '' when every part of the ISO date is said in the text, else the reason. The year must appear;
// the month as its name (or first three letters) or as its number; the day as a number of its own (01, 1, 1st).
// A day-first numeric date (dd/mm/yyyy) must match in that order exactly.
export function dateInText(iso, text) {
  const m = str(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'not an ISO date';
  const t = str(text).toLowerCase();
  const y = m[1], mo = Number(m[2]), d = Number(m[3]);
  const slash = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) return Number(slash[1]) === d && Number(slash[2]) === mo && slash[3] === y ? '' : 'the day-first date in the text says something else';
  const dotted = t.match(/\b(\d{4})\.(\d{1,2})\.(\d{1,2})\b/);
  if (dotted) return dotted[1] === y && Number(dotted[2]) === mo && Number(dotted[3]) === d ? '' : 'the year.month.day date in the text says something else';
  const nums = t.match(/\d+/g) || [];
  if (!nums.includes(y)) return `the year ${y} is not in the text`;
  const name = MONTHS[mo - 1];
  if (!new RegExp(`\\b${name.slice(0, 3)}`).test(t)) return `the month ${name} is not in the text`;
  return nums.some((n) => n !== y && n.length <= 2 && Number(n) === d) ? '' : `the day ${d} is not in the text`;
}

// firstInteger(raw) → the first whole number on the reply's first line (thousands separators allowed), or null
export function firstInteger(raw) {
  const line = str(raw).split('\n')[0];
  if (/^\s*none\b/i.test(line)) return null;
  const m = line.match(/\d{1,3}(?:,\d{3})+|\d+/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

// penceInText(p, text) → '' when the text states the amount p pence, else the reason. Read the other way round: the
// pounds and pence of p, rendered every way the text could say them, must be what the text's numbers say.
export function penceInText(p, text) {
  if (!Number.isSafeInteger(p) || p <= 0) return 'not a positive whole number of pence';
  const t = str(text).toLowerCase().replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d),(\d{3})/g, '$1$2');
  const pounds = Math.floor(p / 100), pence = p % 100;
  const two = String(pence).padStart(2, '0');
  const forms = [`${pounds}.${two}`];
  if (pence === 0) forms.push(`£${pounds}`, `${pounds} pounds`);
  if (pounds === 0) forms.push(`${pence}p`, `${pence} pence`, `0.${two}`);
  forms.push(`${pounds} pounds ${pence} pence`);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = forms.some((f) => new RegExp(`(^|[^0-9.])${esc(f)}($|[^0-9])`).test(t));
  return hit ? '' : `the text does not say ${pounds} pounds and ${pence} pence`;
}

// letterFacts(letter, record) → '' when the letter states every fact of the record word for word, says "refund", is at
// most 120 words and carries no number that is not part of one of the record's facts; else the reason
export function letterFacts(letter, record) {
  const l = str(letter);
  const facts = ['name', 'order', 'item', 'amount', 'date'].map((k) => str(get(record, k)));
  if (facts.some((f) => f === '')) return 'the record is missing a fact';
  const missing = ['name', 'order', 'item', 'amount', 'date'].find((k, i) => !l.includes(facts[i]));
  if (missing) return `the letter does not state the ${missing} as recorded`;
  if (!/refund/i.test(l)) return 'the letter does not say refund';
  if ((l.match(/\S+/g) || []).length > 120) return 'the letter is longer than 120 words';
  let rest = l;
  for (const f of facts) rest = rest.split(f).join(' ');
  const extra = rest.match(/\d+/);
  return extra ? `the letter carries a number that is not in the record (${extra[0]})` : '';
}

// INSTRUCTION: a sentence that gives orders to whoever reads it is not evidence (prompt injection lives in such sentences)
const INSTRUCTION = /\b(ignore|disregard|forget)\b[^.!?]*\b(instruction|instructions|question|above|previous|prompt|rules)\b|\b(you are|as an?)\s+(an?\s+)?(ai|assistant|language model|chatbot)\b|\b(answer|reply|respond|say)\s+(only\s+)?(with|that)\b[^.!?]*\b(answer|reply)\b|\bthe (correct |real |true )?answer is\b/i;
export const isInstruction = (sentence) => INSTRUCTION.test(str(sentence));

// answerKind(question, answer) → '' when the answer is the kind of thing the question asks for, else the reason.
// when / what year / which year / what century → a number or a month; how many / how much / how long / how old → a number
// (digits or a number word); who / whom / whose → a capitalised word. Other questions are not typed.
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|billion|dozen|several|first|second|third|fourth|fifth)\b/i;
export function answerKind(question, answer) {
  const q = str(question).toLowerCase().trim(), a = str(answer);
  const hasNumber = /\d/.test(a) || NUMBER_WORDS.test(a);
  if (/^(when|(in )?(what|which) (year|century|decade|month|day|date))\b/.test(q) || /\b(what|which) (year|century|decade)\b/.test(q)) {
    return hasNumber || MONTHS.some((m) => a.toLowerCase().includes(m)) ? '' : 'the question asks when, and the answer is not a date or a number';
  }
  if (/\bhow (many|much|long|old|far|big|large|tall)\b/.test(q)) return hasNumber ? '' : 'the question asks how much, and the answer is not a number';
  if (/^(who|whom|whose)\b/.test(q)) return /[A-Z]/.test(a) ? '' : 'the question asks who, and the answer names nobody';
  return '';
}

// overlap(a, b, tokensOf) → the content tokens a and b share (tokensOf is the corpus tokenizer)
export function overlap(a, b, tokensOf) {
  const tb = new Set(typeof tokensOf === 'function' ? tokensOf(b) : []);
  return (typeof tokensOf === 'function' ? tokensOf(a) : []).filter((t) => tb.has(t));
}

// jaccard(ta, tb) → |ta ∩ tb| / |ta ∪ tb| of two token lists (0 when both are empty)
export function jaccard(ta, tb) {
  const A = new Set(Array.isArray(ta) ? ta : []), B = new Set(Array.isArray(tb) ? tb : []);
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

// mcqLetter(raw, options) → 'A'..'D' from a multiple-choice reply: a leading letter, "answer: X", or an option's text, else ''
export function mcqLetter(raw, options) {
  const s = str(raw).trim();
  let m = s.match(/^\(?([ABCD])\)?(?:[.):\s]|$)/);
  if (m) return m[1];
  m = s.match(/answer\s*(?:is)?\s*[:\-]?\s*\(?([ABCD])\b/i);
  if (m) return m[1].toUpperCase();
  const line = norm(s.split('\n')[0]);
  const hits = ['A', 'B', 'C', 'D'].filter((k) => norm(get(options, k)) !== '' && norm(get(options, k)) === line);
  return hits.length === 1 ? hits[0] : '';
}

export default { MONTHS, digits, norm, pickLabel, firstAmount, totalOnReceipt, printed, isoDate, dateInText, firstInteger, penceInText, letterFacts, isInstruction, answerKind, overlap, jaccard, mcqLetter };
