import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import { API_BASE_URL, ENDPOINTS, COUNTRY_CODE } from "../constants";
import { getSessionCookie } from "../auth";
import { handleApiError } from "../utils/error-handler";

const SearchStockInputSchema = z.object({
  query: z.string()
    .min(1, "검색어를 입력해주세요")
    .max(100, "검색어가 너무 깁니다")
    .describe("종목명 또는 종목코드 (예: '삼성전자', '005930', 'AAPL')"),
  country: z.enum(["KR", "US"])
    .default("KR")
    .describe("국가: KR(국내, 기본값) 또는 US(미국)"),
  response_format: z.enum(["markdown", "json"])
    .default("markdown")
    .describe("출력 형식: markdown 또는 json"),
}).strict();

type SearchStockInput = z.infer<typeof SearchStockInputSchema>;

export function registerSearchStockTool(server: McpServer): void {
  server.registerTool(
    "kicpa_search_stock",
    {
      title: "KICPA 종목코드 검색",
      description: `종목명 또는 종목코드로 KICPA 시스템에 등록된 종목을 검색합니다.

kicpa_get_beta 도구에서 사용할 종목코드를 찾을 때 유용합니다.

Args:
  - query (string): 종목명 또는 종목코드 (예: '삼성전자', 'AAPL')
  - country ('KR' | 'US'): 국가 (기본: KR)
  - response_format ('markdown' | 'json'): 출력 형식 (기본: markdown)

Examples:
  - 삼성 관련 종목 검색: query="삼성"
  - 미국 Apple 검색: query="AAPL", country="US"`,
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
        const sessionId = await getSessionCookie();
        const gubun = COUNTRY_CODE[params.country];

        const response = await axios.get(
          `${API_BASE_URL}${ENDPOINTS.SEARCH_STOCK}`,
          {
            params: {
              gubun,
              type: "1",
              query: params.query,
            },
            headers: {
              "Cookie": `JSESSIONID=${sessionId}`,
            },
            timeout: 15000,
          }
        );

        const html = response.data as string;
        const stocks = parseSearchResults(html);

        if (stocks.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `'${params.query}'에 대한 검색 결과가 없습니다.`,
            }],
          };
        }

        let text: string;
        if (params.response_format === "json") {
          text = JSON.stringify(stocks, null, 2);
        } else {
          const lines = [`## 종목 검색 결과: '${params.query}'`, "", `총 ${stocks.length}건`, ""];
          lines.push("| 종목코드 | 종목명 |");
          lines.push("|---------|--------|");
          for (const s of stocks) {
            lines.push(`| ${s.code} | ${s.name} |`);
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

function parseSearchResults(html: string): Array<{ code: string; name: string }> {
  const results: Array<{ code: string; name: string }> = [];

  const selectPattern = /selectCode\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/g;
  let match;
  while ((match = selectPattern.exec(html)) !== null) {
    results.push({ code: match[1], name: match[2] });
  }

  if (results.length === 0) {
    const tdPattern = /<td[^>]*>([^<]+)<\/td>/g;
    const values: string[] = [];
    while ((match = tdPattern.exec(html)) !== null) {
      values.push(match[1].trim());
    }
    for (let i = 0; i + 1 < values.length; i += 2) {
      if (values[i].match(/^[A-Z0-9]{2,10}$/)) {
        results.push({ code: values[i], name: values[i + 1] });
      }
    }
  }

  return results;
}
