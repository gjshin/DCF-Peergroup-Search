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

  const docs: Array<{ rcept_no: string; report_nm: string; rcept_dt: string }> = listRes.data.list;
  if (!docs || docs.length === 0) {
    return `❌ ${year}년도 사업보고서를 찾을 수 없습니다. (아직 공시되지 않았거나 공시 대상이 아님)`;
  }

  // 후보 우선순위:
  // 1. 정정공시([기재정정]/[첨부정정]) 아닌 원본 사업보고서
  // 2. 정정공시라도 본문이 살아있는 경우 (원본이 삭제된 경우 대비)
  // 정렬: 원본 우선, 그 안에서 rcept_dt 내림차순(최신)
  const isAmend = (nm: string) => /\[.*정정.*\]/.test(nm);
  const sorted = [...docs].sort((a, b) => {
    const aAmend = isAmend(a.report_nm) ? 1 : 0;
    const bAmend = isAmend(b.report_nm) ? 1 : 0;
    if (aAmend !== bAmend) return aAmend - bAmend;
    return b.rcept_dt.localeCompare(a.rcept_dt);
  });

  // 후보를 순서대로 시도. document.xml이 <1KB거나 XML 본문 파싱 실패하면 다음 후보로.
  let zip: AdmZip | null = null;
  let xmlEntries: AdmZip.IZipEntry[] = [];
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
      break;
    } catch (e: any) {
      lastErr = e.message;
      continue;
    }
  }

  if (!zip || xmlEntries.length === 0) {
    return `❌ 원본 XML 다운로드 실패 (DART 응답 에러: ${lastErr})`;
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
    return "❌ 사업의 내용 섹션을 찾을 수 없거나 추출에 실패했습니다. (검색어 포맷 미스매치)";
  }
  return best;
}
