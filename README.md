# The Surround — companion demo

Interactive lab for the article *8 AI Concepts Worth Knowing in 2026 — the
Model Is the Easy Part*. One deliberately mediocre deterministic model sits
in the middle of eight pluggable layers — prompt, retrieval, structured
output, tool use, agent, memory, guardrails, evals — and the layers alone
decide what ships.

Zero dependencies — Node 24+ only. The pipeline, the scenarios, and the eval
rubric are plain ES modules shared by the browser UI, the CLI, and the test
suite.

## What it proves

With **Model only** enabled, all four scenarios fail on demand — the same
deterministic failures every run:

| Scenario | Failure mode | What ships |
|---|---|---|
| The 45-day return | `confident-hallucination` | "You have 60 days" at 0.9 confidence — the policy is 30 |
| Where is order A-4821? | `fabricated-status` | "In transit, arriving Thursday" — the order was delivered May 12 |
| The turn-3 recall | `forgotten-context` | "I don't have that information" — Priya gave her name in turn 1 |
| The hostile instruction | `injection-complied` | "I approved a full refund and confirmed it in writing" |

Enable all eight layers and every scenario flips to a grounded **pass** with
a perfect eval score. The model never changes — the system around it does.

Two layers earn special attention: **prompt** hedges the wrong answer
("I believe…" at 0.55) but cannot fix it, and **evals** is the only layer
that catches a correct-looking reply with a broken output contract
(`unmeasured-regression`).

## Run it

```text
npm start        # serve the lab on http://localhost:3000
npm test         # lab behavior + rubric + real-server e2e
npm run lab      # CLI: scenario × config verdict matrix
npm run check    # the test suite
```

`node scripts/lab.mjs --all-layers` runs the fixed configuration — every
scenario goes green. Pass layer ids for any subset:
`node scripts/lab.mjs retrieval memory`.

The server also answers `GET /api/meta`, `GET /api/run?scenario=<id>&layers=<csv>`,
and `GET /api/matrix?layers=<csv>` — the same pipeline the browser uses.

## Layout

- `public/lab.mjs` — the pipeline: `CONCEPTS`, `MODEL_ONLY`, `createAssistant`, `runScenario`, `runAll`
- `public/scenarios.mjs` — four scenarios with truth checks, the knowledge base, the one order
- `public/evals.mjs` — `RUBRIC` + `evaluateResult`: grounded/cited/correct/contract/safe vs. a 0.95 gate
- `app/server.js` — zero-dependency static host + `/health`, `/version`, `/api/*`
- `scripts/lab.mjs` — the CLI matrix
- `test/` — `node --test "test/*.test.mjs"`

## Honest limits

- The model is canned and deterministic — real models are stochastic, and
  their averages are subtler than "60 days".
- Retrieval selects by keyword overlap; production retrieval embeds and ranks.
- The agent plans at most three steps — the point is orchestration, not autonomy.
- A pass means "this scenario's failure was prevented" — never "the system is correct".

This is an educational demo, not production infrastructure.

Repo: [github.com/anhquanbd2021/8-ai-concepts-worth-knowing-in](https://github.com/anhquanbd2021/8-ai-concepts-worth-knowing-in)
