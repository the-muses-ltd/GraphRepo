import path from "path";
import { loadConfig } from "../../config.js";
import { parseRepository } from "../../parser/index.js";
import { syncToNeo4j } from "../../graph/index.js";
import { closeDriver } from "../../graph/connection.js";

type ParseOptions = {
  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;
  clear?: boolean;
};

export const parseCommand = async (
  repoPath: string,
  options: ParseOptions
): Promise<void> => {
  const absolutePath = path.resolve(repoPath);
  console.log(`Parsing repository: ${absolutePath}`);

  // Override config from CLI options
  if (options.neo4jUri) process.env.NEO4J_URI = options.neo4jUri;
  if (options.neo4jUser) process.env.NEO4J_USERNAME = options.neo4jUser;
  if (options.neo4jPassword) process.env.NEO4J_PASSWORD = options.neo4jPassword;

  const config = loadConfig(absolutePath);
  const startTime = Date.now();

  try {
    console.log("\n--- Parsing ---");
    const parsed = await parseRepository(config, ({ file, current, total }) => {
      process.stdout.write(`\r  [${current}/${total}] ${file}`);
    });
    console.log("\n");

    console.log(`Parsed ${parsed.files.length} files`);
    console.log(`  Functions: ${parsed.files.reduce((s, f) => s + f.functions.length, 0)}`);
    console.log(`  Classes: ${parsed.files.reduce((s, f) => s + f.classes.length, 0)}`);
    console.log(`  Interfaces: ${parsed.files.reduce((s, f) => s + f.interfaces.length, 0)}`);
    console.log(`  External modules: ${parsed.externalModules.length}`);

    console.log("\n--- Syncing to Neo4j ---");
    const result = await syncToNeo4j(parsed, config, options.clear ?? false);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsed}s`);
    console.log(`  Files: ${result.fileCount}`);
    console.log(`  Functions: ${result.functionCount}`);
    console.log(`  Classes: ${result.classCount}`);
    console.log(`  Interfaces: ${result.interfaceCount}`);
    console.log(`  External modules: ${result.moduleCount}`);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await closeDriver();
  }
};
