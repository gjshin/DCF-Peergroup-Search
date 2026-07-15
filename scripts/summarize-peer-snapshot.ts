/**
 * 피어 스냅샷 요약 필드 생성 — 원문 보존, 요약 필드 추가
 *
 * - overviewSummary: "사업의 개요"를 claude CLI(-p 헤드리스)로 3~4문장 요약
 * - segmentsSummary: 매출실적 표 발췌(segmentsBrief)를 부문별 금액·비중 한 줄로 LLM 요약
 * - segmentsBrief:   "매출 및 수주상황"에서 매출실적 표 구간만 결정론적으로 절단
 *                    (판매경로/판매방법/판매전략/수주상황 등 서술부 제거 — 요약 실패 시 폴백)
 *
 * 재개 가능: 진행 파일(data/peer-snapshot/{overview|segments}-summaries-{date}.json)에
 * 배치마다 저장. 전 종목 완료 시 스냅샷 .json.gz 에 병합 기록(원문 필드는 그대로 유지).
 *
 * 사용:
 *   npx tsx scripts/summarize-peer-snapshot.ts 20251231            # 요약 생성 + 완료 시 병합
 *   npx tsx scripts/summarize-peer-snapshot.ts 20251231 --limit 20 # 시험 실행(병합 안 함)
 *   npx tsx scripts/summarize-peer-snapshot.ts 20251231 --merge-only
 */

import { execFile } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";

const SNAPSHOT_DIR = path.join(process.cwd(), "data", "peer-snapshot");
const BATCH_SIZE = 10; // claude 1회 호출당 종목 수
const CONCURRENCY = 3; // 동시 claude 프로세스 수
const CLAUDE_TIMEOUT_MS = 180_000;
const OVERVIEW_INPUT_CAP = 6000; // 프롬프트에 넣는 개요 원문 상한 (p90 수준)

// ─── 부문매출 결정론적 절단 ───

/** 매출실적 표 구간 뒤에 붙는 서술부(판매경로·판매전략·수주상황 등)의 시작 마커 */
const SEGMENT_CUT_PATTERNS: RegExp[] = [
  /\n\s*(?:나|다|라)\s*\.\s*(?:판매|수주|주요\s*계약)/, // 나. 판매경로 / 다. 수주상황 …
  /\n\s*\(?\d\)?\s*\.?\s*판매\s*(?:경로|조직|방법|전략)/, // 2. 판매경로 / (1) 판매조직 …
  /\n\s*판매\s*(?:경로|조직|방법|전략)/,
  /\n\s*(?:나|다|라)\s*\.\s/, // 그 외 나./다./라. 하위절 (매출실적은 통상 '가.')
];

/** 매출 표 구간만 남기고 서술부를 제거 + 공백 정리. 원문이 null 이면 null. */
export function compactSegments(segments: string | null, maxChars = 2000): string | null {
  if (segments === null) return null;
  let cutAt = segments.length;
  for (const re of SEGMENT_CUT_PATTERNS) {
    const m = re.exec(segments);
    // 머리말(가. 매출실적 등)을 지나친 지점부터만 유효한 절단점으로 인정
    if (m && m.index > 80 && m.index < cutAt) cutAt = m.index;
  }
  let out = segments.slice(0, cutAt);
  out = out
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (out.length > maxChars) out = out.slice(0, maxChars) + "\n…[이하 생략]";
  return out || null;
}

// ─── 부문매출 요약 정규화 ───

/** "제73기 3분기(백만원):" 류의 기간·단위 머리말 판별 — 부문명에 콜론이 든 경우를 오절단하지 않게 좁게 잡는다 */
const PERIOD_HEAD =
  /(제\s*\d+\s*기|\d+\s*분기|당\s*분기|당\s*반기|\d{4}\s*년|\([^)]*원[^)]*\)|\(\s*단위[^)]*\))/;

/**
 * 부문매출 요약에서 선두 기간·단위 머리말을 제거해 부문 구성만 남긴다.
 * 구프롬프트로 생성된 진행 파일과 신프롬프트 출력 모두에 적용 가능(멱등).
 */
export function stripPeriodPrefix(s: string | null): string | null {
  if (s === null) return null;
  const m = /^([^:：]{1,40})[:：]\s*/.exec(s);
  if (!m || !PERIOD_HEAD.test(m[1])) return s;
  const rest = s.slice(m[0].length).trim();
  return rest || s;
}

// ─── LLM 요약 공용부 (claude -p) ───

const OVERVIEW_HEADER = `다음은 한국 상장사들의 사업보고서 "사업의 개요" 원문이다. 각 회사별로 3~4문장으로 요약하라.

요약 목적: 기업가치평가에서 피평가회사와의 "사업 유사성" 판단 재료. 반드시 포함할 것:
- 주력 사업/제품·서비스 (무엇으로 돈을 버는가)
- 사업 부문 구성 (복수 부문이면 각각)
- 주요 전방시장/고객 (있으면)
산업 일반론·거시경제 서술은 제외하라.`;

