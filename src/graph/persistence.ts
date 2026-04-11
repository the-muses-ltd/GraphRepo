import Graph from "graphology";
import * as fs from "fs";
import * as path from "path";
import type { NodeAttributes, EdgeAttributes } from "./store.js";

/**
 * Save a graphology graph to a JSON file.
 * Uses graphology's built-in export() for full serialization.
 */
export async function saveGraph(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  filePath: string
): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const serialized = graph.export();
  const json = JSON.stringify(serialized);
  fs.writeFileSync(filePath, json, "utf-8");
}

/**
 * Load a graphology graph from a JSON file.
 * Returns null if the file doesn't exist.
 */
export async function loadGraph(
  filePath: string
): Promise<Graph<NodeAttributes, EdgeAttributes> | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const json = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(json);

    const graph = new Graph<NodeAttributes, EdgeAttributes>({
      type: "directed",
      multi: false,
      allowSelfLoops: false,
    });
    graph.import(data);
    return graph;
  } catch {
    // Corrupted or incompatible file — return null so a fresh graph is created
    return null;
  }
}

/**
 * Get the default graph storage path for a workspace.
 */
export function getGraphStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".graphrepo", "graph.json");
}

/**
 * Get the default embeddings storage path for a workspace.
 */
export function getEmbeddingsStorePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".graphrepo", "embeddings.json");
}
