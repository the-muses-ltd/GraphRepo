import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  outfile: "dist/extension/extension.cjs",
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: [
    "vscode",
    // sharp is a native image processing dep of Transformers.js — unused for text embeddings
    "sharp",
  ],
  alias: {
    // Redirect onnxruntime-node to empty shim — Transformers.js imports it at module level
    // but we force the WASM backend via Symbol.for('onnxruntime') in embeddings.ts
    "onnxruntime-node": "./src/graphrag/onnxruntime-node-shim.ts",
  },
  // Shim import.meta.url for CJS output (needed by tree-sitter-init.ts)
  define: {
    "import.meta.url": "importMetaUrl",
  },
  banner: {
    js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
});

/** Copy tree-sitter WASM files into dist/wasm/ */
function copyWasmFiles() {
  const wasmDir = "dist/wasm";
  mkdirSync(wasmDir, { recursive: true });

  const wasmSources = [
    ["node_modules/web-tree-sitter/tree-sitter.wasm", "tree-sitter.wasm"],
    ["node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm", "tree-sitter-typescript.wasm"],
    ["node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm", "tree-sitter-javascript.wasm"],
    ["node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm", "tree-sitter-python.wasm"],
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

if (watch) {
  await ctx.watch();
  console.log("Watching extension...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Copying WASM files...");
  copyWasmFiles();
}
