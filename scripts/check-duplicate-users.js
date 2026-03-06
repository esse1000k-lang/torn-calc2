/**
 * MongoDB 중복 유저 확인 스크립트
 */

const path = require('path');
require('dotenv').config();

// 서버의 DB 모듈 임포트
const dbPath = path.join(__dirname, '..', 'lib', 'db.js');
const db = require(dbPath);

async function checkDuplicateUsers() {
  try {
    console.log('MongoDB 연결 중...');
    await db.connect();
    
    // 1. 모든 유저 조회
    console.log('전체 유저 데이터 조회 중...');
    const allUsers = await db.readUsers();
    console.log(`총 ${allUsers.length}명의 유저를 찾았습니다.`);
    
    if (allUsers.length === 0) {
      console.log('유저 데이터가 없습니다.');
      return;
    }
    
    // 2. 유저 목록 출력
    console.log('\n=== 현재 유저 목록 ===');
    allUsers.forEach((user, index) => {
      console.log(`${index + 1}. ${user.displayName} (${user.walletAddress || 'NO_WALLET'}) - ${user.approved ? '승인됨' : '미승인'} (${user.id || user._id})`);
      console.log(`   생성일: ${user.createdAt || 'N/A'}`);
    });
    
    // 3. 중복 그룹화 (displayName 기준)
    const displayNameGroups = {};
    const walletAddressGroups = {};
    const idGroups = {};
    
    allUsers.forEach(user => {
      // ID로 그룹화
      const id = user.id || user._id || '';
      if (id) {
        if (!idGroups[id]) {
          idGroups[id] = [];
        }
        idGroups[id].push(user);
      }
      
      // displayName으로 그룹화
      const displayName = user.displayName || '';
      if (displayName) {
        if (!displayNameGroups[displayName]) {
          displayNameGroups[displayName] = [];
        }
        displayNameGroups[displayName].push(user);
      }
      
      // walletAddress로 그룹화 (REGISTER_NO_WALLET 제외)
      const walletAddress = user.walletAddress || '';
      if (walletAddress && walletAddress !== 'REGISTER_NO_WALLET') {
        if (!walletAddressGroups[walletAddress]) {
          walletAddressGroups[walletAddress] = [];
        }
        walletAddressGroups[walletAddress].push(user);
      }
    });
    
    // 4. 중복된 그룹 찾기
    const duplicateIds = Object.keys(idGroups).filter(id => 
      idGroups[id].length > 1
    );
    
    const duplicateDisplayNames = Object.keys(displayNameGroups).filter(name => 
      displayNameGroups[name].length > 1
    );
    
    const duplicateWalletAddresses = Object.keys(walletAddressGroups).filter(addr => 
      walletAddressGroups[addr].length > 1
    );
    
    // 5. 결과 출력
    console.log(`\n=== 중복 확인 결과 ===`);
    console.log(`ID 중복: ${duplicateIds.length}개`);
    console.log(`DisplayName 중복: ${duplicateDisplayNames.length}개`);
    console.log(`WalletAddress 중복: ${duplicateWalletAddresses.length}개`);
    
    if (duplicateIds.length === 0 && duplicateDisplayNames.length === 0 && duplicateWalletAddresses.length === 0) {
      console.log('\n✅ 중복된 유저가 없습니다!');
    } else {
      // 중복된 항목 상세 출력
      if (duplicateIds.length > 0) {
        console.log('\n❌ ID 중복:');
        duplicateIds.forEach(id => {
          console.log(`  ID "${id}": ${idGroups[id].length}개`);
          idGroups[id].forEach((user, idx) => {
            console.log(`    ${idx + 1}. ${user.displayName} (${user.id || user._id})`);
          });
        });
      }
      
      if (duplicateDisplayNames.length > 0) {
        console.log('\n❌ DisplayName 중복:');
        duplicateDisplayNames.forEach(name => {
          console.log(`  "${name}": ${displayNameGroups[name].length}개`);
          displayNameGroups[name].forEach((user, idx) => {
            console.log(`    ${idx + 1}. ${user.displayName} (${user.id || user._id})`);
          });
        });
      }
      
      if (duplicateWalletAddresses.length > 0) {
        console.log('\n❌ WalletAddress 중복:');
        duplicateWalletAddresses.forEach(addr => {
          console.log(`  "${addr}": ${walletAddressGroups[addr].length}개`);
          walletAddressGroups[addr].forEach((user, idx) => {
            console.log(`    ${idx + 1}. ${user.displayName} (${user.id || user._id})`);
          });
        });
      }
    }
    
  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    console.log('\n확인 완료!');
  }
}

// 스크립트 실행
if (require.main === module) {
  console.log('MongoDB 중복 유저 확인 시작...\n');
  checkDuplicateUsers()
    .then(() => {
      console.log('\n확인 완료!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('확인 실패:', error);
      process.exit(1);
    });
}

module.exports = { checkDuplicateUsers };
