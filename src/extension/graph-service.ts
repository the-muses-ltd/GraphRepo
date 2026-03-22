import * as fs from "fs";
import * as path from "path";
import { EmbeddedGraph } from "./embedded-graph.js";

/**
 * Graph service that wraps EmbeddedGraph with persistence.
 * Saves/loads the graph as JSON to the extension's globalStoragePath.
 * This replaces Neo4jService for the self-contained extension.
 */
export class GraphService {
  private graph: EmbeddedGraph;
  private storagePath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.graph = new EmbeddedGraph();
    this.load();
  }

  /** Get the underlying graph for direct access */
  getGraph(): EmbeddedGraph {
    return this.graph;
  }

  /** Load graph from disk */
  private load(): void {
    const filePath = this.getFilePath();
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf-8");
        this.graph = EmbeddedGraph.deserialize(data);
      }
    } catch {
      // If corrupt or missing, start fresh
      this.graph = new EmbeddedGraph();
    }
  }

  /** Save graph to disk (debounced) */
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 2000);
  }

  /** Force an immediate save */
  saveNow(): void {
    if (!this.dirty) return;
    const filePath = this.getFilePath();
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, this.graph.serialize());
      this.dirty = false;
    } catch {
      // Non-critical: graph will be rebuilt on next parse
    }
  }

  private getFilePath(): string {
    return path.join(this.storagePath, "graph.json");
  }

  /** Check if a graph has been loaded for this workspace */
  hasData(): boolean {
    return this.graph.graph.order > 0;
  }

  /** Sync parsed repository into graph and persist */
  syncParsedRepo(
    parsed: import("../types.js").ParsedRepository,
    repoPath: string,
    clear: boolean = false
  ): import("../graph/index.js").SyncResult {
    const result = this.graph.syncParsedRepo(parsed, repoPath, clear);
    this.scheduleSave();
    return result;
  }

  /** Run community detection and persist */
  detectCommunities(): void {
    this.graph.detectCommunities();
    this.scheduleSave();
  }

  // --- Query methods (delegate to embedded graph) ---

  getGraphData(
    types: string[] | null,
    limit: number,
    repo?: string | null
  ) {
    return this.graph.getGraphData(types, limit, repo);
  }

  searchNodes(query: string) {
    return this.graph.searchNodes(query);
  }

  getNodeDetails(id: string) {
    return this.graph.getNodeDetails(id);
  }

  searchByName(pattern: string, type: string, limit: number, repo?: string | null) {
    return this.graph.searchByName(pattern, type, limit, repo);
  }

  getDependencies(filePath: string, depth: number, repo?: string | null) {
    return this.graph.getDependencies(filePath, depth, repo);
  }

  getDependents(filePath: string, depth: number, repo?: string | null) {
    return this.graph.getDependents(filePath, depth, repo);
  }

  getFileStructure(filePath: string, repo?: string | null) {
    return this.graph.getFileStructure(filePath, repo);
  }

  getCallGraph(functionName: string, depth: number, direction: string, repo?: string | null) {
    return this.graph.getCallGraph(functionName, depth, direction, repo);
  }

  findRelated(entityName: string, maxHops: number, repo?: string | null) {
    return this.graph.findRelated(entityName, maxHops, repo);
  }

  getRepoSummary(repo?: string | null) {
    return this.graph.getRepoSummary(repo);
  }

  /** Clean up resources */
  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveNow();
  }
}
