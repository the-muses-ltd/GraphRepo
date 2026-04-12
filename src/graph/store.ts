import Graph from "graphology";

// ---- Node attributes stored on each graphology node ----

export type NodeAttributes = {
  type: string; // "File" | "Function" | "Class" | "Interface" | "Module" | "Folder" | "Community"
  name: string;
  qualifiedName?: string;
  repo: string;
  path?: string;
  extension?: string;
  language?: string;
  lineCount?: number;
  size?: number;
  startLine?: number;
  endLine?: number;
  isExported?: boolean;
  isAsync?: boolean;
  isAbstract?: boolean;
  kind?: string;
  parameters?: string;
  returnType?: string | null;
  // Community-specific
  communityId?: string;
  level?: number;
  memberCount?: number;
  summary?: string;
};

// ---- Edge attributes stored on each graphology edge ----

export type EdgeAttributes = {
  type: string; // "CONTAINS" | "IMPORTS" | "CALLS" | "HAS_METHOD" | "EXTENDS" | "IMPORTS_EXTERNAL" | "CONTAINS_FILE" | "CONTAINS_FOLDER" | "BELONGS_TO_COMMUNITY" | "PARENT_COMMUNITY"
  specifier?: string;
  isDefault?: boolean;
  names?: string[];
  count?: number;
  weight?: number;
};

// ---- Node ID helpers ----

export function nodeId(type: string, key: string): string {
  return `${type}::${key}`;
}

export function fileId(path: string): string {
  return nodeId("File", path);
}

export function functionId(qualifiedName: string): string {
  return nodeId("Function", qualifiedName);
}

export function classId(qualifiedName: string): string {
  return nodeId("Class", qualifiedName);
}

export function interfaceId(qualifiedName: string): string {
  return nodeId("Interface", qualifiedName);
}

export function moduleId(name: string): string {
  return nodeId("Module", name);
}

export function folderId(path: string): string {
  return nodeId("Folder", path);
}

export function communityNodeId(id: string): string {
  return nodeId("Community", id);
}

// ---- Singleton graph store ----

let store: Graph<NodeAttributes, EdgeAttributes> | null = null;

export function getStore(): Graph<NodeAttributes, EdgeAttributes> {
  if (!store) {
    store = new Graph<NodeAttributes, EdgeAttributes>({
      type: "directed",
      multi: false,
      allowSelfLoops: false,
    });
  }
  return store;
}

export function setStore(graph: Graph<NodeAttributes, EdgeAttributes>): void {
  store = graph;
}

export function resetStore(): void {
  if (store) {
    store.clear();
  }
}

export function hasStore(): boolean {
  return store !== null && store.order > 0;
}
