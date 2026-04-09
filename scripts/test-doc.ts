import axios from "axios";
import AdmZip from "adm-zip";
import fs from "fs";
import { resolveCorpCode } from "../src/services/common/stock-code-resolver";

function extractBusinessSegment(xmlContent: string): string {
  // Try to find typical headers
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

  let endIdx = -1;
  if (startIdx !== -1) {
    const searchString = xmlContent.substring(startIdx + 50); // avoid matching start again
    for (const regex of endRegexes) {
      const match = searchString.match(regex);
      if (match && match.index) {
        endIdx = startIdx + 50 + match.index;
        break;
      }
    }
  }

  if (startIdx === -1 || endIdx === -1) {
    return "섹션 매칭 실패";
  }

  let chunk = xmlContent.substring(startIdx, endIdx);

  // Convert Tables
  chunk = chunk.replace(/<td[^>]*>/gi, " | ");
  chunk = chunk.replace(/<\/td>/gi, "");
  chunk = chunk.replace(/<\/tr>/gi, " |\n");
  chunk = chunk.replace(/<p[^>]*>/gi, "\n");
  chunk = chunk.replace(/<br[^>]*>/gi, "\n");
  chunk = chunk.replace(/<div[^>]*>/gi, "\n");

  // Remove all other HTML/XML tags
  chunk = chunk.replace(/<[^>]+>/g, "");
  
  // Clean whitespace
  chunk = chunk.replace(/&nbsp;/gi, " ");
  chunk = chunk.replace(/[ \t]+/g, " ");
  chunk = chunk.replace(/\n\s*\n/g, "\n\n");

  return chunk.trim();
}

async function run() {
  const envContent = fs.readFileSync(".env.local", "utf8");
  const match = envContent.match(/OPENDART_API_KEY=(.*)/);
  const apiKey = match ? match[1].trim() : process.env.OPENDART_API_KEY;

  if (!apiKey) throw new Error("No key");

  // "100030" test
  const corpCodeUrl = await resolveCorpCode("100030");
  if(!corpCodeUrl) return; 
  
  const listRes = await axios.get("https://opendart.fss.or.kr/api/list.json", {
    params: { crtfc_key: apiKey, corp_code: corpCodeUrl, bgn_de: "20240101", end_de: "20250531", pblntf_detail_ty: "A001" }
  });
  
  const docs = listRes.data.list;
  if (!docs || docs.length === 0) {
    console.log("No business report");
    return;
  }
  
  const docRes = await axios.get("https://opendart.fss.or.kr/api/document.xml", {
    params: { crtfc_key: apiKey, rcept_no: docs[0].rcept_no },
    responseType: "arraybuffer"
  });

  const zip = new AdmZip(Buffer.from(docRes.data));
  const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith(".xml"));
  if (!xmlEntry) return;

  const xmlContent = xmlEntry.getData().toString("utf8");
  fs.writeFileSync("temp_100030.xml", xmlContent);
  const result = extractBusinessSegment(xmlContent);
  
  fs.writeFileSync("temp_100030_parsed.md", result.substring(0, 5000)); 
  console.log("Done parsing");
}

run().catch(console.error);
