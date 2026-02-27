/**
 * DB 레이어 — MONGODB_URI 있으면 MongoDB, 없으면 기존 JSON 파일 사용 (모두 async 인터페이스)
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dns = require('dns');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const FEED_FILE = path.join(DATA_DIR, 'feed.json');
const DELETED_FEED_FILE = path.join(DATA_DIR, 'deleted-feed.json');
const DELETED_FEED_COMMENTS_FILE = path.join(DATA_DIR, 'deleted-feed-comments.json');
const ADMIN_PIN_FILE = path.join(DATA_DIR, 'admin-pin.json');
const FORCE_WITHDRAWS_FILE = path.join(DATA_DIR, 'force-withdraws.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const PINNED_FILE = path.join(DATA_DIR, 'pinned.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MIGRATED_FLAG_FILE = path.join(DATA_DIR, '.migrated-to-mongo');

const CHAT_MAX_MESSAGES = 200;

// 파일 모드 전용: 메모리 캐시 + 즉시 저장(원자적 쓰기) + 외부 편집 시 watch로 캐시 무효화
const fileCache = {};
const FILE_KEYS = {
  users: USERS_FILE,
  posts: POSTS_FILE,
  feed: FEED_FILE,
  deletedFeed: DELETED_FEED_FILE,
  deletedFeedComments: DELETED_FEED_COMMENTS_FILE,
  adminPinHash: ADMIN_PIN_FILE,
  forceWithdraws: FORCE_WITHDRAWS_FILE,
  chatMessages: CHAT_FILE,
  pinned: PINNED_FILE,
  settings: SETTINGS_FILE,
  sessions: SESSIONS_FILE,
};
function invalidateFileCache(key) {
  if (key) delete fileCache[key];
  else Object.keys(FILE_KEYS).forEach((k) => delete fileCache[k]);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** 쓰기 도중 프로세스가 죽어도 기존 파일이 깨지지 않도록: 임시 파일에 쓴 뒤 성공 시 rename으로 원자적 덮어쓰기 */
function atomicWriteFileSync(filePath, content) {
  ensureDataDir();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, '.' + base + '.tmp');
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

// ——— 파일 모드 (동기 → Promise로 래핑, 캐시 + 변경 시 즉시 반영) ———
async function fileReadUsers() {
  if (fileCache.users !== undefined) return fileCache.users;
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return (fileCache.users = []);
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const users = Array.isArray(data.users) ? data.users : [];
    fileCache.users = users;
    return users;
  } catch (err) {
    console.error('readUsers failed:', err?.message);
    return (fileCache.users = []);
  }
}

async function fileWriteUsers(users) {
  atomicWriteFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
  invalidateFileCache('users');
}

async function fileReadPosts() {
  if (fileCache.posts !== undefined) return fileCache.posts;
  ensureDataDir();
  if (!fs.existsSync(POSTS_FILE)) return (fileCache.posts = []);
  try {
    const data = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
    const posts = Array.isArray(data.posts) ? data.posts : [];
    fileCache.posts = posts;
    return posts;
  } catch (_) {
    return (fileCache.posts = []);
  }
}

async function fileWritePosts(posts) {
  atomicWriteFileSync(POSTS_FILE, JSON.stringify({ posts }, null, 2));
  invalidateFileCache('posts');
}

async function fileReadFeedPosts() {
  if (fileCache.feed !== undefined) return fileCache.feed;
  ensureDataDir();
  if (!fs.existsSync(FEED_FILE)) return (fileCache.feed = []);
  try {
    const data = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
    const posts = Array.isArray(data.posts) ? data.posts : [];
    fileCache.feed = posts;
    return posts;
  } catch (_) {
    return (fileCache.feed = []);
  }
}

async function fileWriteFeedPosts(posts) {
  atomicWriteFileSync(FEED_FILE, JSON.stringify({ posts }, null, 2));
  invalidateFileCache('feed');
}

async function fileReadDeletedFeedPosts() {
  if (fileCache.deletedFeed !== undefined) return fileCache.deletedFeed;
  ensureDataDir();
  if (!fs.existsSync(DELETED_FEED_FILE)) return (fileCache.deletedFeed = []);
  try {
    const data = JSON.parse(fs.readFileSync(DELETED_FEED_FILE, 'utf8'));
    const posts = Array.isArray(data.posts) ? data.posts : [];
    fileCache.deletedFeed = posts;
    return posts;
  } catch (_) {
    return (fileCache.deletedFeed = []);
  }
}

async function fileAppendDeletedFeedPost(entry) {
  const posts = await fileReadDeletedFeedPosts();
  posts.unshift(entry);
  const trimmed = posts.slice(0, 500);
  ensureDataDir();
  atomicWriteFileSync(DELETED_FEED_FILE, JSON.stringify({ posts: trimmed }, null, 2));
  invalidateFileCache('deletedFeed');
}

async function fileRemoveDeletedFeedPost(postId) {
  const posts = await fileReadDeletedFeedPosts();
  const filtered = posts.filter((p) => p.id !== postId);
  if (filtered.length === posts.length) return false;
  ensureDataDir();
  atomicWriteFileSync(DELETED_FEED_FILE, JSON.stringify({ posts: filtered }, null, 2));
  invalidateFileCache('deletedFeed');
  return true;
}

