const fs = require('fs');

const CACHE_PATH = './data/business-cache/2025.json';
const INDUSTRY_PATH = './data/company-industry.json';

const cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
const industry = JSON.parse(fs.readFileSync(INDUSTRY_PATH, 'utf8'));

let total = 0;
let success = 0;
let errors = {};

for (const [stockCode, content] of Object.entries(cache)) {
  total++;
  if (content.includes('❌')) {
    // Error message snippet (e.g. ❌ 2024년도 사업보고서를 찾을 수 없습니다...)
    let errType = content.substring(0, 100).split('(')[0].trim(); // Get main error reason
    if (!errors[errType]) errors[errType] = [];
    errors[errType].push({ stockCode, name: industry[stockCode]?.name || 'Unknown' });
  } else {
    success++;
  }
}

console.log(`Total: ${total}`);
console.log(`Success: ${success}`);
console.log(`Failed: ${total - success}\n`);

console.log("=== 에러 유형별 분류 ===");
for (const [type, companies] of Object.entries(errors)) {
  console.log(`[${companies.length}건] ${type}`);
  console.log(`  예시: ${companies.slice(0, 5).map(c => `${c.name}(${c.stockCode})`).join(', ')} ...\n`);
}
