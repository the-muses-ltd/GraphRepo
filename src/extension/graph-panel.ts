import * as vscode from "vscode";
import { Neo4jService } from "./neo4j-service.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export class GraphPanel {
  public static currentPanel: GraphPanel | undefined;
  private static readonly viewType = "graphrepo.graphView";

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly neo4j: Neo4jService;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    neo4j: Neo4jService
  ): GraphPanel {
    const column = vscode.ViewColumn.One;

    if (GraphPanel.currentPanel) {
      GraphPanel.currentPanel.panel.reveal(column);
      return GraphPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      GraphPanel.viewType,
      "GraphRepo",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "dist", "webview"),
        ],
      }
    );

    GraphPanel.currentPanel = new GraphPanel(panel, extensionUri, neo4j);
    return GraphPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    neo4j: Neo4jService
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.neo4j = neo4j;

    this.panel.webview.html = this.getWebviewContent();

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private getWebviewContent(): string {
    const webview = this.panel.webview;
    const nonce = crypto.randomBytes(16).toString("hex");

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "bundle.js")
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "styles.css")
    );

    // Read the HTML template
    const htmlPath = path.join(
      this.extensionUri.fsPath,
      "dist",
      "webview",
      "index.html"
    );
    let html = fs.readFileSync(htmlPath, "utf-8");

    // Replace placeholders
    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
    html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
    html = html.replace(/\{\{stylesUri\}\}/g, stylesUri.toString());

    return html;
  }

  private async handleMessage(
    message: { id: number; type: string; payload: any }
  ): Promise<void> {
    const { id, type, payload } = message;

    try {
      let data: unknown;
      switch (type) {
        case "fetchGraph":
          data = await this.neo4j.getGraphData(
            payload.types,
            payload.limit
          );
          break;
        case "searchCode":
          data = await this.neo4j.searchNodes(payload.query);
          break;
        case "fetchNodeDetails":
          data = await this.neo4j.getNodeDetails(payload.id);
          break;
        default:
          throw new Error(`Unknown message type: ${type}`);
      }

      this.panel.webview.postMessage({ id, type: "response", data });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({
        id,
        type: "response",
        error: errorMsg,
      });
    }
  }

  public centerOnNode(nodeId: string): void {
    this.panel.webview.postMessage({ type: "centerOnNode", nodeId });
  }

  private dispose(): void {
    GraphPanel.currentPanel = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
