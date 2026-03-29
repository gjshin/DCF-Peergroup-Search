export const API_BASE_URL = "https://datamall.koscom.co.kr";

export const ENDPOINTS = {
  DAILY_RESULT: "/kicpa/check/stock/dailyResultData.json",
  LOGIN: "/kicpa/member/login.do",
  SEARCH_STOCK: "/kicpa/check/stock/popSearchStockCode.do",
} as const;

export const FIXED_PARAMS = {
  screenId: "700030",
  menuNo: "400009",
} as const;

export const COUNTRY_CODE = {
  KR: "1",
  US: "3",
} as const;

export const BETA_PERIOD_TO_ITEM: Record<string, string> = {
  "1Y": "Y1_BETA",
  "2Y": "Y2_BETA",
  "3Y": "Y3_BETA",
  "5Y": "Y5_BETA",
};

export const BASE_ITEMS = [
  "MARKET_NAME",
  "NAME_K",
  "NAME_E",
  "CLOSE_PRICE",
];

export const MAX_STOCK_CODES = 20;
export const CHARACTER_LIMIT = 25000;
