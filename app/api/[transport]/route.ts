import { createMcpHandler } from "mcp-handler";
import { registerGetBetaTool } from "@/services/tools/get-beta";
import { registerSearchStockTool } from "@/services/tools/search-stock";

const handler = createMcpHandler(
  (server) => {
    registerGetBetaTool(server);
    registerSearchStockTool(server);
  },
  {},
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: true,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
