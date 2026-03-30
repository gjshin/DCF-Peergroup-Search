import type { StockBetaResult } from "../kicpa/types";

export function formatBetaResultsMarkdown(results: StockBetaResult[]): string {
  if (results.length === 0) {
    return "조회 결과가 없습니다.";
  }

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
        lines.push(
          `| ${period} | ${formatNumber(beta.raw)} | ${formatNumber(beta.adjusted)} | ${formatNumber(beta.dataPoints)} |`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function formatBetaResultsJson(results: StockBetaResult[]): string {
  return JSON.stringify(results, null, 2);
}

function formatDate(dateStr: string): string {
  if (dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  return dateStr;
}

function formatNumber(value: number | null): string {
  if (value === null) return "-";
  return String(value);
}
