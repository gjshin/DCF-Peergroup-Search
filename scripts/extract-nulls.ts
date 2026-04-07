import fs from "fs";
import path from "path";

const dataPath = path.resolve(__dirname, "../data/valuation-cache/20250331.json");
const outPath = path.resolve(__dirname, "../data/null_data_list.md");

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const priceNulls: string[] = [];
const betaNulls: string[] = [];
const ibdNulls: string[] = [];

const entries = Object.values<{ 
  name: string; 
  code: string; 
  industry?: { code: string; name: string }; 
  marketCap?: { price?: number | null }; 
  beta?: { weekly?: any | null }; 
  ibd?: any | null; 
}>(data);

for (const c of entries) {
  // 금융업 (KSIC 64, 65, 66) 제외
  if (c.industry && c.industry.code && (c.industry.code.startsWith("64") || c.industry.code.startsWith("65") || c.industry.code.startsWith("66"))) {
    continue;
  }

  const pNull = !c.marketCap || c.marketCap.price == null;
  const bNull = !c.beta || c.beta.weekly == null;
  const iNull = !c.ibd || c.ibd.total == null; // IBD could be `{ total: 0 }` for debt-free
  
  if (!pNull && !bNull && !iNull) continue;

  const indName = c.industry?.name ?? "알 수 없음";
  const row = `| ${c.name} | ${c.code} | ${indName} |\n`;

  if (pNull) priceNulls.push(row);
  if (bNull) betaNulls.push(row);
  if (iNull) ibdNulls.push(row);
}

let md = `# 항목별 누락 회사 리스트 (기준일: 2025-03-31)\n\n`;
md += `> **안내:** 이 리스트는 KOSPI 및 KOSDAQ 상장사 기준이며, 밸류에이션(DCF)이 어려운 **금융업종(KSIC 64, 65, 66)은 의도적으로 제외**되었습니다.\n\n`;

md += `## 1. 주가 데이터 누락 (${priceNulls.length}개)\n\n`;
md += `| 종목명 | 종목코드 | 업종명 |\n|---|---|---|\n`;
md += priceNulls.join("");

md += `\n## 2. KICPA 베타 누락 (${betaNulls.length}개)\n\n`;
md += `| 종목명 | 종목코드 | 업종명 |\n|---|---|---|\n`;
md += betaNulls.join("");

md += `\n## 3. IBD (이자발생부채) 누락 (${ibdNulls.length}개)\n\n`;
md += `| 종목명 | 종목코드 | 업종명 |\n|---|---|---|\n`;
md += ibdNulls.join("");

fs.writeFileSync(outPath, md, "utf8");
console.log("Successfully written to " + outPath);
