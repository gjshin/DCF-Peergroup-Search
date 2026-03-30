import axios from "axios";
import { DART_API_BASE, DART_ENDPOINTS } from "../opendart/constants";
import type { DartCompanyInfo } from "../opendart/types";

// 인메모리 캐시: stockCode(6자리) → corpCode(8자리)
const stockToCorpCache = new Map<string, string>();
// 인메모리 캐시: stockCode(6자리) → 기업정보
const companyInfoCache = new Map<string, DartCompanyInfo>();

function getApiKey(): string {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    throw new Error("OPENDART_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  return key;
}

/**
 * 6자리 종목코드 → 8자리 DART corp_code 변환
 *
 * 전략:
 * 1. 종목코드 → 네이버 자동완성 API로 회사명 조회
 * 2. 회사명 → DART list.json의 corp_name 파라미터로 공시 검색 → corp_code 획득
 * 3. corp_code → DART company.json으로 기업개황 조회
 */
export async function resolveCorpCode(stockCode: string): Promise<string> {
  const cached = stockToCorpCache.get(stockCode);
  if (cached) return cached;

  // Step 1: 네이버 자동완성으로 회사명 획득
  const companyName = await getCompanyNameFromNaver(stockCode);
  if (!companyName) {
    throw new Error(`종목코드 ${stockCode}에 해당하는 회사를 찾을 수 없습니다. (네이버 검색 실패)`);
  }

  // Step 2: DART list.json에 corp_name으로 검색 → corp_code 획득
  const corpCode = await searchDartByCorpName(companyName);
  if (!corpCode) {
    throw new Error(`'${companyName}'(${stockCode})의 DART corp_code를 찾을 수 없습니다. (DART 공시검색 실패)`);
  }

  // Step 3: corp_code로 기업개황 조회
  try {
    const companyResponse = await axios.get<DartCompanyInfo>(`${DART_API_BASE}${DART_ENDPOINTS.COMPANY}`, {
      params: { crtfc_key: getApiKey(), corp_code: corpCode },
      timeout: 15000,
    });

    if (companyResponse.data.status === "000") {
      stockToCorpCache.set(stockCode, corpCode);
      companyInfoCache.set(stockCode, companyResponse.data);
      return corpCode;
    }
  } catch {
    // 기업개황 조회 실패해도 corp_code는 반환
  }

  // 기업개황 조회 실패 시 최소 정보로 캐시
  stockToCorpCache.set(stockCode, corpCode);
  companyInfoCache.set(stockCode, {
    status: "000",
    message: "정상",
    corp_code: corpCode,
    corp_name: companyName,
    corp_name_eng: "",
    stock_name: companyName,
    stock_code: stockCode,
    ceo_nm: "",
    corp_cls: "",
    induty_code: "",
    est_dt: "",
    acc_mt: "",
  });

  return corpCode;
}

/**
 * 네이버 자동완성 API로 종목코드 → 회사명 조회
 */
async function getCompanyNameFromNaver(stockCode: string): Promise<string | null> {
  try {
    const response = await axios.get<{ items: Array<{ code: string; name: string }> }>(
      "https://ac.stock.naver.com/ac",
      {
        params: { q: stockCode, target: "stock" },
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ValuationMCP/1.0)" },
        timeout: 10000,
      }
    );

    const match = response.data.items?.find((item) => item.code === stockCode);
    return match?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * DART list.json API에 corp_name으로 검색하여 corp_code 획득
 */
async function searchDartByCorpName(corpName: string): Promise<string | null> {
  try {
    const response = await axios.get(`${DART_API_BASE}/list.json`, {
      params: {
        crtfc_key: getApiKey(),
        corp_name: corpName,
        page_count: 1,
        page_no: 1,
      },
      timeout: 15000,
    });

    if (response.data.status === "000" && response.data.list?.length > 0) {
      return response.data.list[0].corp_code;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 캐시된 기업정보 반환
 */
export function getCachedCompanyInfo(stockCode: string): DartCompanyInfo | undefined {
  return companyInfoCache.get(stockCode);
}

/**
 * 종목코드에 대한 기업정보를 조회 (캐시 우선, 없으면 API 호출)
 */
export async function getCompanyInfo(stockCode: string): Promise<DartCompanyInfo> {
  const cached = companyInfoCache.get(stockCode);
  if (cached) return cached;

  await resolveCorpCode(stockCode);
  const info = companyInfoCache.get(stockCode);
  if (!info) {
    throw new Error(`종목코드 ${stockCode}의 기업정보를 가져올 수 없습니다.`);
  }
  return info;
}
