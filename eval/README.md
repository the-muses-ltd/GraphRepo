# GraphRepo Retrieval Evaluation Guide

This directory holds the evaluation harness for GraphRepo's semantic-search
retrieval. Every change that touches retrieval — a new strategy, a tweak to
`buildNodeDescription`, a new embedding model — is gated on this harness.

## TL;DR

```bash
# 1. Make sure you have a parsed graph of this repo
npm run parse -- .

# 2. Run the eval across every registered strategy
npm run eval

# 3. (or) Run just one strategy
npm run eval -- --strategy hybrid

# 4. Debug a single query's results
npx tsx eval/debug-query.ts "how are embeddings persisted"
```

## What the harness does

For each (query, strategy) pair, it retrieves the top K node IDs and scores
them against the hand-curated relevant set in [queries.json](queries.json)
using four metrics:

| Metric      | What it measures                                                   |
|-------------|--------------------------------------------------------------------|
| Recall@K    | Fraction of relevant nodes that appear in top K. Primary signal.   |
| MRR         | Reciprocal rank of the first relevant hit. Rewards ranking.        |
| NDCG@K      | Position-discounted gain; binary relevance.                        |
| Hit@1       | 1 if the top result is relevant, else 0. Strictest.                |

Metrics are implemented in [metrics.ts](metrics.ts) and unit-tested in
[tests/eval/metrics.test.ts](../tests/eval/metrics.test.ts). Numbers are
aggregated overall and per-category (`conceptual`, `fuzzy`, `lexical`,
`structural`).

## The test set

[queries.json](queries.json) is the ground truth. Each entry has:

```json
{
  "id": "q01",
  "query": "cosine similarity between vectors",
  "category": "conceptual",
  "split": "dev",
  "relevant": ["Function::src/graphrag/vector-store.ts:dotProduct"]
}
```

- `category` groups queries by the retrieval challenge they pose. Balance
  across categories matters — a model that only helps `lexical` isn't a win.
- `split` is `dev` or `holdout`. Tune on dev, report on holdout. Do not look
  at holdout misses while tuning.
- `relevant` is the set of node IDs that count as correct hits. Node IDs must
  match exactly what's in `.graphrepo/graph.json`.

### Adding queries

Good queries for this harness:

- Have 1–3 clear "right answer" nodes (not 10+ — that makes Recall cheap).
- Target behavior the codebase actually has (verify against the graph).
- Span categories. Lean heavier on `conceptual` and `structural`; those are
  where dense and lexical search each struggle.
- Are written *without* looking at current retrieval output. Peeking at top-K
  before writing the relevant set is how you overfit the harness.

Workflow for a new query:

1. Decide the category and the intended relevant node(s).
2. Add the entry to `queries.json`. Use `--split holdout` for roughly 1/3 of
   new queries.
3. Run `npm run eval` and confirm the relevant node(s) exist in the graph
   (the runner won't error on a typo, but the query will just always miss —
   if a new query mysteriously always scores 0, typo-check first).

## Strategies

Retrieval strategies live in [src/graphrag/retrievers/](../src/graphrag/retrievers/).
The registry at [index.ts](../src/graphrag/retrievers/index.ts) lists every
strategy and names the default (`DEFAULT_STRATEGY_ID`). The eval runner picks
up everything in `STRATEGIES` automatically.

### Adding a new strategy

1. Create `src/graphrag/retrievers/your-strategy.ts` exporting a `Retriever`:
   ```ts
   export const yourStrategy: Retriever = {
     id: "your-strategy",
     name: "human-readable name",
     async retrieve(query, limit, ctx) { /* ... */ },
   };
   ```
2. Register it in `src/graphrag/retrievers/index.ts` by adding to `STRATEGIES`.
3. Run `npm run eval` and compare against the current default.
4. If your strategy beats the default on Recall@10 on the **holdout split**
   without regressing any category, change `DEFAULT_STRATEGY_ID` in the same
   PR and update [RAG_PLAN.md](../RAG_PLAN.md) with the new numbers.

### What makes a strategy change ship-worthy

- Recall@10 up on **holdout** (not just dev).
- No category regression of more than ~2 percentage points.
- If it costs meaningfully more latency (e.g. adds a cross-encoder pass),
  the quality delta must justify it. Measure with `time npm run eval`.

## The CI pipeline

`.github/workflows/eval.yml` runs the metric unit tests on every PR. The full
eval cannot run in CI cleanly (model download, graph parsing) — it's a
maintainer responsibility to run `npm run eval -- --json eval/results/pr-NNN.json`
locally and paste the summary into the PR description. See
[RAG_PLAN.md](../RAG_PLAN.md) for the policy.

## Debugging

`npx tsx eval/debug-query.ts "<query>"` runs one query through every
registered strategy and prints the top-10 with scores. The `[DEFAULT]` marker
shows which strategy ships to users. Use this when:

- A query has Recall@10 = 0 and you want to see what the retrievers *did*
  rank highly.
- You suspect a scoring or fusion bug — raw numbers make it obvious.
- You're writing a new query and want to sanity-check whether the target
  nodes are even reachable from the current index.

## Correctness checks

Before trusting any result:

1. `npx vitest run tests/eval/metrics.test.ts` — metric math must pass.
2. Verify every `relevant` ID resolves in the graph:
   ```bash
   node -e "const g=JSON.parse(require('fs').readFileSync('.graphrepo/graph.json','utf-8')); const q=JSON.parse(require('fs').readFileSync('eval/queries.json','utf-8')); const ids=new Set(g.nodes.map(n=>n.key)); let m=0; for(const query of q.queries) for(const r of query.relevant) if(!ids.has(r)){console.log('MISSING:',query.id,'->',r);m++} console.log(m,'missing')"
   ```
3. Run `debug-query.ts` on a couple of queries and eyeball the top-K — if
   rankings look obviously wrong, something upstream (indexer, description
   builder, tokenizer) is broken, not the metrics.

## Known limitations

- **Test-set size.** 30 queries is enough to see direction but small enough
  that a single bad query can shift overall numbers by 3–5 points. Treat
  per-category deltas with particular caution when N < 10 per category.
- **Community nodes.** They have an unusually high in-degree on
  `BELONGS_TO_COMMUNITY` edges; be careful if your strategy propagates score
  across that edge type.
- **Dogfooded only.** All queries target GraphRepo's own source. A strategy
  that's well-tuned here may behave differently on a larger, less cohesive
  repo. Expand the harness with additional corpora if/when that matters.
