import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveCorpCode } from "../common/stock-code-resolver";
import { fetchFinancials, fetchStockQuantity, extractSharesInfo, extractDebtSummary, extractValuationFinancials } from "../opendart/client";
import { REPORT_CODE } from "../opendart/constants";
import { handleApiError } from "../utils/error-handler";
import { formatFinancialsTable } from "../utils/formatters";

const DartFinancialsInputSchema = z.object({
  stock_code: z.string().min(1).max(10).describe("종목코드 6자리 (예: '005930')"),
  year: z.string().regex(/^\d{4}$/, "연도는 YYYY 형식").describe("사업연도 (예: '2024')"),
  report_type: z.enum(["annual", "semi", "q1", "q3"])
    .default("annual")
    .describe("보고서 유형: annual(사업보고서), semi(반기), q1(1분기), q3(3분기)"),
  fs_type: z.enum(["CFS", "OFS"])
    .default("CFS")
    .describe("재무제표 유형: CFS(연결), OFS(개별)"),
  detail_level: z.enum(["valuation", "full"])
    .default("valuation")
    .describe("상세도: valuation(밸류에이션 필수 계정만, 기본값), full(전체 재무제표)"),
  response_format: z.enum(["markdown", "json", "table"])
    .default("markdown")
    .describe("출력 형식: markdown, json, table(TSV, 엑셀 붙여넣기용)"),
  api_key: z.string().optional()
    .describe("OpenDART API 키 (미입력 시 서버 환경변수 사용)"),
}).strict();

type DartFinancialsInput = z.infer<typeof DartFinancialsInputSchema>;

export function registerDartFinancialsTool(server: McpServer): void {
  server.registerTool(
    "dart_get_financials",
    {
      title: "DART 재무제표 조회",
      description: `OpenDART에서 재무제표를 조회합니다.

기본 모드(valuation): 밸류에이션 필수 데이터만 반환 (이자부부채, 비지배지분, 세전이익, 주식수)
전체 모드(full): 모든 계정과목 반환

이자부부채는 유동/비유동으로 자동 분류됩니다:
- 유동: 단기차입금, 유동성장기부채, 유동리스부채
- 비유동: 장기차입금, 사채, 전환사채, 신주인수권부사채, 교환사채, 비유동리스부채

Args:
  - stock_code: 종목코드 6자리
  - year: 사업연도 YYYY
  - report_type: annual/semi/q1/q3
  - fs_type: CFS(연결)/OFS(개별)
  - detail_level: valuation(기본, 경량)/full(전체)
  - response_format: markdown/json/table(TSV)

[Peer 워크플로우 주의]
Peer Group 밸류에이션에 필요한 이자부부채/비지배지분/세전이익/주식수만 필요하다면, 분기말 일자에 한해 valuation_get_data 가 캐시 기반으로 훨씬 빠릅니다. 이 도구는 ① 전체 계정 필요(detail_level=full), ② 분기/반기 보고서(report_type=semi/q1/q3), ③ 개별(OFS) 재무제표, ④ 임의 사업연도(2024 이전 등) 같은 경우에 사용하세요. 상세는 docs/PEER_GROUP_WORKFLOW.md 참조.`,
      inputSchema: DartFinancialsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: DartFinancialsInput) => {
      try {
        const corpCode = await resolveCorpCode(params.stock_code);
        const reportCode = REPORT_CODE[params.report_type];

        const [financials, stockQty] = await Promise.all([
          fetchFinancials(corpCode, params.year, reportCode, params.fs_type, params.api_key),
          fetchStockQuantity(corpCode, params.year, reportCode, params.api_key),
        ]);

        if (financials.length === 0) {
          return { content: [{ type: "text" as const, text: `${params.year}년 ${params.report_type} 재무제표 데이터가 없습니다.` }] };
        }

        const sharesInfo = extractSharesInfo(stockQty, params.year, reportCode);

        // valuation 모드: 필수 계정만 반환
        if (params.detail_level === "valuation") {
          const valuation = extractValuationFinancials(financials);

          if (params.response_format === "table") {
            const rows: string[] = [];
            rows.push(["구분", "계정명", "당기금액", "전기금액"].join("\t"));
            for (const item of valuation.filteredItems) {
              rows.push([item.sjDiv, item.account, item.currentAmount ?? "", item.previousAmount ?? ""].join("\t"));
            }
            rows.push("");
            rows.push(["", "이자부부채(유동) 합계", String(valuation.debt.current.total), ""].join("\t"));
            rows.push(["", "이자부부채(비유동) 합계", String(valuation.debt.nonCurrent.total), ""].join("\t"));
            rows.push(["", "이자부부채 합계", String(valuation.debt.interestBearingDebt), ""].join("\t"));
            if (valuation.debt.nonControllingInterest !== null) {
              rows.push(["", "비지배지분", String(valuation.debt.nonControllingInterest), ""].join("\t"));
            }
            if (valuation.debt.pretaxIncome !== null) {
              rows.push(["", "세전이익", String(valuation.debt.pretaxIncome), ""].join("\t"));
            }
            if (sharesInfo) {
              rows.push(["", "발행주식총수", String(sharesInfo.totalIssued), ""].join("\t"));
              rows.push(["", "자기주식", String(sharesInfo.treasuryStock), ""].join("\t"));
              rows.push(["", "유통주식수", String(sharesInfo.outstanding), ""].join("\t"));
            }
            return { content: [{ type: "text" as const, text: rows.join("\n") }] };
          }

          if (params.response_format === "json") {
            return { content: [{ type: "text" as const, text: JSON.stringify({ ...valuation, sharesInfo }, null, 2) }] };
          }

          // markdown
          return { content: [{ type: "text" as const, text: formatValuationMarkdown(valuation, sharesInfo, params.year, params.report_type, params.fs_type) }] };
        }

        // full 모드: 전체 재무제표
        const debtSummary = extractDebtSummary(financials);

        if (params.response_format === "table") {
          const items = financials.map((f) => ({
            category: f.sj_nm,
            sjDiv: f.sj_div,
            account: f.account_nm,
            currentAmount: f.thstrm_amount,
            previousAmount: f.frmtrm_amount,
          }));
          return { content: [{ type: "text" as const, text: formatFinancialsTable(items) }] };
        }

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

        // full markdown
        return { content: [{ type: "text" as const, text: formatFullMarkdown(financials, debtSummary, sharesInfo, params.year, params.report_type, params.fs_type) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }], isError: true };
      }
    }
  );
}

