# SSH + Cloudflare Tunnel 설정 가이드 (카페 등 외부에서 맥미니 접속)

## 1. SSH 설정 파일 찾기 (노트북·Cursor 기준)

### 1-1. SSH config 파일 위치 (Windows)
- **경로**: `C:\Users\esse1\.ssh\config`
- **폴더가 없으면**: `.ssh` 폴더를 만들고, 그 안에 `config` 파일 생성 (확장자 없음)

### 1-2. Cursor/VS Code에서 여는 방법
1. **F1** 또는 **Ctrl+Shift+P** 로 명령 팔레트 열기  
2. **"Remote-SSH: Open SSH Configuration File..."** 입력 후 선택  
3. 목록에 나오는 경로 중 **보통 `C:\Users\esse1\.ssh\config`** 선택

### 1-3. 메모장으로 여는 방법
1. **Win + R** → `notepad` 입력 후 엔터  
2. **파일 → 열기**  
3. 주소창에 `C:\Users\esse1\.ssh` 입력 후 이동  
4. **파일 형식**을 "모든 파일(*.*)"로 변경  
5. `config` 파일 선택 후 열기 (없으면 새로 만들기)

---

## 2. SSH config 내용 확인 및 수정

### 2-1. 현재 내용 예시 (집에서만 되는 상태)
```text
Host MyMacMini
    HostName 172.30.1.18
    User 여기에맥미니사용자이름
    Port 22
```

### 2-2. 바꿀 내용 (외부 와이파이에서도 되게)
- **HostName** 만 바꾸면 됨.  
- `172.30.1.18` → **Cloudflare Tunnel 공개 주소** (아래 3단계에서 확인한 주소)

```text
Host MyMacMini
    HostName ssh.당신도메인.com
    User 여기에맥미니사용자이름
    Port 22
```

- Tunnel에서 SSH를 **다른 포트**로 열어뒀으면 `Port 22` 를 그 포트 번호로 바꿈.  
- **User** 는 맥미니 로그인 사용자 이름 그대로 둠.

### 2-3. 저장
- **Ctrl+S** 로 저장 후 Cursor에서 **Remote-SSH**로 `MyMacMini` 다시 연결 시도.

---

## 3. Cloudflare Tunnel 공개 주소(호스트명) 찾기

### 3-1. Cloudflare 대시보드 들어가기
1. 브라우저에서 **https://dash.cloudflare.com** 접속  
2. 로그인  
3. **Zero Trust** 쓰는 경우: **https://one.dash.cloudflare.com** 로 이동

### 3-2. Zero Trust에서 Tunnel 목록 보기
1. 왼쪽 메뉴에서 **Networks** → **Tunnels** (또는 **Access** → **Tunnels**) 클릭  
2. **Cloudflare Tunnel** 목록이 나옴  
3. 맥미니에서 쓰는 tunnel 하나 선택 (이름으로 구분, 또는 "Connected" 상태인 것)

### 3-3. Public Hostname 확인 (여기가 안 보일 때 → 아래 3-3-B 참고)

**표시 이름이 제품마다 다릅니다.** 아래 중 하나로 나올 수 있습니다.

1. 해당 tunnel **이름**을 클릭해 **상세 화면**으로 들어갑니다.
2. **다음 중 하나**를 찾습니다.
   - **Public Hostnames** (탭 또는 섹션)
   - **Published application routes** (탭)
   - **라우팅(routing)** / **Routes** / **Ingress**
   - 상단 탭에 **Public hostnames** 가 없으면 **Configure** / **Edit** 안에도 있을 수 있습니다.
3. SSH용으로 등록한 항목이 있으면 그 **호스트명**을 복사합니다.  
   예: `ssh.내도메인.com` 또는 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.cfargotunnel.com`

---

### 3-3-B. Public Hostnames 섹션이 아무리 찾아도 안 보일 때

Cloudflare 대시보드가 바뀌어서 **Public Hostnames** 문구가 안 보일 수 있습니다. 아래 순서대로 확인해 보세요.

#### A) 대시보드가 두 종류라서 그럴 수 있음
- **Zero Trust (Cloudflare One)**: https://one.dash.cloudflare.com  
  - 왼쪽: **Networks** → **Tunnels** → tunnel 클릭  
  - 상세 화면에서 **탭**이 여러 개면: **Public hostnames** / **Published application routes** / **Configure** 를 차례로 눌러 봅니다.
- **일반 Cloudflare 대시보드**: https://dash.cloudflare.com  
  - 왼쪽: **Networking** → **Tunnels** (제품에 따라 **Zero Trust** 메뉴에서 들어가야 할 수도 있음)  
  - tunnel 클릭 후 **라우팅 맵** 또는 **Routes** / **Public hostnames** 같은 항목을 찾습니다.

#### B) Tunnel ID(UUID)만 있어도 됨 — 이걸로 SSH 주소 만들기
SSH용 “호스트명”을 따로 안 만들어도, **Tunnel ID**만 있으면 됩니다.

1. **Networks** → **Tunnels** 에서 사용 중인 tunnel을 클릭합니다.
2. 상세 화면 **맨 위** 또는 **Overview** 에서 **Tunnel ID** (UUID 형태, 예: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`) 를 찾습니다.  
   - **Connectors** / **설정** 화면에 "Tunnel UUID" 로 적혀 있는 경우도 있습니다.
