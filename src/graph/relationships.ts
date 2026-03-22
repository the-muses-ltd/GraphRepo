import type { Session } from "neo4j-driver";
import type { ParsedFile } from "../types.js";

export const createContainsRelationships = async (
  session: Session,
  files: ParsedFile[]
): Promise<void> => {
  // File -[CONTAINS]-> Function
  const fileFunctions = files.flatMap((f) =>
    f.functions.map((fn) => ({
      filePath: f.path,
      qualifiedName: `${f.path}:${fn.name}`,
    }))
  );

  if (fileFunctions.length > 0) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (f:File {path: r.filePath})
       MATCH (fn:Function {qualifiedName: r.qualifiedName})
       MERGE (f)-[:CONTAINS]->(fn)`,
      { rels: fileFunctions }
    );
  }

  // File -[CONTAINS]-> Class
  const fileClasses = files.flatMap((f) =>
    f.classes.map((c) => ({
      filePath: f.path,
      qualifiedName: `${f.path}:${c.name}`,
    }))
  );

  if (fileClasses.length > 0) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (f:File {path: r.filePath})
       MATCH (c:Class {qualifiedName: r.qualifiedName})
       MERGE (f)-[:CONTAINS]->(c)`,
      { rels: fileClasses }
    );
  }

  // File -[CONTAINS]-> Interface
  const fileInterfaces = files.flatMap((f) =>
    f.interfaces.map((i) => ({
      filePath: f.path,
      qualifiedName: `${f.path}:${i.name}`,
    }))
  );

  if (fileInterfaces.length > 0) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (f:File {path: r.filePath})
       MATCH (i:Interface {qualifiedName: r.qualifiedName})
       MERGE (f)-[:CONTAINS]->(i)`,
      { rels: fileInterfaces }
    );
  }
};

export const createHasMethodRelationships = async (
  session: Session,
  files: ParsedFile[]
): Promise<void> => {
  const classMethods = files.flatMap((f) =>
    f.classes.flatMap((c) =>
      c.methods.map((m) => ({
        classQualified: `${f.path}:${c.name}`,
        methodQualified: `${f.path}:${c.name}.${m.name}`,
      }))
    )
  );

  if (classMethods.length === 0) return;

  await session.run(
    `UNWIND $rels AS r
     MATCH (c:Class {qualifiedName: r.classQualified})
     MATCH (m:Function {qualifiedName: r.methodQualified})
     MERGE (c)-[:HAS_METHOD]->(m)`,
    { rels: classMethods }
  );
};

export const createImportRelationships = async (
  session: Session,
  files: ParsedFile[]
): Promise<void> => {
  // Internal imports (File -> File)
  const internalImports = files.flatMap((f) =>
    f.imports
      .filter((i) => !i.isExternal && i.resolvedPath)
      .map((i) => ({
        fromPath: f.path,
        toPath: i.resolvedPath!,
        specifier: i.specifier,
        isDefault: i.isDefault,
        names: i.names,
      }))
  );

  if (internalImports.length > 0) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (from:File {path: r.fromPath})
       MATCH (to:File {path: r.toPath})
       MERGE (from)-[imp:IMPORTS]->(to)
       SET imp.specifier = r.specifier,
           imp.isDefault = r.isDefault,
           imp.names = r.names`,
      { rels: internalImports }
    );
  }

  // External imports (File -> Module)
  const externalImports = files.flatMap((f) =>
    f.imports
      .filter((i) => i.isExternal)
      .map((i) => ({
        filePath: f.path,
        moduleName: i.specifier,
        names: i.names,
      }))
  );

  if (externalImports.length > 0) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (f:File {path: r.filePath})
       MATCH (m:Module {name: r.moduleName})
       MERGE (f)-[imp:IMPORTS_EXTERNAL]->(m)
       SET imp.names = r.names`,
      { rels: externalImports }
    );
  }
};

export const createCallRelationships = async (
  session: Session,
  files: ParsedFile[]
): Promise<void> => {
  // Build a lookup of function name -> qualifiedName(s)
  const funcByName = new Map<string, string[]>();
  for (const f of files) {
    for (const fn of f.functions) {
      const existing = funcByName.get(fn.name) ?? [];
      existing.push(`${f.path}:${fn.name}`);
      funcByName.set(fn.name, existing);
    }
    for (const c of f.classes) {
      for (const m of c.methods) {
        const existing = funcByName.get(m.name) ?? [];
        existing.push(`${f.path}:${c.name}.${m.name}`);
        funcByName.set(m.name, existing);
      }
    }
  }

  // Create CALLS relationships
  const callEdges: Array<{ callerQN: string; calleeQN: string }> = [];

  for (const f of files) {
    for (const fn of f.functions) {
      const callerQN = `${f.path}:${fn.name}`;
      for (const calleeName of fn.calls) {
        const targets = funcByName.get(calleeName);
        if (targets) {
          // Prefer functions in the same file
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

  if (callEdges.length === 0) return;

  // Deduplicate and count
  const edgeCounts = new Map<string, number>();
  for (const edge of callEdges) {
    const key = `${edge.callerQN}->${edge.calleeQN}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  const dedupedEdges = [...edgeCounts.entries()].map(([key, count]) => {
    const [callerQN, calleeQN] = key.split("->");
    return { callerQN, calleeQN, count };
  });

  await session.run(
    `UNWIND $rels AS r
     MATCH (caller:Function {qualifiedName: r.callerQN})
     MATCH (callee:Function {qualifiedName: r.calleeQN})
     MERGE (caller)-[c:CALLS]->(callee)
     SET c.count = r.count`,
    { rels: dedupedEdges }
  );
};

