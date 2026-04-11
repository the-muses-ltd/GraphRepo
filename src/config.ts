import { z } from "zod";

const ConfigSchema = z.object({
  repoPath: z.string(),
  dataDir: z.string().optional(),
  ignorePaths: z.array(z.string()).default([
    "node_modules",
    ".git",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    ".next",
    "coverage",
    ".cache",
  ]),
  supportedExtensions: z.array(z.string()).default([
    ".ts", ".tsx", ".js", ".jsx", ".py",
    ".json", ".md", ".mdx",
    ".css", ".scss", ".less",
    ".html", ".htm", ".svg",
    ".png", ".jpg", ".jpeg", ".gif", ".ico",
    ".yaml", ".yml", ".toml", ".xml", ".txt",
    ".sh", ".bash", ".zsh", ".bat", ".cmd", ".ps1",
    ".sql", ".graphql", ".gql", ".proto",
    ".lock",
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;

export const loadConfig = (repoPath: string): Config => {
  return ConfigSchema.parse({
    repoPath,
    dataDir: process.env.GRAPHREPO_DATA_DIR,
  });
};
