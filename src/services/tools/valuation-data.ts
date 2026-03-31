import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchBetaData } from "../kicpa/client";
import { resolveCorpCode, getCompanyInfo } from "../common/stock-code-resolver";
import { fetchFinancials, fetchStockQuantity, extractSharesInfo, extractDebtSummary } from "../opendart/client";
import { REPORT_CODE } from "../opendart/constants";
import { fetchMarketData } from "../naver/client";
import { handleApiError } from "../utils/error-handler";
import { formatValuationTable } from "../utils/formatters";
import type { DebtSummary, SharesInfo } from "../opendart/types";

const ValuationDataInputSchema = z.object({
  stock_code: z.string().min(1).max(10).describe("종목코드 6자리 (예: '005930')"),
  year: z.string().regex(/^\d{4}$/).optional().describe("재무제표 사업연도 (기본: 전년도)"),
  response_format: z.enum(["markdown", "json", "table"]).default("json").describe("출력 형식: markdown, json, table(TSV, 엑셀용)"),
}).strict();

type ValuationDataInput = z.infer<typeof ValuationDataInputSchema>;

export function registerValuationDataTool(server: McpServer): void {
  server.registerTool(
    "valuation_get_data",
    {
      title: "밸류에이션 통합 데이터 조회",
      description: `한국기업 밸류에이션에 필요한 핵심 데이터를 한번에 조회합니다.
KICPA(베타) + OpenDART(재무/주식수) + 네이버금융(종가)을 병렬 호출합니다.

반환 데이터:
- 베타계수 Weekly/Monthly (1Y/2Y/3Y/5Y, 실질/조정)
- 종가, 시가총액(유통주식수×종가)
- 발행주식총수, 자기주식수, 유통주식수
- 이자부부채 (유동/비유동 분류)
- 비지배지분, 세전이익

Args:
  - stock_code: 종목코드 6자리
  - year: 재무제표 사업연도 (기본: 전년도)
  - response_format: markdown/json/table(TSV)`,
      inputSchema: ValuationDataInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ValuationDataInput) => {
      const year = params.year ?? String(new Date().getFullYear() - 1);
      const today = formatDate(new Date());

      try {
        const corpCode = await resolveCorpCode(params.stock_code);

        // 베타: Weekly + Monthly 동시 조회
        const [betaWeeklyResult, betaMonthlyResult, financialResult, stockQtyResult, marketResult, companyResult] = await Promise.allSettled([
          fetchBetaData({
            stockCodes: [params.stock_code],
            date: today, country: "KR", periodType: "Weekly",
            betaPeriods: ["1Y", "2Y", "3Y", "5Y"],
          }),
          fetchBetaData({
            stockCodes: [params.stock_code],
            date: today, country: "KR", periodType: "Monthly",
            betaPeriods: ["1Y", "2Y", "3Y", "5Y"],
          }),
          fetchFinancials(corpCode, year, REPORT_CODE.annual, "CFS"),
          fetchStockQuantity(corpCode, year, REPORT_CODE.annual),
          fetchMarketData(params.stock_code),
          getCompanyInfo(params.stock_code),
        ]);

        const output: Record<string, unknown> = { stockCode: params.stock_code, year };

        // 기업정보
        if (companyResult.status === "fulfilled") {
          const info = companyResult.value;
          output.company = { name: info.corp_name, nameEng: info.corp_name_eng, ceo: info.ceo_nm, industryCode: info.induty_code };
        }

        // 베타 Weekly
        if (betaWeeklyResult.status === "fulfilled" && betaWeeklyResult.value.length > 0) {
          output.betaWeekly = betaWeeklyResult.value[0].betas;
        } else {
          output.betaWeekly = null;
        }

        // 베타 Monthly
        if (betaMonthlyResult.status === "fulfilled" && betaMonthlyResult.value.length > 0) {
          output.betaMonthly = betaMonthlyResult.value[0].betas;
        } else {
          output.betaMonthly = null;
        }

        // 주식수
        let shares: SharesInfo | null = null;
        if (stockQtyResult.status === "fulfilled") {
          shares = extractSharesInfo(stockQtyResult.value, year, REPORT_CODE.annual);
          output.shares = shares;
        } else {
          output.shares = null;
        }

        // 시장데이터: 종가만 + 시가총액 = 유통주식수 × 종가
        let price: number | null = null;
        if (marketResult.status === "fulfilled") {
          price = marketResult.value.price ?? null;
          output.price = price;
        } else {
          output.price = null;
        }

        // 시가총액 산출 (유통주식수 × 종가)
        if (shares && price) {
          output.marketCap = shares.outstanding * price;
        } else {
          output.marketCap = null;
        }

        // 이자부부채 + 비지배지분 + 세전이익
        let debt: DebtSummary | null = null;
        if (financialResult.status === "fulfilled") {
          debt = extractDebtSummary(financialResult.value);
          output.debt = debt;
        } else {
          output.debt = null;
        }

        // 출력 형식
        if (params.response_format === "table") {
          return { content: [{ type: "text" as const, text: formatValuationTable({
            stockCode: params.stock_code,
            company: output.company as { name: string } | undefined,
            betaWeekly: output.betaWeekly as Record<string, { raw: number; adjusted: number; dataPoints: number }> | null,
            betaMonthly: output.betaMonthly as Record<string, { raw: number; adjusted: number; dataPoints: number }> | null,
            shares,
            price,
            marketCap: output.marketCap as number | null,
            debt,
          }) }] };
        }

        if (params.response_format === "json") {
          return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
        }

        return { content: [{ type: "text" as const, text: formatValuationMarkdown(output) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }], isError: true };
      }
    }
  );
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatValuationMarkdown(data: Record<string, unknown>): string {
  const lines: string[] = [];
  const company = data.company as Record<string, string> | undefined;
  const betaWeekly = data.betaWeekly as Record<string, { raw: number; adjusted: number; dataPoints: number }> | null;
  const betaMonthly = data.betaMonthly as Record<string, { raw: number; adjusted: number; dataPoints: number }> | null;
  const shares = data.shares as SharesInfo | null;
  const price = data.price as number | null;
  const marketCap = data.marketCap as number | null;
  const debt = data.debt as DebtSummary | null;

  lines.push(`# ${company?.name ?? data.stockCode} 밸류에이션 데이터`);
  lines.push(`> 재무제표 기준: ${data.year}년 사업보고서 (연결)\n`);

  // 종가 + 시가총액
  lines.push("## 시장데이터");
  lines.push(`- 종가: ${price?.toLocaleString() ?? "-"}원`);
  if (marketCap) lines.push(`- **시가총액: ${marketCap.toLocaleString()}원** (유통주식수×종가)`);
  lines.push("");

  // 주식수
  if (shares) {
    lines.push("## 주식의 총수");
    lines.push(`- 발행주식총수: ${shares.totalIssued.toLocaleString()}주`);
    lines.push(`- 자기주식수: ${shares.treasuryStock.toLocaleString()}주`);
    lines.push(`- **유통주식수: ${shares.outstanding.toLocaleString()}주**`);
    lines.push("");
  }

  // 베타 Weekly
  if (betaWeekly) {
    lines.push("## 베타계수 (Weekly)");
    lines.push("| 기간 | 실질베타 | 조정베타 | 포인트수 |");
    lines.push("|------|---------|---------|---------|");
    for (const [period, vals] of Object.entries(betaWeekly)) {
      lines.push(`| ${period} | ${vals.raw ?? "-"} | ${vals.adjusted ?? "-"} | ${vals.dataPoints ?? "-"} |`);
    }
    lines.push("");
  }

  // 베타 Monthly
  if (betaMonthly) {
    lines.push("## 베타계수 (Monthly)");
    lines.push("| 기간 | 실질베타 | 조정베타 | 포인트수 |");
    lines.push("|------|---------|---------|---------|");
    for (const [period, vals] of Object.entries(betaMonthly)) {
      lines.push(`| ${period} | ${vals.raw ?? "-"} | ${vals.adjusted ?? "-"} | ${vals.dataPoints ?? "-"} |`);
    }
    lines.push("");
  }

  // 이자부부채
  if (debt) {
    lines.push("## 이자부부채");
    if (debt.current.items.length > 0) {
      lines.push("**유동:**");
      for (const d of debt.current.items) lines.push(`- ${d.account}: ${d.amount.toLocaleString()}원`);
      lines.push(`- 소계: ${debt.current.total.toLocaleString()}원`);
    }
    if (debt.nonCurrent.items.length > 0) {
      lines.push("**비유동:**");
      for (const d of debt.nonCurrent.items) lines.push(`- ${d.account}: ${d.amount.toLocaleString()}원`);
      lines.push(`- 소계: ${debt.nonCurrent.total.toLocaleString()}원`);
    }
    lines.push(`\n**이자부부채 합계: ${debt.interestBearingDebt.toLocaleString()}원**`);
    if (debt.nonControllingInterest !== null) lines.push(`**비지배지분: ${debt.nonControllingInterest.toLocaleString()}원**`);
    if (debt.pretaxIncome !== null) lines.push(`**세전이익: ${debt.pretaxIncome.toLocaleString()}원**`);
    lines.push("");
  }

  return lines.join("\n");
}
