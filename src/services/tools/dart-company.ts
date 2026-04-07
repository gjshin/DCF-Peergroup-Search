import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getCompanyInfo } from "../common/stock-code-resolver";
import { handleApiError } from "../utils/error-handler";

const DartCompanyInputSchema = z.object({
  stock_code: z.string()
    .min(1)
    .max(10)
    .describe("종목코드 6자리 (예: '005930')"),
  response_format: z.enum(["markdown", "json"])
    .default("markdown")
    .describe("출력 형식"),
  api_key: z.string().optional()
    .describe("OpenDART API 키 (미입력 시 서버 환경변수 사용)"),
}).strict();

type DartCompanyInput = z.infer<typeof DartCompanyInputSchema>;

export function registerDartCompanyTool(server: McpServer): void {
  server.registerTool(
    "dart_get_company",
    {
      title: "DART 기업정보 조회",
      description: `OpenDART에서 기업 기본정보를 조회합니다. 종목코드(6자리)로 DART corp_code 매핑 및 기업개황을 반환합니다.

Args:
  - stock_code (string): 종목코드 6자리 (예: '005930')
  - response_format ('markdown' | 'json'): 출력 형식 (기본: markdown)

Examples:
  - 삼성전자 기업정보: stock_code="005930"`,
      inputSchema: DartCompanyInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: DartCompanyInput) => {
      try {
        const info = await getCompanyInfo(params.stock_code, params.api_key);

        if (params.response_format === "json") {
          return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
        }

        const lines = [
          `## ${info.corp_name} (${info.stock_code})`,
          `- **영문명**: ${info.corp_name_eng}`,
          `- **DART 고유번호**: ${info.corp_code}`,
          `- **대표이사**: ${info.ceo_nm}`,
          `- **법인구분**: ${info.corp_cls === "Y" ? "유가증권" : info.corp_cls === "K" ? "코스닥" : info.corp_cls}`,
          `- **업종코드**: ${info.induty_code}`,
          `- **설립일**: ${info.est_dt}`,
          `- **결산월**: ${info.acc_mt}월`,
        ];

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }], isError: true };
      }
    }
  );
}
