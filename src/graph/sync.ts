import path from "path";
import type { ParsedRepository, ParsedFile } from "../types.js";
import {
  getStore,
  resetStore,
  fileId,
  functionId,
  classId,
  interfaceId,
  moduleId,
  folderId,
  type NodeAttributes,
  type EdgeAttributes,
} from "./store.js";
import type Graph from "graphology";

export type SyncResult = {
  fileCount: number;
  functionCount: number;
  classCount: number;
  interfaceCount: number;
  moduleCount: number;
};

/**
 * Build the graphology graph from parsed repository data.
 * Replaces syncToNeo4j — all operations are in-memory.
 */
export function syncToGraph(
  parsed: ParsedRepository,
  repoPath: string,
  clear: boolean = false
): SyncResult {
  const graph = getStore();
  const repo =
    repoPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "unknown";

  if (clear) {
    resetStore();
  } else {
    // Clear only nodes belonging to this repo
    const toRemove: string[] = [];
    graph.forEachNode((id, attrs) => {
      if (attrs.repo === repo) toRemove.push(id);
    });
    for (const id of toRemove) {
      graph.dropNode(id);
    }
  }

  // ---- Merge nodes ----
  mergeFileNodes(graph, parsed.files, repo);
  mergeFunctionNodes(graph, parsed.files, repo);
  mergeClassNodes(graph, parsed.files, repo);
  mergeInterfaceNodes(graph, parsed.files, repo);
  mergeModuleNodes(graph, parsed.externalModules);
  mergeFolderNodes(graph, parsed.files, repo);

  // ---- Merge relationships ----
  createContainsRelationships(graph, parsed.files, repo);
  createHasMethodRelationships(graph, parsed.files, repo);
  createImportRelationships(graph, parsed.files, repo);
  createCallRelationships(graph, parsed.files, repo);
  createExtendsRelationships(graph, parsed.files, repo);
  createFolderRelationships(graph, parsed.files, repo);

  // Compute counts
  const functionCount = parsed.files.reduce(
    (sum, f) =>
      sum +
      f.functions.length +
      f.classes.reduce((s, c) => s + c.methods.length, 0),
    0
  );

  return {
    fileCount: parsed.files.length,
    functionCount,
    classCount: parsed.files.reduce((sum, f) => sum + f.classes.length, 0),
    interfaceCount: parsed.files.reduce(
      (sum, f) => sum + f.interfaces.length,
      0
    ),
    moduleCount: parsed.externalModules.length,
  };
}

// ---- Node merge functions ----

function mergeFileNodes(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  repo: string
): void {
  for (const f of files) {
    graph.mergeNode(fileId(f.path), {
      type: "File",
      name: path.basename(f.path),
      repo,
      path: f.path,
      extension: path.extname(f.path),
      language: f.language,
      size: f.size,
      lineCount: f.lineCount,
    });
  }
}

function mergeFunctionNodes(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  repo: string
): void {
  for (const f of files) {
    for (const fn of f.functions) {
      const qn = `${f.path}:${fn.name}`;
      graph.mergeNode(functionId(qn), {
        type: "Function",
        name: fn.name,
        qualifiedName: qn,
        repo,
        parameters: fn.parameters,
        returnType: fn.returnType,
        startLine: fn.startLine,
        endLine: fn.endLine,
        isExported: fn.isExported,
        isAsync: fn.isAsync,
        kind: fn.kind,
      });
    }
  }
}

function mergeClassNodes(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  repo: string
): void {
  for (const f of files) {
    for (const c of f.classes) {
      const qn = `${f.path}:${c.name}`;
      graph.mergeNode(classId(qn), {
        type: "Class",
        name: c.name,
        qualifiedName: qn,
        repo,
        startLine: c.startLine,
        endLine: c.endLine,
        isExported: c.isExported,
        isAbstract: c.isAbstract,
      });

      // Merge class methods as Function nodes
      for (const m of c.methods) {
        const methodQN = `${f.path}:${c.name}.${m.name}`;
        graph.mergeNode(functionId(methodQN), {
          type: "Function",
          name: m.name,
          qualifiedName: methodQN,
          repo,
          parameters: m.parameters,
          returnType: m.returnType,
          startLine: m.startLine,
          endLine: m.endLine,
          isExported: m.isExported,
          isAsync: m.isAsync,
          kind: m.kind,
        });
      }
    }
  }
}

function mergeInterfaceNodes(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  repo: string
): void {
  for (const f of files) {
    for (const i of f.interfaces) {
      const qn = `${f.path}:${i.name}`;
      graph.mergeNode(interfaceId(qn), {
        type: "Interface",
        name: i.name,
        qualifiedName: qn,
        repo,
        startLine: i.startLine,
        endLine: i.endLine,
        isExported: i.isExported,
      });
    }
  }
}

function mergeModuleNodes(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  externalModules: string[]
): void {
  for (const name of externalModules) {
    graph.mergeNode(moduleId(name), {
      type: "Module",
      name,
      repo: "", // Modules are shared across repos
    });
  }
}

function mergeFolderNodes(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  repo: string
): void {
  const folders = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  for (const fp of folders) {
    graph.mergeNode(folderId(fp), {
      type: "Folder",
      name: fp.split("/").pop() ?? fp,
      path: fp,
      repo,
    });
  }
}

// ---- Relationship creation functions ----

