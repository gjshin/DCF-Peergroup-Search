export interface BetaResultItem {
  // camelCase 응답 필드
  searchDate?: string;
  tradeDate?: number | string;
  marketName?: string;
  simpleCode?: string;
  nameK?: string;
  nameE?: string;
  periodName?: string;
  closePrice?: number | string;
  // 베타 필드 (camelCase)
  y1Beta?: number;
  y1BetaAdj?: number;
  y1BetaPoint?: number;
  y2Beta?: number;
  y2BetaAdj?: number;
  y2BetaPoint?: number;
  y3Beta?: number;
  y3BetaAdj?: number;
  y3BetaPoint?: number;
  y5Beta?: number;
  y5BetaAdj?: number;
  y5BetaPoint?: number;
  // fallback for legacy field names
  [key: string]: string | number | undefined;
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

export interface SearchStockResult {
  code: string;
  name: string;
  market?: string;
}
