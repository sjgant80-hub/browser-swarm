import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import R from '../src/read.mjs';
import C from '../src/checks.mjs';

test('readDate: every form it reads, and the first build\'s separate check agrees', () => {
  const good = [
    ['3 March 2025', '2025-03-03'], ['March 3, 2025', '2025-03-03'], ['the 22nd of October 1987', '1987-10-22'], ['14/02/1999 (day first)', '1999-02-14'],
    ['Friday 9 August 2041', '2041-08-09'], ['6th Jan 2008', '2008-01-06'], ['2003.12.25', '2003-12-25'], ['delivered on 7 May, 2014', '2014-05-07'],
    ['Sept 5 2016', '2016-09-05'], ['Sep 5 2016', '2016-09-05'], ['1 DECEMBER 2020', '2020-12-01'], ['21st June 2020', '2020-06-21'], ['June 22nd 2020', '2020-06-22'],
    ['23rd Jun 2020', '2020-06-23'], ['4th July 2020', '2020-07-04'], ['29 February 2024', '2024-02-29'], ['20/07/2011', '2011-07-20'], ['13/09/2000', '2000-09-13'],
    ['05/09/2000 (day first)', '2000-09-05'], ['5/9/2000 (Day First)', '2000-09-05'], ['2012.2.5', '2012-02-05'], ['31 January 1990', '1990-01-31'], ['2020 Nov 30', '2020-11-30'],
    ['05/09/2000 (day first) May', '2000-09-05'], ['2012.11.04 in March', '2012-11-04'], ['10 Apr 2001', '2001-04-10'], ['10 Feb 2001', '2001-02-10'], ['10 Aug 2001', '2001-08-10'], ['10 Oct 2001', '2001-10-10'],
  ];
  for (const [text, iso] of good) { assert.equal(R.readDate(text), iso, text); assert.equal(C.dateInText(iso, text), '', `the first build's check on ${text}`); }
});

test('readDate: nothing is read where it would take a guess', () => {
  const none = [
    '3 March 2025 to 2026', '3 March', '3 March 20255', '05/09/2000', '12/09/2000', '31/02/2016 (day first)', '2012.13.04', '2012.02.30', '3 May 2020, it may rain',
    '3 of 2020', '3 March 2025 at 5', 'March 2025', '31 June 2020', '29 February 2023', '3 marching 2020', 'decem 5 2020', '0 March 2020', '05/09/2000 May', 'septe 5 2016',
    '5 sept 2016 mar', '', 'no date here', '105 March 2020', '3rd 4th March 2020', 'the year 2020',
  ];
  for (const text of none) assert.equal(R.readDate(text), '', text);
  for (const x of [null, undefined, 42, {}, ['3 March 2025']]) assert.equal(R.readDate(x), '');
});

test('readPence: every form it reads, and the first build\'s separate check agrees', () => {
  const good = [
    [245305, '£2453.05'], [78441, '784 pounds 41 pence'], [45, '45p'], [1200, '£12'], [1200, '12 pounds'], [231000, 'a charge of £2,310.00'], [705, 'GBP 7.05'],
    [197999, '1,979.99 pounds'], [41, '£0.41'], [9, '9 pence'], [123456789, '£1,234,567.89'], [4500, '45 pounds'], [399, '3 pounds 99 pence'],
    [309, 'about 3 pounds 9 pence, thanks'], [98, 'GBP 0.98'], [131114, 'a charge of £1,311.14'], [91, '91p'], [1210, '£12.10'],
  ];
  for (const [p, text] of good) { assert.equal(R.readPence(text), p, text); assert.equal(C.penceInText(p, text), '', `the first build's check on ${text}`); }
  // read here, though the first build's check would not pass them: the two must agree before anything is released
  assert.equal(R.readPence('3 pounds and 9p'), 309); assert.equal(R.readPence('5 p'), 5); assert.equal(R.readPence('1 pound 5p'), 105); assert.equal(R.readPence('1 pound'), 100);
});

test('readPence: nothing is read where it would take a guess', () => {
  const none = ['£12.5', '£12.505', 'no numbers', '1 2 3', '12', '12.50', '£0.00', '0p', '£5 and 20p', '3 pounds 100 pence', '12.50p', '£12 5p', '45p in pounds', '1,2 pounds',
    '£99999999999999999999', '3 pounds 9 pence extra 4', '3 pounds 9', '9 pence 3 pounds', '£', 'pounds and pence', '', '£1.2.3', '4 5 pounds'];
  for (const text of none) assert.equal(R.readPence(text), null, text);
  for (const x of [null, undefined, 42, {}, ['45p']]) assert.equal(R.readPence(x), null);
});

test('on the tuning tasks: every date and every amount is read right, and passes the first build\'s check', () => {
  const rd = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
  const pool = [...rd('data/suite.json').dev, ...Object.values(rd('data/tune2.json')).filter(Array.isArray).flat()];
  const dates = pool.filter((t) => t.kind === 'date'), money = pool.filter((t) => t.kind === 'pence');
  assert.ok(dates.length >= 40 && money.length >= 40);
  for (const t of dates) { assert.equal(R.readDate(t.input.text), t.gold.iso, t.input.text); assert.equal(C.dateInText(t.gold.iso, t.input.text), ''); }
  for (const t of money) { assert.equal(R.readPence(t.input.text), t.gold.pence, t.input.text); assert.equal(C.penceInText(t.gold.pence, t.input.text), ''); }
});