function formatValuationMarkdown(
  valuation: ReturnType<typeof extractValuationFinancials>,
  sharesInfo: ReturnType<typeof extractSharesInfo>,
  year: string, reportType: string, fsType: string
): string {
  const lines: string[] = [];
  lines.push(`## 밸류에이션 재무데이터 (${year}년 ${reportType}, ${fsType})`);
  lines.push("");

  // IBD 유동
  if (valuation.debt.current.items.length > 0) {
    lines.push("### 이자부부채 (유동)");
    for (const d of valuation.debt.current.items) {
      lines.push(`- ${d.account}: ${d.amount.toLocaleString()}원`);
    }
    lines.push(`- **소계**: ${valuation.debt.current.total.toLocaleString()}원`);
    lines.push("");
  }

  // IBD 비유동
  if (valuation.debt.nonCurrent.items.length > 0) {
    lines.push("### 이자부부채 (비유동)");
    for (const d of valuation.debt.nonCurrent.items) {
      lines.push(`- ${d.account}: ${d.amount.toLocaleString()}원`);
    }
    lines.push(`- **소계**: ${valuation.debt.nonCurrent.total.toLocaleString()}원`);
    lines.push("");
  }

  lines.push(`**이자부부채 합계**: ${valuation.debt.interestBearingDebt.toLocaleString()}원`);

  if (valuation.debt.nonControllingInterest !== null) {
    lines.push(`**비지배지분**: ${valuation.debt.nonControllingInterest.toLocaleString()}원`);
  }
  if (valuation.debt.pretaxIncome !== null) {
    lines.push(`**세전이익**: ${valuation.debt.pretaxIncome.toLocaleString()}원`);
  }
  lines.push("");

  if (sharesInfo) {
    lines.push("### 주식의 총수");
    lines.push(`- 발행주식총수: ${sharesInfo.totalIssued.toLocaleString()}주`);
    lines.push(`- 자기주식수: ${sharesInfo.treasuryStock.toLocaleString()}주`);
    lines.push(`- **유통주식수**: ${sharesInfo.outstanding.toLocaleString()}주`);
  }

  return lines.join("\n");
}

function formatFullMarkdown(
  financials: Array<{ sj_div: string; sj_nm: string; account_nm: string; thstrm_amount: string; frmtrm_amount: string }>,
  debtSummary: ReturnType<typeof extractDebtSummary>,
  sharesInfo: ReturnType<typeof extractSharesInfo>,
  year: string, reportType: string, fsType: string
): string {
  const lines: string[] = [];
  lines.push(`## 재무제표 (${year}년 ${reportType}, ${fsType})`);
  lines.push("");

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

  lines.push("### 이자부부채 요약");
  lines.push(`**합계**: ${debtSummary.interestBearingDebt.toLocaleString()}원`);
  for (const d of debtSummary.current.items) lines.push(`- [유동] ${d.account}: ${d.amount.toLocaleString()}원`);
  for (const d of debtSummary.nonCurrent.items) lines.push(`- [비유동] ${d.account}: ${d.amount.toLocaleString()}원`);
  if (debtSummary.nonControllingInterest !== null) lines.push(`\n**비지배지분**: ${debtSummary.nonControllingInterest.toLocaleString()}원`);
  if (debtSummary.pretaxIncome !== null) lines.push(`**세전이익**: ${debtSummary.pretaxIncome.toLocaleString()}원`);
  lines.push("");

  if (sharesInfo) {
    lines.push("### 주식의 총수");
    lines.push(`- 발행주식총수: ${sharesInfo.totalIssued.toLocaleString()}주`);
    lines.push(`- 자기주식수: ${sharesInfo.treasuryStock.toLocaleString()}주`);
    lines.push(`- **유통주식수**: ${sharesInfo.outstanding.toLocaleString()}주`);
  }

  return lines.join("\n");
}
