/**
 * TornFi 커뮤니티 서버 — 투자자 의견 공유 커뮤니티 (포인트·송금·환전 없음)
 */

// 1. 환경 변수 로드
require('dotenv').config();

// 2. MongoStore(connect-mongo) + MongoDB 드라이버 — 세션은 반드시 MongoDB Atlas에 저장
const MongoStore = require('connect-mongo').default || require('connect-mongo').MongoStore;
const { MongoClient } = require('mongodb');

// 3. 세션 + Passport
const session = require('express-session');
const passport = require('passport');

// mongodb+srv는 DNS SRV 조회 필요. PC/공유기 DNS가 SRV를 막으면 ECONNREFUSED → 앱 시작 직후 Google DNS 사용
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');

// 로컬/배포 같은 DB 쓰는지 확인용 — 서버 시작 시 한 번만 출력 (URI 값은 노출 안 함)
(function logDbMode() {
  const path = require('path');
  const fs = require('fs');
  const envPath = path.join(process.cwd(), '.env');
  const uri = (process.env.MONGODB_URI || '').trim();
  const useMongo = !!uri;
  const uriHash = useMongo ? require('crypto').createHash('sha256').update(uri).digest('hex').slice(0, 16) : null;
})();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const cookieSignature = require('cookie-signature');
const crypto = require('crypto');
const multer = require('multer');
const cheerio = require('cheerio');
const { getAddress, JsonRpcProvider, Contract, formatUnits } = require('ethers');

const db = require('./lib/db');
const app = express();

// Render 등 프록시 뒤에서 동작 시 필수 — X-Forwarded-* 헤더 신뢰
app.set('trust proxy', 1);
app.set('etag', false);

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'tornfi-community-secret-change-in-production';

if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET || String(process.env.SESSION_SECRET).length < 32) {
    console.error('Production requires SESSION_SECRET (min 32 chars). Set env and restart.');
    process.exit(1);
  }
}
const TORNADO_NEWS_FILE = path.join(__dirname, 'data', 'tornado-news.json');
const TORNADO_NEWS_SOURCES_FILE = path.join(__dirname, 'data', 'tornado-news-sources.json');
const TORNADO_NEWS_KEYWORDS_FILE = path.join(__dirname, 'data', 'tornado-news-keywords.json');
const CHAT_MAX_MESSAGES = 200;
const CHAT_ITEM_COOLDOWN_MS = 10 * 1000; // 채팅 아이템 사용 후 10초 쿨
const chatItemCooldownUntil = new Map(); // userId -> timestamp (ms)

// 채팅 아이템 공통 쿨 (10초). 새 아이템 API 추가 시: 인증 직후 checkChatItemCooldown(req, res) 호출, 성공 시 setChatItemCooldown(req.user.id) 호출.
// 채팅 아이템 쿨 검사 — 쿨 중이면 429 응답 후 true 반환, 아니면 false
function checkChatItemCooldown(req, res) {
  if (!req.user) return false;
  const until = chatItemCooldownUntil.get(req.user.id);
  if (until && Date.now() < until) {
    res.status(429).json({ ok: false, message: '채팅 아이템은 10초 후에 다시 사용할 수 있습니다.', cooldownRemainingMs: until - Date.now() });
    return true;
  }
  return false;
}

// 채팅 아이템 사용 후 쿨 설정 — 새 아이템 API에서 성공 시 호출
function setChatItemCooldown(userId) {
  chatItemCooldownUntil.set(userId, Date.now() + CHAT_ITEM_COOLDOWN_MS);
}
const DEFAULT_TORN_DEPOSIT_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
// 입금 목록·자동 매칭에서 제외할 보낸 주소 (이 주소에서 온 TORN 입금은 반영하지 않음)
const TORN_DEPOSIT_EXCLUDED_FROM = '0x5b3f656c80e8ddb9ec01dd9018815576e9238c29';
const ADMIN_PIN_REGEX = /^[0-9]{6}$/;
const DEFAULT_ADMIN_WALLET = '0xe067677bbf260e460f93a0866b1065d0249a4fa1';
const ADMIN_WALLET_ADDRESSES = [
  DEFAULT_ADMIN_WALLET,
  ...(process.env.ADMIN_WALLET_ADDRESSES || '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean),
];
// 이더리움 RPC: 환경변수 있으면 하나만, 없으면 계산기와 동일한 RPC 우선 후 순서대로 시도
const ETH_RPC_URLS = process.env.ETH_RPC_URL
  ? [process.env.ETH_RPC_URL]
  : [
      'https://mainnet.infura.io/v3/fa141c0488f14212b912c04114f23f84', // 계산기와 동일
      'https://eth.llamarpc.com',
      'https://ethereum.publicnode.com',
      'https://cloudflare-eth.com',
      'https://rpc.ankr.com/eth',
      'https://1rpc.io/eth',
    ];
// 계산기 "내 지갑 주소"와 동일: Governance Staking / Reward / TORN 토큰
const TORN_GOV_STAKING_ADDRESS = '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce';
// 락 시 TORN이 전송될 수 있는 주소들 (프록시 + 볼트 + 구현체). 스테이킹 횟수/최초 시점 판단용
const TORN_STAKING_RECIPIENT_ADDRESSES = [
  '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce', // Governance Proxy
  '0x2f50508a8a3d323b91336fa3ea6ae50e55f32185', // Governance Vault
  '0xbf46f2222c0712caf2f13b8590732dbd964ce395', // Governance Implementation
].map((a) => a.toLowerCase());
const TORN_GOV_STAKING_ABI = [
  'function lockedBalance(address account) view returns (uint256)',
];
const TORN_TOKEN_ADDRESS = '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C';
const TORN_DECIMALS = 18;
// 담보/총 발행량 기준 지갑 = TORN 입금 주소(교환용)와 동일 — settings.tornDepositAddress 사용

// 게시글 이미지 업로드: 서버 로컬 저장, 2MB·5장 제한
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const CHAT_UPLOADS_DIR = path.join(__dirname, 'public', 'uploads', 'chat');
const IMAGE_MAX_SIZE = 2 * 1024 * 1024; // 2MB (게시글·채팅 이미지)
const PROFILE_AVATAR_MAX_SIZE = 1 * 1024 * 1024; // 1MB (프로필 사진)
const PROFILE_AVATAR_MAX_DIM = 400; // 프로필 사진 권장 최대 변 400px, 정사각형
const IMAGE_MAX_COUNT = 5;
const ALLOWED_MIMES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };

// 업로드 파일이 실제 이미지인지 매직 바이트로 검사 (MIME 스푸핑 방지)
const IMAGE_MAGIC = {
  '.jpg': [0xff, 0xd8, 0xff],
  '.png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  '.gif': [0x47, 0x49, 0x46, 0x38], // 37 61 or 39 61
  '.webp': [0x52, 0x49, 0x46, 0x46], // then 4 byte size, then 57 45 42 50
};
function validateImageMagic(filePath, expectedExt) {
  try {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(filePath, 'r');
    const n = fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    if (n < 4) return false;
    const magic = IMAGE_MAGIC[expectedExt];
    if (!magic) return false;
    if (expectedExt === '.gif') return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38 && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61;
    if (expectedExt === '.webp') return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    for (let i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function ensureChatUploadsDir() {
  if (!fs.existsSync(CHAT_UPLOADS_DIR)) fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });
}

const storagePostImages = multer.diskStorage({
  destination: function (_req, _file, cb) {
    ensureUploadsDir();
    cb(null, UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    const ext = ALLOWED_MIMES[file.mimetype] || '.jpg';
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  },
});

const storageChatImage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    ensureChatUploadsDir();
    cb(null, CHAT_UPLOADS_DIR);
  },
  filename: function (_req, file, cb) {
    const ext = ALLOWED_MIMES[file.mimetype] || '.jpg';
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  },
});

const fileFilterImages = function (_req, file, cb) {
  if (ALLOWED_MIMES[file.mimetype]) cb(null, true);
  else cb(new Error('허용 형식: JPG, PNG, GIF, WEBP'), false);
};

const uploadPostImages = multer({
  storage: storagePostImages,
  limits: { fileSize: IMAGE_MAX_SIZE, files: IMAGE_MAX_COUNT },
  fileFilter: fileFilterImages,
}).array('images', IMAGE_MAX_COUNT);

const uploadChatImage = multer({
  storage: storageChatImage,
  limits: { fileSize: IMAGE_MAX_SIZE },
  fileFilter: fileFilterImages,
}).single('image');

// 프로필 사진 업로드
const PROFILE_UPLOADS_DIR = path.join(__dirname, 'public', 'uploads', 'profile');
function ensureProfileUploadsDir() {
  if (!fs.existsSync(PROFILE_UPLOADS_DIR)) fs.mkdirSync(PROFILE_UPLOADS_DIR, { recursive: true });
}
const storageProfileAvatar = multer.diskStorage({
  destination: function (_req, _file, cb) {
    ensureProfileUploadsDir();
    cb(null, PROFILE_UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = ALLOWED_MIMES[file.mimetype] || '.jpg';
    const name = (req.user && req.user.id ? req.user.id + '-' : '') + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, name);
  },
});
const uploadProfileAvatar = multer({
  storage: storageProfileAvatar,
  limits: { fileSize: PROFILE_AVATAR_MAX_SIZE },
  fileFilter: fileFilterImages,
}).single('avatar');

// 세션: connect-mongo로 MongoDB Atlas에만 저장 (로컬 메모리/파일 사용 금지)
const SESSION_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24시간 (1000 * 60 * 60 * 24)
const isProduction = process.env.NODE_ENV === 'production';
const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const sessionStore = MongoStore.create({
  mongoUrl: MONGODB_URI || undefined,
  ttl: 24 * 60 * 60, // 24시간(초) — 쿠키 maxAge와 맞춤
});
// touch 실패 시 세션 파괴 방지: "Unable to find the session to touch" 시 무시 (EventEmitter 유지 위해 touch만 오버라이드)
const originalTouch = sessionStore.touch.bind(sessionStore);
sessionStore.touch = function touch(sid, session, cb) {
  const callback = typeof cb === 'function' ? cb : () => {};
  originalTouch(sid, session, (err) => {
    if (err && err.message === 'Unable to find the session to touch') {
      if (process.env.NODE_ENV === 'production') console.warn('[session] touch skipped (session not in store), not destroying:', sid?.slice?.(0, 8) + '...');
      return callback();
    }
    callback(err);
  });
};
if (isProduction && !MONGODB_URI) {
  console.warn('[session] Production without MONGODB_URI: sessions will not persist. Set MONGODB_URI for MongoDB Atlas.');
}
app.use(
  session({
    name: 'connect.sid',
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    proxy: isProduction, // 배포 시 프록시 뒤에서 X-Forwarded-Proto 신뢰
    cookie: {
      secure: isProduction, // 배포(HTTPS)일 때 true, 로컬일 때 false
      sameSite: 'lax',
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
    },
  })
);

// Passport: 세션에는 반드시 문자열 ID만 저장 (객체/ObjectId 저장 시 deserializeUser에서 매칭 실패)
passport.serializeUser((user, done) => {
  const raw = user.id != null ? user.id : (user._id != null ? user._id : null);
  const toStore = raw != null ? String(raw) : null;
  done(null, toStore);
});
// ID로 유저 조회: 세션 ID(문자열)와 DB id/_id 문자열 비교로 통일
passport.deserializeUser((id, done) => {
  const idStr = id != null ? String(id) : '';
  db.readUsers()
    .then((users) => {
      let u = users.find((x) => String(x.id ?? x._id ?? '') === idStr);
      if (!u) u = users.find((x) => x.walletAddress && String(x.walletAddress).toLowerCase() === idStr.toLowerCase());
      if (!u) u = users.find((x) => x.displayName && String(x.displayName).toLowerCase() === idStr.toLowerCase());
      if (!u) {
        return done(null, null);
      }
      const isAdminByWallet = u.walletAddress && ADMIN_WALLET_ADDRESSES.includes(u.walletAddress.toLowerCase());
      const isAdmin = isAdminByWallet || u.boardAdmin === true;
      const resolvedId = (u.id != null ? String(u.id) : (u._id != null ? String(u._id) : null)) || idStr;
      done(null, { id: resolvedId, displayName: u.displayName, walletAddress: u.walletAddress || null, isAdmin: !!isAdmin });
    })
    .catch((err) => {
      console.error('[Deserialize] ERROR', err?.message || err, err?.stack);
      done(err);
    });
});

// 미들웨어 순서: session → passport.initialize → passport.session 반드시 모든 /api 라우터보다 위
app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());
// express-session이 자체적으로 쿠키 서명을 처리하므로, cookieParser와 이중 처리 시 서명 검증 실패(서명OK: 없음) 방지를 위해 비활성화
// app.use(cookieParser(SECRET));

// CORS: 접속 주소 명시 + credentials로 쿠키 전달. 로컬 기본 http://localhost:3000
const CORS_ORIGIN = (process.env.CORS_ORIGIN || process.env.CLIENT_URL || 'http://localhost:3000').trim();
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));

