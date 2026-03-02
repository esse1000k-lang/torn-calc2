# 로그인 수정 전 상태 (되돌리기용)

**수정 일시:** 2025-02-27  
**되돌리기:** 아래 파일들을 원래대로 복구하면 됨.  
`git checkout -- lib/db.js server.js public/js/chat-page.js`  
또는  
`git diff lib/db.js server.js public/js/chat-page.js` 로 변경 내용 확인 후 수동 복구.

## 변경된 파일 요약

1. **lib/db.js**  
   - `getSession`: 파일 모드에서 `return null` → `return fileGetSession(token)`  
   - `setSession`: 파일 모드에서 아무것도 안 함 → `await fileSetSession(token, data)`

2. **server.js**  
   - 보안 헤더 미들웨어 다음에 CORS 미들웨어 추가 (Origin 허용 + credentials)  
   - 로그인 응답 쿠키: `secure`를 `req.secure || req.get('x-forwarded-proto') === 'https'` 조건으로 설정

3. **public/js/chat-page.js**  
   - `fetchChat()` / `startChatPoll()` 호출을 `TornFiAuth.init().then(...)` 안으로 이동 (첫 로딩 레이스 완화)
