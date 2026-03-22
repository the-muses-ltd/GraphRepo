import * as vscode from "vscode";
import { Neo4jService } from "./neo4j-service.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export class GraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "graphrepo.graphView";

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly neo4j: Neo4jService
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
      ],
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) =>
      this.handleMessage(msg)
    );
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("hex");

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "bundle.js")
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "styles.css")
    );

    const htmlPath = path.join(
      this.extensionUri.fsPath,
      "dist",
      "webview",
      "index.html"
    );
    let html = fs.readFileSync(htmlPath, "utf-8");

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
          data = await this.neo4j.getGraphData(payload.types, payload.limit);
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

      this.view?.webview.postMessage({ id, type: "response", data });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.view?.webview.postMessage({
        id,
        type: "response",
        error: errorMsg,
      });
    }
  }

  public centerOnNode(nodeId: string): void {
    this.view?.webview.postMessage({ type: "centerOnNode", nodeId });
  }

  public refresh(): void {
    this.view?.webview.postMessage({ type: "refresh" });
  }
}