function createContainsRelationships(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  repo: string
): void {
  for (const f of files) {
    const fId = fileId(f.path);

    // File -> Function
    for (const fn of f.functions) {
      const fnId = functionId(`${f.path}:${fn.name}`);
      graph.mergeDirectedEdge(fId, fnId, { type: "CONTAINS" });
    }

    // File -> Class
    for (const c of f.classes) {
      const cId = classId(`${f.path}:${c.name}`);
      graph.mergeDirectedEdge(fId, cId, { type: "CONTAINS" });
    }

    // File -> Interface
    for (const i of f.interfaces) {
      const iId = interfaceId(`${f.path}:${i.name}`);
      graph.mergeDirectedEdge(fId, iId, { type: "CONTAINS" });
    }
  }
}

function createHasMethodRelationships(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  _repo: string
): void {
  for (const f of files) {
    for (const c of f.classes) {
      const cId = classId(`${f.path}:${c.name}`);
      for (const m of c.methods) {
        const mId = functionId(`${f.path}:${c.name}.${m.name}`);
        graph.mergeDirectedEdge(cId, mId, { type: "HAS_METHOD" });
      }
    }
  }
}

function createImportRelationships(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  _repo: string
): void {
  for (const f of files) {
    const fId = fileId(f.path);

    for (const imp of f.imports) {
      if (!imp.isExternal && imp.resolvedPath) {
        // Internal import: File -> File
        const targetId = fileId(imp.resolvedPath);
        if (graph.hasNode(targetId)) {
          graph.mergeDirectedEdge(fId, targetId, {
            type: "IMPORTS",
            specifier: imp.specifier,
            isDefault: imp.isDefault,
            names: imp.names,
          });
        }
      } else if (imp.isExternal) {
        // External import: File -> Module
        const mId = moduleId(imp.specifier);
        if (graph.hasNode(mId)) {
          graph.mergeDirectedEdge(fId, mId, {
            type: "IMPORTS_EXTERNAL",
            names: imp.names,
          });
        }
      }
    }
  }
}

function createCallRelationships(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  _repo: string
): void {
  // Build a lookup of function name -> qualifiedName(s)
  const funcByName = new Map<string, string[]>();
  for (const f of files) {
    for (const fn of f.functions) {
      const qn = `${f.path}:${fn.name}`;
      const existing = funcByName.get(fn.name) ?? [];
      existing.push(qn);
      funcByName.set(fn.name, existing);
    }
    for (const c of f.classes) {
      for (const m of c.methods) {
        const qn = `${f.path}:${c.name}.${m.name}`;
        const existing = funcByName.get(m.name) ?? [];
        existing.push(qn);
        funcByName.set(m.name, existing);
      }
    }
  }

  // Collect call edges
  const callEdges: Array<{ callerQN: string; calleeQN: string }> = [];

  for (const f of files) {
    for (const fn of f.functions) {
      const callerQN = `${f.path}:${fn.name}`;
      for (const calleeName of fn.calls) {
        const targets = funcByName.get(calleeName);
        if (targets) {
          const sameFile = targets.find((t) => t.startsWith(f.path + ":"));
          const target = sameFile ?? targets[0];
          if (target !== callerQN) {
            callEdges.push({ callerQN, calleeQN: target });
          }
        }
      }
    }

    for (const c of f.classes) {
      for (const m of c.methods) {
        const callerQN = `${f.path}:${c.name}.${m.name}`;
        for (const calleeName of m.calls) {
          const targets = funcByName.get(calleeName);
          if (targets) {
            const sameFile = targets.find((t) => t.startsWith(f.path + ":"));
            const target = sameFile ?? targets[0];
            if (target !== callerQN) {
              callEdges.push({ callerQN, calleeQN: target });
            }
          }
        }
      }
    }
  }

  // Deduplicate and count
  const edgeCounts = new Map<string, number>();
  for (const edge of callEdges) {
    const key = `${edge.callerQN}->${edge.calleeQN}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  for (const [key, count] of edgeCounts) {
    const [callerQN, calleeQN] = key.split("->");
    const callerId = functionId(callerQN);
    const calleeId = functionId(calleeQN);
    if (graph.hasNode(callerId) && graph.hasNode(calleeId)) {
      graph.mergeDirectedEdge(callerId, calleeId, {
        type: "CALLS",
        count,
      });
    }
  }
}

function createExtendsRelationships(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  _repo: string
): void {
  // Build class name -> qualifiedName lookup
  const classByName = new Map<string, string>();
  for (const f of files) {
    for (const c of f.classes) {
      classByName.set(c.name, `${f.path}:${c.name}`);
    }
  }

  for (const f of files) {
    for (const c of f.classes) {
      if (c.superClass && classByName.has(c.superClass)) {
        const childId = classId(`${f.path}:${c.name}`);
        const parentId = classId(classByName.get(c.superClass)!);
        graph.mergeDirectedEdge(childId, parentId, { type: "EXTENDS" });
      }
    }
  }
}

function createFolderRelationships(
  graph: Graph<NodeAttributes, EdgeAttributes>,
  files: ParsedFile[],
  _repo: string
): void {
  // Folder -> File
  for (const f of files) {
    const parts = f.path.split("/");
    const folderPath = parts.slice(0, -1).join("/");
    if (folderPath) {
      const foldId = folderId(folderPath);
      const fId = fileId(f.path);
      if (graph.hasNode(foldId) && graph.hasNode(fId)) {
        graph.mergeDirectedEdge(foldId, fId, { type: "CONTAINS_FILE" });
      }
    }
  }

  // Folder -> Folder (parent -> child)
  const folders = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  for (const fp of folders) {
    if (!fp.includes("/")) continue;
    const parts = fp.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    if (folders.has(parentPath)) {
      const parentId = folderId(parentPath);
      const childId = folderId(fp);
      if (graph.hasNode(parentId) && graph.hasNode(childId)) {
        graph.mergeDirectedEdge(parentId, childId, {
          type: "CONTAINS_FOLDER",
        });
      }
    }
  }
}
