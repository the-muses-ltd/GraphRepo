# GraphRepo

GraphRAG-powered tool for visualizing and querying code repositories. Distributed as a self-contained VS Code extension — no Docker, no Neo4j, no external services.

## Setup

1. Install: `npm install`
2. Build: `npm run build:vscode`
3. Open in VS Code → run "GraphRepo: Parse Workspace" from command palette
4. Or CLI: `npm run parse -- <path-to-repo>` then `npm run serve`

## Architecture

- `src/parser/` — Tree-sitter AST parsing (TS, JS, Python)
- `src/graph/` — In-memory graphology graph (store, sync, queries, persistence)
- `src/graphrag/` — Community detection (Louvain) + Transformers.js embeddings
- `src/mcp/` — MCP server with 10 tools for Claude integration
- `src/extension/` — VS Code extension (webview, commands, editor tracking)
- `src/web/` — D3-force graph visualization (dark theme)
- `src/cli/` — Commander CLI entry point

## Data Storage

All data stored in `.graphrepo/` inside the workspace:
- `graph.json` — Serialized graphology graph (nodes, edges, communities)
- `embeddings.json` — Vector embeddings for semantic search

## Commands

- `npm run parse -- <path>` — Parse repo into graph
- `npm run parse -- <path> --clear` — Clear graph first, then parse
- `npm run serve` — Start MCP server (STDIO transport)
- `npm run build:ext` — Bundle extension
- `npm run build:mcp` — Bundle standalone MCP server
- `npm run build:vscode` — Build extension + webview
- `npm run typecheck` — TypeScript type checking

## Graph Schema

Nodes: File, Function, Class, Interface, Variable, Module, Community, Folder
Relationships: CONTAINS, IMPORTS, IMPORTS_EXTERNAL, CALLS, HAS_METHOD, EXTENDS, BELONGS_TO_COMMUNITY, PARENT_COMMUNITY, CONTAINS_FILE, CONTAINS_FOLDER

## MCP Tools

- `search_code` — Full-text search by name
- `get_dependencies` / `get_dependents` — Import graph traversal
- `get_file_structure` — File contents overview
- `get_call_graph` — Function call chains
- `find_related` — N-hop graph exploration
- `run_traversal` — Structured graph traversal
- `get_summary` — Repo statistics
- `get_communities` — Code community detection results
- `semantic_search` — Embedding-based semantic search

## Tech Stack

TypeScript, web-tree-sitter, graphology, @huggingface/transformers, @modelcontextprotocol/sdk, d3-force, Commander

## MCP Server Config (for Claude Desktop / Claude Code)

Use "GraphRepo: Configure MCP for Claude" command in VS Code, or manually:

```json
{
  "mcpServers": {
    "graphrepo": {
      "command": "node",
      "args": ["<extension-path>/dist/mcp-server.cjs", "serve"],
      "env": {
        "GRAPHREPO_DATA_FILE": "<workspace>/.graphrepo/graph.json",
        "GRAPHREPO_REPO_PATH": "<workspace>"
      }
    }
  }
}
```
