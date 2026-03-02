/**
 * DB에 저장된 회원 수 확인
 * 사용법: node scripts/count-users.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
  const uri = (process.env.MONGODB_URI || '').trim();
  const uriHash = uri ? crypto.createHash('sha256').update(uri).digest('hex').slice(0, 16) : '(없음)';
  const pathPart = uri.split('?')[0].trim();
  const lastSlash = pathPart.lastIndexOf('/');
  const afterSlash = pathPart.slice(lastSlash + 1).trim();
  const dbName =
    afterSlash && !afterSlash.includes('.') ? afterSlash : '(URI에 DB 이름 없음)';
  console.log('연결 DB 이름:', dbName);
  console.log('URI 해시(앞 16자):', uriHash, '<-- Render /api/debug/check-admin 의 uriHash 와 같아야 같은 DB');
  console.log('DB 연결 중...');
  await db.connect?.();
  const users = await db.readUsers();
  console.log('저장된 회원 수:', users.length);
  if (users.length > 0) {
    console.log('닉네임 목록:', users.map((u) => u.displayName || '(없음)').join(', '));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
