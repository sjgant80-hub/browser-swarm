// read.mjs — two readers written as code, for the date desk and the pence desk of the decomposed build.
// The first build asked the model for the date or the amount and then checked the reply against the text. Decomposing
// those two jobs ended somewhere plain: every step the model was asked for, code can read off the text exactly. So on
// these desks no model is asked. The text is read here, and the reading still has to pass the first build's check,
// which is separate code (checks.mjs: dateInText, penceInText). Two readings that disagree release nothing.
// Pure and total. A text in a form these do not read without a guess gets no answer.
import { MONTHS, isoDate } from './checks.mjs';

const str = (x) => (typeof x === 'string' ? x : '');
const pad = (n) => String(n).padStart(2, '0');
const SLASH = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/, DOTTED = /\b(\d{4})\.(\d{1,2})\.(\d{1,2})\b/;
const monthOf = (word) => MONTHS.findIndex((name) => word === name || word === name.slice(0, 3) || (word === 'sept' && name === 'september'));

// readDate(text) → the one date the text writes, as YYYY-MM-DD, or '' when it is not in a form read without a guess.
// Read: dd/mm/yyyy when the text says "day first" (or the first number is over 12); yyyy.mm.dd; and a day, a month
// by name (or its first three letters) and a year in any order, when there is exactly one of each.
export function readDate(text) {
  const t = str(text).toLowerCase();
  const years = t.match(/\b\d{4}\b/g) || [];
  if (years.length !== 1) return '';
  const slash = t.match(SLASH);
  if (slash) return /day first/.test(t) || Number(slash[1]) > 12 ? isoDate(`${slash[3]}-${pad(slash[2])}-${pad(slash[1])}`) : '';
  const dotted = t.match(DOTTED);
  if (dotted) return isoDate(`${dotted[1]}-${pad(dotted[2])}-${pad(dotted[3])}`);
  const months = (t.match(/[a-z]+/g) || []).map(monthOf).filter((i) => i >= 0);
  const days = t.match(/\b\d{1,2}(?:st|nd|rd|th)?\b/g) || [];
  if (months.length !== 1 || days.length !== 1) return '';
  return isoDate(`${years[0]}-${pad(months[0] + 1)}-${pad(parseInt(days[0], 10))}`);
}

// readPence(text) → the amount the text writes, in whole pence, or null when it is not in a form read without a guess.
// Read: pounds with exactly two digits of pence (£12.50, GBP 12.50, 1,204.99 pounds); whole pounds (£12, 12 pounds);
// pence alone (45p, 45 pence); and "3 pounds 9 pence". Thousands commas are allowed. Anything else is not read.
export function readPence(text) {
  const t = str(text).toLowerCase().replace(/(\d),(?=\d{3})/g, '$1');
  const nums = t.match(/\d+(?:\.\d+)?/g) || [];
  const pounds = /£|gbp|pound/.test(t), pence = /\d\s*p\b|pence/.test(t);
  let p = null;
  if (nums.length === 1) {
    const [whole, part] = nums[0].split('.');
    if (part !== undefined) p = pounds && !pence && part.length === 2 ? Number(whole) * 100 + Number(part) : null;
    else if (pounds !== pence) p = pounds ? Number(whole) * 100 : Number(whole);
  } else if (nums.length === 2) {
    const m = t.match(/^\D*(\d+)\s*pounds?\s*(?:and\s*)?(\d+)\s*(?:p\b|pence)\D*$/);
    if (m && Number(m[2]) < 100) p = Number(m[1]) * 100 + Number(m[2]);
  }
  return Number.isSafeInteger(p) && p > 0 ? p : null;
}

export default { readDate, readPence };