3. SSH에서 쓸 주소는 아래 형식입니다.  
   **`<Tunnel-ID>.cfargotunnel.com`**  
   예: `a1b2c3d4-e5f6-7890-abcd-ef1234567890.cfargotunnel.com`
4. SSH config의 **HostName**에 이 주소를 넣습니다.  
   (단, 이 tunnel에 **SSH용 Published application route**를 한 번은 추가해 둔 상태여야 합니다. 아래 3-3-C 참고.)

#### C) SSH용 라우팅을 아직 안 만든 경우
"Public Hostnames" 목록에 SSH 항목이 없다면, **한 번 추가**해야 합니다.

1. **Networks** → **Tunnels** → 해당 tunnel → **Configure** 또는 **Edit** (또는 **Public hostnames** / **Published application routes** 탭).
2. **Add a public hostname** / **Add a published application route** 버튼을 누릅니다.
3. 다음처럼 입력합니다.
   - **Subdomain**: 원하는 이름 (예: `ssh`)
   - **Domain**: Cloudflare에 추가한 도메인 선택 (또는 **cfargotunnel.com** 선택 시 위 B의 `UUID.cfargotunnel.com` 자동 사용)
   - **Service type**: **SSH**
   - **URL / Address**: `localhost:22` (맥미니에서 SSH가 22번 포트면)
4. 저장 후, 여기서 보이는 **Public hostname** (예: `ssh.도메인.com` 또는 `UUID.cfargotunnel.com`) 을 SSH config **HostName**에 넣으면 됩니다.

### 3-4. Tunnel이 아직 없거나 SSH 라우팅이 없는 경우
- **자료 삭제** 후 tunnel이 사라졌다면, **맥미니에 직접 접속**할 수 있을 때 다음을 다시 해야 함:
  1. 맥미니에서 **cloudflared** 설치 및 로그인  
  2. Zero Trust에서 **새 Tunnel** 생성 후 **토큰** 복사  
  3. 맥미니에서 `cloudflared tunnel run <토큰>` 또는 config에 **Public Hostname** 추가  
     - **Service**: `ssh://localhost:22`  
     - **Public hostname**: 원하는 주소 (예: `ssh.도메인.com` 또는 Cloudflare가 주는 임시 주소)  
  4. 위에서 정한 **Public hostname**을 SSH config의 **HostName**에 넣으면 됨.

---

## 4. 정리 체크리스트

| 단계 | 할 일 |
|------|--------|
| 1 | 노트북에서 `C:\Users\esse1\.ssh\config` 열기 |
| 2 | `Host MyMacMini` 안의 **HostName**을 `172.30.1.18` → **Tunnel 공개 주소**로 변경 |
| 3 | Cloudflare **Networks → Tunnels** 에서 해당 tunnel의 **Public Hostname** 또는 **Tunnel ID** 확인 (찾기 어렵다면 가이드 3-3-B 참고) |
| 4 | config 저장 후 Cursor **Remote-SSH**로 `MyMacMini` 다시 연결 |

---

## 5. 여전히 안 될 때

- **Connection timed out**: Tunnel이 맥미니에서 실제로 떠 있는지, Zero Trust에서 "Connected" 인지 확인.  
- **Connection refused**: Tunnel의 Public Hostname 설정에서 **Service**가 `ssh://localhost:22`(또는 맥미니 SSH 포트)인지 확인.  
- **Permission denied**: **User** 가 맥미니 사용자 이름과 일치하는지 확인.

이 가이드는 **노트북(Cursor) SSH 설정**과 **Cloudflare Tunnel 공개 주소**만 바꿔서, 카페 등 다른 와이파이에서도 맥미니에 접속할 수 있게 하는 방법을 정리한 것입니다.