async function fileReadDeletedFeedComments() {
  if (fileCache.deletedFeedComments !== undefined) return fileCache.deletedFeedComments;
  ensureDataDir();
  if (!fs.existsSync(DELETED_FEED_COMMENTS_FILE)) return (fileCache.deletedFeedComments = []);
  try {
    const data = JSON.parse(fs.readFileSync(DELETED_FEED_COMMENTS_FILE, 'utf8'));
    const list = Array.isArray(data.comments) ? data.comments : [];
    fileCache.deletedFeedComments = list;
    return list;
  } catch (_) {
    return (fileCache.deletedFeedComments = []);
  }
}

async function fileAppendDeletedFeedComment(entry) {
  const list = await fileReadDeletedFeedComments();
  list.unshift(entry);
  const trimmed = list.slice(0, 500);
  ensureDataDir();
  atomicWriteFileSync(DELETED_FEED_COMMENTS_FILE, JSON.stringify({ comments: trimmed }, null, 2));
  invalidateFileCache('deletedFeedComments');
}

async function fileRemoveDeletedFeedComment(commentId) {
  const list = await fileReadDeletedFeedComments();
  const filtered = list.filter((c) => c.id !== commentId);
  if (filtered.length === list.length) return false;
  ensureDataDir();
  atomicWriteFileSync(DELETED_FEED_COMMENTS_FILE, JSON.stringify({ comments: filtered }, null, 2));
  invalidateFileCache('deletedFeedComments');
  return true;
}

function getInitialAdminPin() {
  const envPin = (process.env.INITIAL_ADMIN_PIN || '').trim();
  if (/^[0-9]{6}$/.test(envPin)) return envPin;
  return '000000';
}

async function fileReadAdminPinHash() {
  if (fileCache.adminPinHash !== undefined) return fileCache.adminPinHash;
  ensureDataDir();
  const initialPin = getInitialAdminPin();
  if (!fs.existsSync(ADMIN_PIN_FILE)) {
    const pinHash = bcrypt.hashSync(initialPin, 10);
    atomicWriteFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash }, null, 2));
    invalidateFileCache('adminPinHash');
    return (fileCache.adminPinHash = pinHash);
  }
  try {
    const data = JSON.parse(fs.readFileSync(ADMIN_PIN_FILE, 'utf8'));
    const hash = data.pinHash && typeof data.pinHash === 'string' ? data.pinHash : null;
    if (!hash) {
      const defaultHash = bcrypt.hashSync(initialPin, 10);
      atomicWriteFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash: defaultHash }, null, 2));
      invalidateFileCache('adminPinHash');
      return (fileCache.adminPinHash = defaultHash);
    }
    fileCache.adminPinHash = hash;
    return hash;
  } catch (_) {
    const defaultHash = bcrypt.hashSync(initialPin, 10);
    atomicWriteFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash: defaultHash }, null, 2));
    invalidateFileCache('adminPinHash');
    return (fileCache.adminPinHash = defaultHash);
  }
}

async function fileWriteAdminPinHash(pinHash) {
  atomicWriteFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash }, null, 2));
  invalidateFileCache('adminPinHash');
}

async function fileReadForceWithdraws() {
  if (fileCache.forceWithdraws !== undefined) return fileCache.forceWithdraws;
  ensureDataDir();
  if (!fs.existsSync(FORCE_WITHDRAWS_FILE)) return (fileCache.forceWithdraws = []);
  try {
    const data = JSON.parse(fs.readFileSync(FORCE_WITHDRAWS_FILE, 'utf8'));
    const entries = Array.isArray(data.entries) ? data.entries : [];
    fileCache.forceWithdraws = entries;
    return entries;
  } catch (_) {
    return (fileCache.forceWithdraws = []);
  }
}

async function fileAppendForceWithdraw(entry) {
  const entries = await fileReadForceWithdraws();
  const id = entry.id || crypto.randomBytes(8).toString('hex');
  entries.unshift({ id, ...entry, createdAt: entry.createdAt || new Date().toISOString() });
  const trimmed = entries.slice(0, 2000);
  atomicWriteFileSync(FORCE_WITHDRAWS_FILE, JSON.stringify({ entries: trimmed }, null, 2));
  invalidateFileCache('forceWithdraws');
}

async function fileReadChatMessages() {
  if (fileCache.chatMessages !== undefined) return fileCache.chatMessages;
  ensureDataDir();
  if (!fs.existsSync(CHAT_FILE)) return (fileCache.chatMessages = []);
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    const messages = Array.isArray(data.messages) ? data.messages : [];
    fileCache.chatMessages = messages;
    return messages;
  } catch (_) {
    return (fileCache.chatMessages = []);
  }
}

async function fileAppendChatMessage(msg) {
  const messages = await fileReadChatMessages();
  const id = msg.id || crypto.randomBytes(8).toString('hex');
  const createdAt = msg.createdAt || new Date().toISOString();
  const payload = { id, userId: msg.userId, displayName: msg.displayName, text: msg.text || '', createdAt };
  if (msg.imageUrl) payload.imageUrl = msg.imageUrl;
  if (msg.replyToMessageId) payload.replyToMessageId = msg.replyToMessageId;
  if (msg.replyToText != null) payload.replyToText = String(msg.replyToText).slice(0, 100);
  messages.push(payload);
  const trimmed = messages.slice(-CHAT_MAX_MESSAGES);
  atomicWriteFileSync(CHAT_FILE, JSON.stringify({ messages: trimmed }, null, 2));
  invalidateFileCache('chatMessages');
  return payload;
}

