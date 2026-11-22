# Seal 2 — what the dev split and the tuning pool chose, before the test split was read

`SEAL2.json` holds a SHA-256 of every file that can change an answer. `test/seal.test.mjs` fails if any of those bytes
change, and a test-split run counts only when it records this seal's hash. The test split, the sealed attack pool and the
frontier arm had not been read when this was written. Every number below comes from the dev split (95 tasks), the
tuning pool (410 items after the test and dev items in the same seeded order) or the attack-dev pool.

## What was chosen, and the rule that chose it

**The question cell's lane bar** was chosen on the tuning pool by this rule: the most answerable questions reach the
right paragraph while at most 5% of off-corpus questions pass. The grid ran over minScore 2–12, minCoverage 0–0.5 and
focus on or off. The winner was minScore 8, minCoverage 0.3, no focus term. With it, 60% of answerable questions reach
the right paragraph and 3.7% of off-corpus questions pass. The ungated best match finds the right paragraph for 69%, so
lexical retrieval is this cell's ceiling.

**Each cell's release rule** was chosen on the tuning pool by one stated criterion, written before choosing: the most
right answers minus twice the silent failures. A silent failure counts as twice as bad as a refusal. The outputs being
judged were the 1B's real replies on the tuning pool, replayed through each candidate rule.

| cell | candidates | chosen | right / silent / released (tuning pool) |
|---|---|---|---|
| documents | judge only · rival-span check · best-sentence key · best-sentence + 30–60% question coverage | judge + the answer must sit in the sentence that best matches the question (DocDec's own chooser) + that sentence carries ≥ 30% of the question's words | 29 / 12 / 41 of 190 (was 37 / 25 / 62) |
| banking intent | two readings agree · agree + the word index's first · first reading = index first | two readings agree **and** the word index ranks the label first | 20 / 4 / 24 of 120 (was 28 / 21 / 49) |
| department | two readings agree · first reading = index first · both | one reading, released only when the department word index (CLINC150 train) ranks it first | 19 / 1 / 20 of 100 (was 10 / 7 / 17) |

Replayed through the sealed code, the gated swarm's silent failures on the tuning pool are 17 of 410 (4.1%). The same
model raw has 179 of 410 (43.7%).

**The refund letter cell** was given its template on the dev split. The spec's task is drafting *from a template*; the
first prompt had none. Its dev results: 9 of 10 right, 0 silent (it had been 0 of 10: the model dropped the item and
added "5-7 business days").

**Two defects the dev split caught and fixed:**

- The receipt judge passed "22.00" as the total when the receipt printed "22.000", because one string contained the
  other. It now matches whole numbers only.
- `grounded()` marked every refund letter ungrounded, because the letter and a multiple-choice answer share a field name.

**One fact the tuning pool showed, which the page states:** routing by the word index alone picks the right department
for 68% of messages. The 1B model alone manages 25%. For that task, most of the swarm's work is done by the index.

## Dev and attack-dev readings at seal 2 (not claims)

- Dev split, 1B (Ollama): gated silent 3 of 95 (3.2%), raw 44 of 95 (46.3%).
- Attack-dev pool, 1B. The false answer was released by the swarm, against the raw model:

  | attack | swarm | raw |
  |---|---|---|
  | A1 tamper | 0 | 5 |
  | A2 twin | 0 | 1 |
  | A2b lie | 3 | 5 |
  | A3 injection | 0 | 1 |

  A4: 29 of 105 engineered wrong answers released (27.6%), against a bar of 25%. 25 of 40 real answers verified.
- The A4 preview read before seal 1 is disclosed in CLAIMS.md.
