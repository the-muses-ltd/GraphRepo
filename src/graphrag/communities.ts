import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Session } from "neo4j-driver";
import { withSession } from "../graph/connection.js";
import type { Config } from "../config.js";

export type CommunityAssignment = {
  nodeId: string;
  community: number;
  level: number;
};

export type CommunityInfo = {
  id: string;
  level: number;
  memberCount: number;
  memberNodeIds: string[];
};

/**
 * Extract the code graph from Neo4j into a graphology instance.
 * Only includes code entities (not Community nodes).
 */
async function extractGraph(session: Session): Promise<Graph> {
  const graph = new Graph({ type: "undirected", multi: false });

  // Get all code nodes
  const nodesResult = await session.run(
    `MATCH (n)
     WHERE NOT n:Community
     RETURN elementId(n) AS id, labels(n)[0] AS type, n.name AS name`
  );

  for (const record of nodesResult.records) {
    const id = record.get("id");
    if (!graph.hasNode(id)) {
      graph.addNode(id, {
        type: record.get("type"),
        name: record.get("name"),
      });
    }
  }

  // Get all relationships between code nodes
  const edgesResult = await session.run(
    `MATCH (n)-[r]->(m)
     WHERE NOT n:Community AND NOT m:Community
     RETURN elementId(n) AS source, elementId(m) AS target, type(r) AS relType`
  );

  // Weight edges by type — structural relationships (CALLS, IMPORTS) are stronger signals
  const EDGE_WEIGHTS: Record<string, number> = {
    CALLS: 3,
    IMPORTS: 2,
    HAS_METHOD: 2,
    EXTENDS: 2,
    CONTAINS: 1,
    IMPORTS_EXTERNAL: 0.5,
  };

  for (const record of edgesResult.records) {
    const source = record.get("source");
    const target = record.get("target");
    const relType = record.get("relType");

    if (graph.hasNode(source) && graph.hasNode(target) && source !== target) {
      // graphology undirected: avoid duplicate edges
      if (!graph.hasEdge(source, target)) {
        graph.addEdge(source, target, {
          weight: EDGE_WEIGHTS[relType] ?? 1,
        });
      }
    }
  }

  return graph;
}

/**
 * Run Louvain community detection at multiple resolution levels.
 * Higher resolution = more, smaller communities.
 */
function runMultiLevelDetection(
  graph: Graph,
  resolutions: number[]
): Map<number, Map<string, number>> {
  const levels = new Map<number, Map<string, number>>();

  for (let level = 0; level < resolutions.length; level++) {
    const resolution = resolutions[level];

    // Run Louvain — assigns community to each node attribute
    const communities = louvain(graph, {
      resolution,
      getEdgeWeight: "weight",
    });

    // communities is Record<nodeId, communityNumber>
    const assignments = new Map<string, number>();
    for (const [nodeId, community] of Object.entries(communities)) {
      assignments.set(nodeId, community as number);
    }

    levels.set(level, assignments);
  }

  return levels;
}

/**
 * Clear existing community data from Neo4j.
 */
async function clearCommunities(session: Session): Promise<void> {
  // Delete BELONGS_TO_COMMUNITY relationships and Community nodes
  await session.run(
    `MATCH (c:Community) DETACH DELETE c`
  );
}

/**
 * Write community assignments back to Neo4j as Community nodes
 * with BELONGS_TO_COMMUNITY relationships.
 */
async function persistCommunities(
  session: Session,
  levels: Map<number, Map<string, number>>
): Promise<CommunityInfo[]> {
  const allCommunities: CommunityInfo[] = [];

  for (const [level, assignments] of levels) {
    // Group nodes by community
    const communityMembers = new Map<number, string[]>();
    for (const [nodeId, community] of assignments) {
      const members = communityMembers.get(community) ?? [];
      members.push(nodeId);
      communityMembers.set(community, members);
    }

    // Create Community nodes and relationships
    for (const [communityNum, memberIds] of communityMembers) {
      const communityId = `level${level}_community${communityNum}`;

      // Create Community node
      await session.run(
        `MERGE (c:Community {id: $id})
         SET c.level = $level, c.memberCount = $memberCount`,
        { id: communityId, level, memberCount: memberIds.length }
      );

      // Create BELONGS_TO_COMMUNITY relationships in batches
      await session.run(
        `UNWIND $memberIds AS memberId
         MATCH (n) WHERE elementId(n) = memberId
         MATCH (c:Community {id: $communityId})
         MERGE (n)-[:BELONGS_TO_COMMUNITY]->(c)`,
        { memberIds, communityId }
      );

      allCommunities.push({
        id: communityId,
        level,
        memberCount: memberIds.length,
        memberNodeIds: memberIds,
      });
    }

    // Create PARENT_COMMUNITY relationships between levels
    if (level > 0) {
      const prevLevel = level - 1;
      await session.run(
        `MATCH (child:Community {level: $childLevel})
         MATCH (child)<-[:BELONGS_TO_COMMUNITY]-(n)-[:BELONGS_TO_COMMUNITY]->(parent:Community {level: $parentLevel})
         WITH child, parent, count(n) AS overlap
         WHERE overlap > 0
         WITH child, parent
         ORDER BY child.id
         WITH child, collect(parent)[0] AS bestParent
         MERGE (child)-[:PARENT_COMMUNITY]->(bestParent)`,
        { childLevel: prevLevel, parentLevel: level }
      );
    }
  }

  return allCommunities;
}

/**
 * Main entry: detect communities and persist to Neo4j.
 */
export async function detectCommunities(
  config: Config,
  options: { clear?: boolean; resolutions?: number[] } = {}
): Promise<CommunityInfo[]> {
  const resolutions = options.resolutions ?? [0.5, 1.0, 2.0];

  return withSession(config.neo4j, async (session) => {
    if (options.clear !== false) {
      console.log("Clearing existing communities...");
      await clearCommunities(session);
    }

    console.log("Extracting graph from Neo4j...");
    const graph = await extractGraph(session);
    console.log(`  ${graph.order} nodes, ${graph.size} edges`);

    if (graph.order === 0) {
      console.log("No nodes found. Parse a repository first.");
      return [];
    }

    console.log(`Running community detection at ${resolutions.length} resolution levels...`);
    const levels = runMultiLevelDetection(graph, resolutions);

    for (const [level, assignments] of levels) {
      const communityCount = new Set(assignments.values()).size;
      console.log(`  Level ${level} (resolution ${resolutions[level]}): ${communityCount} communities`);
    }

    console.log("Persisting communities to Neo4j...");
    const communities = await persistCommunities(session, levels);

    // Ensure fulltext index on community summaries
    try {
      await session.run(
        `CREATE FULLTEXT INDEX community_summary_search IF NOT EXISTS
         FOR (c:Community)
         ON EACH [c.summary]`
      );
    } catch {
      // Index may already exist
    }

    // Ensure constraint
    try {
      await session.run(
        `CREATE CONSTRAINT community_id IF NOT EXISTS
         FOR (c:Community) REQUIRE c.id IS UNIQUE`
      );
    } catch {
      // Constraint may already exist
    }

    console.log(`Created ${communities.length} community nodes.`);
    return communities;
  });
}