const SEGMENTS_HEADER = `다음은 한국 상장사들의 사업보고서 "매출실적" 표 발췌다. 각 회사별로 부문별(품목별) 매출 구성을 한 줄로 요약하라.

규칙:
- 가장 최근 보고기간(통상 첫 번째 금액 열) 기준으로 요약한다. **기간·금액단위 머리말은 쓰지 말고 부문 구성만** 적을 것
- 형식 예: "반도체(Wafer 등) 974,005 (96%) · 골프장·부동산 13,519 (1%) · 건설 1,080 (0%) · 합금철 20,833 (2%)"
- 비중(%)은 합계 대비 계산해 정수로. 부문이 하나뿐이면 (100%)
- 부문 구분이 없고 수출/내수만 있으면 그 구분으로 요약
- 표에 없는 내용은 지어내지 말 것. 매출 수치가 없으면 "매출 표 없음"이라고만 쓸 것`;

interface LlmItem {
  code: string;
  name: string;
  text: string;
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["-p", "--model", "haiku", "--output-format", "text"],
      { timeout: CLAUDE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, shell: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`claude 실행 실패: ${err.message} ${String(stderr).slice(0, 200)}`));
        else resolve(String(stdout));
      }
    );
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

function buildPrompt(header: string, items: LlmItem[]): string {
  const blocks = items.map((it) => `### ${it.code} ${it.name}\n${it.text}`).join("\n\n");
  return `${header}

출력은 아래 형식의 JSON 객체 하나만 출력하라 (코드블록·설명 금지):
{"종목코드": "요약문", ...}

${blocks}`;
}

function parseSummaryJson(raw: string, codes: string[], minLen: number): Record<string, string> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`JSON 없음: ${raw.slice(0, 120)}`);
  const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const code of codes) {
    const v = obj[code];
    if (typeof v === "string" && v.trim().length >= minLen) out[code] = v.trim();
  }
  return out;
}

/** 배치·병렬·단건 재시도·진행 파일 저장을 포함한 LLM 요약 1단계 실행 (재개 가능) */
async function runLlmPhase(opts: {
  label: string;
  header: string;
  items: LlmItem[];
  progressPath: string;
  minLen: number;
  limit: number;
}): Promise<Record<string, string>> {
  const progress: Record<string, string> = existsSync(opts.progressPath)
    ? (JSON.parse(readFileSync(opts.progressPath, "utf-8")) as Record<string, string>)
    : {};
  const targets = opts.items
    .filter((it) => !progress[it.code])
    .slice(0, Number.isFinite(opts.limit) ? opts.limit : undefined);
  console.log(`${opts.label} 대상: ${targets.length}종목 (완료분 ${Object.keys(progress).length} 제외)`);
  if (!targets.length) return progress;

  const batches: LlmItem[][] = [];
  for (let i = 0; i < targets.length; i += BATCH_SIZE) batches.push(targets.slice(i, i + BATCH_SIZE));

  let done = 0;
  let failed = 0;
  const saveProgress = () => writeFileSync(opts.progressPath, JSON.stringify(progress), "utf-8");

  async function worker(queue: LlmItem[][]): Promise<void> {
    for (;;) {
      const items = queue.shift();
      if (!items) return;
      const codes = items.map((i) => i.code);
      try {
        let got: Record<string, string> = {};
        try {
          got = parseSummaryJson(await runClaude(buildPrompt(opts.header, items)), codes, opts.minLen);
        } catch {
          got = parseSummaryJson(await runClaude(buildPrompt(opts.header, items)), codes, opts.minLen); // 1회 재시도
        }
        const missing = codes.filter((c) => !got[c]);
        Object.assign(progress, got);
        // 배치에서 누락된 종목은 단건 재시도
        for (const code of missing) {
          const it = items.find((i) => i.code === code)!;
          try {
            const one = parseSummaryJson(await runClaude(buildPrompt(opts.header, [it])), [code], opts.minLen);
            if (one[code]) progress[code] = one[code];
            else failed++;
          } catch {
            failed++;
          }
        }
      } catch (e) {
        failed += codes.length;
        console.warn(`배치 실패 (${codes[0]}~): ${(e as Error).message.slice(0, 120)}`);
      }
      done++;
      saveProgress();
      if (done % 10 === 0 || done === batches.length) {
        console.log(`  [${opts.label}] ${done}/${batches.length} 배치 — 누적 ${Object.keys(progress).length}건, 실패 ${failed}`);
      }
    }
  }

  const queue = [...batches];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log(`${opts.label} 완료: ${Object.keys(progress).length}건 (실패 ${failed})`);
  return progress;
}

// ─── 메인 ───

interface SnapshotCompany {
  name: string;
  overview: string | null;
  segments: string | null;
  overviewSummary?: string | null;
  segmentsSummary?: string | null;
  segmentsBrief?: string | null;
  [k: string]: unknown;
}

