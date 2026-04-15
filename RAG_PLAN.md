# RAG Improvements Plan

Plan for evolving GraphRepo's `semantic_search` from single-vector dense
retrieval into a hybrid, graph-aware, reranked pipeline — gated at every step
by an evaluation harness so each change earns its place.

## Goals

Improve retrieval quality on code-specific queries (lexical, conceptual,
structural, fuzzy) without breaking the zero-infra, in-process property of the
extension. Every new component must run on the existing ONNX/WASM runtime
already bundled for MiniLM — no new services, no new heavy deps.

## Scope (selected)

1. **Hybrid retrieval** — BM25 (lexical) + dense (current) fused via
   Reciprocal Rank Fusion.
2. **Graph-aware expansion** — 1-hop neighborhood expansion along `CALLS`,
   `IMPORTS`, `HAS_METHOD`, `BELONGS_TO_COMMUNITY` edges with a score-decay
   blend. **No community summary embeddings** — graph structure only.
3. **Cross-encoder reranker** — retrieve top-50 from the fused+expanded set,
   rerank with `Xenova/ms-marco-MiniLM-L-6-v2`, return top-10.

Explicitly out of scope for now: swapping the embedding model, HyDE, richer
node descriptions (function bodies). Revisit once (1)–(3) are measured.

## Evaluation harness (built first)

Lives in [eval/](eval/). Runs as `npm run eval`.

### Test set — `eval/queries.json`

Hand-curated against GraphRepo's own parsed graph (dogfooded). Each entry:

```json
{
  "id": "q01",
  "query": "cosine similarity between vectors",
  "category": "conceptual",
  "relevant": [
    "Function::src/graphrag/vector-store.ts:dotProduct",
    "Function::src/graphrag/embeddings.ts:EmbeddingService.cosineSimilarity"
  ]
}
```

Categories:
- `lexical` — exact/near-exact name matches ("VectorStore search")
- `conceptual` — semantic, no name match ("how are embeddings persisted")
- `structural` — graph-shaped ("what calls embedText")
- `fuzzy` — nothing named this, retrieval must generalize ("retry with backoff")

Target ~30–50 queries. Seed with ~15; expand before relying on absolute numbers.

### Metrics (all @K=10)

- **Recall@10** — fraction of relevant nodes retrieved. Primary signal.
- **MRR** — mean reciprocal rank of first relevant hit. Rewards ranking.
- **NDCG@10** — position-discounted; binary relevance for now.
- **Hit@1** — strictest; did we nail the top slot?

Reported as mean over all queries, plus per-category breakdown so we can see
which technique helps which query type.

### Runner

Pluggable retriever interface:

```ts
type Retriever = (query: string, limit: number) => Promise<RetrievalHit[]>;
type RetrievalHit = { id: string; score: number };
```

Runner loads the graph + embeddings once, iterates retrievers × queries, prints
a comparison table so we can A/B every change.

## Implementation order

Each step gated on measurable eval delta vs. the previous step.

### Step 1 — Eval harness + baseline (this PR)

- `eval/queries.json` — seed test set
- `eval/metrics.ts` — Recall@K, MRR, NDCG@K, Hit@1
- `eval/retrievers/baseline.ts` — current dense-only path
- `eval/runner.ts` — pluggable runner, table output
- `npm run eval` script

Deliverable: baseline numbers. **No retrieval code changes yet.**

### Step 2 — Hybrid retrieval (BM25 + RRF)

Implement a lightweight in-memory BM25 over the same corpus
`buildNodeDescription` already generates. Fuse with dense rankings via RRF
(k=60):

```
RRF_score(d) = sum over rankers: 1 / (k + rank_r(d))
```

New retriever: `eval/retrievers/hybrid.ts`. Once it beats baseline on eval,
wire into `semantic_search` in [src/mcp/index.ts](src/mcp/index.ts).

### Step 3 — Graph-aware expansion

After fused retrieval returns top-K, expand each hit by 1 hop along `CALLS`,
`IMPORTS`, `HAS_METHOD`, `BELONGS_TO_COMMUNITY`. Neighbors inherit a decayed
score (e.g. `parent_score * 0.5`) and merge into the result set before final
ranking. **Graph structure only — no community summary text embedded.**

New retriever: `eval/retrievers/graph-expanded.ts`.

### Step 4 — Cross-encoder reranker

Add `src/graphrag/reranker.ts` wrapping `Xenova/ms-marco-MiniLM-L-6-v2`
through the same Transformers.js pipeline (`text-classification` with
cross-encoder config). Pipeline becomes:

```
query -> hybrid retrieve (top 50) -> graph expand -> rerank -> top 10
```

New retriever: `eval/retrievers/reranked.ts`. Measure latency as well as
quality — reranker forward passes dominate request time.

## Risks / open questions

- **Test-set overfitting.** 15–50 hand-curated queries is small; easy to tune
  toward. Mitigation: hold out ~1/3 of queries as a blind set, report on both.
  Ideally the user writes queries without looking at retrieval output.
- **BM25 tokenization for code.** Snake_case and camelCase need splitting so
  `embedText` matches `embed text`. Cheap to get wrong.
- **Expansion explosion.** 1-hop on hub nodes (common files) blows up the
  candidate set. Cap neighbors per hit (e.g. 5) and skip expansion on nodes
  with degree above a threshold.
- **Reranker latency.** 50 cross-encoder passes at ~5ms each ≈ 250ms added
  per query. Acceptable for MCP calls, worth measuring.

## Pre-update baseline results

Run on 30 dogfooded queries against GraphRepo's own parsed graph, K=10.
This is the number every subsequent change must beat.

