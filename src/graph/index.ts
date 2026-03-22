import type { Config } from "../config.js";
import type { ParsedRepository } from "../types.js";
import { withSession } from "./connection.js";
import { ensureSchema, clearGraph } from "./schema.js";
import {
  mergeFileNodes,
  mergeFunctionNodes,
  mergeClassNodes,
  mergeInterfaceNodes,
  mergeModuleNodes,
} from "./nodes.js";
import {
  createContainsRelationships,
  createHasMethodRelationships,
  createImportRelationships,
  createCallRelationships,
  createExtendsRelationships,
} from "./relationships.js";

export type SyncResult = {
  fileCount: number;
  functionCount: number;
  classCount: number;
  interfaceCount: number;
  moduleCount: number;
};

export const syncToNeo4j = async (
  parsed: ParsedRepository,
  config: Config,
  clear: boolean = false
): Promise<SyncResult> => {
  return withSession(config.neo4j, async (session) => {
    if (clear) {
      console.log("Clearing existing graph...");
      await clearGraph(session);
    }

    console.log("Ensuring schema...");
    await ensureSchema(session);

    console.log("Merging file nodes...");
    await mergeFileNodes(session, parsed.files);

    console.log("Merging function nodes...");
    await mergeFunctionNodes(session, parsed.files);

    console.log("Merging class nodes...");
    await mergeClassNodes(session, parsed.files);

    console.log("Merging interface nodes...");
    await mergeInterfaceNodes(session, parsed.files);

    console.log("Merging module nodes...");
    await mergeModuleNodes(session, parsed.externalModules);

    console.log("Creating CONTAINS relationships...");
    await createContainsRelationships(session, parsed.files);

    console.log("Creating HAS_METHOD relationships...");
    await createHasMethodRelationships(session, parsed.files);

    console.log("Creating IMPORTS relationships...");
    await createImportRelationships(session, parsed.files);

    console.log("Creating CALLS relationships...");
    await createCallRelationships(session, parsed.files);

    console.log("Creating EXTENDS relationships...");
    await createExtendsRelationships(session, parsed.files);

    const functionCount = parsed.files.reduce(
      (sum, f) => sum + f.functions.length + f.classes.reduce((s, c) => s + c.methods.length, 0),
      0
    );

    return {
      fileCount: parsed.files.length,
      functionCount,
      classCount: parsed.files.reduce((sum, f) => sum + f.classes.length, 0),
      interfaceCount: parsed.files.reduce((sum, f) => sum + f.interfaces.length, 0),
      moduleCount: parsed.externalModules.length,
    };
  });
};