async function main(): Promise<void> {
  const dateArg = process.argv[2];
  if (!/^\d{8}$/.test(dateArg ?? "")) {
    console.error("사용법: npx tsx scripts/summarize-peer-snapshot.ts YYYYMMDD [--limit N] [--merge-only]");
    process.exit(1);
  }
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx > 0 ? Number(process.argv[limitIdx + 1]) : Infinity;
  const mergeOnly = process.argv.includes("--merge-only");

  const snapPath = path.join(SNAPSHOT_DIR, `${dateArg}.json.gz`);
  const ovProgressPath = path.join(SNAPSHOT_DIR, `overview-summaries-${dateArg}.json`);
  const segProgressPath = path.join(SNAPSHOT_DIR, `segments-summaries-${dateArg}.json`);

  const snapshot = JSON.parse(gunzipSync(readFileSync(snapPath)).toString("utf-8")) as {
    _meta: Record<string, unknown>;
    companies: Record<string, SnapshotCompany>;
  };
  const entries = Object.entries(snapshot.companies);
  console.log(`스냅샷 ${dateArg}: ${entries.length}종목`);

  // 부문매출 발췌(결정론)는 LLM 입력이자 폴백 — 먼저 계산
  const briefs = new Map<string, string | null>(
    entries.map(([code, c]) => [code, compactSegments(c.segments)])
  );

  let ovProgress: Record<string, string> = existsSync(ovProgressPath)
    ? JSON.parse(readFileSync(ovProgressPath, "utf-8"))
    : {};
  let segProgress: Record<string, string> = existsSync(segProgressPath)
    ? JSON.parse(readFileSync(segProgressPath, "utf-8"))
    : {};

  if (!mergeOnly) {
    ovProgress = await runLlmPhase({
      label: "개요 요약",
      header: OVERVIEW_HEADER,
      items: entries
        .filter(([, c]) => c.overview !== null)
        .map(([code, c]) => ({ code, name: c.name, text: (c.overview as string).slice(0, OVERVIEW_INPUT_CAP) })),
      progressPath: ovProgressPath,
      minLen: 20,
      limit,
    });
    segProgress = await runLlmPhase({
      label: "부문매출 요약",
      header: SEGMENTS_HEADER,
      items: entries
        .filter(([code]) => briefs.get(code) !== null)
        .map(([code, c]) => ({ code, name: c.name, text: briefs.get(code) as string })),
      progressPath: segProgressPath,
      minLen: 4, // "매출 표 없음" 같은 짧은 정상 응답 허용
      limit,
    });
    if (Number.isFinite(limit)) {
      console.log("--limit 시험 실행 — 병합 생략. 진행 파일:", ovProgressPath, "/", segProgressPath);
      return;
    }
  }

  // 병합: 요약(LLM) + 발췌(결정론) → 스냅샷 재기록 (원문 보존)
  const withOverview = entries.filter(([, c]) => c.overview !== null).length;
  const withSegments = entries.filter(([code]) => briefs.get(code) !== null).length;
  const ovCovered = entries.filter(([code]) => ovProgress[code]).length;
  const segCovered = entries.filter(([code]) => segProgress[code]).length;
  console.log(`병합 준비 — 개요 ${ovCovered}/${withOverview}, 부문매출 ${segCovered}/${withSegments}`);
  if (ovCovered < withOverview * 0.98 || segCovered < withSegments * 0.98) {
    console.error("요약 커버리지 98% 미만 — 스크립트를 다시 실행해 잔여분을 채운 뒤 병합하세요.");
    process.exit(2);
  }

  let briefCount = 0;
  for (const [code, c] of entries) {
    c.overviewSummary = ovProgress[code] ?? null;
    c.segmentsSummary = stripPeriodPrefix(segProgress[code] ?? null);
    c.segmentsBrief = briefs.get(code) ?? null;
    if (c.segmentsBrief !== null) briefCount++;
  }
  snapshot._meta.summary = {
    method:
      "overview/segments=claude-haiku 요약(1회 생성 후 고정: 개요 3~4문장, 부문매출은 최근 기수 부문별 금액·비중 한 줄 — 기간·단위 머리말 제외), segmentsBrief=매출실적 표 구간 결정론적 절단(폴백·기간/단위 확인용)",
    summarizedAt: new Date().toISOString(),
    overviewSummaryCount: ovCovered,
    segmentsSummaryCount: segCovered,
    segmentsBriefCount: briefCount,
  };
  writeFileSync(snapPath, gzipSync(JSON.stringify(snapshot), { level: 9 }));
  console.log(
    `병합 완료: ${snapPath} (overviewSummary ${ovCovered}, segmentsSummary ${segCovered}, segmentsBrief ${briefCount})`
  );
}

// 직접 실행 시에만 main 구동 (compactSegments 를 다른 스크립트에서 import 가능하게)
if (process.argv[1]?.endsWith("summarize-peer-snapshot.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
