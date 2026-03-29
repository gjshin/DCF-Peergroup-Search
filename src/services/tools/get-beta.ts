import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchBetaData } from "../koscom-client";
import { handleApiError } from "../utils/error-handler";
import { formatBetaResultsMarkdown, formatBetaResultsJson } from "../utils/formatters";
import { MAX_STOCK_CODES } from "../constants";

const GetBetaInputSchema = z.object({
  stock_codes: z.array(z.string().min(1))
    .min(1, "종목코드를 최소 1개 입력해주세요")
    .max(MAX_STOCK_CODES, `종목코드는 최대 ${MAX_STOCK_CODES}개까지 가능합니다`)
    .describe("종목코드 배열. 국내: 6자리 숫자 (예: '005930'), 미국: 티커 (예: 'AAPL')"),
  date: z.string()
    .regex(/^\d{8}$/, "날짜는 YYYYMMDD 형식이어야 합니다 (예: 20260328)")
    .optional()
    .describe("조회일자 (YYYYMMDD). 미입력 시 오늘 날짜"),
  country: z.enum(["KR", "US"])
    .default("KR")
    .describe("국가: KR(국내, 기본값) 또는 US(미국)"),
  period_type: z.enum(["Daily", "Weekly", "Monthly"])
    .default("Daily")
    .describe("수익률 주기: Daily(일별, 기본값), Weekly(주별), Monthly(월별)"),
  beta_periods: z.array(z.enum(["1Y", "2Y", "3Y", "5Y"]))
    .default(["1Y", "2Y", "3Y", "5Y"])
    .describe("베타 산출 기간: 1Y(1년), 2Y(2년), 3Y(3년), 5Y(5년). 기본값은 전체"),
  response_format: z.enum(["markdown", "json"])
    .default("markdown")
    .describe("출력 형식: markdown(사람이 읽기 좋은 표) 또는 json(기계 처리용)"),
}).strict();

type GetBetaInput = z.infer<typeof GetBetaInputSchema>;

export function registerGetBetaTool(server: McpServer): void {
  server.registerTool(
    "kicpa_get_beta",
    {
      title: "KICPA 베타계수 조회",
      description: `한국공인회계사회(KICPA) CHECKExpert+ 서비스에서 주식 종목의 베타계수를 조회합니다.

베타계수는 개별 주식의 시장 대비 변동성을 나타내는 지표입니다.
- 실질베타 (Raw Beta): 회귀분석으로 산출된 원시 베타
- 조정베타 (Adjusted Beta): 실질베타 × 2/3 + 1/3 으로 산출
- 대표지수: 국내 KOSPI, 미국 S&P500

Args:
  - stock_codes (string[]): 종목코드 배열 (최대 20개). 국내 6자리, 미국 티커
  - date (string, optional): 조회일자 YYYYMMDD
  - country ('KR' | 'US'): 국가 (기본: KR)
  - period_type ('Daily' | 'Weekly' | 'Monthly'): 주기 (기본: Daily)
  - beta_periods (string[]): 베타 기간 1Y/2Y/3Y/5Y (기본: 전체)
  - response_format ('markdown' | 'json'): 출력 형식 (기본: markdown)

Examples:
  - 삼성전자 베타 조회: stock_codes=["005930"]
  - 삼성전자+SK하이닉스 5년 베타: stock_codes=["005930","000660"], beta_periods=["5Y"]
  - 미국 AAPL 베타: stock_codes=["AAPL"], country="US"`,
      inputSchema: GetBetaInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: GetBetaInput) => {
      try {
        const defaultDate = formatDateToYYYYMMDD(new Date());

        const results = await fetchBetaData({
          stockCodes: params.stock_codes,
          date: params.date ?? defaultDate,
          country: params.country,
          periodType: params.period_type,
          betaPeriods: params.beta_periods,
        });

        if (results.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "조회 결과가 없습니다. 종목코드와 날짜(영업일)를 확인해주세요.",
            }],
          };
        }

        const text = params.response_format === "json"
          ? formatBetaResultsJson(results)
          : formatBetaResultsMarkdown(results);

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: handleApiError(error) }],
          isError: true,
        };
      }
    }
  );
}

function formatDateToYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
