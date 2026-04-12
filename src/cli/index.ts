import { Command } from "commander";
import { parseCommand } from "./commands/parse.js";
import { serveCommand } from "./commands/serve.js";
import { vizCommand } from "./commands/viz.js";
import { communitiesCommand } from "./commands/communities.js";

const program = new Command()
  .name("graphrepo")
  .description(
    "GraphRAG-powered tool for visualizing and querying code repositories"
  )
  .version("0.2.0");

program
  .command("parse <repoPath>")
  .description("Parse a repository and store its graph in .graphrepo/")
  .option("--clear", "Clear existing graph before parsing", false)
  .action(parseCommand);

program
  .command("serve")
  .description("Start the MCP server for Claude")
  .action(serveCommand);

program
  .command("viz")
  .description("Start the web visualization server")
  .option("-p, --port <port>", "Port number", "3000")
  .action(vizCommand);

program
  .command("communities [repoPath]")
  .description("Detect code communities using Louvain algorithm")
  .action(communitiesCommand);

program.parse();
