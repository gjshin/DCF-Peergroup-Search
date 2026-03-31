export const DART_API_BASE = "https://opendart.fss.or.kr/api";

export const DART_ENDPOINTS = {
  COMPANY: "/company.json",
  FINANCIAL_SINGLE: "/fnlttSinglAcnt.json",
  FINANCIAL_FULL: "/fnlttSinglAcntAll.json",
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

// 이자부부채 계정명 패턴 — 유동/비유동 분류
export const IBD_CURRENT_PATTERNS = [
  "단기차입금",
  "유동성장기부채",
  "유동성장기차입금",
  "유동성사채",
  "유동성전환사채",
  "유동성신주인수권부사채",
  "유동성교환사채",
  "단기사채",
];

export const IBD_NON_CURRENT_PATTERNS = [
  "장기차입금",
  "사채",
  "전환사채",
  "신주인수권부사채",
  "교환사채",
];

// 리스부채는 "유동" 포함 여부로 분류
export const LEASE_LIABILITY_KEYWORD = "리스부채";

// 모든 IBD 패턴 (flat, 기존 호환)
export const ALL_IBD_PATTERNS = [
  ...IBD_CURRENT_PATTERNS,
  ...IBD_NON_CURRENT_PATTERNS,
  LEASE_LIABILITY_KEYWORD,
];

// 비지배지분 계정명 패턴
export const NON_CONTROLLING_INTEREST_PATTERNS = [
  "비지배지분",
  "소수주주지분",
];

// 세전이익 계정명 패턴 (한계세율 산출용)
export const PRETAX_INCOME_PATTERNS = [
  "법인세비용차감전",
  "법인세차감전",
];

// valuation 모드에서 필터링할 모든 계정 키워드
export const VALUATION_ACCOUNT_PATTERNS = [
  ...ALL_IBD_PATTERNS,
  ...NON_CONTROLLING_INTEREST_PATTERNS,
  ...PRETAX_INCOME_PATTERNS,
];
