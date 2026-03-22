import path from "path";
import type { ParsedImport, Language } from "../types.js";

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const PY_EXTENSIONS = [".py"];
const INDEX_FILES_TS = ["index.ts", "index.tsx", "index.js", "index.jsx"];
const INDEX_FILES_PY = ["__init__.py"];

const extensionsFor = (language: Language): string[] =>
  language === "python" ? PY_EXTENSIONS : TS_EXTENSIONS;

const indexFilesFor = (language: Language): string[] =>
  language === "python" ? INDEX_FILES_PY : INDEX_FILES_TS;

/**
 * Resolve import specifiers to actual file paths within the repository.
 * Returns the resolved relative path or null if unresolvable.
 */
export const resolveImports = (
  imports: ParsedImport[],
  currentFilePath: string,
  allFilePaths: Set<string>,
  language: Language
): ParsedImport[] => {
  return imports.map((imp) => {
    if (imp.isExternal) return imp;

    const currentDir = path.dirname(currentFilePath);
    const resolved = resolveSpecifier(
      imp.specifier,
      currentDir,
      allFilePaths,
      language
    );

    return { ...imp, resolvedPath: resolved };
  });
};

const resolveSpecifier = (
  specifier: string,
  fromDir: string,
  allFilePaths: Set<string>,
  language: Language
): string | null => {
  // For Python relative imports: from .foo import bar
  if (language === "python") {
    return resolvePythonImport(specifier, fromDir, allFilePaths);
  }

  // For TS/JS relative imports
  const basePath = path.join(fromDir, specifier).replace(/\\/g, "/");

  // Try exact match first
  if (allFilePaths.has(basePath)) return basePath;

  // Try adding extensions
  for (const ext of extensionsFor(language)) {
    const withExt = basePath + ext;
    if (allFilePaths.has(withExt)) return withExt;
  }

  // Try as directory with index file
  for (const indexFile of indexFilesFor(language)) {
    const withIndex = basePath + "/" + indexFile;
    if (allFilePaths.has(withIndex)) return withIndex;
  }

  return null;
};

const resolvePythonImport = (
  specifier: string,
  fromDir: string,
  allFilePaths: Set<string>
): string | null => {
  // Count leading dots for relative depth
  let dots = 0;
  while (specifier[dots] === ".") dots++;

  if (dots === 0) return null; // Absolute imports are external

  const moduleParts = specifier.slice(dots).split(".");
  let baseDir = fromDir;
  for (let i = 1; i < dots; i++) {
    baseDir = path.dirname(baseDir);
  }

  const modulePath = path.join(baseDir, ...moduleParts).replace(/\\/g, "/");

  // Try as .py file
  const pyPath = modulePath + ".py";
  if (allFilePaths.has(pyPath)) return pyPath;

  // Try as package (__init__.py)
  const initPath = modulePath + "/__init__.py";
  if (allFilePaths.has(initPath)) return initPath;

  return null;
};