// 브라우저가 쿠키를 받도록 Credentials 헤더 강제 노출
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// 보안 헤더 (클릭재킹·MIME 스니핑 등 완화)
app.use(function (req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// CORS: 프론트/백 포트가 다르면(예: 3000 vs 5173) .env에 CLIENT_URL=http://localhost:5173 설정 — origin 정확히 맞춰야 쿠키 전달됨
const CLIENT_URL = (process.env.CLIENT_URL || '').trim();
if (CLIENT_URL) {
  app.use(cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
}

function ensureDataDir() {
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ——— 토네이도 뉴스 (프라이버시/토네이도캐시/해킹 등 수집·수동 등록) ———
function readTornadoNews() {
  ensureDataDir();
  if (!fs.existsSync(TORNADO_NEWS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(TORNADO_NEWS_FILE, 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch (_) {
    return [];
  }
}

function writeTornadoNews(items) {
  ensureDataDir();
  const max = 500;
  const trimmed = items.slice(0, max);
  fs.writeFileSync(TORNADO_NEWS_FILE, JSON.stringify({ items: trimmed }, null, 2));
}

function readTornadoNewsSources() {
  ensureDataDir();
  if (!fs.existsSync(TORNADO_NEWS_SOURCES_FILE)) {
    const defaultSources = [
      { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', enabled: true },
      { id: 'cointelegraph-regulation', name: 'Cointelegraph (규제)', url: 'https://cointelegraph.com/rss/tag/regulation', enabled: true },
      { id: 'cointelegraph-defi', name: 'Cointelegraph (DeFi)', url: 'https://cointelegraph.com/rss/tag/defi', enabled: true },
      { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed', enabled: true },
      { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml', enabled: true },
    ];
    fs.writeFileSync(TORNADO_NEWS_SOURCES_FILE, JSON.stringify({ sources: defaultSources }, null, 2));
    return defaultSources;
  }
  try {
    const data = JSON.parse(fs.readFileSync(TORNADO_NEWS_SOURCES_FILE, 'utf8'));
    return Array.isArray(data.sources) ? data.sources : [];
  } catch (_) {
    return [];
  }
}

function writeTornadoNewsSources(sources) {
  ensureDataDir();
  fs.writeFileSync(TORNADO_NEWS_SOURCES_FILE, JSON.stringify({ sources }, null, 2));
}

const TORNADO_NEWS_ETAGS_FILE = path.join(__dirname, 'data', 'tornado-news-etags.json');

function readTornadoNewsEtags() {
  ensureDataDir();
  if (!fs.existsSync(TORNADO_NEWS_ETAGS_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(TORNADO_NEWS_ETAGS_FILE, 'utf8'));
    return typeof data === 'object' && data !== null ? data : {};
  } catch (_) {
    return {};
  }
}

function writeTornadoNewsEtags(etags) {
  ensureDataDir();
  fs.writeFileSync(TORNADO_NEWS_ETAGS_FILE, JSON.stringify(etags, null, 2));
}

// 2026-02-20 00:00:00 UTC 이후 기사만 수집 (그 이전 날짜/날짜 없는 기사는 제외)
const TORNADO_NEWS_CUTOFF_DATE = new Date('2026-02-20T00:00:00.000Z');

const TORNADO_NEWS_KEYWORDS_DEFAULT = [
  '프라이버시', '토네이도 캐시', '토네이도캐시', 'tornado cash', 'TORN', '해킹', '세탁', '혼합기', 'mixer',
  'privacy', 'hacking', 'laundering', 'money laundering', 'tornado',
];

function readTornadoNewsKeywords() {
  ensureDataDir();
  if (!fs.existsSync(TORNADO_NEWS_KEYWORDS_FILE)) return TORNADO_NEWS_KEYWORDS_DEFAULT.slice();
  try {
    const data = JSON.parse(fs.readFileSync(TORNADO_NEWS_KEYWORDS_FILE, 'utf8'));
    return Array.isArray(data.keywords) ? data.keywords.filter((k) => typeof k === 'string' && k.trim()) : TORNADO_NEWS_KEYWORDS_DEFAULT.slice();
  } catch (_) {
    return TORNADO_NEWS_KEYWORDS_DEFAULT.slice();
  }
}

function writeTornadoNewsKeywords(keywords) {
  ensureDataDir();
  const list = Array.isArray(keywords) ? keywords.filter((k) => typeof k === 'string' && k.trim()) : [];
  fs.writeFileSync(TORNADO_NEWS_KEYWORDS_FILE, JSON.stringify({ keywords: list.length ? list : TORNADO_NEWS_KEYWORDS_DEFAULT }, null, 2));
}

/** $: cheerio, $el: 링크 또는 부모 컨테이너. 반환: Date 또는 null */
function parseArticleDateFromEl($, $el) {
  if (!$el || !$el.length) return null;
  const $container = $el.closest ? $el.closest('article, .article, .news-item, .post, li, [class*="card"]') : $el;
  const $scope = $container.length ? $container : $el;
  const $time = $scope.find('time[datetime]').first();
  const datetime = $time.length ? $time.attr('datetime') : null;
  if (datetime) {
    const d = new Date(datetime);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const text = $scope.text() || '';
  const match = text.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/) || text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const d = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function matchTornadoKeywords(text) {
  if (!text || typeof text !== 'string') return false;
  const keywords = readTornadoNewsKeywords();
  const lower = text.toLowerCase();
  const normalized = (text + ' ' + lower).replace(/\s+/g, ' ');
  for (const kw of keywords) {
    if (!kw || String(kw).length < 2) continue;
    if (normalized.includes(kw) || lower.includes(String(kw).toLowerCase())) return true;
  }
  return false;
}

function parseCoinnessNews(html, baseUrl) {
  const items = [];
  try {
    const $ = cheerio.load(html);
    $('a[href*="/news/"], a[href*="article"], a[href*="news"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href || href.length < 10) return;
      const url = href.startsWith('http') ? href : new URL(href, baseUrl).href;
      const $block = $a.closest('article, .article, .news-item, li, [class*="card"], [class*="item"]');
      const blockText = $block.length ? $block.text().trim().replace(/\s+/g, ' ') : '';
      const title = ($a.text().trim() || $block.find('h2, h3, h4, .title').first().text().trim() || blockText.slice(0, 150)).replace(/\s+/g, ' ').slice(0, 300);
      if (!title || title.length < 2) return;
      const searchText = (title + ' ' + blockText).slice(0, 500);
      if (!matchTornadoKeywords(searchText)) return;
      const summary = blockText.slice(0, 300) || title.slice(0, 200);
      const articleDate = parseArticleDateFromEl($, $a);
      items.push({ title, summary, url, sourceName: '코인니스', sourceUrl: baseUrl, articleDate });
    });
  } catch (e) {
    console.warn('parseCoinnessNews', e.message);
  }
  return items;
}

function parseBloomingbitNews(html, baseUrl) {
  const items = [];
  try {
    const $ = cheerio.load(html);
    $('a[href*="/news/"], a[href*="/article/"], a[href*="news"], a[href*="article"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href || href.length < 10) return;
      const url = href.startsWith('http') ? href : new URL(href, baseUrl).href;
      const $block = $a.closest('article, .article, .news-item, li, [class*="card"], [class*="item"]');
      const blockText = $block.length ? $block.text().trim().replace(/\s+/g, ' ') : '';
      const title = ($a.text().trim() || $block.find('h2, h3, h4, .title').first().text().trim() || blockText.slice(0, 150)).replace(/\s+/g, ' ').slice(0, 300);
      if (!title || title.length < 2) return;
      const searchText = (title + ' ' + blockText).slice(0, 500);
      if (!matchTornadoKeywords(searchText)) return;
      const summary = blockText.slice(0, 300) || title.slice(0, 200);
      const articleDate = parseArticleDateFromEl($, $a);
      items.push({ title, summary, url, sourceName: '블루밍비트', sourceUrl: baseUrl, articleDate });
    });
  } catch (e) {
    console.warn('parseBloomingbitNews', e.message);
  }
  return items;
}

function getParserForSource(source) {
  const u = (source.url || '').toLowerCase();
  if (u.includes('coinness.com')) return parseCoinnessNews;
  if (u.includes('bloomingbit')) return parseBloomingbitNews;
  return (html, baseUrl) => {
    return genericTornadoNewsParser(html, baseUrl, source.name || '기타');
  };
}

/** RSS/Atom 피드 파싱. 반환: { title, summary, url, sourceName, sourceUrl, articleDate }[] */
function parseRssFeed(body, feedUrl, sourceName) {
  const items = [];
  if (!body || typeof body !== 'string') return items;
  const raw = body.trim();
  if (!raw.includes('<rss') && !raw.includes('<feed') && !raw.includes('<channel') && !raw.includes('<entry')) return items;
  try {
    const $ = cheerio.load(body, { xmlMode: true });
    const $channel = $('channel');
    const $feed = $('feed');
    if ($channel.length > 0) {
      $channel.find('item').each((_, el) => {
        const $el = $(el);
        const title = $el.find('title').first().text().trim().replace(/\s+/g, ' ');
        const link = $el.find('link').first().text().trim() || $el.find('link').first().attr('href') || '';
        const desc = $el.find('description').first().text().trim().replace(/\s+/g, ' ').slice(0, 500);
        const pubDate = $el.find('pubDate').first().text().trim();
        if (!link || !title) return;
        const url = link.startsWith('http') ? link : new URL(link, feedUrl).href;
        let articleDate = null;
        if (pubDate) {
          const d = new Date(pubDate);
          if (!Number.isNaN(d.getTime())) articleDate = d;
        }
        items.push({ title, summary: desc || title.slice(0, 200), url, sourceName: sourceName || 'RSS', sourceUrl: feedUrl, articleDate });
      });
    }
    if ($feed.length > 0 && items.length === 0) {
      $feed.find('entry').each((_, el) => {
        const $el = $(el);
        const title = $el.find('title').first().text().trim().replace(/\s+/g, ' ');
        const $link = $el.find('link[href]').first();
        const link = $link.attr('href') || $el.find('link').first().text().trim() || '';
        const summary = ($el.find('summary').first().text() || $el.find('content').first().text()).trim().replace(/\s+/g, ' ').slice(0, 500);
        const updated = $el.find('updated').first().text().trim() || $el.find('published').first().text().trim();
        if (!link || !title) return;
        const url = link.startsWith('http') ? link : new URL(link, feedUrl).href;
        let articleDate = null;
        if (updated) {
          const d = new Date(updated);
          if (!Number.isNaN(d.getTime())) articleDate = d;
        }
        items.push({ title, summary: summary || title.slice(0, 200), url, sourceName: sourceName || 'RSS', sourceUrl: feedUrl, articleDate });
      });
    }
  } catch (e) {
    console.warn('parseRssFeed', e.message);
  }
  return items;
}

function isRssOrAtom(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('rss') || ct.includes('atom') || ct.includes('xml')) return true;
  if (!body || typeof body !== 'string') return false;
  const raw = body.trim();
  return raw.startsWith('<?xml') || raw.includes('<rss') || raw.includes('<feed') || (raw.includes('<channel') && raw.includes('<item>'));
}

/** 소스별 파서가 0건일 때 사용. 링크 넓게 잡고 키워드는 제목+부모 텍스트로 검사 */
function genericTornadoNewsParser(html, baseUrl, sourceName) {
  const items = [];
  try {
    const $ = cheerio.load(html);
    $('a[href]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href');
      if (!href || href.length < 8) return;
      const url = href.startsWith('http') ? href : new URL(href, baseUrl).href;
      if (!/^\w+:\/\//.test(url) || url.length > 400) return;
      const $block = $a.closest('article, .article, .news-item, .post, li, [class*="card"], [class*="item"], [class*="list"]');
      const blockText = $block.length ? $block.text().trim().replace(/\s+/g, ' ') : '';
      const title = ($a.text().trim() || $block.find('h2, h3, h4, .title').first().text().trim() || blockText.slice(0, 120)).replace(/\s+/g, ' ').slice(0, 300);
      if (!title || title.length < 3) return;
      const searchText = (title + ' ' + blockText).slice(0, 600);
      if (!matchTornadoKeywords(searchText)) return;
      const articleDate = parseArticleDateFromEl($, $a);
      items.push({ title, summary: (blockText || title).slice(0, 300), url, sourceName: sourceName || '기타', sourceUrl: baseUrl, articleDate });
    });
  } catch (_) {}
  return items;
}

const DEEPL_AUTH_KEY = process.env.DEEPL_AUTH_KEY || '';
const TORNADO_NEWS_TRANSLATE_MAX_PER_FETCH = 10;
const TORNADO_NEWS_TRANSLATE_MAX_MYMEMORY = 5;

function looksLikeKorean(text) {
  if (!text || text.length < 2) return false;
  const ko = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
  return ko / Math.min(text.length, 100) > 0.3;
}

function firstTwoSentences(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  const match = trimmed.match(/^[^.!?]*[.!?]?\s*[^.!?]*[.!?]?/);
  return (match ? match[0] : trimmed.slice(0, 200)).trim();
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 중복 판별용 제목 정규화: 소문자, 영숫자·한글·공백만, 연속 공백 1개, 앞 120자 */
function normalizeTitleForDedupe(title) {
  if (!title || typeof title !== 'string') return '';
  const t = title
    .toLowerCase()
    .replace(/[^\w\uac00-\ud7a3\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return t;
}

/** 두 제목이 같은 기사로 볼지 판단 (맥락·유사도) */
function areTitlesDuplicate(titleA, titleB) {
  const a = normalizeTitleForDedupe(titleA);
  const b = normalizeTitleForDedupe(titleB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10 && (a.includes(b) || b.includes(a))) return true;
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  if (wordsA.length < 3 || wordsB.length < 3) return false;
  const setB = new Set(wordsB);
  const overlap = wordsA.filter((w) => setB.has(w)).length;
  const jaccard = overlap / (wordsA.length + wordsB.length - overlap);
  return jaccard >= 0.6;
}

/** 기존 목록에서 candidate 제목(또는 한글 제목)과 중복인 항목이 있는지 */
function hasDuplicateTitleInList(items, candidateTitle, candidateTitleKo) {
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    if (areTitlesDuplicate(item.title || '', candidateTitle || '')) return true;
    if (candidateTitleKo && item.titleKo && areTitlesDuplicate(item.titleKo, candidateTitleKo)) return true;
    return false;
  });
}

/** 전체 목록에서 제목 유사 그룹별로 1건만 남기고 나머지 제거. 반환: { removed, kept } */
function runDedupeTornadoNews() {
  const items = readTornadoNews();
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i, j) {
    const pi = find(i);
    const pj = find(j);
    if (pi !== pj) parent[pi] = pj;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ti = items[i];
      const tj = items[j];
      if (areTitlesDuplicate(ti.title || '', tj.title || '')) union(i, j);
      else if (ti.titleKo && tj.titleKo && areTitlesDuplicate(ti.titleKo, tj.titleKo)) union(i, j);
    }
  }
  const rootToIndices = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!rootToIndices.has(r)) rootToIndices.set(r, []);
    rootToIndices.get(r).push(i);
  }
  const toKeep = new Set();
  for (const indices of rootToIndices.values()) {
    const byDate = indices
      .map((idx) => ({ idx, createdAt: items[idx].createdAt || '' }))
      .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
    toKeep.add(byDate[0].idx);
  }
  const kept = items.filter((_, i) => toKeep.has(i));
  const removed = n - kept.length;
  if (removed > 0) writeTornadoNews(kept);
  return { removed, kept: kept.length };
}

async function translateWithDeepL(text) {
  if (!DEEPL_AUTH_KEY || !text) return null;
  const toSend = text.trim().slice(0, 2000);
  if (!toSend) return null;
  try {
    const params = new URLSearchParams({ auth_key: DEEPL_AUTH_KEY, text: toSend, target_lang: 'KO' });
    const res = await fetch('https://api-free.deepl.com/v2/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const t = data.translations && data.translations[0] && data.translations[0].text;
    return t ? String(t).trim() : null;
  } catch (_) {
    return null;
  }
}

async function translateWithMyMemory(text) {
  if (!text || typeof text !== 'string') return null;
  const toSend = text.trim().slice(0, 500);
  if (!toSend) return null;
  try {
    const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(toSend) + '&langpair=en|ko';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const t = data.responseData && data.responseData.translatedText;
    return t ? String(t).trim() : null;
  } catch (_) {
    return null;
  }
}

async function translateToKorean(text) {
  if (!text || typeof text !== 'string') return null;
  if (DEEPL_AUTH_KEY) return translateWithDeepL(text);
  return translateWithMyMemory(text);
}

async function fetchTornadoNewsFromSources() {
  const sources = readTornadoNewsSources().filter((s) => s.enabled !== false);
  const existing = readTornadoNews();
  const seenUrls = new Set(existing.map((i) => (i.url || '').toLowerCase().replace(/#.*$/, '')));
  let added = 0;
  let translatedCount = 0;
  const errors = [];
  const etags = readTornadoNewsEtags();

  for (let idx = 0; idx < sources.length; idx++) {
    if (idx > 0) await new Promise((r) => setTimeout(r, TORNADO_NEWS_SOURCE_DELAY_MS));
    const source = sources[idx];
    const cached = etags[source.url];
    const headers = { 'User-Agent': 'TornFi-News/1.0 (compatible; news aggregator)' };
    if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
    if (cached && cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    try {
      const res = await fetch(source.url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 304) continue;
      if (!res.ok) {
        errors.push(`${source.name}: HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      const etag = res.headers.get('etag');
      const lastModified = res.headers.get('last-modified');
      if (etag || lastModified) {
        etags[source.url] = { etag: etag || undefined, lastModified: lastModified || undefined };
        writeTornadoNewsEtags(etags);
      }
      const contentType = res.headers.get('content-type') || '';
      let items = [];
      if (isRssOrAtom(body, contentType)) {
        items = parseRssFeed(body, source.url, source.name);
      } else {
        const parser = getParserForSource(source);
        items = parser(body, source.url);
        if (!Array.isArray(items)) items = [];
        if (items.length === 0) {
          items = genericTornadoNewsParser(body, source.url, source.name);
        }
      }
      for (const it of items) {
        const searchText = ((it.title || '') + ' ' + (it.summary || '')).slice(0, 600);
        if (!matchTornadoKeywords(searchText)) continue;
        const norm = (it.url || '').toLowerCase().replace(/#.*$/, '');
        if (!norm || seenUrls.has(norm)) continue;
        const title = (it.title || '').slice(0, 300);
        if (hasDuplicateTitleInList(existing, title)) continue;
        const articleDate = it.articleDate ? (it.articleDate instanceof Date ? it.articleDate : new Date(it.articleDate)) : null;
        if (articleDate && !Number.isNaN(articleDate.getTime()) && articleDate < TORNADO_NEWS_CUTOFF_DATE) continue;
        seenUrls.add(norm);
        const useDate = articleDate && !Number.isNaN(articleDate.getTime()) ? articleDate : new Date();
        const summary = (it.summary || '').slice(0, 500);
        let titleKo = null;
        const translateLimit = DEEPL_AUTH_KEY ? TORNADO_NEWS_TRANSLATE_MAX_PER_FETCH : TORNADO_NEWS_TRANSLATE_MAX_MYMEMORY;
        if (translateLimit > 0 && translatedCount < translateLimit && !looksLikeKorean(title)) {
          translatedCount++;
          titleKo = await translateToKorean(title);
          if (titleKo) titleKo = titleKo.slice(0, 300);
          if (translatedCount % 3 === 0) await new Promise((r) => setTimeout(r, 200));
        }
        existing.unshift({
          id: crypto.randomBytes(8).toString('hex'),
          title,
          summary,
          url: it.url,
          sourceName: it.sourceName || source.name,
          sourceUrl: it.sourceUrl || source.url,
          createdAt: useDate.toISOString(),
          isManual: false,
          titleKo: titleKo || undefined,
        });
        added++;
      }
    } catch (err) {
      errors.push(`${source.name}: ${err.message || 'fetch failed'}`);
    }
  }

  if (added > 0) {
    writeTornadoNews(existing);
    const d = runDedupeTornadoNews();
    return { added, deduped: d.removed || 0, errors };
  }
  return { added, errors };
}

const TORNADO_NEWS_FETCH_INTERVAL_MS = parseInt(process.env.TORNADO_NEWS_FETCH_INTERVAL_MS, 10) || 6 * 60 * 60 * 1000;
const TORNADO_NEWS_SOURCE_DELAY_MS = 800;

async function runScheduledTornadoNews() {
  try {
    const result = await fetchTornadoNewsFromSources();
    const items = readTornadoNews();
    const needTranslation = items.filter((i) => !i.titleKo && !looksLikeKorean(i.title || ''));
    const toProcess = needTranslation.slice(0, TORNADO_NEWS_TRANSLATE_EXISTING_MAX);
    for (const item of toProcess) {
      const title = (item.title || '').slice(0, 300);
      const tKo = await translateToKorean(title);
      if (tKo) item.titleKo = tKo.slice(0, 300);
      await new Promise((r) => setTimeout(r, 220));
    }
    if (toProcess.length > 0) writeTornadoNews(items);
  } catch (err) {
    console.error('Tornado news schedule error:', err.message);
  }
}

// 상한 대비 나머지 유통량만큼 1번 풀 보유 — TORN 담보 70% 상한에서 ‘풀’ 역할
function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

const sessions = new Map();
// 세션 만료: 메모리(Map)에 세션이 무한히 쌓이지 않도록 일정 시간 후 자동 삭제. 쿠키 maxAge와 맞춤.
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// 만료된 세션 주기 정리 → Map 크기 줄여서 메모리 사용 완화
setInterval(async () => {
  const now = Date.now();
  for (const [token, sess] of sessions.entries()) {
    if (sess && sess.expiresAt && sess.expiresAt < now) sessions.delete(token);
  }
  if (typeof db.deleteExpiredSessions === 'function') await db.deleteExpiredSessions();
}, 60 * 60 * 1000);

// 관리자 PIN 연속 실패: IP별 5회 실패 시 15분 잠금
const ADMIN_PIN_MAX_ATTEMPTS = 5;
const ADMIN_PIN_LOCK_MS = 15 * 60 * 1000;
const adminPinFailedAttempts = new Map(); // ip -> { count, lockedUntil }

function getClientIp(req) {
  return (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip']))?.split(',')[0]?.trim()
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress
    || '0.0.0.0';
}

// 로그인·가입 브루트포스 완화: IP당 15분에 20회 제한
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX = 20;
const authRateByIp = new Map(); // ip -> { count, resetAt }
function checkAuthRateLimit(req, res) {
  const ip = getClientIp(req) || '0.0.0.0';
  const now = Date.now();
  let rec = authRateByIp.get(ip);
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + AUTH_RATE_WINDOW_MS };
    authRateByIp.set(ip, rec);
  }
  rec.count += 1;
  if (rec.count > AUTH_RATE_MAX) {
    res.status(429).json({ ok: false, message: '요청이 너무 많습니다. 15분 후 다시 시도해 주세요.' });
    return true;
  }
  return false;
}

// 중요 쓰기 API rate limit: IP당 1분에 60회 (채팅·업로드·글 작성 등)
const WRITE_RATE_WINDOW_MS = 60 * 1000;
const WRITE_RATE_MAX = 60;
const writeRateByIp = new Map();
function rateLimitWrites(req, res, next) {
  const ip = getClientIp(req) || '0.0.0.0';
  const now = Date.now();
  let rec = writeRateByIp.get(ip);
  if (!rec || now >= rec.resetAt) {
    rec = { count: 0, resetAt: now + WRITE_RATE_WINDOW_MS };
    writeRateByIp.set(ip, rec);
  }
  rec.count += 1;
  if (rec.count > WRITE_RATE_MAX) {
    return res.status(429).json({ ok: false, message: '요청이 너무 많습니다. 1분 후 다시 시도해 주세요.' });
  }
  next();
}

function adminPinLocked(ip) {
  const rec = adminPinFailedAttempts.get(ip);
  if (!rec || !rec.lockedUntil) return false;
  if (rec.lockedUntil <= Date.now()) {
    adminPinFailedAttempts.delete(ip);
    return false;
  }
  return true;
}

function adminPinRecordFailure(ip) {
  const rec = adminPinFailedAttempts.get(ip) || { count: 0, lockedUntil: null };
  rec.count += 1;
  if (rec.count >= ADMIN_PIN_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + ADMIN_PIN_LOCK_MS;
  }
  adminPinFailedAttempts.set(ip, rec);
}

function adminPinRecordSuccess(ip) {
  adminPinFailedAttempts.delete(ip);
}

async function authMiddleware(req, res, next) {
  try {
    // 1) Passport가 세션에서 복원한 사용자 우선 (deserializeUser → req.user)
    if (req.user) {
      req.sessionToken = null;
      // express-session에 저장된 관리자 플래그 반영 (비번 인증 후 유지)
      if (req.session) {
        if (req.session.isAdmin === true) req.user.isAdmin = true;
        if (req.session.adminPinVerified === true) req.user.adminPinVerified = true;
      }
      return next();
    }
    // 2) 구 호환: express-session에 수동 저장된 user
    if (req.session && req.session.user) {
      req.user = req.session.user;
      req.sessionToken = null;
      return next();
    }
    // 3) 기존 방식: session 쿠키 + DB/메모리 세션
    const token = req.signedCookies?.session;
    let sess = null;
    if (token) {
      if (typeof db.getSession === 'function') {
        sess = await db.getSession(token);
      }
      if (!sess && sessions.has(token)) sess = sessions.get(token);
      if (sess && sess.expiresAt && sess.expiresAt < Date.now()) {
        if (typeof db.deleteSession === 'function') await db.deleteSession(token);
        else sessions.delete(token);
        sess = null;
      }
    }
    if (sess) {
      sessions.set(token, sess);
      req.user = sess;
      req.sessionToken = token;
      const users = await db.readUsers();
      const dbUser = users.find((u) => String(u.id) === String(req.user.id));
      // 회원에 없어도 세션 삭제하지 않음. 탈퇴(withdrawn)인 경우에만 세션 제거
      if (dbUser && dbUser.withdrawn === true) {
        if (typeof db.deleteSession === 'function') await db.deleteSession(token);
        else sessions.delete(token);
        req.user = null;
      }
    } else {
      req.user = null;
      req.authDebug = {
        hadSignedSession: !!token,
        hadAnySessionCookie: !!(req.cookies && req.cookies.session),
      };
    }
    next();
  } catch (e) {
    next(e);
  }
}

app.use(authMiddleware);

// 이더리움 주소 검증 (형식 + EIP-55 체크섬)
function validateAndNormalizeEthAddress(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}

// TORN 스테이킹 여부 조회 — 계산기 "내 지갑 주소"와 동일하게 lockedBalance 사용 (RPC 폴백). 수량이 0이면 스테이킹 아님
async function checkTornStaking(ethAddress) {
  let lastError = null;
  for (const rpcUrl of ETH_RPC_URLS) {
    try {
      const provider = new JsonRpcProvider(rpcUrl);
      const contract = new Contract(TORN_GOV_STAKING_ADDRESS, TORN_GOV_STAKING_ABI, provider);
      const locked = await contract.lockedBalance(ethAddress);
      const lockedBn = typeof locked === 'bigint' ? locked : BigInt(String(locked ?? '0'));
      return { staking: lockedBn > 0n, lockedBalance: lockedBn.toString() };
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) {
    console.warn('checkTornStaking RPC failed (all URLs):', lastError.message);
  }
  return { staking: false, lockedBalance: '0', error: lastError?.message || 'RPC failed' };
}

// DB 모드 확인 (로컬 vs 배포가 같은 DB 쓰는지 비교용 — URI 자체는 노출하지 않음)
app.get('/api/db-mode', (req, res) => {
  const uri = (process.env.MONGODB_URI || '').trim();
  const useMongo = !!uri;
  const uriHash = useMongo ? crypto.createHash('sha256').update(uri).digest('hex').slice(0, 16) : '';
  res.json({ useMongo, uriHash: uriHash || null });
});

// 인증 상태 디버그 (401 원인 확인용 — 로그인 같은 탭에서 /api/debug-auth 호출)
function handleDebugAuth(req, res) {
  const hasCookie = !!(req.cookies && req.cookies.session);
  const hasSignedSession = !!(req.signedCookies && req.signedCookies.session);
  const hasUser = !!req.user;
  let hint = '';
  if (!hasCookie) hint = '브라우저가 session 쿠키를 보내지 않음. (다른 도메인/HTTPS/주소 통일 확인)';
  else if (!hasSignedSession) hint = '쿠키는 오지만 서명 검증 실패. (SESSION_SECRET이 로그인 시와 동일한지 확인)';
  else if (!hasUser) hint = '서명 OK, 세션 DB/만료 문제. (재로그인 또는 MongoDB 세션 확인)';
  else hint = '정상 인증됨.';
  res.json({
    ok: true,
    hasCookie,
    hasSignedSession,
    hasUser,
    hint,
  });
}
app.get('/api/debug-auth', handleDebugAuth);
app.get('/api/debug-auth/', handleDebugAuth);
app.get('/api/debug/auth', handleDebugAuth);
app.get('/api/debug/auth/', handleDebugAuth);

// 스테이킹 확인 API (회원가입 폼에서 지갑 유효성과 함께 사용)
app.get('/api/check-staking', async (req, res) => {
  const walletAddress = String(req.query.walletAddress || '').trim();
  const normalized = validateAndNormalizeEthAddress(walletAddress);
  if (!normalized) {
    return res.status(400).json({ ok: false, message: '유효한 이더리움 지갑 주소가 아닙니다.', staking: false });
  }
  const { staking, lockedBalance, error } = await checkTornStaking(normalized);
  if (error) {
    return res.status(502).json({ ok: false, message: '스테이킹 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.', staking: false });
  }
  // lockedBalance는 wei(18자리) → TORN 단위로 변환 후 반환 (총 발행량 약 1천만 TORN)
  const lockedTorn = formatUnits(lockedBalance || '0', TORN_DECIMALS);
  res.json({ ok: true, staking: !!staking, lockedBalance: lockedTorn });
});

// 지갑 주소 중복 가입 여부 확인 (회원가입 폼용, 인증 불필요)
app.get('/api/public/check-wallet', async (req, res) => {
  const walletAddress = String(req.query.walletAddress || '').trim();
  const normalized = validateAndNormalizeEthAddress(walletAddress);
  if (!normalized) {
    return res.json({ ok: true, registered: false });
  }
  const users = await db.readUsers();
  const existing = users.find(u => u.walletAddress && u.walletAddress.toLowerCase() === normalized.toLowerCase());
  if (existing) {
    return res.json({ ok: true, registered: true, withdrawn: existing.withdrawn === true, forceWithdrawn: false });
  }
  const forceWithdraws = await db.readForceWithdraws();
  const inForceWithdraw = forceWithdraws.some(e => e.walletAddress && e.walletAddress.toLowerCase() === normalized.toLowerCase());
  if (inForceWithdraw) {
    return res.json({ ok: true, registered: true, forceWithdrawn: true });
  }
  return res.json({ ok: true, registered: false });
});

// 로그인 비밀번호: 브루트포스 방어 — 8자 이상, 영문·숫자 포함 (특수문자 사용 권장)
const PASSWORD_MIN_LENGTH = 8;
function isPasswordStrong(pwd) {
  if (!pwd || pwd.length < PASSWORD_MIN_LENGTH) return false;
  return /[a-zA-Z]/.test(pwd) && /\d/.test(pwd);
}
const MEMBER_LEVEL_MIN = 1;
const MEMBER_LEVEL_MAX = 6;

// TORN 스테이킹 수량(개) 기준 회원 등급: 조개(<1), 새우(<1000), 문어(<2000), 물개(<3000), 상어(<4000), 고래(>=4000)
function stakedAmountToLevel(stakedNum) {
  if (typeof stakedNum !== 'number' || stakedNum < 0) return MEMBER_LEVEL_MIN;
  if (stakedNum < 1) return 1;
  if (stakedNum < 1000) return 2;
  if (stakedNum < 2000) return 3;
  if (stakedNum < 3000) return 4;
  if (stakedNum < 4000) return 5;
  return 6;
}

function getMemberLevel(user) {
  if (!user) return MEMBER_LEVEL_MIN;
  const lv = parseInt(user.level, 10);
  if (lv >= 1 && lv <= MEMBER_LEVEL_MAX) return lv;
  return MEMBER_LEVEL_MIN;
}

// 닉네임 중복 확인 (회원가입용, 인증 불필요)
const NICKNAME_REGEX = /^[a-zA-Z0-9]{5,12}$/;
function isNicknameValid(name) {
  return name && NICKNAME_REGEX.test(name) && /[a-zA-Z]/.test(name);
}
// 로컬에서 Atlas 접속 안 될 때: Render 서버에서 admin109 생성 (1회만 호출, 끝나면 Render에서 SEED_ADMIN_KEY 삭제 권장)
app.get('/api/debug/seed-admin', async (req, res) => {
  const key = String(req.query.key || '').trim();
  const expected = String(process.env.SEED_ADMIN_KEY || '').trim();
  if (!expected || key !== expected) {
    return res.status(403).json({ ok: false, message: 'key 불일치 또는 SEED_ADMIN_KEY 미설정' });
  }
  try {
    const users = await db.readUsers();
    const ADMIN_NAME = 'admin109';
    const ADMIN_PW = '111111';
    const PLACEHOLDER = '0x0000000000000000000000000000000000000008';
    let admin = users.find((u) => u.displayName && u.displayName.toLowerCase() === ADMIN_NAME.toLowerCase());
    if (admin) {
      admin.passwordHash = bcrypt.hashSync(ADMIN_PW, 10);
      admin.approved = true;
      admin.boardAdmin = true;
    } else {
      admin = {
        id: crypto.randomBytes(12).toString('hex'),
        passwordHash: bcrypt.hashSync(ADMIN_PW, 10),
        displayName: ADMIN_NAME,
        walletAddress: PLACEHOLDER,
        referrer: null,
        approved: true,
        approvedAt: new Date().toISOString(),
        approvedBy: 'seed-admin',
        points: 0,
        level: 1,
        boardAdmin: true,
        createdAt: new Date().toISOString(),
      };
      users.push(admin);
    }
    await db.writeUsers(users);
    res.json({ ok: true, message: 'admin109 생성/비밀번호 초기화 완료. 로그인 후 SEED_ADMIN_KEY 삭제 권장.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// 로그인 문제 확인용: 이 서버가 보는 DB에 admin109가 있는지 (key 필요, 프로덕션 정보 노출 방지)
app.get('/api/debug/check-admin', async (req, res) => {
  const key = String(req.query.key || '').trim();
  const expected = String(process.env.SEED_ADMIN_KEY || process.env.DEBUG_VIEW_KEY || '').trim();
  if (!expected || key !== expected) {
    return res.status(403).json({ ok: false, message: 'key 불일치 또는 DEBUG_VIEW_KEY/SEED_ADMIN_KEY 미설정' });
  }
  try {
    const uri = (process.env.MONGODB_URI || '').trim();
    const uriHash = crypto.createHash('sha256').update(uri).digest('hex').slice(0, 16);
    const pathPart = uri.split('?')[0].trim();
    const lastSlash = pathPart.lastIndexOf('/');
    const afterSlash = pathPart.slice(lastSlash + 1).trim();
    const dbName = afterSlash && !afterSlash.includes('.') ? afterSlash : '(없음)';

    const users = await db.readUsers();
    const admin = users.find((u) => u.displayName && u.displayName.toLowerCase() === 'admin109');
    res.json({
      dbName,
      uriHash,
      userCount: users.length,
      admin109Exists: !!admin,
      hasPassword: !!(admin && admin.passwordHash),
      approved: admin ? admin.approved !== false : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/api/public/check-nickname', async (req, res) => {
  const raw = String(req.query.displayName || '').trim();
  if (!isNicknameValid(raw)) {
    return res.json({ ok: true, available: false, message: '닉네임은 영문, 숫자만 5~12자까지 가능합니다.' });
  }
  const users = await db.readUsers();
  const lower = raw.toLowerCase();
  const taken = users.some(u => u.displayName && u.displayName.toLowerCase() === lower);
  return res.json({ ok: true, available: !taken, message: taken ? '이미 사용 중인 닉네임입니다.' : null });
});

// 회원가입 (닉네임 + 비밀번호 + 추천인 선택, 지갑 주소 없음)
const REGISTER_NO_WALLET = '0x0000000000000000000000000000000000000000';
app.post('/api/register', async (req, res) => {
  if (checkAuthRateLimit(req, res)) return;
  const { password, displayName, referrer } = req.body || {};
  const passwordStr = String(password || '');
  const nameRaw = String(displayName || '').trim() || null;
  const name = isNicknameValid(nameRaw) ? nameRaw : null;

  if (!nameRaw) {
    return res.status(400).json({ ok: false, message: '닉네임을 입력해 주세요.' });
  }
  if (!name) {
    return res.status(400).json({ ok: false, message: '닉네임은 영문, 숫자만 5~12자까지 가능합니다.' });
  }
  if (!passwordStr) {
    return res.status(400).json({ ok: false, message: '비밀번호를 입력해 주세요.' });
  }
  if (!isPasswordStrong(passwordStr)) {
    return res.status(400).json({ ok: false, message: '비밀번호는 8자 이상이며, 영문과 숫자를 모두 포함해야 합니다. (특수문자 사용 시 더 안전합니다)' });
  }

  const referrerTrim = String(referrer || '').trim() || null;
  const clientIp = getClientIp(req);
  const users = await db.readUsers();
  const displayNameLower = name.toLowerCase();

  const ipCheck = checkDuplicateIp(clientIp, users);
  if (ipCheck.block) {
    const who = ipCheck.sameIpRecent && ipCheck.sameIpRecent.length > 0
      ? ipCheck.sameIpRecent.map((u) => u.displayName || u.id).join(', ')
      : '';
    const msg = who
      ? `이미 이 IP에서 가입한 계정이 있어 가입이 제한되었습니다. (동일 IP 가입: ${who})`
      : DUPLICATE_BLOCK_MESSAGE;
    return res.status(403).json({ ok: false, message: msg });
  }

  const existingByName = users.find((u) => u.displayName && u.displayName.toLowerCase() === displayNameLower);
  if (existingByName) {
    return res.status(409).json({ ok: false, message: '이미 사용 중인 닉네임입니다.' });
  }

  const settings = await db.readSettings();
  const autoApproveNewUsers = settings.autoApproveNewUsers !== false;
  const hash = bcrypt.hashSync(passwordStr, 10);
  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    passwordHash: hash,
    displayName: name,
    walletAddress: REGISTER_NO_WALLET,
    referrer: referrerTrim || null,
    approved: autoApproveNewUsers,
    createdAt: new Date().toISOString(),
    level: MEMBER_LEVEL_MIN,
    points: 3,
    signupIp: clientIp || undefined,
  };
  if (autoApproveNewUsers) {
    user.approvedAt = new Date().toISOString();
    user.approvedBy = 'auto';
  }

  users.push(user);
  await db.writeUsers(users);

  res.status(201).json({
    ok: true,
    message: autoApproveNewUsers ? '가입이 완료되었습니다. 로그인하여 이용해 주세요.' : '가입 신청이 완료되었습니다. 관리자 승인 후 로그인하여 이용해 주세요.',
    user: { id: user.id, displayName: user.displayName, walletAddress: user.walletAddress, approved: user.approved },
  });
});

// 로그인 (닉네임 + 비밀번호)
app.post('/api/login', async (req, res) => {
  if (checkAuthRateLimit(req, res)) return;
  const { id, password } = req.body || {};
  const nicknameInput = String(id || '').trim();
  const passwordStr = String(password || '');

  if (!nicknameInput || !passwordStr) {
    return res.status(400).json({ ok: false, message: '닉네임과 비밀번호를 입력해 주세요.' });
  }

  const users = await db.readUsers();
  const nicknameLower = nicknameInput.toLowerCase();
  const user = users.find(u => u.displayName && u.displayName.toLowerCase() === nicknameLower);
  if (!user || !user.passwordHash || !bcrypt.compareSync(passwordStr, user.passwordHash)) {
    return res.status(401).json({ ok: false, message: '닉네임 또는 비밀번호가 올바르지 않습니다.' });
  }
  if (user.isFake === true) {
    return res.status(403).json({ ok: false, message: '관리자가 생성한 테스트 계정은 로그인할 수 없습니다.' });
  }
  if (user.withdrawn === true) {
    return res.status(403).json({ ok: false, message: '탈퇴한 계정입니다.' });
  }
  const isApproved = user.approved !== false;
  if (!isApproved) {
    return res.status(403).json({ ok: false, message: '관리자 승인 대기 중입니다. 승인 후 로그인 가능합니다.' });
  }

  // 회원 id가 없으면 생성 후 DB 반영 (세션 연동 꼬임 방지)
  let userId = user.id != null && user.id !== '' ? String(user.id) : null;
  if (!userId) {
    userId = crypto.randomBytes(12).toString('hex');
    const idx = users.findIndex((u) => u === user || (u.displayName && u.displayName.toLowerCase() === nicknameLower));
    if (idx !== -1) {
      users[idx] = { ...users[idx], id: userId };
      await db.writeUsers(users);
    }
    user.id = userId;
  }

  const isAdminByWallet = user.walletAddress && ADMIN_WALLET_ADDRESSES.includes(user.walletAddress.toLowerCase());
  const isAdmin = isAdminByWallet || user.boardAdmin === true;
  const sessionUser = {
    id: userId,
    displayName: user.displayName,
    walletAddress: user.walletAddress || null,
    isAdmin: !!isAdmin,
  };

  // 강제 동기화: req.login 후 반드시 req.session.save() 호출하고, 그 콜백 안에서만 응답
  req.login(sessionUser, (err) => {
    if (err) {
      console.error('!!! SESSION SAVE ERROR !!!', err);
      return res.status(500).json({ ok: false, message: '세션 저장 실패' });
    }
    req.session.save((err2) => {
      if (err2) {
        console.error('!!! SESSION SAVE ERROR !!!', err2);
        return res.status(500).json({ ok: false, message: '세션 저장 실패' });
      }
      const sidSigned = 's:' + cookieSignature.sign(req.sessionID, SECRET);
      res.cookie('connect.sid', sidSigned, {
        path: '/',
        sameSite: 'none',
        secure: true,
        httpOnly: true,
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
      });
      res.json({
        ok: true,
        user: {
          id: userId,
          displayName: user.displayName,
          walletAddress: user.walletAddress || null,
          isAdmin: !!isAdmin,
          profileImageUrl: user.profileImageUrl || null,
          bio: user.bio != null ? user.bio : '',
        },
      });
    });
  });
});

// 로그아웃 (Set-Cookie 시 사용한 path/domain/sameSite/secure 와 동일하게 제거 — Render: sameSite none + secure 필수)
function getClearCookieOpts(req) {
  const opts = { path: '/', sameSite: 'none', secure: true };
  if (process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN) opts.domain = process.env.COOKIE_DOMAIN.trim();
  return opts;
}

app.post('/api/logout', (req, res) => {
  const token = req.signedCookies?.session;
  if (token) {
    if (typeof db.deleteSession === 'function') db.deleteSession(token).catch(() => {});
    sessions.delete(token);
  }
  req.logout(() => {
    res.clearCookie('session', getClearCookieOpts(req)).json({ ok: true });
  });
});

// 회원탈퇴 (로그인 필요, 로그인 비밀번호 확인)
app.post('/api/withdraw', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const { password } = req.body || {};
  const passwordStr = String(password || '').trim();
  if (!passwordStr) return res.status(400).json({ ok: false, message: '로그인 비밀번호를 입력해 주세요.' });
  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const me = users[idx];
  if (!me.passwordHash || !bcrypt.compareSync(passwordStr, me.passwordHash)) {
    return res.status(400).json({ ok: false, message: '로그인 비밀번호가 일치하지 않습니다.' });
  }
  users[idx].withdrawn = true;
  users[idx].withdrawnAt = new Date().toISOString();
  await db.writeUsers(users);
  const token = req.signedCookies?.session;
  if (token) {
    if (typeof db.deleteSession === 'function') await db.deleteSession(token);
    sessions.delete(token);
  }
  res.clearCookie('session', getClearCookieOpts(req)).json({ ok: true, message: '회원탈퇴가 완료되었습니다.' });
});

const NICKNAME_CHANGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14일

// 현재 사용자 정보 (커뮤니티용). 세션이 있으면 유지 — 회원 DB에 없어도 sessionInvalid 주지 않음 (강제 로그아웃 방지)
async function handleGetMe(req, res) {
  if (!req.user) return res.status(401).json({ ok: false, user: null });
  const users = await db.readUsers();
  const dbUser = users.find((u) => String(u.id) === String(req.user.id));
  if (!dbUser) {
    const minimal = { ...req.user, isAdmin: false, profileImageUrl: null, bio: '', points: 0, shopItems: {}, level: 1, nextDisplayNameChangeAt: null };
    return res.json({ ok: true, user: minimal });
  }
  let nextDisplayNameChangeAt = null;
  if (dbUser.lastDisplayNameChangedAt) {
    const next = new Date(new Date(dbUser.lastDisplayNameChangedAt).getTime() + NICKNAME_CHANGE_COOLDOWN_MS);
    if (next.getTime() > Date.now()) nextDisplayNameChangeAt = next.toISOString();
  }
  const isAdminByWallet = dbUser && dbUser.walletAddress && ADMIN_WALLET_ADDRESSES.includes(dbUser.walletAddress.toLowerCase());
  const isAdmin = isAdminByWallet || (dbUser && dbUser.boardAdmin === true);
  const user = {
    ...req.user,
    isAdmin: !!isAdmin,
    nextDisplayNameChangeAt,
    profileImageUrl: dbUser && dbUser.profileImageUrl ? dbUser.profileImageUrl : null,
    bio: dbUser && dbUser.bio != null ? dbUser.bio : '',
    points: typeof dbUser?.points === 'number' ? dbUser.points : 0,
    shopItems: dbUser && dbUser.shopItems && typeof dbUser.shopItems === 'object' ? dbUser.shopItems : {},
    level: dbUser ? getMemberLevel(dbUser) : MEMBER_LEVEL_MIN,
    walletAddress: (dbUser && dbUser.walletAddress && dbUser.walletAddress !== REGISTER_NO_WALLET) ? dbUser.walletAddress : null,
  };
  res.json({ ok: true, user });
}
app.get('/api/me', handleGetMe);

// 프로필 사진 업로드
app.post('/api/me/avatar', rateLimitWrites, authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  uploadProfileAvatar(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '프로필 사진은 1MB 이하로 선택해 주세요.' : (err.message || '프로필 사진은 1MB 이하, JPG/PNG/GIF/WEBP만 가능합니다.');
      return res.status(400).json({ ok: false, message: msg });
    }
    if (!req.file || !req.file.filename) return res.status(400).json({ ok: false, message: '사진을 선택해 주세요.' });
    const ext = path.extname(req.file.filename).toLowerCase();
    if (req.file.path && !validateImageMagic(req.file.path, ext)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ ok: false, message: '이미지 파일이 올바르지 않습니다. (허용: JPG, PNG, GIF, WEBP)' });
    }
    const profileImageUrl = '/uploads/profile/' + req.file.filename;
    const users = await db.readUsers();
    const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
    if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
    users[idx].profileImageUrl = profileImageUrl;
    await db.writeUsers(users);
    const sess = sessions.get(req.signedCookies?.session);
    if (sess) sess.profileImageUrl = profileImageUrl;
    res.json({ ok: true, message: '프로필 사진이 변경되었습니다.', profileImageUrl });
  });
});

// 개인 회원 정보 수정 (닉네임, 비밀번호, 자기소개, 지갑 제거) — 커뮤니티 전용
app.patch('/api/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const { displayName, password, bio, walletAddress } = req.body || {};
  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });

  if (displayName !== undefined) {
    const nameRaw = String(displayName).trim();
    if (!nameRaw) return res.status(400).json({ ok: false, message: '닉네임을 입력해 주세요.' });
    if (!isNicknameValid(nameRaw)) return res.status(400).json({ ok: false, message: '닉네임은 영문, 숫자만 5~12자까지 가능합니다.' });
    const me = users[idx];
    const lastChanged = me.lastDisplayNameChangedAt ? new Date(me.lastDisplayNameChangedAt).getTime() : 0;
    const inCooldown = lastChanged && Date.now() - lastChanged < NICKNAME_CHANGE_COOLDOWN_MS;
    if (inCooldown) {
        const nextAt = new Date(lastChanged + NICKNAME_CHANGE_COOLDOWN_MS);
      return res.status(400).json({ ok: false, message: '닉네임은 14일에 한 번만 변경할 수 있습니다.', nextChangeAt: nextAt.toISOString() });
    }
    const nameLower = nameRaw.toLowerCase();
    const duplicate = users.some((u) => u.id !== me.id && u.displayName && u.displayName.toLowerCase() === nameLower);
    if (duplicate) return res.status(409).json({ ok: false, message: '이미 사용 중인 닉네임입니다.' });
    users[idx].displayName = nameRaw;
    users[idx].lastDisplayNameChangedAt = new Date().toISOString();
    const sess = sessions.get(req.signedCookies?.session);
    if (sess) sess.displayName = nameRaw;
  }

  if (password !== undefined) {
    const pwd = String(password);
    if (!isPasswordStrong(pwd)) return res.status(400).json({ ok: false, message: '비밀번호는 8자 이상이며, 영문과 숫자를 모두 포함해야 합니다. (특수문자 사용 시 더 안전합니다)' });
    users[idx].passwordHash = bcrypt.hashSync(pwd, 10);
  }

  if (bio !== undefined) {
    const bioStr = typeof bio === 'string' ? bio.trim().slice(0, 100) : '';
    users[idx].bio = bioStr;
  }

  if (walletAddress !== undefined) {
    if (walletAddress === null || walletAddress === '') {
      users[idx].walletAddress = REGISTER_NO_WALLET;
      users[idx].level = MEMBER_LEVEL_MIN;
    }
  }

  if (displayName === undefined && password === undefined && bio === undefined && walletAddress === undefined) return res.status(400).json({ ok: false, message: '변경할 항목을 보내 주세요.' });

  await db.writeUsers(users);
  const updated = users[idx];
  res.json({
    ok: true,
    message: '저장되었습니다.',
    user: {
      id: updated.id,
      displayName: updated.displayName,
      walletAddress: updated.walletAddress === REGISTER_NO_WALLET ? null : updated.walletAddress,
      profileImageUrl: updated.profileImageUrl || null,
      bio: updated.bio != null ? updated.bio : '',
      points: typeof updated.points === 'number' ? updated.points : 0,
      level: getMemberLevel(updated),
    },
  });
});

// 내 정보: 지갑 주소 인증 (선택) — 검증 통과 시 지갑·회원 등급 반영
app.post('/api/me/verify-wallet', authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const walletRaw = String(req.body?.walletAddress ?? '').trim();
  if (!walletRaw) return res.status(400).json({ ok: false, message: '지갑 주소를 입력해 주세요.' });

  const normalized = validateAndNormalizeEthAddress(walletRaw);
  if (!normalized) return res.status(400).json({ ok: false, message: '유효한 이더리움 지갑 주소가 아닙니다.' });

  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });

  const forceWithdraws = await db.readForceWithdraws();
  if (forceWithdraws.some((e) => e.walletAddress && e.walletAddress.toLowerCase() === normalized.toLowerCase())) {
    return res.status(403).json({ ok: false, message: '탈퇴 처리된 지갑은 등록할 수 없습니다.' });
  }

  const ageCheck = await checkWalletAgeAndStake(normalized);
  if (!ageCheck.allowed) {
    return res.status(403).json({ ok: false, message: ageCheck.reason || '지갑 조건을 만족하지 않습니다.' });
  }

  const memberWalletSet = new Set(
    users
      .filter((u) => u.id !== users[idx].id && u.walletAddress && u.managementAccount !== true && !u.isFake)
      .map((u) => u.walletAddress.toLowerCase())
  );
  const transferCheck = await checkTransferNetwork(normalized, memberWalletSet);
  if (transferCheck.block) {
    return res.status(403).json({ ok: false, message: '최근 30일 내 기존 회원 지갑과 거래 이력이 있어 등록할 수 없습니다.' });
  }

  const { staking: hasStaking, lockedBalance: lockedStr, error: stakingError } = await checkTornStaking(normalized);
  if (stakingError) {
    return res.status(502).json({ ok: false, message: '스테이킹 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  const lockedNum = parseFloat(formatUnits(lockedStr || '0', TORN_DECIMALS), 10);
  if (!hasStaking || lockedNum <= 0) {
    return res.status(403).json({ ok: false, message: 'TORN 스테이킹이 있는 지갑만 등록할 수 있습니다.' });
  }

  const existingByWallet = users.find((u) => u.id !== users[idx].id && u.walletAddress && u.walletAddress.toLowerCase() === normalized.toLowerCase());
  if (existingByWallet) {
    return res.status(409).json({ ok: false, message: '이미 다른 계정에서 등록된 지갑 주소입니다.' });
  }

  users[idx].walletAddress = normalized;
  users[idx].level = stakedAmountToLevel(lockedNum);
  await db.writeUsers(users);

  const updatedUser = users[idx];
  res.json({
    ok: true,
    message: '지갑이 인증되었습니다. 회원 등급이 반영되었습니다.',
    user: {
      id: updatedUser.id,
      displayName: updatedUser.displayName,
      walletAddress: updatedUser.walletAddress,
      profileImageUrl: updatedUser.profileImageUrl || null,
      bio: updatedUser.bio != null ? updatedUser.bio : '',
      points: typeof updatedUser.points === 'number' ? updatedUser.points : 0,
      level: getMemberLevel(updatedUser),
    },
  });
});

// 실시간 채팅 — 조회(비로그인 가능, 전체 메시지 실시간 반영), 전송(로그인 필요)
// 아이템(shopItems)·하트: 세션/로컬 사용 금지. data/users.json(또는 MongoDB) 단일 출처, readUsersFresh로 항상 최신 반영
app.get('/api/chat', async (req, res) => {
  const messages = await db.readChatMessages();
  const users = await db.readUsersFresh();
  const enriched = messages.map((m) => {
    const u = m.userId ? users.find((u) => u.id === m.userId) : null;
    const profileImageUrl = (u && u.profileImageUrl) ? u.profileImageUrl : null;
    const level = u ? getMemberLevel(u) : null;
    const isAdmin = !!(u && (u.levelAdmin || u.boardAdmin));
    return { ...m, profileImageUrl, level, isAdmin };
  });
  const payload = { ok: true, messages: enriched };
  const pinned = await db.readPinned();
  if (pinned && typeof pinned.text === 'string') {
    const setByUser = pinned.setByUserId ? users.find((u) => u.id === pinned.setByUserId) : null;
    const level = setByUser ? getMemberLevel(setByUser) : null;
    payload.pinned = { text: pinned.text, setByDisplayName: pinned.setByDisplayName || null, expiresAt: pinned.expiresAt, level };
  } else {
    payload.pinned = null;
  }
  if (pinned && pinned.lastItemUse && pinned.lastItemUse.at) {
    const at = new Date(pinned.lastItemUse.at).getTime();
    if (Date.now() - at < 15000) payload.lastItemUse = { displayName: pinned.lastItemUse.displayName, itemId: pinned.lastItemUse.itemId, at: pinned.lastItemUse.at };
  }
  if (req.user) {
    const me = users.find((u) => String(u.id) === String(req.user.id));
    payload.me = me ? { id: me.id, displayName: me.displayName || '' } : { id: req.user.id, displayName: req.user.displayName || '' };
    payload.myHearts = typeof me?.points === 'number' ? me.points : 0;
    payload.myShopItems = me?.shopItems && typeof me.shopItems === 'object' ? me.shopItems : {};
    res.setHeader('X-Chat-Auth', req.user.id || '1');
  } else {
    res.setHeader('X-Chat-Auth', '0');
  }
  res.json(payload);
});

app.post('/api/chat', rateLimitWrites, authMiddleware, function (req, res) {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인 후 채팅할 수 있습니다.' });
  uploadChatImage(req, res, async function (err) {
    if (err) return res.status(400).json({ ok: false, message: err.message || '이미지 업로드에 실패했습니다.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const hasImage = req.file && req.file.filename;
    if (hasImage && req.file.path) {
      const ext = path.extname(req.file.filename).toLowerCase();
      if (!validateImageMagic(req.file.path, ext)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({ ok: false, message: '이미지 파일이 올바르지 않습니다. (허용: JPG, PNG, GIF, WEBP)' });
      }
    }
    if (!text && !hasImage) return res.status(400).json({ ok: false, message: '메시지 또는 사진을 입력해 주세요.' });
    if (text.length > 500) return res.status(400).json({ ok: false, message: '메시지는 500자 이내로 입력해 주세요.' });
    const imageUrl = hasImage ? '/uploads/chat/' + req.file.filename : undefined;
    const replyToMessageId = typeof req.body?.replyToMessageId === 'string' ? req.body.replyToMessageId.trim() || undefined : undefined;
    const replyToText = typeof req.body?.replyToText === 'string' ? req.body.replyToText.trim().slice(0, 100) : undefined;
    const added = await db.appendChatMessage({
      userId: req.user.id,
      displayName: req.user.displayName || (req.user.walletAddress ? req.user.walletAddress.slice(0, 6) + '...' : '회원'),
      text,
      imageUrl,
      replyToMessageId,
      replyToText,
    });
    res.json({ ok: true, message: added });
  });
});

// 상단 고정 메시지 설정 — pinMessage 아이템 1개 소모, 1시간 유효
app.post('/api/chat/set-pinned', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  if (checkChatItemCooldown(req, res)) return;
  const pinnedText = typeof req.body?.pinnedText === 'string' ? req.body.pinnedText.trim().slice(0, 25) : '';
  if (!pinnedText) return res.status(400).json({ ok: false, message: '고정할 메시지를 입력해 주세요.' });
  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const current = users[idx].shopItems && typeof users[idx].shopItems.pinMessage === 'number' ? users[idx].shopItems.pinMessage : 0;
  if (current < 1) return res.status(400).json({ ok: false, message: '상단 고정 메시지 아이템이 부족합니다.' });
  users[idx].shopItems.pinMessage = current - 1;
  if (!users[idx].shopItems) users[idx].shopItems = {};
  await db.writeUsers(users);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const setByDisplayName = req.user.displayName || (req.user.walletAddress ? req.user.walletAddress.slice(0, 6) + '...' : '회원');
  setChatItemCooldown(req.user.id);
  await db.writePinned({
    text: pinnedText,
    setByUserId: req.user.id,
    setByDisplayName,
    expiresAt,
    lastItemUse: { displayName: setByDisplayName, itemId: 'pinMessage', at: new Date().toISOString() },
  });
  const me = (await db.readUsers()).find((u) => String(u.id) === String(req.user.id));
  const level = me ? getMemberLevel(me) : null;
  res.json({ ok: true, message: '상단 고정 메시지가 적용되었습니다. (1시간 유효)', myShopItems: me?.shopItems || {}, pinned: { text: pinnedText, setByDisplayName: me?.displayName || null, expiresAt, level } });
});

// 리워드 파티 아이템 사용 — 하트 1 + rewardParty 1개 소모, lastItemUse 브로드캐스트(채팅 애니메이션)
app.post('/api/chat/use-reward-party', async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  if (checkChatItemCooldown(req, res)) return;
    const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const points = typeof users[idx].points === 'number' ? users[idx].points : 0;
  if (points < 1) return res.status(400).json({ ok: false, message: '하트가 부족합니다.' });
  const current = users[idx].shopItems && typeof users[idx].shopItems.rewardParty === 'number' ? users[idx].shopItems.rewardParty : 0;
  if (current < 1) return res.status(400).json({ ok: false, message: '리워드 파티 아이템이 부족합니다.' });
  setChatItemCooldown(req.user.id);
  users[idx].points = points - 1;
  if (!users[idx].shopItems) users[idx].shopItems = {};
  users[idx].shopItems.rewardParty = current - 1;
  await db.writeUsers(users);
  const pinned = await db.readPinned() || {};
  pinned.lastItemUse = {
    displayName: req.user.displayName || (req.user.walletAddress ? req.user.walletAddress.slice(0, 6) + '...' : '회원'),
    itemId: 'rewardParty',
    at: new Date().toISOString(),
  };
  await db.writePinned(pinned);
  const me = (await db.readUsers()).find((u) => String(u.id) === String(req.user.id));
  req.session.save((err) => {
    if (err) {
      console.error('[chat/use-reward-party] session.save err', err);
      return res.status(500).json({ ok: false, message: '세션 저장에 실패했습니다.' });
    }
    res.json({ ok: true, message: '리워드 파티를 사용했습니다.', myHearts: me?.points ?? 0, myShopItems: me?.shopItems || {} });
  });
});

// 떡상 기원 아이템 사용 — 하트 1 + risePrayer 1개 소모, lastItemUse 브로드캐스트(채팅 애니메이션)
app.post('/api/chat/use-rise-prayer', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  if (checkChatItemCooldown(req, res)) return;
  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const points = typeof users[idx].points === 'number' ? users[idx].points : 0;
  if (points < 1) return res.status(400).json({ ok: false, message: '하트가 부족합니다.' });
  const current = users[idx].shopItems && typeof users[idx].shopItems.risePrayer === 'number' ? users[idx].shopItems.risePrayer : 0;
  if (current < 1) return res.status(400).json({ ok: false, message: '떡상 기원 아이템이 부족합니다.' });
  setChatItemCooldown(req.user.id);
  users[idx].points = points - 1;
  if (!users[idx].shopItems) users[idx].shopItems = {};
  users[idx].shopItems.risePrayer = current - 1;
  await db.writeUsers(users);
  const pinned = await db.readPinned() || {};
  pinned.lastItemUse = {
    displayName: req.user.displayName || (req.user.walletAddress ? req.user.walletAddress.slice(0, 6) + '...' : '회원'),
    itemId: 'risePrayer',
    at: new Date().toISOString(),
  };
  await db.writePinned(pinned);
  const me = (await db.readUsers()).find((u) => String(u.id) === String(req.user.id));
  req.session.save((err) => {
    if (err) {
      console.error('[chat/use-rise-prayer] session.save err', err);
      return res.status(500).json({ ok: false, message: '세션 저장에 실패했습니다.' });
    }
    res.json({ ok: true, message: '떡상 기원을 사용했습니다.', myHearts: me?.points ?? 0, myShopItems: me?.shopItems || {} });
  });
});

// 빗자루 아이템 사용 — broom 1개 소모, lastItemUse 브로드캐스트 후 5초 뒤 채팅 메시지 전체 삭제(고정 메시지는 유지)
const BROOM_CLEAR_DELAY_MS = 5000;
app.post('/api/chat/use-broom', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  if (checkChatItemCooldown(req, res)) return;
  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const current = users[idx].shopItems && typeof users[idx].shopItems.broom === 'number' ? users[idx].shopItems.broom : 0;
  if (current < 1) return res.status(400).json({ ok: false, message: '빗자루 아이템이 부족합니다.' });
  setChatItemCooldown(req.user.id);
  if (!users[idx].shopItems) users[idx].shopItems = {};
  users[idx].shopItems.broom = current - 1;
  await db.writeUsers(users);
  const pinned = await db.readPinned() || {};
  pinned.lastItemUse = {
    displayName: req.user.displayName || (req.user.walletAddress ? req.user.walletAddress.slice(0, 6) + '...' : '회원'),
    itemId: 'broom',
    at: new Date().toISOString(),
  };
  await db.writePinned(pinned);
  setTimeout(() => {
    db.clearChatMessages().catch(() => {});
  }, BROOM_CLEAR_DELAY_MS);
  const me = (await db.readUsers()).find((u) => String(u.id) === String(req.user.id));
  req.session.save((err) => {
    if (err) {
      console.error('[chat/use-broom] session.save err', err);
      return res.status(500).json({ ok: false, message: '세션 저장에 실패했습니다.' });
    }
    res.json({ ok: true, message: '빗자루를 사용했습니다. 잠시 후 채팅이 비워집니다.', myHearts: me?.points ?? 0, myShopItems: me?.shopItems || {} });
  });
});

// 채팅 메시지 수정 — 본인만 수정 가능
app.patch('/api/chat/:messageId', rateLimitWrites, async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const messageId = String(req.params.messageId || '').trim();
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
  if (!messageId || !text) return res.status(400).json({ ok: false, message: '메시지 ID와 수정할 내용을 보내 주세요.' });
  const updated = await db.updateChatMessage(messageId, req.user.id, { text });
  if (!updated) return res.status(403).json({ ok: false, message: '본인의 메시지만 수정할 수 있습니다.' });
  res.json({ ok: true, message: updated });
});

// 채팅 메시지 삭제 — 본인만 삭제 가능
app.delete('/api/chat/:messageId', rateLimitWrites, async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const messageId = String(req.params.messageId || '').trim();
  if (!messageId) return res.status(400).json({ ok: false, message: '메시지 ID가 필요합니다.' });
  const deleted = await db.deleteChatMessage(messageId, req.user.id);
  if (!deleted) return res.status(403).json({ ok: false, message: '본인의 메시지만 삭제할 수 있습니다.' });
  res.json({ ok: true, message: '삭제되었습니다.' });
});

// 방청소 — 로그인 사용자만 전체 채팅 삭제
app.delete('/api/chat', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인 후 이용할 수 있습니다.' });
  await db.clearChatMessages();
  res.json({ ok: true, message: '채팅이 비워졌습니다.' });
});

// 채팅 메시지에 하트 보내기 — 로그인 필요, 본인 메시지에는 불가, 1개 차감 후 수신자에게 지급
app.post('/api/chat/:messageId/send-heart', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인 후 하트를 보낼 수 있습니다.' });
  const messageId = String(req.params.messageId || '').trim();
  const amount = Math.max(1, Math.min(100, parseInt(req.body?.amount, 10) || 1));
  if (!messageId) return res.status(400).json({ ok: false, message: '메시지 ID가 필요합니다.' });
  const messages = await db.readChatMessages();
  const msg = messages.find((m) => m.id === messageId);
  if (!msg || !msg.userId) return res.status(404).json({ ok: false, message: '메시지를 찾을 수 없습니다.' });
  if (String(msg.userId) === String(req.user.id)) return res.status(400).json({ ok: false, message: '본인 메시지에는 하트를 보낼 수 없습니다.' });
  const users = await db.readUsers();
  const senderIdx = users.findIndex((u) => String(u.id) === String(req.user.id));
  const recipientIdx = users.findIndex((u) => String(u.id) === String(msg.userId));
  if (senderIdx === -1 || recipientIdx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const senderPoints = typeof users[senderIdx].points === 'number' ? users[senderIdx].points : 0;
  if (senderPoints < amount) return res.status(400).json({ ok: false, message: '보유 하트가 부족합니다.' });
  users[senderIdx].points = senderPoints - amount;
  const recipientPoints = typeof users[recipientIdx].points === 'number' ? users[recipientIdx].points : 0;
  users[recipientIdx].points = recipientPoints + amount;
  await db.writeUsers(users);
  await db.incrementMessageHearts(messageId);
  req.session.save((err) => {
    if (err) {
      console.error('[chat/send-heart] session.save err', err);
      return res.status(500).json({ ok: false, message: '세션 저장에 실패했습니다.' });
    }
    res.json({ ok: true, myHearts: users[senderIdx].points, message: '하트를 보냈습니다.' });
  });
});

// 상점: 하트로 채팅 아이템 교환
const SHOP_ITEMS = {
  pinMessage: { cost: 15, name: '상단 고정 메시지' },
  rewardParty: { cost: 1, name: '리워드 파티' },
  risePrayer: { cost: 1, name: '떡상 기원' },
  broom: { cost: 10, name: '빗자루' },
};
app.post('/api/shop/exchange', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const { itemId, quantity: rawQty = 1 } = req.body || {};
  const quantity = Math.min(5, Math.max(1, parseInt(rawQty, 10) || 1));
  const item = itemId && SHOP_ITEMS[itemId];
  if (!item) return res.status(400).json({ ok: false, message: '유효하지 않은 아이템입니다.' });
  const totalCost = item.cost * quantity;
  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const currentPoints = typeof users[idx].points === 'number' ? users[idx].points : 0;
  if (currentPoints < totalCost) return res.status(400).json({ ok: false, message: '보유 하트가 부족합니다.' });
  const currentOwned = typeof users[idx].shopItems?.[itemId] === 'number' ? users[idx].shopItems[itemId] : 0;
  if (currentOwned + quantity > 5) return res.status(400).json({ ok: false, message: '이 아이템은 종류당 최대 5개까지 보유할 수 있습니다.' });
  users[idx].points = currentPoints - totalCost;
  if (!users[idx].shopItems) users[idx].shopItems = {};
  users[idx].shopItems[itemId] = currentOwned + quantity;

  await db.writeUsers(users);

  // 세션에 뭔가 추가 정보를 넣지 말고, 그냥 저장만 확실히 함 (req.login 호출 없음 — 다음 요청 시 deserializeUser가 DB에서 최신 정보 읽음)
  req.session.save((err) => {
    if (err) {
      console.error('세션 저장 에러:', err);
      return res.status(500).json({ ok: false, message: '세션 저장 실패' });
    }
    return res.json({ ok: true, message: item.name + ' ' + quantity + '개를 구매했습니다.', myHearts: users[idx].points, myShopItems: users[idx].shopItems });
  });
});

// 랭킹: 하트(포인트) 많은 순 (공개, 승인된 회원만)
app.get('/api/ranking/hearts', async (req, res) => {
  const allUsers = await db.readUsers();
  const users = allUsers
    .filter((u) => u.approved !== false && !u.managementAccount && !u.isFake)
    .map((u) => ({ displayName: u.displayName || '-', hearts: typeof u.points === 'number' ? u.points : 0 }))
    .sort((a, b) => b.hearts - a.hearts)
    .slice(0, 100)
    .map((item, i) => ({ rank: i + 1, displayName: item.displayName, hearts: item.hearts }));
  res.json({ ok: true, list: users });
});

// 랭킹: 스테이킹 많은 순 (공개, RPC 조회 후 정렬, 2분 캐시)
let rankingStakingCache = null;
let rankingStakingCacheTime = 0;
const RANKING_STAKING_CACHE_MS = 2 * 60 * 1000;

app.get('/api/ranking/staking', async (req, res) => {
  const now = Date.now();
  if (rankingStakingCache && now - rankingStakingCacheTime < RANKING_STAKING_CACHE_MS) {
    return res.json({ ok: true, list: rankingStakingCache });
  }
  const users = (await db.readUsers()).filter((u) => u.approved !== false && !u.managementAccount && u.walletAddress && !u.isFake);
  const BATCH = 5;
  const results = [];
  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    const pairs = await Promise.all(
      batch.map(async (u) => {
        const { lockedBalance } = await checkTornStaking(u.walletAddress);
        const staked = parseFloat(formatUnits(lockedBalance || '0', TORN_DECIMALS));
        return { displayName: u.displayName || '-', staked };
      })
    );
    results.push(...pairs);
  }
  const list = results
    .sort((a, b) => b.staked - a.staked)
    .slice(0, 100)
    .map((item, i) => ({ rank: i + 1, displayName: item.displayName, staked: Math.round(item.staked * 100) / 100 }));
  rankingStakingCache = list;
  rankingStakingCacheTime = now;
  res.json({ ok: true, list });
});

// 출석체크: 오늘 날짜 (KST)
function getTodayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function getYesterdayKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function padNum(n) { return n < 10 ? '0' + n : String(n); }
function getDateStringsInMonth(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const arr = [];
  for (let d = 1; d <= lastDay; d++) arr.push(year + '-' + padNum(month) + '-' + padNum(d));
  return arr;
}

// 출석체크: 내 상태 + 꾸준히 출석한 멤버 목록
app.get('/api/attendance', async (req, res) => {
  const today = getTodayKST();
  const users = (await db.readUsers()).filter((u) => u.approved !== false && !u.managementAccount && !u.isFake);
  const me = req.user ? users.find((u) => String(u.id) === String(req.user.id)) : null;
  let todayChecked = false;
  let streak = 0;
  let lastDate = null;
  let myHearts = 0;
  if (me) {
    lastDate = me.lastAttendanceDate || null;
    todayChecked = lastDate === today;
    streak = typeof me.attendanceStreak === 'number' ? me.attendanceStreak : 0;
    if (todayChecked && streak < 1) streak = 1;
    myHearts = typeof me.points === 'number' ? me.points : 0;
  }
  const leaderboard = users
    .filter((u) => (u.lastAttendanceDate && (typeof u.attendanceStreak === 'number' ? u.attendanceStreak : 0) > 0))
    .map((u) => ({ displayName: u.displayName || '-', streak: u.attendanceStreak || 0 }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 15);
  const attendanceHistory = me && Array.isArray(me.attendanceHistory) ? me.attendanceHistory.slice(-90) : [];
  res.json({
    ok: true,
    today,
    todayChecked,
    streak,
    lastDate,
    myHearts,
    rewards: { daily: 1, weekBonus: 7, monthFullBonus: 30 },
    leaderboard,
    attendanceHistory,
  });
});

// 출석체크: 체크인 (하루 1회, 연속 시 보너스)
app.post('/api/attendance', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인 후 출석할 수 있습니다.' });
  const today = getTodayKST();
  const yesterday = getYesterdayKST();
  const users = await db.readUsers();
  const idx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다.' });
  const u = users[idx];
  if (u.approved === false || u.managementAccount || u.isFake) return res.status(403).json({ ok: false, message: '출석 대상이 아닙니다.' });
  if (u.lastAttendanceDate === today) return res.status(400).json({ ok: false, message: '오늘 이미 출석했습니다.' });
  let streak = typeof u.attendanceStreak === 'number' ? u.attendanceStreak : 0;
  if (u.lastAttendanceDate === yesterday) streak += 1;
  else streak = 1;
  let granted = 1;
  if (streak >= 7) granted += 7;
  const currentPoints = typeof u.points === 'number' ? u.points : 0;
  const history = Array.isArray(users[idx].attendanceHistory) ? users[idx].attendanceHistory : [];
  if (!history.includes(today)) history.push(today);
  const historySet = new Set(history.slice(-90));

  const lastMonthFullBonusGiven = users[idx].lastMonthFullBonusGiven || null;
  const [y, m] = today.split('-').map(Number);
  const lastMonthKey = m === 1 ? (y - 1) + '-12' : y + '-' + padNum(m - 1);
  const lastMonthY = m === 1 ? y - 1 : y;
  const lastMonthM = m === 1 ? 12 : m - 1;
  const datesInLastMonth = getDateStringsInMonth(lastMonthY, lastMonthM);
  const lastMonthFull = datesInLastMonth.length > 0 && datesInLastMonth.every((d) => historySet.has(d));
  if (lastMonthFull && lastMonthFullBonusGiven !== lastMonthKey) {
    granted += 30;
    users[idx].lastMonthFullBonusGiven = lastMonthKey;
  }

  users[idx].attendanceHistory = history.slice(-90);
  users[idx].lastAttendanceDate = today;
  users[idx].attendanceStreak = streak;
  users[idx].points = currentPoints + granted;
  await db.writeUsers(users);

  const bonus = granted - 1;
  let message = '출석 완료! 하트 1개 지급되었습니다.';
  if (granted > 1) {
    if (lastMonthFull && lastMonthFullBonusGiven !== lastMonthKey) message = `출석 완료! 한 달 연속 보너스 포함 하트 ${granted}개 지급되었습니다.`;
    else message = `출석 완료! 연속 ${streak}일 보너스로 하트 ${granted}개 지급되었습니다.`;
  }
  req.session.save((err) => {
    if (err) {
      console.error('[attendance] session.save err', err);
      return res.status(500).json({ ok: false, message: '세션 저장에 실패했습니다.' });
    }
    res.json({
      ok: true,
      message,
      granted,
      streak,
      myHearts: users[idx].points,
      bonus: bonus > 0 ? bonus : undefined,
    });
  });
});

// (포인트/송금/교환 제거 — 커뮤니티 전용)

async function adminOnlyMiddleware(req, res, next) {
  try {
    if (!req.user) {
      return res.status(403).json({ ok: false, message: '관리자만 이용할 수 있습니다.' });
    }
    // 세션 로드가 늦을 수 있으므로 req.user.isAdmin과 req.session.isAdmin 둘 다 확인
    if (req.user.isAdmin === true || req.session?.isAdmin === true) {
      req.user.isAdmin = true;
      return next();
    }
    const users = await db.readUsers();
    const dbUser = users.find((u) => String(u.id) === String(req.user.id));
    if (dbUser && dbUser.boardAdmin === true) {
      req.user.isAdmin = true;
      return next();
    }
    return res.status(403).json({ ok: false, message: '관리자만 이용할 수 있습니다.' });
  } catch (e) {
    next(e);
  }
}

function adminMiddleware(req, res, next) {
  adminOnlyMiddleware(req, res, function () {
    const pinOk = req.user.adminPinVerified === true;
    if (pinOk) return next();
    return res.status(403).json({ ok: false, needPin: true, message: '관리자 비밀번호를 입력해 주세요.' });
  });
}

// 관리자: 진입 상태 (비밀번호 검증 여부)
app.get('/api/admin/status', adminOnlyMiddleware, (req, res) => {
  res.json({ ok: true, pinVerified: req.user.adminPinVerified === true });
});

// 관리자: 6자리 비밀번호 검증 후 진입 (5회 실패 시 15분 잠금)
app.post('/api/admin/verify-pin', adminOnlyMiddleware, async (req, res) => {
  const ip = getClientIp(req);
  if (adminPinLocked(ip)) {
    return res.status(403).json({
      ok: false,
      message: '비밀번호를 5회 잘못 입력하여 15분간 잠깁니다. 잠시 후 다시 시도해 주세요.',
      locked: true,
    });
  }
  const pin = String(req.body?.pin || '').trim();
  if (!ADMIN_PIN_REGEX.test(pin)) {
    return res.status(400).json({ ok: false, message: '비밀번호는 숫자 6자리로 입력해 주세요.' });
  }
  const pinHash = await db.readAdminPinHash();
  if (!bcrypt.compareSync(pin, pinHash)) {
    adminPinRecordFailure(ip);
    const rec = adminPinFailedAttempts.get(ip);
    const remaining = rec && rec.lockedUntil ? 0 : Math.max(0, ADMIN_PIN_MAX_ATTEMPTS - (rec?.count || 0));
    return res.status(403).json({
      ok: false,
      message: remaining > 0
        ? `비밀번호가 올바르지 않습니다. (${remaining}회 남음)`
        : '비밀번호를 5회 잘못 입력하여 15분간 잠깁니다.',
      locked: remaining === 0,
    });
  }
  adminPinRecordSuccess(ip);
  const token = req.sessionToken;
  if (token && sessions.has(token)) {
    const sess = sessions.get(token);
    sess.adminPinVerified = true;
    sessions.set(token, sess);
    if (typeof db.setSession === 'function') await db.setSession(token, sess);
  }
  // express-session에 강제 반영 (Passport 사용자 등): 핀 인증 직후 반드시 save 후 응답
  if (req.session) {
    req.session.isAdmin = true;
    req.session.adminPinVerified = true;
    req.session.save((err) => {
      if (err) console.error('[admin/verify-pin] session.save err', err);
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

// 관리자: 6자리 비밀번호 변경 (관리 페이지 내에서만)
app.post('/api/admin/change-pin', adminMiddleware, async (req, res) => {
  const currentPin = String(req.body?.currentPin || '').trim();
  const newPin = String(req.body?.newPin || '').trim();
  if (!ADMIN_PIN_REGEX.test(currentPin)) {
    return res.status(400).json({ ok: false, message: '현재 비밀번호를 숫자 6자리로 입력해 주세요.' });
  }
  if (!ADMIN_PIN_REGEX.test(newPin)) {
    return res.status(400).json({ ok: false, message: '새 비밀번호는 숫자 6자리로 입력해 주세요.' });
  }
  const pinHash = await db.readAdminPinHash();
  if (!bcrypt.compareSync(currentPin, pinHash)) {
    return res.status(403).json({ ok: false, message: '현재 비밀번호가 올바르지 않습니다.' });
  }
  const newHash = bcrypt.hashSync(newPin, 10);
  await db.writeAdminPinHash(newHash);
  res.json({ ok: true, message: '관리자 비밀번호가 변경되었습니다.' });
});

// 관리자: 승인 대기 목록
app.get('/api/admin/pending-users', adminMiddleware, async (req, res) => {
  const users = await db.readUsers();
  const pending = users
    .filter((u) => u.approved === false)
    .map((u) => ({
      id: u.id,
      displayName: u.displayName,
      walletAddress: u.walletAddress,
      referrer: u.referrer || null,
      createdAt: u.createdAt,
    }));
  res.json({ ok: true, users: pending });
});

// 관리자: 회원 승인
app.post('/api/admin/approve/:userId', adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const users = await db.readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  users[idx].approved = true;
  users[idx].approvedAt = new Date().toISOString();
  users[idx].approvedBy = req.user.id;
  await db.writeUsers(users);
  res.json({ ok: true, message: '승인되었습니다.' });
});

// 관리자: 가입 신청 거부 (승인 대기 회원 삭제, 해당 지갑은 재가입 가능)
app.post('/api/admin/reject/:userId', adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const users = await db.readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  const target = users[idx];
  if (target.approved !== false) {
    return res.status(400).json({ ok: false, message: '승인 대기 중인 회원만 거부할 수 있습니다.' });
  }
  if (target.managementAccount === true) {
    return res.status(400).json({ ok: false, message: '관리 계정은 거부할 수 없습니다.' });
  }
  users.splice(idx, 1);
  await db.writeUsers(users);
  res.json({ ok: true, message: '가입 신청이 거부되었습니다. 해당 사용자는 다시 가입할 수 있습니다.' });
});

// 관리자: 전체 회원 목록 (포인트, 등급 포함). ?includeStaking=1 이면 회원별 TORN 스테이킹 수량 조회
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  const includeStaking = req.query.includeStaking === '1' || req.query.includeStaking === 'true';
  const allUsers = await db.readUsers();
  const raw = allUsers.filter((u) => u.approved !== false);
  let users = raw.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      walletAddress: u.walletAddress,
      points: typeof u.points === 'number' ? u.points : 0,
      level: getMemberLevel(u),
      approved: u.approved,
      createdAt: u.createdAt,
      managementAccount: !!u.managementAccount,
      tfiFrozen: !!u.tfiFrozen,
    isFake: !!u.isFake,
    levelAdmin: !!u.levelAdmin,
    boardAdmin: !!u.boardAdmin,
  }));
  if (includeStaking) {
    const FAKE_WALLET = '0x0000000000000000000000000000000000000000';
    const withWallet = users.filter((u) => u.walletAddress && u.walletAddress.toLowerCase() !== FAKE_WALLET.toLowerCase() && !u.isFake);
    const BATCH = 5;
    for (let i = 0; i < withWallet.length; i += BATCH) {
      const batch = withWallet.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (u) => {
          const { lockedBalance } = await checkTornStaking(u.walletAddress);
          const staked = parseFloat(formatUnits(lockedBalance || '0', TORN_DECIMALS));
          return { id: u.id, staked };
        })
      );
      for (const r of results) {
        const u = users.find((x) => x.id === r.id);
        if (u) u.staked = r.staked;
      }
      if (i + BATCH < withWallet.length) await new Promise((r) => setTimeout(r, 200));
    }
    users = users.map((u) => ({ ...u, staked: u.staked != null ? u.staked : null }));
  }
  res.json({ ok: true, users });
});

// 관리자: 가짜 회원 생성 (테스트/목데이터용 — 로그인 불가, 구분 표시)
const FAKE_USER_WALLET = '0x0000000000000000000000000000000000000000';
app.post('/api/admin/users', adminMiddleware, async (req, res) => {
  const displayName = String(req.body?.displayName ?? '').trim();
  if (!displayName) return res.status(400).json({ ok: false, message: '닉네임을 입력해 주세요.' });
  let walletAddress = FAKE_USER_WALLET;
  const walletRaw = String(req.body?.walletAddress ?? '').trim();
  if (walletRaw) {
    const normalized = validateAndNormalizeEthAddress(walletRaw);
    if (!normalized) return res.status(400).json({ ok: false, message: '유효한 이더리움 지갑 주소가 아닙니다.' });
    walletAddress = normalized;
  }
  let level = 1;
  const levelNum = typeof req.body?.level === 'number' ? req.body.level : parseInt(req.body?.level, 10);
  if (Number.isInteger(levelNum) && levelNum >= MEMBER_LEVEL_MIN && levelNum <= MEMBER_LEVEL_MAX) {
    level = levelNum;
  }
  const users = await db.readUsers();
  const displayNameLower = displayName.toLowerCase();
  if (users.some((u) => u.displayName && u.displayName.toLowerCase() === displayNameLower)) {
    return res.status(409).json({ ok: false, message: '이미 사용 중인 닉네임입니다.' });
  }
  if (walletAddress !== FAKE_USER_WALLET && users.some((u) => u.walletAddress && u.walletAddress.toLowerCase() === walletAddress.toLowerCase())) {
    return res.status(409).json({ ok: false, message: '이미 사용 중인 지갑 주소입니다.' });
  }
  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    displayName,
    walletAddress,
    approved: true,
    approvedAt: new Date().toISOString(),
    approvedBy: req.user?.id ?? 'admin',
    createdAt: new Date().toISOString(),
    level,
    isFake: true,
    createdByAdmin: req.user?.id ?? null,
  };
  users.push(user);
  await db.writeUsers(users);
  res.status(201).json({
    ok: true,
    message: '테스트 회원이 생성되었습니다. (로그인 불가, 목록에서 구분 표시)',
    user: { id: user.id, displayName: user.displayName, isFake: true },
  });
});

// 관리자: 회원 삭제 (가짜: DB에서만 제거 / 실제: 강퇴 목록 추가 후 제거)
app.delete('/api/admin/users/:userId', adminMiddleware, async (req, res) => {
  if (req.session && req.session.isAdmin !== true) {
    return res.status(403).json({ ok: false, message: '관리자 세션이 유효하지 않습니다.' });
  }
  if (!req.user || req.user.isAdmin !== true) {
    return res.status(403).json({ ok: false, message: '관리자만 이용할 수 있습니다.' });
  }
  const userId = String(req.params.userId || '').trim();
  if (!userId) return res.status(400).json({ ok: false, message: '회원 ID가 없습니다.' });
  const users = await db.readUsers();
  const target = users.find((u) => String(u.id) === userId);
  if (!target) return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  if (target.managementAccount === true) {
    return res.status(400).json({ ok: false, message: '관리 계정은 삭제할 수 없습니다.' });
  }
  const isFake = !!target.isFake;
  if (!isFake && target.walletAddress) {
    await db.appendForceWithdraw({
      userId: target.id,
      displayName: target.displayName || null,
      walletAddress: target.walletAddress,
      withdrawnAt: new Date().toISOString(),
      withdrawnBy: req.user?.id ?? null,
      withdrawnByDisplayName: req.user?.displayName ?? null,
    });
  }
  const filtered = users.filter((u) => String(u.id) !== userId);
  await db.writeUsers(filtered);
  if (typeof db.deleteSessionsByUserId === 'function') await db.deleteSessionsByUserId(userId);
  for (const [token, sess] of sessions.entries()) {
    if (sess && String(sess.id) === userId) sessions.delete(token);
  }
  res.json({ ok: true, message: isFake ? '테스트 회원이 삭제되었습니다.' : '회원이 삭제되었으며 강퇴 목록에 기록되었습니다.' });
});

// 관리자: 회원 포인트 지급/차감 (delta: 양수=지급, 음수=차감)
app.patch('/api/admin/users/:userId/points', adminMiddleware, async (req, res) => {
  const userId = String(req.params.userId || '').trim();
  const delta = typeof req.body?.delta === 'number' ? Math.round(req.body.delta) : null;
  if (!userId || delta === null) return res.status(400).json({ ok: false, message: 'userId와 delta(숫자)를 보내 주세요.' });
  const users = await db.readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  const current = typeof users[idx].points === 'number' ? users[idx].points : 0;
  const next = Math.max(0, current + delta);
  users[idx].points = next;
  await db.writeUsers(users);
  res.json({ ok: true, points: next, message: '하트가 반영되었습니다.' });
});

// 관리자: TORN 입금 주소 변경
app.get('/api/admin/settings/torn-deposit-address', adminMiddleware, async (req, res) => {
  const settings = await db.readSettings();
  const address = (settings.tornDepositAddress || '').trim() || DEFAULT_TORN_DEPOSIT_ADDRESS;
  res.json({ ok: true, address });
});
app.patch('/api/admin/settings/torn-deposit-address', adminMiddleware, async (req, res) => {
  const { address } = req.body || {};
  const raw = String(address || '').trim();
  if (!raw) return res.status(400).json({ ok: false, message: '주소를 입력해 주세요.' });
  const normalized = validateAndNormalizeEthAddress(raw);
  if (!normalized) return res.status(400).json({ ok: false, message: '유효한 이더리움 주소(0x + 40자 16진수)를 입력해 주세요.' });
  const settings = await db.readSettings();
  settings.tornDepositAddress = normalized;
  await db.writeSettings(settings);
  res.json({ ok: true, address: normalized, message: 'TORN 입금 주소가 저장되었습니다.' });
});

// 관리자: 신규 가입 자동 승인 설정 (기본 true — 인간 개입 최소화)
app.get('/api/admin/settings/auto-approve', adminMiddleware, async (req, res) => {
  const settings = await db.readSettings();
  const autoApproveNewUsers = settings.autoApproveNewUsers !== false;
  res.json({ ok: true, autoApproveNewUsers });
});
app.patch('/api/admin/settings/auto-approve', adminMiddleware, async (req, res) => {
  const v = req.body && req.body.autoApproveNewUsers;
  const autoApproveNewUsers = v === true || v === false ? v : undefined;
  if (autoApproveNewUsers === undefined) {
    return res.status(400).json({ ok: false, message: 'body에 autoApproveNewUsers(true/false)를 보내 주세요.' });
  }
  const settings = await db.readSettings();
  settings.autoApproveNewUsers = autoApproveNewUsers;
  await db.writeSettings(settings);
  res.json({ ok: true, autoApproveNewUsers, message: autoApproveNewUsers ? '신규 가입 자동 승인 사용 중입니다.' : '신규 가입은 관리자 승인 후 로그인됩니다.' });
});

// 관리자: 총 발행량/유통량 설정 (포인트·환전 제거로 미사용 — 스텁)
app.get('/api/admin/settings/total-supply', adminMiddleware, (_req, res) => {
  res.json({ ok: true, totalSupply: null, circulation: null });
});

// 관리자: TORN 담보 지갑 잔액 조회 (포인트·환전 제거로 미사용 — 스텁)
app.get('/api/admin/torn-reserve-balance', adminMiddleware, (_req, res) => {
  res.json({ ok: false, message: '해당 기능은 비활성화되었습니다.' });
});

// 관리자: TFI 거래 전송 완료 처리 (포인트·환전 제거로 미사용 — 스텁)
app.patch('/api/admin/tfi-transactions/:txId/status', adminMiddleware, (req, res) => {
  res.status(410).json({ ok: false, message: '해당 기능은 비활성화되었습니다.' });
});

// 이더스캔 API V2: 지정 주소의 TORN 토큰 입출금 내역 (ERC-20 tokentx). 배당 계산기와 동일 키 사용(환경변수로 덮어쓰기 가능)
const ETHERSCAN_API_KEY_DEFAULT = 'DSPENWH1HPF4H8P3WZNM6HCFT3G4238JM6'; // 배당 계산기(index/calculator)와 동일
function fetchEtherscanTornTransfers(address) {
  return new Promise((resolve) => {
    const normalized = validateAndNormalizeEthAddress(address);
    if (!normalized) {
      return resolve({ ok: false, message: '유효한 주소가 아닙니다.', entries: [] });
    }
    const apiKey = (process.env.ETHERSCAN_API_KEY || '').trim() || ETHERSCAN_API_KEY_DEFAULT;
    const params = new URLSearchParams({
      chainid: '1',
      module: 'account',
      action: 'tokentx',
      address: normalized,
      contractaddress: TORN_TOKEN_ADDRESS,
      page: '1',
      offset: '100',
      sort: 'desc',
    });
    if (apiKey) params.set('apikey', apiKey);
    const pathQuery = '/v2/api?' + params.toString();
    const req = https.get(
      { hostname: 'api.etherscan.io', path: pathQuery },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            // 입금 내역 없음 = 정상 (빈 배열 반환)
            if (data.status === '0' && (data.message === 'No transactions found' || (Array.isArray(data.result) && data.result.length === 0))) {
              return resolve({ ok: true, entries: [], address: normalized });
            }
            if (data.status !== '1' || !Array.isArray(data.result)) {
              let msg = typeof data.result === 'string' ? data.result : data.message || '';
              if (typeof msg !== 'string') msg = String(msg);
              if (/Missing|Invalid|API Key|apikey/i.test(msg)) {
                msg = '이더스캔 API 키가 없거나 잘못되었습니다. 환경변수 ETHERSCAN_API_KEY를 확인해 주세요.';
              }
              return resolve({ ok: false, message: msg || 'Etherscan 조회 실패', entries: [] });
            }
            const depositLower = normalized.toLowerCase();
            const decimals = 18;
            const entries = data.result.map((tx) => {
              const valueWei = BigInt(tx.value || '0');
              const amount = Number(valueWei) / Math.pow(10, decimals);
              const from = (tx.from || '').toLowerCase();
              const to = (tx.to || '').toLowerCase();
              const direction = to === depositLower ? 'in' : from === depositLower ? 'out' : 'in';
              return {
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                direction,
                amount,
                amountRaw: tx.value,
                blockNumber: tx.blockNumber,
                timeStamp: tx.timeStamp,
                createdAt: tx.timeStamp ? new Date(Number(tx.timeStamp) * 1000).toISOString() : null,
              };
            });
            resolve({ ok: true, entries, address: normalized });
          } catch (err) {
            console.error('fetchEtherscanTornTransfers parse:', err);
            resolve({ ok: false, message: '응답 파싱 실패', entries: [] });
          }
        });
      }
    );
    req.on('error', (err) => {
      console.error('fetchEtherscanTornTransfers:', err);
      resolve({ ok: false, message: err.message || 'Etherscan 요청 실패', entries: [] });
    });
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ ok: false, message: 'Etherscan 요청 시간 초과', entries: [] });
    });
  });
}

// ---------- 이중 아이디 방지: IP·지갑 커플링, 지갑/스테이킹 3일, 연쇄 송금 ----------
const DUPLICATE_BLOCK_MESSAGE = '커뮤니티 보안 정책에 따라 가입이 제한되었습니다.';
const IP_COUPLE_DAYS = 30;
const WALLET_AGE_DAYS = 3;
const TRANSFER_NETWORK_DAYS = 30;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded[0];
    if (first && first.trim()) return first.trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

function etherscanGet(params) {
  return new Promise((resolve, reject) => {
    const apiKey = (process.env.ETHERSCAN_API_KEY || '').trim() || ETHERSCAN_API_KEY_DEFAULT;
    const q = new URLSearchParams({ chainid: '1', ...params });
    if (apiKey) q.set('apikey', apiKey);
    const pathQuery = '/v2/api?' + q.toString();
    const req = https.get(
      { hostname: 'api.etherscan.io', path: pathQuery },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body || '{}');
            if (data.status === '0' && data.message === 'No transactions found') return resolve({ result: [] });
            if (data.status !== '1') return resolve({ result: [], message: data.message || data.result });
            resolve({ result: Array.isArray(data.result) ? data.result : [] });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Etherscan timeout')); });
  });
}

/** 지갑 최초 트랜잭션 시점(Unix sec). 없으면 null */
async function getAccountFirstTxTime(address) {
    const normalized = validateAndNormalizeEthAddress(address);
  if (!normalized) return null;
  try {
    const { result } = await etherscanGet({
      module: 'account',
      action: 'txlist',
      address: normalized,
      startblock: '0',
      endblock: '99999999',
      sort: 'asc',
      page: '1',
      offset: '1',
    });
    const first = result && result[0];
    return first && first.timeStamp ? Number(first.timeStamp) : null;
  } catch {
    return null;
  }
}

/** TORN 스테이킹 관련 주소(프록시/볼트/구현체)로 보낸 tx 목록 (tokentx). 관리자용 횟수·가입 검사용 최초 시점에 사용 */
async function getTornStakingTransfers(address) {
  const normalized = validateAndNormalizeEthAddress(address);
  if (!normalized) return [];
  const recipientSet = new Set(TORN_STAKING_RECIPIENT_ADDRESSES);
  try {
    const { result } = await etherscanGet({
      module: 'account',
      action: 'tokentx',
    address: normalized,
      contractaddress: TORN_TOKEN_ADDRESS,
      page: '1',
      offset: '10000',
      sort: 'asc',
    });
    if (!Array.isArray(result)) return [];
    return result.filter((tx) => recipientSet.has((tx.to || '').toLowerCase()));
  } catch {
    return [];
  }
}

/** TORN 스테이킹 최초 시점(Unix sec). 가입 만 3일 검사용 */
async function getFirstStakeTime(address) {
  const toStaking = await getTornStakingTransfers(address);
  if (toStaking.length === 0) return null;
  let minTs = null;
  for (const tx of toStaking) {
    const ts = tx.timeStamp ? Number(tx.timeStamp) : null;
    if (ts != null && (minTs === null || ts < minTs)) minTs = ts;
  }
  return minTs;
}

/** 최근 N일 내 일반+내부 tx의 상대 주소 집합 (from/to, 본인 제외) */
async function getTxCounterpartiesLast30Days(address) {
  const normalized = validateAndNormalizeEthAddress(address);
  if (!normalized) return new Set();
  const me = normalized.toLowerCase();
  const since = Math.floor((Date.now() - TRANSFER_NETWORK_DAYS * 24 * 60 * 60 * 1000) / 1000);
  const out = new Set();
  try {
    const [txlist, internal] = await Promise.all([
      etherscanGet({
        module: 'account',
        action: 'txlist',
        address: normalized,
        startblock: '0',
        endblock: '99999999',
        sort: 'desc',
        page: '1',
        offset: '500',
      }),
      etherscanGet({
        module: 'account',
        action: 'txlistinternal',
        address: normalized,
        startblock: '0',
        endblock: '99999999',
        sort: 'desc',
        page: '1',
        offset: '500',
      }),
    ]);
    for (const tx of (txlist.result || []).concat(internal.result || [])) {
      if (Number(tx.timeStamp || 0) < since) continue;
      const from = (tx.from || '').toLowerCase();
      const to = (tx.to || '').toLowerCase();
      if (from && from !== me) out.add(from);
      if (to && to !== me) out.add(to);
    }
    return out;
  } catch {
    return new Set();
  }
}

/** 1) IP 커플링: 동일 IP에서 30일 이내 가입 이력 있으면 차단 (원인 추적용: sameIpRecent 반환) */
function checkDuplicateIp(clientIp, users) {
  if (!clientIp) return { block: false, sameIpRecent: [] };
  // localhost/개발 환경에서는 동일 PC에서 테스트 가입 허용
  const isLocal = /^(::1|127\.0\.0\.1|localhost)$/i.test(String(clientIp).trim());
  if (isLocal) return { block: false, sameIpRecent: [] };
  const cutoff = Date.now() - IP_COUPLE_DAYS * 24 * 60 * 60 * 1000;
  const sameIpRecent = users.filter(
    (u) => u.signupIp === clientIp && u.createdAt && new Date(u.createdAt).getTime() >= cutoff
  );
  return { block: sameIpRecent.length > 0, sameIpRecent };
}

/** 2) 지갑 최초 생성·스테이킹 만 3일 경과 여부 */
async function checkWalletAgeAndStake(address) {
  const [firstTx, firstStake] = await Promise.all([getAccountFirstTxTime(address), getFirstStakeTime(address)]);
  const now = Math.floor(Date.now() / 1000);
  const threeDays = WALLET_AGE_DAYS * 24 * 60 * 60;
  if (firstTx == null) return { allowed: false, reason: '지갑 최초 거래 이력을 확인할 수 없습니다.' };
  if (now - firstTx < threeDays) return { allowed: false, reason: '지갑 생성 후 만 3일이 지나야 가입할 수 있습니다.' };
  if (firstStake == null) return { allowed: false, reason: 'TORN 스테이킹 이력을 확인할 수 없습니다.' };
  if (now - firstStake < threeDays) return { allowed: false, reason: 'TORN 스테이킹 시작 후 만 3일이 지나야 가입할 수 있습니다.' };
  return { allowed: true };
}

/** 3) 연쇄 송금: 최근 30일 내 기존 회원 지갑과 거래 이력 있으면 차단 */
async function checkTransferNetwork(address, memberWalletSet) {
  const counterparties = await getTxCounterpartiesLast30Days(address);
  for (const addr of counterparties) {
    if (memberWalletSet.has(addr)) return { block: true, matched: addr };
  }
  return { block: false };
}

// (TORN 입금 자동 매칭 제거 — 포인트/교환 없음)

// 관리자: 강제 탈퇴 (회원 삭제 — 커뮤니티 전용)
app.post('/api/admin/users/:userId/force-withdraw', adminMiddleware, async (req, res) => {
  if (req.session && req.session.isAdmin !== true) {
    return res.status(403).json({ ok: false, message: '관리자 세션이 유효하지 않습니다.' });
  }
  if (!req.user || req.user.isAdmin !== true) {
    return res.status(403).json({ ok: false, message: '관리자만 이용할 수 있습니다.' });
  }
  const userId = String((req.params.userId || '').trim());
  if (!userId) return res.status(400).json({ ok: false, message: '회원 ID가 없습니다.' });
  const users = await db.readUsers();
  const target = users.find((u) => String(u.id) === userId);
  if (!target) {
    return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  }
  if (target.managementAccount === true) {
    return res.status(400).json({ ok: false, message: '관리 계정은 강제 탈퇴할 수 없습니다.' });
  }
  const withdrawnAt = new Date().toISOString();
  await db.appendForceWithdraw({
    userId: target.id,
    displayName: target.displayName || null,
    walletAddress: target.walletAddress || null,
    pointsAtWithdraw: 0,
    withdrawnAt,
    withdrawnBy: req.user ? req.user.id : null,
    withdrawnByDisplayName: req.user ? req.user.displayName : null,
  });
  const filtered = users.filter((u) => String(u.id) !== userId);
  await db.writeUsers(filtered);
  if (typeof db.deleteSessionsByUserId === 'function') await db.deleteSessionsByUserId(userId);
  for (const [token, sess] of sessions.entries()) {
    if (sess && String(sess.id) === userId) sessions.delete(token);
  }
  res.json({ ok: true, message: '강제 탈퇴 처리되었습니다.' });
});

// 관리자: 강제 탈퇴 목록 조회 (강퇴된 아이디 관리)
app.get('/api/admin/force-withdrawn', adminMiddleware, async (req, res) => {
  const raw = await db.readForceWithdraws();
  const entries = raw.map((e, i) => ({ ...e, id: e.id || 'legacy-' + i }));
  res.json({ ok: true, entries });
});

// 관리자: 강제 탈퇴 이력 선택 삭제 (삭제된 지갑은 재가입 가능)
app.delete('/api/admin/force-withdrawn', adminMiddleware, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) {
    return res.status(400).json({ ok: false, message: '삭제할 항목을 선택해 주세요.' });
  }
  const deleted = await db.deleteForceWithdrawByIds(ids);
  res.json({ ok: true, message: '선택한 탈퇴 이력 ' + deleted + '건이 삭제되었습니다. 해당 지갑은 재가입할 수 있습니다.', deleted });
});

// 회원 등급 자동 동기화 (스테이킹 수량 → 등급). API·스케줄 양쪽에서 사용
async function syncAllMemberLevels() {
  const users = await db.readUsers();
  const toSync = users.filter((u) => u.approved !== false && u.walletAddress && !u.managementAccount && !u.isFake);
  let updated = 0;
  for (const u of toSync) {
    const { lockedBalance } = await checkTornStaking(u.walletAddress);
    const stakedNum = parseFloat(formatUnits(lockedBalance || '0', TORN_DECIMALS));
    const newLevel = stakedAmountToLevel(stakedNum);
    const prev = parseInt(u.level, 10);
    if (prev !== newLevel) {
      u.level = newLevel;
      updated++;
    } else if (prev < 1 || prev > MEMBER_LEVEL_MAX) {
      u.level = newLevel;
      updated++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await db.writeUsers(users);
  return { synced: toSync.length, updated };
}

// 등급별 일일 하트 지급 수량: 조개 1, 새우 2, 문어 3, 물개 4, 상어 5, 고래 6, 관리자 0
function getDailyHeartAmountForUser(user) {
  if (!user) return 0;
  if (user.levelAdmin === true || user.boardAdmin === true) return 0;
  const lv = getMemberLevel(user);
  return Math.min(MEMBER_LEVEL_MAX, Math.max(MEMBER_LEVEL_MIN, lv));
}

// 일일 하트 자동 지급: 하루 1회(날짜 기준) 등급별 수량 지급. 날짜는 KST(한국 시간) 기준.
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10); // YYYY-MM-DD KST
}
async function runDailyHeartGrants() {
  const today = getTodayKST();
  const users = await db.readUsers();
  let granted = 0;
  for (const u of users) {
    if (u.approved === false || u.managementAccount === true || u.isFake === true) continue;
    if (u.lastDailyHeartAt === today) continue;
    // 가입 후 만 2일이 지난 뒤부터 일일 지급 (가입일·다음날 제외)
    if (u.createdAt) {
      const created = new Date(u.createdAt);
      const createdKST = new Date(created.getTime() + 9 * 60 * 60 * 1000);
      const createdStr = createdKST.toISOString().slice(0, 10);
      const diffMs = new Date(today).getTime() - new Date(createdStr).getTime();
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      if (diffDays < 2) continue;
    }
    const amount = getDailyHeartAmountForUser(u);
    u.lastDailyHeartAt = today;
    u.points = (typeof u.points === 'number' ? u.points : 0) + amount;
    if (amount > 0) granted++;
  }
  await db.writeUsers(users);
  return { granted, date: today };
}

// 관리자: 회원 등급 수동 동기화 (자동 스케줄 외에 즉시 반영할 때)
app.post('/api/admin/sync-levels', adminMiddleware, async (req, res) => {
  try {
    const { synced, updated } = await syncAllMemberLevels();
    res.json({ ok: true, message: '등급 동기화 완료. ' + synced + '명 중 ' + updated + '명 반영되었습니다.', synced, updated });
  } catch (err) {
    console.error('sync-levels', err);
    res.status(500).json({ ok: false, message: err.message || '등급 동기화 중 오류가 발생했습니다.' });
  }
});

// 관리자: 회원 등급 지정 (Lv.1~6, 스테이킹 동기화 시 덮어씀)
app.post('/api/admin/users/:userId/level', adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const level = parseInt(req.body?.level, 10);
  if (!Number.isInteger(level) || level < MEMBER_LEVEL_MIN || level > MEMBER_LEVEL_MAX) {
    return res.status(400).json({ ok: false, message: '등급은 ' + MEMBER_LEVEL_MIN + '~' + MEMBER_LEVEL_MAX + ' 사이 숫자로 보내 주세요.' });
  }
  const users = await db.readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  users[idx].level = level;
  await db.writeUsers(users);
  res.json({ ok: true, level: getMemberLevel(users[idx]) });
});

// 관리자: 회원 관리자 지정/해제
app.post('/api/admin/users/:userId/level-admin', adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const levelAdmin = req.body?.levelAdmin === true;
  const users = await db.readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  users[idx].levelAdmin = !!levelAdmin;
  await db.writeUsers(users);
  res.json({ ok: true, levelAdmin: users[idx].levelAdmin });
});

// 관리자: 게시판 관리자 지정/해제 (등급과 별도)
app.post('/api/admin/users/:userId/board-admin', adminMiddleware, async (req, res) => {
  const { userId } = req.params;
  const boardAdmin = req.body?.boardAdmin === true;
  const users = await db.readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다.' });
  users[idx].boardAdmin = !!boardAdmin;
  await db.writeUsers(users);
  res.json({ ok: true, boardAdmin: users[idx].boardAdmin });
});

// ——— 게시판 ———
function enrichPostWithVotes(post, userId) {
  const votes = post.votes && typeof post.votes === 'object' ? post.votes : {};
  let likeCount = 0;
  Object.values(votes).forEach((v) => {
    if (v === 'like') likeCount++;
  });
  const out = { ...post, votes: undefined, likeCount };
  if (userId && votes[userId] === 'like') out.userVote = 'like';
  return out;
}

// 목록 (최신순, limit/offset)
app.get('/api/posts', async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const posts = await db.readPosts();
  const sorted = [...posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const slice = sorted.slice(offset, offset + limit);
  const userId = req.user ? req.user.id : null;
  const enriched = slice.map((p) => enrichPostWithVotes(p, userId));
  res.json({ ok: true, posts: enriched, total: sorted.length });
});

// 상세
app.get('/api/posts/:postId', async (req, res) => {
  const posts = await db.readPosts();
  const post = posts.find((p) => p.id === req.params.postId);
  if (!post) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const userId = req.user ? req.user.id : null;
  res.json({ ok: true, post: enrichPostWithVotes(post, userId) });
});

// 작성 (로그인 필요, 이미지 선택 첨부 가능)
app.post('/api/posts', rateLimitWrites, async (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  uploadPostImages(req, res, function (err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ ok: false, message: '이미지는 한 장당 2MB 이하여야 합니다.' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ ok: false, message: '이미지는 최대 5장까지 첨부할 수 있습니다.' });
      return res.status(400).json({ ok: false, message: err.message || '이미지 형식이 올바르지 않습니다. (JPG, PNG, GIF, WEBP)' });
    }
    next();
  });
}, async (req, res) => {
  const files = req.files || [];
  for (const f of files) {
    if (f.path) {
      const ext = path.extname(f.filename || f.originalname || '').toLowerCase();
      if (!validateImageMagic(f.path, ext)) {
        files.forEach((x) => { try { if (x.path) fs.unlinkSync(x.path); } catch (_) {} });
        return res.status(400).json({ ok: false, message: '이미지 파일이 올바르지 않습니다. (허용: JPG, PNG, GIF, WEBP)' });
      }
    }
  }
  const title = String(req.body?.title || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!title || title.length > 200) {
    return res.status(400).json({ ok: false, message: '제목을 1~200자로 입력해 주세요.' });
  }
  if (!body || body.length > 10000) {
    return res.status(400).json({ ok: false, message: '내용을 1~10000자로 입력해 주세요.' });
  }
  const imagePaths = files.map((f) => '/uploads/' + f.filename);
  const posts = await db.readPosts();
  const newPost = {
    id: crypto.randomBytes(8).toString('hex'),
    authorId: req.user.id,
    authorDisplayName: req.user.displayName || '—',
    title,
    body,
    images: imagePaths,
    createdAt: new Date().toISOString(),
    votes: {},
  };
  posts.push(newPost);
  await db.writePosts(posts);
  res.status(201).json({ ok: true, post: enrichPostWithVotes(newPost, req.user.id) });
});

// 좋아요 (로그인 회원, 모든 게시글 가능, 본인 글 포함)
app.post('/api/posts/:postId/vote', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const { postId } = req.params;
  if (req.body?.type !== 'like') return res.status(400).json({ ok: false, message: 'type은 like로 보내 주세요.' });
  const posts = await db.readPosts();
  const idx = posts.findIndex((p) => p.id === postId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const post = posts[idx];
  if (!post.votes) post.votes = {};
  post.votes[req.user.id] = 'like';
  await db.writePosts(posts);
  const enriched = enrichPostWithVotes(posts[idx], req.user.id);
  res.json({ ok: true, likeCount: enriched.likeCount, userVote: enriched.userVote });
});

// (게시글 후원 기능 제거 — 커뮤니티 전용)

// 수정 (작성자만 — 커뮤니티 전용, 2차 비밀번호 제거)
app.patch('/api/posts/:postId', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const { postId } = req.params;
  const { title, body } = req.body || {};
  const posts = await db.readPosts();
  const idx = posts.findIndex((p) => p.id === postId);
  if (idx === -1) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  if (posts[idx].authorId !== req.user.id) return res.status(403).json({ ok: false, message: '작성자만 수정할 수 있습니다.' });
  if (title !== undefined) {
    const t = String(title).trim();
    if (!t || t.length > 200) return res.status(400).json({ ok: false, message: '제목을 1~200자로 입력해 주세요.' });
    posts[idx].title = t;
  }
  if (body !== undefined) {
    const b = String(body).trim();
    if (!b || b.length > 10000) return res.status(400).json({ ok: false, message: '내용을 1~10000자로 입력해 주세요.' });
    posts[idx].body = b;
  }
  if (title === undefined && body === undefined) {
    return res.status(400).json({ ok: false, message: '변경할 제목 또는 내용을 보내 주세요.' });
  }
  await db.writePosts(posts);
  const enriched = enrichPostWithVotes(posts[idx], req.user.id);
  res.json({ ok: true, post: enriched });
});

// ——— 홈 피드 (feeds + feed_comments 컬렉션, _id 기반) ———
app.get('/api/feed', async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const { posts, total } = await db.getFeedPosts(limit, offset);
  const users = await db.readUsersFresh();
  const FEED_COMMENTS_RETURN = 50;
  const enriched = posts.map((p) => {
    const author = users.find((u) => String(u.id) === String(p.authorId));
    const authorLevel = author ? getMemberLevel(author) : null;
    const comments = (p.comments || []).slice(-FEED_COMMENTS_RETURN).map((c) => {
      const commentAuthor = users.find((u) => String(u.id) === String(c.authorId));
      const commentAuthorLevel = commentAuthor ? getMemberLevel(commentAuthor) : null;
      return {
        ...c,
        authorProfileImageUrl: c.authorProfileImageUrl || (commentAuthor && commentAuthor.profileImageUrl ? commentAuthor.profileImageUrl : null),
        authorLevel: commentAuthorLevel,
      };
    });
    return {
      ...p,
      authorProfileImageUrl: author && author.profileImageUrl ? author.profileImageUrl : null,
      authorLevel,
      authorBio: author && typeof author.bio === 'string' ? author.bio : '',
      authorPoints: author && typeof author.points === 'number' ? author.points : 0,
      comments,
    };
  });
  res.json({ ok: true, posts: enriched, total });
});

// 단일 피드 글 조회 (_id 기반, 캐시 무효화 헤더로 304 방지)
app.get('/api/feed/:postId', async (req, res) => {
  const postId = String(req.params.postId || '').trim();
  if (!postId) return res.status(400).json({ ok: false, message: '글 ID가 필요합니다.' });
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.removeHeader('ETag');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const p = await db.getFeedPostById(postId);
  if (!p) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const users = await db.readUsersFresh();
  const author = users.find((u) => String(u.id) === String(p.authorId));
  const authorLevel = author ? getMemberLevel(author) : null;
  const comments = (p.comments || []).map((c) => {
    const commentAuthor = users.find((u) => String(u.id) === String(c.authorId));
    const commentAuthorLevel = commentAuthor ? getMemberLevel(commentAuthor) : null;
    return {
      ...c,
      authorDisplayName: c.authorDisplayName || (commentAuthor && commentAuthor.displayName ? commentAuthor.displayName : '—'),
      authorProfileImageUrl: c.authorProfileImageUrl || (commentAuthor && commentAuthor.profileImageUrl ? commentAuthor.profileImageUrl : null),
      authorLevel: commentAuthorLevel,
    };
  });
  const post = {
    ...p,
    authorDisplayName: p.authorDisplayName || (author && author.displayName ? author.displayName : '—'),
    authorProfileImageUrl: author && author.profileImageUrl ? author.profileImageUrl : null,
    authorLevel,
    authorBio: author && typeof author.bio === 'string' ? author.bio : '',
    authorPoints: author && typeof author.points === 'number' ? author.points : 0,
    comments,
  };
  res.json({ ok: true, post });
});

app.post('/api/feed', rateLimitWrites, async (req, res, next) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  uploadPostImages(req, res, function (err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ ok: false, message: '이미지는 한 장당 2MB 이하여야 합니다.' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ ok: false, message: '이미지는 최대 5장까지 첨부할 수 있습니다.' });
      return res.status(400).json({ ok: false, message: err.message || '이미지 형식이 올바르지 않습니다. (JPG, PNG, GIF, WEBP)' });
    }
    next();
  });
}, async (req, res) => {
  const files = req.files || [];
  for (const f of files) {
    if (f.path) {
      const ext = path.extname(f.filename || f.originalname || '').toLowerCase();
      if (!validateImageMagic(f.path, ext)) {
        files.forEach((x) => { try { if (x.path) fs.unlinkSync(x.path); } catch (_) {} });
        return res.status(400).json({ ok: false, message: '이미지 파일이 올바르지 않습니다. (허용: JPG, PNG, GIF, WEBP)' });
      }
    }
  }
  const body = String(req.body?.body || '').trim();
  if (!body || body.length > 10000) {
    return res.status(400).json({ ok: false, message: '내용을 1~10000자로 입력해 주세요.' });
  }
  const imagePaths = files.map((f) => '/uploads/' + f.filename);
  const users = await db.readUsersFresh();
  const me = users.find((u) => String(u.id) === String(req.user.id))
    || users.find((u) => (u.displayName || '').toLowerCase() === (req.user.displayName || '').toLowerCase());
  const authorId = me ? me.id : req.user.id;
  const authorDisplayName = me ? (me.displayName || '—') : (req.user.displayName || '—');
  const newPost = await db.createFeedPost({
    authorId,
    authorDisplayName,
    body,
    images: imagePaths,
    createdAt: new Date(),
  });
  res.status(201).json({ ok: true, post: newPost });
});

// 관리자: 피드 글 삭제
app.delete('/api/feed/:postId', adminMiddleware, async (req, res) => {
  const postId = String(req.params.postId || '').trim();
  if (!postId) return res.status(400).json({ ok: false, message: '글 ID가 필요합니다.' });
  const post = await db.getFeedPostById(postId);
  if (!post) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const deletedEntry = {
    ...post,
    deletedAt: new Date().toISOString(),
    deletedBy: req.user.id,
    deletedByDisplayName: req.user.displayName || '—',
  };
  await db.appendDeletedFeedPost(deletedEntry);
  await db.deleteFeedPostFromCollection(postId);
  res.json({ ok: true, message: '피드 글이 삭제되었습니다.' });
});

// 관리자: 삭제된 피드 목록
app.get('/api/admin/deleted-feed', adminMiddleware, async (req, res) => {
  const posts = await db.readDeletedFeedPosts();
  res.json({ ok: true, posts });
});

// 관리자: 삭제된 피드 글 복구 (새 _id로 복구)
app.post('/api/admin/deleted-feed/:postId/restore', adminMiddleware, async (req, res) => {
  const postId = String(req.params.postId || '').trim();
  if (!postId) return res.status(400).json({ ok: false, message: '글 ID가 필요합니다.' });
  const deletedList = await db.readDeletedFeedPosts();
  const entry = deletedList.find((p) => String(p.id) === postId);
  if (!entry) return res.status(404).json({ ok: false, message: '삭제된 글을 찾을 수 없습니다.' });
  const { deletedAt, deletedBy, deletedByDisplayName, comments = [], ...rest } = entry;
  const created = await db.createFeedPost({
    authorId: rest.authorId,
    authorDisplayName: rest.authorDisplayName,
    body: rest.body || '',
    images: rest.images || [],
    createdAt: rest.createdAt ? new Date(rest.createdAt) : new Date(),
  });
  for (const c of comments) {
    await db.createFeedComment({
      postId: created.id,
      authorId: c.authorId,
      authorDisplayName: c.authorDisplayName,
      body: c.body || '',
      authorProfileImageUrl: c.authorProfileImageUrl || null,
      replyToCommentId: c.replyToCommentId || null,
      replyToDisplayName: c.replyToDisplayName || null,
      createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
    });
  }
  await db.removeDeletedFeedPost(postId);
  res.json({ ok: true, postId: created.id, message: '피드 글이 복구되었습니다.' });
});

// 관리자: 피드 댓글 삭제 (삭제된 댓글 목록으로 이동)
app.delete('/api/feed/:postId/comments/:commentId', adminMiddleware, async (req, res) => {
  const postId = String(req.params.postId || '').trim();
  const commentId = String(req.params.commentId || '').trim();
  if (!postId || !commentId) return res.status(400).json({ ok: false, message: '글 ID와 댓글 ID가 필요합니다.' });
  const post = await db.getFeedPostById(postId);
  if (!post) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const comment = (post.comments || []).find((c) => String(c.id) === commentId);
  if (!comment) return res.status(404).json({ ok: false, message: '댓글을 찾을 수 없습니다.' });
  const deletedEntry = {
    ...comment,
    postId,
    postBodyPreview: (post.body || '').slice(0, 80),
    deletedAt: new Date().toISOString(),
    deletedBy: req.user.id,
    deletedByDisplayName: req.user.displayName || '—',
  };
  await db.appendDeletedFeedComment(deletedEntry);
  await db.deleteFeedCommentFromCollection(commentId);
  res.json({ ok: true, message: '댓글이 삭제되었습니다.' });
});

// 관리자: 삭제된 댓글 목록
app.get('/api/admin/deleted-feed-comments', adminMiddleware, async (req, res) => {
  const comments = await db.readDeletedFeedComments();
  res.json({ ok: true, comments });
});

// 관리자: 삭제된 댓글 복구
app.post('/api/admin/deleted-feed-comments/:commentId/restore', adminMiddleware, async (req, res) => {
  const commentId = String(req.params.commentId || '').trim();
  if (!commentId) return res.status(400).json({ ok: false, message: '댓글 ID가 필요합니다.' });
  const deletedList = await db.readDeletedFeedComments();
  const entry = deletedList.find((c) => String(c.id) === commentId);
  if (!entry) return res.status(404).json({ ok: false, message: '삭제된 댓글을 찾을 수 없습니다.' });
  const postId = entry.postId;
  if (!postId) return res.status(400).json({ ok: false, message: '원글이 없습니다.' });
  const post = await db.getFeedPostById(postId);
  if (!post) return res.status(404).json({ ok: false, message: '원 글이 없어 복구할 수 없습니다.' });
  const { deletedAt, deletedBy, deletedByDisplayName, postId: _p, postBodyPreview, ...comment } = entry;
  const created = await db.createFeedComment({
    postId,
    authorId: comment.authorId,
    authorDisplayName: comment.authorDisplayName,
    body: comment.body || '',
    authorProfileImageUrl: comment.authorProfileImageUrl || null,
    replyToCommentId: comment.replyToCommentId || null,
    replyToDisplayName: comment.replyToDisplayName || null,
    createdAt: comment.createdAt ? new Date(comment.createdAt) : new Date(),
  });
  await db.removeDeletedFeedComment(commentId);
  res.json({ ok: true, commentId: created.id, message: '댓글이 복구되었습니다.' });
});

// 피드 글에 댓글 작성 — 로그인 필요, 생성된 댓글 반환으로 화면 즉시 반영
const FEED_COMMENT_BODY_MAX = 1000;
const FEED_COMMENTS_MAX = 200;
app.post('/api/feed/:postId/comments', rateLimitWrites, async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인 후 댓글을 남길 수 있습니다.' });
  const postId = String(req.params.postId || '').trim();
  const body = String(req.body?.body || '').trim();
  const replyToCommentId = String(req.body?.replyToCommentId || '').trim() || null;
  if (!postId) return res.status(400).json({ ok: false, message: '글 ID가 필요합니다.' });
  if (!body || body.length > FEED_COMMENT_BODY_MAX) return res.status(400).json({ ok: false, message: '댓글을 1~' + FEED_COMMENT_BODY_MAX + '자로 입력해 주세요.' });
  const post = await db.getFeedPostById(postId);
  if (!post) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const commentCount = (post.comments || []).length;
  if (commentCount >= FEED_COMMENTS_MAX) return res.status(400).json({ ok: false, message: '댓글 수 제한에 도달했습니다.' });
  let replyToDisplayName = null;
  if (replyToCommentId && post.comments) {
    const parent = post.comments.find((c) => String(c.id) === replyToCommentId);
    if (!parent) return res.status(400).json({ ok: false, message: '답글 대상 댓글을 찾을 수 없습니다.' });
    replyToDisplayName = parent.authorDisplayName || '—';
  }
  const users = await db.readUsersFresh();
  const author = users.find((u) => String(u.id) === String(req.user.id))
    || users.find((u) => (u.displayName || '').toLowerCase() === (req.user.displayName || '').toLowerCase());
  const newComment = await db.createFeedComment({
    postId,
    authorId: author ? author.id : req.user.id,
    authorDisplayName: author ? (author.displayName || '—') : (req.user.displayName || '—'),
    authorProfileImageUrl: author && author.profileImageUrl ? author.profileImageUrl : null,
    body,
    replyToCommentId: replyToCommentId || null,
    replyToDisplayName: replyToDisplayName || null,
    createdAt: new Date(),
  });
  if (!newComment) return res.status(500).json({ ok: false, message: '댓글 저장에 실패했습니다.' });
  const payload = { ...newComment, createdAt: newComment.createdAt && typeof newComment.createdAt === 'object' ? newComment.createdAt.toISOString() : newComment.createdAt };
  res.status(201).json({ ok: true, comment: payload });
});

// 피드 글에 하트 보내기 — DB에 즉시 반영, 응답으로 새 숫자 반환(실시간 반영)
app.post('/api/feed/:postId/send-heart', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인 후 하트를 보낼 수 있습니다.' });
  const postId = String(req.params.postId || '').trim();
  if (!postId) return res.status(400).json({ ok: false, message: '글 ID가 필요합니다.' });
  const post = await db.getFeedPostById(postId);
  if (!post) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const users = await db.readUsersFresh();
  let senderIdx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (senderIdx === -1 && req.user.displayName) {
    senderIdx = users.findIndex((u) => (u.displayName || '').toLowerCase() === (req.user.displayName || '').toLowerCase());
  }
  const authorIdx = users.findIndex((u) => String(u.id) === String(post.authorId));
  if (senderIdx === -1 || authorIdx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다. 다시 로그인해 주세요.' });
  if (String(users[senderIdx].id) === String(post.authorId)) return res.status(400).json({ ok: false, message: '본인 글에는 하트를 보낼 수 없습니다.' });
  const senderPoints = typeof users[senderIdx].points === 'number' ? users[senderIdx].points : 0;
  if (senderPoints < 1) return res.status(400).json({ ok: false, message: '보유 하트가 부족합니다.' });
  users[senderIdx].points = senderPoints - 1;
  const authorPoints = typeof users[authorIdx].points === 'number' ? users[authorIdx].points : 0;
  users[authorIdx].points = authorPoints + 1;
  await db.writeUsers(users);
  const heartsReceived = await db.incrementFeedPostHearts(postId);
  req.session.save((err) => {
    if (err) {
      console.error('[feed/send-heart] session.save err', err);
      return res.status(500).json({ ok: false, message: '세션 저장에 실패했습니다.' });
    }
    res.json({ ok: true, myHearts: users[senderIdx].points, heartsReceived, message: '하트를 보냈습니다.' });
  });
});

// 피드 댓글에 하트 보내기 — DB에 즉시 반영, 응답으로 새 숫자 반환(실시간 반영)
app.post('/api/feed/:postId/comments/:commentId/send-heart', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인 후 하트를 보낼 수 있습니다.' });
  const postId = String(req.params.postId || '').trim();
  const commentId = String(req.params.commentId || '').trim();
  if (!postId || !commentId) return res.status(400).json({ ok: false, message: '글 ID와 댓글 ID가 필요합니다.' });
  const post = await db.getFeedPostById(postId);
  if (!post) return res.status(404).json({ ok: false, message: '글을 찾을 수 없습니다.' });
  const comment = (post.comments || []).find((c) => String(c.id) === commentId);
  if (!comment) return res.status(404).json({ ok: false, message: '댓글을 찾을 수 없습니다.' });
  const users = await db.readUsersFresh();
  let senderIdx = users.findIndex((u) => String(u.id) === String(req.user.id));
  if (senderIdx === -1 && req.user.displayName) {
    senderIdx = users.findIndex((u) => (u.displayName || '').toLowerCase() === (req.user.displayName || '').toLowerCase());
  }
  const authorIdx = users.findIndex((u) => String(u.id) === String(comment.authorId));
  if (senderIdx === -1 || authorIdx === -1) return res.status(404).json({ ok: false, message: '회원 정보를 찾을 수 없습니다. 다시 로그인해 주세요.' });
  if (String(users[senderIdx].id) === String(comment.authorId)) return res.status(400).json({ ok: false, message: '본인 댓글에는 하트를 보낼 수 없습니다.' });
  const senderPoints = typeof users[senderIdx].points === 'number' ? users[senderIdx].points : 0;
  if (senderPoints < 1) return res.status(400).json({ ok: false, message: '보유 하트가 부족합니다.' });
  users[senderIdx].points = senderPoints - 1;
  const authorPoints = typeof users[authorIdx].points === 'number' ? users[authorIdx].points : 0;
  users[authorIdx].points = authorPoints + 1;
  await db.writeUsers(users);
  const heartsReceived = await db.incrementFeedCommentHearts(commentId);
  req.session.save((err) => {
    if (err) {
      console.error('[feed/comment/send-heart] session.save err', err);
      return res.status(500).json({ ok: false, message: '세션 저장에 실패했습니다.' });
    }
    res.json({ ok: true, myHearts: users[senderIdx].points, heartsReceived, message: '하트를 보냈습니다.' });
  });
});

// ——— 토네이도 뉴스 ———
app.get('/api/tornado-news', (req, res) => {
  const items = readTornadoNews();
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const slice = items.slice(offset, offset + limit);
  res.json({ ok: true, items: slice, total: items.length });
});

app.post('/api/tornado-news', (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  const title = String(req.body?.title || '').trim();
  const summary = String(req.body?.summary || '').trim();
  const url = String(req.body?.url || '').trim();
  const sourceName = String(req.body?.sourceName || '').trim() || '수동 등록';
  if (!title || title.length > 300) return res.status(400).json({ ok: false, message: '제목을 1~300자로 입력해 주세요.' });
  if (!url || url.length > 500) return res.status(400).json({ ok: false, message: 'URL을 입력해 주세요.' });
  const items = readTornadoNews();
  items.unshift({
    id: crypto.randomBytes(8).toString('hex'),
    title,
    summary: summary.slice(0, 500),
    url,
    sourceName,
    sourceUrl: '',
    createdAt: new Date().toISOString(),
    isManual: true,
    userId: req.user.id,
  });
  writeTornadoNews(items);
  res.status(201).json({ ok: true, item: items[0] });
});

app.get('/api/tornado-news/sources', (req, res) => {
  const sources = readTornadoNewsSources();
  res.json({ ok: true, sources });
});

app.post('/api/tornado-news/sources', adminMiddleware, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const url = String(req.body?.url || '').trim();
  if (!name || !url) return res.status(400).json({ ok: false, message: 'name, url을 입력해 주세요.' });
  const sources = readTornadoNewsSources();
  const id = (req.body?.id || crypto.randomBytes(4).toString('hex')).slice(0, 32);
  if (sources.some((s) => s.id === id)) return res.status(400).json({ ok: false, message: '이미 있는 소스 ID입니다.' });
  sources.push({ id, name, url, enabled: true });
  writeTornadoNewsSources(sources);
  res.status(201).json({ ok: true, sources });
});

app.delete('/api/tornado-news/sources/:id', adminMiddleware, (req, res) => {
  const { id } = req.params;
  const sources = readTornadoNewsSources().filter((s) => s.id !== id);
  writeTornadoNewsSources(sources);
  res.json({ ok: true, sources });
});

app.post('/api/tornado-news/fetch', adminMiddleware, async (req, res) => {
  try {
    const result = await fetchTornadoNewsFromSources();
    res.json({ ok: true, added: result.added, errors: result.errors });
  } catch (err) {
    console.error('tornado-news/fetch', err);
    res.status(500).json({ ok: false, message: err.message || '수집 중 오류가 발생했습니다.' });
  }
});

app.get('/api/tornado-news/keywords', adminMiddleware, (req, res) => {
  const keywords = readTornadoNewsKeywords();
  res.json({ ok: true, keywords });
});

app.put('/api/tornado-news/keywords', adminMiddleware, (req, res) => {
  const keywords = req.body && req.body.keywords;
  if (!Array.isArray(keywords)) {
    return res.status(400).json({ ok: false, message: 'keywords는 배열로 보내 주세요.' });
  }
  writeTornadoNewsKeywords(keywords);
  res.json({ ok: true, keywords: readTornadoNewsKeywords() });
});

const TORNADO_NEWS_TRANSLATE_EXISTING_MAX = 10;

app.post('/api/tornado-news/dedupe', adminMiddleware, (req, res) => {
  try {
    const result = runDedupeTornadoNews();
    res.json({ ok: true, removed: result.removed, kept: result.kept });
  } catch (err) {
    console.error('tornado-news/dedupe', err);
    res.status(500).json({ ok: false, message: err.message || '중복 제거 중 오류가 발생했습니다.' });
  }
});

app.delete('/api/tornado-news/:id', adminMiddleware, (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ ok: false, message: '기사 ID가 필요합니다.' });
  const items = readTornadoNews().filter((i) => i.id !== id);
  if (items.length === readTornadoNews().length) return res.status(404).json({ ok: false, message: '기사를 찾을 수 없습니다.' });
  writeTornadoNews(items);
  res.json({ ok: true });
});

app.post('/api/tornado-news/translate-existing', adminMiddleware, async (req, res) => {
  try {
    const items = readTornadoNews();
    const needTranslation = items.filter((i) => !i.titleKo && !looksLikeKorean(i.title || ''));
    const toProcess = needTranslation.slice(0, TORNADO_NEWS_TRANSLATE_EXISTING_MAX);
    let translated = 0;
    for (const item of toProcess) {
      const title = (item.title || '').slice(0, 300);
      const tKo = await translateToKorean(title);
      if (tKo) {
        item.titleKo = tKo.slice(0, 300);
        translated++;
      }
      if (translated % 3 === 0) await new Promise((r) => setTimeout(r, 200));
    }
    if (translated > 0) writeTornadoNews(items);
    res.json({ ok: true, translated, remaining: Math.max(0, needTranslation.length - toProcess.length) });
  } catch (err) {
    console.error('tornado-news/translate-existing', err);
    res.status(500).json({ ok: false, message: err.message || '번역 중 오류가 발생했습니다.' });
  }
});

function onServerListen(listenPort) {
  ensureDataDir();
  ensureUploadsDir();
  // 세션 스토어(MongoDB Atlas) 연결 검증 로그
  if (process.env.MONGODB_URI) {
    MongoClient.connect(process.env.MONGODB_URI)
      .then((client) => {
        console.log('Session Store connected to MongoDB');
        return client.close();
      })
      .catch((err) => console.warn('[session] MongoDB connection check failed:', err.message));
  } else {
    console.warn('[session] MONGODB_URI not set — session store may not persist.');
  }
  const LEVEL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    syncAllMemberLevels().then(() => {}).catch((err) => console.error('Level sync error:', err.message));
  }, 60 * 1000);
  setInterval(() => {
    syncAllMemberLevels().then(() => {}).catch((err) => console.error('Level sync error:', err.message));
  }, LEVEL_SYNC_INTERVAL_MS);
  function scheduleNextDailyHearts() {
    const now = new Date();
    const msIntoDayUtc = (now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) * 1000 + now.getUTCMilliseconds();
    const msTo15Utc = 15 * 60 * 60 * 1000 - msIntoDayUtc;
    const delay = msTo15Utc <= 0 ? msTo15Utc + 24 * 60 * 60 * 1000 : msTo15Utc;
    setTimeout(() => {
      runDailyHeartGrants()
        .then(() => {})
        .catch((err) => console.error('Daily heart grant error:', err.message))
        .finally(() => scheduleNextDailyHearts());
    }, delay);
  }
  scheduleNextDailyHearts();
  setTimeout(() => {
    runScheduledTornadoNews().catch((err) => console.error('Tornado news first run:', err.message));
  }, 2 * 60 * 1000);
  setInterval(() => {
    runScheduledTornadoNews().catch((err) => console.error('Tornado news schedule:', err.message));
  }, TORNADO_NEWS_FETCH_INTERVAL_MS);
}

// API 라우트보다 뒤에 두어 /api/* 요청이 static에 맡지 않도록 함
app.use(express.static(path.join(__dirname, 'public')));

// 미처리 예외 → 500 JSON 응답 (스택 노출 방지)
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err?.message || err);
  if (res.headersSent) return;
  res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
});

function tryListen(port, maxTries) {
  if (maxTries == null) maxTries = 6;
  const server = app.listen(port, () => onServerListen(port));
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && maxTries > 1) {
      console.warn('Port ' + port + ' in use, trying ' + (port + 1) + '...');
      tryListen(port + 1, maxTries - 1);
    } else {
      throw err;
    }
  });
}

db.connect()
  .then(() => db.deduplicateUsers())
  .then(() => tryListen(PORT))
  .catch((err) => {
    console.error('DB connect failed:', err);
    process.exit(1);
  });
