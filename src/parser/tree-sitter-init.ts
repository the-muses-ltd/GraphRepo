import {
  Parser as TSParser,
  Language as TSLanguage,
  Node as TSNode,
} from "web-tree-sitter";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { Language } from "../types.js";

export type Parser = TSParser;
export type SyntaxNode = TSNode;

let initialized = false;
const parserCache = new Map<Language, TSParser>();

/**
 * Resolve the WASM directory. Supports two layouts:
 * 1. Bundled extension: dist/wasm/ (relative to dist/extension/extension.cjs)
 * 2. Development (tsx): node_modules/tree-sitter-wasms/out/
 */
function resolveWasmDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  // Check if bundled WASM files exist (dist/wasm/)
  const bundledDir = path.resolve(thisDir, "..", "..", "wasm");
  if (fs.existsSync(path.join(bundledDir, "tree-sitter-typescript.wasm"))) {
    return bundledDir;
  }

  // Fallback to node_modules for development
  return path.resolve(thisDir, "..", "..", "node_modules", "tree-sitter-wasms", "out");
}

function resolveCoreWasm(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);

  const bundledPath = path.resolve(thisDir, "..", "..", "wasm", "tree-sitter.wasm");
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  return path.resolve(thisDir, "..", "..", "node_modules", "web-tree-sitter", "tree-sitter.wasm");
}

const WASM_DIR = resolveWasmDir();

const LANGUAGE_WASM: Record<string, string> = {
  typescript: path.join(WASM_DIR, "tree-sitter-typescript.wasm"),
  javascript: path.join(WASM_DIR, "tree-sitter-javascript.wasm"),
  python: path.join(WASM_DIR, "tree-sitter-python.wasm"),
};

const ensureInit = async () => {
  if (!initialized) {
    const coreWasm = resolveCoreWasm();
    await TSParser.init({
      locateFile: () => coreWasm,
    });
    initialized = true;
  }
};

export const getParser = async (language: Language): Promise<TSParser> => {
  const cached = parserCache.get(language);
  if (cached) return cached;

  await ensureInit();

  const wasmPath = LANGUAGE_WASM[language];
  if (!wasmPath) {
    throw new Error(`No tree-sitter WASM available for language: ${language}`);
  }

  const parser = new TSParser();
  const lang = await TSLanguage.load(wasmPath);
  parser.setLanguage(lang);
  parserCache.set(language, parser);
  return parser;
};
