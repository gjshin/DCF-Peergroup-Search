/**
 * "II. 사업의 내용" 마크다운(document-parser 산출물)에서
 * peer 모집단 판단에 필요한 섹션만 잘라내는 순수 함수.
 *
 * 표준 7섹션 구조 (실측: business-cache 2025 기준 약 93~99% 커버):
 *   1. 사업의 개요 / 2. 주요 제품 및 서비스 / 3. 원재료 및 생산설비
 *   4. 매출 및 수주상황 / 5. 위험관리 및 파생거래 / 6. 주요계약 및 연구개발활동 / 7. 기타 참고사항
 */

export interface BusinessSections {
  /** "1. 사업의 개요" ~ 다음 상위 섹션 직전 (없으면 null) */
  overview: string | null;
  /**
   * 부문별 매출 판단 자료 (우선순위):
   * "4. 매출 및 수주상황" → "2. 주요 제품 및 서비스" → "2. 영업의 현황"(금융업 서식)
   */
  segments: string | null;
  segmentsSource: "sales" | "products" | "business" | null;
}

/** 섹션당 최대 길이 (비정형 문서 폭주 방지) */
const MAX_SECTION_CHARS = 20000;

// 상위 섹션 헤더 패턴 — 줄 시작(표 셀 파이프 허용) 기준으로만 매칭해
// 본문 중 참조 문구("'7. 기타 참고사항'의 ...")는 배제한다.
// 번호는 문서마다 어긋날 수 있어 1~9를 허용하되 제목 키워드로 식별한다.
// 제조+금융 겸업 회사의 복합 서식은 번호 앞뒤에 "(제조서비스업)"/"(금융업)" 같은
// 괄호 한정어가 붙으므로 (예: "1. (제조서비스업)사업의 개요", "(금융업)2. 영업의현황") 허용한다.
const QUAL = "(?:[(（][^)）]{1,20}[)）]\\s*)?";
const HEAD = (title: string) =>
  new RegExp(`(^|\\n)\\s*\\|?\\s*${QUAL}[1-9]\\s*\\.\\s*${QUAL}${title}`, "g");

const SECTION_PATTERNS: { key: string; re: RegExp }[] = [
  { key: "overview", re: HEAD("사\\s*업\\s*의\\s*개\\s*요") },
  { key: "products", re: HEAD("주\\s*요\\s*제\\s*품") },
  { key: "materials", re: HEAD("원\\s*재\\s*료") },
  { key: "sales", re: HEAD("매\\s*출\\s*(?:및|과)?\\s*수\\s*주") },
  // 금융업 서식 (은행/보험/증권/금융지주): 매출 섹션 대신 "영업의 현황/개황"
  { key: "business", re: HEAD("영\\s*업\\s*의?\\s*(?:현\\s*황|개\\s*황)") },
  { key: "risk", re: HEAD("위\\s*험\\s*관\\s*리") },
  { key: "contracts", re: HEAD("주\\s*요\\s*계\\s*약") },
  { key: "rnd", re: HEAD("연\\s*구\\s*개\\s*발") },
  { key: "etc", re: HEAD("기\\s*타\\s*참\\s*고") },
  // 금융업 서식의 나머지 상위 섹션 (경계 인식용)
  { key: "finEtc", re: HEAD("재\\s*무\\s*건\\s*전\\s*성") },
  { key: "facilities", re: HEAD("영\\s*업\\s*설\\s*비") },
];

interface HeaderHit {
  key: string;
  index: number;
}

/** 문서 내 모든 상위 섹션 헤더 위치를 수집 (등장 순 정렬) */
function findHeaders(markdown: string): HeaderHit[] {
  const hits: HeaderHit[] = [];
  for (const { key, re } of SECTION_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
      // (^|\n) 캡처만큼 보정해 헤더 실제 시작 위치를 기록
      const offset = m[1] ? m.index + m[1].length : m.index;
      hits.push({ key, index: offset });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

/**
 * key 섹션의 첫 등장 위치부터 "다른 상위 섹션 헤더"가 나오기 직전까지 슬라이스.
 * 같은 key가 여러 번 등장하면 첫 번째를 채택 (본문은 TOC 제거 후이므로 첫 등장이 실제 헤더).
 */
function sliceSection(markdown: string, headers: HeaderHit[], key: string): string | null {
  const start = headers.find((h) => h.key === key);
  if (!start) return null;
  const next = headers.find((h) => h.index > start.index && h.key !== key);
  const raw = markdown.slice(start.index, next ? next.index : undefined).trim();
  if (raw.length === 0) return null;
  return raw.length > MAX_SECTION_CHARS ? raw.slice(0, MAX_SECTION_CHARS) + "\n…[이하 생략]" : raw;
}

/**
 * "II. 사업의 내용" 마크다운에서 개요/부문별매출 섹션을 추출합니다.
 * 실패한 섹션은 null (라이브 폴백 없음 — 호출자가 플래그로 기록).
 */
export function sliceBusinessSections(markdown: string): BusinessSections {
  if (!markdown || markdown.startsWith("❌")) {
    return { overview: null, segments: null, segmentsSource: null };
  }

  const headers = findHeaders(markdown);
  const overview = sliceSection(markdown, headers, "overview");

  const sales = sliceSection(markdown, headers, "sales");
  if (sales) {
    return { overview, segments: sales, segmentsSource: "sales" };
  }
  const products = sliceSection(markdown, headers, "products");
  if (products) {
    return { overview, segments: products, segmentsSource: "products" };
  }
  const business = sliceSection(markdown, headers, "business");
  if (business) {
    return { overview, segments: business, segmentsSource: "business" };
  }
  return { overview, segments: null, segmentsSource: null };
}
