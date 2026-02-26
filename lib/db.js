/**
 * DB 레이어 — MONGODB_URI 있으면 MongoDB, 없으면 기존 JSON 파일 사용 (모두 async 인터페이스)
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const FEED_FILE = path.join(DATA_DIR, 'feed.json');
const ADMIN_PIN_FILE = path.join(DATA_DIR, 'admin-pin.json');
const FORCE_WITHDRAWS_FILE = path.join(DATA_DIR, 'force-withdraws.json');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const PINNED_FILE = path.join(DATA_DIR, 'pinned.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const CHAT_MAX_MESSAGES = 200;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ——— 파일 모드 (동기 → Promise로 래핑) ———
async function fileReadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(data.users) ? data.users : [];
  } catch (err) {
    console.error('readUsers failed:', err?.message);
    return [];
  }
}

async function fileWriteUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2));
}

async function fileReadPosts() {
  ensureDataDir();
  if (!fs.existsSync(POSTS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
    return Array.isArray(data.posts) ? data.posts : [];
  } catch (_) {
    return [];
  }
}

async function fileWritePosts(posts) {
  ensureDataDir();
  fs.writeFileSync(POSTS_FILE, JSON.stringify({ posts }, null, 2));
}

async function fileReadFeedPosts() {
  ensureDataDir();
  if (!fs.existsSync(FEED_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FEED_FILE, 'utf8'));
    return Array.isArray(data.posts) ? data.posts : [];
  } catch (_) {
    return [];
  }
}

async function fileWriteFeedPosts(posts) {
  ensureDataDir();
  fs.writeFileSync(FEED_FILE, JSON.stringify({ posts }, null, 2));
}

function getInitialAdminPin() {
  const envPin = (process.env.INITIAL_ADMIN_PIN || '').trim();
  if (/^[0-9]{6}$/.test(envPin)) return envPin;
  return '000000';
}

async function fileReadAdminPinHash() {
  ensureDataDir();
  const initialPin = getInitialAdminPin();
  if (!fs.existsSync(ADMIN_PIN_FILE)) {
    const pinHash = bcrypt.hashSync(initialPin, 10);
    fs.writeFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash }, null, 2));
    return pinHash;
  }
  try {
    const data = JSON.parse(fs.readFileSync(ADMIN_PIN_FILE, 'utf8'));
    const hash = data.pinHash && typeof data.pinHash === 'string' ? data.pinHash : null;
    if (!hash) {
      const defaultHash = bcrypt.hashSync(initialPin, 10);
      fs.writeFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash: defaultHash }, null, 2));
      return defaultHash;
    }
    return hash;
  } catch (_) {
    const defaultHash = bcrypt.hashSync(initialPin, 10);
    fs.writeFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash: defaultHash }, null, 2));
    return defaultHash;
  }
}

async function fileWriteAdminPinHash(pinHash) {
  ensureDataDir();
  fs.writeFileSync(ADMIN_PIN_FILE, JSON.stringify({ pinHash }, null, 2));
}

async function fileReadForceWithdraws() {
  ensureDataDir();
  if (!fs.existsSync(FORCE_WITHDRAWS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(FORCE_WITHDRAWS_FILE, 'utf8'));
    return Array.isArray(data.entries) ? data.entries : [];
  } catch (_) {
    return [];
  }
}

async function fileAppendForceWithdraw(entry) {
  const entries = await fileReadForceWithdraws();
  const id = entry.id || crypto.randomBytes(8).toString('hex');
  entries.unshift({ id, ...entry, createdAt: entry.createdAt || new Date().toISOString() });
  const trimmed = entries.slice(0, 2000);
  ensureDataDir();
  fs.writeFileSync(FORCE_WITHDRAWS_FILE, JSON.stringify({ entries: trimmed }, null, 2));
}

async function fileReadChatMessages() {
  ensureDataDir();
  if (!fs.existsSync(CHAT_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    return Array.isArray(data.messages) ? data.messages : [];
  } catch (_) {
    return [];
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
  ensureDataDir();
  fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages: trimmed }, null, 2));
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
  ensureDataDir();
  fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages }, null, 2));
  return messages[idx];
}

async function fileDeleteChatMessage(messageId, userId) {
  const messages = await fileReadChatMessages();
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1 || messages[idx].userId !== userId) return null;
  messages.splice(idx, 1);
  ensureDataDir();
  fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages }, null, 2));
  return true;
}

async function fileClearChatMessages() {
  ensureDataDir();
  fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages: [] }, null, 2));
}

async function fileIncrementMessageHearts(messageId) {
  const messages = await fileReadChatMessages();
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;
  messages[idx].heartsReceived = (messages[idx].heartsReceived || 0) + 1;
  ensureDataDir();
  fs.writeFileSync(CHAT_FILE, JSON.stringify({ messages }, null, 2));
}

async function fileReadPinned() {
  ensureDataDir();
  if (!fs.existsSync(PINNED_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(PINNED_FILE, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    const hasText = typeof data.text === 'string';
    const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
    const pinnedExpired = expiresAt && Date.now() >= expiresAt;
    if (hasText && !pinnedExpired) return data;
    if (data.lastItemUse && data.lastItemUse.at) return { lastItemUse: data.lastItemUse };
    if (pinnedExpired) fs.unlinkSync(PINNED_FILE);
    return null;
  } catch (_) {
    return null;
  }
}

async function fileWritePinned(obj) {
  ensureDataDir();
  fs.writeFileSync(PINNED_FILE, JSON.stringify(obj, null, 2));
}

async function fileReadSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

async function fileWriteSettings(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

async function fileClearForceWithdraws() {
  ensureDataDir();
  fs.writeFileSync(FORCE_WITHDRAWS_FILE, JSON.stringify({ entries: [] }, null, 2));
}

async function fileDeleteForceWithdrawByIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0;
  const set = new Set(ids);
  const entries = await fileReadForceWithdraws();
  const kept = entries.filter((e, i) => !set.has(e.id || 'legacy-' + i));
  ensureDataDir();
  fs.writeFileSync(FORCE_WITHDRAWS_FILE, JSON.stringify({ entries: kept }, null, 2));
  return entries.length - kept.length;
}

// ——— MongoDB 모드 ———
let mongoose;
let UserModel;
let PostModel;
let FeedModel;
let ChatMessageModel;
let AdminPinModel;
let PinnedModel;
let SettingsModel;
let ForceWithdrawModel;

async function connectMongo() {
  // Render 등에서 앞뒤 공백·따옴표, 또는 주석(//) 줄이 붙으면 오류 나므로 정리
  let uri = (process.env.MONGODB_URI || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^\s*\/\/[^\n]*\n?/, ''); // 앞쪽 "// ..." 줄 제거
  uri = uri.trim();
  if (!uri) return false;
  mongoose = require('mongoose');
  const { Schema } = mongoose;

  UserModel = mongoose.model('User', new Schema({}, { strict: false }));
  PostModel = mongoose.model('Post', new Schema({}, { strict: false }));
  FeedModel = mongoose.model('Feed', new Schema({}, { strict: false }));
  ChatMessageModel = mongoose.model('ChatMessage', new Schema({}, { strict: false }));
  AdminPinModel = mongoose.model('AdminPin', new Schema({ pinHash: String }, { strict: false }));
  PinnedModel = mongoose.model('Pinned', new Schema({}, { strict: false }));
  SettingsModel = mongoose.model('Settings', new Schema({}, { strict: false }));
  ForceWithdrawModel = mongoose.model('ForceWithdraw', new Schema({}, { strict: false }));

  try {
    const userMatch = uri.match(/^mongodb(\+srv)?:\/\/([^:]+):/);
    if (userMatch) console.log('MongoDB connecting as user:', userMatch[2]);
    await mongoose.connect(uri);
    console.log('MongoDB connected');
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

// ——— 통합 export (MONGODB_URI 있으면 Mongo, 없으면 파일) ———
const useMongo = () => !!process.env.MONGODB_URI?.trim();

async function connect() {
  if (useMongo()) return connectMongo();
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
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
};
