export interface NaverTotalInfo {
  code: string;
  key: string;
  value: string;
  valueDesc?: string;
}

export interface NaverPeerCompany {
  stockType: string;
  stockEndType: string;
  itemCode: string;
  stockName: string;
  sosok: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  fluctuationsRatio: string;
  marketValue: string;
}

export interface NaverIntegrationResponse {
  stockEndType: string;
  itemCode: string;
  stockName: string;
  totalInfos: NaverTotalInfo[];
  industryCode: string;
  industryCompareInfo: NaverPeerCompany[];
  consensusInfo?: {
    itemCode: string;
    recommMean: string;
    priceTargetMean: string;
  };
}

export interface MarketDataResult {
  stockCode: string;
  stockName: string;
  price: number | null;
  marketCap: string | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  dividendYield: number | null;
  foreignRate: string | null;
  industryCode: string;
  peers: PeerInfo[];
  consensusTargetPrice: string | null;
}

export interface PeerInfo {
  code: string;
  name: string;
  marketCap: string;
  price: string;
}
