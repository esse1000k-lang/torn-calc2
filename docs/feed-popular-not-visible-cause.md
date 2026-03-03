# 피드 인기글 박스가 안 보일 때 — 원인 점검

수정은 하지 않고, **가능한 원인**만 정리한 문서입니다.

---

## 1. 현재 코드 기준 구조 (index.html)

- **인기글 블록**은 **내정보/로그아웃 버튼 바로 아래**, **안내 배너(announcementBanner) 위**에 있습니다.
- DOM 순서:  
  `mobile-home-menu` → `home-actions-below-banner` → **`#feedPopularWrap` (인기글)** → `#announcementBanner` → (스크립트들) → `#feedSection` (글쓰기 + 피드 목록)

즉, 이 repo의 `public/index.html`에는 인기글 마크업이 들어 있어 있고, CSS/JS로 숨기는 코드는 없습니다.

---

## 2. 가능한 원인

### 2-1. **실제로 쓰는 HTML이 이 버전이 아님 (가장 유력)**

- **로컬**: 브라우저 캐시 때문에 예전 `index.html`이 로드되고 있을 수 있음.  
  → 그 예전 버전에는 인기글 블록(`#feedPopularWrap`)이 없을 수 있음.
- **배포(tornfi.com 등)**: 서버에 올라간 `index.html`이 지금 로컬 파일과 다를 수 있음.  
  → 배포 시 인기글 추가분이 반영되지 않았을 수 있음.

**확인 방법**

- 브라우저에서 **개발자 도구(F12) → Elements(요소)** 로 가서 `id="feedPopularWrap"` 또는 "인기글" 텍스트로 검색.
  - **없음** → 실제로 로드된 HTML에 인기글이 없음. (캐시 또는 배포 버전 문제)
  - **있음** → 아래 2-2, 2-3으로.

### 2-2. **스크롤 위치**

- 인기글은 **버튼(내정보/로그아웃) 바로 아래**라서, 스크롤을 많이 내리면 화면 밖으로 올라가 있을 수 있음.
- **확인**: 페이지 최상단으로 스크롤한 뒤, 버튼 아래를 보면 인기글이 있어야 함.

### 2-3. **CSS가 다른 파일에서 덮어씀**

- 이 repo의 `site.css`에는 `.feed-popular-wrap`을 숨기는 `display: none` / `visibility: hidden`이 없음.
- **확인**: 개발자 도구에서 `#feedPopularWrap` 요소를 선택한 뒤, **Computed** 또는 **Styles**에서 `display`, `visibility`, `height`, `opacity`가 0/ none/hidden으로 덮여 있는지 확인.

### 2-4. **JS에서 요소를 숨기거나 제거**

- 코드 상으로는 `feedPopularWrap`에 `display = 'none'`을 넣는 부분이 없음.
- **확인**: Elements에서 `#feedPopularWrap`이 있는데, 인라인 스타일로 `display: none`이 붙어 있는지 확인.

### 2-5. **스크립트 오류로 loadPopularFeed()가 안 불림**

- `loadPopularFeed()`는 `initFeed()` IIFE 안에서 한 번 호출됨.  
  그 전에 스크립트 에러가 나면 여기까지 실행이 안 될 수 있음.  
  (인기글 **박스 자체**는 HTML에 있으므로, “박스가 아예 안 나옴”이라면 보통 2-1이 더 가능성이 큼.)
- **확인**: 개발자 도구 **Console**에 빨간 에러가 있는지 확인.

---

## 3. 한 번에 확인하는 방법

1. **캐시 무시 새로고침**  
   - Windows: `Ctrl + Shift + R` 또는 `Ctrl + F5`  
   - Mac: `Cmd + Shift + R`
2. **개발자 도구(F12) → Elements** 에서 `feedPopularWrap` 검색.
   - 없으면 → **캐시 또는 배포된 HTML이 예전 버전** (2-1).
   - 있으면 → 해당 요소에 적용된 `display`/`visibility`/`height` 확인 (2-3, 2-4).
3. **Console** 에러 확인 (2-5).

---

## 4. 정리

- **지금 코드만 보면** 인기글은 “버튼 아래, 안내 배너 위”에 있고, 숨기는 CSS/JS는 없음.
- 그래서 **실제로 어떤 HTML이 로드되는지**(캐시/배포)를 먼저 확인하는 것이 가장 중요합니다.
