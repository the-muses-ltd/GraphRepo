/**
 * BM25 over the same corpus used for embeddings: node descriptions produced by
 * buildNodeDescription, plus the node's short name. Code-aware tokenization:
 * splits on non-alphanumerics, and additionally splits camelCase / snake_case
 * so "embedText" matches "embed text".
 */

import type Graph from "graphology";
import type { NodeAttributes, EdgeAttributes } from "../../graph/store.js";
import { buildNodeDescription } from "../embeddings.js";

const K1 = 1.5;
const B = 0.75;

/** Split camelCase / PascalCase / snake_case / kebab-case into lowercase tokens. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

interface DocEntry {
  id: string;
  tokens: string[];
  tf: Map<string, number>;
  length: number;
}

export class BM25Index {
  private docs: DocEntry[] = [];
  private df = new Map<string, number>();
  private avgDocLength = 0;
  private idf = new Map<string, number>();

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.push({ id, tokens, tf, length: tokens.length });
  }

  finalize(): void {
    const N = this.docs.length;
    if (N === 0) return;
    this.avgDocLength = this.docs.reduce((a, d) => a + d.length, 0) / N;
    for (const [term, dfCount] of this.df) {
      this.idf.set(term, Math.log(1 + (N - dfCount + 0.5) / (dfCount + 0.5)));
    }
  }

  search(query: string, limit: number): { id: string; score: number }[] {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return [];
    const results: { id: string; score: number }[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const qt of qTokens) {
        const idf = this.idf.get(qt);
        if (idf === undefined) continue;
        const f = doc.tf.get(qt) ?? 0;
        if (f === 0) continue;
        const norm = 1 - B + B * (doc.length / this.avgDocLength);
        score += idf * ((f * (K1 + 1)) / (f + K1 * norm));
      }
      if (score > 0) results.push({ id: doc.id, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}

export function buildBm25Index(graph: Graph<NodeAttributes, EdgeAttributes>): BM25Index {
  const idx = new BM25Index();
  graph.forEachNode((nodeId, attrs) => {
    const desc = buildNodeDescription(graph, nodeId);
    const text = `${attrs.name ?? ""} ${attrs.name ?? ""} ${desc}`;
    idx.add(nodeId, text);
  });
  idx.finalize();
  return idx;
}

/**
 * Shared BM25 cache keyed by graph identity. Retrievers can reuse the same
 * index within a single process.
 */
let cache: { index: BM25Index; key: string } | null = null;
export function getBm25Index(graph: Graph<NodeAttributes, EdgeAttributes>): BM25Index {
  const key = `${graph.order}:${graph.size}`;
  if (cache && cache.key === key) return cache.index;
  const index = buildBm25Index(graph);
  cache = { index, key };
  return index;
}

/** Reciprocal Rank Fusion (k=60, per Cormack et al.). */
export function rrfFuse(
  rankings: { id: string; score: number }[][],
  limit: number,
  k = 60,
): { id: string; score: number }[] {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      fused.set(ranking[rank].id, (fused.get(ranking[rank].id) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ id, score }));
}
