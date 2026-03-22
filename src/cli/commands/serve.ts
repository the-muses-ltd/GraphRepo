import { loadConfig } from "../../config.js";
import { startMcpServer } from "../../mcp/index.js";

export const serveCommand = async (): Promise<void> => {
  // MCP server uses a dummy repo path since it only queries existing graph
  const config = loadConfig(".");
  await startMcpServer(config);
};
