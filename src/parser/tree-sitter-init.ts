import {
  Parser as TSParser,
  Language as TSLanguage,
  Node as TSNode,
} from "web-tree-sitter";
import path from "path";
import { fileURLToPath } from "url";
import type { Language } from "../types.js";

// Re-export types for use in other modules
export type Parser = TSParser;
export type SyntaxNode = TSNode;

let initialized = false;
const parserCache = new Map<Language, TSParser>();

const WASM_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "node_modules",
  "tree-sitter-wasms",
  "out"
);

const LANGUAGE_WASM: Record<Language, string> = {
  typescript: path.join(WASM_DIR, "tree-sitter-typescript.wasm"),
  javascript: path.join(WASM_DIR, "tree-sitter-javascript.wasm"),
  python: path.join(WASM_DIR, "tree-sitter-python.wasm"),
};

const ensureInit = async () => {
  if (!initialized) {
    await TSParser.init({
      locateFile: () =>
        path.resolve(
          fileURLToPath(import.meta.url),
          "..",
          "..",
          "..",
          "node_modules",
          "web-tree-sitter",
          "tree-sitter.wasm"
        ),
    });
    initialized = true;
  }
};

export const getParser = async (language: Language): Promise<TSParser> => {
  const cached = parserCache.get(language);
  if (cached) return cached;

  await ensureInit();

  const parser = new TSParser();
  const lang = await TSLanguage.load(LANGUAGE_WASM[language]);
  parser.setLanguage(lang);
  parserCache.set(language, parser);
  return parser;
};
