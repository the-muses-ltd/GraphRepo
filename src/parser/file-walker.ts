import fs from "fs/promises";
import path from "path";
import type { Config } from "../config.js";
import { EXTENSION_TO_LANGUAGE, type Language } from "../types.js";

export type WalkedFile = {
  path: string; // relative to repo root
  absolutePath: string;
  content: string;
  language: Language;
  size: number;
};

const shouldIgnore = (filePath: string, ignorePaths: string[]): boolean => {
  const parts = filePath.split(/[/\\]/);
  return parts.some((part) => ignorePaths.includes(part));
};

export async function* walkRepository(
  config: Config
): AsyncGenerator<WalkedFile> {
  const { repoPath, ignorePaths, supportedExtensions } = config;

  const walk = async function* (dir: string): AsyncGenerator<WalkedFile> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(repoPath, fullPath).replace(/\\/g, "/");

      if (shouldIgnore(relativePath, ignorePaths)) continue;

      if (entry.isDirectory()) {
        yield* walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!supportedExtensions.includes(ext)) continue;

        const language = EXTENSION_TO_LANGUAGE[ext];
        if (!language) continue;

        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const stat = await fs.stat(fullPath);
          yield {
            path: relativePath,
            absolutePath: fullPath,
            content,
            language,
            size: stat.size,
          };
        } catch {
          // Skip files we can't read
        }
      }
    }
  };

  yield* walk(repoPath);
}
