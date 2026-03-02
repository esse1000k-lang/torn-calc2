# 채팅 메시지에 id가 없어서 버튼(복사/수정/삭제)이 안 먹히던 문제 — 원인 정리

## 현상
- 말풍선 옆 [복사] [수정] [삭제] 버튼을 눌러도 아무 반응 없음.
- 클릭/이벤트는 정상 도달했고, **클릭 핸들러에서 `row.dataset.messageId`가 비어 있어서** `runDropdownAction`을 호출하지 않고 return 하고 있었음.

## 원인 체인

### 1. 클라이언트(chat-page.js)
- 메시지를 그릴 때 `data-message-id="' + escapeHtml(m.id) + '"` 로 넣음.
- **`m.id`가 없거나 빈 값**이면 → HTML에 `id="chat-msg-"`, `data-message-id=""` 로 렌더됨.
- 클릭 시 `if (!row.dataset.messageId) return;` 에 걸려서 **의도적으로 동작 스킵**.

### 2. 서버(server.js)
- `GET /api/chat` 에서 `db.readChatMessages()` 결과를 그대로 `{ ...m, profileImageUrl, level, isAdmin }` 로 내려줌.
- 즉 **DB에서 내려온 메시지에 `id`가 없으면** 클라이언트도 `m.id` 없이 받음.

### 3. DB(lib/db.js) — id가 없을 수 있는 경우

| 저장소 | id가 없을 수 있는 경우 |
|--------|------------------------|
| **파일 (data/chat.json)** | 예전 버전 코드가 메시지 저장 시 `id`를 넣지 않았거나, 파일을 수동 편집/다른 소스에서 이관한 데이터가 들어간 경우. **현재 append 코드는 항상 id 부여** (`id = msg.id \|\| crypto.randomBytes(8).toString('hex')`). |
| **MongoDB** | 예전에 `id` 없이 넣어진 문서가 있거나, 마이그레이션 시 **id 없는 메시지는 스킵**(`if (id == null) continue`)하기 때문에, 파일에만 있던 “id 없는 레거시 메시지”는 Mongo에는 안 올라가고, **파일 모드로 읽을 때만** 그대로 노출됨. |

정리하면, **과거에 한 번이라도 “id 없이” 쌓인 채팅 데이터(파일 또는 구 Mongo 문서)가 있고, 그걸 그대로 읽어서 내려주다 보니** 클라이언트에서 `m.id`가 비어 있었던 것.

## 재발 방지

### 이미 적용된 것 (클라이언트)
- **템플릿**: `m.id`가 없으면 `msgIdVal = 'idx-' + idx` 로 넣어서 모든 행에 `data-message-id` 존재.
- **클릭 처리**: message id 없어도 **복사**는 행 텍스트 기준으로 실행; `idx-` 로 시작하는 id는 수정/삭제 시 "수정/삭제할 수 없습니다" 처리.

### 추가로 권장 (선택)
1. **서버에서 내려주기 전 정규화**  
   `GET /api/chat` 에서 `enriched` 만들 때, `id` 없으면 `id: 'legacy-' + index` 같은 값을 채워서 **절대 id가 비어 있지 않게** 해두기.
2. **data/chat.json 점검**  
   파일 모드 사용 중이면 `data/chat.json` 에 `id` 없는 항목이 있는지 확인 후, 있으면 한 번 스크립트로 `id` 부여하거나 정리.
3. **새 메시지**  
   지금도 `appendChatMessage` 는 항상 `id`를 넣으므로, **앞으로 새로 쌓이는 메시지는 id 있음**. 문제는 **이미 쌓여 있던 레거시 데이터**만 해당.

## 요약 한 줄
**예전에 id 없이 저장된 채팅 메시지가 DB(파일/Mongo)에 남아 있어서, 클라이언트가 `m.id` 없이 렌더했고, 클릭 핸들러가 “id 없으면 아무 것도 안 함”으로 막혀 있던 것이 종합 원인.**
