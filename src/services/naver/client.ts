import axios from "axios";
import type { NaverIntegrationResponse, MarketDataResult, PeerInfo } from "./types";

const NAVER_API_BASE = "https://m.stock.naver.com/api/stock";

export async function fetchMarketData(stockCode: string): Promise<MarketDataResult> {
  const response = await axios.get<NaverIntegrationResponse>(
    `${NAVER_API_BASE}/${stockCode}/integration`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KicpaBetaMCP/1.0)",
      },
      timeout: 15000,
    }
  );

  const data = response.data;
  const infos = new Map(data.totalInfos.map((i) => [i.key, i.value]));

  const parseNumber = (val: string | undefined): number | null => {
    if (!val) return null;
    const cleaned = val.replace(/[,배원%조억백만\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  };

  const peers: PeerInfo[] = (data.industryCompareInfo ?? []).map((p) => ({
    code: p.itemCode,
    name: p.stockName,
    marketCap: p.marketValue,
    price: p.closePrice,
  }));

  return {
    stockCode: data.itemCode,
    stockName: data.stockName,
    price: parseNumber(infos.get("종가") ?? data.totalInfos.find(i => i.code === "lastClosePrice")?.value ?? infos.get("전일")),
    marketCap: infos.get("시총") ?? null,
    per: parseNumber(infos.get("PER")),
    pbr: parseNumber(infos.get("PBR")),
    eps: parseNumber(infos.get("EPS")),
    bps: parseNumber(infos.get("BPS")),
    dividendYield: parseNumber(infos.get("배당수익률")),
    foreignRate: infos.get("외인소진율") ?? null,
    industryCode: data.industryCode ?? "",
    peers,
    consensusTargetPrice: data.consensusInfo?.priceTargetMean ?? null,
  };
}

export async function fetchHistoricalPrices(
  stockCode: string,
  startDate: string,
  endDate: string
): Promise<Array<{ date: string; close: number }>> {
  const response = await axios.get<string>(
    `https://api.finance.naver.com/siseJson.naver`,
    {
      params: {
        symbol: stockCode,
        requestType: 1,
        startTime: startDate,
        endTime: endDate,
        timeframe: "day",
      },
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KicpaBetaMCP/1.0)",
      },
      timeout: 15000,
    }
  );

  // 응답 형식: [['날짜','시가','고가','저가','종가','거래량','외국인소진율'], ["20260102", 120200, ...], ...]
  const text = response.data;
  const lines = text.split("\n").filter((l) => l.trim().startsWith("[\""));

  return lines.map((line) => {
    const match = line.match(/\["(\d{8})",\s*\d+,\s*\d+,\s*\d+,\s*(\d+)/);
    if (!match) return null;
    return { date: match[1], close: parseInt(match[2], 10) };
  }).filter((item): item is { date: string; close: number } => item !== null);
}
