import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchMarketData } from "../naver/client";
import { handleApiError } from "../utils/error-handler";

const NaverMarketDataInputSchema = z.object({
  stock_code: z.string().min(1).max(10).describe("종목코드 6자리 (예: '005930')"),
  response_format: z.enum(["markdown", "json"])
    .default("markdown")
    .describe("출력 형식"),
}).strict();

type NaverMarketDataInput = z.infer<typeof NaverMarketDataInputSchema>;

export function registerNaverMarketDataTool(server: McpServer): void {
  server.registerTool(
    "naver_get_market_data",
    {
      title: "네이버 금융 시장데이터 조회",
      description: `네이버 금융에서 주가, 시가총액, PER, PBR, 업종분류, 동종업종 기업을 조회합니다.

Args:
  - stock_code (string): 종목코드 6자리
  - response_format ('markdown' | 'json'): 출력 형식

Examples:
  - 삼성전자 시장데이터: stock_code="005930"`,
      inputSchema: NaverMarketDataInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: NaverMarketDataInput) => {
      try {
        const data = await fetchMarketData(params.stock_code);

        if (params.response_format === "json") {
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        const lines = [
          `## ${data.stockName} (${data.stockCode}) 시장데이터`,
          "",
          `| 항목 | 값 |`,
          `|------|-----|`,
          `| 종가 | ${data.price?.toLocaleString() ?? "-"}원 |`,
          `| 시가총액 | ${data.marketCap ?? "-"} |`,
          `| PER | ${data.per ?? "-"}배 |`,
          `| PBR | ${data.pbr ?? "-"}배 |`,
          `| EPS | ${data.eps?.toLocaleString() ?? "-"}원 |`,
          `| BPS | ${data.bps?.toLocaleString() ?? "-"}원 |`,
          `| 배당수익률 | ${data.dividendYield ?? "-"}% |`,
          `| 외인소진율 | ${data.foreignRate ?? "-"} |`,
          `| 컨센서스 목표가 | ${data.consensusTargetPrice ?? "-"}원 |`,
          "",
        ];

        if (data.peers.length > 0) {
          lines.push("### 동종업종 기업");
          lines.push("| 종목코드 | 종목명 | 시가총액 |");
          lines.push("|---------|--------|---------|");
          for (const peer of data.peers) {
            lines.push(`| ${peer.code} | ${peer.name} | ${peer.marketCap} |`);
          }
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }], isError: true };
      }
    }
  );
}
