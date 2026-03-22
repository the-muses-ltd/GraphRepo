import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { ParsedRepository } from "../types.js";
import type { SyncResult } from "../graph/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Graphology's generics don't propagate to callbacks in all type setups,
// so we use explicit casts where needed.

// Node/edge attribute types for the graphology graph
export type GraphNodeAttrs = {
  label: string; // "File" | "Function" | "Class" | "Interface" | "Variable" | "Module" | "Folder"
  name: string;
  qualifiedName?: string;
  path?: string;
  language?: string;
  lineCount?: number;
  size?: number;
  extension?: string;
  parameters?: string;
  returnType?: string | null;
  startLine?: number;
  endLine?: number;
  isExported?: boolean;
  isAsync?: boolean;
  isAbstract?: boolean;
  kind?: string;
  repo: string;
  communityId?: string;
};

export type GraphEdgeAttrs = {
  type: string; // "CONTAINS" | "IMPORTS" | "CALLS" | etc.
  specifier?: string;
  isDefault?: boolean;
  names?: string[];
  count?: number;
  weight?: number;
};

/**
 * Embedded graph store using graphology — replaces Neo4j for self-contained operation.
 * All data lives in-memory with JSON serialization for persistence.
 */
export class EmbeddedGraph {
  public graph: Graph;
  private nextId = 1;

  constructor() {
    this.graph = new Graph({
      type: "directed",
      multi: true,
    });
  }

  private nodeAttrs(id: string): GraphNodeAttrs {
    return this.graph.getNodeAttributes(id) as unknown as GraphNodeAttrs;
  }

  private edgeAttrs(id: string): GraphEdgeAttrs {
    return this.graph.getEdgeAttributes(id) as unknown as GraphEdgeAttrs;
  }

  private genId(): string {
    return `n${this.nextId++}`;
  }

  /** Find a node by label + key attributes (emulates Neo4j MERGE) */
  private findNode(
    label: string,
    key: Record<string, unknown>
  ): string | null {
    for (const [nodeId, attrs] of this.graph.nodeEntries() as Iterable<[string, GraphNodeAttrs]>) {
      if (attrs.label !== label) continue;
      let match = true;
      for (const [k, v] of Object.entries(key)) {
        if ((attrs as Record<string, unknown>)[k] !== v) {
          match = false;
          break;
        }
      }
      if (match) return nodeId;
    }
    return null;
  }

  /** MERGE-like: find or create a node */
  private mergeNode(
    label: string,
    key: Record<string, unknown>,
    attrs: Partial<GraphNodeAttrs> = {}
  ): string {
    const existing = this.findNode(label, key);
    if (existing) {
      // Update attributes
      for (const [k, v] of Object.entries(attrs)) {
        this.graph.setNodeAttribute(existing, k as keyof GraphNodeAttrs, v);
      }
      return existing;
    }
    const id = this.genId();
    this.graph.addNode(id, {
      label,
      name: "",
      repo: "",
      ...key,
      ...attrs,
    } as GraphNodeAttrs);
    return id;
  }

  /** MERGE-like: find or create an edge */
  private mergeEdge(
    source: string,
    target: string,
    type: string,
    attrs: Partial<GraphEdgeAttrs> = {}
  ): void {
    // Check if this specific edge type already exists
    const edges = this.graph.edges(source, target);
    for (const edgeId of edges) {
      if (this.graph.getEdgeAttribute(edgeId, "type") === type) {
        // Update attrs
        for (const [k, v] of Object.entries(attrs)) {
          this.graph.setEdgeAttribute(edgeId, k as keyof GraphEdgeAttrs, v);
        }
        return;
      }
    }
    this.graph.addEdge(source, target, { type, ...attrs } as GraphEdgeAttrs);
  }

  /** Clear all nodes for a given repo */
  clearRepo(repo: string): void {
    const toRemove: string[] = [];
    this.graph.forEachNode((id: string, attrs: GraphNodeAttrs) => {
      if (attrs.repo === repo) toRemove.push(id);
    });
    for (const id of toRemove) {
      this.graph.dropNode(id);
    }
  }

  /** Clear entire graph */
  clear(): void {
    this.graph.clear();
    this.nextId = 1;
  }

