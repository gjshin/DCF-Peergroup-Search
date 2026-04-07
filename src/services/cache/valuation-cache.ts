import fs from "fs";
import path from "path";

// CompactResult와 동일한 구조 (valuation-data.ts에서 export)
interface CachedResult {
  code: string;
  name: string | null;
  industry: { code: string; name: string | null } | null;
  year: string;
  valuationDate: string;
  beta: {
    weekly: Record<string, [number | null, number | null, number | null]> | null;
    monthly: Record<string, [number | null, number | null, number | null]> | null;
  };
  ibd: {
    current: [string, number][];
    nonCurrent: [string, number][];
    total: number;
  } | null;
  nci: number | null;
  pretaxIncome: number | null;
  marketCap: { price: number | null; shares: number | null; total: number | null };
}

// 날짜별 캐시: valuationDate → (stockCode → CachedResult)
const cacheMap = new Map<string, Map<string, CachedResult>>();
// 로드 시도했지만 파일이 없었던 날짜 기록 (반복 파일 읽기 방지)
const missingDates = new Set<string>();

function loadCache(valuationDate: string): Map<string, CachedResult> | null {
  if (missingDates.has(valuationDate)) return null;
  if (cacheMap.has(valuationDate)) return cacheMap.get(valuationDate)!;

  const filePath = path.resolve(process.cwd(), `data/valuation-cache/${valuationDate}.json`);
  if (!fs.existsSync(filePath)) {
    missingDates.add(valuationDate);
    return null;
  }

  const data: Record<string, CachedResult> = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const map = new Map(Object.entries(data));
  cacheMap.set(valuationDate, map);
  return map;
}

/**
 * 캐시에서 밸류에이션 데이터를 조회합니다.
 * 캐시 히트 시 CompactResult 반환, 미스 시 null.
 */
export function getCachedValuation(stockCode: string, valuationDate: string): CachedResult | null {
  const cache = loadCache(valuationDate);
  if (!cache) return null;
  return cache.get(stockCode) ?? null;
}
