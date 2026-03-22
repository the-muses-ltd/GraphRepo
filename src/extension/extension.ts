import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Neo4jService, type Neo4jConfig } from "./neo4j-service.js";
import { GraphViewProvider } from "./graph-view-provider.js";
import type { Config } from "../config.js";

let neo4jService: Neo4jService | undefined;
let graphViewProvider: GraphViewProvider | undefined;

function getNeo4jConfig(): Neo4jConfig {
  const config = vscode.workspace.getConfiguration("graphrepo");
  return {
    uri: config.get("neo4j.uri", "bolt://localhost:7687"),
    username: config.get("neo4j.username", "neo4j"),
    password: config.get("neo4j.password", "graphrepo-password"),
    database: config.get("neo4j.database", "neo4j"),
  };
}

function getService(): Neo4jService {
  if (!neo4jService) {
    neo4jService = new Neo4jService(getNeo4jConfig());
  }
  return neo4jService;
}

export function activate(context: vscode.ExtensionContext) {
  const service = getService();

  // Register the sidebar webview provider
  graphViewProvider = new GraphViewProvider(context.extensionUri, service);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      GraphViewProvider.viewType,
      graphViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // Command: Parse Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand("graphrepo.parseWorkspace", async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      let workspaceFolder = folders[0];
      if (folders.length > 1) {
        const picked = await vscode.window.showWorkspaceFolderPick({
          placeHolder: "Select folder to parse",
        });
        if (!picked) return;
        workspaceFolder = picked;
      }

      const repoPath = workspaceFolder.uri.fsPath;
      const neo4jConfig = getNeo4jConfig();

      const config: Config = {
        neo4j: neo4jConfig,
        repoPath,
        ignorePaths: [
          "node_modules",
          ".git",
          "dist",
          "build",
          "__pycache__",
          ".venv",
          ".next",
          "coverage",
          ".cache",
        ],
        supportedExtensions: [
          ".ts", ".tsx", ".js", ".jsx", ".py",
          ".json", ".md", ".mdx",
          ".css", ".scss", ".less",
          ".html", ".htm", ".svg",
          ".png", ".jpg", ".jpeg", ".gif", ".ico",
          ".yaml", ".yml", ".toml", ".xml", ".txt",
          ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1",
          ".sql", ".graphql", ".gql", ".proto",
          ".lock",
        ],
      };

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "GraphRepo: Parsing workspace",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Analyzing files..." });

            const { parseRepository } = await import("../parser/index.js");
            const { syncToNeo4j } = await import("../graph/index.js");

            const parsed = await parseRepository(config, (info: { current: number; total: number; file: string }) => {
              progress.report({
                message: `${info.current}/${info.total} — ${info.file}`,
                increment: 100 / info.total,
              });
            });

            progress.report({ message: "Syncing to Neo4j..." });
            const result = await syncToNeo4j(parsed, config);

            vscode.window.showInformationMessage(
              `GraphRepo: Parsed ${result.fileCount} files, ${result.functionCount} functions, ${result.classCount} classes`
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`GraphRepo parse failed: ${msg}`);
          }
        }
      );
    })
  );

  // Command: Search Code Graph
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "graphrepo.searchCodeGraph",
      async () => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = "Search functions, classes, interfaces...";
        quickPick.matchOnDescription = true;

        let debounce: ReturnType<typeof setTimeout>;

        quickPick.onDidChangeValue((value) => {
          clearTimeout(debounce);
          debounce = setTimeout(async () => {
            if (!value.trim()) {
              quickPick.items = [];
              return;
            }
            quickPick.busy = true;
            try {
              const results = await service.searchNodes(value);
              quickPick.items = results.map((r) => ({
                label: `$(symbol-${getSymbolIcon(r.type)}) ${r.name}`,
                description: r.qualifiedName,
                detail: r.type,
                id: r.id,
              })) as any;
            } catch {
              quickPick.items = [
                { label: "Search failed", description: "" },
              ];
            }
            quickPick.busy = false;
          }, 200);
        });

        quickPick.onDidAccept(() => {
          const selected = quickPick.selectedItems[0] as any;
          if (selected?.id && graphViewProvider) {
            // Focus the sidebar view and center on the node
            vscode.commands.executeCommand("graphrepo.graphView.focus");
            setTimeout(() => graphViewProvider!.centerOnNode(selected.id), 500);
          }
          quickPick.dispose();
        });

        quickPick.onDidHide(() => quickPick.dispose());
        quickPick.show();
      }
    )
  );

  // Command: Refresh graph (reload data in sidebar)
  context.subscriptions.push(
    vscode.commands.registerCommand("graphrepo.refreshGraph", () => {
      graphViewProvider?.refresh();
    })
  );

  // --- Editor tracking: sync graph view to active file/cursor ---
  const getRelativePath = (uri: vscode.Uri): string | null => {
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    if (!ws) return null;
    return path.relative(ws.uri.fsPath, uri.fsPath).replace(/\\/g, "/");
  };

  let trackDebounce: ReturnType<typeof setTimeout>;

  const trackEditor = (editor: vscode.TextEditor | undefined) => {
    clearTimeout(trackDebounce);
    if (!editor || !graphViewProvider) return;
    trackDebounce = setTimeout(() => {
      const rel = getRelativePath(editor.document.uri);
      if (!rel) return;
      const line = editor.selection.active.line + 1; // VS Code is 0-based, graph is 1-based
      graphViewProvider?.trackEditor(rel, line);
    }, 300);
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(trackEditor)
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      trackEditor(e.textEditor);
    })
  );

  // Track the currently active editor on activation
  trackEditor(vscode.window.activeTextEditor);

  // --- MCP event watcher: visualize what MCP tools are querying ---
  const mcpEventFile = path.join(os.tmpdir(), "graphrepo-mcp-events.json");
  let lastMcpTimestamp = 0;

  const handleMcpEvent = () => {
    try {
      const content = fs.readFileSync(mcpEventFile, "utf-8");
      const event = JSON.parse(content);
      if (event.timestamp <= lastMcpTimestamp) return;
      lastMcpTimestamp = event.timestamp;
      graphViewProvider?.handleMcpEvent(event);
    } catch {
      // File doesn't exist yet or parse error — ignore
    }
  };

  try {
    // Create the file if it doesn't exist so we can watch it
    if (!fs.existsSync(mcpEventFile)) {
      fs.writeFileSync(mcpEventFile, "{}");
    }
    const watcher = fs.watch(mcpEventFile, () => handleMcpEvent());
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // If we can't watch, MCP visualization just won't work — non-critical
  }
}

function getSymbolIcon(type: string): string {
  const icons: Record<string, string> = {
    Function: "method",
    Class: "class",
    Interface: "interface",
    Variable: "variable",
    File: "file",
    Module: "module",
  };
  return icons[type] ?? "misc";
}

export function deactivate() {
  neo4jService?.dispose();
  neo4jService = undefined;
}
