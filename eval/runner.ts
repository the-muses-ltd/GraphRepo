/**
 * RAG evaluation runner.
 *
 * Loads the graph + persisted embeddings from .graphrepo/, runs every strategy
 * from src/graphrag/retrievers over every query in queries.json, prints a
 * comparison table. Optionally writes machine-readable JSON for CI diffing.
 *
 * Usage:
 *   npm run eval
 *   npm run eval -- --repo <path>             (default: cwd)
 *   npm run eval -- --split dev|holdout|all   (default: all)
 *   npm run eval -- --k 10                    (default: 10)
 *   npm run eval -- --json <out>              (write full results to file)
 *   npm run eval -- --strategy <id>           (run a single strategy)
 */

import path from "path";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";

import { loadGraph, getGraphStorePath, getEmbeddingsStorePath } from "../src/graph/persistence.js";
import { EmbeddingService } from "../src/graphrag/embeddings.js";
import { VectorStore } from "../src/graphrag/vector-store.js";
import {
  STRATEGIES,
  DEFAULT_STRATEGY_ID,
  type Retriever,
  type RetrieverContext,
} from "../src/graphrag/retrievers/index.js";
import { aggregate, scoreQuery, type MetricScores } from "./metrics.js";

interface QueryDef {
  id: string;
  query: string;
  category: string;
  split: string;
  relevant: string[];
}

interface QueriesFile {
  description?: string;
  queries: QueryDef[];
}

interface CliArgs {
  repo: string;
  split: "dev" | "holdout" | "all";
  k: number;
  json?: string;
  strategy?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { repo: process.cwd(), split: "all", k: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[++i];
    else if (a === "--split") args.split = argv[++i] as CliArgs["split"];
    else if (a === "--k") args.k = parseInt(argv[++i], 10);
    else if (a === "--json") args.json = argv[++i];
    else if (a === "--strategy") args.strategy = argv[++i];
  }
  return args;
}

function fmt(n: number): string {
  return (n * 100).toFixed(1).padStart(5) + "%";
}

function printTable(
  retrieverName: string,
  overall: MetricScores,
  perCategory: Map<string, MetricScores>,
  k: number,
  isDefault: boolean,
): void {
  const marker = isDefault ? " [DEFAULT]" : "";
  console.log(`\n=== ${retrieverName}${marker} ===`);
  console.log(`  Recall@${k}   MRR      NDCG@${k}  Hit@1    category`);
  console.log(`  ${fmt(overall.recallAtK)}   ${fmt(overall.mrr)}   ${fmt(overall.ndcgAtK)}   ${fmt(overall.hitAtOne)}   OVERALL`);
  for (const cat of [...perCategory.keys()].sort()) {
    const s = perCategory.get(cat)!;
    console.log(`  ${fmt(s.recallAtK)}   ${fmt(s.mrr)}   ${fmt(s.ndcgAtK)}   ${fmt(s.hitAtOne)}   ${cat}`);
  }
}

interface RunResult {
  strategy: { id: string; name: string; isDefault: boolean };
  overall: MetricScores;
  perCategory: Record<string, MetricScores>;
  perQuery: { id: string; query: string; category: string; scores: MetricScores; retrieved: string[] }[];
}

async function runRetriever(
  retriever: Retriever,
  queries: QueryDef[],
  ctx: RetrieverContext,
  k: number,
): Promise<RunResult> {
  const perQuery: RunResult["perQuery"] = [];
  for (const q of queries) {
    const hits = await retriever.retrieve(q.query, k, ctx);
    const retrieved = hits.map((h) => h.id);
    const relevant = new Set(q.relevant);
    perQuery.push({
      id: q.id,
      query: q.query,
      category: q.category,
      scores: scoreQuery(retrieved, relevant, k),
      retrieved,
    });
  }

  const overall = aggregate(perQuery.map((p) => p.scores));
  const byCat = new Map<string, MetricScores[]>();
  for (const p of perQuery) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category)!.push(p.scores);
  }
  const perCategory: Record<string, MetricScores> = {};
  for (const [cat, arr] of byCat) perCategory[cat] = aggregate(arr);

  return {
    strategy: {
      id: retriever.id,
      name: retriever.name,
      isDefault: retriever.id === DEFAULT_STRATEGY_ID,
    },
    overall,
    perCategory,
    perQuery,
  };
}

