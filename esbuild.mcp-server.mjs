import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

await esbuild.build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  outfile: "dist/mcp-server.cjs",
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: [],
  alias: {
    "onnxruntime-node": "./src/graphrag/onnxruntime-node-shim.ts",
    "sharp": "./src/graphrag/sharp-shim.ts",
  },
  // Shim import.meta.url for CJS output (needed by tree-sitter-init.ts)
  define: {
    "import.meta.url": "importMetaUrl",
  },
  banner: {
    js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
});

/** Copy ONNX WASM files into dist/wasm/ for the standalone MCP server */
function copyWasmFiles() {
  const wasmDir = "dist/wasm";
  mkdirSync(wasmDir, { recursive: true });

  const wasmSources = [
    ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.wasm"],
    ["node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.mjs"],
  ];

  for (const [src, dest] of wasmSources) {
    if (existsSync(src)) {
      cpSync(src, join(wasmDir, dest));
      console.log(`  Copied ${dest}`);
    } else {
      console.warn(`  Warning: ${src} not found, skipping`);
    }
  }
}

console.log("Copying WASM files...");
copyWasmFiles();
console.log("Built dist/mcp-server.cjs");