async function fileUpdateChatMessage(messageId, userId, updates) {
  const messages = await fileReadChatMessages();
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1 || messages[idx].userId !== userId) return null;
  if (updates.text !== undefined) {
    messages[idx].text = String(updates.text).trim().slice(0, 500);
  }
  messages[idx].editedAt = new Date().toISOString();
  atomicWriteFileSync(CHAT_FILE, JSON.stringify({ messages }, null, 2));
  invalidateFileCache('chatMessages');
  return messages[idx];
}

async function fileDeleteChatMessage(messageId, userId) {
  const messages = await fileReadChatMessages();
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1 || messages[idx].userId !== userId) return null;
  messages.splice(idx, 1);
  atomicWriteFileSync(CHAT_FILE, JSON.stringify({ messages }, null, 2));
  invalidateFileCache('chatMessages');
  return true;
}

async function fileClearChatMessages() {
  atomicWriteFileSync(CHAT_FILE, JSON.stringify({ messages: [] }, null, 2));
  invalidateFileCache('chatMessages');
}

async function fileIncrementMessageHearts(messageId) {
  const messages = await fileReadChatMessages();
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  messages[idx].heartsReceived = (messages[idx].heartsReceived || 0) + 1;
  atomicWriteFileSync(CHAT_FILE, JSON.stringify({ messages }, null, 2));
  invalidateFileCache('chatMessages');
}

async function fileReadPinned() {
  if (fileCache.pinned !== undefined) return fileCache.pinned;
  ensureDataDir();
  if (!fs.existsSync(PINNED_FILE)) return (fileCache.pinned = null);
  try {
    const data = JSON.parse(fs.readFileSync(PINNED_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return (fileCache.pinned = null);
    const hasText = typeof data.text === 'string';
    const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
    const pinnedExpired = expiresAt && Date.now() >= expiresAt;
    if (hasText && !pinnedExpired) return (fileCache.pinned = data);
    if (data.lastItemUse && data.lastItemUse.at) return (fileCache.pinned = { lastItemUse: data.lastItemUse });
    if (pinnedExpired) {
      fs.unlinkSync(PINNED_FILE);
      invalidateFileCache('pinned');
    }
    return (fileCache.pinned = null);
  } catch (_) {
    return (fileCache.pinned = null);
  }
}

async function fileWritePinned(obj) {
  atomicWriteFileSync(PINNED_FILE, JSON.stringify(obj, null, 2));
  invalidateFileCache('pinned');
}

async function fileReadSettings() {
  if (fileCache.settings !== undefined) return fileCache.settings;
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) return (fileCache.settings = {});
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    fileCache.settings = settings && typeof settings === 'object' ? settings : {};
    return fileCache.settings;
  } catch (_) {
    return (fileCache.settings = {});
  }
}

async function fileWriteSettings(settings) {
  atomicWriteFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  invalidateFileCache('settings');
}

async function fileClearForceWithdraws() {
  atomicWriteFileSync(FORCE_WITHDRAWS_FILE, JSON.stringify({ entries: [] }, null, 2));
  invalidateFileCache('forceWithdraws');
}

async function fileDeleteForceWithdrawByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const set = new Set(ids);
  const entries = await fileReadForceWithdraws();
  const kept = entries.filter((e, i) => !set.has(e.id || 'legacy-' + i));
  atomicWriteFileSync(FORCE_WITHDRAWS_FILE, JSON.stringify({ entries: kept }, null, 2));
  invalidateFileCache('forceWithdraws');
  return entries.length - kept.length;
}

// ——— 파일 모드: 세션 (sessions.json, 서버 재시작 후에도 유지)
function fileReadSessionsRaw() {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_FILE)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return data && typeof data.sessions === 'object' ? data.sessions : {};
  } catch (_) {
    return {};
  }
}
function fileWriteSessionsRaw(sessionsObj) {
  atomicWriteFileSync(SESSIONS_FILE, JSON.stringify({ sessions: sessionsObj }, null, 2));
}

async function fileGetSession(token) {
  if (!token) return null;
  const sessions = fileReadSessionsRaw();
  const sess = sessions[token];
  if (!sess || (sess.expiresAt && sess.expiresAt < Date.now())) return null;
  return { id: sess.id, displayName: sess.displayName, walletAddress: sess.walletAddress, isAdmin: !!sess.isAdmin, expiresAt: sess.expiresAt };
}
async function fileSetSession(token, data) {
  if (!token) return;
  const sessions = fileReadSessionsRaw();
  sessions[token] = {
    id: data.id,
    displayName: data.displayName,
    walletAddress: data.walletAddress || null,
    isAdmin: !!data.isAdmin,
    expiresAt: data.expiresAt,
  };
  fileWriteSessionsRaw(sessions);
}
async function fileDeleteSession(token) {
  if (!token) return;
  const sessions = fileReadSessionsRaw();
  delete sessions[token];
  fileWriteSessionsRaw(sessions);
}
async function fileDeleteSessionsByUserId(userId) {
  if (!userId) return;
  const sessions = fileReadSessionsRaw();
  let changed = false;
  for (const t of Object.keys(sessions)) {
    if (sessions[t] && sessions[t].id === userId) {
      delete sessions[t];
      changed = true;
    }
  }
  if (changed) fileWriteSessionsRaw(sessions);
}
async function fileDeleteExpiredSessions() {
  const sessions = fileReadSessionsRaw();
  const now = Date.now();
  let changed = false;
  for (const t of Object.keys(sessions)) {
    if (sessions[t] && sessions[t].expiresAt && sessions[t].expiresAt < now) {
      delete sessions[t];
      changed = true;
    }
  }
  if (changed) fileWriteSessionsRaw(sessions);
}

