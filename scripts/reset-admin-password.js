/**
 * admin109 비밀번호를 111111로 초기화 (로그인 안 될 때 사용)
 * 사용법: node scripts/reset-admin-password.js
 */

const bcrypt = require('bcryptjs');
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

const ADMIN_DISPLAY_NAME = 'admin109';
const NEW_PASSWORD = '111111';

async function main() {
  console.log('DB 연결 중...');
  await db.connect?.();
  const users = await db.readUsers();
  const admin = users.find((u) => u.displayName && u.displayName.toLowerCase() === ADMIN_DISPLAY_NAME.toLowerCase());
  if (!admin) {
    console.log('admin109 계정이 DB에 없습니다. 먼저 node scripts/create-admin-account.js 를 실행하세요.');
    process.exit(1);
  }
  admin.passwordHash = bcrypt.hashSync(NEW_PASSWORD, 10);
  admin.approved = true;
  admin.boardAdmin = true;
  await db.writeUsers(users);
  console.log('admin109 비밀번호를 111111 로 초기화했습니다. 웹에서 다시 로그인해 보세요.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
