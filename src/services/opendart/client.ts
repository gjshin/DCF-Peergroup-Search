import axios from "axios";
import { DART_API_BASE, DART_ENDPOINTS, INTEREST_BEARING_DEBT_PATTERNS, NON_CONTROLLING_INTEREST_PATTERNS, REPORT_CODE_LABEL } from "./constants";
import type { DartCompanyInfo, DartFinancialResponse, DartFinancialItem, DartStockQuantityResponse, SharesInfo, DebtSummary } from "./types";

function getApiKey(): string {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    throw new Error("OPENDART_API_KEY 환경변수가 설정되지 않았습니다. OpenDART에서 API 키를 발급받아 설정해주세요.");
  }
  return key;
}

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

export async function fetchCompanyByStockCode(stockCode: string): Promise<DartCompanyInfo> {
  // OpenDART company.json은 corp_code로만 검색 가능
  // stock_code로 검색하려면 corp_code 목록에서 매핑 필요
  // 대안: corpCode.xml을 다운로드하거나, 다른 방법 사용
  // 여기서는 stock-code-resolver를 통해 corp_code를 먼저 얻은 후 호출
  throw new Error("Use stock-code-resolver to get corp_code first");
}

export async function fetchFinancials(
  corpCode: string,
  year: string,
  reportCode: string = "11011",
  fsDiv: string = "CFS"
): Promise<DartFinancialItem[]> {
  const response = await axios.get<DartFinancialResponse>(`${DART_API_BASE}${DART_ENDPOINTS.FINANCIAL_SINGLE}`, {
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
    // 013 = 조회된 데이터가 없습니다
    if (response.data.status === "013") {
      return [];
    }
    throw new Error(`DART_ERROR: ${response.data.message} (status: ${response.data.status})`);
  }

  return response.data.list ?? [];
}

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

export function extractSharesInfo(response: DartStockQuantityResponse, year: string, reportCode: string): SharesInfo | null {
  if (!response.list || response.list.length === 0) return null;

  // 보통주 항목 찾기
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

export function extractDebtSummary(items: DartFinancialItem[]): DebtSummary {
  const details: { account: string; amount: number; sjDiv: string }[] = [];
  let nonControllingInterest: number | null = null;

  for (const item of items) {
    const amount = parseInt((item.thstrm_amount ?? "").replace(/[,\s]/g, ""), 10);
    if (isNaN(amount)) continue;

    // 이자부부채 확인
    if (INTEREST_BEARING_DEBT_PATTERNS.some((p) => item.account_nm.includes(p))) {
      details.push({
        account: item.account_nm,
        amount,
        sjDiv: item.sj_div,
      });
    }

    // 비지배지분 확인
    if (NON_CONTROLLING_INTEREST_PATTERNS.some((p) => item.account_nm.includes(p))) {
      nonControllingInterest = amount;
    }
  }

  const interestBearingDebt = details.reduce((sum, d) => sum + d.amount, 0);

  return { interestBearingDebt, details, nonControllingInterest };
}
