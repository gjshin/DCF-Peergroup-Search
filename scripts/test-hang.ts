import { fetchBusinessContent } from "../src/services/opendart/document-parser";
import { resolveCorpCode } from "../src/services/common/stock-code-resolver";
import fs from "fs";
const envContent = fs.readFileSync(".env.local", "utf8");
const match = envContent.match(/OPENDART_API_KEY=(.*)/);
process.env.OPENDART_API_KEY = match ? match[1].trim() : "";

async function run() {
    try {
        console.log("Resolving...");
        const code1 = await resolveCorpCode("005930");
        console.log("CorpCode:", code1);
        
        console.log("Fetching...");
        console.time("Fetch");
        const res = await fetchBusinessContent(code1!, "2023");
        console.timeEnd("Fetch");
        console.log("Length:", res.length);
        console.log(res.substring(0, 500));
    } catch(e) {
        console.error("ERROR", e);
    }
}
run();
