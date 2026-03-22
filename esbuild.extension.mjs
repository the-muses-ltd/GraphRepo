import * as esbuild from "esbuild";

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
    "web-tree-sitter",
    "tree-sitter-wasms",
    "neo4j-driver",
  ],
  // Shim import.meta.url for CJS output (needed by tree-sitter-init.ts)
  define: {
    "import.meta.url": "importMetaUrl",
  },
  banner: {
    js: 'const importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
});

if (watch) {
  await ctx.watch();
  console.log("Watching extension...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