// ——— MongoDB 모드 ———
let mongoose;
let UserModel;
let PostModel;
let FeedModel;
let DeletedFeedModel;
let DeletedFeedCommentModel;
let ChatMessageModel;
let AdminPinModel;
let PinnedModel;
let SettingsModel;
let ForceWithdrawModel;
let SessionModel;

async function connectMongo() {
  // Render 등에서 앞뒤 공백·따옴표, 또는 주석(//) 줄이 붙으면 오류 나므로 정리
  let uri = (process.env.MONGODB_URI || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^\s*\/\/[^\n]*\n?/, ''); // 앞쪽 "// ..." 줄 제거
  uri = uri.trim();
  if (!uri) return false;

  // 프로덕션에서 로컬 DB 주소 쓰면 연결 실패하므로 경고
  if (process.env.NODE_ENV === 'production') {
    const lower = uri.toLowerCase();
    if (lower.includes('localhost') || lower.includes('127.0.0.1')) {
      console.warn('DB 경고: 프로덕션 환경에서 localhost/127.0.0.1을 쓰고 있습니다. 서버에서는 DB의 공인 주소(Atlas 등)를 써야 합니다.');
    }
  }

  mongoose = require('mongoose');
  const { Schema } = mongoose;

  UserModel = mongoose.model('User', new Schema({}, { strict: false }));
  PostModel = mongoose.model('Post', new Schema({}, { strict: false }));
  FeedModel = mongoose.model('Feed', new Schema({}, { strict: false }));
  DeletedFeedModel = mongoose.model('DeletedFeed', new Schema({}, { strict: false }));
  DeletedFeedCommentModel = mongoose.model('DeletedFeedComment', new Schema({}, { strict: false }));
  ChatMessageModel = mongoose.model('ChatMessage', new Schema({}, { strict: false }));
  AdminPinModel = mongoose.model('AdminPin', new Schema({ pinHash: String }, { strict: false }));
  PinnedModel = mongoose.model('Pinned', new Schema({}, { strict: false }));
  SettingsModel = mongoose.model('Settings', new Schema({}, { strict: false }));
  ForceWithdrawModel = mongoose.model('ForceWithdraw', new Schema({}, { strict: false }));
  SessionModel = mongoose.model('Session', new Schema({ token: String, id: String, displayName: String, walletAddress: String, isAdmin: Boolean, expiresAt: Number }, { strict: false }));

  try {
    const userMatch = uri.match(/^mongodb(\+srv)?:\/\/([^:]+):/);
    if (userMatch) console.log('MongoDB connecting as user:', userMatch[2]);
    // URI에서 DB 이름 추출: ...mongodb.net/DB이름?options — 없으면 드라이버 기본값 "test" 사용
    const pathMatch = uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/);
    const dbName = pathMatch && pathMatch[1].trim() ? pathMatch[1].trim() : 'test';
    if (dbName === 'test') {
      console.warn("MongoDB URI에 DB 이름이 없어 기본 DB 'test'를 사용합니다. TornFi 데이터를 쓰려면 URI에 DB 이름을 넣으세요. 예: ...mongodb.net/tornfi?appName=TornFi");
    }
    // mongodb+srv는 DNS SRV 조회가 필요함. PC DNS가 SRV를 막으면 ECONNREFUSED → Google DNS로 SRV 조회 시도
    if (uri.startsWith('mongodb+srv://')) {
      dns.setServers(['8.8.8.8', '8.8.4.4']);
    }
    await mongoose.connect(uri);
    console.log('MongoDB connected, DB:', dbName);
    return true;
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    throw err;
  }
}

async function mongoReadUsers() {
  const docs = await UserModel.find().lean();
  return docs.map((d) => {
    const { _id, __v, ...rest } = d;
    if (rest.id != null) rest.id = String(rest.id);
    return rest;
  });
}

async function mongoWriteUsers(users) {
  await UserModel.deleteMany({});
  if (users.length) await UserModel.insertMany(users);
}

async function mongoReadPosts() {
  const docs = await PostModel.find().lean();
  return docs.map((d) => {
    const { _id, __v, ...rest } = d;
    return rest;
  });
}

async function mongoWritePosts(posts) {
  await PostModel.deleteMany({});
  if (posts.length) await PostModel.insertMany(posts);
}

async function mongoReadFeedPosts() {
  const docs = await FeedModel.find().sort({ createdAt: -1 }).lean();
  return docs.map((d) => {
    const { _id, __v, ...rest } = d;
    return rest;
  });
}

async function mongoWriteFeedPosts(posts) {
  await FeedModel.deleteMany({});
  if (posts.length) await FeedModel.insertMany(posts);
}

async function mongoReadDeletedFeedPosts() {
  if (!DeletedFeedModel) return [];
  const docs = await DeletedFeedModel.find().sort({ deletedAt: -1 }).lean();
  return docs.map((d) => {
    const { _id, __v, ...rest } = d;
    return rest;
  });
}

async function mongoAppendDeletedFeedPost(entry) {
  if (!DeletedFeedModel) return;
  await DeletedFeedModel.create(entry);
  const count = await DeletedFeedModel.countDocuments();
  if (count > 500) {
    const toRemove = await DeletedFeedModel.find().sort({ deletedAt: 1 }).limit(count - 500).lean();
    for (const d of toRemove) await DeletedFeedModel.deleteOne({ _id: d._id });
  }
}

