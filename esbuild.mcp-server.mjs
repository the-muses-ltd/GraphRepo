import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  outfile: "dist/mcp-server.cjs",
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  external: [
    // Transformers.js loads ONNX runtime dynamically — keep external
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
  // Shim import.meta.url for CJS output (needed by tree-sitter-init.ts)
  define: {
    "import.meta.url": "importMetaUrl",
  },
  banner: {
    js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
});

console.log("Built dist/mcp-server.cjs");
