import path from "path";
import { loadConfig } from "../../config.js";
import { parseRepository } from "../../parser/index.js";
import { syncToGraph } from "../../graph/sync.js";
import { getStore } from "../../graph/store.js";
import { saveGraph, getGraphStorePath } from "../../graph/persistence.js";
import { detectCommunities } from "../../graphrag/communities.js";

type ParseOptions = {
  clear?: boolean;
};

export const parseCommand = async (
  repoPath: string,
  options: ParseOptions
): Promise<void> => {
  const absolutePath = path.resolve(repoPath);
  console.log(`Parsing repository: ${absolutePath}`);

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

    console.log("\n--- Building graph ---");
    const result = syncToGraph(parsed, absolutePath, options.clear ?? false);

    console.log("\n--- Detecting communities ---");
    const communities = detectCommunities(getStore());
    console.log(`  Created ${communities.length} community nodes`);

    console.log("\n--- Saving graph ---");
    const graphPath = getGraphStorePath(absolutePath);
    await saveGraph(getStore(), graphPath);
    console.log(`  Saved to ${graphPath}`);

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
  }
};
