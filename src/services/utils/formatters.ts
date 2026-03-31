import type { StockBetaResult } from "../kicpa/types";
import type { DebtSummary, SharesInfo } from "../opendart/types";

// ─── 베타계수 포맷터 ───

export function formatBetaResultsMarkdown(results: StockBetaResult[]): string {
  if (results.length === 0) return "조회 결과가 없습니다.";

  const lines: string[] = [];
  for (const stock of results) {
    lines.push(`## ${stock.stockNameKr} (${stock.stockCode})`);
    lines.push(`- **영문명**: ${stock.stockNameEn}`);
    lines.push(`- **시장**: ${stock.market}`);
    lines.push(`- **종가**: ${stock.closePrice}`);
    lines.push(`- **기준일**: ${formatDate(stock.date)}`);
    lines.push("");

    const periods = Object.keys(stock.betas);
    if (periods.length > 0) {
      lines.push("| 기간 | 실질베타 | 조정베타 | 포인트수 |");
      lines.push("|------|---------|---------|---------|");
      for (const period of periods) {
        const beta = stock.betas[period];
        lines.push(`| ${period} | ${fmtNum(beta.raw)} | ${fmtNum(beta.adjusted)} | ${fmtNum(beta.dataPoints)} |`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function formatBetaResultsJson(results: StockBetaResult[]): string {
  return JSON.stringify(results, null, 2);
}

export function formatBetaResultsTable(results: StockBetaResult[]): string {
  if (results.length === 0) return "조회 결과가 없습니다.";

  const rows: string[] = [];
  rows.push(["종목코드", "종목명", "시장", "종가", "기간", "실질베타", "조정베타", "포인트수"].join("\t"));
  for (const stock of results) {
    for (const [period, beta] of Object.entries(stock.betas)) {
      rows.push([
        stock.stockCode, stock.stockNameKr, stock.market, stock.closePrice,
        period, fmtNum(beta.raw), fmtNum(beta.adjusted), fmtNum(beta.dataPoints),
      ].join("\t"));
    }
  }
  return rows.join("\n");
}

// ─── 밸류에이션 TSV 포맷터 ───

type BetaMap = Record<string, { raw: number; adjusted: number; dataPoints: number }>;

export function formatValuationTable(data: {
  stockCode: string;
  company?: { name: string };
  betaWeekly?: BetaMap | null;
  betaMonthly?: BetaMap | null;
  shares?: SharesInfo | null;
  price?: number | null;
  marketCap?: number | null;
  debt?: DebtSummary | null;
}): string {
  const rows: string[] = [];
  rows.push(["항목", "값", "비고"].join("\t"));

  rows.push(["종목코드", data.stockCode, ""].join("\t"));
  if (data.company) rows.push(["종목명", data.company.name, ""].join("\t"));

  // 종가 + 시가총액
  if (data.price != null) rows.push(["종가", String(data.price), ""].join("\t"));
  if (data.marketCap != null) rows.push(["시가총액", String(data.marketCap), "유통주식수×종가"].join("\t"));

  // 주식수
  if (data.shares) {
    rows.push(["발행주식총수", String(data.shares.totalIssued), "보통주"].join("\t"));
    rows.push(["자기주식", String(data.shares.treasuryStock), ""].join("\t"));
    rows.push(["유통주식수", String(data.shares.outstanding), "발행-자기주식"].join("\t"));
  }

  // 베타 Weekly
  if (data.betaWeekly) {
    for (const [period, vals] of Object.entries(data.betaWeekly)) {
      rows.push([`Weekly ${period} 실질베타`, String(vals.raw), ""].join("\t"));
      rows.push([`Weekly ${period} 조정베타`, String(vals.adjusted), ""].join("\t"));
    }
  }

  // 베타 Monthly
  if (data.betaMonthly) {
    for (const [period, vals] of Object.entries(data.betaMonthly)) {
      rows.push([`Monthly ${period} 실질베타`, String(vals.raw), ""].join("\t"));
      rows.push([`Monthly ${period} 조정베타`, String(vals.adjusted), ""].join("\t"));
    }
  }

  // 이자부부채
  if (data.debt) {
    for (const item of data.debt.current.items) {
      rows.push([`IBD(유동) ${item.account}`, String(item.amount), "유동"].join("\t"));
    }
    for (const item of data.debt.nonCurrent.items) {
      rows.push([`IBD(비유동) ${item.account}`, String(item.amount), "비유동"].join("\t"));
    }
    rows.push(["이자부부채(유동) 합계", String(data.debt.current.total), ""].join("\t"));
    rows.push(["이자부부채(비유동) 합계", String(data.debt.nonCurrent.total), ""].join("\t"));
    rows.push(["이자부부채 합계", String(data.debt.interestBearingDebt), ""].join("\t"));
    if (data.debt.nonControllingInterest !== null) {
      rows.push(["비지배지분", String(data.debt.nonControllingInterest), ""].join("\t"));
    }
    if (data.debt.pretaxIncome !== null) {
      rows.push(["세전이익", String(data.debt.pretaxIncome), "한계세율 산출용"].join("\t"));
    }
  }

  return rows.join("\n");
}

// ─── 재무제표 TSV 포맷터 ───

export function formatFinancialsTable(items: Array<{
  category: string;
  sjDiv?: string;
  account: string;
  currentAmount: string;
  previousAmount: string;
}>): string {
  const rows: string[] = [];
  rows.push(["구분", "계정명", "당기금액", "전기금액"].join("\t"));
  for (const item of items) {
    rows.push([
      item.sjDiv ?? item.category,
      item.account,
      item.currentAmount ?? "",
      item.previousAmount ?? "",
    ].join("\t"));
  }
  return rows.join("\n");
}

// ─── 유틸리티 ───

function formatDate(dateStr: string): string {
  if (dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  return dateStr;
}

function fmtNum(value: number | null): string {
  if (value === null) return "-";
  return String(value);
}
