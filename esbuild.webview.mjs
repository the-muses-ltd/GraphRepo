import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/extension/webview/webview-main.ts"],
  bundle: true,
  outfile: "dist/webview/bundle.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
});

if (watch) {
  await ctx.watch();
  console.log("Watching webview...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

// Copy static assets to dist/webview
const distDir = "dist/webview";
fs.mkdirSync(distDir, { recursive: true });

fs.copyFileSync(
  "src/extension/webview/index.html",
  path.join(distDir, "index.html")
);
fs.copyFileSync(
  "src/extension/webview/styles.css",
  path.join(distDir, "styles.css")
);
