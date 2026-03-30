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
 * OpenDART company.json API 사용 (stock_code 파라미터 지원 여부에 따라 분기)
 */
export async function resolveCorpCode(stockCode: string): Promise<string> {
  // 캐시 확인
  const cached = stockToCorpCache.get(stockCode);
  if (cached) return cached;

  // OpenDART company.json은 corp_code로만 검색 가능하므로,
  // 종목코드로 기업을 찾으려면 공시검색 API를 활용
  const { info, debugMsg } = await searchCompanyByStockCode(stockCode);
  if (info) {
    stockToCorpCache.set(stockCode, info.corp_code);
    companyInfoCache.set(stockCode, info);
    return info.corp_code;
  }

  throw new Error(`종목코드 ${stockCode}에 해당하는 DART 기업코드를 찾을 수 없습니다. (${debugMsg})`);
}

/**
 * 종목코드로 기업정보 검색
 * OpenDART의 기업개황 API는 corp_code만 받으므로,
 * 공시검색을 통해 stock_code → corp_code 매핑을 수행
 */
async function searchCompanyByStockCode(stockCode: string): Promise<{ info: DartCompanyInfo | null; debugMsg: string }> {
  // 방법: 공시검색 API에서 종목코드로 검색하여 corp_code 획득
  try {
    const apiKey = getApiKey();
    console.log(`[StockResolver] Searching DART for stock_code=${stockCode}, API key length=${apiKey.length}`);

    const searchResponse = await axios.get(`${DART_API_BASE}/list.json`, {
      params: {
        crtfc_key: apiKey,
        stock_code: stockCode,
        page_count: 1,
        page_no: 1,
      },
      timeout: 15000,
    });

    console.log(`[StockResolver] list.json response: status=${searchResponse.data.status}, message=${searchResponse.data.message}, listCount=${searchResponse.data.list?.length ?? 0}`);

    if (searchResponse.data.status === "000" && searchResponse.data.list?.length > 0) {
      const corpCode = searchResponse.data.list[0].corp_code;
      const corpName = searchResponse.data.list[0].corp_name;
      console.log(`[StockResolver] Found corp_code=${corpCode}, corp_name=${corpName}`);

      // corp_code로 기업개황 조회
      const companyResponse = await axios.get<DartCompanyInfo>(`${DART_API_BASE}${DART_ENDPOINTS.COMPANY}`, {
        params: {
          crtfc_key: apiKey,
          corp_code: corpCode,
        },
        timeout: 15000,
      });

      if (companyResponse.data.status === "000") {
        return { info: companyResponse.data, debugMsg: "OK" };
      }

      console.log(`[StockResolver] company.json failed: status=${companyResponse.data.status}, message=${companyResponse.data.message}`);

      // 기업개황 조회 실패해도 기본 정보는 반환
      return {
        info: {
          status: "000",
          message: "정상",
          corp_code: corpCode,
          corp_name: corpName,
          corp_name_eng: "",
          stock_name: "",
          stock_code: stockCode,
          ceo_nm: "",
          corp_cls: "",
          induty_code: "",
          est_dt: "",
          acc_mt: "",
        },
        debugMsg: "OK (company.json fallback)",
      };
    }

    // API 호출은 성공했지만 결과가 없는 경우
    const msg = `DART list.json status=${searchResponse.data.status}, message=${searchResponse.data.message}`;
    console.log(`[StockResolver] ${msg}`);
    return { info: null, debugMsg: msg };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[StockResolver] Error: ${msg}`);
    return { info: null, debugMsg: `Exception: ${msg}` };
  }
}

/**
 * 캐시된 기업정보 반환 (resolveCorpCode 호출 이후 사용 가능)
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
