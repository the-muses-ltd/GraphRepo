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

export const fetchGraph = async (
  types: string[] | null,
  limit: number
): Promise<GraphData> => {
  const params = new URLSearchParams();
  if (types) params.set("types", types.join(","));
  params.set("limit", String(limit));

  const res = await fetch(`/api/graph?${params}`);
  return res.json();
};

export const searchCode = async (query: string): Promise<SearchResult[]> => {
  if (!query.trim()) return [];
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return data.results;
};

export const fetchNodeDetails = async (id: string): Promise<NodeDetails> => {
  const res = await fetch(`/api/node/${encodeURIComponent(id)}`);
  return res.json();
};
