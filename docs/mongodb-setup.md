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
