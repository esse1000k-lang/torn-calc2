/**
 * 출석체크·하트 기록이 DB(파일 또는 MongoDB)에 잘 저장되는지 확인하는 스크립트
 * 사용: node scripts/check-attendance-hearts-db.js
 */
require('dotenv').config();
const path = require('path');
const db = require('../lib/db');

async function main() {
  await db.connect();

  console.log('===== 1. 회원별 출석·하트(포인트) 저장 여부 =====');
  const users = await db.readUsers();
  let hasAttendance = false;
  let hasPoints = false;
  for (const u of users) {
    const name = (u.displayName || u.id || '-').slice(0, 20);
    const lastAtt = u.lastAttendanceDate || '-';
    const streak = typeof u.attendanceStreak === 'number' ? u.attendanceStreak : 0;
    const pts = typeof u.points === 'number' ? u.points : 0;
    const historyLen = Array.isArray(u.attendanceHistory) ? u.attendanceHistory.length : 0;
    if (lastAtt !== '-' || historyLen > 0) hasAttendance = true;
    if (pts !== 0) hasPoints = true;
    console.log(`  ${name}: lastAttendance=${lastAtt}, streak=${streak}, history개수=${historyLen}, points(하트)=${pts}`);
  }
  if (!hasAttendance) console.log('  (출석 기록이 있는 회원이 없습니다. 출석체크 후 다시 실행해 보세요.)');
  if (!hasPoints) console.log('  (하트(포인트)가 0이 아닌 회원이 없습니다.)');

  console.log('\n===== 2. 피드 글/댓글 받은 하트(heartsReceived) =====');
  const { posts } = await db.getFeedPosts(50, 0);
  let feedHearts = 0;
  for (const p of posts) {
    const pr = (p.heartsReceived || 0);
    if (pr > 0) {
      console.log(`  글 id=${p.id?.slice(0, 8)}... heartsReceived=${pr}`);
      feedHearts += pr;
    }
    for (const c of p.comments || []) {
      const cr = (c.heartsReceived || 0);
      if (cr > 0) {
        console.log(`    댓글 id=${c.id?.slice(0, 8)}... heartsReceived=${cr}`);
        feedHearts += cr;
      }
    }
  }
  if (feedHearts === 0) console.log('  (피드에서 받은 하트 기록이 없습니다.)');

  console.log('\n===== 3. 채팅 메시지 받은 하트(heartsReceived) =====');
  const messages = await db.readChatMessages();
  let chatHearts = 0;
  for (const m of messages) {
    const hr = (m.heartsReceived || 0);
    if (hr > 0) {
      console.log(`  메시지 id=${m.id?.slice(0, 8)}... heartsReceived=${hr}`);
      chatHearts += hr;
    }
  }
  if (chatHearts === 0) console.log('  (채팅에서 받은 하트 기록이 없습니다.)');

  console.log('\n===== 요약 =====');
  console.log('  회원 수:', users.length);
  console.log('  출석/하트(포인트)는 data/users.json 또는 MongoDB users 컬렉션에 저장됩니다.');
  console.log('  피드 하트는 data/feed.json 또는 MongoDB feed 컬렉션에 저장됩니다.');
  console.log('  채팅 하트는 data/chat.json 또는 MongoDB chatMessages 컬렉션에 저장됩니다.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
