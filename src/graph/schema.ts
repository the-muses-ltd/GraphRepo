import type { Session } from "neo4j-driver";

const SCHEMA_STATEMENTS = [
  // Unique constraints
  "CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE",
  "CREATE CONSTRAINT function_qualifiedName IF NOT EXISTS FOR (fn:Function) REQUIRE fn.qualifiedName IS UNIQUE",
  "CREATE CONSTRAINT class_qualifiedName IF NOT EXISTS FOR (c:Class) REQUIRE c.qualifiedName IS UNIQUE",
  "CREATE CONSTRAINT interface_qualifiedName IF NOT EXISTS FOR (i:Interface) REQUIRE i.qualifiedName IS UNIQUE",
  "CREATE CONSTRAINT module_name IF NOT EXISTS FOR (m:Module) REQUIRE m.name IS UNIQUE",

  // Indexes for search
  "CREATE INDEX file_name IF NOT EXISTS FOR (f:File) ON (f.name)",
  "CREATE INDEX function_name IF NOT EXISTS FOR (fn:Function) ON (fn.name)",
  "CREATE INDEX class_name IF NOT EXISTS FOR (c:Class) ON (c.name)",
];

// Full-text index needs separate handling (different syntax)
const FULLTEXT_INDEX = `
  CREATE FULLTEXT INDEX code_search IF NOT EXISTS
  FOR (n:Function|Class|Interface|Variable)
  ON EACH [n.name, n.qualifiedName]
`;

export const ensureSchema = async (session: Session): Promise<void> => {
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

export const clearGraph = async (session: Session): Promise<void> => {
  // Delete all nodes and relationships in batches
  let deleted = 1;
  while (deleted > 0) {
    const result = await session.run(
      "MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(n) AS deleted"
    );
    deleted = result.records[0]?.get("deleted")?.toNumber?.() ?? 0;
  }
};
