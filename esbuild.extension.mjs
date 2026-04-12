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
  ],
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

/** Copy tree-sitter and ONNX WASM files into dist/wasm/ */
function copyWasmFiles() {
  const wasmDir = "dist/wasm";
  mkdirSync(wasmDir, { recursive: true });

  const wasmSources = [
    // Tree-sitter
    ["node_modules/web-tree-sitter/tree-sitter.wasm", "tree-sitter.wasm"],
    ["node_modules/tree-sitter-wasms/out/tree-sitter-typescript.wasm", "tree-sitter-typescript.wasm"],
    ["node_modules/tree-sitter-wasms/out/tree-sitter-javascript.wasm", "tree-sitter-javascript.wasm"],
    ["node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm", "tree-sitter-python.wasm"],
    // ONNX Runtime WASM (CPU+SIMD, no WebGPU)
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

if (watch) {
  await ctx.watch();
  console.log("Watching extension...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("Copying WASM files...");
  copyWasmFiles();
}
