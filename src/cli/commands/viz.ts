import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { loadConfig } from "../../config.js";
import { loadGraph, getGraphStorePath } from "../../graph/persistence.js";
import { setStore } from "../../graph/store.js";
import * as queries from "../../graph/queries.js";
import { getStore } from "../../graph/store.js";

type VizOptions = {
  port?: string;
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export const vizCommand = async (options: VizOptions): Promise<void> => {
  const config = loadConfig(".");
  const port = parseInt(options.port ?? "3000", 10);

  // Load graph from disk
  const graphPath = getGraphStorePath(config.repoPath);
  const graph = await loadGraph(graphPath);
  if (graph) {
    setStore(graph);
  } else {
    console.error(`No graph data found at ${graphPath}. Run 'parse' first.`);
    process.exit(1);
  }

  // Static file directories
  const webDir = path.resolve(
    fileURLToPath(import.meta.url),
    "..", "..", "..", "..", "dist", "web"
  );
  const srcWebDir = path.resolve(
    fileURLToPath(import.meta.url),
    "..", "..", "..", "web"
  );

  const store = getStore();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // API routes
    if (url.pathname === "/api/graph") {
      const types = url.searchParams.get("types")?.split(",") ?? null;
      const limit = parseInt(url.searchParams.get("limit") ?? "500", 10);
      const data = queries.getGraphData(store, types, limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q");
      if (!q) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results: [] }));
        return;
      }
      const results = queries.searchNodes(store, q);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results }));
      return;
    }

    if (url.pathname.startsWith("/api/node/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/node/".length));
      const details = queries.getNodeDetails(store, id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(details ?? { error: "Node not found" }));
      return;
    }

    // Static file serving
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    // Try webDir first, then srcWebDir
    for (const dir of [webDir, srcWebDir]) {
      const fullPath = path.join(dir, filePath);
      if (existsSync(fullPath)) {
        res.writeHead(200, { "Content-Type": contentType });
        res.end(readFileSync(fullPath));
        return;
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`GraphRepo visualization running at http://localhost:${port}`);
    console.log("Press Ctrl+C to stop");
  });
};
