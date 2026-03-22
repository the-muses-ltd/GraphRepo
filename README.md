# GraphRepo

Parse any codebase into a Neo4j graph, then visualize it with D3 and query it through Claude via MCP.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Neo4j](https://img.shields.io/badge/Neo4j-4581C3?logo=neo4j&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Claude-cc785c)

![GraphRepo VS Code Extension](media/image.png)

## What it does

- **Parses** your repo using Tree-sitter AST analysis (TypeScript, JavaScript, Python)
- **Builds** a Neo4j knowledge graph of files, functions, classes, imports, and call relationships
- **Visualizes** the graph in-browser with an interactive D3-force layout
- **Exposes** 8 MCP tools so Claude can query your codebase structure in real time

## Quick start

```bash
# 1. Start Neo4j
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Parse a repository
npm run parse -- /path/to/your/repo

# 5. Open the visualization
npm run build:web
npm run viz
```

Then open [http://localhost:3000](http://localhost:3000) to explore your repo as a graph.

## Connect to Claude

Add this to your Claude Desktop or `.mcp.json` config:

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

Once connected, Claude can use tools like `search_code`, `get_call_graph`, `get_dependencies`, and `query_graph` to understand your codebase.

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_code` | Full-text search for functions, classes, and variables by name |
| `get_file_structure` | List all entities defined in a file |
| `get_dependencies` | What does this file/module import? |
| `get_dependents` | What imports this file/module? |
| `get_call_graph` | Trace function call chains (callers, callees, or both) |
| `find_related` | N-hop graph exploration from any node |
| `query_graph` | Run raw read-only Cypher queries |
| `get_summary` | Repo-wide statistics (files, functions, languages, etc.) |

## Graph Schema

**Nodes:** `File`, `Function`, `Class`, `Interface`, `Variable`, `Module`

**Relationships:** `CONTAINS`, `IMPORTS`, `IMPORTS_EXTERNAL`, `CALLS`, `HAS_METHOD`, `EXTENDS`

## Commands

| Command | Description |
|---------|-------------|
| `npm run parse -- <path>` | Parse a repo into the graph |
| `npm run parse -- <path> --clear` | Clear existing graph, then parse |
| `npm run serve` | Start MCP server (STDIO transport) |
| `npm run viz` | Start visualization server on :3000 |
| `npm run build:web` | Bundle the frontend |
| `npm run typecheck` | Run TypeScript type checking |

## Architecture

```
src/
├── parser/          # Tree-sitter AST parsing (TS, JS, Python)
│   └── languages/   # Per-language extraction logic
├── graph/           # Neo4j operations (MERGE-based, idempotent)
├── mcp/             # MCP server with 8 tools
├── web/             # D3-force visualization (dark theme)
└── cli/             # Commander CLI entry point
```

## Tech Stack

TypeScript, web-tree-sitter, neo4j-driver, @modelcontextprotocol/sdk, d3-force, Fastify, esbuild, Commander
