const fs=require('fs');
const docParser = require('./src/services/opendart/document-parser');
const resolver = require('./src/services/common/stock-code-resolver');

async function run(){
  // Load API Key
  const apiKey = fs.readFileSync('.env.local','utf8').match(/OPENDART_API_KEY=(.*)/)[1].trim();
  
  // Resolve corp_code for 100030
  const corpCode = await resolver.resolveCorpCode('100030');
  
  // Call download XML raw without regex
  const AdmZip = require('adm-zip');
  const axios = require('axios');
  
  const listRes = await axios.get("https://opendart.fss.or.kr/api/list.json", {
    params: {
      crtfc_key: apiKey, corp_code: corpCode, bgn_de: '20250101', end_de: '20260531', pblntf_detail_ty: "A001"
    }
  });
  
  const rceptNo = listRes.data.list[0].rcept_no;
  
  const docRes = await axios.get("https://opendart.fss.or.kr/api/document.xml", {
    params: { crtfc_key: apiKey, rcept_no: rceptNo },
    responseType: "arraybuffer", timeout: 30000
  });

  const zip = new AdmZip(Buffer.from(docRes.data));
  const xmlEntry = zip.getEntries().find(e => e.entryName.endsWith(".xml"));
  const xmlContent = xmlEntry.getData().toString("utf8");
  
  fs.writeFileSync('scripts/100030_raw.xml', xmlContent);
  console.log("Saved raw XML to scripts/100030_raw.xml");
  
  // Test native extract
  console.log("Original Regex extracted:\n", docParser.extractAndFormatMarkdown(xmlContent).substring(0,200));
}
run();
