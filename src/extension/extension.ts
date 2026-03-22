import * as vscode from "vscode";
import { Neo4jService, type Neo4jConfig } from "./neo4j-service.js";
import { GraphViewProvider } from "./graph-view-provider.js";
import { parseRepository } from "../parser/index.js";
import { syncToNeo4j } from "../graph/index.js";
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
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
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
        supportedExtensions: [".ts", ".tsx", ".js", ".jsx", ".py"],
      };

      const clear = await vscode.window.showQuickPick(["No", "Yes"], {
        placeHolder: "Clear existing graph before parsing?",
      });

      if (clear === undefined) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "GraphRepo: Parsing workspace",
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: "Analyzing files..." });

            const parsed = await parseRepository(config, (info) => {
              progress.report({
                message: `${info.current}/${info.total} — ${info.file}`,
                increment: 100 / info.total,
              });
            });

            progress.report({ message: "Syncing to Neo4j..." });
            const result = await syncToNeo4j(parsed, config, clear === "Yes");

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
