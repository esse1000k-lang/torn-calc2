# Render 배포 가이드 (기존 서비스 업데이트 포함)

Render에 이미 올려 둔 게 있으면 **코드만 푸시**하면 자동으로 다시 배포됩니다.

---

## 1. 코드 올리기 (최신 반영)

로컬에서 터미널 열고 프로젝트 폴더로 이동한 뒤:

```bash
git add .
git commit -m "최신 반영"
git push
```

- Render가 **자동 배포** 켜져 있으면 push 하면 곧바로 새로 빌드·배포됨.
- 수동 배포면 Render 대시보드에서 **Manual Deploy → Deploy latest commit** 클릭.

---

## 2. 환경 변수 확인 (Render 대시보드)

1. [Render 대시보드](https://dashboard.render.com) 로그인
2. 해당 **Web Service** 클릭
3. 왼쪽 **Environment** 메뉴

아래가 **반드시** 들어가 있는지 확인하세요.

| Key | 설명 |
|-----|------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | 32자 이상 랜덤 문자열 (없으면 프로덕션에서 서버 안 뜸) |
| `MONGODB_URI` | MongoDB 연결 주소 (DB 쓸 때 필수) |

**DB 접속 정보 (가장 흔한 원인)**  
- **Host**: 서버(Render)에서는 **로컬 주소(localhost, 127.0.0.1)를 쓰면 안 됩니다.** MongoDB Atlas나 실제 DB 서버의 **공인 주소/도메인**을 넣어야 합니다.  
- **계정·비밀번호**: 로컬 DB와 서버 DB가 다르다면, Render Environment에는 **서버(Atlas 등)에서 쓰는 계정·비밀번호**를 넣어야 합니다. 로컬 `.env` 값을 그대로 복사했다면, 그게 **같은 DB(Atlas)** 를 가리킬 때만 맞습니다.  
- `.env`는 Git에 올라가지 않으므로, **Render 대시보드 → Environment**에서 직접 입력해야 합니다. 로컬 `.env`를 서버에 복사했다고 착각하지 마세요.

- 수정했으면 **Save** 후, 필요하면 "Save and deploy" 로 한 번 더 배포.

---

## 3. DB는 MongoDB 쓰는 게 좋음 (Render)

- Render는 **재배포할 때마다 디스크가 비워질 수 있어서** `data/` 파일 저장은 **사라질 수 있음**.
- **세션도** 파일 모드(`data/sessions.json`)면 재배포 시 전부 사라져서, **로그인한 사용자가 채팅에서 "회원가입 또는 로그인 후 이용 가능합니다"로 보이는 현상**이 납니다. 채팅·로그인 유지가 배포 후에도 되려면 **반드시 `MONGODB_URI`를 넣어 두세요.** (세션을 MongoDB에 저장해야 재시작 후에도 유지됨)
- 이미 `MONGODB_URI` 넣어 두었으면 그대로 두면 됨.

---

## 4. 관리자 계정(admin109) 만들기

Render는 서버 안에 들어가서 명령어 치는 게 보통 없으니까, **로컬 PC에서** 같은 DB에 계정만 넣어 주면 됩니다.

1. **로컬**에 `.env` 파일 열기 (또는 만들기)
2. **Render에 넣은 것과 똑같은** `MONGODB_URI` 한 줄만 넣기  
   (다른 건 안 넣어도 됨)
3. 프로젝트 폴더에서 터미널로:

```bash
node scripts/create-admin-account.js
```

4. "관리자 계정이 생성되었습니다" 나오면 끝.  
   이제 웹에서 **admin109 / 111111** 로 로그인 가능.

- 이미 한 번 돌렸다면 다시 안 해도 됨.

---

## 5. 배포 후 확인

- 사이트 주소 열어서 로그인·피드·채팅 되는지 확인.
- **admin109** 로 로그인해서 상단 🛠️ 관리자 메뉴 보이는지 확인.

---

## 6. 쿠키/세션 설정 (실제 도메인에서 로그인 유지)

로컬(localhost)과 달리 **실제 도메인**에서는 보안 때문에 쿠키가 저장·전달되지 않을 수 있습니다. 아래를 확인하세요.

### 2) 토큰(JWT) 전달 방식 — 이 프로젝트는 쿠키만 사용

- **인증은 `session` 쿠키만 사용합니다.** `Authorization` 헤더, JWT, LocalStorage/ sessionStorage 에 세션을 넣지 않습니다.
- 따라서 **로컬에서는 잘 되는데 배포에서만 401** 이라면, “토큰을 못 읽어옴”이 아니라 **쿠키가 설정·전달되지 않는 문제**일 가능성이 큽니다.
- 체크: 브라우저 **Application** → **Cookies** 에 `session` 이 있는지, **Local Storage** 에 세션용 키가 있는지는 보지 않아도 됩니다(사용 안 함).

### 3) 도메인 간 세션 불일치 (프론트 ≠ API 주소)

- **프론트** `https://tornfi.com` / **API** `https://api.tornfi.com` 처럼 **호스트가 다르면** SameSite 정책 때문에 쿠키가 API 요청에 안 붙을 수 있습니다.
- **권장**: 가능하면 **같은 호스트**에서 HTML과 API 제공 (예: `https://tornfi.com` 에서 `/api/...` 호출). 이렇게 하면 SameSite 이슈가 없습니다.
- **부득이하게 프론트와 API를 서브도메인으로 나눌 때**  
  - API 서버(Render 등) Environment에 다음을 설정:
    - `COOKIE_DOMAIN=.tornfi.com` (앞에 점 포함, 본인 도메인으로 변경)
    - `COOKIE_SAMESITE=none` (크로스 사이트 요청에도 쿠키 전달, **HTTPS 필수**)
  - 프론트엔드에서 API 요청 시 `credentials: 'include'` 사용 (이 프로젝트는 기본이 `same-origin` 이므로, API를 다른 호스트로 두었다면 fetch 옵션 수정 필요).

### 체크포인트

| 확인 항목 | 설명 |
|-----------|------|
| **Set-Cookie 저장** | 로그인 직후 **Network** → `api/login` 요청 → **Response Headers** 에 `Set-Cookie: session=...` 있는지, **Application** → **Cookies** 에 `session` 이 생겼는지 확인. |
| **백엔드 CORS** | 서버는 `Access-Control-Allow-Credentials: true` 를 보내도록 설정돼 있음. |
| **프론트엔드 fetch** | 같은 도메인이면 `credentials: 'same-origin'`, **다른 도메인/서브도메인**이면 `credentials: 'include'` 로 쿠키 전송. |

### 해결 시도

- **Set-Cookie가 안 보이거나 쿠키가 안 생김**  
  - 접속 주소를 **하나로 통일**하세요. `https://www.도메인.com` 과 `https://도메인.com` 이 다르면 쿠키가 공유되지 않을 수 있습니다.  
  - 서비스가 **HTTPS**인지 확인. 프로덕션에서는 쿠키에 `Secure` 가 붙어 있어서 HTTP에서는 저장되지 않습니다.  
  - **서브도메인**을 쓰면 `COOKIE_DOMAIN=.도메인.com` (앞에 점)을 Environment에 넣어야 할 수 있습니다.
- **프론트와 API가 다른 호스트(예: tornfi.com vs api.tornfi.com)**  
  - 위 **3) 도메인 간 세션 불일치** 대로 `COOKIE_DOMAIN`·`COOKIE_SAMESITE=none` 설정 후, 프론트에서 API 호출 시 `credentials: 'include'` 사용.
