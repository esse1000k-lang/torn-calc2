# MongoDB로 영구 저장 사용하기

회원·게시글·채팅 등을 **영구적으로 보관**하려면 MongoDB를 사용하면 됩니다.  
`MONGODB_URI`만 설정하면 코드 수정 없이 DB 모드로 동작합니다.

## 1. MongoDB Atlas에서 무료 클러스터 만들기

1. [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) 접속 후 회원가입/로그인
2. **Build a Database** → **M0 FREE** 선택 → Create
3. **Username / Password** 설정 후 Create User
4. **Where would you like to connect from?** → **My Local Environment** 또는 **0.0.0.0/0** (모든 IP 허용) 후 Finish
5. **Connect** 클릭 → **Drivers** 선택 → 연결 문자열 복사  
   (예: `mongodb+srv://username:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`)

## 2. 프로젝트에 적용

1. 프로젝트 루트에 `.env` 파일이 없으면 `.env.example`을 복사해 `.env` 생성
2. `.env`에 다음 한 줄 추가 (비밀번호는 본인 설정한 값으로 교체):

   ```
   MONGODB_URI=mongodb+srv://username:비밀번호@cluster0.xxxxx.mongodb.net/tornfi?retryWrites=true&w=majority
   ```

   - `username`: Atlas에서 만든 DB 사용자 이름  
   - `비밀번호`: 해당 사용자 비밀번호. **특수문자(@, #, :, /, ?, &, =, % 등)가 있으면 반드시 URL 인코딩** (예: `@` → `%40`, `#` → `%23`)  
   - `tornfi`: 사용할 DB 이름 (원하면 다른 이름으로 변경 가능)  
   - 연결 문자열 끝에 `?retryWrites=true&w=majority` 포함 권장 (이미 있으면 그대로 사용)

3. 서버 재시작

이후에는 회원·게시글·채팅·설정 등이 모두 MongoDB에 저장되며, 배포나 서버 재시작 후에도 유지됩니다.

## 참고

- `.env`는 Git에 올리지 마세요 (이미 `.gitignore`에 포함되어 있을 수 있음)
- 기존에 `data/*.json`으로 쓰던 데이터는 자동으로 MongoDB로 옮겨지지 않습니다. 필요하면 한 번만 수동 이전하거나, 새로 시작하면 됩니다.

---

## "bad auth : authentication failed" 나올 때 (처음부터 점검)

이 오류는 **연결 문자열 형식은 맞지만**, Atlas가 **사용자명/비밀번호를 거부**할 때 납니다. 아래를 **순서대로** 확인하세요.

### 1) Atlas에 DB 사용자가 있는지

1. [MongoDB Atlas](https://cloud.mongodb.com) 로그인
2. 왼쪽 **Database Access** → **Database Users**
3. 연결 문자열에 넣은 **사용자명**과 **완전히 동일한** 사용자가 있어야 함 (대소문자 구분)
   - 예: URI에 `TornFi` 라고 넣었으면 Atlas에도 `TornFi` 로 만들어져 있어야 함

### 2) 비밀번호가 정확한지

- Atlas에서 그 사용자 만들 때 설정한 **비밀번호**를 그대로 써야 함.
- **특수문자가 있으면** 연결 문자열 안에서는 **URL 인코딩**해야 함 (비밀번호 자체를 바꾸는 게 아님).
  - 예: 비밀번호가 `ab#c@12` → URI에는 `ab%23c%4012` 로 넣기
  - 자주 쓰는 것: `@` → `%40`, `#` → `%23`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `&` → `%26`, `=` → `%3D`, `%` → `%25`
- **헷갈리면**: Atlas에서 해당 사용자 비밀번호를 **특수문자 없는 새 비밀번호로 변경**한 뒤, 그 새 비밀번호를 연결 문자열에 그대로 넣어서 다시 시도해 보기.

### 3) Render에 넣은 값이 올바른지

- **Environment** → `MONGODB_URI` 값이 **한 줄**이고, **앞뒤 따옴표·공백 없이** 들어가 있는지.
- 사용자명/인코딩된 비밀번호/호스트/DB 이름이 Atlas 연결 문자열과 일치하는지.

### 4) Atlas Network Access (IP 허용)

1. Atlas 왼쪽 **Network Access**
2. **Add IP Address** → **Allow Access from Anywhere** (0.0.0.0/0) 추가
3. Render는 IP가 바뀔 수 있으므로 0.0.0.0/0 이 있어야 함

### 5) 한 번에 하나만 바꿔서 확인

- 사용자명/비밀번호/특수문자 인코딩 중 **하나만** 바꾼 뒤 저장 → 재배포 → 로그 확인.
- 로그에 `MongoDB connecting as user: TornFi` 처럼 나오면, **그 사용자명**으로 Atlas에 로그인하려는 게 맞는지 Database Access에서 다시 확인.
