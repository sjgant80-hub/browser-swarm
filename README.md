# Browser Swarm

**Live: https://sjgant80-hub.github.io/browser-swarm/** · open it, load the model once, watch the company work, and re-run every number on your own GPU.

Small AI cells in a browser tab that refuse rather than guess. One 1B model runs on your own GPU through WebLLM, and
seven specialist cells run over it, each with a lane check before the model and a judge after it. Only what a judge
verifies is released. Nothing leaves the device, and nothing is charged per question.

The headline is the **silent-failure rate**: how often a wrong answer is delivered as if it were right. It was measured
on 410 sealed test tasks and pre-registered before any model saw one.

- [CLAIMS.md](CLAIMS.md) — the claims and their bars, seal 1 (`08dc357`), committed before the test.
- [SEAL2.md](SEAL2.md) — what the dev split and tuning pool chose, and the rule that chose it. Seal 2 (`1983e89`) froze
  every file that can change an answer, by hash.
- [CLAIMS-2.md](CLAIMS-2.md) — the claims for the fix (the decomposed build), committed before it read a sealed task.
- [SEAL3.md](SEAL3.md) — what the tuning data chose for the fix, desk by desk, and the rule that chose it. Seal 3 froze
  the decomposed build by hash, and names seal 2, which still holds for the first build.
- `data/runs/` — every published run, with every model reply. The page re-decides them all in your browser, and CI
  re-decides them on every push (`scripts/replay.mjs --check`).

## What is in it

| path | what |
|---|---|
| `src/cells.mjs` | the seven cells: lane, prompt, parser, judge (gated) |
| `src/swarm.mjs` | the conductor and the guard around any model; the raw arm; replay (gated) |
| `src/checks.mjs`, `src/sha256.mjs` | the checks the judges are made of; the signed-corpus hash (gated) |
| `src/score.mjs`, `src/claims.mjs`, `src/cost.mjs` | the scoring rules, the claim verdicts, the buyer's cost case (gated) |
| `src/adversary.mjs` | the attacks on the checks (gated) |
| `src/diagnose.mjs` | one cause for every task the swarm did not answer: correct refusal, model too weak, or gate too strict (gated) |
| `src/atoms.mjs`, `src/assembly.mjs`, `src/read.mjs` | the decomposed build: the small questions asked of the model, each desk's plan and the code that assembles checked atoms, and the two code readers (gated) |
| `src/claims2.mjs` | the adoption rule and the verdicts on the fix's claims (gated) |
| `vendor/` | the Estate Genome's guard and conductor and DocDec's router, gate and statistics, byte for byte (`vendor/PROVENANCE.json`) |
| `scripts/` | build the suite, run on Ollama, run the attacks, replay, seal, build the page |
| `page/`, `index.html` | the page; every kernel inlined byte for byte, and every published number baked into the HTML by running the page script at build time (`scripts/make-page.mjs`, `test/page.test.mjs`) |
| `scripts/publish-tab.mjs` | publishes a run made in a browser tab, only if it is the full sealed test and every decision replays |
| `scripts/publish-fix.mjs` | publishes a run of the fix only if it is complete, under both seals, and every decision replays; `--check` repeats that in CI |
| `scripts/run-frontier.mjs` | the frontier arm, through a spend wall, under its owner's written approval and cap |

Mutation gate: witness v0.6, every gated file CLEAN (`data/gates.json`). One equivalent mutant (the same line, in two files) is baselined with its
written reason (`src/witness.baseline.json`).

## Run it yourself

```bash
node --test test/*.test.mjs                                   # every test, including seal 2, seal 3 and the page build
node scripts/run-node.mjs --model llama3.2:1b --split dev     # both arms on a model served by Ollama on 127.0.0.1
node scripts/replay.mjs data/runs/<run>.json --check          # re-decide a published run from its replies
node scripts/make-page.mjs                                    # rebuild index.html
```

MIT licence (holder Simon Gant). Built by Kar. Supplied by [AI Native Solutions](https://www.ai-nativesolutions.com).
Data licences: see [NOTICE](NOTICE).
