# Seal 3 — the decomposed build, frozen before it read a sealed task

`SEAL3.json` holds a SHA-256 of every file that makes the decomposed build what it is: the atoms, the plans and the
assembly, the two code readers, the claims kernel and the claims file, the settings and the adoption table below, the
second tuning pool, and the fresh sealed set. It also names seal 2, which still holds: the first build's code is
unchanged, byte for byte. `test/seal.test.mjs` fails if any sealed byte changes, and a run of the fix counts only when it
records both seals' hashes. When this was written, the decomposed build had not answered one task of the sealed 410 or
of the fresh 410, and the first build had not answered one task of the fresh 410.

Every number below comes from tuning tasks: the tune pool of `data/suite.json` (190 documents questions, 120 banking
messages, 100 routing messages) and `data/tune2.json` (40 receipts, 40 dates, 40 amounts, 40 refund records). They were
measured in a browser tab with the 4-bit 1B. They chose the build. They are not evidence for a claim.

## What the decomposed build is

- **Atoms** (`src/atoms.mjs`): one narrow question to the model, a few invented worked examples given as earlier turns of
  the conversation, and a check written as code. None of the examples comes from any split or pool.
- **Plans and assembly** (`src/assembly.mjs`): for each desk, the code that breaks the job up, puts each atom through the
  guard on its own, and assembles the atoms that passed. The assembled answer faces the desk's judge. The conductor, the
  lane checks and the judges are the first build's, unchanged.
- **Code readers** (`src/read.mjs`): dates and amounts read straight off the text, in the written forms that need no
  guess. The first build's check, which is separate code, must agree.
- **Settings** (`data/settings2.json`): how many total lines the receipts plan reads (4), how many intents the banking
  plan asks about (3), how many departments the routing plan asks about (2). These were set once, by judgment, before the
  tuning runs. They were not searched.

No adapter, no second model, no larger "glue" model. No model plans and no model assembles.

## The rule that chose, desk by desk

A desk switches to a decomposed plan only if, on its tuning tasks, the plan has **no more silent failures than the
one-call form and a higher score**, where the score is right answers minus twice the silent failures. That score is the
measure seal 2 used to choose every desk's release rule. Otherwise the desk stays exactly as it was. "Right" counts a
correct refusal on a task where nothing is right to say.

**The rule changed once, before this seal.** The work started with a simpler rule, written before any tuning result:
more right answers and no more silent failures. The tuning data then showed a case that rule had not allowed for. On
the documents desk a plan appeared that answers a little less and is wrong far less often. The first rule would have
turned it down for answering less, and adopted a leakier plan. So the rule was replaced with the one above. The last
column of the table shows what the first rule would have chosen, so the effect of the change can be seen.

| desk | tuning tasks | first build, one call: right / silent (score) | decomposed plan: right / silent (score) | model calls per task | decision | the first rule would have |
|---|---|---|---|---|---|---|
| documents | 190 | 117 / 9 (99) | 116 / 1 (114) | 0.66 | **decomposed** | adopted the one-sentence plan (119 / 8) |
| receipts | 40 | 16 / 0 (16) | 32 / 0 (32) | 0.82 | **decomposed** | adopted this plan |
| banking intent | 120 | 12 / 4 (4) | 7 / 1 (5) | 1.51 | **decomposed** | kept one call |
| department | 100 | 29 / 2 (25) | 34 / 6 (22) | 1.5 | **not adopted**: 6 silent failures against 2 | kept one call |
| dates | 40 | 29 / 0 (29) | 40 / 0 (40) | 0 | **decomposed** (code reads it) | adopted this plan |
| amounts in pence | 40 | 8 / 1 (6) | 40 / 0 (40) | 0 | **decomposed** (code reads it) | adopted this plan |
| refund letters | 40 | 24 / 0 (24) | 40 / 0 (40) | 0 | **decomposed** (code fills it) | adopted this plan |

The same table, with each plan in words, is `data/adoption.json` and is on the page.

## The plans that were adopted

