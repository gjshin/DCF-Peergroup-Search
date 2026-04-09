import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fetchBusinessContent } from "../src/services/opendart/document-parser";

// ─── 설정 ───
// 2025년 평가 목적 (2024 재무제표)
const TARGET_YEAR = "2025"; 
const BATCH_SIZE = 3; // DART API 타임아웃 회피를 위해 3개씩
const DELAY_MS = 1000;
const SAVE_INTERVAL = 10;

const BASE_DIR = path.resolve(__dirname, "../data/business-cache");
const CACHE_PATH = path.join(BASE_DIR, `${TARGET_YEAR}.json`);
const CACHE_GZ_PATH = path.join(BASE_DIR, `${TARGET_YEAR}.json.gz`);
const PROGRESS_DIR = path.join(BASE_DIR, "_progress");
const PROGRESS_PATH = path.join(PROGRESS_DIR, `${TARGET_YEAR}.json`);
const INDUSTRY_PATH = path.resolve(__dirname, "../data/company-industry.json");

// 환경변수 로드
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

const apiKey = process.env.OPENDART_API_KEY ?? "";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadJsonMaybeGz<T>(gzPath: string, rawPath: string): T | null {
  if (fs.existsSync(gzPath)) {
    try {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString("utf8"));
    } catch {
      return null;
    }
  }
  return loadJson<T>(rawPath);
}

function saveJson(filePath: string, data: unknown) {
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function saveCache(data: unknown) {
  const json = JSON.stringify(data);
  // raw .json은 gitignore 대상이지만 로컬 작업 편의를 위해 함께 저장
  fs.writeFileSync(CACHE_PATH, json);
  fs.writeFileSync(CACHE_GZ_PATH, zlib.gzipSync(json, { level: 9 }));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getListedStocks(): Array<{ stockCode: string; corpCode: string; name: string }> {
  const industry: Record<string, { name: string; corpCode: string; industryCode: string }> =
    JSON.parse(fs.readFileSync(INDUSTRY_PATH, "utf8"));
  return Object.entries(industry).map(([code, entry]) => ({
    stockCode: code,
    corpCode: entry.corpCode,
    name: entry.name,
  }));
}

async function main() {
  if (!apiKey) {
    console.error("OPENDART_API_KEY 환경변수를 설정해주세요.");
    process.exit(1);
  }

  ensureDir(BASE_DIR);
  ensureDir(PROGRESS_DIR);

  const stocks = getListedStocks();
  const cache: Record<string, string> = loadJsonMaybeGz<Record<string, string>>(CACHE_GZ_PATH, CACHE_PATH) ?? {};
  const progress: Set<string> = new Set(loadJson<string[]>(PROGRESS_PATH) ?? []);

  // 실패/TOC 가짜성공 재시도 대상 포함
  const isBad = (v?: string) =>
    !v ||
    v.startsWith("❌") ||
    v.length < 500 ||
    !/(1\s*\.\s*사업의\s*개요|주요\s*제품|매출|영업\s*개황|원재료)/.test(v);

  // progress는 "성공한 것"만 신뢰 — bad 엔트리는 제거하여 재시도
  for (const code of Array.from(progress)) {
    if (isBad(cache[code])) progress.delete(code);
  }
  const toFetch = stocks.filter((s) => isBad(cache[s.stockCode]));
  console.log(`[Business Cache ${TARGET_YEAR}] 기존: ${Object.keys(cache).length} / 미수집: ${toFetch.length}`);

  if (toFetch.length === 0) {
    console.log("모든 데이터 수집 완료!");
    return;
  }

  let fetched = 0;
  let failed = 0;

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (s) => {
        try {
          // 직접 API 호출
          const markdownText = await fetchBusinessContent(s.corpCode, TARGET_YEAR, apiKey);
          // 실패하거나 섹션을 못 찾은 경우에도 LLM이 반복 조회 안 하도록 메시지도 그냥 저장함 (필요 시 수정 가능)
          cache[s.stockCode] = markdownText;
          progress.add(s.stockCode);
          if (markdownText.includes("❌")) failed++;
          else fetched++;
        } catch (error: any) {
          console.error(`[${s.stockCode} ${s.name}] Error: ${error.message}`);
          cache[s.stockCode] = `❌ 다운로드 타임아웃 또는 서버 에러: ${error.message}`;
          progress.add(s.stockCode);
          failed++;
        }
      })
    );

    const totalDone = fetched + failed;
    if (totalDone % SAVE_INTERVAL === 0 || i + BATCH_SIZE >= toFetch.length) {
      saveCache(cache);
      saveJson(PROGRESS_PATH, [...progress]);
      console.log(`[진행] ${i + batch.length}/${toFetch.length} (성공=${fetched}, 실패/없음=${failed})`);
    }

    if (i + BATCH_SIZE < toFetch.length) {
      await sleep(DELAY_MS);
    }
  }

  saveJson(CACHE_PATH, cache);
  saveJson(PROGRESS_PATH, [...progress]);
  console.log(`[완료] 총 ${fetched}건 정상 수집. (미제출/에러: ${failed}건)`);
}

main().catch(console.error);