async function mongoRemoveDeletedFeedPost(postId) {
  if (!DeletedFeedModel) return false;
  const result = await DeletedFeedModel.deleteOne({ id: postId });
  return result.deletedCount > 0;
}

async function mongoReadDeletedFeedComments() {
  if (!DeletedFeedCommentModel) return [];
  const docs = await DeletedFeedCommentModel.find().sort({ deletedAt: -1 }).lean();
  return docs.map((d) => {
    const { _id, __v, ...rest } = d;
    return rest;
  });
}

async function mongoAppendDeletedFeedComment(entry) {
  if (!DeletedFeedCommentModel) return;
  await DeletedFeedCommentModel.create(entry);
  const count = await DeletedFeedCommentModel.countDocuments();
  if (count > 500) {
    const toRemove = await DeletedFeedCommentModel.find().sort({ deletedAt: 1 }).limit(count - 500).lean();
    for (const d of toRemove) await DeletedFeedCommentModel.deleteOne({ _id: d._id });
  }
}

async function mongoRemoveDeletedFeedComment(commentId) {
  if (!DeletedFeedCommentModel) return false;
  const result = await DeletedFeedCommentModel.deleteOne({ id: commentId });
  return result.deletedCount > 0;
}

async function mongoReadAdminPinHash() {
  const doc = await AdminPinModel.findOne().lean();
  const hash = doc?.pinHash && typeof doc.pinHash === 'string' ? doc.pinHash : null;
  if (!hash) {
    const initialPin = getInitialAdminPin();
    const defaultHash = bcrypt.hashSync(initialPin, 10);
    await AdminPinModel.deleteMany({});
    await AdminPinModel.create({ pinHash: defaultHash });
    return defaultHash;
  }
  return hash;
}

async function mongoWriteAdminPinHash(pinHash) {
  await AdminPinModel.deleteMany({});
  await AdminPinModel.create({ pinHash });
}

async function mongoReadForceWithdraws() {
  const docs = await ForceWithdrawModel.find().sort({ createdAt: -1 }).lean();
  return docs.map((d) => {
    const { _id, __v, ...rest } = d;
    return rest;
  });
}

async function mongoAppendForceWithdraw(entry) {
  const id = entry.id || crypto.randomBytes(8).toString('hex');
  const doc = { id, ...entry, createdAt: entry.createdAt || new Date().toISOString() };
  await ForceWithdrawModel.create(doc);
  const idsToRemove = (await ForceWithdrawModel.find().select('_id').sort({ createdAt: 1 }).skip(2000)).map((d) => d._id);
  if (idsToRemove.length) await ForceWithdrawModel.deleteMany({ _id: { $in: idsToRemove } });
}

async function mongoReadChatMessages() {
  const docs = await ChatMessageModel.find().sort({ createdAt: 1 }).lean();
  return docs.map((d) => {
    const { _id, __v, ...rest } = d;
    return rest;
  });
}

async function mongoAppendChatMessage(msg) {
  const id = msg.id || crypto.randomBytes(8).toString('hex');
  const createdAt = msg.createdAt || new Date().toISOString();
  const payload = { id, userId: msg.userId, displayName: msg.displayName, text: msg.text || '', createdAt };
  if (msg.imageUrl) payload.imageUrl = msg.imageUrl;
  if (msg.replyToMessageId) payload.replyToMessageId = msg.replyToMessageId;
  if (msg.replyToText != null) payload.replyToText = String(msg.replyToText).slice(0, 100);
  await ChatMessageModel.create(payload);
  const count = await ChatMessageModel.countDocuments();
  if (count > CHAT_MAX_MESSAGES) {
    const toRemove = await ChatMessageModel.find().sort({ createdAt: 1 }).limit(count - CHAT_MAX_MESSAGES).select('_id');
    await ChatMessageModel.deleteMany({ _id: { $in: toRemove.map((d) => d._id) } });
  }
  return payload;
}

async function mongoUpdateChatMessage(messageId, userId, updates) {
  const doc = await ChatMessageModel.findOne({ id: messageId, userId });
  if (!doc) return null;
  if (updates.text !== undefined) doc.text = String(updates.text).trim().slice(0, 500);
  doc.editedAt = new Date().toISOString();
  await doc.save();
  const { _id, __v, ...rest } = doc.toObject();
  return rest;
}

async function mongoDeleteChatMessage(messageId, userId) {
  const result = await ChatMessageModel.deleteOne({ id: messageId, userId });
  return result.deletedCount ? true : null;
}

async function mongoClearChatMessages() {
  await ChatMessageModel.deleteMany({});
}

async function mongoIncrementMessageHearts(messageId) {
  await ChatMessageModel.updateOne({ id: messageId }, { $inc: { heartsReceived: 1 } });
}

async function mongoReadPinned() {
  const doc = await PinnedModel.findOne().lean();
  if (!doc) return null;
  const hasText = typeof doc.text === 'string';
  const expiresAt = doc.expiresAt ? new Date(doc.expiresAt).getTime() : 0;
  const pinnedExpired = expiresAt && Date.now() >= expiresAt;
  if (hasText && !pinnedExpired) {
    const { _id, __v, ...rest } = doc;
    return rest;
  }
  if (doc.lastItemUse && doc.lastItemUse.at) return { lastItemUse: doc.lastItemUse };
  if (pinnedExpired) await PinnedModel.deleteMany({});
  return null;
}

