import axios from "axios";
import AdmZip from "adm-zip";
import { DART_API_BASE } from "./constants";
import type { DebtItem, DebtCategory } from "./types";

// ─── XBRL 주석 기반 IBD 추출 ───

export interface XbrlDebtResult {
  interestBearingDebt: number;
  current: DebtCategory;
  nonCurrent: DebtCategory;
}

// IBD 멤버 판별 키워드 (대소문자 무시)
const IBD_KEYWORDS = ["borrowing", "loan", "bond", "debenture", "lease"];
const NON_IBD_KEYWORDS = ["guarantee", "deposit", "trade", "payable"];

// 멤버 → 유동/비유동 분류
function classifyMember(member: string): "current" | "nonCurrent" {
  const lower = member.toLowerCase();
  if (lower.includes("shortterm") || lower.includes("currentportion") || lower.includes("current")) {
    return "current";
  }
  return "nonCurrent";
}

// 멤버 → 한글 라벨
function memberToLabel(member: string): string {
  const lower = member.toLowerCase();
  // 표준 멤버
  if (lower === "shorttermbrowingsmember" || lower === "shorttermborrowingsmember") return "단기차입금";
  if (lower === "longtermborrowingsmember") return "장기차입금";
  if (lower === "leaseliabilitiesmember") return "리스부채";
  if (lower === "bondsissuedmember") return "사채";
  if (lower === "convertiblebondsmember") return "전환사채";
  if (lower === "currentportionoflongtermborrowingsmember") return "유동성장기차입금";

  // 회사 자체 멤버: 키워드로 추론
  if (lower.includes("debenture") && lower.includes("longterm")) return "사채·장기차입금";
  if (lower.includes("debenture") || lower.includes("bond")) return "사채";
  if (lower.includes("shortterm") || lower.includes("currentportion")) return "단기차입금·유동성장기부채";
  if (lower.includes("lease")) return "리스부채";
  if (lower.includes("longterm") || lower.includes("borrowing") || lower.includes("loan")) return "장기차입금";

  // 알 수 없는 멤버 — 원본 이름 사용
  return member.replace(/Member.*$/, "").replace(/Of.*$/, "");
}

