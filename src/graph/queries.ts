export const searchByName = (pattern: string, type: string, limit: number) => ({
  cypher:
    type === "all"
      ? `CALL db.index.fulltext.queryNodes("code_search", $pattern)
         YIELD node, score
         RETURN labels(node)[0] AS type, node.name AS name,
                node.qualifiedName AS qualifiedName, score
         ORDER BY score DESC LIMIT toInteger($limit)`
      : `CALL db.index.fulltext.queryNodes("code_search", $pattern)
         YIELD node, score
         WHERE $type IN labels(node)
         RETURN labels(node)[0] AS type, node.name AS name,
                node.qualifiedName AS qualifiedName, score
         ORDER BY score DESC LIMIT toInteger($limit)`,
  params: {
    pattern,
    type: type.charAt(0).toUpperCase() + type.slice(1),
    limit: Number(limit),
  },
});

export const getDependencies = (filePath: string, depth: number) => ({
  cypher:
    depth <= 1
      ? `MATCH (f:File {path: $path})-[:IMPORTS]->(dep:File)
         RETURN dep.path AS path, dep.language AS language`
      : `MATCH path = (f:File {path: $path})-[:IMPORTS*1..${depth}]->(dep:File)
         RETURN DISTINCT dep.path AS path, dep.language AS language,
                length(path) AS depth
         ORDER BY depth`,
  params: { path: filePath },
});

export const getDependents = (filePath: string, depth: number) => ({
  cypher:
    depth <= 1
      ? `MATCH (f:File)-[:IMPORTS]->(target:File {path: $path})
         RETURN f.path AS path, f.language AS language`
      : `MATCH path = (f:File)-[:IMPORTS*1..${depth}]->(target:File {path: $path})
         RETURN DISTINCT f.path AS path, f.language AS language,
                length(path) AS depth
         ORDER BY depth`,
  params: { path: filePath },
});

export const getFileStructure = (filePath: string) => ({
  cypher: `MATCH (f:File {path: $path})
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
  params: { path: filePath },
});

export const getCallGraph = (
  functionName: string,
  depth: number,
  direction: string
) => {
  const dirFilter =
    direction === "callers"
      ? "<-[:CALLS*1.." + depth + "]-"
      : direction === "callees"
        ? "-[:CALLS*1.." + depth + "]->"
        : "-[:CALLS*1.." + depth + "]-";

  return {
    cypher: `MATCH (f:Function)
             WHERE f.name = $name OR f.qualifiedName = $name
             WITH f LIMIT 1
             MATCH path = (f)${dirFilter}(other:Function)
             UNWIND relationships(path) AS rel
             WITH startNode(rel) AS caller, endNode(rel) AS callee
             RETURN DISTINCT caller.qualifiedName AS caller,
                    callee.qualifiedName AS callee`,
    params: { name: functionName },
  };
};

export const findRelated = (entityName: string, maxHops: number) => ({
  cypher: `MATCH (n)
           WHERE n.name = $name OR n.qualifiedName = $name
           WITH n LIMIT 1
           MATCH path = (n)-[*1..${maxHops}]-(related)
           RETURN DISTINCT labels(related)[0] AS type,
                  related.name AS name,
                  related.qualifiedName AS qualifiedName,
                  length(path) AS distance
           ORDER BY distance, name
           LIMIT 50`,
  params: { name: entityName },
});

export const getRepoSummary = () => ({
  cypher: `MATCH (f:File)
           WITH count(f) AS fileCount,
                collect(DISTINCT f.language) AS languages,
                sum(f.lineCount) AS totalLines
           OPTIONAL MATCH (fn:Function)
           WITH fileCount, languages, totalLines, count(fn) AS funcCount
           OPTIONAL MATCH (c:Class)
           WITH fileCount, languages, totalLines, funcCount, count(c) AS classCount
           OPTIONAL MATCH (i:Interface)
           WITH fileCount, languages, totalLines, funcCount, classCount, count(i) AS interfaceCount
           OPTIONAL MATCH ()-[r:IMPORTS]->()
           WITH fileCount, languages, totalLines, funcCount, classCount, interfaceCount, count(r) AS importCount
           OPTIONAL MATCH ()-[c:CALLS]->()
           RETURN fileCount, languages, totalLines, funcCount,
                  classCount, interfaceCount, importCount, count(c) AS callCount`,
  params: {},
});

export const getGraphData = (
  nodeTypes: string[] | null,
  limit: number
) => {
  const nodeFilter = nodeTypes
    ? `WHERE any(label IN labels(n) WHERE label IN $nodeTypes) AND NOT n:Community`
    : `WHERE NOT n:Community`;

  return {
    cypher: `MATCH (n)
       ${nodeFilter}
       WITH n LIMIT toInteger($limit)
       OPTIONAL MATCH (n)-[:BELONGS_TO_COMMUNITY]->(c:Community {level: 1})
       WITH n, c.id AS communityId
       OPTIONAL MATCH (n)-[r]-(m)
       WHERE NOT m:Community
       ${nodeTypes ? `AND any(label IN labels(m) WHERE label IN $nodeTypes)` : ""}
       RETURN collect(DISTINCT {
         id: elementId(n), labels: labels(n), name: n.name,
         qualifiedName: n.qualifiedName, path: n.path,
         language: n.language, lineCount: n.lineCount,
         startLine: n.startLine, kind: n.kind,
         communityId: communityId
       }) AS nodes,
       collect(DISTINCT {
         source: elementId(startNode(r)), target: elementId(endNode(r)),
         type: type(r)
       }) AS edges`,
    params: { nodeTypes, limit },
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
