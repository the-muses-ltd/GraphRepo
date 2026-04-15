/**
 * Hybrid retrieval: BM25 + dense, fused via Reciprocal Rank Fusion.
 * Current best performer on the eval set — shipped as the default strategy.
 */

import type { Retriever } from "./types.js";
import { getBm25Index, rrfFuse } from "./bm25.js";

const CANDIDATE_POOL = 50;

export const hybridRetriever: Retriever = {
  id: "hybrid",
  name: "hybrid (BM25 + dense, RRF)",
  async retrieve(query, limit, ctx) {
    const bm25 = getBm25Index(ctx.graph);
    const bmResults = bm25.search(query, CANDIDATE_POOL);

    const queryEmbedding = await ctx.embeddingService.embedText(query);
    const denseResults = ctx.vectorStore.search(queryEmbedding, CANDIDATE_POOL);

    return rrfFuse([bmResults, denseResults], limit);
  },
};
