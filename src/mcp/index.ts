import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { withSession } from "../graph/connection.js";
import * as queries from "../graph/queries.js";

const WRITE_KEYWORDS = /\b(CREATE|DELETE|MERGE|SET|REMOVE|DROP|DETACH)\b/i;

const runQuery = async (
  config: Config["neo4j"],
  query: { cypher: string; params: Record<string, unknown> }
) => {
  return withSession(config, async (session) => {
    const result = await session.run(query.cypher, query.params);
    return result.records.map((r) => r.toObject());
  });
};

const formatResults = (records: Record<string, unknown>[]): string => {
  if (records.length === 0) return "No results found.";
  return JSON.stringify(records, null, 2);
};

export const createMcpServer = (config: Config): McpServer => {
  const server = new McpServer({
    name: "graphrepo",
    version: "0.1.0",
  });

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
      try {
        const results = await runQuery(
          config.neo4j,
          queries.searchByName(query, type, limit)
        );
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
      try {
        const results = await runQuery(
          config.neo4j,
          queries.getDependencies(filePath, depth)
        );
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
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
      try {
        const results = await runQuery(
          config.neo4j,
          queries.getDependents(filePath, depth)
        );
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
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
      try {
        const results = await runQuery(
          config.neo4j,
          queries.getFileStructure(filePath)
        );
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
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
      try {
        const results = await runQuery(
          config.neo4j,
          queries.getCallGraph(functionName, depth, direction)
        );
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
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
      try {
        const results = await runQuery(
          config.neo4j,
          queries.findRelated(entityName, maxHops)
        );
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // query_graph
  server.tool(
    "query_graph",
    "Run a custom read-only Cypher query against the code graph. Write operations are blocked.",
    {
      cypher: z.string().describe("Cypher query (read-only)"),
    },
    async ({ cypher }) => {
      if (WRITE_KEYWORDS.test(cypher)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Only read-only queries are allowed. Write operations (CREATE, DELETE, MERGE, SET, REMOVE, DROP, DETACH) are blocked.",
            },
          ],
          isError: true,
        };
      }

      try {
        const results = await runQuery(config.neo4j, {
          cypher,
          params: {},
        });
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Query error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // get_summary
  server.tool(
    "get_summary",
    "Get a high-level summary of the repository: file count, function count, class count, languages, etc.",
    {},
    async () => {
      try {
        const results = await runQuery(config.neo4j, queries.getRepoSummary());
        return {
          content: [{ type: "text" as const, text: formatResults(results) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
};

export const startMcpServer = async (config: Config): Promise<void> => {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
