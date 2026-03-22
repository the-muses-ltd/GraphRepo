import * as vscode from "vscode";
import type { GraphService } from "./graph-service.js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export class GraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "graphrepo.graphView";

  private view?: vscode.WebviewView;
  private suppressTracking = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly graphService: GraphService
  ) {}

  private getRepoName(): string | null {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return null;
    return ws.uri.fsPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? null;
  }

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

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "openFile") {
        this.openFileInEditor(msg.path, msg.line);
      } else {
        this.handleMessage(msg);
      }
    });
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

  private handleMessage(
    message: { id: number; type: string; payload: any }
  ): void {
    const { id, type, payload } = message;

    try {
      let data: unknown;
      switch (type) {
        case "fetchGraph":
          data = this.graphService.getGraphData(payload.types, payload.limit, this.getRepoName());
          break;
        case "searchCode":
          data = this.graphService.searchNodes(payload.query);
          break;
        case "fetchNodeDetails":
          data = this.graphService.getNodeDetails(payload.id);
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

  private async openFileInEditor(relativePath: string, line?: number): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;

    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
    try {
      this.suppressTracking = true;
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const lineNum = Math.max(0, (line ?? 1) - 1);
      const range = new vscode.Range(lineNum, 0, lineNum, 0);
      await vscode.window.showTextDocument(doc, {
        selection: range,
        preserveFocus: false,
      });
      setTimeout(() => { this.suppressTracking = false; }, 500);
    } catch {
      this.suppressTracking = false;
    }
  }

  public centerOnNode(nodeId: string): void {
    this.view?.webview.postMessage({ type: "centerOnNode", nodeId });
  }

  public trackEditor(relativePath: string, line: number): void {
    if (this.suppressTracking) return;
    this.view?.webview.postMessage({ type: "trackEditor", path: relativePath, line });
  }

  public handleMcpEvent(event: { tool: string; target: string; targetType: string }): void {
    this.view?.webview.postMessage({ type: "mcpEvent", ...event });
  }

  public refresh(): void {
    this.view?.webview.postMessage({ type: "refresh" });
  }
}
