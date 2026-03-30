import axios from "axios";
import {
  API_BASE_URL,
  ENDPOINTS,
  FIXED_PARAMS,
  COUNTRY_CODE,
  PERIOD_TYPE_CODE,
  BETA_PERIOD_TO_ITEM,
  REQUIRED_ITEMS,
  BASE_ITEMS,
  URL_VIEW,
} from "./constants";
import type { ApiResponse, StockBetaResult } from "./types";
import { getSessionCookie, refreshSession } from "./auth";

async function makeAuthenticatedRequest(
  url: string,
  data: string,
  retried = false
): Promise<ApiResponse> {
  const sessionId = await getSessionCookie();

  const response = await axios.post<ApiResponse>(url, data, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": `JSESSIONID=${sessionId}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    timeout: 30000,
  });

  if (response.data.resultCode === "error" && !retried) {
    console.log("[KICPA API] First attempt failed. Refreshing session...");
    try {
      await refreshSession();
      return makeAuthenticatedRequest(url, data, true);
    } catch (refreshError) {
      console.log(`[KICPA API] Session refresh failed: ${refreshError instanceof Error ? refreshError.message : refreshError}`);
    }
  }

  return response.data;
}

export interface FetchBetaParams {
  stockCodes: string[];
  date: string;
  country: "KR" | "US";
  periodType: "Daily" | "Weekly" | "Monthly";
  betaPeriods: string[];
}

export async function fetchBetaData(
  params: FetchBetaParams
): Promise<StockBetaResult[]> {
  const { stockCodes, date, country, periodType, betaPeriods } = params;

  const betaItems = betaPeriods.map((p) => BETA_PERIOD_TO_ITEM[p]).filter(Boolean);
  const allItems = [...REQUIRED_ITEMS, ...BASE_ITEMS, ...betaItems];

  const formParams = new URLSearchParams();
  formParams.append("screenId", FIXED_PARAMS.screenId);
  formParams.append("menuNo", FIXED_PARAMS.menuNo);
  formParams.append("stdCode", stockCodes.join(","));
  formParams.append("sdate", date);
  formParams.append("periodType", PERIOD_TYPE_CODE[periodType] ?? "2");
  formParams.append("gubun", COUNTRY_CODE[country]);
  for (const item of allItems) {
    formParams.append("itemName", item);
  }
  formParams.append("urlView", URL_VIEW);

  const apiResponse = await makeAuthenticatedRequest(
    `${API_BASE_URL}${ENDPOINTS.DAILY_RESULT}`,
    formParams.toString()
  );

  if (apiResponse.resultCode !== "success" || !apiResponse.resultList) {
    throw new Error(
      "API_ERROR: 데이터 조회에 실패했습니다. 유효하지 않은 조회 조건이거나 일시적인 서버 오류입니다."
    );
  }

  return parseResultList(apiResponse.resultList, stockCodes, betaPeriods, date);
}

function parseResultList(
  resultList: Record<string, string | number | undefined>[],
  stockCodes: string[],
  betaPeriods: string[],
  date: string
): StockBetaResult[] {
  const stockMap = new Map<string, StockBetaResult>();

  for (const row of resultList) {
    // 응답 필드명은 camelCase (nameK, nameE, marketName, closePrice 등)
    const nameKr = String(row["nameK"] ?? row["NAME_K"] ?? "");
    const nameEn = String(row["nameE"] ?? row["NAME_E"] ?? "");
    const market = String(row["marketName"] ?? row["MARKET_NAME"] ?? "");
    const closePrice = String(row["closePrice"] ?? row["CLOSE_PRICE"] ?? "");
    const tradeDate = String(row["tradeDate"] ?? row["TRADE_DATE"] ?? date);
    const simpleCode = String(row["simpleCode"] ?? row["SIMPLE_CODE"] ?? "");

    const key = simpleCode || nameKr || nameEn || market;
    if (!stockMap.has(key)) {
      const idx = stockMap.size;
      stockMap.set(key, {
        stockCode: simpleCode || (stockCodes[idx] ?? ""),
        stockNameKr: nameKr,
        stockNameEn: nameEn,
        market,
        closePrice,
        date: String(tradeDate),
        betas: {},
      });
    }

    const stock = stockMap.get(key)!;

    for (const period of betaPeriods) {
      const itemKey = BETA_PERIOD_TO_ITEM[period];
      if (!itemKey) continue;

      // 응답 필드명 직접 매핑: Y1_BETA→y1Beta, Y2_BETA→y2Beta 등
      const num = itemKey.charAt(1); // "1", "2", "3", "5"
      const raw = Number(row[`y${num}Beta`] ?? row[`${itemKey}_1`] ?? NaN);
      const adjusted = Number(row[`y${num}BetaAdj`] ?? row[`${itemKey}_2`] ?? NaN);
      const points = Number(row[`y${num}BetaPoint`] ?? row[`${itemKey}_3`] ?? NaN);

      if (!isNaN(raw) || !isNaN(adjusted) || !isNaN(points)) {
        stock.betas[period] = {
          raw: isNaN(raw) ? null : raw,
          adjusted: isNaN(adjusted) ? null : adjusted,
          dataPoints: isNaN(points) ? null : points,
        };
      }
    }
  }

  return Array.from(stockMap.values());
}
