import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchBetaData } from "../kicpa/client";
import { resolveCorpCode, getCompanyInfo } from "../common/stock-code-resolver";
import { fetchFinancials, fetchStockQuantity, extractSharesInfo, extractDebtSummary } from "../opendart/client";
import { REPORT_CODE } from "../opendart/constants";
import { fetchMarketData } from "../naver/client";
import { handleApiError } from "../utils/error-handler";

const ValuationDataInputSchema = z.object({
  stock_code: z.string().min(1).max(10).describe("종목코드 6자리 (예: '005930')"),
  year: z.string().regex(/^\d{4}$/).optional().describe("재무제표 사업연도 (기본: 전년도)"),
  beta_period: z.enum(["Daily", "Weekly", "Monthly"]).default("Weekly").describe("베타 산출 주기"),
  response_format: z.enum(["markdown", "json"]).default("json").describe("출력 형식"),
}).strict();

type ValuationDataInput = z.infer<typeof ValuationDataInputSchema>;

export function registerValuationDataTool(server: McpServer): void {
  server.registerTool(
    "valuation_get_data",
    {
      title: "밸류에이션 통합 데이터 조회",
      description: `한국기업 밸류에이션에 필요한 핵심 데이터를 한번에 조회합니다.
KICPA(베타) + OpenDART(재무제표/주식수) + 네이버금융(시장데이터)을 병렬 호출합니다.

반환 데이터:
- 베타계수 (1Y/2Y/3Y/5Y, 실질/조정)
- 시가총액, 주가, PER, PBR
- 발행주식총수, 자기주식수, 유통주식수
- 이자부부채 (차입금, 사채, 전환사채 등)
- 비지배지분
- 동종업종 기업 리스트

Args:
  - stock_code (string): 종목코드 6자리
  - year (string, optional): 재무제표 사업연도 (기본: 전년도)
  - beta_period: Daily/Weekly/Monthly (기본: Weekly)
  - response_format: markdown/json (기본: json)

Examples:
  - 삼성전자 밸류에이션: stock_code="005930"
  - SK하이닉스 2023년 기준: stock_code="000660", year="2023"`,
      inputSchema: ValuationDataInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params: ValuationDataInput) => {
      const year = params.year ?? String(new Date().getFullYear() - 1);
      const today = formatDate(new Date());

      try {
        // Step 1: corp_code 매핑 (OpenDART 호출에 필요)
        const corpCode = await resolveCorpCode(params.stock_code);

        // Step 2: 3개 소스 병렬 호출
        const [betaResult, financialResult, stockQtyResult, marketResult, companyResult] = await Promise.allSettled([
          fetchBetaData({
            stockCodes: [params.stock_code],
            date: today,
            country: "KR",
            periodType: params.beta_period,
            betaPeriods: ["1Y", "2Y", "3Y", "5Y"],
          }),
          fetchFinancials(corpCode, year, REPORT_CODE.annual, "CFS"),
          fetchStockQuantity(corpCode, year, REPORT_CODE.annual),
          fetchMarketData(params.stock_code),
          getCompanyInfo(params.stock_code),
        ]);

        // 결과 조합
        const output: Record<string, unknown> = { stockCode: params.stock_code, year };

        // 기업정보
        if (companyResult.status === "fulfilled") {
          const info = companyResult.value;
          output.company = {
            name: info.corp_name,
            nameEng: info.corp_name_eng,
            ceo: info.ceo_nm,
            corpCode: info.corp_code,
            industryCode: info.induty_code,
          };
        }

        // 베타
        if (betaResult.status === "fulfilled" && betaResult.value.length > 0) {
          output.beta = betaResult.value[0].betas;
        } else {
          output.beta = null;
          output.betaError = betaResult.status === "rejected" ? betaResult.reason?.message : "데이터 없음";
        }

        // 주식수
        if (stockQtyResult.status === "fulfilled") {
          output.shares = extractSharesInfo(stockQtyResult.value, year, REPORT_CODE.annual);
        } else {
          output.shares = null;
          output.sharesError = stockQtyResult.reason?.message;
        }

        // 시장데이터
        if (marketResult.status === "fulfilled") {
          const md = marketResult.value;
          output.marketData = {
            price: md.price,
            marketCap: md.marketCap,
            per: md.per,
            pbr: md.pbr,
            eps: md.eps,
            bps: md.bps,
            dividendYield: md.dividendYield,
            foreignRate: md.foreignRate,
            consensusTargetPrice: md.consensusTargetPrice,
          };
          output.peers = md.peers;

          // 시가총액 계산 (유통주식수 × 종가)
          const shares = output.shares as { outstanding: number } | null;
          if (shares && md.price) {
            output.calculatedMarketCap = shares.outstanding * md.price;
          }
        } else {
          output.marketData = null;
          output.marketDataError = marketResult.reason?.message;
        }

        // 이자부부채 + 비지배지분
        if (financialResult.status === "fulfilled") {
          output.debt = extractDebtSummary(financialResult.value);
        } else {
          output.debt = null;
          output.debtError = financialResult.reason?.message;
        }

        // 출력
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
  const beta = data.beta as Record<string, { raw: number; adjusted: number; dataPoints: number }> | null;
  const shares = data.shares as { totalIssued: number; treasuryStock: number; outstanding: number; source: string } | null;
  const marketData = data.marketData as Record<string, unknown> | null;
  const debt = data.debt as { interestBearingDebt: number; details: Array<{ account: string; amount: number }>; nonControllingInterest: number | null } | null;
  const peers = data.peers as Array<{ code: string; name: string; marketCap: string }> | undefined;

  lines.push(`# ${company?.name ?? data.stockCode} 밸류에이션 데이터`);
  lines.push(`> 재무제표 기준: ${data.year}년 사업보고서 (연결)\n`);

  // 시장데이터
  if (marketData) {
    lines.push("## 시장데이터");
    lines.push(`| 항목 | 값 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 종가 | ${(marketData.price as number)?.toLocaleString() ?? "-"}원 |`);
    lines.push(`| 시가총액 | ${marketData.marketCap ?? "-"} |`);
    if (data.calculatedMarketCap) lines.push(`| 시가총액(유통주식×종가) | ${(data.calculatedMarketCap as number).toLocaleString()}원 |`);
    lines.push(`| PER | ${marketData.per ?? "-"}배 |`);
    lines.push(`| PBR | ${marketData.pbr ?? "-"}배 |`);
    lines.push("");
  }

  // 베타
  if (beta) {
    lines.push("## 베타계수");
    lines.push("| 기간 | 실질베타 | 조정베타 | 포인트수 |");
    lines.push("|------|---------|---------|---------|");
    for (const [period, vals] of Object.entries(beta)) {
      lines.push(`| ${period} | ${vals.raw ?? "-"} | ${vals.adjusted ?? "-"} | ${vals.dataPoints ?? "-"} |`);
    }
    lines.push("");
  }

  // 주식수
  if (shares) {
    lines.push("## 주식의 총수");
    lines.push(`- 발행주식총수: ${shares.totalIssued.toLocaleString()}주`);
    lines.push(`- 자기주식수: ${shares.treasuryStock.toLocaleString()}주`);
    lines.push(`- **유통주식수: ${shares.outstanding.toLocaleString()}주**`);
    lines.push("");
  }

  // 이자부부채
  if (debt) {
    lines.push("## 이자부부채");
    lines.push(`**합계: ${debt.interestBearingDebt.toLocaleString()}원**`);
    for (const d of debt.details) {
      lines.push(`- ${d.account}: ${d.amount.toLocaleString()}원`);
    }
    if (debt.nonControllingInterest !== null) {
      lines.push(`\n**비지배지분: ${debt.nonControllingInterest.toLocaleString()}원**`);
    }
    lines.push("");
  }

  // 동종업종
  if (peers && peers.length > 0) {
    lines.push("## 동종업종 기업");
    lines.push("| 종목코드 | 종목명 | 시가총액 |");
    lines.push("|---------|--------|---------|");
    for (const p of peers) {
      lines.push(`| ${p.code} | ${p.name} | ${p.marketCap} |`);
    }
  }

  return lines.join("\n");
}