async function mongoWritePinned(obj) {
  await PinnedModel.deleteMany({});
  if (obj && Object.keys(obj).length) await PinnedModel.create(obj);
}

async function mongoReadSettings() {
  const doc = await SettingsModel.findOne().lean();
  if (!doc) return {};
  const { _id, __v, ...rest } = doc;
  return rest;
}

async function mongoWriteSettings(settings) {
  await SettingsModel.deleteMany({});
  if (settings && Object.keys(settings).length) await SettingsModel.create(settings);
}

async function mongoClearForceWithdraws() {
  await ForceWithdrawModel.deleteMany({});
}

async function mongoDeleteForceWithdrawByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const set = new Set(ids);
  const docs = await ForceWithdrawModel.find().lean();
  let removed = 0;
  for (const d of docs) {
    const id = d.id || 'legacy-' + d._id;
    if (set.has(id)) {
      await ForceWithdrawModel.deleteOne({ _id: d._id });
      removed++;
    }
  }
  return removed;
}

// ——— 세션 (MongoDB 모드일 때만 사용, Render 재시작/슬립 후에도 로그인 유지)
async function mongoGetSession(token) {
  if (!SessionModel || !token) return null;
  const now = Date.now();
  const doc = await SessionModel.findOne({ token }).lean();
  if (!doc || (doc.expiresAt && doc.expiresAt < now)) return null;
  const sess = {
    id: doc.id != null ? String(doc.id) : doc.id,
    displayName: doc.displayName,
    walletAddress: doc.walletAddress,
    isAdmin: !!doc.isAdmin,
    expiresAt: doc.expiresAt,
  };
  if (doc.adminPinVerified === true) sess.adminPinVerified = true;
  return sess;
}
async function mongoSetSession(token, data) {
  if (!SessionModel || !token) return;
  const update = {
    token,
    id: data.id != null ? String(data.id) : data.id,
    displayName: data.displayName,
    walletAddress: data.walletAddress || null,
    isAdmin: !!data.isAdmin,
    expiresAt: data.expiresAt,
  };
  if (data.adminPinVerified === true) update.adminPinVerified = true;
  await SessionModel.findOneAndUpdate(
    { token },
    { $set: update },
    { upsert: true }
  );
}
async function mongoDeleteSession(token) {
  if (!SessionModel || !token) return;
  await SessionModel.deleteOne({ token });
}
async function mongoDeleteSessionsByUserId(userId) {
  if (!SessionModel || !userId) return;
  await SessionModel.deleteMany({ id: userId });
}
async function mongoDeleteExpiredSessions() {
  if (!SessionModel) return;
  const now = Date.now();
  await SessionModel.deleteMany({ expiresAt: { $lt: now } });
}

async function repairOrphanSessions() {
  if (!SessionModel || !UserModel) return;
  const userIds = new Set((await mongoReadUsers()).map((u) => (u.id != null ? String(u.id) : '')).filter(Boolean));
  const sessions = await SessionModel.find({}, { token: 1, id: 1 }).lean();
  let removed = 0;
  for (const s of sessions) {
    const sid = s.id != null ? String(s.id) : '';
    if (!sid || !userIds.has(sid)) {
      await SessionModel.deleteOne({ token: s.token });
      removed++;
    }
  }
  if (removed) console.log('DB: 회원에 없는 세션', removed, '건 제거 (연동 꼬임 정리)');
}

async function getSession(token) {
  if (useMongo()) return mongoGetSession(token);
  // 파일 모드: 세션은 서버 메모리만 사용(재시작 시 로그아웃)
  return null;
}
async function setSession(token, data) {
  if (useMongo()) await mongoSetSession(token, data);
  // 파일 모드: 세션 파일에 저장하지 않음(재시작 시 로그아웃)
}
async function deleteSession(token) {
  if (useMongo()) await mongoDeleteSession(token);
  else await fileDeleteSession(token);
}
async function deleteSessionsByUserId(userId) {
  if (useMongo()) await mongoDeleteSessionsByUserId(userId);
  else await fileDeleteSessionsByUserId(userId);
}
async function deleteExpiredSessions() {
  if (useMongo()) await mongoDeleteExpiredSessions();
  else await fileDeleteExpiredSessions();
}

// ——— 통합 export (MONGODB_URI 있으면 Mongo, 없으면 파일) ———
const useMongo = () => !!process.env.MONGODB_URI?.trim();

let fileWatchersActive = false;
function setupFileWatchers() {
  if (fileWatchersActive) return;
  ensureDataDir();
  const keyByFilename = {};
  Object.entries(FILE_KEYS).forEach(([key, filePath]) => {
    keyByFilename[path.basename(filePath)] = key;
  });
  try {
    fs.watch(DATA_DIR, { persistent: false }, (event, filename) => {
      if (filename && keyByFilename[filename]) invalidateFileCache(keyByFilename[filename]);
    });
    fileWatchersActive = true;
    // 파일 변경 시 캐시 무효화됨 (로그 생략)
  } catch (err) {
    console.warn('Data dir watch failed:', err?.message);
  }
}

