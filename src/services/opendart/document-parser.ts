import axios from "axios";
import AdmZip from "adm-zip";
import { DART_API_BASE, DART_ENDPOINTS } from "./constants";

/**
 * HTML/XML 테이블 텍스트를 Markdown 포맷으로 변환 및 불필요한 태그 일괄 제거
 */
export function extractAndFormatMarkdown(xmlContent: string): string {
  // 1. "II. 사업의 내용" 챕터 찾기 시작
  const startRegexes = [
    /["'>]II\.\s*사업의\s*내용/i,
    /["'>]Ⅱ\.\s*사업의\s*내용/i,
    />\s*제2부\s*사업의\s*내용/i
  ];
  
  const endRegexes = [
    /["'>]III\.\s*재무에\s*관한\s*사항/i,
    /["'>]Ⅲ\.\s*재무에\s*관한\s*사항/i,
    />\s*제3부\s*재무에/i
  ];
  
  let startIdx = -1;
  for (const regex of startRegexes) {
    const match = xmlContent.match(regex);
    if (match && match.index) {
      startIdx = match.index;
      break;
    }
  }

  // 끝나는 부분은 시작 부분 이후부터 찾기
  let endIdx = -1;
  if (startIdx !== -1) {
    const searchString = xmlContent.substring(startIdx + 50);
    for (const regex of endRegexes) {
      const match = searchString.match(regex);
      if (match && match.index) {
        endIdx = startIdx + 50 + match.index;
        break;
      }
    }
  }

  // 매칭 실패 시 원문 일정 부분이라도 반환 (혹은 에러 처리)
  if (startIdx === -1 || endIdx === -1) {
    return "❌ 사업의 내용 섹션을 찾을 수 없거나 추출에 실패했습니다. (검색어 포맷 미스매치)";
  }

  let chunk = xmlContent.substring(startIdx, endIdx);

  // 2. 표(Table) 마크다운 처리
  // <td> 열기 태그는 마크다운 구분자('|')로
  chunk = chunk.replace(/<td[^>]*>/gi, " | ");
  chunk = chunk.replace(/<\/td>/gi, "");
  // <tr> 닫기 태그는 줄바꿈과 마크다운 끝 구분자로
  chunk = chunk.replace(/<\/tr>/gi, " |\n");
  
  // 3. 문단 및 텍스트 블록 닫기는 단순 줄바꿈
  chunk = chunk.replace(/<\/p>/gi, "\n");
  chunk = chunk.replace(/<br\s*\/?>/gi, "\n");
  chunk = chunk.replace(/<\/div>/gi, "\n");

  // 4. 나머지 모든 HTML 태그(<table>, <tbody> 등 포함) 제거
  chunk = chunk.replace(/<[^>]+>/g, "");

  // 5. 공백 및 기호 정제 (&nbsp;, 두 개 이상 띄어쓰기 뭉치기)
  chunk = chunk.replace(/&nbsp;/gi, " ");
  chunk = chunk.replace(/&amp;/gi, "&");
  chunk = chunk.replace(/&lt;/gi, "<");
  chunk = chunk.replace(/&gt;/gi, ">");
  chunk = chunk.replace(/[ \t]+/g, " "); // 다중 공백을 하나로
  chunk = chunk.replace(/\n\s*\n/g, "\n\n"); // 다중 줄바꿈 압축

  return chunk.trim();
}

/**
 * 특정 기업/연도의 사업보고서 원문을 통해 "사업의 내용" 마크다운화 텍스트 추출
 */
export async function fetchBusinessContent(corpCode: string, year: string, apiKey?: string): Promise<string> {
  const key = apiKey || process.env.OPENDART_API_KEY;
  if (!key) {
    throw new Error("API 키가 없습니다.");
  }

  // 1. 해당 연도의 사업보고서(A001) 접수번호 찾기
  // 사업보고서는 익년도 3월에 나오므로 bgn_de, end_de를 해당 연도 1월 ~ 익년도 5월까지 넓게 잡음
  const bgnDe = `${year}0101`;
  const nextYear = (parseInt(year) + 1).toString();
  const endDe = `${nextYear}0531`;

  const listRes = await axios.get(`${DART_API_BASE}/list.json`, {
    params: {
      crtfc_key: key,
      corp_code: corpCode,
      bgn_de: bgnDe,
      end_de: endDe,
      pblntf_detail_ty: "A001" // 정기공시 - 사업보고서
    },
    timeout: 15000
  });

  const docs = listRes.data.list;
  if (!docs || docs.length === 0) {
    return `❌ ${year}년도 사업보고서를 찾을 수 없습니다. (아직 공시되지 않았거나 공시 대상이 아님)`;
  }

  // 가장 최신의 사업보고서 접수번호 가져오기
  const rceptNo = docs[0].rcept_no;

  // 2. document.xml 다운로드
  const docRes = await axios.get(`${DART_API_BASE}/document.xml`, {
    params: {
      crtfc_key: key,
      rcept_no: rceptNo
    },
    responseType: "arraybuffer",
    timeout: 30000 // 문서 다운로드는 조금 여유있게
  });

  if (docRes.data.length < 1000) {
    return "❌ 원본 XML 다운로드 실패 (DART 응답 에러)";
  }

  // 3. ZIP 압축 해제 후 XML 본문 찾기
  const zip = new AdmZip(Buffer.from(docRes.data));
  const entries = zip.getEntries();
  const xmlEntry = entries.find(e => e.entryName.endsWith(".xml"));
  
  if (!xmlEntry) {
    return "❌ 제출된 ZIP 파일 내에 XML 문서가 존재하지 않습니다.";
  }
  
  const xmlContent = xmlEntry.getData().toString("utf8");

  // 4. 추출 및 파싱
  const markdownText = extractAndFormatMarkdown(xmlContent);
  return markdownText;
}
