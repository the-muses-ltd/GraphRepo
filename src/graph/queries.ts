import type Graph from "graphology";
import type { NodeAttributes, EdgeAttributes } from "./store.js";
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  SearchResult,
  NodeDetails,
} from "../web/api.js";

type StoreGraph = Graph<NodeAttributes, EdgeAttributes>;

// ---- Search ----

export function searchByName(
  graph: StoreGraph,
  pattern: string,
  type: string,
  limit: number,
  repo?: string | null
): Array<{
  type: string;
  name: string;
  qualifiedName: string;
  score: number;
}> {
  const results: Array<{
    type: string;
    name: string;
    qualifiedName: string;
    score: number;
  }> = [];
  const lowerPattern = pattern.toLowerCase();
  const searchableTypes = new Set([
    "Function",
    "Class",
    "Interface",
    "Variable",
    "File",
    "Module",
  ]);

  graph.forEachNode((_id, attrs) => {
    if (!searchableTypes.has(attrs.type)) return;
    if (type !== "all" && attrs.type.toLowerCase() !== type) return;
    if (repo && attrs.repo !== repo) return;

    const name = (attrs.name ?? "").toLowerCase();
    const qn = (attrs.qualifiedName ?? "").toLowerCase();

    let score = 0;
    if (name === lowerPattern) score = 10;
    else if (name.startsWith(lowerPattern)) score = 7;
    else if (name.includes(lowerPattern)) score = 5;
    else if (qn.includes(lowerPattern)) score = 3;
    else return;

    results.push({
      type: attrs.type,
      name: attrs.name,
      qualifiedName: attrs.qualifiedName ?? "",
      score,
    });
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function searchNodes(
  graph: StoreGraph,
  query: string
): SearchResult[] {
  if (!query.trim()) return [];
  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];
  const searchableTypes = new Set([
    "Function",
    "Class",
    "Interface",
    "Variable",
  ]);

  graph.forEachNode((id, attrs) => {
    if (!searchableTypes.has(attrs.type)) return;

    const name = (attrs.name ?? "").toLowerCase();
    const qn = (attrs.qualifiedName ?? "").toLowerCase();

    let score = 0;
    if (name === lowerQuery) score = 10;
    else if (name.startsWith(lowerQuery)) score = 7;
    else if (name.includes(lowerQuery)) score = 5;
    else if (qn.includes(lowerQuery)) score = 3;
    else return;

    results.push({
      id,
      type: attrs.type,
      name: attrs.name,
      qualifiedName: attrs.qualifiedName ?? "",
      score,
    });
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

// ---- Dependency traversal ----

export function getDependencies(
  graph: StoreGraph,
  filePath: string,
  depth: number,
  repo?: string | null
): Array<{ path: string; language: string; depth: number }> {
  const startId = `File::${filePath}`;
  if (!graph.hasNode(startId)) return [];

  const results: Array<{ path: string; language: string; depth: number }> = [];
  const visited = new Set<string>([startId]);
  let frontier = [startId];

  for (let d = 1; d <= depth; d++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      graph.forEachOutEdge(nodeId, (_edgeId, edgeAttrs, _source, target) => {
        if (edgeAttrs.type !== "IMPORTS") return;
        if (visited.has(target)) return;
        visited.add(target);
        const targetAttrs = graph.getNodeAttributes(target);
        if (targetAttrs.type !== "File") return;
        if (repo && targetAttrs.repo !== repo) return;
        results.push({
          path: targetAttrs.path!,
          language: targetAttrs.language!,
          depth: d,
        });
        nextFrontier.push(target);
      });
    }
    frontier = nextFrontier;
  }

  return results;
}

export function getDependents(
  graph: StoreGraph,
  filePath: string,
  depth: number,
  repo?: string | null
): Array<{ path: string; language: string; depth: number }> {
  const targetId = `File::${filePath}`;
  if (!graph.hasNode(targetId)) return [];

  const results: Array<{ path: string; language: string; depth: number }> = [];
  const visited = new Set<string>([targetId]);
  let frontier = [targetId];

  for (let d = 1; d <= depth; d++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      graph.forEachInEdge(nodeId, (_edgeId, edgeAttrs, source, _target) => {
        if (edgeAttrs.type !== "IMPORTS") return;
        if (visited.has(source)) return;
        visited.add(source);
        const sourceAttrs = graph.getNodeAttributes(source);
        if (sourceAttrs.type !== "File") return;
        if (repo && sourceAttrs.repo !== repo) return;
        results.push({
          path: sourceAttrs.path!,
          language: sourceAttrs.language!,
          depth: d,
        });
        nextFrontier.push(source);
      });
    }
    frontier = nextFrontier;
  }

  return results;
}

// ---- File structure ----

export function getFileStructure(
  graph: StoreGraph,
  filePath: string,
  _repo?: string | null
): Record<string, unknown> | null {
  const fId = `File::${filePath}`;
  if (!graph.hasNode(fId)) return null;

  const fileAttrs = graph.getNodeAttributes(fId);
  const functions: Array<Record<string, unknown>> = [];
  const classes: Array<Record<string, unknown>> = [];
  const interfaces: Array<Record<string, unknown>> = [];
  const imports: string[] = [];
  const externalImports: string[] = [];

  graph.forEachOutEdge(fId, (_edgeId, edgeAttrs, _source, target) => {
    const targetAttrs = graph.getNodeAttributes(target);

    switch (edgeAttrs.type) {
      case "CONTAINS":
        if (targetAttrs.type === "Function") {
          functions.push({
            name: targetAttrs.name,
            kind: targetAttrs.kind,
            line: targetAttrs.startLine,
            async: targetAttrs.isAsync,
          });
        } else if (targetAttrs.type === "Class") {
          classes.push({
            name: targetAttrs.name,
            line: targetAttrs.startLine,
            abstract: targetAttrs.isAbstract,
          });
        } else if (targetAttrs.type === "Interface") {
          interfaces.push({
            name: targetAttrs.name,
            line: targetAttrs.startLine,
          });
        }
        break;
      case "IMPORTS":
        imports.push(targetAttrs.path!);
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

// ---- Call graph ----

export function getCallGraph(
  graph: StoreGraph,
  functionName: string,
  depth: number,
  direction: string,
  repo?: string | null
): Array<{ caller: string; callee: string }> {
  // Find the function node by name or qualifiedName
  let startId: string | null = null;
  graph.forEachNode((id, attrs) => {
    if (startId) return;
    if (attrs.type !== "Function") return;
    if (repo && attrs.repo !== repo) return;
    if (attrs.name === functionName || attrs.qualifiedName === functionName) {
      startId = id;
    }
  });
  if (!startId) return [];

  const start: string = startId;
  const edges: Array<{ caller: string; callee: string }> = [];
  const edgeSet = new Set<string>();
  const visited = new Set<string>([start]);
  let frontier: string[] = [start];

  for (let d = 0; d < depth; d++) {
    const nextFrontier: string[] = [];

    for (const currentNode of frontier) {
      const processEdge = (
        _edgeId: string,
        edgeAttrs: EdgeAttributes,
        source: string,
        target: string
      ) => {
        if (edgeAttrs.type !== "CALLS") return;

        const edgeKey = `${source}->${target}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          const callerAttrs = graph.getNodeAttributes(source);
          const calleeAttrs = graph.getNodeAttributes(target);
          edges.push({
            caller: callerAttrs.qualifiedName ?? callerAttrs.name,
            callee: calleeAttrs.qualifiedName ?? calleeAttrs.name,
          });
        }

        const other = source === currentNode ? target : source;
        if (!visited.has(other)) {
          visited.add(other);
          nextFrontier.push(other);
        }
      };

      if (direction === "callers") {
        graph.forEachInEdge(currentNode, processEdge);
      } else if (direction === "callees") {
        graph.forEachOutEdge(currentNode, processEdge);
      } else {
        graph.forEachEdge(currentNode, processEdge);
      }
    }

    frontier = nextFrontier;
  }

  return edges;
}

// ---- Find related ----

export function findRelated(
  graph: StoreGraph,
  entityName: string,
  maxHops: number,
  repo?: string | null
): Array<{
  type: string;
  name: string;
  qualifiedName: string;
  distance: number;
}> {
  let startId: string | null = null;
  graph.forEachNode((id, attrs) => {
    if (startId) return;
    if (attrs.name === entityName || attrs.qualifiedName === entityName) {
      if (!repo || attrs.repo === repo) startId = id;
    }
  });
  if (!startId) return [];

  const results: Array<{
    type: string;
    name: string;
    qualifiedName: string;
    distance: number;
  }> = [];
  const start: string = startId;
  const visited = new Set<string>([start]);
  let frontier: string[] = [start];

  for (let d = 1; d <= maxHops; d++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      for (const neighbor of graph.neighbors(nodeId)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        const attrs = graph.getNodeAttributes(neighbor);
        results.push({
          type: attrs.type,
          name: attrs.name,
          qualifiedName: attrs.qualifiedName ?? "",
          distance: d,
        });
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  results.sort(
    (a, b) => a.distance - b.distance || a.name.localeCompare(b.name)
  );
  return results.slice(0, 50);
}

// ---- Repository summary ----

export function getRepoSummary(
  graph: StoreGraph,
  repo?: string | null
): Record<string, unknown> {
  let fileCount = 0,
    funcCount = 0,
    classCount = 0,
    interfaceCount = 0;
  let totalLines = 0;
  const languages = new Set<string>();

  graph.forEachNode((_id, attrs) => {
    if (repo && attrs.repo !== repo) return;
    switch (attrs.type) {
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

  let importCount = 0,
    callCount = 0;
  graph.forEachEdge((_id, attrs) => {
    if (attrs.type === "IMPORTS") importCount++;
    else if (attrs.type === "CALLS") callCount++;
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

// ---- Graph data for visualization ----

export function getGraphData(
  graph: StoreGraph,
  nodeTypes: string[] | null,
  limit: number,
  repo?: string | null
): GraphData {
  const nodeTypeSet = nodeTypes ? new Set(nodeTypes) : null;
  const nodes: GraphNode[] = [];
  const includedIds = new Set<string>();

  graph.forEachNode((id, attrs) => {
    if (attrs.type === "Community") return;
    if (nodeTypeSet && !nodeTypeSet.has(attrs.type)) return;
    if (repo && attrs.repo !== repo) return;
    if (nodes.length >= limit) return;

    includedIds.add(id);
    nodes.push({
      id,
      labels: [attrs.type],
      name: attrs.name ?? null,
      qualifiedName: attrs.qualifiedName ?? null,
      path: attrs.path ?? null,
      language: attrs.language ?? null,
      lineCount: attrs.lineCount ?? null,
      startLine: attrs.startLine ?? null,
      endLine: attrs.endLine ?? null,
      kind: attrs.kind ?? null,
      communityId: attrs.communityId ?? null,
    });
  });

  const edges: GraphEdge[] = [];
  graph.forEachEdge((_edgeId, attrs, source, target) => {
    if (
      includedIds.has(source) &&
      includedIds.has(target) &&
      attrs.type !== "BELONGS_TO_COMMUNITY" &&
      attrs.type !== "PARENT_COMMUNITY"
    ) {
      edges.push({ source, target, type: attrs.type });
    }
  });

  return { nodes, edges };
}

// ---- Node details ----

export function getNodeDetails(
  graph: StoreGraph,
  id: string
): NodeDetails {
  if (!graph.hasNode(id)) {
    return { id, labels: [], properties: {}, relationships: [] };
  }

  const attrs = graph.getNodeAttributes(id);
  const relationships: NodeDetails["relationships"] = [];

  graph.forEachEdge(id, (_edgeId, edgeAttrs, source, target) => {
    const other = source === id ? target : source;
    const direction = source === id ? "out" : "in";
    const relatedAttrs = graph.getNodeAttributes(other);
    relationships.push({
      relType: edgeAttrs.type,
      direction,
      relatedName: relatedAttrs.name,
      relatedId: other,
      relatedLabels: [relatedAttrs.type],
    });
  });

  return {
    id,
    labels: [attrs.type],
    properties: { ...attrs },
    relationships,
  };
}

// ---- Communities ----

export function getCommunities(
  graph: StoreGraph,
  level: number,
  limit: number
): Array<{
  id: string;
  level: number;
  memberCount: number;
  summary: string;
  sampleMembers: string[];
}> {
  const communities: Array<{
    id: string;
    level: number;
    memberCount: number;
    summary: string;
    sampleMembers: string[];
  }> = [];

  graph.forEachNode((id, attrs) => {
    if (attrs.type !== "Community" || attrs.level !== level) return;

    const members: string[] = [];
    graph.forEachInEdge(id, (_edgeId, edgeAttrs, source) => {
      if (edgeAttrs.type === "BELONGS_TO_COMMUNITY") {
        members.push(graph.getNodeAttributes(source).name);
      }
    });

    communities.push({
      id: attrs.name,
      level: attrs.level!,
      memberCount: attrs.memberCount ?? members.length,
      summary: attrs.summary ?? "",
      sampleMembers: members.slice(0, 10),
    });
  });

  communities.sort((a, b) => b.memberCount - a.memberCount);
  return communities.slice(0, limit);
}

// ---- Traversal (replaces raw Cypher query_graph) ----

export function runTraversal(
  graph: StoreGraph,
  startName: string,
  edgeTypes: string[] | null,
  direction: "in" | "out" | "both",
  maxDepth: number
): Array<Record<string, unknown>> {
  let startId: string | null = null;
  graph.forEachNode((id, attrs) => {
    if (startId) return;
    if (
      attrs.name === startName ||
      attrs.qualifiedName === startName ||
      attrs.path === startName
    ) {
      startId = id;
    }
  });
  if (!startId) return [];

  const start: string = startId;
  const edgeTypeSet = edgeTypes ? new Set(edgeTypes) : null;
  const results: Array<Record<string, unknown>> = [];
  const visited = new Set<string>([start]);
  let frontier: string[] = [start];

  for (let d = 1; d <= maxDepth; d++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      const processEdge = (
        _edgeId: string,
        edgeAttrs: EdgeAttributes,
        source: string,
        target: string
      ) => {
        if (edgeTypeSet && !edgeTypeSet.has(edgeAttrs.type)) return;
        const other = source === nodeId ? target : source;
        if (visited.has(other)) return;
        visited.add(other);
        const otherAttrs = graph.getNodeAttributes(other);
        results.push({
          type: otherAttrs.type,
          name: otherAttrs.name,
          qualifiedName: otherAttrs.qualifiedName ?? null,
          path: otherAttrs.path ?? null,
          relationship: edgeAttrs.type,
          direction: source === nodeId ? "out" : "in",
          depth: d,
        });
        nextFrontier.push(other);
      };

      if (direction === "out") graph.forEachOutEdge(nodeId, processEdge);
      else if (direction === "in") graph.forEachInEdge(nodeId, processEdge);
      else graph.forEachEdge(nodeId, processEdge);
    }
    frontier = nextFrontier;
  }

  return results;
}