function hasFileDataToMigrate() {
  if (!fs.existsSync(DATA_DIR)) return false;
  const files = [USERS_FILE, FEED_FILE, POSTS_FILE, CHAT_FILE, SESSIONS_FILE, ADMIN_PIN_FILE, SETTINGS_FILE];
  for (const f of files) {
    if (fs.existsSync(f) && fs.statSync(f).size > 2) return true;
  }
  return false;
}

function stripMongoMeta(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  delete out._id;
  delete out.__v;
  return out;
}

async function migrateFileToMongo() {
  console.log('DB: data/*.json 데이터를 MongoDB로 마이그레이션 중 (upsert)...');
  const users = await fileReadUsers();
  const posts = await fileReadPosts();
  const feedPosts = await fileReadFeedPosts();
  const deletedFeedPosts = await fileReadDeletedFeedPosts();
  const deletedFeedComments = await fileReadDeletedFeedComments();
  const pinHash = await fileReadAdminPinHash();
  const forceWithdraws = await fileReadForceWithdraws();
  const chatMessages = await fileReadChatMessages();
  const pinned = await fileReadPinned();
  const settings = await fileReadSettings();
  const sessionsRaw = fileReadSessionsRaw();

  await connectMongo();

  const migratedUserIds = new Set();
  for (const user of users) {
    let id = user && user.id;
    if (id == null || id === '') continue;
    id = String(id);
    const payload = stripMongoMeta(user);
    payload.id = id;
    await UserModel.updateOne({ id }, { $set: payload }, { upsert: true });
    migratedUserIds.add(id);
  }
  if (users.length) console.log('  - users:', users.length);

  for (const post of posts) {
    const id = post && post.id;
    if (id == null) continue;
    await PostModel.updateOne({ id }, { $set: stripMongoMeta(post) }, { upsert: true });
  }
  if (posts.length) console.log('  - posts:', posts.length);

  for (const p of feedPosts) {
    const id = p && p.id;
    if (id == null) continue;
    await FeedModel.updateOne({ id }, { $set: stripMongoMeta(p) }, { upsert: true });
  }
  if (feedPosts.length) console.log('  - feed:', feedPosts.length);

  for (const p of deletedFeedPosts) {
    const id = p && p.id;
    if (id == null) continue;
    await DeletedFeedModel.updateOne({ id }, { $set: stripMongoMeta(p) }, { upsert: true });
  }
  if (deletedFeedPosts.length) console.log('  - deletedFeed:', deletedFeedPosts.length);

  for (const c of deletedFeedComments) {
    const id = c && c.id;
    if (id == null) continue;
    await DeletedFeedCommentModel.updateOne({ id }, { $set: stripMongoMeta(c) }, { upsert: true });
  }
  if (deletedFeedComments.length) console.log('  - deletedFeedComments:', deletedFeedComments.length);

  if (pinHash) {
    await AdminPinModel.updateOne({}, { $set: { pinHash } }, { upsert: true });
    console.log('  - adminPinHash: 1');
  }

  for (const entry of forceWithdraws) {
    const id = entry && (entry.id != null ? entry.id : crypto.randomBytes(8).toString('hex'));
    const doc = stripMongoMeta({ ...entry, id, createdAt: entry.createdAt || new Date().toISOString() });
    await ForceWithdrawModel.updateOne({ id }, { $set: doc }, { upsert: true });
  }
  if (forceWithdraws.length) console.log('  - forceWithdraws:', forceWithdraws.length);

  for (const msg of chatMessages) {
    const id = msg && msg.id;
    if (id == null) continue;
    const payload = { id, userId: msg.userId, displayName: msg.displayName, text: msg.text || '', createdAt: msg.createdAt || new Date().toISOString() };
    if (msg.imageUrl) payload.imageUrl = msg.imageUrl;
    if (msg.replyToMessageId) payload.replyToMessageId = msg.replyToMessageId;
    if (msg.replyToText != null) payload.replyToText = String(msg.replyToText).slice(0, 100);
    await ChatMessageModel.updateOne({ id }, { $set: stripMongoMeta(payload) }, { upsert: true });
  }
  if (chatMessages.length) console.log('  - chatMessages:', chatMessages.length);

  if (pinned && Object.keys(pinned).length) {
    await PinnedModel.updateOne({}, { $set: stripMongoMeta(pinned) }, { upsert: true });
    console.log('  - pinned: 1');
  }

  if (settings && Object.keys(settings).length) {
    await SettingsModel.updateOne({}, { $set: stripMongoMeta(settings) }, { upsert: true });
    console.log('  - settings: 1');
  }

  const sessionTokens = Object.keys(sessionsRaw);
  let sessionsMigrated = 0;
  for (const token of sessionTokens) {
    const data = sessionsRaw[token];
    if (!data || typeof data !== 'object') continue;
    const uid = data.id != null ? String(data.id) : '';
    if (!uid || !migratedUserIds.has(uid)) continue;
    await mongoSetSession(token, { ...data, id: uid });
    sessionsMigrated++;
  }
  if (sessionTokens.length) console.log('  - sessions:', sessionsMigrated, '(회원 DB에 있는 id만)');

  ensureDataDir();
  fs.writeFileSync(MIGRATED_FLAG_FILE, Date.now().toString(), 'utf8');
  console.log('DB: 마이그레이션 완료. 이후 MongoDB를 사용합니다.');
}

