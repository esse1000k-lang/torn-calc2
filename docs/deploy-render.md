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

- 수정했으면 **Save** 후, 필요하면 "Save and deploy" 로 한 번 더 배포.

---

## 3. DB는 MongoDB 쓰는 게 좋음 (Render)

- Render는 **재배포할 때마다 디스크가 비워질 수 있어서** `data/` 파일 저장은 **사라질 수 있음**.
- 그래서 **MongoDB(Atlas 등)** 쓰는 걸 권장합니다.
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

## 6. 문제 생겼을 때

- **로그인 안 됨**  
  - Environment에 `SESSION_SECRET` 있는지, 32자 이상인지 확인.
- **데이터가 안 남음 / 매번 초기화됨**  
  - `MONGODB_URI` 가 제대로 들어갔는지 확인.  
  - MongoDB Atlas에서 IP 제한(Network Access)에 **0.0.0.0/0** 허용돼 있는지 확인.
- **빌드 실패**  
  - Render 대시보드 **Logs** 탭에서 빨간 에러 메시지 확인.  
  - `npm install` 이 되는지 로컬에서 `npm install` 한 번 해보기.

---

요약: **코드는 git push → 환경 변수만 확인 → admin109는 로컬에서 스크립트 한 번** 이면 됩니다.
