import path from "path";
import { loadConfig } from "../../config.js";
import { createMcpServer } from "../../mcp/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadGraph, getGraphStorePath, getEmbeddingsStorePath } from "../../graph/persistence.js";
import { setStore } from "../../graph/store.js";
import { EmbeddingService } from "../../graphrag/embeddings.js";
import { VectorStore } from "../../graphrag/vector-store.js";

export const serveCommand = async (): Promise<void> => {
  const repoPath = process.env.GRAPHREPO_REPO_PATH ?? process.cwd();
  const config = loadConfig(repoPath);

  // Load the persisted graph
  const graphFile = process.env.GRAPHREPO_DATA_FILE ?? getGraphStorePath(repoPath);
  const graph = await loadGraph(graphFile);
  if (graph) {
    setStore(graph);
  } else {
    console.error(`Warning: No graph data found at ${graphFile}. Run 'parse' first.`);
  }

  // Load embeddings if available
  const embeddingsFile = process.env.GRAPHREPO_EMBEDDINGS_FILE ?? getEmbeddingsStorePath(repoPath);
  const vectorStore = new VectorStore();
  vectorStore.load(embeddingsFile);

  // Initialize embedding service (load model before serving)
  const modelCacheDir = process.env.GRAPHREPO_MODEL_CACHE ?? path.join(repoPath, ".graphrepo", "model-cache");
  const embeddingService = new EmbeddingService(modelCacheDir);
  await embeddingService.initialize();

  const server = createMcpServer(config, { embeddingService, vectorStore });
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
