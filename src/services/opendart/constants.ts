export const DART_API_BASE = "https://opendart.fss.or.kr/api";

export const DART_ENDPOINTS = {
  COMPANY: "/company.json",
  FINANCIAL_SINGLE: "/fnlttSinglAcnt.json",
  FINANCIAL_FULL: "/fnlttSinglAllAcnt.json",
  STOCK_QUANTITY: "/stockTotqySttus.json",
} as const;

export const REPORT_CODE: Record<string, string> = {
  annual: "11011",
  semi: "11012",
  q1: "11013",
  q3: "11014",
};

export const REPORT_CODE_LABEL: Record<string, string> = {
  "11011": "사업보고서",
  "11012": "반기보고서",
  "11013": "1분기보고서",
  "11014": "3분기보고서",
};

// 이자부부채 계정명 패턴
export const INTEREST_BEARING_DEBT_PATTERNS = [
  "단기차입금",
  "유동성장기부채",
  "장기차입금",
  "사채",
  "전환사채",
  "신주인수권부사채",
  "교환사채",
  "단기사채",
];

// 비지배지분 계정명 패턴
export const NON_CONTROLLING_INTEREST_PATTERNS = [
  "비지배지분",
  "소수주주지분",
];
