import path from "path";
import { loadConfig } from "../../config.js";
import { loadGraph, saveGraph, getGraphStorePath } from "../../graph/persistence.js";
import { getStore, setStore } from "../../graph/store.js";
import { detectCommunities } from "../../graphrag/communities.js";

type CommunitiesOptions = {
  clear?: boolean;
};

export const communitiesCommand = async (
  repoPath: string = ".",
  options: CommunitiesOptions
): Promise<void> => {
  const absolutePath = path.resolve(repoPath);
  const config = loadConfig(absolutePath);
  const graphPath = getGraphStorePath(absolutePath);

  // Load existing graph
  const graph = await loadGraph(graphPath);
  if (!graph) {
    console.error(`No graph data found at ${graphPath}. Run 'parse' first.`);
    process.exit(1);
  }
  setStore(graph);

  const start = Date.now();

  console.log("\n=== Community Detection ===\n");
  const communities = detectCommunities(getStore());

  const levels = [...new Set(communities.map((c) => c.level))];
  for (const level of levels) {
    const levelCommunities = communities.filter((c) => c.level === level);
    const totalMembers = levelCommunities.reduce((s, c) => s + c.memberCount, 0);
    console.log(
      `  Level ${level}: ${levelCommunities.length} communities, ${totalMembers} total members`
    );
  }

  // Save updated graph with communities
  await saveGraph(getStore(), graphPath);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);

  process.exit(0);
};
