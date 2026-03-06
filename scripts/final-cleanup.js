/**
 * 최종 MongoDB 정리 스크립트 - 딱 2명만 남기기
 */

const path = require('path');
require('dotenv').config();

// 서버의 DB 모듈 임포트
const dbPath = path.join(__dirname, '..', 'lib', 'db.js');
const db = require(dbPath);

async function finalCleanup() {
  try {
    console.log('MongoDB 연결 중...');
    await db.connect();
    
    // MongoDB 직접 접속
    const { MongoClient } = require('mongodb');
    const uri = process.env.MONGODB_URI;
    
    if (!uri) {
      console.error('MONGODB_URI가 설정되지 않았습니다.');
      return;
    }
    
    console.log('MongoDB에 직접 연결 중...');
    const client = new MongoClient(uri);
    await client.connect();
    
    const database = client.db();
    const usersCollection = database.collection('users');
    
    // 모든 유저 삭제
    console.log('모든 유저 데이터 삭제 중...');
    await usersCollection.deleteMany({});
    console.log('✓ 모든 유저 데이터 삭제 완료');
    
    // 새로운 유저 2명 생성
    const now = new Date().toISOString();
    const finalUsers = [
      {
        displayName: 'admin109',
        walletAddress: '0x0000000000000000000000000000000000000008',
        approved: true,
        approvedAt: now,
        approvedBy: 'auto',
        createdAt: now,
        lastLoginAt: now,
        points: 3,
        rhythmHash: 'final_rhythm_hash_1'
      },
      {
        displayName: 'kjc1090',
        walletAddress: '0x0000000000000000000000000000000000000000',
        approved: true,
        approvedAt: now,
        approvedBy: 'auto',
        createdAt: now,
        lastLoginAt: now,
        points: 3,
        rhythmHash: 'final_rhythm_hash_2'
      }
    ];
    
    // 새 유저 삽입
    await usersCollection.insertMany(finalUsers);
    console.log(`✅ ${finalUsers.length}명의 최종 유저 생성 완료`);
    
    // 결과 확인
    const resultUsers = await usersCollection.find({}).toArray();
    console.log('\n=== 최종 결과 ===');
    console.log(`최종 유저 수: ${resultUsers.length}`);
    
    console.log('\n최종 유저 목록:');
    resultUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.displayName} (${user.walletAddress}) - ${user.approved ? '승인됨' : '미승인'} (${user._id})`);
    });
    
    await client.close();
    
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    console.log('\n최종 정리 완료!');
  }
}

// 스크립트 실행
if (require.main === module) {
  console.log('최종 MongoDB 정리 시작...\n');
  finalCleanup()
    .then(() => {
      console.log('\n최종 정리 완료!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('최종 정리 실패:', error);
      process.exit(1);
    });
}

module.exports = { finalCleanup };
