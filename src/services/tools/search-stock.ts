import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { handleApiError } from "../utils/error-handler";

const SearchStockInputSchema = z.object({
  query: z.string()
    .min(1, "검색어를 입력해주세요")
    .max(100, "검색어가 너무 깁니다")
    .describe("종목명 또는 종목코드 (예: '삼성전자', '005930', '삼성')"),
  response_format: z.enum(["markdown", "json"])
    .default("markdown")
    .describe("출력 형식: markdown 또는 json"),
}).strict();

type SearchStockInput = z.infer<typeof SearchStockInputSchema>;

interface NaverStockItem {
  code: string;
  name: string;
  typeCode: string;
  typeName: string;
  nationCode: string;
  nationName: string;
  category: string;
}

export function registerSearchStockTool(server: McpServer): void {
  server.registerTool(
    "search_stock",
    {
      title: "종목코드 검색",
      description: `종목명 또는 종목코드로 한국 주식 종목을 검색합니다. (네이버 금융 자동완성 API)

다른 도구(kicpa_get_beta, dart_get_financials, naver_get_market_data 등)에서 사용할 종목코드를 찾을 때 유용합니다.

Args:
  - query (string): 종목명 또는 종목코드 (예: '삼성전자', '삼성', '005930')
  - response_format ('markdown' | 'json'): 출력 형식 (기본: markdown)

Examples:
  - 삼성 관련 종목 검색: query="삼성"
  - 현대차 검색: query="현대차"
  - 코드로 검색: query="005930"`,
      inputSchema: SearchStockInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: SearchStockInput) => {
      try {
        const response = await axios.get<{ query: string; items: NaverStockItem[] }>(
          "https://ac.stock.naver.com/ac",
          {
            params: {
              q: params.query,
              target: "stock",
            },
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; ValuationMCP/1.0)",
            },
            timeout: 10000,
          }
        );

        const items = response.data.items ?? [];

        if (items.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `'${params.query}'에 대한 검색 결과가 없습니다.`,
            }],
          };
        }

        const stocks = items.map((item) => ({
          code: item.code,
          name: item.name,
          market: item.typeName,
          country: item.nationName,
        }));

        let text: string;
        if (params.response_format === "json") {
          text = JSON.stringify(stocks, null, 2);
        } else {
          const lines = [`## 종목 검색 결과: '${params.query}'`, "", `총 ${stocks.length}건`, ""];
          lines.push("| 종목코드 | 종목명 | 시장 |");
          lines.push("|---------|--------|------|");
          for (const s of stocks) {
            lines.push(`| ${s.code} | ${s.name} | ${s.market} |`);
          }
          text = lines.join("\n");
        }

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: handleApiError(error) }],
          isError: true,
        };
      }
    }
  );
}
