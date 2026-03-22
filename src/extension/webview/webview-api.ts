export type GraphNode = {
  id: string;
  labels: string[];
  name: string | null;
  qualifiedName: string | null;
  path: string | null;
  language: string | null;
  lineCount: number | null;
  startLine: number | null;
  endLine: number | null;
  kind: string | null;
  communityId: string | null;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type SearchResult = {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  score: number;
};

export type NodeDetails = {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
  relationships: Array<{
    relType: string;
    direction: string;
    relatedName: string;
    relatedId: string;
    relatedLabels: string[];
  }>;
};

// Acquire VS Code API once
const vscode = acquireVsCodeApi();

let requestId = 0;
const pending = new Map<
  number,
  { resolve: (value: any) => void; reject: (reason: any) => void }
>();

// Listen for responses from the extension host
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "response" && typeof msg.id === "number") {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.data);
      }
    }
  }
});

function request<T>(type: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = requestId++;
    pending.set(id, { resolve, reject });
    vscode.postMessage({ id, type, payload });
  });
}

export const fetchGraph = (
  types: string[] | null,
  limit: number
): Promise<GraphData> => request("fetchGraph", { types, limit });

export const searchCode = (query: string): Promise<SearchResult[]> =>
  request("searchCode", { query });

export const fetchNodeDetails = (id: string): Promise<NodeDetails> =>
  request("fetchNodeDetails", { id });

/** Fire-and-forget message to extension host to open a file */
export const openFile = (filePath: string, line?: number): void => {
  vscode.postMessage({ type: "openFile", path: filePath, line: line ?? 1 });
};
