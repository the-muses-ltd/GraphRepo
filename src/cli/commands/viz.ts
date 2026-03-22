import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "../../config.js";
import { withSession } from "../../graph/connection.js";
import { getGraphData, searchNodes } from "../../graph/queries.js";

type VizOptions = {
  port?: string;
};

export const vizCommand = async (options: VizOptions): Promise<void> => {
  const config = loadConfig(".");
  const port = parseInt(options.port ?? "3000", 10);

  const app = Fastify({ logger: false });

  // Serve static files from dist/web
  const webDir = path.resolve(
    fileURLToPath(import.meta.url),
    "..",
    "..",
    "..",
    "..",
    "dist",
    "web"
  );

  // Also serve the HTML from src/web
  const srcWebDir = path.resolve(
    fileURLToPath(import.meta.url),
    "..",
    "..",
    "..",
    "web"
  );

  await app.register(fastifyStatic, {
    root: [webDir, srcWebDir],
    prefix: "/",
  });

  // API: Get graph data
  app.get("/api/graph", async (request) => {
    const { types, limit } = request.query as {
      types?: string;
      limit?: string;
    };
    const nodeTypes = types ? types.split(",") : null;
    const maxNodes = parseInt(limit ?? "500", 10);

    return withSession(config.neo4j, async (session) => {
      const query = getGraphData(nodeTypes, maxNodes);
      const result = await session.run(query.cypher, query.params);
      const record = result.records[0];
      if (!record) return { nodes: [], edges: [] };

      return {
        nodes: record.get("nodes"),
        edges: record.get("edges").filter((e: { source: unknown }) => e.source !== null),
      };
    });
  });

  // API: Search nodes
  app.get("/api/search", async (request) => {
    const { q } = request.query as { q?: string };
    if (!q) return { results: [] };

    return withSession(config.neo4j, async (session) => {
      const query = searchNodes(q);
      const result = await session.run(query.cypher, query.params);
      return {
        results: result.records.map((r) => ({
          id: r.get("id"),
          type: r.get("type"),
          name: r.get("name"),
          qualifiedName: r.get("qualifiedName"),
          score: r.get("score"),
        })),
      };
    });
  });

  // API: Get node details
  app.get("/api/node/:id", async (request) => {
    const { id } = request.params as { id: string };

    return withSession(config.neo4j, async (session) => {
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
      if (!record) return { error: "Node not found" };

      return {
        id,
        labels: record.get("labels"),
        properties: record.get("props"),
        relationships: record.get("relationships"),
      };
    });
  });

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`GraphRepo visualization running at http://localhost:${port}`);
  console.log("Press Ctrl+C to stop");
};
