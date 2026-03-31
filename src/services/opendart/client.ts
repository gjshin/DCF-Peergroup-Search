import axios from "axios";
import {
  DART_API_BASE,
  DART_ENDPOINTS,
  IBD_CURRENT_PATTERNS,
  IBD_NON_CURRENT_PATTERNS,
  LEASE_LIABILITY_KEYWORD,
  NON_CONTROLLING_INTEREST_PATTERNS,
  PRETAX_INCOME_PATTERNS,
  VALUATION_ACCOUNT_PATTERNS,
  REPORT_CODE_LABEL,
} from "./constants";
import type {
  DartCompanyInfo,
  DartFinancialResponse,
  DartFinancialItem,
  DartStockQuantityResponse,
  SharesInfo,
  DebtSummary,
  DebtCategory,
  ValuationFinancials,
} from "./types";

function getApiKey(): string {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    throw new Error("OPENDART_API_KEY 환경변수가 설정되지 않았습니다. OpenDART에서 API 키를 발급받아 설정해주세요.");
  }
  return key;
}

// ─── 기업정보 ───

export async function fetchCompanyInfo(corpCode: string): Promise<DartCompanyInfo> {
  const response = await axios.get<DartCompanyInfo>(`${DART_API_BASE}${DART_ENDPOINTS.COMPANY}`, {
    params: { crtfc_key: getApiKey(), corp_code: corpCode },
    timeout: 15000,
  });

  if (response.data.status !== "000") {
    throw new Error(`DART_ERROR: ${response.data.message} (status: ${response.data.status})`);
  }

  return response.data;
}

// ─── 재무제표 ───

export async function fetchFinancials(
  corpCode: string,
  year: string,
  reportCode: string = "11011",
  fsDiv: string = "CFS"
): Promise<DartFinancialItem[]> {
  const response = await axios.get<DartFinancialResponse>(`${DART_API_BASE}${DART_ENDPOINTS.FINANCIAL_FULL}`, {
    params: {
      crtfc_key: getApiKey(),
      corp_code: corpCode,
      bsns_year: year,
      reprt_code: reportCode,
      fs_div: fsDiv,
    },
    timeout: 30000,
  });

  if (response.data.status !== "000") {
    if (response.data.status === "013") return [];
    throw new Error(`DART_ERROR: ${response.data.message} (status: ${response.data.status})`);
  }

  return response.data.list ?? [];
}

// ─── 주식수 ───

export async function fetchStockQuantity(
  corpCode: string,
  year: string,
  reportCode: string = "11011"
): Promise<DartStockQuantityResponse> {
  const response = await axios.get<DartStockQuantityResponse>(`${DART_API_BASE}${DART_ENDPOINTS.STOCK_QUANTITY}`, {
    params: {
      crtfc_key: getApiKey(),
      corp_code: corpCode,
      bsns_year: year,
      reprt_code: reportCode,
    },
    timeout: 15000,
  });

  if (response.data.status !== "000" && response.data.status !== "013") {
    throw new Error(`DART_ERROR: ${response.data.message} (status: ${response.data.status})`);
  }

  return response.data;
}

// ─── 데이터 추출 ───

export function extractSharesInfo(response: DartStockQuantityResponse, year: string, reportCode: string): SharesInfo | null {
  if (!response.list || response.list.length === 0) return null;

  const commonStock = response.list.find(
    (item) => item.se === "보통주" || item.se.includes("보통주")
  );

  if (!commonStock) return null;

  const parseNum = (s: string) => {
    const cleaned = s.replace(/[,\s-]/g, "");
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  };

  return {
    totalIssued: parseNum(commonStock.istc_totqy),
    treasuryStock: parseNum(commonStock.tesstk_co),
    outstanding: parseNum(commonStock.distb_stock_co),
    stockType: commonStock.se,
    source: `OpenDART stockTotqySttus (${year} ${REPORT_CODE_LABEL[reportCode] ?? reportCode})`,
  };
}

/**
 * 이자부부채를 유동/비유동으로 분류하여 추출
 */
export function extractDebtSummary(items: DartFinancialItem[]): DebtSummary {
  const current: DebtCategory = { total: 0, items: [] };
  const nonCurrent: DebtCategory = { total: 0, items: [] };
  let nonControllingInterest: number | null = null;
  let pretaxIncome: number | null = null;

  for (const item of items) {
    const amount = parseInt((item.thstrm_amount ?? "").replace(/[,\s]/g, ""), 10);
    if (isNaN(amount)) continue;

    const name = item.account_nm;
    const sjDiv = item.sj_div; // BS, IS, CIS, CF, SCE

    // ── 이자부부채: BS(재무상태표) 항목만 ──
    if (sjDiv === "BS") {
      // 리스부채 — "유동" 포함 여부로 분류
      if (name.includes(LEASE_LIABILITY_KEYWORD)) {
        if (name.includes("유동")) {
          current.total += amount;
          current.items.push({ account: name, amount });
        } else {
          nonCurrent.total += amount;
          nonCurrent.items.push({ account: name, amount });
        }
        continue;
      }

      // 유동 이자부부채 (유동성~ 패턴을 먼저 체크)
      if (IBD_CURRENT_PATTERNS.some((p) => name.includes(p))) {
        current.total += amount;
        current.items.push({ account: name, amount });
        continue;
      }

      // 비유동 이자부부채
      if (IBD_NON_CURRENT_PATTERNS.some((p) => name.includes(p))) {
        nonCurrent.total += amount;
        nonCurrent.items.push({ account: name, amount });
        continue;
      }

      // 비지배지분 (BS)
      if (NON_CONTROLLING_INTEREST_PATTERNS.some((p) => name.includes(p))) {
        nonControllingInterest = amount;
        continue;
      }
    }

    // ── 세전이익: IS/CIS(손익계산서) 항목만 ──
    if ((sjDiv === "IS" || sjDiv === "CIS") && PRETAX_INCOME_PATTERNS.some((p) => name.includes(p))) {
      pretaxIncome = amount;
    }
  }

  return {
    interestBearingDebt: current.total + nonCurrent.total,
    current,
    nonCurrent,
    nonControllingInterest,
    pretaxIncome,
  };
}

/**
 * 밸류에이션 모드: 전체 재무제표에서 필요한 계정만 필터링
 * 50-70KB → 2-3KB로 감소
 */
export function filterForValuation(items: DartFinancialItem[]): DartFinancialItem[] {
  return items.filter((item) =>
    VALUATION_ACCOUNT_PATTERNS.some((pattern) => item.account_nm.includes(pattern))
  );
}

/**
 * 밸류에이션 필수 데이터만 추출 (IBD + 비지배지분 + 세전이익 + 주식수)
 */
export function extractValuationFinancials(items: DartFinancialItem[]): ValuationFinancials {
  const debt = extractDebtSummary(items);

  // 필터된 계정 목록 (참고용)
  const filteredItems = filterForValuation(items).map((f) => ({
    category: f.sj_nm,
    sjDiv: f.sj_div,
    account: f.account_nm,
    currentAmount: f.thstrm_amount,
    previousAmount: f.frmtrm_amount,
  }));

  return { debt, filteredItems };
}
