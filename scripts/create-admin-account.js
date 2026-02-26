/**
 * 관리자 전용 계정 1개 생성 (로그인용, 웹 회원가입 없이 DB에만 추가)
 * 사용법: node scripts/create-admin-account.js
 *
 * 계정: admin109 / 111111
 * - boardAdmin: true 로 관리자 권한 부여
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// .env 파일 로드 (터미널에서 실행할 때 MONGODB_URI를 쓰려면 필요)
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
const ADMIN_PASSWORD = '111111';
const PLACEHOLDER_WALLET = '0x0000000000000000000000000000000000000008';

async function main() {
  console.log('DB 연결 중...');
  await db.connect?.();
  const users = await db.readUsers();
  const existing = users.find((u) => u.displayName && u.displayName.toLowerCase() === ADMIN_DISPLAY_NAME.toLowerCase());
  if (existing) {
    console.log('이미 존재하는 계정입니다:', ADMIN_DISPLAY_NAME);
    existing.boardAdmin = true;
    await db.writeUsers(users);
    console.log('boardAdmin 권한을 true로 설정했습니다.');
    return;
  }

  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
    displayName: ADMIN_DISPLAY_NAME,
    walletAddress: PLACEHOLDER_WALLET,
    referrer: null,
    approved: true,
    approvedAt: new Date().toISOString(),
    approvedBy: 'script',
    points: 0,
    level: 1,
    boardAdmin: true,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  await db.writeUsers(users);
  console.log('관리자 계정이 생성되었습니다.');
  console.log('  아이디(닉네임):', ADMIN_DISPLAY_NAME);
  console.log('  비밀번호:', ADMIN_PASSWORD);
  console.log('  로그인 후 관리자 메뉴(🛠️)에서 이용하세요.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
