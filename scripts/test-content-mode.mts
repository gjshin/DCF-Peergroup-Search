// 로컬 dev 서버 E2E — content_mode summary/full 응답 크기·내용 검증
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_ = process.argv[2] ?? "http://localhost:3000/api/mcp";

async function call(args: Record<string, unknown>) {
  const client = new Client({ name: "verify", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));
  const res = await client.callTool({ name: "peergroup_get_population", arguments: args });
  await client.close();
  const text = (res.content as Array<{ type: string; text: string }>)
    .filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return JSON.parse(text);
}

const base = { valuation_date: "20251231", industry_code: "261", include_content: true, page: 1, page_size: 5 };

const sum = await call(base); // content_mode 기본값 = summary
const full = await call({ ...base, content_mode: "full" });

const size = (o: unknown) => JSON.stringify(o).length;
console.log(`meta.populationHash: ${sum.meta.populationHash} (total ${sum.meta.total})`);
console.log(`페이지 응답 크기: summary ${size(sum)}자 vs full ${size(full)}자 (${Math.round((size(sum) / size(full)) * 100)}%)`);

const c0 = sum.companies[0];
console.log(`\n[summary] ${c0.code} ${c0.name} (contentMode=${c0.contentMode})`);
console.log("overview:", c0.overview?.slice(0, 300));
console.log("segments(앞 300자):", c0.segments?.slice(0, 300));
const f0 = full.companies[0];
console.log(`\n[full] overview 길이 ${f0.overview?.length} / segments 길이 ${f0.segments?.length}`);

// 결정론: summary 2회 호출 동일
const sum2 = await call(base);
console.log("\nsummary 2회 호출 동일:", JSON.stringify(sum) === JSON.stringify(sum2));
