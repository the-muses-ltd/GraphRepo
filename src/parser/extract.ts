import type { Parser } from "./tree-sitter-init.js";
import type { Language, ParsedFile } from "../types.js";
import * as tsExtractor from "./languages/typescript.js";
import * as pyExtractor from "./languages/python.js";

type Extractor = typeof tsExtractor;

const extractors: Record<Language, Extractor> = {
  typescript: tsExtractor,
  javascript: tsExtractor, // JS uses same extractors
  python: pyExtractor,
};

export const extractFromFile = (
  filePath: string,
  content: string,
  language: Language,
  parser: Parser
): ParsedFile => {
  const tree = parser.parse(content);
  if (!tree) throw new Error(`Failed to parse ${filePath}`);
  const root = tree.rootNode;
  const extractor = extractors[language];

  const lines = content.split("\n");

  return {
    path: filePath,
    language,
    size: Buffer.byteLength(content, "utf-8"),
    lineCount: lines.length,
    functions: extractor.extractFunctions(root),
    classes: extractor.extractClasses(root),
    interfaces: extractor.extractInterfaces(root),
    variables: extractor.extractVariables(root),
    imports: extractor.extractImports(root),
    exports: extractor.extractExports(root),
  };
};
