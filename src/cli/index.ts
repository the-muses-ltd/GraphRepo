import { Command } from "commander";
import { parseCommand } from "./commands/parse.js";
import { serveCommand } from "./commands/serve.js";
import { vizCommand } from "./commands/viz.js";

const program = new Command()
  .name("graphrepo")
  .description(
    "Neo4j + GraphRAG powered tool for visualizing and querying code repositories"
  )
  .version("0.1.0");

program
  .command("parse <repoPath>")
  .description("Parse a repository and store its structure in Neo4j")
  .option("--neo4j-uri <uri>", "Neo4j URI")
  .option("--neo4j-user <user>", "Neo4j username")
  .option("--neo4j-password <password>", "Neo4j password")
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

program.parse();
