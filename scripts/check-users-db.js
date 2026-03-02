/**
 * 회원 DB 일관성 검사 (중복 닉네임, 필수 필드, approved/boardAdmin 타입)
 * 사용법:
 *   node scripts/check-users-db.js        # 검사만
 *   node scripts/check-users-db.js --fix  # 문제 있으면 정규화 후 저장 (approved, boardAdmin 불리언으로)
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
  const fix = process.argv.includes('--fix');
  console.log('DB 연결 중...');
  await db.connect?.();
  const users = await db.readUsers();
  console.log('총 회원 수:', users.length);

  const issues = [];
  const byNameLower = new Map();

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const id = u && u.id;
    const name = (u && u.displayName) ? String(u.displayName).trim() : '';

    if (!id || typeof id !== 'string') {
      issues.push({ index: i, id: id, problem: 'id 없음 또는 비문자열' });
    }
    if (!name) {
      issues.push({ index: i, id: id, problem: 'displayName 없음' });
    }

    const nameLower = name.toLowerCase();
    if (nameLower) {
      if (byNameLower.has(nameLower)) {
        issues.push({
          index: i,
          id,
          problem: '닉네임 중복 (대소문자 구분 없음)',
          otherId: byNameLower.get(nameLower),
        });
      } else {
        byNameLower.set(nameLower, id);
      }
    }

    if (u && typeof u.approved !== 'boolean' && u.approved !== undefined) {
      issues.push({ index: i, id, problem: 'approved가 불리언 아님', value: u.approved });
      if (fix) u.approved = u.approved === true || u.approved === 'true';
    }
    if (u && typeof u.boardAdmin !== 'boolean' && u.boardAdmin !== undefined) {
      issues.push({ index: i, id, problem: 'boardAdmin이 불리언 아님', value: u.boardAdmin });
      if (fix) u.boardAdmin = u.boardAdmin === true || u.boardAdmin === 'true';
    }
    if (u && typeof u.levelAdmin !== 'boolean' && u.levelAdmin !== undefined) {
      issues.push({ index: i, id, problem: 'levelAdmin이 불리언 아님', value: u.levelAdmin });
      if (fix) u.levelAdmin = u.levelAdmin === true || u.levelAdmin === 'true';
    }
  }

  if (issues.length === 0) {
    console.log('이상 없음.');
    process.exit(0);
    return;
  }

  console.log('\n발견된 문제:', issues.length, '건');
  issues.forEach((x) => console.log('  -', x.problem, x.id ? `(id=${x.id})` : '', x.otherId ? `다른 id=${x.otherId}` : '', x.value !== undefined ? `값=${x.value}` : ''));

  if (fix) {
    console.log('\n--fix: 정규화 후 저장합니다.');
    await db.writeUsers(users);
    console.log('저장 완료.');
  } else {
    console.log('\n정규화하려면: node scripts/check-users-db.js --fix');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
