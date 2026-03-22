import { loadConfig } from "../../config.js";
import { startMcpServer } from "../../mcp/index.js";

export const serveCommand = async (): Promise<void> => {
  // Use current working directory so repo name is derived correctly
  const config = loadConfig(process.cwd());
  await startMcpServer(config);
};
