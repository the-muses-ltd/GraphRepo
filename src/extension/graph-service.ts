import { getStore } from "../graph/store.js";
import * as queries from "../graph/queries.js";
import type { GraphData, SearchResult, NodeDetails } from "../web/api.js";

export interface GraphQueryService {
  getGraphData(types: string[] | null, limit: number, repo?: string | null): Promise<GraphData>;
  searchNodes(query: string): Promise<SearchResult[]>;
  getNodeDetails(id: string): Promise<NodeDetails>;
  dispose(): void;
}

export class GraphService implements GraphQueryService {
  async getGraphData(
    types: string[] | null,
    limit: number,
    repo?: string | null
  ): Promise<GraphData> {
    return queries.getGraphData(getStore(), types, limit, repo);
  }

  async searchNodes(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];
    return queries.searchNodes(getStore(), query);
  }

  async getNodeDetails(id: string): Promise<NodeDetails> {
    return queries.getNodeDetails(getStore(), id);
  }

  dispose(): void {
    // No external resources to clean up
  }
}
