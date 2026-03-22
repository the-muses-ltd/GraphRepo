import { GraphRenderer } from "./graph-renderer.js";
import { fetchGraph, searchCode, fetchNodeDetails, type GraphNode } from "./api.js";

const renderer = new GraphRenderer("#graph-svg", "#tooltip");

// --- State ---
let debounceTimer: ReturnType<typeof setTimeout>;

// --- UI Elements ---
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const searchResults = document.getElementById("search-results")!;
const nodeDetails = document.getElementById("node-details")!;
const nodeDetailsContent = document.getElementById("node-details-content")!;
const reloadBtn = document.getElementById("reload-btn")!;
const nodeLimitSlider = document.getElementById("node-limit") as HTMLInputElement;
const nodeLimitDisplay = document.getElementById("node-limit-display")!;
const typeFilters = document.querySelectorAll<HTMLInputElement>('#type-filters input[type="checkbox"]');
const relFilters = document.querySelectorAll<HTMLInputElement>('#rel-filters input[type="checkbox"]');

// --- Helpers ---
const getSelectedTypes = (): string[] => {
  const types: string[] = [];
  typeFilters.forEach((cb) => {
    if (cb.checked) types.push(cb.dataset.type!);
  });
  return types;
};

const getSelectedRelTypes = (): Set<string> => {
  const types = new Set<string>();
  relFilters.forEach((cb) => {
    if (cb.checked) types.add(cb.dataset.rel!);
  });
  return types;
};

// --- Load Graph ---
const loadGraph = async () => {
  reloadBtn.textContent = "Loading...";
  reloadBtn.setAttribute("disabled", "true");

  try {
    const types = getSelectedTypes();
    const limit = parseInt(nodeLimitSlider.value, 10);
    const data = await fetchGraph(types.length < 5 ? types : null, limit);
    renderer.render(data);
  } catch (err) {
    console.error("Failed to load graph:", err);
  } finally {
    reloadBtn.textContent = "Reload Graph";
    reloadBtn.removeAttribute("disabled");
  }
};

// --- Node Click Handler ---
renderer.setOnNodeClick(async (node: GraphNode) => {
  nodeDetails.style.display = "block";

  try {
    const details = await fetchNodeDetails(node.id);
    let html = "";

    for (const [key, value] of Object.entries(details.properties)) {
      if (value == null) continue;
      html += `<div><span class="detail-key">${key}:</span> <span class="detail-value">${value}</span></div>`;
    }

    if (details.relationships?.length > 0) {
      html += `<div style="margin-top: 8px"><span class="detail-key">Connections:</span></div>`;
      for (const rel of details.relationships) {
        if (!rel.relType) continue;
        const arrow = rel.direction === "out" ? "\u2192" : "\u2190";
        html += `<div style="padding-left: 8px; color: #aaa">${arrow} ${rel.relType} ${rel.relatedName ?? ""}</div>`;
      }
    }

    nodeDetailsContent.innerHTML = html;
  } catch {
    nodeDetailsContent.innerHTML = `<div>${node.name ?? "Unknown"}</div>`;
  }
});

// --- Search ---
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const query = searchInput.value.trim();
    if (!query) {
      searchResults.innerHTML = "";
      return;
    }

    try {
      const results = await searchCode(query);
      searchResults.innerHTML = results
        .map(
          (r) =>
            `<div class="search-result-item" data-id="${r.id}">
              <span class="dot" style="background: ${getTypeColor(r.type)}; width: 8px; height: 8px; display: inline-block; border-radius: 50%; margin-right: 6px"></span>
              ${r.name}
              <span style="color: #555; font-size: 11px"> ${r.type}</span>
            </div>`
        )
        .join("");

      // Click to center
      searchResults.querySelectorAll(".search-result-item").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.getAttribute("data-id");
          if (id) renderer.centerOnNode(id);
        });
      });
    } catch {
      searchResults.innerHTML = '<div class="search-result-item">Search failed</div>';
    }
  }, 300);
});

const getTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    File: "#4C8BF5",
    Function: "#34A853",
    Class: "#FBBC05",
    Interface: "#AB47BC",
    Variable: "#26A69A",
    Module: "#78909C",
  };
  return colors[type] ?? "#666";
};

// --- Event Listeners ---
reloadBtn.addEventListener("click", loadGraph);

nodeLimitSlider.addEventListener("input", () => {
  nodeLimitDisplay.textContent = nodeLimitSlider.value;
});

relFilters.forEach((cb) => {
  cb.addEventListener("change", () => {
    renderer.setVisibleRelTypes(getSelectedRelTypes());
  });
});

// --- Initial Load ---
loadGraph();