async function connect() {
  const wantMongo = !!process.env.MONGODB_URI?.trim();
  if (wantMongo) {
    if (fs.existsSync(MIGRATED_FLAG_FILE)) {
      await connectMongo();
      await repairOrphanSessions();
      console.log('DB: Using MongoDB (MONGODB_URI). 회원/세션 등은 MongoDB에 저장됩니다.');
      return true;
    }
    if (hasFileDataToMigrate()) {
      await migrateFileToMongo();
      return true;
    }
    await connectMongo();
    await repairOrphanSessions();
    console.log('DB: Using MongoDB (MONGODB_URI). 회원/세션 등은 MongoDB에 저장됩니다.');
    return true;
  }
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) atomicWriteFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
  setupFileWatchers();
  console.log('DB: Using file storage (data/*.json).');
  return false;
}

async function readUsers() {
  return useMongo() ? mongoReadUsers() : fileReadUsers();
}

async function writeUsers(users) {
  return useMongo() ? mongoWriteUsers(users) : fileWriteUsers(users);
}

async function readPosts() {
  return useMongo() ? mongoReadPosts() : fileReadPosts();
}

async function writePosts(posts) {
  return useMongo() ? mongoWritePosts(posts) : fileWritePosts(posts);
}

async function readFeedPosts() {
  return useMongo() ? mongoReadFeedPosts() : fileReadFeedPosts();
}

async function writeFeedPosts(posts) {
  return useMongo() ? mongoWriteFeedPosts(posts) : fileWriteFeedPosts(posts);
}

async function readDeletedFeedPosts() {
  return useMongo() ? mongoReadDeletedFeedPosts() : fileReadDeletedFeedPosts();
}

async function appendDeletedFeedPost(entry) {
  return useMongo() ? mongoAppendDeletedFeedPost(entry) : fileAppendDeletedFeedPost(entry);
}

async function removeDeletedFeedPost(postId) {
  return useMongo() ? mongoRemoveDeletedFeedPost(postId) : fileRemoveDeletedFeedPost(postId);
}

async function readDeletedFeedComments() {
  return useMongo() ? mongoReadDeletedFeedComments() : fileReadDeletedFeedComments();
}

async function appendDeletedFeedComment(entry) {
  return useMongo() ? mongoAppendDeletedFeedComment(entry) : fileAppendDeletedFeedComment(entry);
}

async function removeDeletedFeedComment(commentId) {
  return useMongo() ? mongoRemoveDeletedFeedComment(commentId) : fileRemoveDeletedFeedComment(commentId);
}

async function readAdminPinHash() {
  return useMongo() ? mongoReadAdminPinHash() : fileReadAdminPinHash();
}

async function writeAdminPinHash(pinHash) {
  return useMongo() ? mongoWriteAdminPinHash(pinHash) : fileWriteAdminPinHash(pinHash);
}

async function readForceWithdraws() {
  return useMongo() ? mongoReadForceWithdraws() : fileReadForceWithdraws();
}

async function appendForceWithdraw(entry) {
  return useMongo() ? mongoAppendForceWithdraw(entry) : fileAppendForceWithdraw(entry);
}

async function readChatMessages() {
  return useMongo() ? mongoReadChatMessages() : fileReadChatMessages();
}

async function appendChatMessage(msg) {
  return useMongo() ? mongoAppendChatMessage(msg) : fileAppendChatMessage(msg);
}

async function updateChatMessage(messageId, userId, updates) {
  return useMongo() ? mongoUpdateChatMessage(messageId, userId, updates) : fileUpdateChatMessage(messageId, userId, updates);
}

async function deleteChatMessage(messageId, userId) {
  return useMongo() ? mongoDeleteChatMessage(messageId, userId) : fileDeleteChatMessage(messageId, userId);
}

async function clearChatMessages() {
  return useMongo() ? mongoClearChatMessages() : fileClearChatMessages();
}

async function incrementMessageHearts(messageId) {
  return useMongo() ? mongoIncrementMessageHearts(messageId) : fileIncrementMessageHearts(messageId);
}

async function readPinned() {
  return useMongo() ? mongoReadPinned() : fileReadPinned();
}

async function writePinned(obj) {
  return useMongo() ? mongoWritePinned(obj) : fileWritePinned(obj);
}

async function readSettings() {
  return useMongo() ? mongoReadSettings() : fileReadSettings();
}

async function writeSettings(settings) {
  return useMongo() ? mongoWriteSettings(settings) : fileWriteSettings(settings);
}

async function clearForceWithdraws() {
  return useMongo() ? mongoClearForceWithdraws() : fileClearForceWithdraws();
}

async function deleteForceWithdrawByIds(ids) {
  return useMongo() ? mongoDeleteForceWithdrawByIds(ids) : fileDeleteForceWithdrawByIds(ids);
}

module.exports = {
  connect,
  readUsers,
  writeUsers,
  readPosts,
  writePosts,
  readFeedPosts,
  writeFeedPosts,
  readDeletedFeedPosts,
  appendDeletedFeedPost,
  removeDeletedFeedPost,
  readDeletedFeedComments,
  appendDeletedFeedComment,
  removeDeletedFeedComment,
  readAdminPinHash,
  writeAdminPinHash,
  readForceWithdraws,
  appendForceWithdraw,
  readChatMessages,
  appendChatMessage,
  updateChatMessage,
  deleteChatMessage,
  clearChatMessages,
  incrementMessageHearts,
  readPinned,
  writePinned,
  readSettings,
  writeSettings,
  clearForceWithdraws,
  deleteForceWithdrawByIds,
  getSession,
  setSession,
  deleteSession,
  deleteSessionsByUserId,
  deleteExpiredSessions,
};
