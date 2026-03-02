/**
 * .env 의 MONGODB_URI 해시와 Render 해시 비교
 * 사용법: node scripts/check-uri-hash.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
  console.log('.env 없음');
  process.exit(1);
}
const content = fs.readFileSync(envPath, 'utf8');
let uri = '';
for (const line of content.split(/\r?\n/)) {
  const m = line.match(/^\s*MONGODB_URI\s*=\s*(.*)$/);
  if (m) {
    uri = m[1].replace(/^["']|["']$/g, '').trim();
    break;
  }
}
const hash = uri ? crypto.createHash('sha256').update(uri).digest('hex').slice(0, 16) : '(없음)';
const RENDER_HASH = 'ec73f44928f5b37b';
console.log('현재 .env URI 해시:', hash);
console.log('Render 해시:       ', RENDER_HASH);
console.log('일치:', hash === RENDER_HASH ? '예' : '아니오');
