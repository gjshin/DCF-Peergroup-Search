import fs from "fs";
import path from "path";
import zlib from "zlib";

/**
 * 분기말 Peer 모집단 스냅샷 로더.
 * scripts/collect-peer-snapshot.ts 가 생성한 data/peer-snapshot/{YYYYMMDD}.json.gz 를 읽는다.
 * 스냅샷 파일은 커밋 후 불변(immutable) — 이것이 peergroup_get_population 결정론의 근거.
 */

export interface PeerSnapshotCompany {
  name: string;
  corpCode: string;
  industryCode: string;
  market: string | null;
  report: { rceptNo: string; type: string; name: string; rceptDt: string } | null;
  overview: string | null;
  segments: string | null;
  flags: {
    segmentsSource: "sales" | "products" | "business" | null;
    overviewMissing: boolean;
    isSpac: boolean;
    isHolding: boolean;
    isReit: boolean;
    fiscalMonthNot12: boolean;
    isAdministrative: boolean | null;
  };
}

export interface PeerSnapshot {
  _meta: {
    version: number;
    snapshotDate: string;
    builtAt: string;
    companyCount: number;
    rosterSource: string;
    notes: string;
  };
  companies: Record<string, PeerSnapshotCompany>;
}

const BASE_DIR = () => path.resolve(process.cwd(), "data/peer-snapshot");

// gunzip+parse 는 비용이 크므로 cold start 이후 memoize
const snapshotMemo = new Map<string, PeerSnapshot | null>();
let datesMemo: string[] | null = null;

/** 사용 가능한 스냅샷 날짜 목록 (오름차순) */
export function getAvailableSnapshotDates(): string[] {
  if (datesMemo) return datesMemo;
  const dates = new Set<string>();
  try {
    for (const f of fs.readdirSync(BASE_DIR())) {
      const m = f.match(/^(\d{8})\.json(\.gz)?$/);
      if (m) dates.add(m[1]);
    }
  } catch {
    // 디렉토리 없음 → 빈 목록
  }
  datesMemo = [...dates].sort();
  return datesMemo;
}

/**
 * 평가기준일 이하 중 가장 최근 스냅샷 날짜로 해석 (floor).
 * 스냅샷은 미래 방향으로만 추가되고 과거 파일은 불변이므로,
 * 과거 valuation_date 에 대한 floor 결과는 영원히 동일 → 결정론 성립.
 */
export function resolveSnapshotDate(valuationDate: string): string | null {
  let best: string | null = null;
  for (const d of getAvailableSnapshotDates()) {
    if (d <= valuationDate) best = d;
    else break;
  }
  return best;
}

/** 스냅샷 로드 (gz 우선, 없으면 raw json). 파일 없으면 null. */
export function loadPeerSnapshot(snapshotDate: string): PeerSnapshot | null {
  if (snapshotMemo.has(snapshotDate)) return snapshotMemo.get(snapshotDate)!;

  const gzPath = path.join(BASE_DIR(), `${snapshotDate}.json.gz`);
  const jsonPath = path.join(BASE_DIR(), `${snapshotDate}.json`);
  let parsed: PeerSnapshot | null = null;
  try {
    if (fs.existsSync(gzPath)) {
      parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(gzPath)).toString("utf8"));
    } else if (fs.existsSync(jsonPath)) {
      parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    }
  } catch {
    parsed = null;
  }
  snapshotMemo.set(snapshotDate, parsed);
  return parsed;
}
