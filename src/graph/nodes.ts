import type { Session } from "neo4j-driver";
import path from "path";
import type { ParsedFile } from "../types.js";

export const mergeFileNodes = async (
  session: Session,
  files: ParsedFile[],
  repo: string
): Promise<void> => {
  await session.run(
    `UNWIND $files AS f
     MERGE (file:File {path: f.path, repo: f.repo})
     SET file.name = f.name,
         file.extension = f.extension,
         file.language = f.language,
         file.size = f.size,
         file.lineCount = f.lineCount`,
    {
      files: files.map((f) => ({
        path: f.path,
        repo,
        name: path.basename(f.path),
        extension: path.extname(f.path),
        language: f.language,
        size: f.size,
        lineCount: f.lineCount,
      })),
    }
  );
};

export const mergeFunctionNodes = async (
  session: Session,
  files: ParsedFile[],
  repo: string
): Promise<void> => {
  const functions = files.flatMap((f) =>
    f.functions.map((fn) => ({
      qualifiedName: `${f.path}:${fn.name}`,
      name: fn.name,
      repo,
      parameters: fn.parameters,
      returnType: fn.returnType,
      startLine: fn.startLine,
      endLine: fn.endLine,
      isExported: fn.isExported,
      isAsync: fn.isAsync,
      kind: fn.kind,
      filePath: f.path,
    }))
  );

  if (functions.length === 0) return;

  await session.run(
    `UNWIND $functions AS fn
     MERGE (func:Function {qualifiedName: fn.qualifiedName, repo: fn.repo})
     SET func.name = fn.name,
         func.parameters = fn.parameters,
         func.returnType = fn.returnType,
         func.startLine = fn.startLine,
         func.endLine = fn.endLine,
         func.isExported = fn.isExported,
         func.isAsync = fn.isAsync,
         func.kind = fn.kind`,
    { functions }
  );
};

export const mergeClassNodes = async (
  session: Session,
  files: ParsedFile[],
  repo: string
): Promise<void> => {
  const classes = files.flatMap((f) =>
    f.classes.map((c) => ({
      qualifiedName: `${f.path}:${c.name}`,
      name: c.name,
      repo,
      startLine: c.startLine,
      endLine: c.endLine,
      isExported: c.isExported,
      isAbstract: c.isAbstract,
      filePath: f.path,
    }))
  );

  if (classes.length === 0) return;

  await session.run(
    `UNWIND $classes AS c
     MERGE (cls:Class {qualifiedName: c.qualifiedName, repo: c.repo})
     SET cls.name = c.name,
         cls.startLine = c.startLine,
         cls.endLine = c.endLine,
         cls.isExported = c.isExported,
         cls.isAbstract = c.isAbstract`,
    { classes }
  );

  // Merge class methods as Function nodes
  const methods = files.flatMap((f) =>
    f.classes.flatMap((c) =>
      c.methods.map((m) => ({
        qualifiedName: `${f.path}:${c.name}.${m.name}`,
        name: m.name,
        repo,
        parameters: m.parameters,
        returnType: m.returnType,
        startLine: m.startLine,
        endLine: m.endLine,
        isExported: m.isExported,
        isAsync: m.isAsync,
        kind: m.kind,
        className: `${f.path}:${c.name}`,
      }))
    )
  );

  if (methods.length === 0) return;

  await session.run(
    `UNWIND $methods AS m
     MERGE (func:Function {qualifiedName: m.qualifiedName, repo: m.repo})
     SET func.name = m.name,
         func.parameters = m.parameters,
         func.returnType = m.returnType,
         func.startLine = m.startLine,
         func.endLine = m.endLine,
         func.isExported = m.isExported,
         func.isAsync = m.isAsync,
         func.kind = m.kind`,
    { methods }
  );
};

export const mergeInterfaceNodes = async (
  session: Session,
  files: ParsedFile[],
  repo: string
): Promise<void> => {
  const interfaces = files.flatMap((f) =>
    f.interfaces.map((i) => ({
      qualifiedName: `${f.path}:${i.name}`,
      name: i.name,
      repo,
      startLine: i.startLine,
      endLine: i.endLine,
      isExported: i.isExported,
      filePath: f.path,
    }))
  );

  if (interfaces.length === 0) return;

  await session.run(
    `UNWIND $interfaces AS i
     MERGE (iface:Interface {qualifiedName: i.qualifiedName, repo: i.repo})
     SET iface.name = i.name,
         iface.startLine = i.startLine,
         iface.endLine = i.endLine,
         iface.isExported = i.isExported`,
    { interfaces }
  );
};

export const mergeModuleNodes = async (
  session: Session,
  externalModules: string[]
): Promise<void> => {
  if (externalModules.length === 0) return;

  await session.run(
    `UNWIND $modules AS name
     MERGE (m:Module {name: name})`,
    { modules: externalModules }
  );
};

export const mergeFolderNodes = async (
  session: Session,
  files: ParsedFile[],
  repo: string
): Promise<void> => {
  // Extract all unique folder paths from files
  const folders = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/");
    // Build each parent folder path
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join("/"));
    }
  }

  if (folders.size === 0) return;

  const folderList = [...folders].map((fp) => ({
    path: fp,
    name: fp.split("/").pop() ?? fp,
    repo,
  }));

  await session.run(
    `UNWIND $folders AS f
     MERGE (folder:Folder {path: f.path, repo: f.repo})
     SET folder.name = f.name`,
    { folders: folderList }
  );
};
