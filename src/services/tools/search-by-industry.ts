import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { KSIC_CODES, getIndustryName } from "../opendart/ksic-codes";
import { handleApiError } from "../utils/error-handler";

// ─── 스키마 ───

const SearchByIndustrySchema = z.object({
  query: z.string().min(1).describe("업종코드(예: '264') 또는 업종명 키워드(예: '반도체')"),
}).strict();

type SearchByIndustryInput = z.infer<typeof SearchByIndustrySchema>;

// ─── 캐시 데이터 타입 ───

interface CompanyIndustryEntry {
  name: string;
  corpCode: string;
  industryCode: string;
}

// ─── 캐시 로드 (1회) ───

let cachedData: Record<string, CompanyIndustryEntry> | null = null;

function loadIndustryCache(): Record<string, CompanyIndustryEntry> {
  if (cachedData) return cachedData;

  const cachePath = path.resolve(process.cwd(), "data/company-industry.json");
  if (!fs.existsSync(cachePath)) {
    cachedData = {};
    return cachedData;
  }

  cachedData = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  return cachedData!;
}

// ─── 도구 등록 ───

export function registerSearchByIndustryTool(server: McpServer): void {
  server.registerTool(
    "search_by_industry",
    {
      title: "업종별 상장사 검색",
      description: `업종코드 또는 업종명 키워드로 해당 업종의 상장사 리스트를 조회합니다.

[사용 예시]
- { "query": "264" } → 업종코드 264(통신 및 방송장비 제조업)에 해당하는 상장사
- { "query": "반도체" } → 업종명에 "반도체"가 포함되는 상장사
- { "query": "자동차" } → 업종명에 "자동차"가 포함되는 상장사

[반환 데이터 — compact JSON]
- industries: 매칭된 업종 목록 (코드, 이름)
- companies: 해당 업종 상장사 리스트 (종목코드, 회사명)
- count: 총 상장사 수

[Peer 워크플로우 Step 2]
이 도구로 업종 후보군을 확보한 뒤 → get_business_content 로 후보의 사업 내용을 한 종목씩 읽어 정성 필터링 → 최종 확정된 Peer 5~10개를 valuation_get_data 로 배치 조회하는 것이 정규 흐름입니다. 상세는 docs/PEER_GROUP_WORKFLOW.md 참조.`,
      inputSchema: SearchByIndustrySchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params: SearchByIndustryInput) => {
      try {
        const data = loadIndustryCache();
        const query = params.query.trim();

        // 1. 매칭할 업종코드 결정
        let matchedCodes: Set<string>;

        if (/^\d+$/.test(query)) {
          // 숫자 입력 → 업종코드로 검색 (해당 코드 + 하위 코드)
          matchedCodes = new Set<string>();
          for (const code of Object.keys(KSIC_CODES)) {
            if (code === query || code.startsWith(query)) {
              matchedCodes.add(code);
            }
          }
        } else {
          // 키워드 입력 → 업종명에서 검색
          matchedCodes = new Set<string>();
          for (const [code, name] of Object.entries(KSIC_CODES)) {
            if (name.includes(query)) {
              matchedCodes.add(code);
            }
          }
        }

        if (matchedCodes.size === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "매칭되는 업종이 없습니다", query }) }] };
        }

        // 2. 매칭된 업종 목록
        const industries = [...matchedCodes].map((code) => ({
          code,
          name: KSIC_CODES[code] ?? null,
        }));

        // 3. 해당 업종의 상장사 필터링
        const companies: Array<{ code: string; name: string }> = [];
        for (const [stockCode, entry] of Object.entries(data)) {
          if (matchedCodes.has(entry.industryCode)) {
            companies.push({ code: stockCode, name: entry.name });
          }
        }

        // 이름순 정렬
        companies.sort((a, b) => a.name.localeCompare(b.name, "ko"));

        const result = {
          industries,
          companies,
          count: companies.length,
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: handleApiError(error) }], isError: true };
      }
    },
  );
}
