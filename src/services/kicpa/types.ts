// KICPA/KOSCOM 조회 경로는 제거되었으나, 베타 결과의 공유 타입(BetaValues / StockBetaResult)은
// beta-calc(직접계산)·valuation-data·formatters가 계속 사용하므로 이 파일에 유지한다.

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
