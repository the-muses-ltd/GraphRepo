/**
 * Cross-encoder reranker on top of the graph-expanded hybrid pipeline.
 * Uses Xenova/ms-marco-MiniLM-L-6-v2 via @huggingface/transformers, reading
 * raw logits directly (the text-classification pipeline would apply softmax
 * over a single output and produce score=1.0 for every pair).
 *
 * Experimental — currently underperforms hybrid because MS MARCO-trained
 * cross-encoders score our stylized node descriptions poorly. Kept for eval.
 */

import type Graph from "graphology";
import type { NodeAttributes, EdgeAttributes } from "../../graph/store.js";
import { buildNodeDescription } from "../embeddings.js";
import type { Retriever, RetrievalHit } from "./types.js";
import { getBm25Index, rrfFuse } from "./bm25.js";

const CANDIDATE_POOL = 50;
const DECAY = 0.5;
const NEIGHBOR_CAP = 5;
const RERANK_POOL = 30;
const EXPAND_EDGE_TYPES = new Set(["CALLS", "IMPORTS", "HAS_METHOD"]);
const EXCLUDE_NODE_TYPES = new Set(["Community"]);

type RerankerFn = (pairs: { query: string; doc: string }[]) => Promise<number[]>;

let rerankerPipeline: RerankerFn | null = null;
let rerankerInitError: string | null = null;

interface TokenizerLike {
  (
    texts: string[],
    opts: { text_pair: string[]; padding: boolean; truncation: boolean },
  ): Promise<unknown>;
}
interface ModelLike {
  (inputs: unknown): Promise<{ logits: { data: Float32Array | number[] } }>;
}

async function getReranker(modelCacheDir: string): Promise<RerankerFn | null> {
  if (rerankerPipeline) return rerankerPipeline;
  if (rerankerInitError) return null;
  try {
    const transformers = (await import("@huggingface/transformers")) as unknown as {
      env: { cacheDir: string; allowRemoteModels: boolean };
      AutoTokenizer: { from_pretrained(id: string): Promise<TokenizerLike> };
      AutoModelForSequenceClassification: {
        from_pretrained(id: string, opts?: { dtype?: string }): Promise<ModelLike>;
      };
    };
    transformers.env.cacheDir = modelCacheDir;
    transformers.env.allowRemoteModels = true;

    const modelId = "Xenova/ms-marco-MiniLM-L-6-v2";
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(modelId);
    const model = await transformers.AutoModelForSequenceClassification.from_pretrained(modelId, {
      dtype: "fp32",
    });

    rerankerPipeline = async (pairs) => {
      if (pairs.length === 0) return [];
      const texts = pairs.map((p) => p.query);
      const textPairs = pairs.map((p) => p.doc);
      const encoded = await tokenizer(texts, {
        text_pair: textPairs,
        padding: true,
        truncation: true,
      });
      const output = await model(encoded);
      const data = Array.from(output.logits.data as Float32Array | number[]);
      const batch = pairs.length;
      const cols = data.length / batch;
      const scores: number[] = [];
      for (let i = 0; i < batch; i++) scores.push(data[i * cols]);
      return scores;
    };
    return rerankerPipeline;
  } catch (err) {
    rerankerInitError = err instanceof Error ? err.message : String(err);
    console.error(`[reranker] load failed: ${rerankerInitError}`);
    return null;
  }
}

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

function rerankerModelCacheDir(): string {
  const repo = process.env.GRAPHREPO_REPO_PATH ?? process.cwd();
  return process.env.GRAPHREPO_MODEL_CACHE ?? `${repo}/.graphrepo/model-cache`;
}

export const rerankedRetriever: Retriever = {
  id: "reranked",
  name: "hybrid + graph expand + rerank",
  async retrieve(query, limit, ctx) {
    const bm25 = getBm25Index(ctx.graph);
    const bmResults = bm25.search(query, CANDIDATE_POOL);
    const queryEmbedding = await ctx.embeddingService.embedText(query);
    const denseResults = ctx.vectorStore.search(queryEmbedding, CANDIDATE_POOL);
    const fused = rrfFuse([bmResults, denseResults], CANDIDATE_POOL);
    const neighbors = collectNeighbors(ctx.graph, fused);
    const expanded = rrfFuse([fused, neighbors], RERANK_POOL);

    const reranker = await getReranker(rerankerModelCacheDir());
    if (!reranker) return expanded.slice(0, limit);

    const pairs = expanded.map((h) => ({
      query,
      doc: ctx.graph.hasNode(h.id) ? buildNodeDescription(ctx.graph, h.id) : h.id,
    }));
    const scores = await reranker(pairs);

    const combined: RetrievalHit[] = expanded.map((h, i) => ({
      id: h.id,
      score: scores[i] ?? 0,
    }));
    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, limit);
  },
};
