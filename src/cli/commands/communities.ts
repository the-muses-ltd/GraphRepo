import { loadConfig } from "../../config.js";
import { detectCommunities } from "../../graphrag/index.js";

type CommunitiesOptions = {
  clear?: boolean;
};

export const communitiesCommand = async (
  repoPath: string = ".",
  options: CommunitiesOptions
): Promise<void> => {
  const config = loadConfig(repoPath);

  const start = Date.now();

  console.log("\n=== Community Detection ===\n");
  const communities = await detectCommunities(config, {
    clear: options.clear !== false,
  });

  const levels = [...new Set(communities.map((c) => c.level))];
  for (const level of levels) {
    const levelCommunities = communities.filter((c) => c.level === level);
    const totalMembers = levelCommunities.reduce((s, c) => s + c.memberCount, 0);
    console.log(
      `  Level ${level}: ${levelCommunities.length} communities, ${totalMembers} total members`
    );
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s.`);

  process.exit(0);
};
