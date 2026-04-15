/**
 * Dense-only retriever — embeds the query, dot-products against the vector
 * store, returns top-K. Kept as a baseline for eval.
 */

import type { Retriever } from "./types.js";

export const baselineRetriever: Retriever = {
  id: "baseline",
  name: "baseline (dense)",
  async retrieve(query, limit, ctx) {
    const queryEmbedding = await ctx.embeddingService.embedText(query);
    const results = ctx.vectorStore.search(queryEmbedding, limit);
    return results.map((r) => ({ id: r.id, score: r.score }));
  },
};
