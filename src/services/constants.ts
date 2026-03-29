export const API_BASE_URL = "https://datamall.koscom.co.kr";

export const ENDPOINTS = {
  DAILY_RESULT: "/kicpa/check/stock/dailyResultData.json",
  DAILY_SEARCH_PAGE: "/kicpa/check/stock/dailySearchData.do?screenId=700030&menuNo=400009",
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

// periodType은 숫자 코드로 전송해야 함
export const PERIOD_TYPE_CODE: Record<string, string> = {
  Daily: "1",
  Weekly: "2",
  Monthly: "3",
};

export const BETA_PERIOD_TO_ITEM: Record<string, string> = {
  "1Y": "Y1_BETA",
  "2Y": "Y2_BETA",
  "3Y": "Y3_BETA",
  "5Y": "Y5_BETA",
};

// 서버가 필수로 요구하는 항목들 (SEARCH_DATE, TRADE_DATE, SIMPLE_CODE, PERIOD_NAME)
export const REQUIRED_ITEMS = [
  "SEARCH_DATE",
  "TRADE_DATE",
  "SIMPLE_CODE",
  "PERIOD_NAME",
];

export const BASE_ITEMS = [
  "MARKET_NAME",
  "NAME_K",
  "NAME_E",
  "CLOSE_PRICE",
];

export const URL_VIEW = "/kicpa/check/stock/dailySearchData.do?screenId=700030&amp;menuNo=400009";

export const MAX_STOCK_CODES = 20;
export const CHARACTER_LIMIT = 25000;
