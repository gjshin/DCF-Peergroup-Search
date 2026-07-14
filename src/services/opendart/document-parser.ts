import axios from "axios";
import AdmZip from "adm-zip";
import { DART_API_BASE } from "./constants";

// ─────────────────────────────────────────────────────────────
// 섹션 검색 regex (평문 대상)
// ─────────────────────────────────────────────────────────────
const START_RE = /(II|Ⅱ|2)\s*\.?\s*사\s*업\s*의\s*내\s*용/g;
const END_RE = /(III|Ⅲ|3)\s*\.?\s*재\s*무\s*에?\s*관한?\s*사항/g;
const SANITY_RE = /(1\s*\.\s*사업의\s*개요|주요\s*제품|매출|영업\s*개황|원재료)/;

/**
 * HTML/XML을 평문으로 정리 (태그/엔티티/공백 정제). 표 마크다운 변환은 별도 패스에서.
 */
function stripToPlain(xml: string): string {
  return xml
    .replace(/<\/(p|div|tr|br|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * 평문 내에서 모든 (start, end) 후보 페어 중 가장 긴 본문 구간을 선택.
 * TOC는 짧고 본문은 길다는 점을 이용. fallback으로 end 못 찾으면 텍스트 끝까지.
 */
function pickBestSection(plain: string): string | null {
  const starts: number[] = [];
  const ends: number[] = [];
  let m: RegExpExecArray | null;
  START_RE.lastIndex = 0;
  while ((m = START_RE.exec(plain)) !== null) starts.push(m.index);
  END_RE.lastIndex = 0;
  while ((m = END_RE.exec(plain)) !== null) ends.push(m.index);

  if (starts.length === 0) return null;

  // 후보 생성 + 점수화
  // - 필수: 길이 ≥ 1000, sanity 통과
  // - 점수: start 직후 300자 안에 "1. 사업의 개요" 또는 "1. 사업의개요"가 오면 +1000 (진짜 본문 시그널)
  //          hasEnd 면 +200, 길이 sqrt 가산, 뒤쪽 start일수록 소폭 감점
  const HEAD_RE = /1\s*\.\s*사\s*업\s*의\s*개\s*요/;
  const candidates: { score: number; chunk: string }[] = [];
  for (const s of starts) {
    const e = ends.find((x) => x > s + 50);
    const endPos = e ?? plain.length;
    const chunk = plain.substring(s, endPos).trim();
    if (chunk.length < 1000) continue;
    if (!SANITY_RE.test(chunk)) continue;
    let score = Math.sqrt(chunk.length);
    if (HEAD_RE.test(chunk.slice(0, 400))) score += 1000;
    if (e !== undefined) score += 200;
    score -= s / 100000; // 동점 시 앞쪽 우선
    candidates.push({ score, chunk });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].chunk;
}

/**
 * 단일 XML 파트에 대한 추출 시도. 성공 시 정제된 마크다운 문자열, 실패 시 null.
 */
function extractFromXml(xmlContent: string): string | null {
  // 1. 표를 먼저 마크다운으로 변환한 raw 버전 (본문 포함시 가독성 유지)
  let tabled = xmlContent
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<\/td>/gi, "")
    .replace(/<\/tr>/gi, " |\n");

  const plain = stripToPlain(tabled);
  return pickBestSection(plain);
}

/**
 * (기존 export 호환) 단일 XML을 받아 섹션 추출. 실패 시 ❌ 메시지.
 */
export function extractAndFormatMarkdown(xmlContent: string): string {
  const r = extractFromXml(xmlContent);
  return r ?? "❌ 사업의 내용 섹션을 찾을 수 없거나 추출에 실패했습니다. (검색어 포맷 미스매치)";
}

/**
 * axios 재시도 래퍼 (exp backoff)
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        const delay = [1000, 3000, 8000][i] ?? 5000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export interface DartListDoc {
  rcept_no: string;
  report_nm: string;
  rcept_dt: string;
}

const isAmend = (nm: string) => /\[.*정정.*\]/.test(nm);

/**
 * 후보 공시 목록을 순서대로 시도하여 "사업의 내용" 섹션을 추출.
 * 성공 시 마크다운과 채택된 공시를 함께 반환, 전부 실패 시 에러 메시지 반환.
 */
async function downloadBestContent(
  sorted: DartListDoc[],
  key: string
): Promise<{ markdown: string; doc: DartListDoc } | { error: string }> {
  // 후보를 순서대로 시도. document.xml이 <1KB거나 XML 본문 파싱 실패하면 다음 후보로.
  let zip: AdmZip | null = null;
  let xmlEntries: AdmZip.IZipEntry[] = [];
  let pickedDoc: DartListDoc | null = null;
  let lastErr = "";

  for (const doc of sorted) {
    try {
      const docRes = await withRetry(() =>
        axios.get(`${DART_API_BASE}/document.xml`, {
          params: { crtfc_key: key, rcept_no: doc.rcept_no },
          responseType: "arraybuffer",
          timeout: 60000,
        })
      );
      if (docRes.data.length < 1000) {
        lastErr = "원본 XML 다운로드 실패 (DART 응답 <1KB)";
        continue;
      }
      const z = new AdmZip(Buffer.from(docRes.data));
      const entries = z.getEntries().filter((e) => e.entryName.toLowerCase().endsWith(".xml"));
      if (entries.length === 0) {
        lastErr = "ZIP 내 XML 문서 없음";
        continue;
      }
      zip = z;
      xmlEntries = entries;
      pickedDoc = doc;
      break;
    } catch (e: any) {
      lastErr = e.message;
      continue;
    }
  }

  if (!zip || xmlEntries.length === 0 || !pickedDoc) {
    return { error: `❌ 원본 XML 다운로드 실패 (DART 응답 에러: ${lastErr})` };
  }

  // 각 XML 파트에서 추출 시도. "1. 사업의 개요"가 앞쪽에 오는 본문을 우선 채택,
  // 없으면 가장 긴 것.
  const HEAD_NEAR = /1\s*\.\s*사\s*업\s*의\s*개\s*요/;
  let bestBody: string | null = null;
  let bestAny: string | null = null;
  for (const entry of xmlEntries) {
    try {
      const xml = entry.getData().toString("utf8");
      const r = extractFromXml(xml);
      if (!r) continue;
      if (HEAD_NEAR.test(r.slice(0, 500))) {
        if (!bestBody || r.length > bestBody.length) bestBody = r;
      }
      if (!bestAny || r.length > bestAny.length) bestAny = r;
    } catch {
      // skip broken entry
    }
  }
  const best = bestBody ?? bestAny;

  if (!best) {
    return { error: "❌ 사업의 내용 섹션을 찾을 수 없거나 추출에 실패했습니다. (검색어 포맷 미스매치)" };
  }
  return { markdown: best, doc: pickedDoc };
}

/**
 * 특정 기업/연도의 사업보고서 원문에서 "사업의 내용" 섹션을 추출.
 */
export async function fetchBusinessContent(corpCode: string, year: string, apiKey?: string): Promise<string> {
  const key = apiKey || process.env.OPENDART_API_KEY;
  if (!key) throw new Error("API 키가 없습니다.");

  const bgnDe = `${year}0101`;
  const endDe = `${parseInt(year) + 1}0531`;

  const listRes = await withRetry(() =>
    axios.get(`${DART_API_BASE}/list.json`, {
      params: {
        crtfc_key: key,
        corp_code: corpCode,
        bgn_de: bgnDe,
        end_de: endDe,
        pblntf_detail_ty: "A001",
      },
      timeout: 15000,
    })
  );

  const docs: DartListDoc[] = listRes.data.list;
  if (!docs || docs.length === 0) {
    return `❌ ${year}년도 사업보고서를 찾을 수 없습니다. (아직 공시되지 않았거나 공시 대상이 아님)`;
  }

  // 후보 우선순위:
  // 1. 정정공시([기재정정]/[첨부정정]) 아닌 원본 사업보고서
  // 2. 정정공시라도 본문이 살아있는 경우 (원본이 삭제된 경우 대비)
  // 정렬: 원본 우선, 그 안에서 rcept_dt 내림차순(최신)
  const sorted = [...docs].sort((a, b) => {
    const aAmend = isAmend(a.report_nm) ? 1 : 0;
    const bAmend = isAmend(b.report_nm) ? 1 : 0;
    if (aAmend !== bAmend) return aAmend - bAmend;
    return b.rcept_dt.localeCompare(a.rcept_dt);
  });

  const result = await downloadBestContent(sorted, key);
  return "error" in result ? result.error : result.markdown;
}

// ─────────────────────────────────────────────────────────────
// 평가기준일 시점 최신 정기보고서 조회
// ─────────────────────────────────────────────────────────────

export interface PeriodicReportMeta {
  rceptNo: string;
  /** A001=사업보고서, A002=반기보고서, A003=분기보고서 */
  type: "A001" | "A002" | "A003" | "unknown";
  name: string;
  rceptDt: string;
}

function classifyReport(reportNm: string): PeriodicReportMeta["type"] {
  if (reportNm.includes("사업보고서")) return "A001";
  if (reportNm.includes("반기보고서")) return "A002";
  if (reportNm.includes("분기보고서")) return "A003";
  return "unknown";
}

/** report_nm의 "(YYYY.MM)" 보고기간을 정렬키로 파싱 (없으면 rcept_dt 폴백) */
function reportPeriodKey(doc: DartListDoc): string {
  const m = doc.report_nm.match(/\((\d{4})\.(\d{2})\)/);
  return m ? `${m[1]}${m[2]}` : doc.rcept_dt.slice(0, 6);
}

/** YYYYMMDD에서 n개월 전 날짜 (일자는 01로 고정) */
function monthsBefore(yyyymmdd: string, months: number): string {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10);
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}${String(nm).padStart(2, "0")}01`;
}

/**
 * 기준일(asOfDate) 시점에 "이용 가능했던 최신 정기보고서"에서 사업의 내용 섹션을 추출.
 *
 * 선택 규칙 (결정론):
 * 1. rcept_dt <= asOfDate 인 정기공시(A: 사업/반기/분기보고서)만 후보
 * 2. 보고기간(report_nm의 "(YYYY.MM)") 내림차순 — 최신 결산기간 우선
 * 3. 동일 기간이면 비정정 원본 우선, 그 다음 rcept_dt 내림차순
 *
 * 실패 시 null (호출자가 캐시 플래그 처리).
 */
export async function fetchBusinessContentAsOf(
  corpCode: string,
  asOfDate: string,
  apiKey?: string
): Promise<{ markdown: string; report: PeriodicReportMeta } | null> {
  const key = apiKey || process.env.OPENDART_API_KEY;
  if (!key) throw new Error("API 키가 없습니다.");

  const listRes = await withRetry(() =>
    axios.get(`${DART_API_BASE}/list.json`, {
      params: {
        crtfc_key: key,
        corp_code: corpCode,
        bgn_de: monthsBefore(asOfDate, 15),
        end_de: asOfDate,
        pblntf_ty: "A",
        page_count: 100,
      },
      timeout: 15000,
    })
  );

  const docs: DartListDoc[] = listRes.data.list ?? [];
  const candidates = selectPeriodicReportCandidates(docs, asOfDate);
  if (candidates.length === 0) return null;

  return fetchBusinessContentForDocs(candidates, key);
}

/**
 * 이미 확보한 공시 목록(후보 순서 유지)에서 사업의 내용을 추출.
 * list.json 재호출 없이 document.xml만 다운로드 — 빌더가 rcept_no 단위로 사용.
 */
export async function fetchBusinessContentForDocs(
  docs: DartListDoc[],
  apiKey?: string
): Promise<{ markdown: string; report: PeriodicReportMeta } | null> {
  const key = apiKey || process.env.OPENDART_API_KEY;
  if (!key) throw new Error("API 키가 없습니다.");
  if (docs.length === 0) return null;

  const result = await downloadBestContent(docs, key);
  if ("error" in result) return null;

  return {
    markdown: result.markdown,
    report: {
      rceptNo: result.doc.rcept_no,
      type: classifyReport(result.doc.report_nm),
      name: result.doc.report_nm,
      rceptDt: result.doc.rcept_dt,
    },
  };
}

/**
 * 정기보고서 후보 필터+정렬 (fetchBusinessContentAsOf의 선택 규칙과 동일).
 * 빌더가 다운로드 없이 "선택될 보고서"를 미리 결정할 때도 사용.
 */
export function selectPeriodicReportCandidates(docs: DartListDoc[], asOfDate: string): DartListDoc[] {
  return docs
    .filter((d) => d.rcept_dt <= asOfDate && classifyReport(d.report_nm) !== "unknown")
    .sort((a, b) => {
      const period = reportPeriodKey(b).localeCompare(reportPeriodKey(a));
      if (period !== 0) return period;
      const aAmend = isAmend(a.report_nm) ? 1 : 0;
      const bAmend = isAmend(b.report_nm) ? 1 : 0;
      if (aAmend !== bAmend) return aAmend - bAmend;
      return b.rcept_dt.localeCompare(a.rcept_dt);
    });
}
