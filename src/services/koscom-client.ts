import axios from "axios";
import {
  API_BASE_URL,
  ENDPOINTS,
  FIXED_PARAMS,
  COUNTRY_CODE,
  BETA_PERIOD_TO_ITEM,
  BASE_ITEMS,
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
      "Referer": `${API_BASE_URL}/kicpa/check/stock/dailySearchData.do`,
      "X-Requested-With": "XMLHttpRequest",
    },
    timeout: 30000,
  });

  if (response.data.resultCode === "error" && !retried) {
    try {
      await refreshSession();
      return makeAuthenticatedRequest(url, data, true);
    } catch {
      // 재인증 실패 시 원래 에러 응답 반환
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
  const allItems = [...BASE_ITEMS, ...betaItems];

  const formParams = new URLSearchParams();
  formParams.append("screenId", FIXED_PARAMS.screenId);
  formParams.append("menuNo", FIXED_PARAMS.menuNo);
  formParams.append("stdCode", stockCodes.join(","));
  formParams.append("sdate", date);
  formParams.append("periodType", periodType);
  formParams.append("gubun", COUNTRY_CODE[country]);
  for (const item of allItems) {
    formParams.append("itemName", item);
  }

  const apiResponse = await makeAuthenticatedRequest(
    `${API_BASE_URL}${ENDPOINTS.DAILY_RESULT}`,
    formParams.toString()
  );

  if (apiResponse.resultCode !== "success" || !apiResponse.resultList) {
    throw new Error(
      "API_ERROR: 데이터 조회에 실패했습니다. 세션 만료이거나 유효하지 않은 조회 조건입니다."
    );
  }

  return parseResultList(apiResponse.resultList, stockCodes, betaPeriods, date);
}

function parseResultList(
  resultList: Record<string, string | undefined>[],
  stockCodes: string[],
  betaPeriods: string[],
  date: string
): StockBetaResult[] {
  const stockMap = new Map<string, StockBetaResult>();

  for (const row of resultList) {
    const nameKr = row["NAME_K"] ?? "";
    const nameEn = row["NAME_E"] ?? "";
    const market = row["MARKET_NAME"] ?? "";
    const closePrice = row["CLOSE_PRICE"] ?? "";
    const tradeDate = (row["tradeDate"] as string) ?? date;

    const key = nameKr || nameEn || market;
    if (!stockMap.has(key)) {
      const idx = stockMap.size;
      stockMap.set(key, {
        stockCode: stockCodes[idx] ?? "",
        stockNameKr: nameKr,
        stockNameEn: nameEn,
        market,
        closePrice,
        date: tradeDate,
        betas: {},
      });
    }

    const stock = stockMap.get(key)!;

    for (const period of betaPeriods) {
      const itemKey = BETA_PERIOD_TO_ITEM[period];
      if (!itemKey) continue;

      const raw = parseFloat(row[`${itemKey}_1`] ?? "");
      const adjusted = parseFloat(row[`${itemKey}_2`] ?? "");
      const points = parseFloat(row[`${itemKey}_3`] ?? "");

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