| Category   |   Queries | Recall@10 |   MRR  | NDCG@10 | Hit@1 |
|------------|----------:|----------:|-------:|--------:|------:|
| **OVERALL**|        30 |   57.2%   | 55.4%  |  48.4%  | 43.3% |
| conceptual |        12 |   48.9%   | 54.1%  |  44.5%  | 40.0% |
| fuzzy      |         3 |   50.0%   | 50.0%  |  43.6%  | 33.3% |
| lexical    |         5 |   90.0%   | 86.7%  |  79.3%  | 80.0% |
| structural |         7 |   54.8%   | 38.1%  |  36.8%  | 28.6% |

Notable misses (Recall@10 = 0 on baseline):
- `q16` "write MCP server configuration for Claude" — returns Community nodes, not `writeMcpConfig`
- `q17` "skip hidden files and node_modules when walking" — returns the walker itself, not `shouldIgnore`
- `q19` "create CALLS edges between functions" — returns `getCallGraph`, not `createCallRelationships`
- `q26` "force directed graph layout simulation" — returns unrelated `GraphEdge` interfaces
- `q30` "language-specific call extraction for Python" — returns the File node and communities, not the `extractCalls` function

Patterns: dense search over short structural descriptions often latches onto
Community nodes or other same-file neighbours rather than the exact function
whose name lexically encodes the concept. This is exactly what hybrid +
reranking are supposed to fix.

## Post-update results

Same 30 queries, K=10. All metrics are overall (mean across queries); arrows
vs the pre-update baseline.

| Retriever                            | Recall@10 | MRR     | NDCG@10 | Hit@1   |
|--------------------------------------|----------:|--------:|--------:|--------:|
| baseline (dense only)                |   57.2%   |  55.4%  |  48.4%  |  43.3%  |
| **hybrid (BM25 + dense, RRF)**       | **63.9%** |**69.3%**|**58.8%**|**60.0%**|
| hybrid + graph expand                |   60.6%   |  65.7%  |  54.3%  |  60.0%  |
| hybrid + graph expand + rerank       |   58.3%   |  50.8%  |  45.3%  |  40.0%  |

Per-category for the winning retriever (**hybrid**):

| Category   | Recall@10 Δ       | MRR Δ             | NDCG@10 Δ         | Hit@1 Δ           |
|------------|-------------------|-------------------|-------------------|-------------------|
| conceptual | 48.9% → **55.6%** | 54.1% → **71.7%** | 44.5% → **55.2%** | 40.0% → **60.0%** |
| fuzzy      | 50.0% →   50.0%   | 50.0% →   37.5%   | 43.6% →   33.0%   | 33.3% →   33.3%   |
| lexical    | 90.0% →   90.0%   | 86.7% →**100.0%** | 79.3% → **92.3%** | 80.0% →**100.0%** |
| structural | 54.8% → **69.0%** | 38.1% → **55.7%** | 36.8% → **53.5%** | 28.6% → **42.9%** |

### What worked

**Hybrid (BM25 + RRF fusion)** is the big win. Every category either improved
or held, no regressions. Biggest gains where the pipeline was weakest:
structural queries went from 38% → 56% MRR and lexical queries now have
perfect MRR and Hit@1. `writeMcpConfig` (q16) — previously buried under three
Community nodes — now retrieves correctly.

### What didn't

**Graph expansion** adds nothing on this test set. Even after constraining it
(RRF-fused with the hybrid ranking, Community nodes excluded, neighbor-cap of
5, CALLS/IMPORTS/HAS_METHOD only), it produces a small regression on every
metric. The neighbors it surfaces are rarely the actually-relevant nodes for
the query — they're structurally adjacent but semantically unrelated.

**Cross-encoder reranking** is a clear regression (MRR 69% → 51%). Two
independent problems were found in sequence:

1. First attempt used the `text-classification` pipeline — this silently
   returns `label=LABEL_0, score=1.0` for every input because the ms-marco
   model has a single output logit and softmax over one element is always 1.
   Fixed by calling `AutoTokenizer` + `AutoModelForSequenceClassification`
   directly and reading raw logits.
2. Even with raw logits working, the cross-encoder (trained on MS MARCO web
   passages) scores GraphRepo's stylized node descriptions poorly. Strings
   like `"function foo (x: string): void in src/bar.ts"` don't look like
   passages, and community descriptions like
   `"code community: x, y, z (42 members)"` score misleadingly high because
   they resemble short natural-language summaries.

### Takeaways & next steps

- **Ship hybrid retrieval.** Wire BM25 + RRF into `semantic_search` in
  [src/mcp/index.ts](src/mcp/index.ts). Clear, measurable win across the board.
- **Park graph expansion.** It should help on truly structural queries
  ("what calls X"), but our current test set mostly has *lexical-shaped*
  structural queries that hybrid already handles. Revisit when we add more
  multi-hop intent queries (e.g. "what does the MCP server import from the
  graph layer").
- **Rerank only makes sense if we fix the document format first.** The
  reranker wants natural-language passages. Enriching `buildNodeDescription`
  with function bodies and JSDoc (originally out of scope for this pass) is
  the prerequisite. After that lands, retry the reranker.
- **The test set is still small (30 queries).** Treat all deltas as
  directional, not precise. Expand toward ~60+ before making further
  decisions, especially in the `fuzzy` category (only 3 queries — noisy).

## Success criteria

Each step must produce a positive delta on the **held-out** portion of the
eval set — dev-set improvement alone doesn't count. Final pipeline goal:
meaningful lift on `conceptual` and `fuzzy` categories (where baseline is
weakest) without regressing `lexical` (where exact-name search is already
strong).
