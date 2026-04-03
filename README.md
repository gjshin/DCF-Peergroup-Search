# KICPA Beta MCP Server

한국공인회계사회(KICPA) CHECKExpert+ 베타계수 및 기업 밸류에이션 데이터 조회를 위한 **웹 MCP 서버**입니다.
Vercel에 배포하여 Claude for Excel, Claude Code 등 원격 MCP 클라이언트에서 사용할 수 있습니다.

## MCP 도구

| 도구 | 설명 | 데이터 소스 |
|------|------|-------------|
| `kicpa_get_beta` | 종목 베타계수 조회 (1Y~5Y, 실질/조정베타, Daily/Weekly/Monthly) | KICPA CHECKExpert+ |
| `search_stock` | 종목명/종목코드로 한국 주식 종목 검색 | 네이버 금융 |
| `dart_get_company` | DART 기업 기본정보 조회 (종목코드 → corp_code 매핑) | OpenDART |
| `dart_get_financials` | 재무제표 조회 (밸류에이션 모드/전체 모드, 이자부부채 유동/비유동 분류) | OpenDART |
| `naver_get_market_data` | 주가·시가총액·PER·PBR·업종분류·동종업종 조회 | 네이버 금융 |
| `valuation_get_data` | 밸류에이션 통합 데이터 (베타+재무+주식수+종가) 한번에 조회 | KICPA + OpenDART + 네이버 |

## 기술 스택

- **Next.js 15** + **mcp-handler** (Streamable HTTP transport)
- **Vercel** 배포 (서버리스)
- **MCP SDK** `@modelcontextprotocol/sdk ^1.26.0`
- **MCP 엔드포인트**: `POST /api/mcp`

## 프로젝트 구조

```
├── app/api/[transport]/route.ts   # MCP 핸들러 (도구 등록)
├── src/services/
│   ├── tools/                     # MCP 도구 정의
│   │   ├── get-beta.ts            # kicpa_get_beta
│   │   ├── search-stock.ts        # search_stock
│   │   ├── dart-company.ts        # dart_get_company
│   │   ├── dart-financials.ts     # dart_get_financials
│   │   ├── naver-market-data.ts   # naver_get_market_data
│   │   └── valuation-data.ts      # valuation_get_data
│   ├── kicpa/                     # KICPA/KOSCOM 인증 및 API 클라이언트
│   ├── opendart/                  # OpenDART API 클라이언트
│   ├── naver/                     # 네이버 금융 API 클라이언트
│   ├── common/                    # 종목코드 리졸버 등 공통 서비스
│   └── utils/                     # 에러 핸들러, 포맷터
├── data/corp-codes.json           # DART 기업코드 매핑 데이터
└── scripts/update-corp-codes.ts   # 기업코드 업데이트 스크립트
```

---

## 로컬 개발

```bash
npm install
npm run dev
```

서버가 `http://localhost:3000`에서 실행됩니다.

### MCP 테스트

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

---

## Vercel 배포

### 1. GitHub에 push 후 Vercel에서 import

Vercel Dashboard에서 **New Project** → GitHub 저장소 선택 → 자동 빌드/배포

### 2. 환경변수 설정

Vercel Dashboard → **Settings** → **Environment Variables**에서 아래 변수를 설정합니다.

#### KICPA 인증 (베타계수 조회용)

**방식 A: 세션 쿠키 직접 입력 (권장)**

| 변수명 | 값 |
|--------|-----|
| `KICPA_SESSION_ID` | 브라우저에서 복사한 JSESSIONID 값 |

**JSESSIONID 얻는 방법:**

1. 브라우저에서 https://datamall.koscom.co.kr 에 로그인
2. **F12** (개발자 도구) → **Application** 탭 → **Cookies** → `datamall.koscom.co.kr` 클릭
3. `JSESSIONID` 행의 **Value** 복사
4. Vercel 환경변수 `KICPA_SESSION_ID`에 붙여넣기

> 세션은 일정 시간 후 만료됩니다. 만료 시 위 과정을 반복하여 갱신해주세요.

**방식 B: 자동 로그인**

| 변수명 | 값 |
|--------|-----|
| `KICPA_USERNAME` | KICPA 회원 아이디 |
| `KICPA_PASSWORD` | KICPA 회원 비밀번호 |

> 서버가 자동으로 로그인하여 세션을 관리합니다. 세션 만료 시 자동 재로그인합니다.

#### OpenDART API (재무제표/기업정보 조회용)

| 변수명 | 값 |
|--------|-----|
| `OPENDART_API_KEY` | OpenDART API 키 ([발급](https://opendart.fss.or.kr)) |

### 3. 배포 완료 후 MCP URL

```
https://<your-app>.vercel.app/api/mcp
```

---

## 클라이언트 연결

### Claude for Excel

MCP 서버 URL에 다음을 입력:

```
https://<your-app>.vercel.app/api/mcp
```

### Claude Code

```bash
claude mcp add kicpa-beta --transport http https://<your-app>.vercel.app/api/mcp
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

URL에 `https://<your-app>.vercel.app/api/mcp` 입력

---

## 사용 예시

Claude에게 다음과 같이 요청할 수 있습니다:

- "삼성전자 베타계수 알려줘"
- "005930, 000660 종목의 2년, 5년 베타를 조회해줘"
- "삼성전자 재무제표 보여줘"
- "삼성전자 밸류에이션 데이터 한번에 뽑아줘"
- "현대차 시가총액이랑 PER 알려줘"
- "삼성 관련 종목코드를 검색해줘"

## 베타계수 설명

| 항목 | 설명 |
|------|------|
| **실질베타 (Raw Beta)** | 회귀분석으로 산출된 원시 베타값 |
| **조정베타 (Adjusted Beta)** | `실질베타 × 2/3 + 1/3` |
| **포인트수** | 베타 산출에 사용된 데이터 포인트 수 |
| **대표지수** | 국내 KOSPI, 미국 S&P500 |

## 인증 관련 주의사항

- KICPA 베타계수 조회는 **한국공인회계사회 회원 전용**입니다 (KICPA 계정 필요)
- OpenDART 재무제표 조회는 **OpenDART API 키**가 필요합니다 (무료 발급)
- 네이버 금융 데이터 (종목검색, 시장데이터)는 별도 인증 불필요
- 방식 A (세션 쿠키)는 단순하지만 주기적 갱신 필요
- 방식 B (자동 로그인)는 편리하지만 KICPA 로그인 플로우 변경 시 동작하지 않을 수 있음
- Vercel 서버리스 함수는 stateless이므로, 방식 B 사용 시 매 요청마다 세션 확인/재로그인이 발생할 수 있음
