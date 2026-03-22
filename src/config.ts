import { z } from "zod";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const ConfigSchema = z.object({
  neo4j: z.object({
    uri: z.string().default("bolt://localhost:7687"),
    username: z.string().default("neo4j"),
    password: z.string(),
    database: z.string().default("neo4j"),
  }),
  repoPath: z.string(),
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
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
  ]),
});

export type Config = z.infer<typeof ConfigSchema>;

export const loadConfig = (repoPath: string): Config => {
  return ConfigSchema.parse({
    neo4j: {
      uri: process.env.NEO4J_URI,
      username: process.env.NEO4J_USERNAME,
      password: process.env.NEO4J_PASSWORD ?? "graphrepo-password",
      database: process.env.NEO4J_DATABASE,
    },
    repoPath,
  });
};