- **CORS / credentials**  
  - 같은 서버에서 HTML과 API를 함께 쓰면 `credentials: 'same-origin'` 으로 충분합니다.  
  - API를 다른 도메인으로 분리했다면 `credentials: 'include'` 로 바꾸고, 서버 CORS에서 해당 도메인을 허용해야 합니다.

---

## 7. 문제 생겼을 때

- **로그인 안 됨 / 401**  
  - Environment에 `SESSION_SECRET` 있는지, 32자 이상인지 확인.  
  - 위 **6. 쿠키/세션 설정** 에서 Set-Cookie·쿠키 저장 여부 확인.  
  - **원인 파악**: 로그인한 뒤 **같은 브라우저**에서 `https://본인서비스주소/api/debug-auth` 를 연다. 응답의 `hasCookie`, `hasSignedSession`, `hasUser`, `hint` 로 원인 구분 가능.
- **데이터가 안 남음 / 매번 초기화됨**  
  - `MONGODB_URI` 가 제대로 들어갔는지 확인.  
  - MongoDB Atlas에서 IP 제한(Network Access)에 **0.0.0.0/0** 허용돼 있는지 확인.
- **"bad auth : authentication failed"**  
  - Atlas 사용자명·비밀번호가 연결 문자열과 일치하는지 확인. 비밀번호에 특수문자 있으면 URL 인코딩 필요.  
  - 자세한 점검 순서는 [docs/mongodb-setup.md](./mongodb-setup.md) 맨 아래 "bad auth" 섹션 참고.
- **빌드 실패**  
  - Render 대시보드 **Logs** 탭에서 빨간 에러 메시지 확인.  
  - `npm install` 이 되는지 로컬에서 `npm install` 한 번 해보기.

---

요약: **코드는 git push → 환경 변수만 확인 → admin109는 로컬에서 스크립트 한 번** 이면 됩니다.
