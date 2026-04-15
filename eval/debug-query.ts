/**
 * Debug tool — run a single query through every strategy and print its
 * top 10 with scores. Useful for eyeballing retrieval behavior.
 *
 *   npx tsx eval/debug-query.ts "how are embeddings persisted"
 */

import path from "path";
import { loadGraph, getGraphStorePath, getEmbeddingsStorePath } from "../src/graph/persistence.js";
import { EmbeddingService } from "../src/graphrag/embeddings.js";
import { VectorStore } from "../src/graphrag/vector-store.js";
import {
  STRATEGIES,
  DEFAULT_STRATEGY_ID,
  type RetrieverContext,
} from "../src/graphrag/retrievers/index.js";

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error('Usage: npx tsx eval/debug-query.ts "<query>"');
    process.exit(1);
  }
  const repo = process.cwd();
  const graph = await loadGraph(getGraphStorePath(repo));
  if (!graph) throw new Error("No graph — run `npm run parse -- .` first");
  const vectorStore = new VectorStore();
  vectorStore.load(getEmbeddingsStorePath(repo));
  const embeddingService = new EmbeddingService(
    path.join(repo, ".graphrepo", "model-cache"),
    () => {},
  );
  const init = await embeddingService.initialize();
  if (!init.ok) throw new Error(init.error);
  const ctx: RetrieverContext = { graph, vectorStore, embeddingService };

  for (const r of STRATEGIES) {
    const marker = r.id === DEFAULT_STRATEGY_ID ? " [DEFAULT]" : "";
    const hits = await r.retrieve(query, 10, ctx);
    console.log(`\n--- ${r.name}${marker} ---`);
    for (let i = 0; i < hits.length; i++) {
      console.log(`  ${String(i + 1).padStart(2)}. ${hits[i].score.toFixed(4)}  ${hits[i].id}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
