import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { GraphService } from "./graph-service.js";
import { GraphViewProvider } from "./graph-view-provider.js";

let graphService: GraphService | undefined;
let graphViewProvider: GraphViewProvider | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Initialize the embedded graph service — no Neo4j, no Docker!
  const storagePath = context.globalStorageUri.fsPath;
  graphService = new GraphService(storagePath);

  // Status bar: shows graph status + click to parse
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBarItem.command = "graphrepo.parseWorkspace";
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register the sidebar webview provider
  graphViewProvider = new GraphViewProvider(context.extensionUri, graphService);
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

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "GraphRepo: Parsing workspace",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Analyzing files..." });
            statusBarItem!.text = "$(loading~spin) GraphRepo: Parsing...";

            const { parseRepository } = await import("../parser/index.js");

            const config = {
              neo4j: { uri: "", username: "", password: "", database: "" },
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
                ".yaml", ".yml", ".toml", ".xml", ".txt",
                ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1",
                ".sql", ".graphql", ".gql", ".proto",
                ".lock",
              ],
            };

            const parsed = await parseRepository(config, (info: { current: number; total: number; file: string }) => {
              progress.report({
                message: `${info.current}/${info.total} — ${info.file}`,
                increment: 100 / info.total,
              });
            });

            progress.report({ message: "Building graph..." });
            const result = graphService!.syncParsedRepo(parsed, repoPath);

            progress.report({ message: "Detecting communities..." });
            graphService!.detectCommunities();

            updateStatusBar();
            graphViewProvider?.refresh();

            vscode.window.showInformationMessage(
              `GraphRepo: Parsed ${result.fileCount} files, ${result.functionCount} functions, ${result.classCount} classes`
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`GraphRepo parse failed: ${msg}`);
            updateStatusBar();
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
        if (!graphService?.hasData()) {
          const action = await vscode.window.showInformationMessage(
            "No graph data yet. Parse your workspace first?",
            "Parse Now"
          );
          if (action === "Parse Now") {
            vscode.commands.executeCommand("graphrepo.parseWorkspace");
          }
          return;
        }

        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = "Search functions, classes, interfaces...";
        quickPick.matchOnDescription = true;

        let debounce: ReturnType<typeof setTimeout>;

        quickPick.onDidChangeValue((value) => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            if (!value.trim()) {
              quickPick.items = [];
              return;
            }
            quickPick.busy = true;
            try {
              const results = graphService!.searchNodes(value);
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
          }, 150);
        });

        quickPick.onDidAccept(() => {
          const selected = quickPick.selectedItems[0] as any;
          if (selected?.id && graphViewProvider) {
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

  // Command: Clear graph data
  context.subscriptions.push(
    vscode.commands.registerCommand("graphrepo.clearGraph", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Clear all graph data?",
        { modal: true },
        "Clear"
      );
      if (confirm === "Clear") {
        graphService!.getGraph().clear();
        graphService!.saveNow();
        graphViewProvider?.refresh();
        updateStatusBar();
        vscode.window.showInformationMessage("GraphRepo: Graph cleared.");
      }
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
      const line = editor.selection.active.line + 1;
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
    if (!fs.existsSync(mcpEventFile)) {
      fs.writeFileSync(mcpEventFile, "{}");
    }
    const watcher = fs.watch(mcpEventFile, () => handleMcpEvent());
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // If we can't watch, MCP visualization just won't work — non-critical
  }

  // Auto-prompt to parse if no data exists for this workspace
  if (!graphService.hasData() && vscode.workspace.workspaceFolders?.length) {
    vscode.window
      .showInformationMessage(
        "GraphRepo: Parse this workspace to build a code graph?",
        "Parse Now",
        "Later"
      )
      .then((action) => {
        if (action === "Parse Now") {
          vscode.commands.executeCommand("graphrepo.parseWorkspace");
        }
      });
  }
}

function updateStatusBar(): void {
  if (!statusBarItem || !graphService) return;
  if (graphService.hasData()) {
    const summary = graphService.getRepoSummary();
    statusBarItem.text = `$(graph) GraphRepo: ${summary.fileCount} files`;
    statusBarItem.tooltip = `${summary.funcCount} functions, ${summary.classCount} classes — click to re-parse`;
  } else {
    statusBarItem.text = "$(graph) GraphRepo: No data";
    statusBarItem.tooltip = "Click to parse workspace";
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
  graphService?.dispose();
  graphService = undefined;
}
