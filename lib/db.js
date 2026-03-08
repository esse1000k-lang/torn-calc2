﻿﻿const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHAT_FILE = path.join(DATA_DIR, 'chat.json');
const CHAT_MAX_MESSAGES = 200;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function atomicWriteJson(filePath, data) {
  ensureDataDir();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function connect() {
  ensureDataDir();
  return true;
}

async function readChatMessages() {
  const data = readJson(CHAT_FILE, { messages: [] });
  return Array.isArray(data.messages) ? data.messages : [];
}

async function appendChatMessage(message) {
  const messages = await readChatMessages();
  const payload = {
    id: message.id || crypto.randomBytes(8).toString('hex'),
    userId: String(message.userId || ''),
    displayName: String(message.displayName || '익명'),
    text: String(message.text || '').slice(0, 500),
    createdAt: message.createdAt || new Date().toISOString(),
    heartsReceived: Number(message.heartsReceived || 0),
    heartedBy: Array.isArray(message.heartedBy) ? message.heartedBy : [],
  };
  if (message.imageUrl) payload.imageUrl = String(message.imageUrl);
  if (message.replyToMessageId) payload.replyToMessageId = String(message.replyToMessageId);
  if (message.replyToText) payload.replyToText = String(message.replyToText).slice(0, 100);
  messages.push(payload);
  atomicWriteJson(CHAT_FILE, { messages: messages.slice(-CHAT_MAX_MESSAGES) });
  return payload;
}

async function updateChatMessage(messageId, userId, updates) {
  const messages = await readChatMessages();
  const index = messages.findIndex((message) => String(message.id) === String(messageId));
  if (index === -1) return null;
  if (String(messages[index].userId) !== String(userId)) return null;
  messages[index].text = String(updates.text || '').trim().slice(0, 500);
  messages[index].editedAt = new Date().toISOString();
  atomicWriteJson(CHAT_FILE, { messages });
  return messages[index];
}

async function deleteChatMessage(messageId, userId) {
  const messages = await readChatMessages();
  const index = messages.findIndex((message) => String(message.id) === String(messageId));
  if (index === -1) return null;
  if (String(messages[index].userId) !== String(userId)) return null;
  messages.splice(index, 1);
  atomicWriteJson(CHAT_FILE, { messages });
  return true;
}

async function clearChatMessages() {
  atomicWriteJson(CHAT_FILE, { messages: [] });
  return true;
}

async function incrementMessageHearts(messageId, userId) {
  const messages = await readChatMessages();
  const index = messages.findIndex((message) => String(message.id) === String(messageId));
  if (index === -1) return { ok: false, reason: 'not_found' };
  if (String(messages[index].userId) === String(userId)) return { ok: false, reason: 'self' };
  const heartedBy = Array.isArray(messages[index].heartedBy) ? messages[index].heartedBy : [];
  if (heartedBy.includes(String(userId))) return { ok: false, reason: 'duplicate' };
  heartedBy.push(String(userId));
  messages[index].heartedBy = heartedBy;
  messages[index].heartsReceived = Number(messages[index].heartsReceived || 0) + 1;
  atomicWriteJson(CHAT_FILE, { messages });
  return { ok: true, heartsReceived: messages[index].heartsReceived };
}

module.exports = {
  connect,
  readChatMessages,
  appendChatMessage,
  updateChatMessage,
  deleteChatMessage,
  clearChatMessages,
  incrementMessageHearts,
};
