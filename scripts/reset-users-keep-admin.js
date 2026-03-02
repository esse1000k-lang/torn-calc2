/**
 * 어드민 계정만 남기고 회원 전부 초기화 (DB 섞였을 때 빠르게 정리용)
 * 사용법: node scripts/reset-users-keep-admin.js
 *
 * - 현재 DB(파일 또는 MongoDB)에서 boardAdmin === true 인 계정만 남깁니다.
 * - 관리자가 한 명도 없으면 data/users.json 에서 admin109 를 읽어와서 한 명 넣어 둡니다.
 */

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

const db = require(path.join(__dirname, '..', 'lib', 'db'));

async function main() {
  console.log('DB 연결 중...');
  await db.connect();

  const users = await db.readUsers();
  const admins = users.filter((u) => u.boardAdmin === true);

  let toWrite = admins;
  if (toWrite.length === 0) {
    const usersPath = path.join(__dirname, '..', 'data', 'users.json');
    if (fs.existsSync(usersPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
        const fileUsers = Array.isArray(data.users) ? data.users : [];
        const fileAdmin = fileUsers.find(
          (u) =>
            (u.displayName && u.displayName.toLowerCase() === 'admin109') ||
            u.boardAdmin === true
        );
        if (fileAdmin) {
          toWrite = [fileAdmin];
          console.log('DB에 관리자 없음 → data/users.json 에서 admin 1명 복원');
        }
      } catch (_) {}
    }
    if (toWrite.length === 0) {
      console.warn('경고: 관리자 계정이 없습니다. 회원만 비웁니다. 로그인하려면 create-admin-account.js 를 실행하세요.');
    }
  }

  await db.writeUsers(toWrite);
  console.log('완료: 회원 ' + toWrite.length + '명만 남겼습니다. (어드민만 유지)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
