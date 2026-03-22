import { withSession, closeDriver } from "../graph/connection.js";
import { getGraphData, searchNodes } from "../graph/queries.js";
import type { GraphData, NodeDetails, SearchResult } from "../web/api.js";

export type Neo4jConfig = {
  uri: string;
  username: string;
  password: string;
  database: string;
};

export class Neo4jService {
  constructor(private config: Neo4jConfig) {}

  async getGraphData(
    types: string[] | null,
    limit: number,
    repo?: string | null
  ): Promise<GraphData> {
    return withSession(this.config, async (session) => {
      const query = getGraphData(types, limit, repo);
      const result = await session.run(query.cypher, query.params);
      const record = result.records[0];
      if (!record) return { nodes: [], edges: [] };

      return {
        nodes: record.get("nodes"),
        edges: record
          .get("edges")
          .filter((e: { source: unknown }) => e.source !== null),
      };
    });
  }

  async searchNodes(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];
    return withSession(this.config, async (session) => {
      const q = searchNodes(query);
      const result = await session.run(q.cypher, q.params);
      return result.records.map((r) => ({
        id: r.get("id"),
        type: r.get("type"),
        name: r.get("name"),
        qualifiedName: r.get("qualifiedName"),
        score: r.get("score"),
      }));
    });
  }

  async getNodeDetails(id: string): Promise<NodeDetails> {
    return withSession(this.config, async (session) => {
      const result = await session.run(
        `MATCH (n) WHERE elementId(n) = $id
         OPTIONAL MATCH (n)-[r]-(related)
         RETURN n, labels(n) AS labels, properties(n) AS props,
                collect({
                  relType: type(r),
                  direction: CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END,
                  relatedName: related.name,
                  relatedId: elementId(related),
                  relatedLabels: labels(related)
                }) AS relationships`,
        { id }
      );

      const record = result.records[0];
      if (!record) {
        return { id, labels: [], properties: {}, relationships: [] };
      }

      return {
        id,
        labels: record.get("labels"),
        properties: record.get("props"),
        relationships: record.get("relationships"),
      };
    });
  }

  async dispose(): Promise<void> {
    await closeDriver();
  }
}