  /**
   * Sync a parsed repository into the in-memory graph.
   * This is the main entry point — replaces syncToNeo4j.
   */
  syncParsedRepo(
    parsed: ParsedRepository,
    repoPath: string,
    clearFirst: boolean = false
  ): SyncResult {
    const repo =
      repoPath
        .replace(/\\/g, "/")
        .split("/")
        .filter(Boolean)
        .pop() ?? "unknown";

    // Always clear this repo first (idempotent per-repo)
    this.clearRepo(repo);

    if (clearFirst) {
      this.clear();
    }

    // --- Build node ID lookup maps for relationship creation ---
    const fileNodeIds = new Map<string, string>();
    const funcNodeIds = new Map<string, string>();
    const classNodeIds = new Map<string, string>();
    const ifaceNodeIds = new Map<string, string>();
    const moduleNodeIds = new Map<string, string>();
    const folderNodeIds = new Map<string, string>();

    // 1. File nodes
    for (const f of parsed.files) {
      const ext = f.path.split(".").pop() ?? "";
      const name = f.path.split("/").pop() ?? f.path;
      const id = this.mergeNode(
        "File",
        { path: f.path, repo },
        {
          name,
          extension: `.${ext}`,
          language: f.language,
          size: f.size,
          lineCount: f.lineCount,
        }
      );
      fileNodeIds.set(f.path, id);
    }

    // 2. Function nodes
    for (const f of parsed.files) {
      for (const fn of f.functions) {
        const qn = `${f.path}:${fn.name}`;
        const id = this.mergeNode(
          "Function",
          { qualifiedName: qn, repo },
          {
            name: fn.name,
            parameters: fn.parameters,
            returnType: fn.returnType,
            startLine: fn.startLine,
            endLine: fn.endLine,
            isExported: fn.isExported,
            isAsync: fn.isAsync,
            kind: fn.kind,
          }
        );
        funcNodeIds.set(qn, id);
      }
    }

    // 3. Class nodes + their method nodes
    for (const f of parsed.files) {
      for (const c of f.classes) {
        const classQN = `${f.path}:${c.name}`;
        const classId = this.mergeNode(
          "Class",
          { qualifiedName: classQN, repo },
          {
            name: c.name,
            startLine: c.startLine,
            endLine: c.endLine,
            isExported: c.isExported,
            isAbstract: c.isAbstract,
          }
        );
        classNodeIds.set(classQN, classId);

        // Methods as Function nodes
        for (const m of c.methods) {
          const methodQN = `${f.path}:${c.name}.${m.name}`;
          const methodId = this.mergeNode(
            "Function",
            { qualifiedName: methodQN, repo },
            {
              name: m.name,
              parameters: m.parameters,
              returnType: m.returnType,
              startLine: m.startLine,
              endLine: m.endLine,
              isExported: m.isExported,
              isAsync: m.isAsync,
              kind: m.kind,
            }
          );
          funcNodeIds.set(methodQN, methodId);
        }
      }
    }

    // 4. Interface nodes
    for (const f of parsed.files) {
      for (const i of f.interfaces) {
        const qn = `${f.path}:${i.name}`;
        const id = this.mergeNode(
          "Interface",
          { qualifiedName: qn, repo },
          {
            name: i.name,
            startLine: i.startLine,
            endLine: i.endLine,
            isExported: i.isExported,
          }
        );
        ifaceNodeIds.set(qn, id);
      }
    }

    // 5. Module nodes (external deps)
    for (const modName of parsed.externalModules) {
      const id = this.mergeNode("Module", { name: modName }, { repo: "" });
      moduleNodeIds.set(modName, id);
    }

    // 6. Folder nodes
    const folderPaths = new Set<string>();
    for (const f of parsed.files) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) {
        folderPaths.add(parts.slice(0, i).join("/"));
      }
    }
    for (const fp of folderPaths) {
      const name = fp.split("/").pop() ?? fp;
      const id = this.mergeNode("Folder", { path: fp, repo }, { name });
      folderNodeIds.set(fp, id);
    }

    // --- Relationships ---

    // CONTAINS: File -> Function, Class, Interface
    for (const f of parsed.files) {
      const fileId = fileNodeIds.get(f.path)!;
      for (const fn of f.functions) {
        const funcId = funcNodeIds.get(`${f.path}:${fn.name}`)!;
        this.mergeEdge(fileId, funcId, "CONTAINS");
      }
      for (const c of f.classes) {
        const classId = classNodeIds.get(`${f.path}:${c.name}`)!;
        this.mergeEdge(fileId, classId, "CONTAINS");
      }
      for (const i of f.interfaces) {
        const ifaceId = ifaceNodeIds.get(`${f.path}:${i.name}`)!;
        this.mergeEdge(fileId, ifaceId, "CONTAINS");
      }
    }

    // HAS_METHOD: Class -> Function
    for (const f of parsed.files) {
      for (const c of f.classes) {
        const classId = classNodeIds.get(`${f.path}:${c.name}`)!;
        for (const m of c.methods) {
          const methodId = funcNodeIds.get(`${f.path}:${c.name}.${m.name}`)!;
          this.mergeEdge(classId, methodId, "HAS_METHOD");
        }
      }
    }

    // IMPORTS: File -> File (internal)
    for (const f of parsed.files) {
      const fromId = fileNodeIds.get(f.path)!;
      for (const imp of f.imports) {
        if (!imp.isExternal && imp.resolvedPath) {
          const toId = fileNodeIds.get(imp.resolvedPath);
          if (toId) {
            this.mergeEdge(fromId, toId, "IMPORTS", {
              specifier: imp.specifier,
              isDefault: imp.isDefault,
              names: imp.names,
            });
          }
        }
      }
    }

    // IMPORTS_EXTERNAL: File -> Module
    for (const f of parsed.files) {
      const fileId = fileNodeIds.get(f.path)!;
      for (const imp of f.imports) {
        if (imp.isExternal) {
          const modId = moduleNodeIds.get(imp.specifier);
          if (modId) {
            this.mergeEdge(fileId, modId, "IMPORTS_EXTERNAL", {
              names: imp.names,
            });
          }
        }
      }
    }

    // CALLS: Function -> Function
    const funcByName = new Map<string, string[]>();
    for (const f of parsed.files) {
      for (const fn of f.functions) {
        const qn = `${f.path}:${fn.name}`;
        const existing = funcByName.get(fn.name) ?? [];
        existing.push(qn);
        funcByName.set(fn.name, existing);
      }
      for (const c of f.classes) {
        for (const m of c.methods) {
          const qn = `${f.path}:${c.name}.${m.name}`;
          const existing = funcByName.get(m.name) ?? [];
          existing.push(qn);
          funcByName.set(m.name, existing);
        }
      }
    }

    const callCounts = new Map<string, number>();
    const collectCalls = (
      filePath: string,
      callerQN: string,
      calls: string[]
    ) => {
      for (const calleeName of calls) {
        const targets = funcByName.get(calleeName);
        if (!targets) continue;
        const sameFile = targets.find((t) => t.startsWith(filePath + ":"));
        const target = sameFile ?? targets[0];
        if (target !== callerQN) {
          const key = `${callerQN}->${target}`;
          callCounts.set(key, (callCounts.get(key) ?? 0) + 1);
        }
      }
    };

    for (const f of parsed.files) {
      for (const fn of f.functions) {
        collectCalls(f.path, `${f.path}:${fn.name}`, fn.calls);
      }
      for (const c of f.classes) {
        for (const m of c.methods) {
          collectCalls(f.path, `${f.path}:${c.name}.${m.name}`, m.calls);
        }
      }
    }

    for (const [key, count] of callCounts) {
      const [callerQN, calleeQN] = key.split("->");
      const callerId = funcNodeIds.get(callerQN);
      const calleeId = funcNodeIds.get(calleeQN);
      if (callerId && calleeId) {
        this.mergeEdge(callerId, calleeId, "CALLS", { count });
      }
    }

    // EXTENDS: Class -> Class
    const classByName = new Map<string, string>();
    for (const f of parsed.files) {
      for (const c of f.classes) {
        classByName.set(c.name, `${f.path}:${c.name}`);
      }
    }
    for (const f of parsed.files) {
      for (const c of f.classes) {
        if (c.superClass && classByName.has(c.superClass)) {
          const childId = classNodeIds.get(`${f.path}:${c.name}`)!;
          const parentQN = classByName.get(c.superClass)!;
          const parentId = classNodeIds.get(parentQN);
          if (parentId) {
            this.mergeEdge(childId, parentId, "EXTENDS");
          }
        }
      }
    }

    // CONTAINS_FILE: Folder -> File
    for (const f of parsed.files) {
      const parts = f.path.split("/");
      const folderPath = parts.slice(0, -1).join("/");
      if (folderPath) {
        const folderId = folderNodeIds.get(folderPath);
        const fileId = fileNodeIds.get(f.path);
        if (folderId && fileId) {
          this.mergeEdge(folderId, fileId, "CONTAINS_FILE");
        }
      }
    }

    // CONTAINS_FOLDER: Folder -> Folder (parent -> child)
    for (const fp of folderPaths) {
      if (!fp.includes("/")) continue;
      const parts = fp.split("/");
      const parentPath = parts.slice(0, -1).join("/");
      if (folderNodeIds.has(parentPath)) {
        this.mergeEdge(folderNodeIds.get(parentPath)!, folderNodeIds.get(fp)!, "CONTAINS_FOLDER");
      }
    }

    const functionCount = parsed.files.reduce(
      (sum, f) =>
        sum +
        f.functions.length +
        f.classes.reduce((s, c) => s + c.methods.length, 0),
      0
    );

    return {
      fileCount: parsed.files.length,
      functionCount,
      classCount: parsed.files.reduce((sum, f) => sum + f.classes.length, 0),
      interfaceCount: parsed.files.reduce(
        (sum, f) => sum + f.interfaces.length,
        0
      ),
      moduleCount: parsed.externalModules.length,
    };
  }

  // ------------------------------------------------------------------
  // Serialization — export/import for JSON persistence
  // ------------------------------------------------------------------

  serialize(): string {
    const nodes: Array<{ id: string; attrs: GraphNodeAttrs }> = [];
    this.graph.forEachNode((id: string, attrs: GraphNodeAttrs) => {
      nodes.push({ id, attrs });
    });

    const edges: Array<{
      source: string;
      target: string;
      attrs: GraphEdgeAttrs;
    }> = [];
    this.graph.forEachEdge((_: string, attrs: GraphEdgeAttrs, source: string, target: string) => {
      edges.push({ source, target, attrs });
    });

    return JSON.stringify({ nodes, edges, nextId: this.nextId });
  }

  static deserialize(json: string): EmbeddedGraph {
    const data = JSON.parse(json);
    const store = new EmbeddedGraph();
    store.nextId = data.nextId ?? 1;

    for (const { id, attrs } of data.nodes) {
      store.graph.addNode(id, attrs);
    }
    for (const { source, target, attrs } of data.edges) {
      if (store.graph.hasNode(source) && store.graph.hasNode(target)) {
        store.graph.addEdge(source, target, attrs);
      }
    }

    return store;
  }

  // ------------------------------------------------------------------
  // Query methods — replace Cypher queries
  // ------------------------------------------------------------------

  /** Full-text search by name (fuzzy substring match) */
  searchByName(
    pattern: string,
    type: string,
    limit: number,
    repo?: string | null
  ): Array<{
    type: string;
    name: string;
    qualifiedName: string | undefined;
    score: number;
  }> {
    const lowerPattern = pattern.toLowerCase();
    const results: Array<{
      type: string;
      name: string;
      qualifiedName: string | undefined;
      score: number;
    }> = [];

    this.graph.forEachNode((_: string, attrs: GraphNodeAttrs) => {
      if (attrs.label === "Folder" || attrs.label === "Module") return;
      if (type !== "all" && attrs.label.toLowerCase() !== type) return;
      if (repo && attrs.repo !== repo) return;

      const name = attrs.name?.toLowerCase() ?? "";
      const qn = attrs.qualifiedName?.toLowerCase() ?? "";

      let score = 0;
      if (name === lowerPattern) score = 10;
      else if (name.startsWith(lowerPattern)) score = 5;
      else if (name.includes(lowerPattern)) score = 3;
      else if (qn.includes(lowerPattern)) score = 1;

      if (score > 0) {
        results.push({
          type: attrs.label,
          name: attrs.name,
          qualifiedName: attrs.qualifiedName,
          score,
        });
      }
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** Get files that a given file imports */
  getDependencies(
    filePath: string,
    depth: number,
    repo?: string | null
  ): Array<{ path: string; language: string | undefined; depth?: number }> {
    const fileId = this.findNode(
      "File",
      repo ? { path: filePath, repo } : { path: filePath }
    );
    if (!fileId) return [];

    if (depth <= 1) {
      const results: Array<{
        path: string;
        language: string | undefined;
      }> = [];
      this.graph.forEachOutEdge(fileId, (_: string, attrs: GraphEdgeAttrs, __: string, target: string) => {
        if (attrs.type !== "IMPORTS") return;
        const targetAttrs = this.graph.getNodeAttributes(target);
        results.push({
          path: targetAttrs.path!,
          language: targetAttrs.language,
        });
      });
      return results;
    }

    // Multi-depth BFS
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [
      { id: fileId, depth: 0 },
    ];
    const results: Array<{
      path: string;
      language: string | undefined;
      depth: number;
    }> = [];

    while (queue.length > 0) {
      const { id, depth: d } = queue.shift()!;
      if (d >= depth) continue;

      this.graph.forEachOutEdge(id, (_: string, attrs: GraphEdgeAttrs, __: string, target: string) => {
        if (attrs.type !== "IMPORTS" || visited.has(target)) return;
        visited.add(target);
        const targetAttrs = this.graph.getNodeAttributes(target);
        results.push({
          path: targetAttrs.path!,
          language: targetAttrs.language,
          depth: d + 1,
        });
        queue.push({ id: target, depth: d + 1 });
      });
    }

    return results.sort((a, b) => a.depth - b.depth);
  }

  /** Get files that import a given file */
  getDependents(
    filePath: string,
    depth: number,
    repo?: string | null
  ): Array<{ path: string; language: string | undefined; depth?: number }> {
    const fileId = this.findNode(
      "File",
      repo ? { path: filePath, repo } : { path: filePath }
    );
    if (!fileId) return [];

    if (depth <= 1) {
      const results: Array<{
        path: string;
        language: string | undefined;
      }> = [];
      this.graph.forEachInEdge(fileId, (_: string, attrs: GraphEdgeAttrs, source: string) => {
        if (attrs.type !== "IMPORTS") return;
        const sourceAttrs = this.graph.getNodeAttributes(source);
        results.push({
          path: sourceAttrs.path!,
          language: sourceAttrs.language,
        });
      });
      return results;
    }

    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [
      { id: fileId, depth: 0 },
    ];
    const results: Array<{
      path: string;
      language: string | undefined;
      depth: number;
    }> = [];

    while (queue.length > 0) {
      const { id, depth: d } = queue.shift()!;
      if (d >= depth) continue;

      this.graph.forEachInEdge(id, (_: string, attrs: GraphEdgeAttrs, source: string) => {
        if (attrs.type !== "IMPORTS" || visited.has(source)) return;
        visited.add(source);
        const sourceAttrs = this.graph.getNodeAttributes(source);
        results.push({
          path: sourceAttrs.path!,
          language: sourceAttrs.language,
          depth: d + 1,
        });
        queue.push({ id: source, depth: d + 1 });
      });
    }

    return results.sort((a, b) => a.depth - b.depth);
  }

  /** Get file structure (functions, classes, interfaces, imports) */
  getFileStructure(
    filePath: string,
    repo?: string | null
  ): Record<string, unknown> | null {
    const fileId = this.findNode(
      "File",
      repo ? { path: filePath, repo } : { path: filePath }
    );
    if (!fileId) return null;

    const fileAttrs = this.graph.getNodeAttributes(fileId);
    const functions: Array<Record<string, unknown>> = [];
    const classes: Array<Record<string, unknown>> = [];
    const interfaces: Array<Record<string, unknown>> = [];
    const imports: string[] = [];
    const externalImports: string[] = [];

    this.graph.forEachOutEdge(fileId, (_: string, edgeAttrs: GraphEdgeAttrs, __: string, target: string) => {
      const targetAttrs = this.graph.getNodeAttributes(target);
      switch (edgeAttrs.type) {
        case "CONTAINS":
          if (targetAttrs.label === "Function") {
            functions.push({
              name: targetAttrs.name,
              kind: targetAttrs.kind,
              line: targetAttrs.startLine,
              async: targetAttrs.isAsync,
            });
          } else if (targetAttrs.label === "Class") {
            classes.push({
              name: targetAttrs.name,
              line: targetAttrs.startLine,
              abstract: targetAttrs.isAbstract,
            });
          } else if (targetAttrs.label === "Interface") {
            interfaces.push({
              name: targetAttrs.name,
              line: targetAttrs.startLine,
            });
          }
          break;
        case "IMPORTS":
          if (targetAttrs.path) imports.push(targetAttrs.path);
          break;
        case "IMPORTS_EXTERNAL":
          externalImports.push(targetAttrs.name);
          break;
      }
    });

    return {
      path: fileAttrs.path,
      language: fileAttrs.language,
      lineCount: fileAttrs.lineCount,
      size: fileAttrs.size,
      functions,
      classes,
      interfaces,
      imports,
      externalImports,
    };
  }

  /** Get call graph for a function */
  getCallGraph(
    functionName: string,
    depth: number,
    direction: string,
    repo?: string | null
  ): Array<{ caller: string; callee: string }> {
    // Find the function node
    let funcId: string | null = null;
    this.graph.forEachNode((id: string, attrs: GraphNodeAttrs) => {
      if (funcId) return;
      if (attrs.label !== "Function") return;
      if (repo && attrs.repo !== repo) return;
      if (attrs.name === functionName || attrs.qualifiedName === functionName) {
        funcId = id;
      }
    });
    if (!funcId) return [];

    const results: Array<{ caller: string; callee: string }> = [];
    const visited = new Set<string>();

    const traverse = (nodeId: string, d: number) => {
      if (d >= depth || visited.has(nodeId)) return;
      visited.add(nodeId);

      if (direction === "callees" || direction === "both") {
        this.graph.forEachOutEdge(nodeId, (_: string, edgeAttrs: GraphEdgeAttrs, __: string, target: string) => {
          if (edgeAttrs.type !== "CALLS") return;
          const callerAttrs = this.graph.getNodeAttributes(nodeId);
          const calleeAttrs = this.graph.getNodeAttributes(target);
          results.push({
            caller: callerAttrs.qualifiedName ?? callerAttrs.name,
            callee: calleeAttrs.qualifiedName ?? calleeAttrs.name,
          });
          traverse(target, d + 1);
        });
      }

      if (direction === "callers" || direction === "both") {
        this.graph.forEachInEdge(nodeId, (_: string, edgeAttrs: GraphEdgeAttrs, source: string) => {
          if (edgeAttrs.type !== "CALLS") return;
          const callerAttrs = this.graph.getNodeAttributes(source);
          const calleeAttrs = this.graph.getNodeAttributes(nodeId);
          results.push({
            caller: callerAttrs.qualifiedName ?? callerAttrs.name,
            callee: calleeAttrs.qualifiedName ?? calleeAttrs.name,
          });
          traverse(source, d + 1);
        });
      }
    };

    traverse(funcId, 0);

    // Deduplicate
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = `${r.caller}->${r.callee}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Find related entities within N hops */
  findRelated(
    entityName: string,
    maxHops: number,
    repo?: string | null
  ): Array<{
    type: string;
    name: string;
    qualifiedName: string | undefined;
    distance: number;
  }> {
    // Find the starting node
    let startId: string | null = null;
    this.graph.forEachNode((id: string, attrs: GraphNodeAttrs) => {
      if (startId) return;
      if (repo && attrs.repo !== repo) return;
      if (attrs.name === entityName || attrs.qualifiedName === entityName) {
        startId = id;
      }
    });
    if (!startId) return [];

    const visited = new Set<string>([startId]);
    const queue: Array<{ id: string; distance: number }> = [
      { id: startId, distance: 0 },
    ];
    const results: Array<{
      type: string;
      name: string;
      qualifiedName: string | undefined;
      distance: number;
    }> = [];

    while (queue.length > 0) {
      const { id, distance } = queue.shift()!;
      if (distance >= maxHops) continue;

      // Traverse all edges (both directions)
      const neighbors = new Set<string>();
      this.graph.forEachOutEdge(id, (_: string, __: GraphEdgeAttrs, ___: string, target: string) => {
        neighbors.add(target);
      });
      this.graph.forEachInEdge(id, (_: string, __: GraphEdgeAttrs, source: string) => {
        neighbors.add(source);
      });

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const attrs = this.graph.getNodeAttributes(neighborId);
        results.push({
          type: attrs.label,
          name: attrs.name,
          qualifiedName: attrs.qualifiedName,
          distance: distance + 1,
        });
        queue.push({ id: neighborId, distance: distance + 1 });
      }
    }

    results.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
    return results.slice(0, 50);
  }

  /** Get repo summary statistics */
  getRepoSummary(repo?: string | null): Record<string, unknown> {
    let fileCount = 0;
    let funcCount = 0;
    let classCount = 0;
    let interfaceCount = 0;
    let totalLines = 0;
    const languages = new Set<string>();

    this.graph.forEachNode((_: string, attrs: GraphNodeAttrs) => {
      if (repo && attrs.repo !== repo) return;
      switch (attrs.label) {
        case "File":
          fileCount++;
          totalLines += attrs.lineCount ?? 0;
          if (attrs.language) languages.add(attrs.language);
          break;
        case "Function":
          funcCount++;
          break;
        case "Class":
          classCount++;
          break;
        case "Interface":
          interfaceCount++;
          break;
      }
    });

    let importCount = 0;
    let callCount = 0;
    this.graph.forEachEdge((_: string, attrs: GraphEdgeAttrs) => {
      if (attrs.type === "IMPORTS") importCount++;
      if (attrs.type === "CALLS") callCount++;
    });

    return {
      fileCount,
      languages: [...languages],
      totalLines,
      funcCount,
      classCount,
      interfaceCount,
      importCount,
      callCount,
    };
  }

  /** Get graph data for visualization (replaces getGraphData Cypher query) */
  getGraphData(
    nodeTypes: string[] | null,
    limit: number,
    repo?: string | null
  ): { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } {
    const nodes: Array<Record<string, unknown>> = [];
    const nodeIdSet = new Set<string>();

    this.graph.forEachNode((id: string, attrs: GraphNodeAttrs) => {
      if (attrs.label === "Community") return;
      if (nodeTypes && !nodeTypes.includes(attrs.label)) return;
      if (repo && attrs.repo !== repo) return;
      if (nodes.length >= limit) return;

      nodeIdSet.add(id);
      nodes.push({
        id,
        labels: [attrs.label],
        name: attrs.name,
        qualifiedName: attrs.qualifiedName,
        path: attrs.path,
        language: attrs.language,
        lineCount: attrs.lineCount,
        startLine: attrs.startLine,
        endLine: attrs.endLine,
        kind: attrs.kind,
        communityId: attrs.communityId,
        repo: attrs.repo,
      });
    });

    const edges: Array<Record<string, unknown>> = [];
    this.graph.forEachEdge((_: string, attrs: GraphEdgeAttrs, source: string, target: string) => {
      if (nodeIdSet.has(source) && nodeIdSet.has(target)) {
        edges.push({
          source,
          target,
          type: attrs.type,
        });
      }
    });

    return { nodes, edges };
  }

  /** Search nodes for QuickPick (replaces searchNodes Cypher) */
  searchNodes(
    query: string
  ): Array<{
    id: string;
    type: string;
    name: string;
    qualifiedName: string | undefined;
    score: number;
  }> {
    if (!query.trim()) return [];
    const lowerQuery = query.toLowerCase();
    const results: Array<{
      id: string;
      type: string;
      name: string;
      qualifiedName: string | undefined;
      score: number;
    }> = [];

    this.graph.forEachNode((id: string, attrs: GraphNodeAttrs) => {
      if (
        attrs.label === "Folder" ||
        attrs.label === "Module" ||
        attrs.label === "Community"
      )
        return;

      const name = attrs.name?.toLowerCase() ?? "";
      const qn = attrs.qualifiedName?.toLowerCase() ?? "";

      let score = 0;
      if (name === lowerQuery) score = 10;
      else if (name.startsWith(lowerQuery)) score = 5;
      else if (name.includes(lowerQuery)) score = 3;
      else if (qn.includes(lowerQuery)) score = 1;

      if (score > 0) {
        results.push({
          id,
          type: attrs.label,
          name: attrs.name,
          qualifiedName: attrs.qualifiedName,
          score,
        });
      }
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 20);
  }

  /** Get node details by ID (replaces getNodeDetails Cypher) */
  getNodeDetails(id: string): {
    id: string;
    labels: string[];
    properties: Record<string, unknown>;
    relationships: Array<Record<string, unknown>>;
  } {
    if (!this.graph.hasNode(id)) {
      return { id, labels: [], properties: {}, relationships: [] };
    }

    const attrs = this.graph.getNodeAttributes(id);
    const relationships: Array<Record<string, unknown>> = [];

    this.graph.forEachOutEdge(id, (_: string, edgeAttrs: GraphEdgeAttrs, __: string, target: string) => {
      const targetAttrs = this.graph.getNodeAttributes(target);
      relationships.push({
        relType: edgeAttrs.type,
        direction: "out",
        relatedName: targetAttrs.name,
        relatedId: target,
        relatedLabels: [targetAttrs.label],
      });
    });

    this.graph.forEachInEdge(id, (_: string, edgeAttrs: GraphEdgeAttrs, source: string) => {
      const sourceAttrs = this.graph.getNodeAttributes(source);
      relationships.push({
        relType: edgeAttrs.type,
        direction: "in",
        relatedName: sourceAttrs.name,
        relatedId: source,
        relatedLabels: [sourceAttrs.label],
      });
    });

    const { label, ...props } = attrs;
    return {
      id,
      labels: [label],
      properties: props as Record<string, unknown>,
      relationships,
    };
  }

  /** Run community detection using Louvain (replaces Neo4j-based community detection) */
  detectCommunities(
    resolutions: number[] = [0.5, 1.0, 2.0]
  ): Array<{ id: string; level: number; memberCount: number }> {
    // Build an undirected graphology for Louvain
    const undirected = new Graph({ type: "undirected", multi: false });

    const EDGE_WEIGHTS: Record<string, number> = {
      CALLS: 3,
      IMPORTS: 2,
      HAS_METHOD: 2,
      EXTENDS: 2,
      CONTAINS: 1,
      IMPORTS_EXTERNAL: 0.5,
    };

    this.graph.forEachNode((id: string, attrs: GraphNodeAttrs) => {
      if (attrs.label === "Community") return;
      if (!undirected.hasNode(id)) {
        undirected.addNode(id, { type: attrs.label, name: attrs.name });
      }
    });

    this.graph.forEachEdge((_: string, attrs: GraphEdgeAttrs, source: string, target: string) => {
      if (
        undirected.hasNode(source) &&
        undirected.hasNode(target) &&
        source !== target &&
        !undirected.hasEdge(source, target)
      ) {
        undirected.addEdge(source, target, {
          weight: EDGE_WEIGHTS[attrs.type] ?? 1,
        });
      }
    });

    if (undirected.order === 0) return [];

    const allCommunities: Array<{
      id: string;
      level: number;
      memberCount: number;
    }> = [];

    for (let level = 0; level < resolutions.length; level++) {
      const communities = louvain(undirected, {
        resolution: resolutions[level],
        getEdgeWeight: "weight",
      });

      // Group by community
      const groups = new Map<number, string[]>();
      for (const [nodeId, community] of Object.entries(communities)) {
        const num = community as number;
        const members = groups.get(num) ?? [];
        members.push(nodeId);
        groups.set(num, members);
      }

      for (const [communityNum, memberIds] of groups) {
        const communityId = `level${level}_community${communityNum}`;
        allCommunities.push({
          id: communityId,
          level,
          memberCount: memberIds.length,
        });

        // Tag nodes with their community assignment
        for (const nodeId of memberIds) {
          if (this.graph.hasNode(nodeId) && level === 1) {
            this.graph.setNodeAttribute(nodeId, "communityId", communityId);
          }
        }
      }
    }

    return allCommunities;
  }
}
