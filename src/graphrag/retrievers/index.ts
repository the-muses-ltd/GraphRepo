/**
 * Retrieval strategy registry.
 *
 * To add a new strategy:
 *   1. Create a file exporting a Retriever (id, name, retrieve).
 *   2. Import it here and add it to STRATEGIES.
 *   3. Run `npm run eval` and update RAG_PLAN.md with the deltas.
 *   4. If your strategy beats DEFAULT_STRATEGY on the held-out split,
 *      change DEFAULT_STRATEGY below in the same PR.
 *
 * The default strategy is what `semantic_search` uses in production. Eval
 * runs every strategy in the registry so additions are measured, not shipped
 * on faith.
 */

import type { Retriever } from "./types.js";
import { baselineRetriever } from "./baseline.js";
import { hybridRetriever } from "./hybrid.js";
import { graphExpandedRetriever } from "./graph-expanded.js";
import { rerankedRetriever } from "./reranker.js";

export const STRATEGIES: readonly Retriever[] = [
  baselineRetriever,
  hybridRetriever,
  graphExpandedRetriever,
  rerankedRetriever,
];

/**
 * The strategy used by `semantic_search` in production. Chosen as the best
 * performer on the eval set at the time of the most recent eval run — see
 * RAG_PLAN.md for the numbers backing this choice. Changing this value
 * requires a matching update to RAG_PLAN.md in the same PR.
 */
export const DEFAULT_STRATEGY_ID = "hybrid";

export function getStrategy(id: string): Retriever | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

export function getDefaultStrategy(): Retriever {
  const s = getStrategy(DEFAULT_STRATEGY_ID);
  if (!s) throw new Error(`Default strategy "${DEFAULT_STRATEGY_ID}" not found in registry`);
  return s;
}

export type { Retriever, RetrievalHit, RetrieverContext } from "./types.js";
