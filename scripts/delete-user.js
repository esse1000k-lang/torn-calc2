/**
 * DB에만 있고 UI에서 안 보이는 회원(또는 지정 닉네임) 삭제
 * 사용법: node scripts/delete-user.js 닉네임1 [닉네임2 ...]
 * 예: node scripts/delete-user.js testuser
 *     node scripts/delete-user.js user1 user2 user3
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
  const toDelete = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  if (toDelete.length === 0) {
    console.log('사용법: node scripts/delete-user.js 닉네임1 [닉네임2 ...]');
    process.exit(1);
  }

  console.log('DB 연결 중...');
  await db.connect?.();
  const users = await db.readUsers();
  const lowerSet = new Set(toDelete.map((n) => n.toLowerCase()));
  const before = users.length;
  const kept = users.filter((u) => {
    const name = (u.displayName || '').trim();
    if (!name) return true;
    return !lowerSet.has(name.toLowerCase());
  });
  const removed = before - kept.length;
  if (removed === 0) {
    console.log('해당 닉네임의 회원이 없습니다:', toDelete.join(', '));
    process.exit(0);
  }
  await db.writeUsers(kept);
  console.log('삭제 완료:', removed, '명', toDelete.slice(0, removed));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
