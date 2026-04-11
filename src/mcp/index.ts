import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getStore } from "../graph/store.js";
import * as queries from "../graph/queries.js";
import type { Config } from "../config.js";
import type { EmbeddingService } from "../graphrag/embeddings.js";
import type { VectorStore } from "../graphrag/vector-store.js";

const MCP_EVENT_FILE = join(tmpdir(), "graphrepo-mcp-events.json");

/** Write an MCP event so the extension can visualize what's being queried */
const emitEvent = (tool: string, target: string, targetType: "file" | "function" | "entity" | "query") => {
  try {
    writeFileSync(MCP_EVENT_FILE, JSON.stringify({
      tool,
      target,
      targetType,
      timestamp: Date.now(),
    }));
  } catch {
    // Non-critical — don't break MCP if event write fails
  }
};

const formatResults = (records: unknown): string => {
  if (Array.isArray(records) && records.length === 0) return "No results found.";
  return JSON.stringify(records, null, 2);
};

export const createMcpServer = (
  config: Config,
  options?: { embeddingService?: EmbeddingService; vectorStore?: VectorStore },
): McpServer => {
  const server = new McpServer({
    name: "graphrepo",
    version: "0.2.0",
  });

  const graph = getStore();
  const defaultRepo = config.repoPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? null;

  // search_code
  server.tool(
    "search_code",
    "Search for functions, classes, interfaces, or variables by name or pattern in the code graph",
    {
      query: z.string().describe("Name or pattern to search for"),
      type: z
        .enum(["function", "class", "interface", "variable", "all"])
        .default("all")
        .describe("Filter by entity type"),
      limit: z.number().default(20).describe("Maximum results to return"),
    },
    async ({ query, type, limit }) => {
      emitEvent("search_code", query, "entity");
      try {
        const results = queries.searchByName(graph, query, type, limit, defaultRepo);
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error searching: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // get_dependencies
  server.tool(
    "get_dependencies",
    "Get files and modules that a given file imports/depends on",
    {
      filePath: z.string().describe("Relative file path in the repository"),
      depth: z.number().default(1).describe("How many levels deep to traverse (1 = direct only)"),
    },
    async ({ filePath, depth }) => {
      emitEvent("get_dependencies", filePath, "file");
      try {
        const results = queries.getDependencies(graph, filePath, depth, defaultRepo);
        return { content: [{ type: "text" as const, text: formatResults(results) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // get_dependents
  server.tool(
    "get_dependents",
    "Get files that import/depend on a given file",
    {
      filePath: z.string().describe("Relative file path in the repository"),
      depth: z.number().default(1).describe("How many levels deep to traverse"),
    },
    async ({ filePath, depth }) => {
      emitEvent("get_dependents", filePath, "file");
      try {
        const results = queries.getDependents(graph, filePath, depth, defaultRepo);
        return { content: [{ type: "text" as const, text: formatResults(results) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // get_file_structure
  server.tool(
    "get_file_structure",
    "Get the complete structure of a file: all functions, classes, interfaces, imports, and exports",
    {
      filePath: z.string().describe("Relative file path in the repository"),
    },
    async ({ filePath }) => {
      emitEvent("get_file_structure", filePath, "file");
      try {
        const result = queries.getFileStructure(graph, filePath, defaultRepo);
        if (!result) return { content: [{ type: "text" as const, text: "File not found in graph." }] };
        return { content: [{ type: "text" as const, text: formatResults([result]) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // get_call_graph
  server.tool(
    "get_call_graph",
    "Get the call graph for a function — what it calls and/or what calls it",
    {
      functionName: z.string().describe("Function name or qualified name (file:name)"),
      depth: z.number().default(2).describe("How many levels of calls to traverse"),
      direction: z
        .enum(["callers", "callees", "both"])
        .default("both")
        .describe("Direction: callers, callees, or both"),
    },
    async ({ functionName, depth, direction }) => {
      emitEvent("get_call_graph", functionName, "function");
      try {
        const results = queries.getCallGraph(graph, functionName, depth, direction, defaultRepo);
        return { content: [{ type: "text" as const, text: formatResults(results) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // find_related
  server.tool(
    "find_related",
    "Find code entities related to a given entity within N relationship hops",
    {
      entityName: z.string().describe("Entity name or qualified name"),
      maxHops: z.number().default(2).describe("Maximum relationship hops"),
    },
    async ({ entityName, maxHops }) => {
      emitEvent("find_related", entityName, "entity");
      try {
        const results = queries.findRelated(graph, entityName, maxHops, defaultRepo);
        return { content: [{ type: "text" as const, text: formatResults(results) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // run_traversal (replaces query_graph — structured traversal instead of raw Cypher)
  server.tool(
    "run_traversal",
    "Traverse the code graph from a starting entity. Use this for custom graph exploration.",
    {
      startNode: z.string().describe("Name, qualified name, or file path of the start node"),
      edgeTypes: z
        .array(z.string())
        .nullable()
        .default(null)
        .describe("Filter by edge types (IMPORTS, CALLS, CONTAINS, HAS_METHOD, EXTENDS, etc). Null = all."),
      direction: z
        .enum(["in", "out", "both"])
        .default("both")
        .describe("Traversal direction"),
      maxDepth: z.number().default(2).describe("Maximum traversal depth"),
    },
    async ({ startNode, edgeTypes, direction, maxDepth }) => {
      emitEvent("run_traversal", startNode, "entity");
      try {
        const results = queries.runTraversal(graph, startNode, edgeTypes, direction, maxDepth);
        return { content: [{ type: "text" as const, text: formatResults(results) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // get_summary
  server.tool(
    "get_summary",
    "Get a high-level summary of the repository: file count, function count, class count, languages, etc.",
    {},
    async () => {
      emitEvent("get_summary", "repo", "query");
      try {
        const result = queries.getRepoSummary(graph, defaultRepo);
        return { content: [{ type: "text" as const, text: formatResults([result]) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // get_communities
  server.tool(
    "get_communities",
    "List detected code communities at a given hierarchy level with their summaries",
    {
      level: z.number().default(1).describe("Community hierarchy level (0=finest, higher=coarser)"),
      limit: z.number().default(20).describe("Max communities to return"),
    },
    async ({ level, limit }) => {
      try {
        const results = queries.getCommunities(graph, level, limit);
        return { content: [{ type: "text" as const, text: formatResults(results) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // semantic_search (only registered if embedding service is available)
  if (options?.embeddingService && options?.vectorStore) {
    const embSvc = options.embeddingService;
    const vecStore = options.vectorStore;

    server.tool(
      "semantic_search",
      "Search code by meaning — find entities related to a concept even without exact name matches",
      {
        query: z.string().describe("Natural language query describing what you're looking for"),
        limit: z.number().default(10).describe("Maximum results to return"),
      },
      async ({ query, limit }) => {
        emitEvent("semantic_search", query, "query");
        try {
          if (!embSvc.isReady()) {
            return {
              content: [{ type: "text" as const, text: "Embedding model not yet loaded. Try again shortly." }],
              isError: true,
            };
          }
          const queryEmbedding = await embSvc.embedText(query);
          const results = vecStore.search(queryEmbedding, limit);

          // Enrich results with node attributes from graph
          const enriched = results.map((r) => {
            try {
              const attrs = graph.getNodeAttributes(r.id);
              return {
                id: r.id,
                name: attrs.name,
                type: attrs.type,
                filePath: attrs.path,
                score: Math.round(r.score * 1000) / 1000,
                description: r.text,
              };
            } catch {
              return { id: r.id, score: Math.round(r.score * 1000) / 1000, description: r.text };
            }
          });

          return { content: [{ type: "text" as const, text: formatResults(enriched) }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
};

