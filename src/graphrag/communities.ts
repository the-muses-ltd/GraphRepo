import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { NodeAttributes, EdgeAttributes } from "../graph/store.js";
import { communityNodeId } from "../graph/store.js";

export type CommunityInfo = {
  id: string;
  level: number;
  memberCount: number;
  memberNodeIds: string[];
};

const EDGE_WEIGHTS: Record<string, number> = {
  CALLS: 3,
  IMPORTS: 2,
  HAS_METHOD: 2,
  EXTENDS: 2,
  CONTAINS: 1,
  IMPORTS_EXTERNAL: 0.5,
};

/**
 * Run Louvain community detection at multiple resolution levels.
 * Operates directly on the shared graphology store — no extraction or persistence to Neo4j.
 */
export function detectCommunities(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  options: { resolutions?: number[] } = {}
): CommunityInfo[] {
  const resolutions = options.resolutions ?? [0.5, 1.0, 2.0];

  // Remove existing community nodes and their edges
  const communityNodes: string[] = [];
  graph.forEachNode((id, attrs) => {
    if (attrs.type === "Community") communityNodes.push(id);
  });
  for (const id of communityNodes) {
    graph.dropNode(id);
  }

  // Clear communityId from all remaining nodes
  graph.forEachNode((id, attrs) => {
    if (attrs.communityId !== undefined) {
      graph.setNodeAttribute(id, "communityId", undefined);
    }
  });

  // Build a temporary undirected graph for Louvain
  const undirected = new Graph({ type: "undirected", multi: false });

  graph.forEachNode((id, attrs) => {
    if (attrs.type === "Community") return;
    undirected.mergeNode(id, {
      type: attrs.type,
      name: attrs.name,
    });
  });

  graph.forEachEdge((_edgeId, attrs, source, target) => {
    if (
      attrs.type === "BELONGS_TO_COMMUNITY" ||
      attrs.type === "PARENT_COMMUNITY"
    )
      return;
    if (
      !undirected.hasNode(source) ||
      !undirected.hasNode(target) ||
      source === target
    )
      return;
    if (!undirected.hasEdge(source, target)) {
      undirected.addEdge(source, target, {
        weight: EDGE_WEIGHTS[attrs.type] ?? 1,
      });
    }
  });

  if (undirected.order === 0) {
    return [];
  }

  // Run multi-level Louvain detection
  const allCommunities: CommunityInfo[] = [];

  for (let level = 0; level < resolutions.length; level++) {
    const resolution = resolutions[level];

    const communities = louvain(undirected, {
      resolution,
      getEdgeWeight: "weight",
    });

    // Group nodes by community
    const communityMembers = new Map<number, string[]>();
    for (const [nodeId, community] of Object.entries(communities)) {
      const members = communityMembers.get(community as number) ?? [];
      members.push(nodeId);
      communityMembers.set(community as number, members);
    }

    // Create Community nodes and relationships in the main graph
    for (const [communityNum, memberIds] of communityMembers) {
      const cId = `level${level}_community${communityNum}`;
      const graphId = communityNodeId(cId);

      graph.mergeNode(graphId, {
        type: "Community",
        name: cId,
        repo: "",
        level,
        memberCount: memberIds.length,
      });

      for (const memberId of memberIds) {
        if (graph.hasNode(memberId)) {
          graph.mergeDirectedEdge(memberId, graphId, {
            type: "BELONGS_TO_COMMUNITY",
          });

          // Set communityId for level 1 (used by visualization)
          if (level === 1) {
            graph.setNodeAttribute(memberId, "communityId", cId);
          }
        }
      }

      allCommunities.push({
        id: cId,
        level,
        memberCount: memberIds.length,
        memberNodeIds: memberIds,
      });
    }

    // Create PARENT_COMMUNITY relationships between levels
    if (level > 0) {
      const prevLevel = level - 1;

      // For each lower-level community, find which higher-level community has the most overlap
      graph.forEachNode((childId, childAttrs) => {
        if (childAttrs.type !== "Community" || childAttrs.level !== prevLevel) return;

        // Collect members of this child community
        const childMembers = new Set<string>();
        graph.forEachInEdge(childId, (_edgeId, edgeAttrs, source) => {
          if (edgeAttrs.type === "BELONGS_TO_COMMUNITY") {
            childMembers.add(source);
          }
        });

        // Count overlap with each parent-level community
        const parentOverlap = new Map<string, number>();
        for (const member of childMembers) {
          graph.forEachOutEdge(member, (_edgeId, edgeAttrs, _source, target) => {
            if (edgeAttrs.type !== "BELONGS_TO_COMMUNITY") return;
            const targetAttrs = graph.getNodeAttributes(target);
            if (targetAttrs.type === "Community" && targetAttrs.level === level) {
              parentOverlap.set(target, (parentOverlap.get(target) ?? 0) + 1);
            }
          });
        }

        // Link to the parent with most overlap
        let bestParent: string | null = null;
        let bestCount = 0;
        for (const [parentId, count] of parentOverlap) {
          if (count > bestCount) {
            bestCount = count;
            bestParent = parentId;
          }
        }

        if (bestParent) {
          graph.mergeDirectedEdge(childId, bestParent, {
            type: "PARENT_COMMUNITY",
          });
        }
      });
    }
  }

  return allCommunities;
}