// 멤버가 IBD인지 판별
function isIBDMember(member: string): boolean {
  const lower = member.toLowerCase();
  if (NON_IBD_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  if (IBD_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  return false;
}

/**
 * XBRL 원문에서 IBD(이자부부채) 세부 데이터를 추출합니다.
 *
 * 1. fnlttXbrl.xml API → XBRL ZIP 다운로드
 * 2. .xbrl 파일에서 context 파싱 (연결 + 당기 기말)
 * 3. Axis 1: LiabilitiesArisingFromFinancingActivitiesAxis → 멤버별 잔액
 * 4. Axis 2: ClassesOfFinancialLiabilitiesAxis → 리스부채 보완
 * 5. 비IBD 멤버 필터링 + 유동/비유동 분류
 */
export async function extractDebtFromXbrl(
  rceptNo: string,
  year: string,
  apiKey?: string,
): Promise<XbrlDebtResult | null> {
  try {
    const key = apiKey || process.env.OPENDART_API_KEY;
    if (!key) return null;

    // 1. XBRL ZIP 다운로드
    const res = await axios.get(`${DART_API_BASE}/fnlttXbrl.xml`, {
      params: { crtfc_key: key, rcept_no: rceptNo, reprt_code: "11011" },
      responseType: "arraybuffer",
      timeout: 15000,
    });

    if (res.data.length < 1000) return null; // 에러 응답

    // 2. ZIP 해제 → .xbrl 파일 찾기
    const zip = new AdmZip(Buffer.from(res.data));
    const xbrlEntry = zip.getEntries().find((e) => e.entryName.endsWith(".xbrl"));
    if (!xbrlEntry) return null;

    const xml = xbrlEntry.getData().toString("utf8");
    const lines = xml.split("\n");

    // 3. 연결 우선 → 실패 시 별도(Separate)로 재시도
    // 연결 재무제표가 없는 상장사(종속기업 無)는 XBRL에도 ConsolidatedMember context가 존재하지 않으므로
    // 이런 회사들도 Axis 경로로 흡수하기 위해 SeparateMember로 폴백한다.
    const consolidated = extractScope(lines, year, "ConsolidatedMember");
    if (consolidated) return consolidated;

    const separate = extractScope(lines, year, "SeparateMember");
    if (separate) return separate;

    return null;
  } catch {
    return null;
  }
}

/**
 * 단일 엔티티 스코프(연결 or 별도)에 대해 IBD를 추출합니다.
 * scopeMember: "ConsolidatedMember" (연결) 또는 "SeparateMember" (별도)
 */
function extractScope(lines: string[], year: string, scopeMember: string): XbrlDebtResult | null {
  const contextPrefix = `CFY${year}`;
  const axis1 = "LiabilitiesArisingFromFinancingActivitiesAxis";
  const axis2 = "ClassesOfFinancialLiabilitiesAxis";

  const axis1Contexts: Record<string, string> = {}; // contextId → member
  const axis2Contexts: Record<string, string> = {};

  let buf = "";
  let ctxId = "";

  for (const line of lines) {
    const startMatch = line.match(/xbrli:context id="([^"]+)"/);
    if (startMatch) {
      ctxId = startMatch[1];
      buf = "";
    }
    buf += line;

    if (line.includes("</xbrli:context>") && ctxId) {
      // 해당 스코프(연결 or 별도) + 당기 기말만
      if (ctxId.startsWith(contextPrefix) && ctxId.includes("eFY") && ctxId.includes(scopeMember)) {
        const memberEntries = [...buf.matchAll(
          /dimension="(?:[^":]+:)?([^"]+)"[^>]*>\s*(?:[^:<\s]+:)?([^<\s]+)/g,
        )];
        for (const [, dim, member] of memberEntries) {
          if (dim === axis1) axis1Contexts[ctxId] = member;
          if (dim === axis2) axis2Contexts[ctxId] = member;
        }
      }
      ctxId = "";
      buf = "";
    }
  }

  // 해당 스코프에 대한 context가 하나도 없으면 (예: 별도 only 회사에서 Consolidated 탐색 시) 즉시 종료
  if (Object.keys(axis1Contexts).length === 0 && Object.keys(axis2Contexts).length === 0) {
    return null;
  }

  // Axis 1: 멤버별 LiabilitiesArisingFromFinancingActivities 기말잔액 추출
  const memberAmounts: Record<string, number> = {};

  for (const [cId, member] of Object.entries(axis1Contexts)) {
    for (const line of lines) {
      if (
        line.includes(`contextRef="${cId}"`) &&
        line.includes(":LiabilitiesArisingFromFinancingActivities>")
      ) {
        const valMatch = line.match(/>(-?\d+)</);
        if (valMatch) {
          const amt = parseInt(valMatch[1]);
          if (!memberAmounts[member] || Math.abs(amt) > Math.abs(memberAmounts[member])) {
            memberAmounts[member] = amt;
          }
        }
      }
    }
  }

  // Axis 2: 리스부채 보완 (Axis 1에 없을 때만)
  const hasLeaseInAxis1 = Object.keys(memberAmounts).some((m) =>
    m.toLowerCase().includes("lease"),
  );

  if (!hasLeaseInAxis1) {
    for (const [cId, member] of Object.entries(axis2Contexts)) {
      if (!member.toLowerCase().includes("lease")) continue;

      for (const line of lines) {
        if (line.includes(`contextRef="${cId}"`)) {
          if (
            line.includes(":FinancialLiabilities>") &&
            !line.includes("AtFairValue") &&
            !line.includes("AtAmortised")
          ) {
            const valMatch = line.match(/>(-?\d+)</);
            if (valMatch) {
              const amt = parseInt(valMatch[1]);
              if (!memberAmounts[member] || Math.abs(amt) > Math.abs(memberAmounts[member])) {
                memberAmounts[member] = amt;
              }
            }
          }
        }
      }
    }
  }

  // 비IBD 필터링 + 유동/비유동 분류
  const currentItems: DebtItem[] = [];
  const nonCurrentItems: DebtItem[] = [];
  let currentTotal = 0;
  let nonCurrentTotal = 0;

  for (const [member, amount] of Object.entries(memberAmounts)) {
    if (amount <= 0) continue;
    if (!isIBDMember(member)) continue;

    const label = memberToLabel(member);
    const classification = classifyMember(member);

    if (classification === "current") {
      currentItems.push({ account: label, amount });
      currentTotal += amount;
    } else {
      nonCurrentItems.push({ account: label, amount });
      nonCurrentTotal += amount;
    }
  }

  const total = currentTotal + nonCurrentTotal;
  if (total === 0) return null;

  return {
    interestBearingDebt: total,
    current: { total: currentTotal, items: currentItems },
    nonCurrent: { total: nonCurrentTotal, items: nonCurrentItems },
  };
}
