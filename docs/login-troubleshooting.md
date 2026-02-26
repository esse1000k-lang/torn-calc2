# 로그인 안 될 때 (DB에는 회원이 있는데 웹에서 안 됨)

## 가장 흔한 원인: **로컬과 Render가 서로 다른 DB를 보고 있음**

- **로컬**에서 `node scripts/count-users.js` / `create-admin-account.js` 는 **.env 의 MONGODB_URI** 로 접속
- **웹(Render)** 은 **Render Environment 에 넣은 MONGODB_URI** 로 접속
- 두 URI가 **조금이라도 다르면** (특히 **DB 이름** 대소문자 포함) **다른 DB**를 보게 됨  
  → 로컬 스크립트로 만든 회원은 A DB에 있고, 웹은 B DB를 보고 있으면 로그인 불가

## 확인 방법

### 1) 로컬에서 연결 중인 DB 이름 보기

```bash
node scripts/count-users.js
```

출력에 **연결 DB 이름: TornFi** 처럼 나옵니다. 이 이름을 기억해 두세요.

### 2) Render와 .env 의 MONGODB_URI 가 같은지 확인

- **Render** 대시보드 → 해당 서비스 → **Environment** → `MONGODB_URI` 값 확인
- **로컬** 프로젝트 **.env** 의 `MONGODB_URI` 값 확인
- **완전히 동일**해야 합니다. 특히:
  - `@` 뒤 **호스트명** (예: tornfi.fhjoves.mongodb.net)
  - **슬래시(/) 다음 DB 이름** (예: TornFi vs tornfi 는 **다른 DB**)
  - 대소문자까지 똑같이

### 3) 통일하기

- Render 에 넣은 값을 **그대로** 복사해서 로컬 .env 에 붙여 넣기  
  **또는**  
- 로컬 .env 값을 **그대로** 복사해서 Render Environment 에 붙여 넣기  
- 저장 후 Render 는 **재배포** 한 번 (Environment 만 바꿨으면 "Save and deploy" 또는 Manual Deploy)

### 4) 그래도 안 되면

- 로그인 시 **"닉네임 또는 비밀번호가 올바르지 않습니다"** → DB는 같은데 비밀번호 불일치. (비밀번호 재설정 스크립트 사용)
- **"관리자 승인 대기 중"** → 해당 회원의 `approved` 가 false. 관리자 승인 또는 DB에서 approved: true 로 변경 필요.
- **"테스트 회원은 로그인할 수 없습니다"** → 해당 회원에 `isFake: true` 가 있음. 일반 회원 또는 admin109 로 로그인해야 함.
