import type { Session } from "neo4j-driver";

const SCHEMA_STATEMENTS = [
  // Composite indexes for repo-scoped lookups
  "CREATE INDEX file_path_repo IF NOT EXISTS FOR (f:File) ON (f.path, f.repo)",
  "CREATE INDEX function_qn_repo IF NOT EXISTS FOR (fn:Function) ON (fn.qualifiedName, fn.repo)",
  "CREATE INDEX class_qn_repo IF NOT EXISTS FOR (c:Class) ON (c.qualifiedName, c.repo)",
  "CREATE INDEX interface_qn_repo IF NOT EXISTS FOR (i:Interface) ON (i.qualifiedName, i.repo)",
  "CREATE INDEX module_name IF NOT EXISTS FOR (m:Module) ON (m.name)",
  "CREATE INDEX folder_path_repo IF NOT EXISTS FOR (f:Folder) ON (f.path, f.repo)",

  // Indexes for search
  "CREATE INDEX file_name IF NOT EXISTS FOR (f:File) ON (f.name)",
  "CREATE INDEX function_name IF NOT EXISTS FOR (fn:Function) ON (fn.name)",
  "CREATE INDEX class_name IF NOT EXISTS FOR (c:Class) ON (c.name)",
  "CREATE INDEX node_repo IF NOT EXISTS FOR (n:File) ON (n.repo)",
];

// Full-text index needs separate handling (different syntax)
const FULLTEXT_INDEX = `
  CREATE FULLTEXT INDEX code_search IF NOT EXISTS
  FOR (n:Function|Class|Interface|Variable)
  ON EACH [n.name, n.qualifiedName]
`;

// Old single-property constraints to drop (from pre-multi-repo schema)
const LEGACY_CONSTRAINTS = [
  "file_path",
  "function_qualifiedName",
  "class_qualifiedName",
  "interface_qualifiedName",
  "module_name",
];

export const ensureSchema = async (session: Session): Promise<void> => {
  // Drop legacy single-property unique constraints
  for (const name of LEGACY_CONSTRAINTS) {
    try {
      await session.run(`DROP CONSTRAINT ${name} IF EXISTS`);
    } catch {
      // Ignore if doesn't exist
    }
  }

  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      await session.run(stmt);
    } catch (err: unknown) {
      // Ignore "already exists" errors
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) throw err;
    }
  }

  try {
    await session.run(FULLTEXT_INDEX);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists")) throw err;
  }
};

export const clearGraph = async (session: Session, repo?: string): Promise<void> => {
  // Delete nodes scoped to a specific repo, or all nodes if no repo given
  let deleted = 1;
  while (deleted > 0) {
    const query = repo
      ? "MATCH (n {repo: $repo}) WITH n LIMIT 10000 DETACH DELETE n RETURN count(n) AS deleted"
      : "MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(n) AS deleted";
    const result = await session.run(query, repo ? { repo } : {});
    deleted = result.records[0]?.get("deleted")?.toNumber?.() ?? 0;
  }
};
