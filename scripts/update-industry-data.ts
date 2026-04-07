/**
 * 전체 상장사의 업종 데이터를 OpenDART API에서 수집하여 캐시 파일로 저장합니다.
 *
 * 사용법: OPENDART_API_KEY=xxx npx tsx scripts/update-industry-data.ts
 *
 * 출력: data/company-industry.json
 * 구조: { [stockCode]: { name, corpCode, industryCode } }
 */

import fs from "fs";
import path from "path";
import axios from "axios";

// Load .env.local if present
for (const envFile of [".env.local", ".env"]) {
  const envPath = path.join(process.cwd(), envFile);
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    break;
  }
}

const API_KEY = process.env.OPENDART_API_KEY ?? "";
const DART_API_BASE = "https://opendart.fss.or.kr/api";
const OUTPUT_PATH = path.resolve(__dirname, "../data/company-industry.json");
const CORP_CODES_PATH = path.resolve(__dirname, "../data/corp-codes.json");

interface CorpCodeEntry {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  modify_date: string;
}

interface CompanyIndustryEntry {
  name: string;
  corpCode: string;
  industryCode: string;
}

async function fetchKrxListedCompanyCodes(): Promise<Set<string>> {
  try {
    const fetchMarket = async (marketType: string) => {
      const res = await axios.get(`http://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&marketType=${marketType}`, {
        responseType: "arraybuffer",
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"
        }
      });
      const html = new TextDecoder("euc-kr").decode(res.data);
      return [...html.matchAll(/>(\d{6})</g)].map(m => m[1]);
    };

    const kospi = await fetchMarket("stockMkt");
    const kosdaq = await fetchMarket("kosdaqMkt");
    
    return new Set([...kospi, ...kosdaq]);
  } catch (err) {
    console.error("Failed to fetch KRX listed companies.", err);
    return new Set();
  }
}

async function fetchCompanyInfo(corpCode: string): Promise<{ induty_code: string; corp_name: string } | null> {
  try {
    const res = await axios.get(`${DART_API_BASE}/company.json`, {
      params: { crtfc_key: API_KEY, corp_code: corpCode },
      timeout: 10000,
    });
    if (res.data.status === "000") {
      return { induty_code: res.data.induty_code, corp_name: res.data.corp_name };
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!API_KEY) {
    console.error("OPENDART_API_KEY 환경변수를 설정해주세요.");
    process.exit(1);
  }

  // 0. KRX 상장사 목록 조회
  console.log("Fetching KRX listed companies...");
  const krxListedCodes = await fetchKrxListedCompanyCodes();
  console.log(`Found KRX active listed companies: ${krxListedCodes.size}`);

  // 1. corp-codes.json에서 상장사만 추출
  console.log("Loading corp-codes.json...");
  const corpCodes: CorpCodeEntry[] = JSON.parse(fs.readFileSync(CORP_CODES_PATH, "utf8"));
  let listed = corpCodes
    .filter((c) => c.stock_code && c.stock_code.trim() !== "")
    .map((c) => ({ ...c, stock_code: c.stock_code.padStart(6, "0") }));
  console.log(`OpenDART valid stock codes: ${listed.length}`);

  if (krxListedCodes.size > 0) {
    listed = listed.filter((c) => krxListedCodes.has(c.stock_code));
    console.log(`Filtered overlapping with KRX: ${listed.length}`);
  }

  // 2. 기존 캐시 로드 및 정제
  let existing: Record<string, CompanyIndustryEntry> = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
    console.log(`Existing cache: ${Object.keys(existing).length} entries`);

    // KRX 상장사 목록에 없는 종목(상장폐지/중복) 제거
    if (krxListedCodes.size > 0) {
      let cleaned = 0;
      for (const stockCode of Object.keys(existing)) {
        if (!krxListedCodes.has(stockCode)) {
          delete existing[stockCode];
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`Cleaned ${cleaned} unlisted/duplicate entries from existing cache.`);
      }
    }
  }

  // 3. 아직 캐시에 없는 회사만 수집
  const toFetch = listed.filter((c) => !existing[c.stock_code]);
  console.log(`To fetch: ${toFetch.length} companies`);

  if (toFetch.length === 0) {
    console.log("All companies already cached. Saving updated cache and exiting.");
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(existing, null, 0));
    console.log(`Done! Total cached: ${Object.keys(existing).length} companies`);
    return;
  }

  // 4. 배치 수집 (동시 5개씩, rate limiting 고려)
  const BATCH_SIZE = 3;
  const DELAY_MS = 1000; // 배치 간 1초 딜레이 (분당 ~180회 → rate limit 안전)
  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (c) => {
        const info = await fetchCompanyInfo(c.corp_code);
        return { stockCode: c.stock_code, corpCode: c.corp_code, info };
      }),
    );

    for (const r of results) {
      if (r.info) {
        existing[r.stockCode] = {
          name: r.info.corp_name,
          corpCode: r.corpCode,
          industryCode: r.info.induty_code,
        };
        fetched++;
      } else {
        failed++;
      }
    }

    // 진행 상황 출력
    const total = fetched + failed;
    if (total % 50 === 0 || i + BATCH_SIZE >= toFetch.length) {
      console.log(`Progress: ${total}/${toFetch.length} (fetched=${fetched}, failed=${failed})`);
    }

    // 중간 저장 (100건마다)
    if (total % 100 === 0) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(existing, null, 0));
    }

    // rate limiting
    if (i + BATCH_SIZE < toFetch.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  // 5. 최종 저장
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(existing, null, 0));
  console.log(`\nDone! Total cached: ${Object.keys(existing).length} companies`);
  console.log(`Saved to: ${OUTPUT_PATH}`);
}

main();
