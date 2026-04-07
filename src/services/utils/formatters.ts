import type { StockBetaResult } from "../kicpa/types";

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
