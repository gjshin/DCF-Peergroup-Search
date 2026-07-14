import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MCP 서버 전용 — 페이지 없음.
  // 서버리스 함수 번들에 data/ 하위 캐시 파일을 포함시키기 위해 tracing include 지정.
  // (동적 경로로 읽는 파일은 NFT가 추적하지 못하므로 전부 명시해야 함)
  outputFileTracingIncludes: {
    "/api/*": [
      "./data/business-cache/**/*.gz",
      "./data/corp-codes.json",
      "./data/company-industry.json",
      "./data/valuation-cache/*.json",
      "./data/peer-snapshot/*.gz",
    ],
  },
};

export default nextConfig;
