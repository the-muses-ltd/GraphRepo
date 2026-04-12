import { getParser } from "../../src/parser/tree-sitter-init.js";
import type { Language } from "../../src/types.js";
import type { SyntaxNode } from "../../src/parser/tree-sitter-init.js";

export async function parseFixture(
  code: string,
  language: Language
): Promise<SyntaxNode> {
  const parser = await getParser(language);
  const tree = parser.parse(code);
  if (!tree) throw new Error(`Failed to parse fixture for ${language}`);
  return tree.rootNode;
}
