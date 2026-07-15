/**
 * 피어 스냅샷 요약 필드 생성 — 원문 보존, 요약 필드 추가 (혼합 방식)
 *
 * - overviewSummary: "사업의 개요"를 claude CLI(-p 헤드리스)로 3~4문장 요약 (10종목 배치, 3병렬)
 * - segmentsBrief:   "매출 및 수주상황"에서 매출실적 표 구간만 결정론적으로 절단
 *                    (판매경로/판매방법/판매전략/수주상황 등 서술부 제거)
 *
 * 재개 가능: 진행 파일(data/peer-snapshot/overview-summaries-{date}.json)에 배치마다 저장.
 * 전 종목 완료 시 스냅샷 .json.gz 에 병합 기록(원문 필드는 그대로 유지).
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

// ─── 개요 LLM 요약 (claude -p) ───

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

function buildPrompt(items: Array<{ code: string; name: string; overview: string }>): string {
  const blocks = items
    .map(
      (it) =>
        `### ${it.code} ${it.name}\n${it.overview.slice(0, OVERVIEW_INPUT_CAP)}`
    )
    .join("\n\n");
  return `다음은 한국 상장사들의 사업보고서 "사업의 개요" 원문이다. 각 회사별로 3~4문장으로 요약하라.

요약 목적: 기업가치평가에서 피평가회사와의 "사업 유사성" 판단 재료. 반드시 포함할 것:
- 주력 사업/제품·서비스 (무엇으로 돈을 버는가)
- 사업 부문 구성 (복수 부문이면 각각)
- 주요 전방시장/고객 (있으면)
산업 일반론·거시경제 서술은 제외하라.

출력은 아래 형식의 JSON 객체 하나만 출력하라 (코드블록·설명 금지):
{"종목코드": "요약문", ...}

${blocks}`;
}

function parseSummaryJson(raw: string, codes: string[]): Record<string, string> {
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
    if (typeof v === "string" && v.trim().length >= 20) out[code] = v.trim();
  }
  return out;
}

// ─── 메인 ───

interface SnapshotCompany {
  name: string;
  overview: string | null;
  segments: string | null;
  overviewSummary?: string | null;
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
  const progressPath = path.join(SNAPSHOT_DIR, `overview-summaries-${dateArg}.json`);

  const snapshot = JSON.parse(gunzipSync(readFileSync(snapPath)).toString("utf-8")) as {
    _meta: Record<string, unknown>;
    companies: Record<string, SnapshotCompany>;
  };
  const entries = Object.entries(snapshot.companies);
  console.log(`스냅샷 ${dateArg}: ${entries.length}종목`);

  const progress: Record<string, string> = existsSync(progressPath)
    ? (JSON.parse(readFileSync(progressPath, "utf-8")) as Record<string, string>)
    : {};

  // 1) LLM 개요 요약 (재개 가능)
  if (!mergeOnly) {
    const targets = entries
      .filter(([code, c]) => c.overview !== null && !progress[code])
      .slice(0, Number.isFinite(limit) ? limit : undefined);
    console.log(`개요 요약 대상: ${targets.length}종목 (완료분 ${Object.keys(progress).length} 제외)`);

    const batches: Array<Array<[string, SnapshotCompany]>> = [];
    for (let i = 0; i < targets.length; i += BATCH_SIZE) batches.push(targets.slice(i, i + BATCH_SIZE));

    let done = 0;
    let failed = 0;
    const saveProgress = () => writeFileSync(progressPath, JSON.stringify(progress), "utf-8");

    async function worker(queue: Array<Array<[string, SnapshotCompany]>>): Promise<void> {
      for (;;) {
        const batch = queue.shift();
        if (!batch) return;
        const items = batch.map(([code, c]) => ({ code, name: c.name, overview: c.overview as string }));
        const codes = items.map((i) => i.code);
        try {
          let got: Record<string, string> = {};
          try {
            got = parseSummaryJson(await runClaude(buildPrompt(items)), codes);
          } catch {
            got = parseSummaryJson(await runClaude(buildPrompt(items)), codes); // 1회 재시도
          }
          const missing = codes.filter((c) => !got[c]);
          Object.assign(progress, got);
          // 배치에서 누락된 종목은 단건 재시도
          for (const code of missing) {
            const it = items.find((i) => i.code === code)!;
            try {
              const one = parseSummaryJson(await runClaude(buildPrompt([it])), [code]);
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
          console.log(`  ${done}/${batches.length} 배치 — 누적 ${Object.keys(progress).length}건, 실패 ${failed}`);
        }
      }
    }

    const queue = [...batches];
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
    console.log(`개요 요약 완료: ${Object.keys(progress).length}건 (실패 ${failed})`);
    if (Number.isFinite(limit)) {
      console.log("--limit 시험 실행 — 병합 생략. 결과는 진행 파일에서 확인:", progressPath);
      return;
    }
  }

  // 2) 병합: segmentsBrief(결정론) + overviewSummary(LLM) → 스냅샷 재기록 (원문 보존)
  const withOverview = entries.filter(([, c]) => c.overview !== null).length;
  const covered = entries.filter(([code]) => progress[code]).length;
  console.log(`병합 준비 — 개요 보유 ${withOverview} / 요약 확보 ${covered}`);
  if (covered < withOverview * 0.98) {
    console.error("요약 커버리지 98% 미만 — 스크립트를 다시 실행해 잔여분을 채운 뒤 병합하세요.");
    process.exit(2);
  }

  let briefCount = 0;
  for (const [code, c] of entries) {
    c.overviewSummary = progress[code] ?? null;
    c.segmentsBrief = compactSegments(c.segments);
    if (c.segmentsBrief !== null) briefCount++;
  }
  snapshot._meta.summary = {
    method: "overview=claude-haiku 3~4문장 요약(1회 생성 후 고정), segments=매출실적 표 구간 결정론적 절단",
    summarizedAt: new Date().toISOString(),
    overviewSummaryCount: covered,
    segmentsBriefCount: briefCount,
  };
  writeFileSync(snapPath, gzipSync(JSON.stringify(snapshot), { level: 9 }));
  console.log(`병합 완료: ${snapPath} (overviewSummary ${covered}, segmentsBrief ${briefCount})`);
}

// 직접 실행 시에만 main 구동 (compactSegments 를 다른 스크립트에서 import 가능하게)
if (process.argv[1]?.endsWith("summarize-peer-snapshot.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
