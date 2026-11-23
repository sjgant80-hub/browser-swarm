# A follow-up claim — written after the fix failed its safety claim, and before any fresh-set result was known

**What happened.** The decomposed build was run on the sealed 410 under `CLAIMS-2.md`. Usefulness passed: 57.6% of the
bounded work right, up from 33.9%. Safety failed, by one: 6 silent failures against a bar of 5. That failure stands.
`CLAIMS-2.md` is not edited, and claim D1 stays failed on the page, in red.

**Where the failure came from.** Four of the 6 silent failures were on the banking desk, whose yes-or-no plan had been
adopted on tuning data by one point of score (5 against 4). The other 2 were on the department desk, which runs as the
first build does. The documents, receipts, dates, amounts and letters desks released no wrong answer.

**The follow-up.** One change: the banking desk goes back to the first build's one-call form. Everything else in the
decomposed build is unchanged, byte for byte (seal 3 still holds for the code). The settings are in
`data/settings3.json`. This is called the follow-up build.

## What a reader should know before trusting this

- **This claim was chosen after seeing a failure.** The follow-up build was picked by looking at where the decomposed
  build's wrong answers fell on the sealed 410. So its result on the sealed 410 is not evidence: it is reported, and
  it is not a claim.
- **It is judged on the fresh 410 only**, the tasks of `data/test2.json`. When this file was committed, both builds' runs
  on the fresh 410 were still in progress in a browser tab and neither result had been seen. The commit time of this
  file and the start and end times recorded in those run files show the order.
- **No new model run is needed, and none is made.** On every task the follow-up build makes exactly the model calls one
  of the two registered builds makes: the first build's on a banking message, the decomposed build's on everything else.
  So its record on the fresh 410 is assembled from the two registered runs: the first build's records for the banking
  tasks, the decomposed build's for the rest. Every one of those 410 decisions is then decided again by the follow-up
  build's own code from the recorded replies, and the record counts only if all 410 come out the same.

## The claims

| id | claim | bar |
|---|---|---|
| **E1** | safety, on tasks never seen | at most 5 silent failures on the fresh 410 |
| **E2** | usefulness, on tasks never seen | at least 47.2% of the 330 bounded tasks of the fresh 410 right |

Both must hold for the follow-up build to become the page's default build. If either fails, the first build stays the
default and the page says so in red.

## Reported without a bar

- The follow-up build on the sealed 410, assembled the same way, marked as seen data.
- The decomposed build's own verdicts on the fresh 410 (D5, D6, D7), which are not changed by this file.