function printMisses(result: RunResult, queries: QueryDef[], limit = 5): void {
  const byId = new Map(queries.map((q) => [q.id, q]));
  const failures = result.perQuery.filter((p) => p.scores.recallAtK === 0).slice(0, limit);
  if (failures.length === 0) return;
  console.log(`\n  Misses (Recall@10 = 0):`);
  for (const f of failures) {
    const q = byId.get(f.id)!;
    console.log(`    [${f.id}] "${f.query}"`);
    console.log(`      expected: ${q.relevant.join(", ")}`);
    console.log(`      top 3:    ${f.retrieved.slice(0, 3).join(", ") || "(none)"}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const thisFile = fileURLToPath(import.meta.url);
  const queriesPath = path.resolve(path.dirname(thisFile), "queries.json");
  const queriesFile: QueriesFile = JSON.parse(readFileSync(queriesPath, "utf-8"));

  const allQueries = queriesFile.queries;
  const queries =
    args.split === "all" ? allQueries : allQueries.filter((q) => q.split === args.split);

  if (queries.length === 0) {
    console.error(`No queries found for split=${args.split}`);
    process.exit(1);
  }

  console.log(`Loading graph from ${args.repo} ...`);
  const graphFile = getGraphStorePath(args.repo);
  const graph = await loadGraph(graphFile);
  if (!graph) {
    console.error(`No graph at ${graphFile}. Run 'npm run parse -- ${args.repo}' first.`);
    process.exit(1);
  }

  const vectorStore = new VectorStore();
  const embeddingsFile = getEmbeddingsStorePath(args.repo);
  if (!vectorStore.load(embeddingsFile)) {
    console.error(`No embeddings at ${embeddingsFile}. Re-parse to generate.`);
    process.exit(1);
  }
  console.log(`Loaded ${graph.order} nodes, ${graph.size} edges, ${vectorStore.size} vectors.`);

  const modelCacheDir = path.join(args.repo, ".graphrepo", "model-cache");
  const embeddingService = new EmbeddingService(modelCacheDir, () => {});
  const initResult = await embeddingService.initialize();
  if (!initResult.ok) {
    console.error(`Embedding model failed to load: ${initResult.error}`);
    process.exit(1);
  }

  const ctx: RetrieverContext = { graph, vectorStore, embeddingService };

  const strategies: readonly Retriever[] = args.strategy
    ? STRATEGIES.filter((s) => s.id === args.strategy)
    : STRATEGIES;
  if (strategies.length === 0) {
    console.error(`Unknown strategy: ${args.strategy}. Available: ${STRATEGIES.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`\nRunning ${queries.length} queries (split=${args.split}, k=${args.k}) against ${strategies.length} strateg${strategies.length === 1 ? "y" : "ies"}`);

  const results: RunResult[] = [];
  for (const r of strategies) {
    const result = await runRetriever(r, queries, ctx, args.k);
    results.push(result);
    const perCategoryMap = new Map(Object.entries(result.perCategory));
    printTable(result.strategy.name, result.overall, perCategoryMap, args.k, result.strategy.isDefault);
    printMisses(result, queries);
  }

  // Summary table: which strategy wins on each metric
  if (results.length > 1) {
    const metrics: (keyof MetricScores)[] = ["recallAtK", "mrr", "ndcgAtK", "hitAtOne"];
    console.log(`\n--- Summary (overall, best per metric) ---`);
    for (const m of metrics) {
      const best = results.reduce((a, b) => (b.overall[m] > a.overall[m] ? b : a));
      console.log(`  ${m.padEnd(10)}: ${(best.overall[m] * 100).toFixed(1).padStart(5)}%  ${best.strategy.id}`);
    }
    const defaultResult = results.find((r) => r.strategy.isDefault);
    if (defaultResult) {
      const beatsDefault = results.filter(
        (r) => !r.strategy.isDefault && r.overall.recallAtK > defaultResult.overall.recallAtK,
      );
      if (beatsDefault.length > 0) {
        console.log(
          `\n  ⚠  ${beatsDefault.map((r) => r.strategy.id).join(", ")} beat the default (${defaultResult.strategy.id}) on Recall@${args.k}.`,
        );
        console.log(`     Update DEFAULT_STRATEGY_ID in src/graphrag/retrievers/index.ts and RAG_PLAN.md.`);
      }
    }
  }

  if (args.json) {
    const outDir = path.dirname(args.json);
    if (outDir) mkdirSync(outDir, { recursive: true });
    writeFileSync(
      args.json,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          k: args.k,
          split: args.split,
          queryCount: queries.length,
          defaultStrategyId: DEFAULT_STRATEGY_ID,
          results,
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`\nWrote results to ${args.json}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
