import axios from "axios";
import { API_BASE_URL, ENDPOINTS } from "./constants";

/**
 * 세션 관리: GET 페이지 접속으로 JSESSIONID 쿠키를 자동 획득.
 * 로그인 불필요 — 세션 쿠키만 있으면 API 호출 가능.
 */

let cachedSessionId: string | null = null;

export async function getSessionCookie(): Promise<string> {
  if (cachedSessionId) {
    return cachedSessionId;
  }

  return acquireSession();
}

/**
 * 검색 페이지에 GET 요청을 보내서 JSESSIONID 세션 쿠키를 획득
 */
async function acquireSession(): Promise<string> {
  console.log("[KICPA Session] Acquiring new session via page GET...");

  const response = await axios.get(
    `${API_BASE_URL}${ENDPOINTS.DAILY_SEARCH_PAGE}`,
    {
      maxRedirects: 5,
      validateStatus: () => true,
      timeout: 15000,
      // 쿠키를 받기 위해 필요
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KicpaBetaMCP/1.0)",
      },
    }
  );

  const setCookieHeaders = response.headers["set-cookie"];
  if (setCookieHeaders) {
    for (const cookie of setCookieHeaders) {
      const match = cookie.match(/JSESSIONID=([^;]+)/);
      if (match) {
        cachedSessionId = match[1];
        console.log("[KICPA Session] JSESSIONID acquired successfully");
        return cachedSessionId;
      }
    }
  }

  throw new Error("SESSION_ACQUIRE_FAILED: No JSESSIONID in response");
}

export async function refreshSession(): Promise<string> {
  cachedSessionId = null;
  return acquireSession();
}

export function clearCachedSession(): void {
  cachedSessionId = null;
}
