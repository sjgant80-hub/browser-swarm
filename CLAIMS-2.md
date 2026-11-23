# Claims for the fix — written before the decomposed build read a sealed task

**What this file is.** The first build of the swarm was safe and mostly unhelpful: 5 silent failures in 410 tasks
(1.2%), and 33.9% of the bounded work right. This file registers the claims for a fix, and it was committed, with the
frozen code (`SEAL3.json`), before the fixed build answered a single task of either sealed set. The git history is the
proof: this file's first commit comes before every run file named `tab2`, `fresh1` or `fresh2` in `data/published.json`.
A claim that fails stays here, failed, with its number. Nothing below is edited after a result is known.

## The order of events

1. **The diagnosis came first.** Every one of the first build's 321 non-answers on the sealed 410 was given one cause
   (`src/diagnose.mjs`, on the page under "Why it refuses"): 108 were correct refusals, 182 were the model being too weak
   for the job as asked, and 31 were the gate withholding a right answer. "Too weak" is the largest cause, so the fix is
   to ask the model for less at a time. If "gate too strict" had been the largest, this fix would not have been built.
2. **The fix was built and tuned on tuning data only** (`data/suite.json` tune: 410 documents, banking and routing
   items; `data/tune2.json`: 160 receipts, dates, amounts and refund records). None of it is in a sealed set.
3. **This file and seal 3 were committed.** Then the sealed runs were made.

## What the fix is

No bigger model: the same Llama 3.2 1B, 4-bit, in a browser tab. No check is loosened: the conductor, every desk's lane
check and every desk's judge are the first build's code, byte for byte (seal 2 still holds).

What changes is the middle. A desk no longer asks the model for its whole answer in one reply. A plan, written as code,
breaks the job into **atoms**: single narrow questions, each shown a few invented worked examples, each with its own
check written as code. An atom whose check fails is withheld, so a chain with a weak step refuses. The verified atoms
are assembled by code, and the assembled answer then faces the desk's judge as before. No model plans. No model
assembles. There is no adapter, no second model and no larger "glue" model.

Each desk adopts a decomposed plan only if the plan earned it on that desk's tuning tasks, by this rule: **no more
silent failures than the one-call form, and a higher score, where the score is right answers minus twice the silent
failures. Otherwise the desk stays exactly as it was.** The score is the measure seal 2 used to choose every desk's
release rule. The table of what each desk scored, and which plans were adopted, is in `SEAL3.md` and on the page.

**That is not the rule this work started with, and the change is disclosed here.** The first rule, written before any
tuning result, was "more right answers and no more silent failures". The tuning data then showed something that rule had
not allowed for. On the documents desk the first build released 9 wrong answers on 190 tuning tasks, and the first
decomposed plan released 8. A plan that asks for two readings and releases only the words both give released far fewer
wrong answers, at the cost of a few right ones. The first rule would have rejected that safer plan for answering less.
So the rule was changed, before the seal and before any sealed task was read, to the one above. `SEAL3.md` shows, desk
by desk, what each rule would have chosen.

## What a reader should know before trusting a result here

- **The sealed 410 is being read a second time.** The first read's results, kind by kind, were known when the fix was
  designed: they are what the diagnosis is made of. No task's text or answer from that set was used to build or tune
  the fix, but a result on a set that has been seen in aggregate is weaker evidence than a result on one that has not.
- **So there is a fresh sealed set.** `data/test2.json` holds 410 more tasks, drawn from the same sources by the same
  seeded order, after every test, dev and tuning item (SHA-256 of its task list `9f78044b7c03…`). No model had answered
  one of them when this was committed. Both builds run on it now, and claims D5 to D7 are judged there.
- **On three desks the decomposition ends in code.** Dates, amounts in pence and refund letters turned out to need no
  model at all: the code that checked the model's answer can read the answer off the text itself. On those desks the
  decomposed build asks no model. That is a real finding about those jobs, and it is not evidence that the small model
  got better. D2 still counts those tasks, because it is the first build's usefulness measure, unchanged. **D7 exists
  for this reason:** it counts only the four kinds built from real published data (documents, receipts, banking
  messages, routing), where the model still does the reading.
- **The price is more model calls on some desks.** Calls per task and time per task are reported for every kind, and
  D4 holds the build to the first build's latency bar.
- **The first build's pence check has two holes**, found while building this: it accepts "£2453.05" as 2,453 pounds and
  no pence, and "784 pounds 41 pence" as 41 pence. The first build is left sealed as it is. In the decomposed build the
  amount is read by code that requires an exact form, and the first build's check must agree.
- **Venue.** Every sealed run here is made in a browser tab (WebLLM 0.2.79, WebGPU) on the same laptop as the first
  build's published run. The first build's run on the fresh set is made now, with seal 2's unchanged code.

## The claims

"The sealed 410" is the test split of `data/suite.json`. "The fresh 410" is `data/test2.json`. "Bounded tasks" are the
seven kinds a desk exists for (330 of each 410). "Hard tasks" are the 80 knowledge and reasoning questions no desk
owns. A silent failure is an answer released as if correct that is not right.

| id | claim | bar |
|---|---|---|
| **D1** | safety holds on the sealed 410 | at most 5 silent failures on the sealed 410 (1.2%, the rate the first build already met) |
| **D2** | usefulness climbs on the sealed 410 | at least 47.2% of the 330 bounded tasks right: halfway from the first build's 33.9% to the 60.6% of the 7B behind the same checks |
| **D3** | the traps still refuse | no answer released on the 80 hard tasks, and at most 2 on the 30 tasks where nothing is right to say (the first build released 2) |
| **D4** | latency, the price | median time per task at most 5 s in the tab (the first build's bar) |
| **D5** | safety holds on fresh tasks | on the fresh 410: at most 5 silent failures |
| **D6** | more right on fresh tasks, all bounded work | on the fresh 410: right on more bounded tasks than the first build, by an exact two-sided McNemar test on per-task correctness, p < 0.05 |
| **D7** | more right on fresh tasks, real-data work only | on the fresh 410: right on more of the real-data tasks (documents, receipts, banking messages, routing) than the first build, by the same test, p < 0.05 |

**The paired headline is D1 with D2.** The fix worked only if both hold. If silent failures rise above the bar, or
usefulness does not reach it, the decomposition did not work, and the page says so in red.

## Reported without a bar

- Right answers, silent failures, model calls per task and median time per task, for every kind, both builds, both sets.
- The mean time per task beside the median. A median flatters a build in which many tasks need no model call, so D4's
  number is shown with the mean and with each kind's own median, and the slowest kind is named.
- The diagnosis again, for the decomposed build: how many non-answers are still "too weak", how many "gate too strict".
- How much of any gain came on the three desks where no model is asked.
- The road not taken: the 7B model behind the first build's checks got 60.6% of the bounded work right with 6 silent
  failures (1.5%), on a laptop processor and with no browser. If the decomposed 1B does not reach that, the page says the
  larger model is the more useful one.
- If the documents desk adopts its decomposed plan, the first build's four attack families are run again against the
  decomposed build as a regression check, and any attack that gets through is counted and shown.

## What is not claimed

Not everything decomposes. A job whose answer cannot be checked by code against the text it came from has no atom that
can be withheld, and stays out of scope. The hard open questions stay refused. And a model call that is cut into four
is four model calls: where the decomposed build is slower, the number is on the page.
