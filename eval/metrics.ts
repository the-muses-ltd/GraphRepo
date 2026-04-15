/**
 * Retrieval metrics for RAG evaluation.
 * All metrics operate on ranked lists of node IDs and a set of relevant IDs.
 */

export interface QueryResult {
  queryId: string;
  category: string;
  split: string;
  retrieved: string[];
  relevant: Set<string>;
}

export interface MetricScores {
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
  hitAtOne: number;
}

/** Fraction of relevant items that appear in the top-K retrieved list. */
export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return 0;
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const id of topK) if (relevant.has(id)) hits++;
  return hits / relevant.size;
}

/** Reciprocal rank of the first relevant item (0 if none in list). */
export function reciprocalRank(retrieved: string[], relevant: Set<string>): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Normalized Discounted Cumulative Gain at K, with binary relevance.
 * DCG = sum_{i=1..K} rel_i / log2(i + 1). IDCG is DCG of the ideal ranking.
 */
export function ndcgAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  const topK = retrieved.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i])) dcg += 1 / Math.log2(i + 2);
  }
  const idealHits = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** 1 if the top result is relevant, else 0. */
export function hitAtOne(retrieved: string[], relevant: Set<string>): number {
  return retrieved.length > 0 && relevant.has(retrieved[0]) ? 1 : 0;
}

export function scoreQuery(
  retrieved: string[],
  relevant: Set<string>,
  k: number,
): MetricScores {
  return {
    recallAtK: recallAtK(retrieved, relevant, k),
    mrr: reciprocalRank(retrieved, relevant),
    ndcgAtK: ndcgAtK(retrieved, relevant, k),
    hitAtOne: hitAtOne(retrieved, relevant),
  };
}

/** Mean of per-query scores. */
export function aggregate(scores: MetricScores[]): MetricScores {
  if (scores.length === 0) {
    return { recallAtK: 0, mrr: 0, ndcgAtK: 0, hitAtOne: 0 };
  }
  const sum = scores.reduce(
    (acc, s) => ({
      recallAtK: acc.recallAtK + s.recallAtK,
      mrr: acc.mrr + s.mrr,
      ndcgAtK: acc.ndcgAtK + s.ndcgAtK,
      hitAtOne: acc.hitAtOne + s.hitAtOne,
    }),
    { recallAtK: 0, mrr: 0, ndcgAtK: 0, hitAtOne: 0 },
  );
  return {
    recallAtK: sum.recallAtK / scores.length,
    mrr: sum.mrr / scores.length,
    ndcgAtK: sum.ndcgAtK / scores.length,
    hitAtOne: sum.hitAtOne / scores.length,
  };
}
