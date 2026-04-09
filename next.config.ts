import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MCP 서버 전용 — 페이지 없음.
  // 서버리스 함수 번들에 data/business-cache/*.gz 파일을 포함시키기 위해 tracing include 지정.
  outputFileTracingIncludes: {
    "/api/*": ["./data/business-cache/**/*.gz", "./data/corp-codes.json"],
  },
};

export default nextConfig;
