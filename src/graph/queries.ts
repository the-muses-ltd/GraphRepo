export const searchByName = (pattern: string, type: string, limit: number, repo?: string | null) => ({
  cypher:
    type === "all"
      ? `CALL db.index.fulltext.queryNodes("code_search", $pattern)
         YIELD node, score
         ${repo ? "WHERE node.repo = $repo" : ""}
         RETURN labels(node)[0] AS type, node.name AS name,
                node.qualifiedName AS qualifiedName, score
         ORDER BY score DESC LIMIT toInteger($limit)`
      : `CALL db.index.fulltext.queryNodes("code_search", $pattern)
         YIELD node, score
         WHERE $type IN labels(node)${repo ? " AND node.repo = $repo" : ""}
         RETURN labels(node)[0] AS type, node.name AS name,
                node.qualifiedName AS qualifiedName, score
         ORDER BY score DESC LIMIT toInteger($limit)`,
  params: {
    pattern,
    type: type.charAt(0).toUpperCase() + type.slice(1),
    limit: Number(limit),
    repo: repo ?? null,
  },
});

export const getDependencies = (filePath: string, depth: number, repo?: string | null) => {
  const repoFilter = repo ? ", repo: $repo" : "";
  return {
    cypher:
      depth <= 1
        ? `MATCH (f:File {path: $path${repoFilter}})-[:IMPORTS]->(dep:File)
           RETURN dep.path AS path, dep.language AS language`
        : `MATCH path = (f:File {path: $path${repoFilter}})-[:IMPORTS*1..${depth}]->(dep:File)
           RETURN DISTINCT dep.path AS path, dep.language AS language,
                  length(path) AS depth
           ORDER BY depth`,
    params: { path: filePath, repo: repo ?? null },
  };
};

export const getDependents = (filePath: string, depth: number, repo?: string | null) => {
  const repoFilter = repo ? ", repo: $repo" : "";
  return {
    cypher:
      depth <= 1
        ? `MATCH (f:File)-[:IMPORTS]->(target:File {path: $path${repoFilter}})
           RETURN f.path AS path, f.language AS language`
        : `MATCH path = (f:File)-[:IMPORTS*1..${depth}]->(target:File {path: $path${repoFilter}})
           RETURN DISTINCT f.path AS path, f.language AS language,
                  length(path) AS depth
           ORDER BY depth`,
    params: { path: filePath, repo: repo ?? null },
  };
};

export const getFileStructure = (filePath: string, repo?: string | null) => {
  const repoFilter = repo ? ", repo: $repo" : "";
  return {
    cypher: `MATCH (f:File {path: $path${repoFilter}})
             OPTIONAL MATCH (f)-[:CONTAINS]->(fn:Function)
             OPTIONAL MATCH (f)-[:CONTAINS]->(c:Class)
             OPTIONAL MATCH (f)-[:CONTAINS]->(i:Interface)
             OPTIONAL MATCH (f)-[:IMPORTS]->(dep:File)
             OPTIONAL MATCH (f)-[:IMPORTS_EXTERNAL]->(m:Module)
             RETURN f.path AS path, f.language AS language,
                    f.lineCount AS lineCount, f.size AS size,
                    collect(DISTINCT {name: fn.name, kind: fn.kind, line: fn.startLine, async: fn.isAsync}) AS functions,
                    collect(DISTINCT {name: c.name, line: c.startLine, abstract: c.isAbstract}) AS classes,
                    collect(DISTINCT {name: i.name, line: i.startLine}) AS interfaces,
                    collect(DISTINCT dep.path) AS imports,
                    collect(DISTINCT m.name) AS externalImports`,
    params: { path: filePath, repo: repo ?? null },
  };
};

export const getCallGraph = (
  functionName: string,
  depth: number,
  direction: string,
  repo?: string | null
) => {
  const dirFilter =
    direction === "callers"
      ? "<-[:CALLS*1.." + depth + "]-"
      : direction === "callees"
        ? "-[:CALLS*1.." + depth + "]->"
        : "-[:CALLS*1.." + depth + "]-";

  const repoWhere = repo ? " AND f.repo = $repo" : "";

  return {
    cypher: `MATCH (f:Function)
             WHERE (f.name = $name OR f.qualifiedName = $name)${repoWhere}
             WITH f LIMIT 1
             MATCH path = (f)${dirFilter}(other:Function)
             UNWIND relationships(path) AS rel
             WITH startNode(rel) AS caller, endNode(rel) AS callee
             RETURN DISTINCT caller.qualifiedName AS caller,
                    callee.qualifiedName AS callee`,
    params: { name: functionName, repo: repo ?? null },
  };
};

