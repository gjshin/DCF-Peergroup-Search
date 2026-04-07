import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchBusinessContent } from "../opendart/document-parser";
import { resolveCorpCode } from "../common/stock-code-resolver";

const BusinessContentInputSchema = z.object({
  stock_code: z.string().describe("종목코드 6자리 (예: 005930)"),
  year: z.string().describe("대상 사업연도 (예: 2024)")
});

export function registerBusinessContentTool(server: McpServer): void {
  server.registerTool(
    "get_business_content",
    {
      title: "사업보고서 제품/서비스 원문 추출",
      description: `특정 기업의 사업보고서 원본에서 "II. 사업의 내용 / 주요 제품 및 서비스" 섹션의 텍스트와 표(Markdown)를 추출합니다.
이 도구는 기업이 무엇을 통해 돈을 버는지, 어떤 제품의 매출 비중이 높은지 분석해야 할 때 사용합니다.
(주의점: 텍스트 정보가 긴 편이므로 전체 재무 지표를 뽑는 valuation_get_data 툴과 혼합 사용은 지양하고 필요할 때만 단독 호출하세요.)`,
      inputSchema: BusinessContentInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: z.infer<typeof BusinessContentInputSchema>) => {
      try {
        const corpCode = await resolveCorpCode(params.stock_code);
        if (!corpCode) {
             return { content: [{ type: "text" as const, text: "해당 종목을 찾을 수 없거나 DART 고유번호 매핑에 실패했습니다." }] };
        }
        
        const markdown = await fetchBusinessContent(corpCode, params.year);
        return { content: [{ type: "text" as const, text: markdown }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: `Data Fetch Error: ${error.message}` }], isError: true };
      }
    }
  );
}
