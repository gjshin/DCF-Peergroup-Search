import axios from "axios";
import { API_BASE_URL, ENDPOINTS } from "./constants";
import type { AuthConfig } from "./types";

let cachedSessionId: string | null = null;

export function loadAuthConfig(): AuthConfig {
  const sessionId = process.env.KICPA_SESSION_ID;
  if (sessionId) {
    return { mode: "session", sessionId };
  }

  const username = process.env.KICPA_USERNAME;
  const password = process.env.KICPA_PASSWORD;
  if (username && password) {
    return { mode: "credentials", username, password };
  }

  throw new Error("AUTH_NOT_CONFIGURED");
}

export async function getSessionCookie(): Promise<string> {
  const config = loadAuthConfig();

  if (config.mode === "session") {
    return config.sessionId!;
  }

  if (cachedSessionId) {
    return cachedSessionId;
  }

  return login(config.username!, config.password!);
}

export async function login(username: string, password: string): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}${ENDPOINTS.LOGIN}`,
    new URLSearchParams({ username, password }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      timeout: 15000,
    }
  );

  const setCookieHeaders = response.headers["set-cookie"];
  if (setCookieHeaders) {
    for (const cookie of setCookieHeaders) {
      const match = cookie.match(/JSESSIONID=([^;]+)/);
      if (match) {
        cachedSessionId = match[1];
        return cachedSessionId;
      }
    }
  }

  throw new Error("LOGIN_FAILED");
}

export async function refreshSession(): Promise<string> {
  const config = loadAuthConfig();

  if (config.mode === "credentials") {
    cachedSessionId = null;
    return login(config.username!, config.password!);
  }

  throw new Error("SESSION_EXPIRED");
}

export function clearCachedSession(): void {
  cachedSessionId = null;
}