export const createFolderRelationships = async (
  session: Session,
  files: ParsedFile[]
): Promise<void> => {
  // Folder -[CONTAINS_FILE]-> File
  const folderFiles = files.map((f) => {
    const parts = f.path.split("/");
    const folderPath = parts.slice(0, -1).join("/");
    return { folderPath, filePath: f.path };
  }).filter((r) => r.folderPath);

  if (folderFiles.length > 0) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (folder:Folder {path: r.folderPath})
       MATCH (file:File {path: r.filePath})
       MERGE (folder)-[:CONTAINS_FILE]->(file)`,
      { rels: folderFiles }
    );
  }

  // Folder -[CONTAINS_FOLDER]-> Folder (parent -> child)
  const folders = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  const folderParents = [...folders]
    .filter((fp) => fp.includes("/"))
    .map((fp) => {
      const parts = fp.split("/");
      return {
        parentPath: parts.slice(0, -1).join("/"),
        childPath: fp,
      };
    })
    .filter((r) => folders.has(r.parentPath));

  if (folderParents.length > 0) {
    await session.run(
      `UNWIND $rels AS r
       MATCH (parent:Folder {path: r.parentPath})
       MATCH (child:Folder {path: r.childPath})
       MERGE (parent)-[:CONTAINS_FOLDER]->(child)`,
      { rels: folderParents }
    );
  }
};

export const createExtendsRelationships = async (
  session: Session,
  files: ParsedFile[]
): Promise<void> => {
  // Build class name -> qualifiedName lookup
  const classByName = new Map<string, string>();
  for (const f of files) {
    for (const c of f.classes) {
      classByName.set(c.name, `${f.path}:${c.name}`);
    }
  }

  const extendsEdges = files.flatMap((f) =>
    f.classes
      .filter((c) => c.superClass && classByName.has(c.superClass))
      .map((c) => ({
        childQN: `${f.path}:${c.name}`,
        parentQN: classByName.get(c.superClass!)!,
      }))
  );

  if (extendsEdges.length === 0) return;

  await session.run(
    `UNWIND $rels AS r
     MATCH (child:Class {qualifiedName: r.childQN})
     MATCH (parent:Class {qualifiedName: r.parentQN})
     MERGE (child)-[:EXTENDS]->(parent)`,
    { rels: extendsEdges }
  );
};
