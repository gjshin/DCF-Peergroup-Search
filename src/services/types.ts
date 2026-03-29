export interface BetaResultItem {
  MARKET_NAME?: string;
  NAME_K?: string;
  NAME_E?: string;
  PERIOD_NAME?: string;
  CLOSE_PRICE?: string;
  [key: string]: string | undefined;
}

export interface ApiResponse {
  resultCode: "success" | "error";
  resultList?: BetaResultItem[];
  itemInfoList?: Array<{ itemName: string; itemNameKo: string }>;
  paramVO?: Record<string, unknown>;
  totalCnt?: number;
}

export interface BetaValues {
  raw: number | null;
  adjusted: number | null;
  dataPoints: number | null;
}

export interface StockBetaResult {
  stockCode: string;
  stockNameKr: string;
  stockNameEn: string;
  market: string;
  closePrice: string;
  date: string;
  betas: Record<string, BetaValues>;
}

export interface AuthConfig {
  mode: "session" | "credentials";
  sessionId?: string;
  username?: string;
  password?: string;
}

export interface SearchStockResult {
  code: string;
  name: string;
  market?: string;
}
