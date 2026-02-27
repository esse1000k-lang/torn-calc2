/**
 * DB 파일 + 세션 + (안내) 브라우저 로컬 전부 초기화
 * 사용법: node scripts/reset-all.js
 *
 * - MONGODB_URI 있음: db.connect() 후 db.writeUsers([]) 로 MongoDB 회원 전부 삭제
 * - MONGODB_URI 없음: data/users.json → { users: [] }, data/sessions.json 비움
 * - 서버 재시작 + 브라우저 Clear site data 권장
 */

const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWrite(filePath, content) {
  ensureDataDir();
  const tmp = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.tmp');
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

async function main() {
  const useMongo = !!process.env.MONGODB_URI?.trim();

  if (useMongo) {
    const db = require(path.join(__dirname, '..', 'lib', 'db'));
    await db.connect();
    await db.clearUsers();
    console.log('MongoDB 회원 초기화 완료 (users: [])');
  } else {
    ensureDataDir();
    atomicWrite(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
    console.log('data/users.json 초기화 완료 (users: [])');
  }

  ensureDataDir();
  if (fs.existsSync(SESSIONS_FILE)) {
    atomicWrite(SESSIONS_FILE, JSON.stringify({ sessions: {} }, null, 2));
    console.log('data/sessions.json 초기화 완료 (sessions: {})');
  } else {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: {} }, null, 2));
    console.log('data/sessions.json 생성 (빈 세션)');
  }

  console.log('\n--- 다음 단계 ---');
  console.log('1. 서버를 완전히 종료한 뒤 다시 시작하세요.');
  console.log('2. 브라우저: F12 > Application > Storage > Clear site data');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