export const findRelated = (entityName: string, maxHops: number, repo?: string | null) => {
  const repoWhere = repo ? " AND n.repo = $repo" : "";
  return {
    cypher: `MATCH (n)
             WHERE (n.name = $name OR n.qualifiedName = $name)${repoWhere}
             WITH n LIMIT 1
             MATCH path = (n)-[*1..${maxHops}]-(related)
             RETURN DISTINCT labels(related)[0] AS type,
                    related.name AS name,
                    related.qualifiedName AS qualifiedName,
                    length(path) AS distance
             ORDER BY distance, name
             LIMIT 50`,
    params: { name: entityName, repo: repo ?? null },
  };
};

export const getRepoSummary = (repo?: string | null) => {
  const repoFilter = repo ? " WHERE f.repo = $repo" : "";
  const fnFilter = repo ? " WHERE fn.repo = $repo" : "";
  const clsFilter = repo ? " WHERE c.repo = $repo" : "";
  const ifaceFilter = repo ? " WHERE i.repo = $repo" : "";
  return {
    cypher: `MATCH (f:File)${repoFilter}
             WITH count(f) AS fileCount,
                  collect(DISTINCT f.language) AS languages,
                  sum(f.lineCount) AS totalLines
             OPTIONAL MATCH (fn:Function)${fnFilter}
             WITH fileCount, languages, totalLines, count(fn) AS funcCount
             OPTIONAL MATCH (c:Class)${clsFilter}
             WITH fileCount, languages, totalLines, funcCount, count(c) AS classCount
             OPTIONAL MATCH (i:Interface)${ifaceFilter}
             WITH fileCount, languages, totalLines, funcCount, classCount, count(i) AS interfaceCount
             OPTIONAL MATCH ()-[r:IMPORTS]->()
             WITH fileCount, languages, totalLines, funcCount, classCount, interfaceCount, count(r) AS importCount
             OPTIONAL MATCH ()-[c:CALLS]->()
             RETURN fileCount, languages, totalLines, funcCount,
                    classCount, interfaceCount, importCount, count(c) AS callCount`,
    params: { repo: repo ?? null },
  };
};

export const getGraphData = (
  nodeTypes: string[] | null,
  limit: number,
  repo?: string | null
) => {
  const conditions = ["NOT n:Community"];
  if (nodeTypes) conditions.push("any(label IN labels(n) WHERE label IN $nodeTypes)");
  if (repo) conditions.push("n.repo = $repo");
  const nodeFilter = `WHERE ${conditions.join(" AND ")}`;

  const mConditions = ["NOT m:Community"];
  if (nodeTypes) mConditions.push("any(label IN labels(m) WHERE label IN $nodeTypes)");
  if (repo) mConditions.push("m.repo = $repo");
  const mFilter = `WHERE ${mConditions.join(" AND ")}`;

  return {
    cypher: `MATCH (n)
       ${nodeFilter}
       WITH n LIMIT toInteger($limit)
       OPTIONAL MATCH (n)-[:BELONGS_TO_COMMUNITY]->(c:Community {level: 1})
       WITH n, c.id AS communityId
       OPTIONAL MATCH (n)-[r]-(m)
       ${mFilter}
       RETURN collect(DISTINCT {
         id: elementId(n), labels: labels(n), name: n.name,
         qualifiedName: n.qualifiedName, path: n.path,
         language: n.language, lineCount: n.lineCount,
         startLine: n.startLine, endLine: n.endLine, kind: n.kind,
         communityId: communityId, repo: n.repo
       }) AS nodes,
       collect(DISTINCT {
         source: elementId(startNode(r)), target: elementId(endNode(r)),
         type: type(r)
       }) AS edges`,
    params: { nodeTypes, limit, repo: repo ?? null },
  };
};

export const searchNodes = (query: string) => ({
  cypher: `CALL db.index.fulltext.queryNodes("code_search", $query)
           YIELD node, score
           RETURN elementId(node) AS id, labels(node)[0] AS type,
                  node.name AS name, node.qualifiedName AS qualifiedName,
                  score
           ORDER BY score DESC LIMIT 20`,
  params: { query },
});
