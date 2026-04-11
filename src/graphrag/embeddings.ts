/**
 * Local embedding service using Transformers.js (all-MiniLM-L6-v2).
 * Runs ONNX models in-process — no API keys, no external services.
 */

type Pipeline = (texts: string[], options?: Record<string, unknown>) => Promise<{ data: Float32Array; dims: number[] }>;

let pipeline: Pipeline | null = null;

export class EmbeddingService {
  private modelCacheDir: string;
  private ready = false;

  /** @param modelCacheDir Directory to cache the ONNX model (e.g., extensionContext.globalStorageUri) */
  constructor(modelCacheDir: string) {
    this.modelCacheDir = modelCacheDir;
  }

  /** Lazy-load the model on first use. Returns false if loading fails. */
  async initialize(): Promise<boolean> {
    if (this.ready) return true;
    try {
      // Dynamic import — Transformers.js is kept external by esbuild
      const { pipeline: createPipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = this.modelCacheDir;
      // Disable remote model fetching after first download
      env.allowRemoteModels = true;

      pipeline = (await createPipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        { dtype: "fp32" }
      )) as unknown as Pipeline;

      this.ready = true;
      return true;
    } catch (err) {
      console.error("EmbeddingService: Failed to initialize model:", err);
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Embed a single text string. Returns a 384-dimensional Float32Array. */
  async embedText(text: string): Promise<Float32Array> {
    if (!pipeline) throw new Error("EmbeddingService not initialized");
    const result = await pipeline([text], { pooling: "mean", normalize: true });
    return new Float32Array(result.data.slice(0, 384));
  }

  /** Embed multiple texts in a single batch. */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    if (!pipeline) throw new Error("EmbeddingService not initialized");
    const dims = 384;
    const result = await pipeline(texts, { pooling: "mean", normalize: true });
    const embeddings: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      embeddings.push(new Float32Array(result.data.slice(i * dims, (i + 1) * dims)));
    }
    return embeddings;
  }

  /** Cosine similarity between two embeddings (already normalized → dot product). */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }
}

// --- Composite description builders for embedding ---

import type Graph from "graphology";
import type { NodeAttributes, EdgeAttributes } from "../graph/store.js";

/** Build a text description of a graph node suitable for embedding. */
export function buildNodeDescription(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  nodeId: string,
): string {
  const attrs = graph.getNodeAttributes(nodeId);
  const type = attrs.type;

  switch (type) {
    case "Function": {
      const params = attrs.parameters ?? "";
      const ret = attrs.returnType ?? "void";
      return `function ${attrs.name} (${params}): ${ret} in ${attrs.filePath ?? ""}`;
    }
    case "Class": {
      const methods: string[] = [];
      graph.forEachOutEdge(nodeId, (_edge, edgeAttrs, _source, target) => {
        if (edgeAttrs.type === "HAS_METHOD") {
          methods.push(graph.getNodeAttributes(target).name);
        }
      });
      const ext = attrs.superClass ? ` extends ${attrs.superClass}` : "";
      return `class ${attrs.name}${ext} methods: ${methods.join(", ")} in ${attrs.filePath ?? ""}`;
    }
    case "Interface": {
      return `interface ${attrs.name} in ${attrs.filePath ?? ""}`;
    }
    case "File": {
      const children: { functions: string[]; classes: string[]; imports: string[] } = {
        functions: [],
        classes: [],
        imports: [],
      };
      graph.forEachOutEdge(nodeId, (_edge, edgeAttrs, _source, target) => {
        const targetAttrs = graph.getNodeAttributes(target);
        if (edgeAttrs.type === "CONTAINS" && targetAttrs.type === "Function") {
          children.functions.push(targetAttrs.name);
        } else if (edgeAttrs.type === "CONTAINS" && targetAttrs.type === "Class") {
          children.classes.push(targetAttrs.name);
        } else if (edgeAttrs.type === "IMPORTS" || edgeAttrs.type === "IMPORTS_EXTERNAL") {
          children.imports.push(targetAttrs.name);
        }
      });
      return `file ${attrs.name} (${attrs.language ?? ""}) contains: ${children.functions.join(", ")}, ${children.classes.join(", ")} imports: ${children.imports.join(", ")}`;
    }
    case "Community": {
      const members: string[] = [];
      graph.forEachInEdge(nodeId, (_edge, edgeAttrs, source) => {
        if (edgeAttrs.type === "BELONGS_TO_COMMUNITY") {
          members.push(graph.getNodeAttributes(source).name);
        }
      });
      return `code community: ${members.slice(0, 20).join(", ")} (${attrs.memberCount ?? members.length} members)`;
    }
    default:
      return `${type} ${attrs.name} in ${attrs.filePath ?? ""}`;
  }
}

/** Generate embeddings for all meaningful nodes in the graph. */
export async function generateEmbeddings(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  embeddingService: EmbeddingService,
  vectorStore: { add(id: string, text: string, embedding: Float32Array): void },
  onProgress?: (current: number, total: number) => void,
): Promise<number> {
  const embeddableTypes = new Set(["Function", "Class", "Interface", "File", "Community"]);
  const nodes: { id: string; text: string }[] = [];

  graph.forEachNode((nodeId, attrs) => {
    if (embeddableTypes.has(attrs.type)) {
      nodes.push({ id: nodeId, text: buildNodeDescription(graph, nodeId) });
    }
  });

  const batchSize = 32;
  let processed = 0;

  for (let i = 0; i < nodes.length; i += batchSize) {
    const batch = nodes.slice(i, i + batchSize);
    const texts = batch.map((n) => n.text);
    const embeddings = await embeddingService.embedBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      vectorStore.add(batch[j].id, batch[j].text, embeddings[j]);
    }

    processed += batch.length;
    onProgress?.(processed, nodes.length);
  }

  return nodes.length;
}
