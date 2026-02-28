# AGENTS.md

## Cursor Cloud specific instructions

### Overview
TornFi Community는 Tornado Cash 투자자를 위한 한국어 커뮤니티 웹앱입니다. Node.js (Express) 단일 서버로, 프론트엔드는 `public/` 디렉토리의 정적 HTML/CSS/JS입니다 (빌드 스텝 없음).

### Prerequisites
- **MongoDB** 가 반드시 실행 중이어야 합니다. `connect-mongo` 세션 스토어가 MongoDB URI를 요구합니다.
- `.env` 파일이 필요합니다 (`.env.example`에서 복사). 개발 환경에서는 `NODE_ENV=development`로 설정해야 `SESSION_SECRET` 길이 검증을 건너뜁니다.
- `.env`에 `MONGODB_URI=mongodb://localhost:27017/tornfi` 를 설정하세요.

### Running the dev server
```bash
# MongoDB 시작 (이미 실행 중이 아닌 경우)
mongod --fork --logpath /tmp/mongod.log --dbpath /data/db

# 개발 서버 실행 (nodemon 사용, 파일 변경 시 자동 재시작)
npm run dev
# 또는 직접 실행
node server.js
```
서버가 포트 3000에서 시작됩니다: http://localhost:3000

### Key caveats
- **MongoDB 필수**: `MONGODB_URI` 없이는 서버가 시작되지 않습니다 (`connect-mongo`의 `MongoStore.create()`가 `mongoUrl`을 요구).
- **Linter/테스트 프레임워크 없음**: `package.json`에 ESLint, Jest 등의 설정이 없습니다. 코드 품질 검사는 수동으로 해야 합니다.
- **파일 기반 DB 폴백**: `MONGODB_URI`가 설정되어 있으면 MongoDB를 사용하고, 없으면 `data/*.json` 파일을 사용합니다 (단, 세션 스토어는 항상 MongoDB 필요).
- 프론트엔드에 빌드 스텝이 없으므로 `public/` 디렉토리 파일 수정 후 브라우저 새로고침만 하면 됩니다.
- 닉네임: 영문+숫자 5~12자, 비밀번호: 8자 이상 (영문+숫자 필수).
