import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { GraphService } from "./graph-service.js";
import { GraphViewProvider } from "./graph-view-provider.js";
import { getStore, setStore, hasStore } from "../graph/store.js";
import { loadGraph, saveGraph, getGraphStorePath, getEmbeddingsStorePath } from "../graph/persistence.js";
import { EmbeddingService, generateEmbeddings } from "../graphrag/embeddings.js";
import { VectorStore } from "../graphrag/vector-store.js";

let graphService: GraphService | undefined;
let graphViewProvider: GraphViewProvider | undefined;
let embeddingService: EmbeddingService | undefined;
let vectorStore: VectorStore | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function writeMcpConfig(extensionPath: string, workspaceRoot: string) {
  const mcpPath = path.join(workspaceRoot, ".mcp.json");
  const mcpServerPath = path.join(extensionPath, "dist", "mcp-server.cjs");
  const graphDataFile = getGraphStorePath(workspaceRoot);

  let config: Record<string, unknown> = {};
  if (fs.existsSync(mcpPath)) {
    try { config = JSON.parse(fs.readFileSync(mcpPath, "utf-8")); } catch {}
  }
  const mcpServers = (config.mcpServers as Record<string, unknown>) ?? {};
  mcpServers.graphrepo = {
    command: "node",
    args: [mcpServerPath, "serve"],
    env: {
      GRAPHREPO_DATA_FILE: graphDataFile,
      GRAPHREPO_REPO_PATH: workspaceRoot,
    },
  };
  config.mcpServers = mcpServers;
  fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2), "utf-8");
}

function getWorkspaceRoot(): string | null {
  const ws = vscode.workspace.workspaceFolders?.[0];
  return ws?.uri.fsPath ?? null;
}

export async function activate(context: vscode.ExtensionContext) {
  // Load persisted graph from workspace
  const wsRoot = getWorkspaceRoot();
  if (wsRoot) {
    const graphPath = getGraphStorePath(wsRoot);
    const loaded = await loadGraph(graphPath);
    if (loaded) {
      setStore(loaded);
    }
  }

  graphService = new GraphService();

  // Output channel for diagnostics (Output > GraphRepo)
  outputChannel = vscode.window.createOutputChannel("GraphRepo");
  context.subscriptions.push(outputChannel);

  // Initialize embedding service (model loads lazily on first use)
  const modelCacheDir = path.join(context.globalStorageUri.fsPath, "model-cache");
  embeddingService = new EmbeddingService(modelCacheDir, (msg) => outputChannel!.appendLine(msg));
  vectorStore = new VectorStore();

  // Load persisted embeddings
  if (wsRoot) {
    const embPath = getEmbeddingsStorePath(wsRoot);
    vectorStore.load(embPath);
  }

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

            const { parseRepository } = await import("../parser/index.js");
            const { syncToGraph } = await import("../graph/sync.js");

            const config = {
              repoPath,
              ignorePaths: [
                "node_modules", ".git", "dist", "build",
                "__pycache__", ".venv", ".next", "coverage", ".cache",
              ],
              supportedExtensions: [
                ".ts", ".tsx", ".js", ".jsx", ".py",
                ".c", ".h", ".cpp", ".cxx", ".cc", ".hpp", ".hxx", ".hh",
                ".cs",
                ".swift",
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

            const parsed = await parseRepository(config, (info: { current: number; total: number; file: string }) => {
              progress.report({
                message: `${info.current}/${info.total} — ${info.file}`,
                increment: 100 / info.total,
              });
            });

            progress.report({ message: "Building graph..." });
            const result = syncToGraph(parsed, repoPath);

            // Run community detection
            progress.report({ message: "Detecting communities..." });
            const { detectCommunities } = await import("../graphrag/communities.js");
            detectCommunities(getStore());

            // Save graph to disk
            progress.report({ message: "Saving graph..." });
            const graphPath = getGraphStorePath(repoPath);
            await saveGraph(getStore(), graphPath);

            // Auto-configure MCP for Claude Code
            writeMcpConfig(context.extensionPath, repoPath);

            // Generate embeddings (non-blocking — if model isn't cached yet, download it)
            const parseSummary = `Parsed ${result.fileCount} files, ${result.functionCount} functions, ${result.classCount} classes`;
            if (embeddingService && vectorStore) {
              progress.report({ message: "Generating embeddings..." });
              try {
                const initResult = await embeddingService.initialize();
                if (initResult.ok) {
                  vectorStore.clear();
                  const count = await generateEmbeddings(
                    getStore(),
                    embeddingService,
                    vectorStore,
                    (current, total) => {
                      progress.report({ message: `Embedding ${current}/${total}...` });
                    },
                  );
                  const embPath = getEmbeddingsStorePath(repoPath);
                  vectorStore.save(embPath);
                  vscode.window.showInformationMessage(
                    `GraphRepo: ${parseSummary}. Embedded ${count} entities.`
                  );
                } else {
                  const errMsg = initResult.error ?? "unknown error";
                  outputChannel?.appendLine(`[Embeddings] Init failed: ${errMsg}`);
                  const action = await vscode.window.showWarningMessage(
                    `GraphRepo: ${parseSummary}. Embeddings failed: ${errMsg}`,
                    "Show Logs"
                  );
                  if (action === "Show Logs") outputChannel?.show();
                }
              } catch (embErr) {
                const errMsg = embErr instanceof Error ? embErr.message : String(embErr);
                outputChannel?.appendLine(`[Embeddings] Generation error: ${errMsg}`);
                const action = await vscode.window.showWarningMessage(
                  `GraphRepo: ${parseSummary}. Embedding generation failed: ${errMsg}`,
                  "Show Logs"
                );
                if (action === "Show Logs") outputChannel?.show();
              }
            } else {
              vscode.window.showInformationMessage(`GraphRepo: ${parseSummary}`);
            }

            // Refresh the graph view
            graphViewProvider?.refresh();
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
        if (!hasStore()) {
          vscode.window.showWarningMessage("GraphRepo: No graph data. Run 'Parse Workspace' first.");
          return;
        }

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
              const results = await graphService!.searchNodes(value);
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

  // Command: Refresh graph
  context.subscriptions.push(
    vscode.commands.registerCommand("graphrepo.refreshGraph", () => {
      graphViewProvider?.refresh();
    })
  );

  // Command: Configure MCP for Claude
  context.subscriptions.push(
    vscode.commands.registerCommand("graphrepo.configureMcp", async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }

      writeMcpConfig(context.extensionPath, root);
      vscode.window.showInformationMessage(
        "GraphRepo: MCP configured in .mcp.json — restart Claude Code to connect."
      );
    })
  );

  // --- Editor tracking ---
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
  trackEditor(vscode.window.activeTextEditor);

  // --- MCP event watcher ---
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
      // ignore
    }
  };

  try {
    if (!fs.existsSync(mcpEventFile)) {
      fs.writeFileSync(mcpEventFile, "{}");
    }
    const watcher = fs.watch(mcpEventFile, () => handleMcpEvent());
    context.subscriptions.push({ dispose: () => watcher.close() });
  } catch {
    // non-critical
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
