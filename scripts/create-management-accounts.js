/**
 * 지정된 관리용 계정 5개 중 users.json에 없는 닉네임을 임의 회원으로 추가합니다.
 * 사용법: node scripts/create-management-accounts.js
 * (실행 후 node scripts/ensure-management-accounts.js 로 managementAccount: true 설정)
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const MANAGEMENT_DISPLAY_NAMES = ['발행/소각', '교환(TORN)', '교환(TFi)', '장외거래(OTC)', 'Admin2'];
const MANAGEMENT_ACCOUNT_MAX = 5;

// 관리용 계정용 placeholder 지갑 (기존 0001, 0002 와 겹치지 않도록 0003~0005 사용, 부족하면 0006~)
const PLACEHOLDER_WALLETS = [
  '0x0000000000000000000000000000000000000003',
  '0x0000000000000000000000000000000000000004',
  '0x0000000000000000000000000000000000000005',
  '0x0000000000000000000000000000000000000006',
  '0x0000000000000000000000000000000000000007',
];

const DEFAULT_PASSWORD = 'manage123';
const DEFAULT_PIN = '000000';

function main() {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const users = data.users || [];
  const managementCount = users.filter((u) => u.managementAccount === true).length;
  if (managementCount >= MANAGEMENT_ACCOUNT_MAX) {
    console.log('관리용 계정은 최대', MANAGEMENT_ACCOUNT_MAX, '개까지만 허용됩니다. 추가할 수 없습니다.');
    return;
  }
  const existingNames = new Set(users.map((u) => u.displayName));
  const existingWallets = new Set(users.map((u) => (u.walletAddress || '').toLowerCase()));

  let walletIndex = 0;
  let added = 0;
  const namesToCreate = MANAGEMENT_DISPLAY_NAMES.slice(0, MANAGEMENT_ACCOUNT_MAX);

  namesToCreate.forEach((displayName) => {
    if (existingNames.has(displayName)) return;
    if (managementCount + added >= MANAGEMENT_ACCOUNT_MAX) return;

    let wallet = PLACEHOLDER_WALLETS[walletIndex];
    while (existingWallets.has(wallet.toLowerCase())) {
      walletIndex++;
      wallet = PLACEHOLDER_WALLETS[walletIndex];
      if (!wallet) {
        console.error('추가 placeholder 지갑이 없습니다.');
        process.exit(1);
      }
    }
    walletIndex++;
    existingWallets.add(wallet.toLowerCase());
    existingNames.add(displayName);

    const user = {
      id: crypto.randomBytes(12).toString('hex'),
      passwordHash: bcrypt.hashSync(DEFAULT_PASSWORD, 10),
      pinHash: bcrypt.hashSync(DEFAULT_PIN, 10),
      displayName,
      walletAddress: wallet,
      referrer: null,
      approved: true,
      points: 0,
      level: 1,
      createdAt: new Date().toISOString(),
      managementAccount: true,
    };
    users.push(user);
    added++;
    console.log('추가:', displayName, wallet);
  });

  if (added === 0) {
    console.log('추가할 관리용 계정이 없습니다. (이미 5개 모두 존재)');
    return;
  }

  data.users = users;
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  console.log('관리용 계정', added, '명 추가했습니다. 비밀번호:', DEFAULT_PASSWORD, ', 2차 비밀번호:', DEFAULT_PIN);
}

main();
