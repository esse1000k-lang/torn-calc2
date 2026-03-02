/**
 * 관리용 계정 5개(발행/소각, 교환(TORN), 교환(TFi), 장외거래(OTC), Admin2)에
 * managementAccount: true 를 넣어 분류되게 합니다.
 * 사용법: node scripts/ensure-management-accounts.js
 */

const path = require('path');
const fs = require('fs');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');
const MANAGEMENT_DISPLAY_NAMES = ['발행/소각', '교환(TORN)', '교환(TFi)', '장외거래(OTC)', 'Admin2'];
const MANAGEMENT_ACCOUNT_MAX = 5;

function main() {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const users = data.users || [];
  let managementCount = users.filter(function (u) { return u.managementAccount === true; }).length;
  let changed = false;
  users.forEach(function (u) {
    if (managementCount >= MANAGEMENT_ACCOUNT_MAX) return;
    if (!MANAGEMENT_DISPLAY_NAMES.slice(0, MANAGEMENT_ACCOUNT_MAX).includes(u.displayName)) return;
    if (u.managementAccount === true) return;
    u.managementAccount = true;
    changed = true;
    managementCount += 1;
  });
  if (changed) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    console.log('관리용 계정(managementAccount: true)으로 설정했습니다.');
  } else {
    console.log('이미 설정되어 있거나 해당 계정이 없습니다.');
  }
}

main();
