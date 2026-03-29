import axios, { AxiosError } from "axios";

export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosErr = error as AxiosError;
    if (axiosErr.response) {
      switch (axiosErr.response.status) {
        case 401:
        case 403:
          return "Error: 인증 실패. 세션이 만료되었을 수 있습니다. KICPA_SESSION_ID를 갱신하거나 KICPA_USERNAME/KICPA_PASSWORD를 확인해주세요.";
        case 404:
          return "Error: API 엔드포인트를 찾을 수 없습니다. KOSCOM 서비스 URL이 변경되었을 수 있습니다.";
        case 500:
          return "Error: KOSCOM 서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
        default:
          return `Error: API 요청 실패 (HTTP ${axiosErr.response.status})`;
      }
    } else if (axiosErr.code === "ECONNABORTED") {
      return "Error: 요청 시간 초과. KOSCOM 서버 응답이 없습니다. 잠시 후 다시 시도해주세요.";
    } else if (axiosErr.code === "ECONNREFUSED") {
      return "Error: KOSCOM 서버에 연결할 수 없습니다. 네트워크 연결을 확인해주세요.";
    }
  }
  return `Error: 예기치 않은 오류 발생: ${error instanceof Error ? error.message : String(error)}`;
}

export function createSessionExpiredError(mode: "session" | "credentials"): string {
  if (mode === "session") {
    return [
      "Error: 세션이 만료되었습니다.",
      "",
      "해결 방법:",
      "1. 브라우저에서 https://datamall.koscom.co.kr 에 로그인",
      "2. 개발자 도구(F12) → Application → Cookies 에서 JSESSIONID 값 복사",
      "3. Vercel 환경변수 KICPA_SESSION_ID에 새 값 설정",
    ].join("\n");
  }
  return "Error: 자동 로그인 실패. KICPA_USERNAME과 KICPA_PASSWORD를 확인해주세요.";
}

export function createAuthConfigError(): string {
  return [
    "Error: 인증 정보가 설정되지 않았습니다.",
    "",
    "Vercel 환경변수에 다음 중 하나를 설정해주세요:",
    "",
    "방식 A (세션 쿠키 직접 입력):",
    "  KICPA_SESSION_ID=<브라우저에서 복사한 JSESSIONID 값>",
    "",
    "방식 B (자동 로그인):",
    "  KICPA_USERNAME=<KICPA 아이디>",
    "  KICPA_PASSWORD=<KICPA 비밀번호>",
  ].join("\n");
}
