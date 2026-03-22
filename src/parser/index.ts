import type { Config } from "../config.js";
import type { ParsedFile, ParsedRepository } from "../types.js";
import { walkRepository } from "./file-walker.js";
import { getParser } from "./tree-sitter-init.js";
import { extractFromFile } from "./extract.js";
import { resolveImports } from "./resolve.js";

export type ProgressCallback = (info: {
  file: string;
  current: number;
  total: number;
}) => void;

export const parseRepository = async (
  config: Config,
  onProgress?: ProgressCallback
): Promise<ParsedRepository> => {
  const files: ParsedFile[] = [];
  const allFilePaths = new Set<string>();

  // First pass: collect all file paths for import resolution
  const fileContents: Array<{
    path: string;
    content: string;
    language: ParsedFile["language"];
  }> = [];

  for await (const file of walkRepository(config)) {
    allFilePaths.add(file.path);
    fileContents.push({
      path: file.path,
      content: file.content,
      language: file.language,
    });
  }

  // Second pass: parse each file
  const total = fileContents.length;
  for (let i = 0; i < fileContents.length; i++) {
    const file = fileContents[i];
    onProgress?.({ file: file.path, current: i + 1, total });

    try {
      const codeLanguages = ["typescript", "javascript", "python"];
      if (codeLanguages.includes(file.language)) {
        const parser = await getParser(file.language as "typescript" | "javascript" | "python");
        const parsed = extractFromFile(
          file.path,
          file.content,
          file.language,
          parser
        );

        // Resolve import paths
        parsed.imports = resolveImports(
          parsed.imports,
          file.path,
          allFilePaths,
          file.language
        );

        files.push(parsed);
      } else {
        // Non-code file: add as a File node with no functions/classes
        const lineCount = file.content ? file.content.split("\n").length : 0;
        files.push({
          path: file.path,
          language: file.language,
          size: 0,
          lineCount,
          functions: [],
          classes: [],
          interfaces: [],
          variables: [],
          imports: [],
          exports: [],
        });
      }
    } catch (err) {
      console.error(`Failed to parse ${file.path}:`, err);
    }
  }

  // Collect external modules
  const externalModules = [
    ...new Set(
      files
        .flatMap((f) => f.imports)
        .filter((i) => i.isExternal)
        .map((i) => i.specifier)
    ),
  ];

  return { files, externalModules };
};
