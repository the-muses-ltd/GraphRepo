# GraphRepo

A knowledge graph for your codebase. GraphRepo parses your repository into a Neo4j graph that captures every file, function, class, import, and call relationship — then exposes it to AI code assistants via MCP so they can traverse the full interconnected structure of your code, not just individual files.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Neo4j](https://img.shields.io/badge/Neo4j-4581C3?logo=neo4j&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Claude-cc785c)

![GraphRepo VS Code Extension](media/image.png)

## Why

AI assistants read files one at a time. They can't see how your code connects — which functions call which, how modules depend on each other, or where a change will ripple through. GraphRepo gives them a queryable map of your entire codebase so they can reason about architecture, trace dependencies, and understand context that spans hundreds of files.

## What it does

- **Parses** your repo using Tree-sitter AST analysis (TypeScript, JavaScript, Python) and indexes all file types
- **Builds** a Neo4j knowledge graph of files, functions, classes, imports, call chains, and folder structure
- **Serves an MCP** with 8 tools that let Claude (or any MCP-compatible assistant) traverse your code graph — search by name, trace call chains, walk dependency trees, and run arbitrary Cypher queries
- **Visualizes** the graph in a VS Code sidebar or standalone browser view with an interactive D3-force layout
- **Tracks your editor** — the graph follows your cursor and highlights the node you're working on
- **Shows MCP activity** — watch the graph light up in real time as your AI assistant queries it
- **Supports multiple repos** — parse as many projects as you want into the same graph, each scoped by name

## Getting Started

### 1. Start Neo4j

GraphRepo uses Neo4j as its graph database. The easiest way to run it is with Docker:

```bash
docker compose up -d
```

### 2. Install the VS Code Extension

Clone this repo, install dependencies, and build the extension:

```bash
git clone https://github.com/the-muses-ltd/GraphRepo.git
cd GraphRepo
npm install
npm run build:vscode
```

Then install the extension in VS Code:

- Open VS Code
- Press `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
- Select the generated `graphrepo-0.1.0.vsix` file

Or install from the command line:

```bash
code --install-extension graphrepo-0.1.0.vsix
```

### 3. Parse your repo

Open any project in VS Code. In the GraphRepo sidebar panel, click the **play button** to parse the current workspace into the graph. The graph view will populate automatically.

You can also parse from the command line:

```bash
npm run parse -- /path/to/your/repo
```

### 4. Connect your AI assistant

Add a `.mcp.json` to any project root to give your AI assistant access to the graph:

```json
{
  "mcpServers": {
    "graphrepo": {
      "command": "npx",
      "args": ["tsx", "<absolute-path-to-graphrepo>/src/cli/index.ts", "serve"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USERNAME": "neo4j",
        "NEO4J_PASSWORD": "graphrepo-password"
      }
    }
  }
}
```

This works with Claude Code, Claude Desktop, or any MCP-compatible client. Once connected, your AI assistant can traverse your code graph — tracing call chains, walking dependency trees, and understanding relationships that would be invisible from reading files alone.

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

**Nodes:** `File`, `Function`, `Class`, `Interface`, `Variable`, `Module`, `Folder`

**Relationships:** `CONTAINS`, `IMPORTS`, `IMPORTS_EXTERNAL`, `CALLS`, `HAS_METHOD`, `EXTENDS`, `CONTAINS_FILE`, `CONTAINS_FOLDER`

## VS Code Extension

GraphRepo includes a VS Code extension with a sidebar graph view:

- **Follow editor** — graph automatically centers on the file/function you're editing
- **Click to navigate** — click any node to open it in your editor
- **Follow MCP** — watch the graph highlight nodes as your AI assistant queries them
- **Community coloring** — see how your code clusters into modules
- All toggleable from the sidebar controls

## Commands

| Command | Description |
|---------|-------------|
| `npm run parse -- <path>` | Parse a repo into the graph |
| `npm run parse -- <path> --clear` | Clear entire graph, then parse |
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
├── extension/       # VS Code extension + webview
├── web/             # D3-force visualization (dark theme)
└── cli/             # Commander CLI entry point
```

## Tech Stack

TypeScript, web-tree-sitter, neo4j-driver, @modelcontextprotocol/sdk, d3-force, Fastify, esbuild, Commander
