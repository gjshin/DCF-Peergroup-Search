import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveCorpCode } from "../common/stock-code-resolver";
import { fetchFinancials, fetchStockQuantity, extractSharesInfo, extractDebtSummary } from "../opendart/client";
import { REPORT_CODE } from "../opendart/constants";
import { handleApiError } from "../utils/error-handler";

const DartFinancialsInputSchema = z.object({
  stock_code: z.string().min(1).max(10).describe("종목코드 6자리 (예: '005930')"),
  year: z.string().regex(/^\d{4}$/, "연도는 YYYY 형식").describe("사업연도 (예: '2024')"),
  report_type: z.enum(["annual", "semi", "q1", "q3"])
    .default("annual")
    .describe("보고서 유형: annual(사업보고서), semi(반기), q1(1분기), q3(3분기)"),
  fs_type: z.enum(["CFS", "OFS"])
    .default("CFS")
    .describe("재무제표 유형: CFS(연결), OFS(개별)"),
  response_format: z.enum(["markdown", "json"])
    .default("markdown")
    .describe("출력 형식"),
}).strict();

type DartFinancialsInput = z.infer<typeof DartFinancialsInputSchema>;

export function registerDartFinancialsTool(server: McpServer): void {
  server.registerTool(
    "dart_get_financials",
    {
      title: "DART 재무제표 조회",
      description: `OpenDART에서 재무제표를 조회합니다. 이자부부채(차입금, 사채, 전환사채 등)와 비지배지분을 자동으로 태깅합니다.
주식의 총수 현황(발행주식총수, 자기주식수, 유통주식수)도 함께 조회합니다.

Args:
  - stock_code (string): 종목코드 6자리
  - year (string): 사업연도 YYYY
  - report_type: annual(사업보고서)/semi(반기)/q1/q3
  - fs_type: CFS(연결)/OFS(개별)
  - response_format: markdown/json

Examples:
  - 삼성전자 2024년 연결 재무제표: stock_code="005930", year="2024"
  - 삼성전자 2024년 개별 재무제표: stock_code="005930", year="2024", fs_type="OFS"`,
      inputSchema: DartFinancialsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: DartFinancialsInput) => {
      try {
        const corpCode = await resolveCorpCode(params.stock_code);
        const reportCode = REPORT_CODE[params.report_type];

        // 재무제표 + 주식수 병렬 조회
        const [financials, stockQty] = await Promise.all([
          fetchFinancials(corpCode, params.year, reportCode, params.fs_type),
          fetchStockQuantity(corpCode, params.year, reportCode),
        ]);

        if (financials.length === 0) {
          return { content: [{ type: "text" as const, text: `${params.year}년 ${params.report_type} 재무제표 데이터가 없습니다.` }] };
        }

        const debtSummary = extractDebtSummary(financials);
        const sharesInfo = extractSharesInfo(stockQty, params.year, reportCode);

        if (params.response_format === "json") {
          const output = {
            financials: financials.map((f) => ({
              category: f.sj_nm,
              account: f.account_nm,
              currentAmount: f.thstrm_amount,
              previousAmount: f.frmtrm_amount,
              beforePreviousAmount: f.bfefrmtrm_amount ?? null,
            })),
            debtSummary,
            sharesInfo,
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
        }

        // Markdown 포맷
        const lines: string[] = [];
        lines.push(`## 재무제표 (${params.year}년 ${params.report_type}, ${params.fs_type})`);
        lines.push("");

        // 재무상태표
        const bsItems = financials.filter((f) => f.sj_div === "BS");
        if (bsItems.length > 0) {
          lines.push("### 재무상태표");
          lines.push("| 계정명 | 당기금액 | 전기금액 |");
          lines.push("|--------|---------|---------|");
          for (const item of bsItems) {
            lines.push(`| ${item.account_nm} | ${item.thstrm_amount ?? "-"} | ${item.frmtrm_amount ?? "-"} |`);
          }
          lines.push("");
        }

        // 손익계산서
        const isItems = financials.filter((f) => f.sj_div === "IS" || f.sj_div === "CIS");
        if (isItems.length > 0) {
          lines.push("### 손익계산서");
          lines.push("| 계정명 | 당기금액 | 전기금액 |");
          lines.push("|--------|---------|---------|");
          for (const item of isItems) {
            lines.push(`| ${item.account_nm} | ${item.thstrm_amount ?? "-"} | ${item.frmtrm_amount ?? "-"} |`);
          }
          lines.push("");
        }

        // 이자부부채 요약
        lines.push("### 이자부부채 요약");
        if (debtSummary.details.length > 0) {
          lines.push(`**이자부부채 합계**: ${debtSummary.interestBearingDebt.toLocaleString()}원`);
          for (const d of debtSummary.details) {
            lines.push(`- ${d.account}: ${d.amount.toLocaleString()}원`);
          }
        } else {
          lines.push("이자부부채 항목이 없습니다.");
        }

        if (debtSummary.nonControllingInterest !== null) {
          lines.push(`\n**비지배지분**: ${debtSummary.nonControllingInterest.toLocaleString()}원`);
        }
        lines.push("");

        // 주식수 정보
        if (sharesInfo) {
          lines.push("### 주식의 총수 현황");
          lines.push(`- **발행주식총수**: ${sharesInfo.totalIssued.toLocaleString()}주`);
          lines.push(`- **자기주식수**: ${sharesInfo.treasuryStock.toLocaleString()}주`);
          lines.push(`- **유통주식수**: ${sharesInfo.outstanding.toLocaleString()}주`);
          lines.push(`- **종류**: ${sharesInfo.stockType}`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }], isError: true };
      }
    }
  );
}
