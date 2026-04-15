import type Graph from "graphology";
import type { NodeAttributes, EdgeAttributes } from "../../graph/store.js";
import type { EmbeddingService } from "../embeddings.js";
import type { VectorStore } from "../vector-store.js";

export interface RetrievalHit {
  id: string;
  score: number;
}

export interface RetrieverContext {
  graph: Graph<NodeAttributes, EdgeAttributes>;
  vectorStore: VectorStore;
  embeddingService: EmbeddingService;
}

/**
 * A retrieval strategy: turns a natural-language query into a ranked list of
 * graph node IDs. Pure function on `ctx` — no persistent state.
 */
export interface Retriever {
  /** Stable identifier used in configs and eval output. Kebab-case. */
  readonly id: string;
  /** Human-readable name shown in eval tables. */
  readonly name: string;
  retrieve(
    query: string,
    limit: number,
    ctx: RetrieverContext,
  ): Promise<RetrievalHit[]>;
}
