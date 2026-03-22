import * as d3 from "d3-force";
import { drag } from "d3-drag";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import type { GraphData, GraphNode, GraphEdge } from "./api.js";

const NODE_COLORS: Record<string, string> = {
  File: "#4C8BF5",
  Function: "#34A853",
  Class: "#FBBC05",
  Interface: "#AB47BC",
  Variable: "#26A69A",
  Module: "#78909C",
  Folder: "#FF7043",
};

// Distinct colors for community visualization
const COMMUNITY_COLORS = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
  "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4",
  "#469990", "#dcbeff", "#9A6324", "#800000", "#aaffc3",
  "#808000", "#ffd8b1", "#000075", "#a9a9a9", "#e6beff",
];

const NODE_RADIUS: Record<string, number> = {
  File: 8,
  Class: 7,
  Interface: 6,
  Function: 5,
  Variable: 4,
  Module: 6,
  Folder: 9,
};

type SimNode = GraphNode & d3.SimulationNodeDatum;
type SimLink = { source: SimNode | string; target: SimNode | string; type: string };

export class GraphRenderer {
  private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
  private g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
  private simulation: d3.Simulation<SimNode, SimLink>;
  private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private nodes: SimNode[] = [];
  private links: SimLink[] = [];
  private nodeElements: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null = null;
  private linkElements: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null = null;
  private selectedNodeId: string | null = null;
  private visibleRelTypes: Set<string>;
  private onNodeClick: ((node: GraphNode) => void) | null = null;
  private tooltip: HTMLElement;
  private colorByCommunity: boolean = true;
  private communityColorMap = new Map<string, string>();

