# 토네이도 뉴스 수집 소스 정리

## 1. 현재 상황

### 왜 한 건도 수집되지 않았나
- **코인니스**(https://coinness.com/news), **블루밍비트**(https://bloomingbit.io/)는 **JavaScript로 기사 목록을 그리는 SPA**입니다.
- 서버에서 HTML만 가져오면 기사 링크가 포함되지 않은 빈 껍데기만 내려옵니다.
- 따라서 **HTML 파싱만으로는 수집 가능한 문서가 없습니다.**

### 수집 조건 (서버 기준)
- **2026-02-20 이후** 기사만 추가 (날짜 없으면 허용).
- 제목·카드 텍스트에 **키워드**(프라이버시, 토네이도 캐시, TORN, 해킹, 세탁, mixer, privacy 등)가 있을 때만 수집.

---

## 2. 선택지 정리

| 방법 | 설명 | 난이도 |
|------|------|--------|
| **RSS 소스 사용** | RSS 피드를 소스로 등록하면 XML만 받아도 기사 목록을 파싱할 수 있음. **권장.** | 낮음 (구현됨) |
| **다른 웹사이트로 교체** | 첫 응답 HTML에 기사 링크가 있는 사이트를 소스로 사용. | 낮음 |
| **Puppeteer/Playwright** | 브라우저 자동화로 JS 렌더링 후 HTML 수집. | 높음 (설치·유지보수 부담) |
| **수동 등록 위주** | 자동 수집은 보조로 두고, 회원이 뉴스를 수동 등록. | 없음 |

---

## 3. 기본 RSS 소스 (해외·수집 가능)

**기본 소스**로 아래 해외 암호화폐 뉴스 RSS가 등록되어 있습니다. 한글 번역하면 그대로 활용 가능합니다.

| 소스명 | RSS URL | 비고 |
|--------|---------|------|
| Cointelegraph | `https://cointelegraph.com/rss` | 메인 피드 |
| Cointelegraph (규제) | `https://cointelegraph.com/rss/tag/regulation` | 규제/제재·토네이도 캐시 등 |
| Cointelegraph (DeFi) | `https://cointelegraph.com/rss/tag/defi` | DeFi·프라이버시 프로토콜 |
| Decrypt | `https://decrypt.co/feed` | Bitcoin, Ethereum, DeFi, 문화·규제 |
| CoinDesk | `https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml` | 시장·기술·정책 |

### 추가로 넣을 수 있는 RSS (한국어·기타)
| 소스명 | RSS URL |
|--------|---------|
| 코인텔레그래프 한국판 | `https://kr.cointelegraph.com/rss` |
| 코인텔레그래프 한국 규제 | `https://kr.cointelegraph.com/rss/category/regulation` |

> RSS URL은 사이트 개편 시 바뀔 수 있습니다. 수집이 안 되면 해당 사이트에서 최신 RSS 주소를 확인하세요.

---

## 4. HTML 기반 대체 소스 (선택)

아래는 **첫 응답 HTML에 기사 링크가 있을 가능성이 있는** 사이트 예시입니다.  
실제로 수집되는지는 `node scripts/check-news-sources.js`로 확인한 뒤, 수집되면 소스로 추가하면 됩니다.

- **코인리더스** – https://www.coinreaders.com (토네이도캐시 기사 있음)
- **머니넷** – https://www.moneynet.co.kr (토네이도 캐시 기사 있음)
- **블록체인투데이** – https://www.blockchaintoday.co.kr
- **코인텔레그래프 기사 목록** – https://kr.cointelegraph.com/news (HTML 구조에 따라 수집 가능 여부 상이)

---

## 5. 확인 방법

- **수집 가능 문서 여부**:  
  `node scripts/check-news-sources.js`  
  → 각 소스 URL의 응답에서 링크 개수·키워드 포함 여부를 출력합니다.
- **RSS 추가 후**:  
  관리자 **뉴스 소스 · 수집**에서 RSS URL 추가 → **지금 수집** 실행 후 토네이도 뉴스 페이지에서 건수 확인.

---

## 6. 한글 번역 (선택)

- **방식**: 새로 수집된 기사 중 일부만 수집 시점에 제목·요약을 한글 번역해 저장합니다. 이미 한글이면 번역하지 않습니다. 요약은 **앞 2문장만** 저장해 핵심만 간략히 보이도록 했습니다.
- **표시**: 저장된 `titleKo`·`summaryKo`가 있으면 그대로 보여주고, 없으면 원문 제목·요약을 표시합니다.

### 가입 없이 쓰기 (기본)

- **MyMemory API**를 사용합니다. **별도 가입·API 키 없이** 동작합니다.
- 수집 1회당 **최대 5건**만 번역 (무료 한도: 일 약 5,000자).
- 환경 변수 설정 없이 서버만 켜면, 새로 수집되는 기사 중 5건까지 자동으로 한글 번역됩니다.

### 더 많이·더 좋은 품질로 쓰기 (선택)

- **DeepL API**를 쓰려면 환경 변수 `DEEPL_AUTH_KEY`에 API 키를 넣으면 됩니다.
- DeepL 사용 시 수집 1회당 **최대 10건** 번역, 품질이 더 좋습니다. [DeepL API Free](https://www.deepl.com/pro-api) 가입 후 발급 (무료 월 50만자).
- `DEEPL_AUTH_KEY`가 있으면 DeepL을 쓰고, 없으면 위처럼 MyMemory(가입 없음)를 씁니다.

---

## 7. 요약

1. **현재 기본 소스**는 해외 RSS(Cointelegraph, Decrypt, CoinDesk 등)로 설정되어 있어 수집이 가능합니다.
2. **한글 번역**은 선택 사항입니다. `DEEPL_AUTH_KEY`를 설정하면 수집 시 최대 10건씩 제목·요약이 한글로 번역되어, 핵심만 간략하게 표시됩니다.
3. 추가 소스는 관리자 **뉴스 소스 · 수집**에서 등록하고, `node scripts/check-news-sources.js`로 수집 가능 여부를 확인할 수 있습니다.
