# GraphRepo

Neo4j + GraphRAG tool for parsing code repositories into queryable graphs with MCP server and D3 visualization.

## Setup

1. Start Neo4j: `docker compose up -d`
2. Install: `npm install`
3. Copy `.env.example` to `.env` and set your Neo4j password
4. Parse a repo: `npm run parse -- <path-to-repo>`
5. Start MCP server: `npm run serve`
6. Start visualization: `npm run build:web && npm run viz`

## Architecture

- `src/parser/` — Tree-sitter AST parsing (TS, JS, Python)
- `src/graph/` — Neo4j graph operations (MERGE-based, idempotent)
- `src/mcp/` — MCP server with 8 tools for Claude integration
- `src/web/` — D3-force graph visualization (dark theme)
- `src/cli/` — Commander CLI entry point

## Commands

- `npm run parse -- <path>` — Parse repo into Neo4j graph
- `npm run parse -- <path> --clear` — Clear graph first, then parse
- `npm run serve` — Start MCP server (STDIO transport)
- `npm run viz` — Start web visualization on :3000
- `npm run build:web` — Bundle the frontend
- `npm run typecheck` — TypeScript type checking

## Graph Schema

Nodes: File, Function, Class, Interface, Variable, Module
Relationships: CONTAINS, IMPORTS, IMPORTS_EXTERNAL, CALLS, HAS_METHOD, EXTENDS

## MCP Tools

- `search_code` — Full-text search by name
- `get_dependencies` / `get_dependents` — Import graph traversal
- `get_file_structure` — File contents overview
- `get_call_graph` — Function call chains
- `find_related` — N-hop graph exploration
- `query_graph` — Raw read-only Cypher
- `get_summary` — Repo statistics

## Tech Stack

TypeScript, web-tree-sitter, neo4j-driver, @modelcontextprotocol/sdk, d3-force, Fastify, Commander

## MCP Server Config (for Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "graphrepo": {
      "command": "npx",
      "args": ["tsx", "<absolute-path>/src/cli/index.ts", "serve"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USERNAME": "neo4j",
        "NEO4J_PASSWORD": "graphrepo-password"
      }
    }
  }
}
```
