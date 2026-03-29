# KICPA Beta MCP Server

한국공인회계사회(KICPA) CHECKExpert+ 베타계수 조회 서비스를 위한 MCP 서버입니다.

## 기능

- **`kicpa_get_beta`**: 종목 베타계수 조회 (1Y/2Y/3Y/5Y, 실질/조정베타)
- **`kicpa_search_stock`**: 종목명으로 종목코드 검색

## 설치

```bash
npm install
npm run build
```

## 인증 설정

이 서비스는 한국공인회계사회 회원 전용입니다. 다음 두 가지 방식 중 하나로 인증합니다.

### 방식 A: 세션 쿠키 직접 입력 (권장)

1. 브라우저에서 https://datamall.koscom.co.kr 에 로그인
2. 개발자 도구(F12) → Application → Cookies → `JSESSIONID` 값 복사
3. 환경변수 설정:

```bash
export KICPA_SESSION_ID="복사한_JSESSIONID_값"
```

### 방식 B: 자동 로그인

```bash
export KICPA_USERNAME="KICPA_아이디"
export KICPA_PASSWORD="KICPA_비밀번호"
```

## Claude Code에 연결

```bash
claude mcp add kicpa-beta -- node /path/to/kicpa-beta-mcp/dist/index.js
```

환경변수와 함께:

```bash
claude mcp add kicpa-beta -e KICPA_SESSION_ID="세션값" -- node /path/to/kicpa-beta-mcp/dist/index.js
```

## 사용 예시

Claude에게 다음과 같이 요청할 수 있습니다:

- "삼성전자 베타계수 알려줘"
- "005930, 000660 종목의 2년, 5년 베타를 조회해줘"
- "AAPL의 미국 시장 베타계수를 확인해줘"
- "삼성 관련 종목코드를 검색해줘"

## 베타계수 설명

- **실질베타 (Raw Beta)**: 회귀분석으로 산출된 원시 베타값
- **조정베타 (Adjusted Beta)**: `실질베타 × 2/3 + 1/3`
- **포인트수**: 베타 산출에 사용된 데이터 포인트 수
- **대표지수**: 국내 KOSPI, 미국 S&P500
