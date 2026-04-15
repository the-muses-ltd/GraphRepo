/**
 * Graph-aware expansion on top of hybrid retrieval. Adds 1-hop neighbors
 * (along CALLS / IMPORTS / HAS_METHOD only) as a discovery list, then
 * RRF-fuses with the hybrid ranking so neighbors add recall without
 * displacing top hits. Excludes Community nodes — they act as hubs and
 * distort expansion scores.
 *
 * Experimental — currently underperforms plain hybrid. Kept for eval.
 */

import type Graph from "graphology";
import type { NodeAttributes, EdgeAttributes } from "../../graph/store.js";
import type { Retriever } from "./types.js";
import { getBm25Index, rrfFuse } from "./bm25.js";

const CANDIDATE_POOL = 50;
const DECAY = 0.5;
const NEIGHBOR_CAP = 5;
const EXPAND_EDGE_TYPES = new Set(["CALLS", "IMPORTS", "HAS_METHOD"]);
const EXCLUDE_NODE_TYPES = new Set(["Community"]);

function collectNeighbors(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  candidates: { id: string; score: number }[],
): { id: string; score: number }[] {
  const neighborScore = new Map<string, number>();
  const candidateIds = new Set(candidates.map((c) => c.id));

  for (const c of candidates) {
    if (!graph.hasNode(c.id)) continue;
    let added = 0;
    const push = (id: string) => {
      if (added >= NEIGHBOR_CAP) return;
      if (candidateIds.has(id)) return;
      if (graph.hasNode(id) && EXCLUDE_NODE_TYPES.has(graph.getNodeAttributes(id).type)) return;
      neighborScore.set(id, (neighborScore.get(id) ?? 0) + c.score * DECAY);
      added++;
    };
    graph.forEachOutboundEdge(c.id, (_e, eAttrs, _s, target) => {
      if (EXPAND_EDGE_TYPES.has(eAttrs.type)) push(target);
    });
    graph.forEachInboundEdge(c.id, (_e, eAttrs, source) => {
      if (EXPAND_EDGE_TYPES.has(eAttrs.type)) push(source);
    });
  }
  return [...neighborScore.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}

export const graphExpandedRetriever: Retriever = {
  id: "graph-expanded",
  name: "hybrid + graph expand",
  async retrieve(query, limit, ctx) {
    const bm25 = getBm25Index(ctx.graph);
    const bmResults = bm25.search(query, CANDIDATE_POOL);
    const queryEmbedding = await ctx.embeddingService.embedText(query);
    const denseResults = ctx.vectorStore.search(queryEmbedding, CANDIDATE_POOL);
    const fused = rrfFuse([bmResults, denseResults], CANDIDATE_POOL);
    const neighbors = collectNeighbors(ctx.graph, fused);
    return rrfFuse([fused, neighbors], limit);
  },
};