- **Documents: two readings that must agree.** The model reads the whole paragraph, with the first build's own prompt.
  Separately it reads only the one sentence that best matches the question, which code picks. Each phrase must be the
  text's own words. Only the words both readings give are released. If they differ, or either finds no answer, the desk
  refuses. On the tuning tasks the two readings made different mistakes: of the wrong answers each one released, one was
  the same in both.
- **Receipts.** Code finds the lines that say "total" and carry an amount. The model copies the amount off each line, and
  the amount must be printed on that line. If the lines differ, the model is asked which is the final total.
- **Banking intent.** The word index shortlists three intents. The model is asked yes or no for each. It must say yes to
  the first and no to the others. This desk was adopted by one point of score (5 against 4). It gets fewer right than
  the one-call form (7 against 12) and far fewer wrong (1 against 4).
- **Dates, amounts, refund letters.** No model is asked. Code reads the date or the amount, or fills the letter from the
  record's fields, and the first build's check must pass.

## What was tried and not chosen

- **Documents, one sentence only.** The model reads just the best-matching sentence: 119 right, 8 silent, 23 answers
  released. It answered more and was wrong almost as often as the first build. Six of its 8 wrong answers were on
  questions the paragraph does not answer: shown one sentence, the model always finds a phrase in it. Decomposing had
  removed the context the refusal depended on.
- **Dates as three atoms** (year, month, day): 25 right of 40, fewer than the one-call form's 29. Asked for the month as
  a number, the model often gave the day.
- **Amounts as two atoms** (pounds, pence): 22 right of 40. The model misread the pence in almost half.
- **Department, yes or no for the first two departments:** 34 right, 6 silent. Five of the 6 wrong answers were on
  messages that belong to no department: the model says yes to a department anyway. Not adopted. The department desk
  runs as the first build does.

## What the tuning data showed about the first build

- **Its documents desk leaks more than the sealed set showed.** On the 190 tuning questions the first build released 21
  answers and 9 were wrong: 5 on the 30 trick questions (questions the paragraph does not answer), 4 on the 80
  answerable ones. On the sealed 410, which holds 10 trick questions, it released 8 answers and none was wrong. The
  tuning number says that zero was partly luck. The fresh 410 will show.
- **Its pence check has two holes.** It accepts "£2453.05" as 2,453 pounds and no pence, and "784 pounds 41 pence" as
  41 pence. One wrong amount passed it on the tuning tasks. The first build is left sealed as it is.

## A pattern, from tuning data only

Where an atom is a **copy** that code can check against the text (the amount printed on this line), the small model
does it well and the check catches the rest. Where an atom is a **judgment** with nothing to check it against (is this
message about this topic, yes or no), the small model is no better at the small question than at the whole job. And
where every step of a job is a copy, code can do the whole job and the model is not needed. This is a reading of the
tuning data. It is not a sealed result, and the page does not present it as one.

## What the first read of the sealed set told the builder

The first build's results on the sealed 410, kind by kind, were known before the fix was designed. They are the
diagnosis: which kinds were refused, and why. No task text or answer from the sealed 410 was used to write an atom, a
plan, a reader or an example, and nothing was tuned on it. But the choice of which desks to work on was informed by that
first read, so a result on the sealed 410 is weaker evidence than one on tasks never seen. That is why claims D5 to D7
are judged on the fresh 410 (`data/test2.json`), drawn from the same sources by the same seeded order after every test,
dev and tuning item.

## How the sealed runs are made

Three runs, all in a browser tab on the published page (WebLLM 0.2.79, WebGPU, the same laptop as the first build's
published run): the decomposed build on the sealed 410; the first build on the fresh 410; the decomposed build on the
fresh 410. Each run records both seals' hashes, the browser, the GPU, how many sittings it took (a run resumes if the
tab is closed), and every model reply. `scripts/publish-fix.mjs` publishes a run only if it is complete, made under
both seals by the build it says, answers every task exactly once, and every decision in it replays identically from
its recorded replies. CI repeats that check on every push.