  constructor(svgSelector: string, tooltipSelector: string) {
    this.svg = select<SVGSVGElement, unknown>(svgSelector);
    this.g = this.svg.append("g");
    this.tooltip = document.querySelector(tooltipSelector)!;
    this.visibleRelTypes = new Set(["CONTAINS", "IMPORTS", "CALLS", "HAS_METHOD", "EXTENDS", "IMPORTS_EXTERNAL", "CONTAINS_FILE", "CONTAINS_FOLDER"]);

    this.simulation = d3
      .forceSimulation<SimNode, SimLink>()
      .force("link", d3.forceLink<SimNode, SimLink>().id((d) => d.id).distance(40))
      .force("charge", d3.forceManyBody().strength(-80))
      .force("center", d3.forceCenter())
      .force("radial", d3.forceRadial(200).strength(0.08))
      .force("x", d3.forceX().strength(0.03))
      .force("y", d3.forceY().strength(0.03))
      .force("collision", d3.forceCollide().radius(12));

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        this.g.attr("transform", event.transform);
      });

    this.svg.call(this.zoomBehavior);
    this.updateCenter();

    window.addEventListener("resize", () => this.updateCenter());
  }

  private updateCenter() {
    const width = this.svg.node()!.clientWidth;
    const height = this.svg.node()!.clientHeight;
    const cx = width / 2;
    const cy = height / 2;
    (this.simulation.force("center") as d3.ForceCenter<SimNode>)
      ?.x(cx)
      .y(cy);
    const radius = Math.min(width, height) * 0.3;
    (this.simulation.force("radial") as d3.ForceRadial<SimNode>)
      ?.x(cx)
      .y(cy)
      .radius(radius);
    (this.simulation.force("x") as d3.ForceX<SimNode>)?.x(cx);
    (this.simulation.force("y") as d3.ForceY<SimNode>)?.y(cy);
  }

  setOnNodeClick(callback: (node: GraphNode) => void) {
    this.onNodeClick = callback;
  }

  setVisibleRelTypes(types: Set<string>) {
    this.visibleRelTypes = types;
    this.updateVisibility();
  }

  setColorByCommunity(enabled: boolean) {
    this.colorByCommunity = enabled;
    // Re-color existing nodes
    this.nodeElements
      ?.select("circle")
      .attr("fill", (d) => this.getNodeColor(d));
  }

  private getNodeColor(node: SimNode): string {
    if (this.colorByCommunity && node.communityId) {
      if (!this.communityColorMap.has(node.communityId)) {
        const idx = this.communityColorMap.size % COMMUNITY_COLORS.length;
        this.communityColorMap.set(node.communityId, COMMUNITY_COLORS[idx]);
      }
      return this.communityColorMap.get(node.communityId)!;
    }
    return NODE_COLORS[node.labels?.[0] ?? ""] ?? "#666";
  }

  render(data: GraphData) {
    // Deduplicate nodes by id
    const nodeMap = new Map<string, SimNode>();
    for (const n of data.nodes) {
      if (n.id && !nodeMap.has(n.id)) {
        nodeMap.set(n.id, { ...n, x: undefined, y: undefined } as SimNode);
      }
    }
    this.nodes = [...nodeMap.values()];

    // Filter valid edges
    this.links = data.edges
      .filter((e) => e.source && e.target && nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({ ...e }));

    // Clear previous render
    this.g.selectAll("*").remove();

    // Draw links
    const linkGroup = this.g.append("g").attr("class", "links");
    this.linkElements = linkGroup
      .selectAll<SVGLineElement, SimLink>("line")
      .data(this.links)
      .join("line")
      .attr("class", (d) => `link ${d.type}`)
      .attr("stroke-width", 1);

    // Draw nodes
    const nodeGroup = this.g.append("g").attr("class", "nodes");
    this.nodeElements = nodeGroup
      .selectAll<SVGGElement, SimNode>("g")
      .data(this.nodes)
      .join("g")
      .attr("class", "node")
      .call(this.dragBehavior());

    // Build community color map from data
    this.communityColorMap.clear();
    for (const node of this.nodes) {
      if (node.communityId && !this.communityColorMap.has(node.communityId)) {
        const idx = this.communityColorMap.size % COMMUNITY_COLORS.length;
        this.communityColorMap.set(node.communityId, COMMUNITY_COLORS[idx]);
      }
    }

    this.nodeElements
      .append("circle")
      .attr("r", (d) => NODE_RADIUS[d.labels?.[0] ?? ""] ?? 5)
      .attr("fill", (d) => this.getNodeColor(d))
      .on("mouseover", (_event, d) => this.showTooltip(d))
      .on("mousemove", (event) => this.moveTooltip(event))
      .on("mouseout", () => this.hideTooltip())
      .on("click", (_event, d) => this.handleNodeClick(d));

    this.nodeElements
      .append("text")
      .text((d) => d.name ?? "")
      .attr("dy", (d) => -(NODE_RADIUS[d.labels?.[0] ?? ""] ?? 5) - 4);

    // Scale radial force to node count for sphere-like distribution
    const width = this.svg.node()!.clientWidth;
    const height = this.svg.node()!.clientHeight;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(80, Math.sqrt(this.nodes.length) * 10);
    (this.simulation.force("radial") as d3.ForceRadial<SimNode>)
      ?.radius(radius)
      .x(cx)
      .y(cy);
    (this.simulation.force("x") as d3.ForceX<SimNode>)?.x(cx);
    (this.simulation.force("y") as d3.ForceY<SimNode>)?.y(cy);

    this.simulation.nodes(this.nodes).on("tick", () => this.tick());
    (this.simulation.force("link") as d3.ForceLink<SimNode, SimLink>).links(this.links);
    this.simulation.alpha(1).restart();

    this.updateVisibility();
  }

  private tick() {
    this.linkElements
      ?.attr("x1", (d) => (d.source as SimNode).x ?? 0)
      .attr("y1", (d) => (d.source as SimNode).y ?? 0)
      .attr("x2", (d) => (d.target as SimNode).x ?? 0)
      .attr("y2", (d) => (d.target as SimNode).y ?? 0);

    this.nodeElements?.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  }

  private dragBehavior() {
    const simulation = this.simulation;
    return drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
  }

  private handleNodeClick(node: SimNode) {
    if (this.selectedNodeId === node.id) {
      this.selectedNodeId = null;
      this.clearHighlight();
    } else {
      this.selectedNodeId = node.id;
      this.highlightNode(node);
    }
    this.onNodeClick?.(node);
  }

  private highlightNode(node: SimNode) {
    const connectedIds = new Set<string>([node.id]);
    this.links.forEach((l) => {
      const sourceId = typeof l.source === "string" ? l.source : l.source.id;
      const targetId = typeof l.target === "string" ? l.target : l.target.id;
      if (sourceId === node.id) connectedIds.add(targetId);
      if (targetId === node.id) connectedIds.add(sourceId);
    });

    this.nodeElements
      ?.classed("highlighted", (d) => connectedIds.has(d.id))
      .classed("dimmed", (d) => !connectedIds.has(d.id));

    this.linkElements
      ?.classed("highlighted", (l) => {
        const s = typeof l.source === "string" ? l.source : l.source.id;
        const t = typeof l.target === "string" ? l.target : l.target.id;
        return s === node.id || t === node.id;
      })
      .classed("dimmed", (l) => {
        const s = typeof l.source === "string" ? l.source : l.source.id;
        const t = typeof l.target === "string" ? l.target : l.target.id;
        return s !== node.id && t !== node.id;
      });
  }

  private clearHighlight() {
    this.nodeElements?.classed("highlighted", false).classed("dimmed", false);
    this.linkElements?.classed("highlighted", false).classed("dimmed", false);
  }

  private updateVisibility() {
    this.linkElements?.style("display", (d) =>
      this.visibleRelTypes.has(d.type) ? null : "none"
    );
  }

  private showTooltip(node: SimNode) {
    const type = node.labels?.[0] ?? "Unknown";
    const color = NODE_COLORS[type] ?? "#666";

    let detail = "";
    if (node.path) detail += `<div class="tt-detail">Path: ${node.path}</div>`;
    if (node.language) detail += `<div class="tt-detail">Language: ${node.language}</div>`;
    if (node.lineCount) detail += `<div class="tt-detail">Lines: ${node.lineCount}</div>`;
    if (node.startLine) detail += `<div class="tt-detail">Line: ${node.startLine}</div>`;
    if (node.kind) detail += `<div class="tt-detail">Kind: ${node.kind}</div>`;

    this.tooltip.innerHTML = `
      <div class="tt-type" style="color: ${color}">${type}</div>
      <div class="tt-name">${node.name ?? node.qualifiedName ?? "unknown"}</div>
      ${detail}
    `;
    this.tooltip.style.display = "block";
  }

  private moveTooltip(event: MouseEvent) {
    this.tooltip.style.left = event.clientX + 12 + "px";
    this.tooltip.style.top = event.clientY + 12 + "px";
  }

  private hideTooltip() {
    this.tooltip.style.display = "none";
  }

  /**
   * Find and highlight the most specific node matching the active editor position.
   * If the cursor is inside a function/class, highlights that; otherwise highlights the file.
   */
  private getNodePath(node: SimNode): string | null {
    if (node.path) return node.path;
    // Functions/Classes/Interfaces store path in qualifiedName as "filepath:name"
    if (node.qualifiedName) {
      const lastColon = node.qualifiedName.lastIndexOf(":");
      if (lastColon > 0) return node.qualifiedName.substring(0, lastColon);
    }
    return null;
  }

  trackEditor(relativePath: string, line: number): boolean {
    // Try to find a function/class/interface at this line
    let bestMatch: SimNode | null = null;
    let bestSpan = Infinity;

    for (const node of this.nodes) {
      const nodePath = this.getNodePath(node);
      if (!nodePath || nodePath !== relativePath) continue;
      const label = node.labels?.[0];

      if (
        (label === "Function" || label === "Class" || label === "Interface") &&
        node.startLine != null &&
        node.endLine != null &&
        line >= node.startLine &&
        line <= node.endLine
      ) {
        const span = node.endLine - node.startLine;
        if (span < bestSpan) {
          bestSpan = span;
          bestMatch = node;
        }
      }
    }

    // Fall back to the File node
    if (!bestMatch) {
      bestMatch =
        this.nodes.find(
          (n) => n.labels?.[0] === "File" && n.path === relativePath
        ) ?? null;
    }

    if (!bestMatch) return false;

    // Don't re-center if already tracking this node
    if (this.selectedNodeId === bestMatch.id) return true;

    this.centerOnNode(bestMatch.id);
    return true;
  }

  /** Find a node by name or qualifiedName and center on it */
  highlightByName(name: string): boolean {
    const node = this.nodes.find(
      (n) => n.name === name || n.qualifiedName === name
        || n.qualifiedName?.endsWith(`:${name}`)
    );
    if (!node) return false;
    if (this.selectedNodeId === node.id) return true;
    this.centerOnNode(node.id);
    return true;
  }

  centerOnNode(nodeId: string) {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || node.x == null || node.y == null) return;

    const width = this.svg.node()!.clientWidth;
    const height = this.svg.node()!.clientHeight;

    this.svg
      .transition()
      .duration(750)
      .call(
        this.zoomBehavior.transform,
        zoomIdentity
          .translate(width / 2, height / 2)
          .scale(2)
          .translate(-node.x, -node.y)
      );

    this.selectedNodeId = nodeId;
    this.highlightNode(node);
    this.onNodeClick?.(node);
  }
}
