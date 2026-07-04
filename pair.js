const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const yts = require('yt-search');
const FileType = require('file-type');
const { MongoClient } = require('mongodb');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('dct-dev-private-baileys');

// ==================== CONFIG ====================

const BOT_NAME_FANCY = '༺ ALONE X MD ꙰༻';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'false',
  AUTO_LIKE_EMOJI: ['💙', '🩷', '💜', '🤎', '🧡', '🩵', '💛', '🩶', '♥️', '💗', '❤️‍🔥'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  API_YTMP3_URL: 'https://ytmp3-download-api.vercel.app' ,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/FX7jMpuMgVYEBW8TCLi5H5',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/5jrs12.jpeg',
  NEWSLETTER_JID: [
      '120363428670000697@newsletter'],
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER ? process.env.OWNER_NUMBER.split(',') : ['94787940686','94743387798'],
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbDH0dj7T8bXPXQFoM0B',
  BOT_NAME: '© ༺ ALONE X MD ꙰༻',
  BOT_VERSION: '8.0.0 ULTRA',
  OWNER_NAME: 'MADUSANKA,DULA DEV',
  IMAGE_PATH: 'https://files.catbox.moe/5jrs12.jpeg',
  BOT_FOOTER: '> *© ༺ ALONE X MD ꙰༻*',
  
  // Default settings values
  DEFAULT_SETTINGS: {
    WORK_TYPE: 'public',
    AUTO_VIEW_STATUS: 'true',
    AUTO_REPLY: 'true',
    AUTO_VOICE: 'on',
    AUTO_STICKER: 'false',
    ANTI_BAD: 'false',
    ANTI_LINK: 'false',
    ANTI_BOT: 'false',
    PRESENCE: 'online',
    READ_COMMAND: 'true',
    AUTO_RECORDING: 'false',
    AUTO_TYPING: 'false',
    AUTO_LIKE_STATUS: 'true',
    BAD_NO_BLOCK: 'false',
    AI_CHAT: 'true',
    ANTI_CALL: 'off',
    WELCOME_GOODBYE: 'false',
    ANTI_DELETE: 'off',
    AUTO_TIKTOK: 'false',
    AUTO_NEWS: 'false',
    AUTO_REPLY_MODE: 'default',
    MOVIE_MODE: 'public'
  }
};

// ==================== MONGO SETUP ====================

// Config cache to avoid repeated database queries
const configCache = new Map();
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://dct-dula:dct-ninja-x-md@dctninja.gxfynay.mongodb.net/?appName=dctninja';
const MONGO_DB = process.env.MONGO_DB || 'DCT_NINJA_DB';

let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;
let mongoInitialized = false;
let mongoInitPromise = null;

async function initMongo() {
  if (mongoInitialized && mongoClient) return;
  if (mongoInitPromise) return mongoInitPromise;
  
  mongoInitPromise = (async () => {
    try {
      if (mongoClient?.topology?.isConnected) return;
    } catch (e) { }
    
    mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true, maxPoolSize: 10 });
    await mongoClient.connect();
    mongoDB = mongoClient.db(MONGO_DB);

    sessionsCol = mongoDB.collection('sessions');
    numbersCol = mongoDB.collection('numbers');
    adminsCol = mongoDB.collection('admins');
    newsletterCol = mongoDB.collection('newsletter_list');
    configsCol = mongoDB.collection('configs');
    newsletterReactsCol = mongoDB.collection('newsletter_reacts');

    await Promise.all([
      sessionsCol.createIndex({ number: 1 }, { unique: true }),
      numbersCol.createIndex({ number: 1 }, { unique: true }),
      newsletterCol.createIndex({ jid: 1 }, { unique: true }),
      newsletterReactsCol.createIndex({ jid: 1 }, { unique: true }),
      configsCol.createIndex({ number: 1 }, { unique: true })
    ]);
    
    mongoInitialized = true;
    console.log('✅ Mongo initialized and collections ready');
  })();
  
  return mongoInitPromise;
}

// ==================== Mongo Helpers ====================

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    if (!sessionsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    if (!sessionsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
  try {
    if (!sessionsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
  } catch (e) { console.error('removeSessionFromMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    if (!numbersCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
  try {
    if (!numbersCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
  } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    if (!numbersCol || !mongoInitialized) await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    if (!adminsCol || !mongoInitialized) await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    if (!adminsCol || !mongoInitialized) await initMongo();
    const doc = { jid: jidOrNumber };
    await adminsCol.updateOne({ jid: jidOrNumber }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    if (!adminsCol || !mongoInitialized) await initMongo();
    await adminsCol.deleteOne({ jid: jidOrNumber });
  } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function addNewsletterToMongo(jid, emojis = []) {
  try {
    if (!newsletterCol || !mongoInitialized) await initMongo();
    const doc = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date() };
    await newsletterCol.updateOne({ jid }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
  try {
    if (!newsletterCol || !mongoInitialized) await initMongo();
    await newsletterCol.deleteOne({ jid });
  } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
  try {
    if (!newsletterCol || !mongoInitialized) await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function listNewsletterReactsFromMongo() {
  try {
    if (!newsletterReactsCol || !mongoInitialized) await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    if (!mongoDB || !mongoInitialized) await initMongo();
    const col = mongoDB.collection('newsletter_reactions_log');
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    await col.insertOne(doc);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    if (!configsCol || !mongoInitialized) await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
    // Invalidate cache
    configCache.delete(sanitized);
  } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
  try {
    const sanitized = number.replace(/[^0-9]/g, '');
    
    // Check cache first
    const cached = configCache.get(sanitized);
    if (cached && Date.now() - cached.time < CONFIG_CACHE_TTL) {
      return cached.config;
    }
    
    if (!configsCol || !mongoInitialized) await initMongo();
    const doc = await configsCol.findOne({ number: sanitized });
    const userConfig = doc ? doc.config : {};
    const result = { ...config.DEFAULT_SETTINGS, ...userConfig };
    
    // Cache the result
    configCache.set(sanitized, { config: result, time: Date.now() });
    return result;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return { ...config.DEFAULT_SETTINGS }; }
}

// ==================== Basic Utils ====================

function formatMessage(title, content, footer) {
  return `${title}\n\n${content}\n\n> *${footer}*`;
}
function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp() { return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();
const socketCreationTime = new Map();
const otpStore = new Map();

// ==================== Helpers ====================

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
  const botName = sessionConfig.botName || BOT_NAME_FANCY;
  const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
  const caption = formatMessage(botName, `*📞 𝗡ᴜᴍʙᴇʀ:* ${number}\n*🍁 𝗦ᴛᴀᴛᴜꜱ:* ${groupStatus}\n*🕒 𝗖ᴏɴɴᴇᴄᴛᴇᴅ 𝗔ᴛ:* ${getSriLankaTimestamp()}`, botName);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      if (String(image).startsWith('http')) {
        await socket.sendMessage(to, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(to, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    } catch (err) {
      console.error('Failed to send connect message to admin', admin, err?.message || err);
    }
  }
}

async function sendOwnerConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  try {
    const ownerNumbers = config.OWNER_NUMBER.map(num => `${num.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
    const activeCount = activeSockets.size;
    const botName = sessionConfig.botName || BOT_NAME_FANCY;
    const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
    const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(`*🥷 𝗢ᴡɴᴇʀ 𝗖ᴏɴᴛᴀᴄᴛ: ${botName}*`, 
      `*📞 𝗡ᴜᴍʙᴇʀ:* ${number}\n*🍁 𝗦ᴛᴀᴛᴜꜱ:* ${groupStatus}\n*🕒 𝗖ᴏɴɴᴇᴄᴛᴇᴅ 𝗔ᴛ:* ${getSriLankaTimestamp()}\n\n*🔢 𝗔ᴄᴛɪᴠᴇ 𝗦ᴇꜱꜱɪᴏɴꜱ:* ${activeCount}`, 
      botName);

    for (const ownerJid of ownerNumbers) {
      if (String(image).startsWith('http')) {
        await socket.sendMessage(ownerJid, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(ownerJid, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    }
  } catch (err) { console.error('Failed to send owner connect message:', err); }
}

async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`*🔐 𝐎𝚃𝙿 𝐕𝙴𝚁𝙸𝙵𝙸𝙲𝙰𝚃𝙸𝙾𝙽 — ${BOT_NAME_FANCY}*`, `*𝐘𝙾𝚄𝚁 𝐎𝚃𝙿 𝐅𝙾𝚁 𝐂𝙾𝙽𝙵𝙸𝙶 𝐔𝙿𝙳𝙰𝚃𝙴 𝐈𝚂:* *${otp}*\n𝐓𝙷𝙸𝚂 𝐎𝚃𝙿 𝐖𝙸𝙻𝙻 𝐄𝚇𝙿𝙸𝚁𝙴 𝐈𝙽 5 𝐌𝙸𝙽𝚄𝚃𝙴𝚂.\n\n*𝐍𝚄𝙼𝙱𝙴𝚁:* ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ==================== Handlers ====================

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      const followedDocs = await listNewslettersFromMongo();
      const reactConfigs = await listNewsletterReactsFromMongo();
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      const followedMap = new Map(followedDocs.map(d => [d.jid, d]));
      if (!followedMap.has(jid) && !reactMap.has(jid)) return;

      let emojis = reactMap.get(jid) || null;
      if ((!emojis || emojis.length === 0) && followedMap.has(jid)) {
        emojis = (followedMap.get(jid).emojis || []);
      }
      if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
          break;
        } catch (err) {
          console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await delay(1200);
        }
      }

    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}

async function setupStatusHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

    try {
      let userEmojis = config.AUTO_LIKE_EMOJI;
      let autoViewStatus = config.AUTO_VIEW_STATUS;
      let autoLikeStatus = config.AUTO_LIKE_STATUS;
      let autoRecording = config.AUTO_RECORDING;

      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};

        if (userConfig.AUTO_LIKE_EMOJI && Array.isArray(userConfig.AUTO_LIKE_EMOJI) && userConfig.AUTO_LIKE_EMOJI.length > 0) {
          userEmojis = userConfig.AUTO_LIKE_EMOJI;
        }
        if (userConfig.AUTO_VIEW_STATUS !== undefined) autoViewStatus = userConfig.AUTO_VIEW_STATUS;
        if (userConfig.AUTO_LIKE_STATUS !== undefined) autoLikeStatus = userConfig.AUTO_LIKE_STATUS;
        if (userConfig.AUTO_RECORDING !== undefined) autoRecording = userConfig.AUTO_RECORDING;
      }

      if (autoRecording === 'true') {
        await socket.sendPresenceUpdate("recording", message.key.remoteJid);
      }

      if (autoViewStatus === 'true') {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.readMessages([message.key]);
            break;
          } catch (error) {
            retries--;
            await delay(1000 * (config.MAX_RETRIES - retries));
            if (retries === 0) throw error;
          }
        }
      }

      if (autoLikeStatus === 'true') {
        const randomEmoji = userEmojis[Math.floor(Math.random() * userEmojis.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(message.key.remoteJid, {
              react: { text: randomEmoji, key: message.key }
            }, { statusJidList: [message.key.participant] });
            break;
          } catch (error) {
            retries--;
            await delay(1000 * (config.MAX_RETRIES - retries));
            if (retries === 0) throw error;
          }
        }
      }

    } catch (error) {
      console.error('Status handler error:', error);
    }
  });
}

async function handleMessageRevocation(socket, number) {
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys || keys.length === 0) return;
    const messageKey = keys[0];
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    const mode = userConfig.ANTI_DELETE || 'off';
    if (mode === 'off') return;

    const isGroup = String(messageKey.remoteJid || '').endsWith('@g.us');
    if (mode === 'inbox' && isGroup) return;
    if (mode === 'group' && !isGroup) return;

    const userJid = jidNormalizedUser(socket.user.id);
    const deletionTime = getSriLankaTimestamp();
    const message = formatMessage('*🗑️ 𝗠ᴇꜱꜱᴀɢᴇ 𝗗ᴇʟᴇᴛᴇᴅ*', `A message was deleted from your chat.\n*📋 𝗙ʀᴏᴍ:* ${messageKey.remoteJid}\n*🍁 𝗗ᴇʟᴇᴛɪᴏɴ 𝗧ɪᴍᴇ:* ${deletionTime}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
    catch (error) { console.error('Failed to send deletion notification:', error); }
  });
}

async function setupWelcomeGoodbye(socket, sessionNumber) {
  socket.ev.on('group-participants.update', async (update) => {
    try {
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      if (userConfig.WELCOME_GOODBYE !== 'true') return;

      const groupId = update.id;
      const participants = update.participants || [];
      if (!participants.length) return;

      try {
        const groupMetadata = await socket.groupMetadata(groupId);
        const groupName = groupMetadata?.subject || "Our Group";
        const memberCount = groupMetadata?.participants?.length || 0;

        for (const participant of participants) {
          const userId = participant.split('@')[0];

          if (update.action === 'add') {
            const welcomeMsg = `
╭━━━〔 🌟 W E L C O M E 🌟 〕━━━⬣

👋 Hey *@${userId}* ✨
🎉 Welcome to *${groupName}*

╭━━━〔 💎 GROUP INFO 〕━━━⬣
┃ 👥 Members : ${memberCount}
┃ 🏷️ Status : New Member
╰━━━━━━━━━━━━━━⬣

╭━━━〔 📌 RULES 〕━━━⬣
┃ 🔹 Be respectful 🤝
┃ 🔹 No spam 🚫
┃ 🔹 Enjoy & stay active 💬
╰━━━━━━━━━━━━━━⬣

╭━━━〔 🌈 MESSAGE 〕━━━⬣
┃ 💖 We're happy to have you here!
┃ 🚀 Hope you enjoy your stay
╰━━━━━━━━━━━━━━⬣

╭━━━〔 ✨ ENJOY ✨ 〕━━━⬣
╰━━━━━━━━━━━━━━⬣
`;
            await socket.sendMessage(groupId, {
              image: { url: userConfig.logo || config.RCD_IMAGE_PATH },
              caption: welcomeMsg,
              mentions: [participant]
            });
          } else if (update.action === 'remove') {
            const goodbyeMsg = `
╭━━━〔 🌙 G O O D B Y E 🌙 〕━━━⬣

👋 Bye *@${userId}* 💔
🚪 You left *${groupName}*

╭━━━〔 📊 GROUP STATUS 〕━━━⬣
┃ 👥 Members Left : ${memberCount - 1}
┃ 🏷️ Status : Left Group
╰━━━━━━━━━━━━━━⬣

╭━━━〔 💔 MESSAGE 〕━━━⬣
┃ 😢 You will be missed here
┃ 🤍 Doors always open for you
╰━━━━━━━━━━━━━━⬣

╭━━━〔 🌌 TAKE CARE 🌌 〕━━━⬣
┃ 🌟 Stay safe & happy
┃ 💫 Hope to see you again
╰━━━━━━━━━━━━━━⬣
`;
            await socket.sendMessage(groupId, {
              image: { url: userConfig.logo || config.RCD_IMAGE_PATH },
              caption: goodbyeMsg,
              mentions: [participant]
            });
          }
        }
      } catch (metaErr) {
        console.error('Failed to get group metadata:', metaErr);
      }
    } catch (err) {
      console.error('WelcomeGoodbye error:', err);
    }
  });
}

async function setupCallRejection(socket, sessionNumber) {
  socket.ev.on('call', async (calls) => {
    try {
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      if (userConfig.ANTI_CALL !== 'on') return;

      for (const call of calls) {
        if (call.status !== 'offer') continue;
        const id = call.id;
        const from = call.from;
        await socket.rejectCall(id, from);
        await socket.sendMessage(from, { text: '*🔕 Auto call rejection is enabled. Calls are automatically rejected.*' });
        const userJid = jidNormalizedUser(socket.user.id);
        const rejectionMessage = formatMessage('📞 CALL REJECTED', `Auto call rejection is active.\n\nCall from: ${from}\nTime: ${getSriLankaTimestamp()}`, BOT_NAME_FANCY);
        await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: rejectionMessage });
      }
    } catch (err) {
      console.error(`Call rejection error for ${sessionNumber}:`, err);
    }
  });
}

async function setupAutoMessageRead(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    const autoReadSetting = userConfig.READ_COMMAND || 'false';

    if (autoReadSetting !== 'true') return;

    let body = '';
    try {
      const type = getContentType(msg.message);
      const actualMsg = (type === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

      if (type === 'conversation') body = actualMsg.conversation || '';
      else if (type === 'extendedTextMessage') body = actualMsg.extendedTextMessage?.text || '';
    } catch (e) { body = ''; }

    const prefix = userConfig.PREFIX || config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);

    if (isCmd) {
      try { await socket.readMessages([msg.key]); } catch (error) { console.warn('Failed to read command message:', error?.message); }
    }
  });
}

async function setupMessageHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    try {
      let autoTyping = false;
      let autoRecording = false;

      if (sessionNumber) {
        const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
        if (userConfig.AUTO_TYPING === 'true') autoTyping = true;
        if (userConfig.AUTO_RECORDING === 'true') autoRecording = true;
      }

      if (autoTyping) {
        try {
          await socket.sendPresenceUpdate('composing', msg.key.remoteJid);
          setTimeout(async () => { try { await socket.sendPresenceUpdate('paused', msg.key.remoteJid); } catch (e) { } }, 3000);
        } catch (e) { console.error('Auto typing error:', e); }
      }

      if (autoRecording) {
        try {
          await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
          setTimeout(async () => { try { await socket.sendPresenceUpdate('paused', msg.key.remoteJid); } catch (e) { } }, 3000);
        } catch (e) { console.error('Auto recording error:', e); }
      }
    } catch (error) {
      console.error('Message handler error:', error);
    }
  });
}

// ==================== AUTO VOICE HANDLER ====================

async function setupAutoVoice(socket, sessionNumber) {
  const voiceReplies = {
    'gm': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/gm.ogg',
    'good morning': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/gm.ogg',
    'gn': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/gn.mp3',
    'good night': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/good%20night.mp3',
    'hi': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
    'hey': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
    'hello': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
    'helo': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
    'hy': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
    'bye': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bye%20lassana%20lamayo.ogg',
    'hm': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bye%20lassana%20lamayo.ogg',
    'mk': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/mk.ogg',
    'mokada karanne': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/mk.ogg',
    'adareyi': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',
    'ආදරෙයි': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',
    'love you': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',
    'i love you': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/adarei.mp3',
    'ha ha': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/hako.mp3',
    'hako': 'https://github.com/TECH-HORIZON-SCHOOL-OFFICIAL/PROJECT_HORIZON/raw/refs/heads/main/voice%20clips/hako.mp3',
    'bot': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/hi%20lassana%20lamayo.ogg',
    'hutta': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'pakaya': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'ponnaya': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'utta': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'ponz': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'wesigeputha': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'huttigeputha': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'huththa': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg',
    'huththigeputha': 'https://raw.githubusercontent.com/dct-dula/database/48c3556468d3f7f81ce6b4ec974a83f2aea1b467/voice/bad%20words.ogg'
  };

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.fromMe) return;
    if (msg.key.remoteJid === 'status@broadcast') return;

    try {
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      if (userConfig.AUTO_VOICE === 'off') return;

      const msgType = getContentType(msg.message);
      let body = '';
      if (msgType === 'conversation') body = msg.message.conversation || '';
      else if (msgType === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
      if (!body) return;

      const bodyLower = body.trim().toLowerCase();
      const voiceUrl = voiceReplies[bodyLower];
      if (!voiceUrl) return;

      try {
        const voiceResponse = await axios.get(voiceUrl, { responseType: 'arraybuffer' });
        const voiceBuffer = Buffer.from(voiceResponse.data);
        await socket.sendMessage(msg.key.remoteJid, {
          audio: voiceBuffer,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true
        }, { quoted: msg });
        console.log(`🎵 Auto voice sent for: ${bodyLower}`);
      } catch (voiceErr) {
        console.error('Auto voice send error:', voiceErr?.message || voiceErr);
      }
    } catch (err) {
      console.error('setupAutoVoice error:', err);
    }
  });
}

// ==================== AUTO REPLY HANDLER ====================

async function setupAutoReply(socket, sessionNumber) {
  const autoReplies = {
    'hi': '👋 *𝗛ᴇʏ!* 𝗧ʜᴀɴᴋꜱ ꜰᴏʀ ᴍᴇꜱꜱᴀɢɪɴɢ! 😊\n\n_𝘐 𝘢𝘮 𝘤𝘶𝘳𝘳𝘦𝘯𝘵𝘭𝘺 𝘣𝘶𝘴𝘺. 𝘐 𝘸𝘪𝘭𝘭 𝘳𝘦𝘱𝘭𝘺 𝘴𝘰𝘰𝘯!_\n\n> *© ༺ ALONE X MD ꙰༻*',
    'hey': '👋 *𝗛ᴇʏ!* 𝗧ʜᴀɴᴋꜱ ꜰᴏʀ ᴍᴇꜱꜱᴀɢɪɴɢ! 😊\n\n_𝘐 𝘢𝘮 𝘤𝘶𝘳𝘳𝘦𝘯𝘵𝘭𝘺 𝘣𝘶𝘴𝘺. 𝘐 𝘸𝘪𝘭𝘭 𝘳𝘦𝘱𝘭𝘺 𝘴𝘰𝘰𝘯!_\n\n> *© ༺ ALONE X MD ꙰༻*',
    'hello': '👋 *𝗛ᴇʟʟᴏ!* 𝗧ʜᴀɴᴋꜱ ꜰᴏʀ ʀᴇᴀᴄʜɪɴɢ ᴏᵁᴛ! 😊\n\n_𝘐 𝘢𝘮 𝘤𝘶𝘳𝘳𝘦𝘯𝘵𝘭𝘺 𝘣𝘶𝘴𝘺. 𝘐 𝘸𝘪𝘭𝘭 𝘳𝘦𝘱𝘭𝘺 𝘴𝘰𝘰𝘯!_\n\n> *© ༺ ALONE X MD ꙰༻*',
    'helo': '👋 *𝗛ᴇʟʟᴏ!* 𝗧ʜᴀɴᴋꜱ ꜰᴏʀ ʀᴇᴀᴄʜɪɴɢ ᴏᴜᴛ! 😊\n\n_𝘐 𝘢𝘮 𝘤𝘶𝘳𝘳𝘦𝘯𝘵𝘭𝘺 𝘣𝘶𝘴𝘺. 𝘐 𝘸𝘪𝘭𝘭 𝘳𝘦𝘱𝘭𝘺 𝘴𝘰𝘰𝘯!_\n\n> *© ༺ ALONE X MD ꙰༻*',
    'hy': '👋 *𝗛ᴇʏ!* 𝗧ʜᴀɴᴋꜱ ꜰᴏʀ ᴍᴇꜱꜱᴀɢɪɴɢ! 😊\n\n_𝘐 𝘢𝘮 𝘤𝘶𝘳𝘳𝘦𝘯𝘵𝘭𝘺 𝘣𝘶𝘴𝘺. 𝘐 𝘸𝘪𝘭𝘭 𝘳𝘦𝘱𝘭𝘺 𝘴𝘰𝘰𝘯!_\n\n> *© ༺ ALONE X MD ꙰༻*',
    'gm': '🌅 *𝗚ᴏᴏᴅ 𝗠ᴏʀɴɪɴɢ!* ☀️\n\n_𝘏𝘢𝘷𝘦 𝘢 𝘣𝘦𝘢𝘶𝘵𝘪𝘧𝘶𝘭 𝘥𝘢𝘺 𝘢𝘩𝘦𝘢𝘥!_ 🌸\n\n> *© ༺ ALONE X MD ꙰༻*',
    'good morning': '🌅 *𝗚ᴏᴏᴅ 𝗠ᴏʀɴɪɴɢ!* ☀️\n\n_𝘏𝘢𝘷𝘦 𝘢 𝘣𝘦𝘢𝘶𝘵𝘪𝘧𝘶𝘭 𝘥𝘢𝘺 𝘢𝘩𝘦𝘢𝘥!_ 🌸\n\n> *© ༺ ALONE X MD ꙰༻*',
    'gn': '🌙 *𝗚ᴏᴏᴅ 𝗡ɪɢʜᴛ!* 😴\n\n_𝘚𝘸𝘦𝘦𝘵 𝘥𝘳𝘦𝘢𝘮𝘴!_ 💤\n\n> *© ༺ ALONE X MD ꙰༻*',
    'good night': '🌙 *𝗚ᴏᴏᴅ 𝗡ɪɢʜᴛ!* 😴\n\n_𝘚𝘸𝘦𝘦𝘵 𝘥𝘳𝘦𝘢𝘮𝘴!_ 💤\n\n> *© ༺ ALONE X MD ꙰༻*',
    'bye': '👋 *𝗚ᴏᴏᴅʙʏᴇ!* 🌸\n\n_𝘛𝘢𝘬𝘦 𝘤𝘢𝘳𝘦 & 𝘴𝘵𝘢𝘺 𝘴𝘢𝘧𝘦!_ 💙\n\n> *© ༺ ALONE X MD ꙰༻*',
    'ok': '✅ *𝗢𝗸!* 😊\n\n> *© ༺ ALONE X MD ꙰༻*',
    'okay': '✅ *𝗢𝗸𝗮𝘆!* 😊\n\n> *© ༺ ALONE X MD ꙰༻*',
    'thanks': '🙏 *𝗧ʜᴀɴᴋ 𝘆ᴏᴜ!* 😊 𝗠𝘆 ᴘʟᴇᴀꜱᴜʀᴇ! 💙\n\n> *© ༺ ALONE X MD ꙰༻*',
    'thank you': '🙏 *𝗬𝗼𝘂 ᴀʀᴇ ᴡᴇʟᴄᴏᴍᴇ!* 😊 𝗔ɴʏᵗɪᴍᴇ! 💙\n\n> *© ༺ ALONE X MD ꙰༻*',
    'love you': '❤️ *𝗟ᴏᴠᴇ 𝘆ᴏᴜ ᴛᴏᴏ!* 😘\n\n> *© ༺ ALONE X MD ꙰༻*',
    'i love you': '❤️ *𝗟ᴏᴠᴇ 𝘆ᴏᴜ ᴛᴏᴏ!* 😘\n\n> *© ༺ ALONE X MD ꙰༻*',
    'adareyi': '❤️ *𝗔ᴅᴀʀᴇʏɪ!* 😘\n\n> *© ༺ ALONE X MD ꙰༻*',
    'how are you': '😊 *𝗜 ᴀᴍ ᴅᴏɪɴɢ ɢʀᴇᴀᴛ! 𝗧ʜᴀɴᴋꜱ ꜰᴏʀ ᴀꜱᴋɪɴɢ!* 💙\n\n> *© ༺ ALONE X MD ꙰༻*',
    'hru': '😊 *𝗜 ᴀᴍ ᴅᴏɪɴɢ ɢʀᴇᴀᴛ! 𝗧ʜᴀɴᴋꜱ ꜰᴏʀ ᴀꜱᴋɪɴɢ!* 💙\n\n> *© ༺ ALONE X MD ꙰༻*',
    'bot': '🤖 *𝗬𝗲𝘀! 𝗜 ᴀᴍ ᴀ ʙᴏᴛ!*\n\n𝗧𝘆ᴘᴇ *.menu* ᴛᴏ ꜱᴇᴇ ᴀʟʟ ᴄᴏᴍᴍᴀɴᴅꜱ! ⚡\n\n> *© ༺ ALONE X MD ꙰༻*',
    'who are you': '🤖 *𝗜 ᴀᴍ ༺ ALONE X MD ꙰༻!*\n\n𝗔 ᴘᴏᴡᴇʀꜰᴜʟ 𝗪ʜᴀᴛꜱᴀᴘᴘ 𝗕ᴏᴛ! ⚡\n\nᵀʸᴾᵉ *.menu* ᵗᵒ ˢᵉᵉ ᵃˡˡ ᶜᵒᵐᵐᵃⁿᵈˢ!\n\n> *© ༺ ALONE X MD ꙰༻*'
  };

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.fromMe) return;
    if (msg.key.remoteJid === 'status@broadcast') return;
    const isGroup = (msg.key.remoteJid || '').endsWith('@g.us');
    if (isGroup) return;

    try {
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      if (userConfig.AUTO_REPLY !== 'true') return;

      const msgType = getContentType(msg.message);
      let body = '';
      if (msgType === 'conversation') body = msg.message.conversation || '';
      else if (msgType === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
      if (!body) return;

      const prefix = userConfig.PREFIX || config.PREFIX;
      if (body.startsWith(prefix)) return;

      const bodyLower = body.trim().toLowerCase();
      const replyText = autoReplies[bodyLower];
      if (!replyText) return;

      try {
        await socket.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
        console.log(`💬 Auto reply sent for: ${bodyLower}`);
      } catch (replyErr) {
        console.error('Auto reply send error:', replyErr?.message || replyErr);
      }
    } catch (err) {
      console.error('setupAutoReply error:', err);
    }
  });
}

// ==================== Cleanup Helper ====================

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch (e) { }
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch (e) { }
    try { await removeNumberFromMongo(sanitized); } catch (e) { }
    try {
      const ownerNumbers = config.OWNER_NUMBER.map(num => `${num.replace(/[^0-9]/g, '')}@s.whatsapp.net`);
      const caption = formatMessage('*🥷 OWNER NOTICE — SESSION REMOVED*', `*𝐍umber:* ${sanitized}\n*𝐒ession 𝐑emoved 𝐃ue 𝐓o 𝐋ogout.*\n\n*𝐀ctive 𝐒essions 𝐍ow:* ${activeSockets.size}`, BOT_NAME_FANCY);
      for (const ownerJid of ownerNumbers) {
        if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
      }
    } catch (e) { }
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ==================== Auto-Restart ====================

function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
        || lastDisconnect?.error?.statusCode
        || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
        || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
        || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
        || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      if (isLoggedOut) {
        console.log(`User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch (e) { console.error(e); }
      } else {
        console.log(`Connection closed for ${number} (not logout). Attempt reconnect...`);
        try { await delay(10000); activeSockets.delete(number.replace(/[^0-9]/g, '')); socketCreationTime.delete(number.replace(/[^0-9]/g, '')); const mockRes = { headersSent: false, send: () => { }, status: () => mockRes }; await EmpirePair(number, mockRes); } catch (e) { console.error('Reconnect attempt failed', e); }
      }
    }
  });
}

// ==================== EmpirePair ====================

async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  if (!mongoInitialized) await initMongo().catch(() => { });

  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  try {
    const socket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            version: [2, 3000, 1033893291],        
            connectTimeoutMs: 120000,
            keepAliveIntervalMs: 30000,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: false,              
            browser: ['Mac OS', 'Safari', '15.6.1']   
        });

    socketCreationTime.set(sanitizedNumber, Date.now());

    setupStatusHandlers(socket, sanitizedNumber);
    setupCommandHandlers(socket, sanitizedNumber);
    setupMessageHandlers(socket, sanitizedNumber);
    setupAutoRestart(socket, sanitizedNumber);
    setupNewsletterHandlers(socket, sanitizedNumber);
    handleMessageRevocation(socket, sanitizedNumber);
    setupWelcomeGoodbye(socket, sanitizedNumber);
    setupAutoMessageRead(socket, sanitizedNumber);
    setupCallRejection(socket, sanitizedNumber);
    setupAutoVoice(socket, sanitizedNumber);
    setupAutoReply(socket, sanitizedNumber);

    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try { await delay(1500); code = await socket.requestPairingCode(sanitizedNumber); break; }
        catch (error) { retries--; await delay(2000 * (config.MAX_RETRIES - retries)); }
      }
      if (!res.headersSent) res.send({ code });
    }

    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const credsPath = path.join(sessionPath, 'creds.json');
        if (!fs.existsSync(credsPath)) return;
        const fileStats = fs.statSync(credsPath);
        if (fileStats.size === 0) return;
        const fileContent = await fs.readFile(credsPath, 'utf8');
        const trimmedContent = fileContent.trim();
        if (!trimmedContent || trimmedContent === '{}' || trimmedContent === 'null') return;
        let credsObj;
        try { credsObj = JSON.parse(trimmedContent); } catch (e) { return; }
        if (!credsObj || typeof credsObj !== 'object') return;
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
        console.log('✅ Creds saved to MongoDB successfully');
      } catch (err) {
        console.error('Failed saving creds on creds.update:', err);
      }
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(() => ({ status: 'failed', error: 'joinGroup not configured' }));

          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
              const jid = doc.jid;
              try { if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid); } catch (e) { }
            }
          } catch (e) { }

          activeSockets.set(sanitizedNumber, socket);
          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;

          const initialCaption = formatMessage(useBotName,
            `*✅ 𝗦ᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ 𝗖ᴏɴɴᴇᴄᴛᴇᴅ ✅*\n\n*🔢 𝗡ᴜᴍʙᴇʀ :* ${sanitizedNumber}\n*📡 𝗖ᴏɴɴᴇᴄᴛɪɴɢ :* Wait few seconds`,
            useBotName
          );

          let sentMsg = null;
          try {
            if (String(useLogo).startsWith('http')) {
              sentMsg = await socket.sendMessage(userJid, { image: { url: useLogo }, caption: initialCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                sentMsg = await socket.sendMessage(userJid, { image: buf, caption: initialCaption });
              } catch (e) {
                sentMsg = await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: initialCaption });
              }
            }
          } catch (e) {
            try { sentMsg = await socket.sendMessage(userJid, { text: initialCaption }); } catch (e) { }
          }

          await delay(4000);

          const updatedCaption = formatMessage(
  useBotName,
  `╭━━━〔 ✅ 𝗖𝗢𝗡𝗡𝗘𝗖𝗧𝗘𝗗 V8 〕━━━╮

┃ 🔢 𝗡𝘂𝗺𝗯𝗲𝗿   : ${sanitizedNumber}
┃ 🏷️ 𝗦𝘁𝗮𝘁𝘂𝘀   : ${groupStatus}
┃ 🕒 𝗧𝗶𝗺𝗲     : ${getSriLankaTimestamp()}

╰━━━━━━━━━━━━━━━━━━━━━━╯

✨ ༺ ALONE X MD ꙰༻ 𝗦𝘆𝘀𝘁𝗲𝗺 𝗶𝘀 𝗻𝗼𝘄 𝗼𝗻𝗹𝗶𝗻𝗲 & 𝗿𝗲𝗮𝗱𝘆!`,
  useBotName
);

          try {
            if (sentMsg && sentMsg.key) {
              try { await socket.sendMessage(userJid, { delete: sentMsg.key }); } catch (delErr) { }
            }
            try {
              if (String(useLogo).startsWith('http')) {
                await socket.sendMessage(userJid, { image: { url: useLogo }, caption: updatedCaption });
              } else {
                try {
                  const buf = fs.readFileSync(useLogo);
                  await socket.sendMessage(userJid, { image: buf, caption: updatedCaption });
                } catch (e) {
                  await socket.sendMessage(userJid, { text: updatedCaption });
                }
              }
            } catch (imgErr) {
              await socket.sendMessage(userJid, { text: updatedCaption });
            }
          } catch (e) { }

          await sendAdminConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await sendOwnerConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await addNumberToMongo(sanitizedNumber);

          await socket.sendMessage(userJid, { text: `✅ *${useBotName} is now online!*\n\nType *${config.PREFIX}menu* to see all available commands.\n\n_Thank you for using ༺ ALONE X MD ꙰༻!_` });

        } catch (e) {
          console.error('Connection open error:', e);
          try { exec(`pm2.restart ${process.env.PM2_NAME || 'DCT-NINJA-MD'}`); } catch (e) { }
        }
      }
      if (connection === 'close') {
        try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch (e) { }
      }
    });

    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }
}

// ==================== COMPLETE COMMAND HANDLER WITH CASE TYPE ====================

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message) return;
    
    if (msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    try {
      let body = '';
      const msgType = getContentType(msg.message);
      
      if (msgType === 'conversation') body = msg.message.conversation || '';
      else if (msgType === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || '';
      else if (msgType === 'imageMessage') body = msg.message.imageMessage?.caption || '';
      else if (msgType === 'videoMessage') body = msg.message.videoMessage?.caption || '';
      else if (msgType === 'buttonsResponseMessage') body = msg.message.buttonsResponseMessage?.selectedButtonId || '';
      else if (msgType === 'listResponseMessage') body = msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || '';

      if (!body || typeof body !== 'string') return;
      
      const prefix = config.PREFIX;
      let fullCommand = '';
      if (body.startsWith(prefix)) {
        fullCommand = body.slice(prefix.length).trim();
      } else if (/^[0-9]+$/.test(body.trim())) {
        fullCommand = body.trim();
      } else {
        return;
      }
      const command = fullCommand.split(' ')[0].toLowerCase();
      const args = fullCommand.slice(command.length).trim().split(/\s+/).filter(Boolean);
      
      const from = msg.key.remoteJid;
      const sender = from;
      const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
      const senderNumber = (nowsender || '').split('@')[0];
      const isOwner = config.OWNER_NUMBER.some(owner => senderNumber === owner.replace(/[^0-9]/g, ''));
      const isGroup = from.endsWith("@g.us");
      
      const sanitized = (number || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};

      // Work type restrictions
      if (!isOwner) {
        const workType = userConfig.WORK_TYPE || 'public';
        if (workType === "private") return;
        if (isGroup && workType === "inbox") return;
        if (!isGroup && workType === "groups") return;
      }

      console.log(`📨 Command: ${command} from ${senderNumber}`);

      // Helper for quoted media
      async function downloadQuotedMedia(quoted) {
        if (!quoted) return null;
        const qTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
        const qType = qTypes.find(t => quoted[t]);
        if (!qType) return null;
        const messageType = qType.replace(/Message$/i, '').toLowerCase();
        const stream = await downloadContentFromMessage(quoted[qType], messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        return { buffer, mime: quoted[qType].mimetype || '', caption: quoted[qType].caption || quoted[qType].fileName || '', ptt: quoted[qType].ptt || false, fileName: quoted[qType].fileName || '' };
      }

      // ==================== CASE TYPE COMMAND HANDLER ====================
      
      // Helper function to extract channel ID from WhatsApp channel link
      function extractChannelId(link) {
        if (!link) return null;
        
        // Handle different WhatsApp channel link formats
        const patterns = [
          /https?:\/\/(?:www\.)?whatsapp\.com\/channel\/([0-9]+)/i,
          /https?:\/\/chat\.whatsapp\.com\/channel\/([0-9]+)/i,
          /wa\.me\/channel\/([0-9]+)/i,
          /channel\/([0-9]+)/i,
          /([0-9]+)@newsletter/i
        ];
        
        for (const pattern of patterns) {
          const match = link.match(pattern);
          if (match && match[1]) {
            return `${match[1]}@newsletter`;
          }
        }
        
        // If it's already a JID format
        if (link.includes('@newsletter')) {
          return link;
        }
        
        return null;
      }
      
      switch(command) {
          case 'tourl':
        case 'url':
        case 'upload': {
          const axios = require('axios');
          const FormData = require('form-data');
          const fs = require('fs');
          const os = require('os');
          const path = require('path');

          const quoted = msg.message?.extendedTextMessage?.contextInfo;
          const mime = quoted?.quotedMessage?.imageMessage?.mimetype ||
            quoted?.quotedMessage?.videoMessage?.mimetype ||
            quoted?.quotedMessage?.audioMessage?.mimetype ||
            quoted?.quotedMessage?.documentMessage?.mimetype;

          if (!quoted || !mime) {
            return await socket.sendMessage(sender, { text: '❌ *Please reply to an image or video.*' });
          }

          // Fake Quote for Style
          const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_MEDIA" },
            message: { contactMessage: { displayName: "༺ ALONE X MD ꙰༻", vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Upload Service\nORG:Catbox/ImgBB\nEND:VCARD` } }
          };

          let mediaType;
          let msgKey;

          if (quoted.quotedMessage.imageMessage) {
            mediaType = 'image';
            msgKey = quoted.quotedMessage.imageMessage;
          } else if (quoted.quotedMessage.videoMessage) {
            mediaType = 'video';
            msgKey = quoted.quotedMessage.videoMessage;
          } else if (quoted.quotedMessage.audioMessage) {
            mediaType = 'audio';
            msgKey = quoted.quotedMessage.audioMessage;
          } else if (quoted.quotedMessage.documentMessage) {
            mediaType = 'document';
            msgKey = quoted.quotedMessage.documentMessage;
          }

          try {
            // Using existing downloadContentFromMessage
            const stream = await downloadContentFromMessage(msgKey, mediaType);
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }

            const ext = mime.split('/')[1] || 'tmp';
            const tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}.${ext}`);
            fs.writeFileSync(tempFilePath, buffer);

            const fileSize = (buffer.length / 1024 / 1024).toFixed(2) + ' MB';
            const typeStr = mediaType.charAt(0).toUpperCase() + mediaType.slice(1);

            let catboxUrl = '';
            let imgbbUrl = '';

            // Upload to Catbox
            try {
              const catboxForm = new FormData();
              catboxForm.append('fileToUpload', fs.createReadStream(tempFilePath));
              catboxForm.append('reqtype', 'fileupload');

              const catboxResponse = await axios.post('https://catbox.moe/user/api.php', catboxForm, {
                headers: catboxForm.getHeaders()
              });
              catboxUrl = catboxResponse.data.trim();
            } catch (catboxError) {
              console.error('Catbox upload error:', catboxError);
              catboxUrl = '❌ Upload failed';
            }

            // Upload to ImgBB (works best with images)
            try {
              const base64Data = buffer.toString('base64');
              const imgbbForm = new FormData();
              imgbbForm.append('key', 'e4b536bbf102cfccc5d8758489052547');
              imgbbForm.append('image', base64Data);

              const imgbbResponse = await axios.post('https://api.imgbb.com/1/upload', imgbbForm, {
                headers: imgbbForm.getHeaders()
              });

              if (imgbbResponse.data.success) {
                imgbbUrl = imgbbResponse.data.data.url;
              } else {
                imgbbUrl = '❌ Upload failed';
              }
            } catch (imgbbError) {
              console.error('ImgBB upload error:', imgbbError);
              imgbbUrl = '❌ Upload failed';
            }

            // Cleanup
            fs.unlinkSync(tempFilePath);

            // Prepare message
            const txt = `
🔗 *༺ ALONE X MD ꙰༻ 𝗨ʀʟ 𝗖ᴏɴᴠᴇɴᴛᴇʀ*

📂 *ᴛʏᴘᴇ:* ${typeStr}
📊 *ꜱɪᴢᴇ:* ${fileSize}

📦 *ᴄᴀᴛʙᴏx ᴜʀʟ:*
${catboxUrl}

📦 *ɪᴍɢʙʙ ᴜʀʟ:*
${imgbbUrl}

> *𝐏𝙾𝚆𝙴𝚁𝙴𝙳 𝐁𝐘 ༺ ALONE X MD ꙰༻*`;

            // Determine thumbnail for preview
            let thumbnailUrl = "https://cdn-icons-png.flaticon.com/512/337/337946.png";
            if (catboxUrl && !catboxUrl.includes('❌') && catboxUrl.match(/\.(jpeg|jpg|gif|png)$/i)) {
              thumbnailUrl = catboxUrl;
            } else if (imgbbUrl && !imgbbUrl.includes('❌')) {
              thumbnailUrl = imgbbUrl;
            }

            await socket.sendMessage(sender, {
              text: txt,
              contextInfo: {
                externalAdReply: {
                  title: "Media Uploaded Successfully!",
                  body: "Dual Upload Service",
                  thumbnailUrl: thumbnailUrl,
                  sourceUrl: catboxUrl && !catboxUrl.includes('❌') ? catboxUrl : (imgbbUrl && !imgbbUrl.includes('❌') ? imgbbUrl : ''),
                  mediaType: 1,
                  renderLargerThumbnail: true
                }
              }
            }, { quoted: metaQuote });

          } catch (e) {
            console.error(e);
            await socket.sendMessage(sender, { text: '❌ *Error uploading media.*' });
          }
        }
          break;
          case 'song':
case 'play':
case 'audio':
case 'ytmp3':
    if (!args.length) {
        await socket.sendMessage(sender, {
            text: '❌ ERROR\n\n*Need YouTube URL or Song Title*'
        }, { quoted: msg });
        break;
    }

    const query = args.join(' ');
    await socket.sendMessage(sender, { text: '🎧 සින්දුව තෝරන ගමන්...' });

    try {
        let searchData;

        // Search logic using yts
        if (query.match(/(youtube\.com|youtu\.be)/)) {
            const match = query.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
            const videoId = match ? match[1] : null;
            if (!videoId) throw new Error('Invalid YouTube URL');
            searchData = await yts({ videoId });
        } else {
            const result = await yts(query);
            if (!result.videos || result.videos.length === 0) {
                await socket.sendMessage(sender, { text: '❌ NO RESULTS' }, { quoted: msg });
                break;
            }
            searchData = result.videos[0];
        }

        const videoId = searchData.videoId;
        const videoUrl = `https://youtu.be/${videoId}`;

        // Fetching data from the New API
        const apiUrl = `https://vajira-official-apis.vercel.app/api/ytmp3?apikey=vajira-3620yyk505-1779827683855&url=${videoUrl}`;
        const apiRes = await axios.get(apiUrl);

        if (!apiRes.data.status) {
            throw new Error('API failed to fetch download links.');
        }

        const apiData = apiRes.data.data;
        // Finding the 128kbps link specifically
        const downloadObj = apiData.downloads.find(d => d.bitrate === '128kbps') || apiData.downloads[0];
        const downloadLink = downloadObj.url;

        const desc = `🍷 *𝗦𝗢𝗡𝗚* : _${apiData.title}_     
╭─────────────────┄┄
💠🍷 *𝗗ᴜʀᴀᴛɪᴏɴ ➟* _${apiData.timestamp}_
💠👀 *𝗩ɪᴇᴡꜱ ➟* _${apiData.viewsFormatted}_
💠📅 *𝗣ᴜʙʟɪꜱʜᴇᴅ ➟* _${apiData.ago}_
💠🎤 *𝗖ʜᴀɴɴᴇʟ ➟* _${apiData.author?.name || 'N/A'}_
╰──────────────────┉┉
*⬇️ 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗢𝗣𝗧𝗜𝗢𝗡𝗦*

*🔢 𝗥ᴇᴘʟʏ ᴡɪᴛʜ ᴀ 𝗡ᴜᴍʙᴇʀ 👇*

*01 🎧 ❯❯ ᴀᴜᴅɪᴏ (ᴍᴘ3)*
*02 📂 ❯❯ ᴅᴏᴄᴜᴍᴇɴᴛ (ғɪʟᴇ)*
*03 🎤 ❯❯ ᴠᴏɪᴄᴇ (ᴘᴛᴛ)*
`;

        const sentMsg = await socket.sendMessage(sender, {
            image: { url: apiData.thumbnails.default },
            caption: desc
        }, { quoted: msg });

        const listener = async (update) => {
            const mek = update.messages[0];
            if (!mek?.message) return;

            const ctx = mek.message.extendedTextMessage?.contextInfo;
            if (!ctx || ctx.stanzaId !== sentMsg.key.id) return;

            const text = mek.message.conversation || mek.message.extendedTextMessage?.text;
            if (!['1', '2', '3'].includes(text)) return;
            
            // Validate sender to avoid others triggering the menu
            if (mek.key.remoteJid !== sender) return;

            socket.ev.off('messages.upsert', listener);
            await socket.sendMessage(sender, { react: { text: '⬇️', key: mek.key } });

            try {
                const songTitle = apiData.title;
                const fileName = songTitle.replace(/[^a-zA-Z0-9]/g, '_');

                if (text === '1') {
                    // MP3 Audio
                    await socket.sendMessage(sender, {
                        audio: { url: downloadLink },
                        mimetype: 'audio/mpeg'
                    }, { quoted: mek });

                } else if (text === '2') {
                    // Document File
                    await socket.sendMessage(sender, {
                        document: { url: downloadLink },
                        mimetype: 'audio/mpeg',
                        fileName: `${fileName}.mp3`,
                        caption: songTitle
                    }, { quoted: mek });

                } else if (text === '3') {
                    // PTT (Voice Note)
                    await socket.sendMessage(sender, { react: { text: '🔄', key: mek.key } });
                    
                    const tmpDir = os.tmpdir();
                    const inputPath = path.join(tmpDir, `${Date.now()}.mp3`);
                    const outputPath = path.join(tmpDir, `${Date.now()}.ogg`);

                    try {
                        const audioRes = await axios.get(downloadLink, { responseType: 'arraybuffer' });
                        fs.writeFileSync(inputPath, audioRes.data);

                        await new Promise((resolve, reject) => {
                            ffmpeg(inputPath)
                                .toFormat('ogg')
                                .audioCodec('libopus')
                                .on('end', resolve)
                                .on('error', reject)
                                .save(outputPath);
                        });

                        await socket.sendMessage(sender, {
                            audio: fs.readFileSync(outputPath),
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true
                        }, { quoted: mek });

                    } catch (e) {
                        // Fallback if FFmpeg fails
                        await socket.sendMessage(sender, { 
                            audio: { url: downloadLink }, 
                            mimetype: 'audio/mpeg', 
                            ptt: true 
                        }, { quoted: mek });
                    } finally {
                        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    }
                }

                await socket.sendMessage(sender, { react: { text: '✅', key: mek.key } });

            } catch (err) {
                await socket.sendMessage(sender, { text: '❌ ERROR: ' + err.message }, { quoted: mek });
            }
        };

        socket.ev.on('messages.upsert', listener);
        setTimeout(() => { socket.ev.off('messages.upsert', listener); }, 300000);

    } catch (err) {
        await socket.sendMessage(sender, { text: '❌ ERROR\n\n' + err.message }, { quoted: msg });
    }
    break;
          case 'system': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SYSTEM" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    const os = require('os');
    const text = `
🖥️ *System Info for ${botName}*
💻 OS: ${os.type()} ${os.release()}
🖥️ Platform: ${os.platform()}
🧠 CPU cores: ${os.cpus().length}
💾 Memory: ${(os.totalmem()/1024/1024/1024).toFixed(2)} GB
`;

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `🔥 ${botName} SYSTEM INFO 🔥`,
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('system error', e);
    await socket.sendMessage(sender, { text: '❌ Failed to get system info.' }, { quoted: msg });
  }
  break;
          }
          case 'menu': {
  try { await socket.sendMessage(sender, { react: { text: "🇱🇰", key: msg.key } }); } catch(e){}

  try {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // load per-session config (logo, botName)
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; }
    catch(e){ console.warn('menu: failed to load config', e); userCfg = {}; }

    const title = userCfg.botName || '༺ ALONE X MD ꙰༻';

    // 🔹 Fake contact for Meta AI mention
    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_MENU"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:5.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *BOT STATUS* ❏
│ 👽 *Bot Name*: ${title}
│ 👑 *Owner*: ${config.OWNER_NAME || 'MADUSANKA,DULA DEV'}
│ 🏷️ *Version*: ${config.BOT_VERSION || '0.0001+'}
│ ☁️ *Platform*: ${process.env.PLATFORM || 'Senasuru✨'}
│ ⏳ *Uptime*: ${hours}h ${minutes}m ${seconds}s
╰───────────────❏

╭───❏ *𝗠𝗔𝗜𝗡 𝗠𝗘𝗡𝗨* ❏
│ 
│ 📥 *DOWNLOAD MENU*
│ ${config.PREFIX}download
│ 
│ 🎨 *CREATIVE MENU*  
│ ${config.PREFIX}creative
│
│ 🔧 *TOOLS MENU*
│ ${config.PREFIX}tools
│
│ ⚙️ *SETTINGS MENU*
│ ${config.PREFIX}settings
│
│ 👑 *OWNER MENU*
│ ${config.PREFIX}owner
│ 
│ ⚡ *PING TEST*
│ ${config.PREFIX}ping
│ 
│ 🤖 *BOT INFO*
│ ${config.PREFIX}alive
│
> © ${config.BOT_FOOTER || '༺ ALONE X MD ꙰༻','https://alone-x-md-production.up.railway.app'}
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}download`, buttonText: { displayText: "📥 DOWNLOAD" }, type: 1 },
      { buttonId: `${config.PREFIX}creative`, buttonText: { displayText: "🎨 CREATIVE" }, type: 1 },
      { buttonId: `${config.PREFIX}tools`, buttonText: { displayText: "🔧 TOOLS" }, type: 1 },
      { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "⚙️ SETTINGS" }, type: 1 },
      { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑 OWNER" }, type: 1 }
    ];

    const defaultImg = 'https://files.catbox.moe/5jrs12.jpeg';
    const useLogo = userCfg.logo || defaultImg;

    // build image payload (url or buffer)
    let imagePayload;
    if (String(useLogo).startsWith('http')) imagePayload = { url: useLogo };
    else {
      try { imagePayload = fs.readFileSync(useLogo); } catch(e){ imagePayload = { url: defaultImg }; }
    }

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: "༺ ALONE X MD ꙰༻",
      buttons,
      headerType: 4
    }, { quoted: shonux });

  } catch (err) {
    console.error('menu command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show menu.' }, { quoted: msg }); } catch(e){}
  }
  break;
          }
          case 'jid': {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || '© ༺ ALONE X MD ꙰༻ ||🍃'; // dynamic bot name

    const userNumber = sender.split('@')[0]; 

    // Reaction
    await socket.sendMessage(sender, { 
        react: { text: "🆔", key: msg.key } 
    });

    // Fake contact quoting for meta style
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_FAKE_ID" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, {
        text: `*🆔 𝐂hat 𝐉ID:* ${sender}\n*📞 𝐘our 𝐍umber:* +${userNumber}`,
    }, { quoted: shonux });
    break;
          }
          case 'song':
case 'play':
case 'audio':
case 'ytmp3':
    if (!args.length) {
        await socket.sendMessage(sender, {
            text: '❌ ERROR\n\n*Need YouTube URL or Song Title*'
        }, { quoted: msg });
        break;
    }

    const searchQuery = args.join(' ');
    await socket.sendMessage(sender, { text: '🎧 සින්දුව තෝරන ගමන්...' });

    try {
        let searchData;

        // Search logic using yts
        if (query.match(/(youtube\.com|youtu\.be)/)) {
            const match = query.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
            const videoId = match ? match[1] : null;
            if (!videoId) throw new Error('Invalid YouTube URL');
            searchData = await yts({ videoId });
        } else {
            const result = await yts(query);
            if (!result.videos || result.videos.length === 0) {
                await socket.sendMessage(sender, { text: '❌ NO RESULTS' }, { quoted: msg });
                break;
            }
            searchData = result.videos[0];
        }

        const videoId = searchData.videoId;
        const videoUrl = `https://youtu.be/${videoId}`;

        // Fetching data from the New API
        const apiUrl = `https://vajira-official-apis.vercel.app/api/ytmp3?apikey=vajira-b72bv85884-1776138459299&url=${videoUrl}`;
        const apiRes = await axios.get(apiUrl);

        if (!apiRes.data.status) {
            throw new Error('API failed to fetch download links.');
        }

        const apiData = apiRes.data.data;
        // Finding the 128kbps link specifically
        const downloadObj = apiData.downloads.find(d => d.bitrate === '128kbps') || apiData.downloads[0];
        const downloadLink = downloadObj.url;

        const desc = `🍷 *𝗦𝗢𝗡𝗚* : _${apiData.title}_     
╭─────────────────┄┄
💠🍷 *𝗗ᴜʀᴀᴛɪᴏɴ ➟* _${apiData.timestamp}_
💠👀 *𝗩ɪᴇᴡꜱ ➟* _${apiData.viewsFormatted}_
💠📅 *𝗣ᴜʙʟɪꜱʜᴇᴅ ➟* _${apiData.ago}_
💠🎤 *𝗖ʜᴀɴɴᴇʟ ➟* _${apiData.author?.name || 'N/A'}_
╰──────────────────┉┉
*⬇️ 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗢𝗣𝗧𝗜𝗢𝗡𝗦*

*🔢 𝗥ᴇᴘʟʏ ᴡɪᴛʜ ᴀ 𝗡ᴜᴍʙᴇʀ 👇*

*01 🎧 ❯❯ ᴀᴜᴅɪᴏ (ᴍᴘ3)*
*02 📂 ❯❯ ᴅᴏᴄᴜᴍᴇɴᴛ (ғɪʟᴇ)*
*03 🎤 ❯❯ ᴠᴏɪᴄᴇ (ᴘᴛᴛ)*
`;

        const sentMsg = await socket.sendMessage(sender, {
            image: { url: apiData.thumbnails.default },
            caption: desc
        }, { quoted: msg });

        const listener = async (update) => {
            const mek = update.messages[0];
            if (!mek?.message) return;

            const ctx = mek.message.extendedTextMessage?.contextInfo;
            if (!ctx || ctx.stanzaId !== sentMsg.key.id) return;

            const text = mek.message.conversation || mek.message.extendedTextMessage?.text;
            if (!['1', '2', '3'].includes(text)) return;
            
            // Validate sender to avoid others triggering the menu
            if (mek.key.remoteJid !== sender) return;

            socket.ev.off('messages.upsert', listener);
            await socket.sendMessage(sender, { react: { text: '⬇️', key: mek.key } });

            try {
                const songTitle = apiData.title;
                const fileName = songTitle.replace(/[^a-zA-Z0-9]/g, '_');

                if (text === '1') {
                    // MP3 Audio
                    await socket.sendMessage(sender, {
                        audio: { url: downloadLink },
                        mimetype: 'audio/mpeg'
                    }, { quoted: mek });

                } else if (text === '2') {
                    // Document File
                    await socket.sendMessage(sender, {
                        document: { url: downloadLink },
                        mimetype: 'audio/mpeg',
                        fileName: `${fileName}.mp3`,
                        caption: songTitle
                    }, { quoted: mek });

                } else if (text === '3') {
                    // PTT (Voice Note)
                    await socket.sendMessage(sender, { react: { text: '🔄', key: mek.key } });
                    
                    const tmpDir = os.tmpdir();
                    const inputPath = path.join(tmpDir, `${Date.now()}.mp3`);
                    const outputPath = path.join(tmpDir, `${Date.now()}.ogg`);

                    try {
                        const audioRes = await axios.get(downloadLink, { responseType: 'arraybuffer' });
                        fs.writeFileSync(inputPath, audioRes.data);

                        await new Promise((resolve, reject) => {
                            ffmpeg(inputPath)
                                .toFormat('ogg')
                                .audioCodec('libopus')
                                .on('end', resolve)
                                .on('error', reject)
                                .save(outputPath);
                        });

                        await socket.sendMessage(sender, {
                            audio: fs.readFileSync(outputPath),
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true
                        }, { quoted: mek });

                    } catch (e) {
                        // Fallback if FFmpeg fails
                        await socket.sendMessage(sender, { 
                            audio: { url: downloadLink }, 
                            mimetype: 'audio/mpeg', 
                            ptt: true 
                        }, { quoted: mek });
                    } finally {
                        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                    }
                }

                await socket.sendMessage(sender, { react: { text: '✅', key: mek.key } });

            } catch (err) {
                await socket.sendMessage(sender, { text: '❌ ERROR: ' + err.message }, { quoted: mek });
            }
        };

        socket.ev.on('messages.upsert', listener);
        setTimeout(() => { socket.ev.off('messages.upsert', listener); }, 300000);

    } catch (err) {
        await socket.sendMessage(sender, { text: '❌ ERROR\n\n' + err.message }, { quoted: msg });
    }
    break;
        
          case 'allmenu': {
  try {
    await socket.sendMessage(sender, { react: { text: '📜', key: msg.key } });

    // 1. Uptime fix - sender use කරන්න
    const startTime = socketCreationTime.get(sender) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // 2. Memory calc
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);

    // 3. Command count හදාගන්න. Commands object එකක් තියෙනවා නම්
    const commandCount = commands? Object.keys(commands).length : 'N/A';

    let allMenuText = `
╭───────────────⭓
│ ʙᴏᴛ : ༺ ALONE X MD ꙰༻
│ ᴜsᴇʀ: @${sender.split("@")[0]}
│ ᴘʀᴇғɪx: ${config.PREFIX}
│ ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
│ ᴍᴇᴍᴏʀʏ : ${usedMemory}MB / ${totalMemory}MB
│ ᴄᴏᴍᴍᴀɴᴅs: ${commandCount}
│ ᴅᴇᴠ: 𝙰𝙻𝙾𝙽𝙴 ʙᴏʏ
╰───────────────⭓

⭓───────────────⭓『 🌐 ɢᴇɴᴇʀᴀʟ 』
│ ⬡ ᴀʟɪᴠᴇ │ ᴘɪɴɢ │ ᴏᴡɴᴇʀ
│ ⬡ ʙᴏᴛ_ɪɴғᴏ │ ʙᴏᴛ_sᴛᴀᴛs
│ ⬡ ᴍᴇɴᴜ │ ᴀʟʟᴍᴇɴᴜ
│ ⬡ ᴄᴏᴅᴇ │ ғᴀɴᴄʏ │ ʟᴏɢᴏ │ ǫʀ
╰──────────────────⭓

⭓───────────────⭓『 📥 ᴅᴏᴡɴʟᴏᴀᴅ 』
│ ⬡ sᴏɴɢ │ ᴛɪᴋᴛᴏᴋ │ ғʙ │ ɪɢ
│ ⬡ ᴀɪɪᴍɢ │ ᴛᴛs │ sᴛɪᴄᴋᴇʀ
│ ⬡ ᴠɪᴇᴡᴏɴᴄᴇ │ ᴛs
╰──────────────────⭓

⭓───────────────⭓『 👥 ɢʀᴏᴜᴘ 』
│ ⬡ ᴀᴅᴅ │ ᴋɪᴄᴋ │ ᴋɪᴄᴋᴀʟʟ
│ ⬡ ᴘʀᴏᴍᴏᴛᴇ │ ᴅᴇᴍᴏᴛᴇ │ ᴛᴀɢᴀʟʟ
│ ⬡ ᴏᴘᴇɴ │ ᴄʟᴏsᴇ │ ɪɴᴠɪᴛᴇ
│ ⬡ sᴇᴛɴᴀᴍᴇ │ ᴡᴀʀɴ │ ᴊᴏɪɴ
╰──────────────────⭓

⭓───────────────⭓『 🎭 ғᴜɴ 』
│ ⬡ ᴊᴏᴋᴇ │ ᴅᴀʀᴋᴊᴏᴋᴇ │ ᴍᴇᴍᴇ
│ ⬡ ᴡᴀɪғᴜ │ ᴄᴀᴛ │ ᴅᴏɢ
│ ⬡ ғᴀᴄᴛ │ ǫᴜᴏᴛᴇ │ ʟᴏᴠᴇǫᴜᴏᴛᴇ
│ ⬡ ᴘɪᴄᴋᴜᴘʟɪɴᴇ │ ʀᴏᴀsᴛ
╰──────────────────⭓

⭓───────────────⭓『 ⚡ ᴍᴀɪɴ 』
│ ⬡ ᴀɪ │ ᴡᴇᴀᴛʜᴇʀ │ ᴀᴘᴋ
│ ⬡ ᴡɪɴғᴏ │ ᴡʜᴏɪs │ ɢᴇᴛᴘᴘ
│ ⬡ sᴀᴠᴇsᴛᴀᴛᴜs │ sᴇᴛsᴛᴀᴛᴜs
│ ⬡ sʜᴏʀᴛᴜʀʟ │ ᴛᴏᴜʀʟ2
│ ⬡ ʙᴏᴍʙ │ ᴅᴇʟᴇᴛᴇᴍᴇ │ ғᴄ
╰──────────────────⭓
> *ᴍᴀᴅᴇ ɪɴ ʙʏ 𝙰𝙻𝙾𝙽𝙴 ʙᴏʏ*
`;

    // 4. Image fail උනොත් text විතරක් යවන fallback
    try {
      await socket.sendMessage(from, {
        image: { url: "https://i.ibb.co/mV9P3H0V/a8aa7002e6d5.jpg" },
        caption: allMenuText,
        mentions: [sender]
      }, { quoted: fakevCard });
    } catch (imgError) {
      console.log('Image send failed, sending text only:', imgError);
      await socket.sendMessage(from, {
        text: allMenuText,
        mentions: [sender]
      }, { quoted: fakevCard });
    }

    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

  } catch (error) {
    console.error('Allmenu command error:', error);
    await socket.sendMessage(from, {
      text: `❌ *ᴛʜᴇ ᴍᴇɴᴜ ɢᴏᴛ sʜʏ! 😢*\nError: ${error.message || 'Unknown error'}\nTry again, love?`
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
          }
          
          case 'pair': {
           
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    // අංකය ලබා ගැනීම (Remove command text)
    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair 947XXXXXXX'
        }, { quoted: msg });
    }

    try {
        // ✅ NEW API URL UPDATED
        const url = `https://alone-x-md-production.up.railway.app/code?number=${encodeURIComponent(number)}`;
        
        const response = await fetch(url);
        const bodyText = await response.text();

        // console.log("🌐 API Response:", bodyText); // Debugging purpose

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: `❌ Failed to retrieve pairing code.\nReason: ${result?.message || 'Check the number format'}`
            }, { quoted: msg });
        }

        // React sending
        await socket.sendMessage(sender, { react: { text: '🔑', key: msg.key } });

        // Send Main Message
        await socket.sendMessage(sender, {
            text: `> *ᴄᴏᴅᴇ ɪꜱ  ᴄᴏᴍᴘʟᴇᴀᴛᴇ* ✅\n\n*🔑 ʏᴏᴜ ᴄᴀɴᴛ ᴘᴀɪʀ ᴛʜɪꜱ ʙᴏᴛ.\n ᴛʜɪꜱ ʙᴏᴛ ɪꜱ ᴏɴʟʏ ᴛᴇꜱᴛᴇʀ* ${result.code}\n
`
        }, { quoted: msg });

        await sleep(2000);

        // Send Code Separately for easy copy
        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request.'
        }, { quoted: msg });
    }

    break;
                                 }
          case 'getdp': {
          try {
            const sanitized = (number || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};

            const botName = cfg.botName || "༺ ALONE X MD ꙰༻";
            const logo = cfg.logo || config.RCD_IMAGE_PATH;

            // ✅ get number from message
            let q = msg.message?.conversation?.split(" ")[1] ||
              msg.message?.extendedTextMessage?.text?.split(" ")[1];

            if (!q) {
              return await socket.sendMessage(sender, {
                text: `❌ Please provide a number!\n\nUsage: ${config.PREFIX}getdp 947XXXXXXXX`
              });
            }

            // ✅ format JID
            let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

            // ✅ get profile picture
            let ppUrl;
            try {
              ppUrl = await socket.profilePictureUrl(jid, "image");
            } catch {
              ppUrl = "https://files.catbox.moe/uqjp2b.jpeg"; // default fallback
            }

            // ✅ meta quote (clean version)
            const metaQuote = {
              key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "GETDP_META"
              },
              message: {
                contactMessage: {
                  displayName: botName,
                  vcard: `BEGIN:VCARD
VERSION:3.0
FN:${botName}
ORG:${botName}
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
              }
            };

            // ✅ send DP
            await socket.sendMessage(sender, {
              image: { url: ppUrl },
              caption: `
╭━━〔 🖼️ *PROFILE PICTURE* 〕━━⬣
┃ 📱 Number : +${q}
┃ 🤖 Bot : ${botName}
╰━━━━━━━━━━━━━━━━━━⬣
> ⚡ Fast DP Fetcher
      `.trim(),
              footer: `🍁 ${botName}`,
              buttons: [
                {
                  buttonId: `${config.PREFIX}menu`,
                  buttonText: { displayText: "📑 Menu" },
                  type: 1
                }
              ],
              headerType: 4
            }, { quoted: metaQuote });

          } catch (e) {
            console.log("❌ getdp error:", e);

            await socket.sendMessage(sender, {
              text: "⚠️ Error: Could not fetch profile picture."
            });
          }

          break;
          }
          


case 'csong': {
    try {
        const yts = require('yt-search');
        const axios = require('axios');
        const ffmpeg = require('fluent-ffmpeg');
        const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const crypto = require('crypto');

        ffmpeg.setFfmpegPath(ffmpegInstaller.path);

   
        const _chm_id = crypto.randomBytes(8).toString('hex');
        const targetJidInput = args[0];
        const songQuery = args.slice(1).join(" ").trim();

        if (!targetJidInput || !songQuery) {
            return await socket.sendMessage(from, { text: "❌ *Format Invalid!*\nUsage: `.csong <jid|.|here> <song name>`" });
        }

        await socket.sendMessage(from, { react: { text: "🎧", key: msg.key } });

        let sJid = targetJidInput;
        if (sJid === '.' || sJid.toLowerCase() === 'here') {
            sJid = from;
        } else if (!sJid.includes('@')) {
            if (/^\d{12,}$/.test(sJid)) sJid = `${sJid}@newsletter`;
            else sJid = `${sJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        }

        let sUrl = songQuery;
        let sMetadata = null;
        if (!/^https?:\/\//i.test(songQuery)) {
            const search = await yts(songQuery);
            if (!search || !search.videos || search.videos.length === 0) {
                return await socket.sendMessage(from, { text: "❌ No results found." });
            }
            sUrl = search.videos[0].url;
            sMetadata = search.videos[0];
        } else {
            const search = await yts(sUrl);
            sMetadata = search.all ? search.all[0] : (search.videos ? search.videos[0] : search);
        }

 
        const sApiUrl = `https://ytmp333-chama-woad.vercel.app/api/ytdl?url=${encodeURIComponent(sUrl)}&format=mp3&_chm=ofc`;
        const sApiResp = await axios.get(sApiUrl).catch(() => null);
        if (!sApiResp || !sApiResp.data || !sApiResp.data.success) {
            return await socket.sendMessage(from, { text: "❌ Download API failed." });
        }
        const sDownloadUrl = sApiResp.data.download;
        const sTitle = sApiResp.data.title || sMetadata?.title || 'Song';

        
        const chm_Mp3 = path.join(os.tmpdir(), `chm_${_chm_id}.mp3`);
        const chm_Tag = path.join(os.tmpdir(), `t_chm_${_chm_id}.mp3`);
        const chm_Opus = path.join(os.tmpdir(), `chm_${_chm_id}.opus`);

        const dlResp = await axios.get(sDownloadUrl, { responseType: 'stream', timeout: 120000 }).catch(() => null);
        if (!dlResp || !dlResp.data) return await socket.sendMessage(from, { text: "❌ Download failed." });

        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(chm_Mp3);
            dlResp.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        try {
            
            const _0x6368616d61 = "Powered by ༺ ALONE X MD ꙰༻"; 
            const sTagUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(_0x6368616d61)}&tl=en&client=tw-ob`;
            const tagResp = await axios.get(sTagUrl, { responseType: 'stream' }).catch(() => null);
            if (tagResp) {
                await new Promise((resolve) => {
                    const writer = fs.createWriteStream(chm_Tag);
                    tagResp.data.pipe(writer);
                    writer.on('finish', resolve);
                    writer.on('error', () => resolve());
                });
            }
        } catch (e) { }

        await new Promise((resolve, reject) => {
            let ff = ffmpeg(chm_Mp3).noVideo();
            if (fs.existsSync(chm_Tag)) {
                ff.input(chm_Tag).complexFilter([
                    '[1:a]adelay=1000|1000,volume=2.0[tag]',
                    '[0:a][tag]amix=inputs=2:duration=first'
                ]);
            }
            ff.audioCodec('libopus').format('opus').on('end', resolve).on('error', reject).save(chm_Opus);
        });

       
        const sCaption = `🍷 *TITLE :* ${sTitle}\n` +
                         `◽️ ⏱ *Duration :* ${sMetadata?.timestamp || 'N/A'}\n\n` +
                         `> *© ༺ ALONE X MD ꙰༻-OFC SYSTEM*`;

        const sThumb = sMetadata?.thumbnail || sMetadata?.image;
        if (sThumb) {
            await socket.sendMessage(sJid, { image: { url: sThumb }, caption: sCaption });
        } else {
            await socket.sendMessage(sJid, { text: sCaption });
        }

        const chm_Buf = fs.readFileSync(chm_Opus);
        await socket.sendMessage(sJid, { audio: chm_Buf, mimetype: 'audio/ogg; codecs=opus', ptt: true });

        if (sJid !== from) await socket.sendMessage(from, { text: "✅ *Song sent successfully!*" });

        try { [chm_Mp3, chm_Tag, chm_Opus].forEach(f => fs.existsSync(f) && fs.unlinkSync(f)); } catch (e) { }

    } catch (e) {
        console.error('csong error:', e);
        await socket.sendMessage(from, { text: "❌ *Error:* " + e.message });
    }
    break;
          }
          case 'hack': {
  try {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    await socket.sendMessage(sender, { react: { text: '💻', key: msg.key } });

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || '© ༺ ALONE X MD ꙰༻ ||🍃';

    const targetNum = args[0] ? args[0].replace(/[^0-9]/g, '') : senderNumber;
    const targetJid = `${targetNum}@s.whatsapp.net`;

    // Fake hacking animation frames
    const hackFrames = [
      '```[●] Initializing hack sequence...```',
      '```[●] Connecting to target: +' + targetNum + '...```',
      '```[●] Bypassing firewall... ██░░░░░░ 25%```',
      '```[●] Cracking encryption... ████░░░░ 50%```',
      '```[●] Accessing database... ██████░░ 75%```',
      '```[●] Extracting data...    ████████ 99%```',
      '```[✔] ACCESS GRANTED 🔓```'
    ];

    const { key: hackKey } = await socket.sendMessage(sender, { text: hackFrames[0] }, { quoted: msg });

    for (let i = 1; i < hackFrames.length; i++) {
      await sleep(900);
      await socket.sendMessage(sender, { text: hackFrames[i], edit: hackKey });
    }

    await sleep(700);

    // Final hack result card
    const hackResult = `
╭━━━━━━━━━━━━━━━━━━━━╮
┃  💻 *𝙷 𝙰 𝙲 𝙺 𝙴 𝙳 !* 🔓  ┃
╰━━━━━━━━━━━━━━━━━━━━╯

🖥️ *𝚃𝙰𝚁𝙶𝙴𝚃:* @${targetNum}
📡 *𝚂𝚃𝙰𝚃𝚄𝚂:* 🟡 𝗖𝗼𝗺𝗽𝗿𝗼𝗺𝗶𝘀𝗲𝗱

┌─────────────────────
│ 📁 𝗙𝗶𝗹𝗲𝘀 𝗔𝗰𝗰𝗲𝘀𝘀𝗲𝗱   : 9,999
│ 🔑 𝗣𝗮𝘀𝘀𝘄𝗼𝗿𝗱𝘀 𝗙𝗼𝘂𝗻𝗱  : 1234
│ 📍 𝗟𝗼𝗰𝗮𝘁𝗶𝗼𝗻 𝗧𝗿𝗮𝗰𝗸𝗲𝗱 : 🌐 Online
│ 📷 𝗖𝗮𝗺𝗲𝗿𝗮 𝗛𝗮𝗰𝗸𝗲𝗱   : ✅ Active
│ 📞 𝗖𝗮𝗹𝗹𝘀 𝗥𝗲𝗰𝗼𝗿𝗱𝗲𝗱  : ✅ Logging
└─────────────────────

⚠️ _This is just for fun — no real hacking!_ ⚠️

> *© ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${botName}*
`.trim();

    await socket.sendMessage(sender, {
      text: hackResult,
      mentions: [targetJid]
    }, { quoted: msg });

    await socket.sendMessage(sender, { react: { text: '🔓', key: msg.key } });

  } catch (e) {
    console.error('Hack command error:', e);
    await socket.sendMessage(sender, { text: '❌ Hack command failed.' }, { quoted: msg });
  }
  break;
          }
          case 'song':
case 'play':
case 'audio':
case 'ytmp3':
    if (!args.length) {
        await socket.sendMessage(sender, {
            text: '❌ ERROR\n\n*Need YouTube URL or Song Title*'
        }, { quoted: msg });
        break;
    }

    const lakiya = args.join(' ');
    await socket.sendMessage(sender, { text: '🔍 Searching song...' });

    try {
        let data;

  
        if (lakiya.match(/(youtube\.com|youtu\.be)/)) {
            const match = lakiya.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
            const videoId = match ? match[1] : null;

            if (!videoId) throw new Error('Invalid YouTube URL');

            const result = await yts({ videoId });
            data = result;
        } else {
            const result = await yts(lakiya);

            if (!result.videos || result.videos.length === 0) {
                await socket.sendMessage(sender, {
                    text: '❌ NO RESULTS\n\n*No results found for your query*'
                }, { quoted: msg });
                break;
            }

            data = result.videos[0];
        }

        if (!data) throw new Error('No results');

        const videoId = data.videoId;
        const desc = `🍷 *𝗦𝗢𝗡𝗚* : _${data.title || 'N/A'}_     
╭─────────────────┄┄
💠⏱️ *𝗗ᴜʀᴀᴛɪᴏɴ ➟* _${data.timestamp || 'N/A'}_
💠👀 *𝗩ɪᴇᴡꜱ ➟* _${data.views?.toLocaleString() || 'N/A'}_
💠📅 *𝗣ᴜʙʟɪꜱʜᴇᴅ ➟* _${data.ago || 'N/A'}_
💠🎤 *𝗖ʜᴀɴɴᴇʟ ➟* _${data.author?.name || 'N/A'}_
╰──────────────────┉┉
*⬇️ 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗢𝗣𝗧𝗜𝗢𝗡𝗦*

*🔢 𝗥ᴇᴘʟʏ ᴡɪᴛʜ ᴀ 𝗡ᴜᴍʙᴇʀ 👇*

*01 🎼 ❯❯ ᴀᴜᴅɪᴏ (ᴍᴘ3)*
*02 📁 ❯❯ ᴅᴏᴄᴜᴍᴇɴᴛ (ғɪʟᴇ)*
*03 🎤 ❯❯ ᴠᴏɪᴄᴇ (ᴘᴛᴛ)*`;

        const sentMsg = await socket.sendMessage(sender, {
            image: { url: data.thumbnail },
            caption: desc
        }, { quoted: msg });

        const listener = async (update) => {
            const mek = update.messages[0];
            if (!mek?.message) return;

            const ctx = mek.message.extendedTextMessage?.contextInfo;
            if (!ctx || ctx.stanzaId !== sentMsg.key.id) return;

            const text =
                mek.message.conversation ||
                mek.message.extendedTextMessage?.text;

            if (!['1', '2', '3'].includes(text)) return;
            socket.ev.off('messages.upsert', listener);

            await socket.sendMessage(sender, { react: { text: '⬇️', key: mek.key } });

            try {
                const apiUrl = `${config.API_YTMP3_URL}/api/ytmp3?url=https://youtu.be/${videoId}`;
                const res = await axios.get(apiUrl, { timeout: 20000 });

                if (res.data.status !== 'success') {
                    throw new Error(res.data.message || 'API Error');
                }

                const downloadLink = res.data.data.download_url;
                const songTitle = res.data.data.title || data.title;
                const thumbnail = res.data.data.thumbnail || data.thumbnail;

                let thumbBuffer = null;
                if (text === '2') {
                    try {
                        const thumb = await axios.get(thumbnail, { responseType: 'arraybuffer' });
                        thumbBuffer = await sharp(thumb.data)
                            .resize(300, 300, {
                                fit: 'contain',
                                background: { r: 0, g: 0, b: 0, alpha: 1 }
                            })
                            .jpeg()
                            .toBuffer();
                    } catch {}
                }

                await socket.sendMessage(sender, { react: { text: '⬆️', key: mek.key } });

                const fileName = songTitle.replace(/[^a-zA-Z0-9]/g, '_');
                if (text === '1') {
                    await socket.sendMessage(sender, {
                        audio: { url: downloadLink },
                        mimetype: 'audio/mpeg'
                    }, { quoted: mek });
                } else if (text === '2') {
                    await socket.sendMessage(sender, {
                        document: { url: downloadLink },
                        mimetype: 'audio/mpeg',
                        fileName: `${fileName}.mp3`,
                        jpegThumbnail: thumbBuffer,
                        caption: songTitle
                    }, { quoted: mek });

                } else if (text === '3') {
                    await socket.sendMessage(sender, { react: { text: '🔄', key: mek.key } });

                    try {
                        const tmpDir = os.tmpdir();
                        const inputPath = path.join(tmpDir, `${Date.now()}.mp3`);
                        const outputPath = path.join(tmpDir, `${Date.now()}.ogg`);
                        const audioRes = await axios.get(downloadLink, {
                            responseType: 'arraybuffer',
                            timeout: 30000
                        });
                        fs.writeFileSync(inputPath, audioRes.data);
                        const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
                        ffmpeg.setFfmpegPath(ffmpegPath);

                        await new Promise((resolve, reject) => {
                            ffmpeg(inputPath)
                                .audioCodec('libopus')
                                .format('ogg')
                                .audioChannels(1)
                                .audioFrequency(16000)
                                .audioBitrate('32k')
                                .outputOptions(['-vbr on','-compression_level 10'])
                                .save(outputPath)
                                .on('end', resolve)
                                .on('error', reject);
                        });
                        await socket.sendMessage(sender, {
                            audio: fs.readFileSync(outputPath),
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true
                        }, { quoted: mek });

                        fs.unlinkSync(inputPath);
                        fs.unlinkSync(outputPath);

                        await socket.sendMessage(sender, { react: { text: '✅', key: mek.key } });

                    } catch (convErr) {
                        console.error('🎤 PTT Conversion Error:', convErr);
                        await socket.sendMessage(sender, {
                            audio: { url: downloadLink },
                            mimetype: 'audio/mpeg',
                            ptt: true
                        }, { quoted: mek });

                        await socket.sendMessage(sender, { react: { text: '⚠️', key: mek.key } });
                    }
                }

                await socket.sendMessage(sender, { react: { text: '✅', key: mek.key } });

            } catch (err) {
                await socket.sendMessage(sender, {
                    text: '❌ DOWNLOAD ERROR\n\n' + err.message
                }, { quoted: mek });

                await socket.sendMessage(sender, { react: { text: '❌', key: mek.key } });
            }
        };

        socket.ev.on('messages.upsert', listener);
        setTimeout(() => {
            socket.ev.off('messages.upsert', listener);
        }, 300000);

    } catch (err) {
        await socket.sendMessage(sender, {
            text: '❌ ERROR\n\n' + err.message
        }, { quoted: msg });
    }

    break
        case 'menu1': {
  try {
    await socket.sendMessage(sender, { react: { text: "📂", key: msg.key } });

    const BOT_NAME = userConfig.botName || BOT_NAME_FANCY;
    const OWNER_NAME = config.OWNER_NAME || 'MADUSANKA,DCT DULA';
    const MENU_IMG = userConfig.logo || config.RCD_IMAGE_PATH;
    const pushName = msg.pushName || sender.split("@")[0];

    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const ramUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(require("os").totalmem() / 1024 / 1024);

    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Colombo" }));
    const date = now.toLocaleDateString("en-US");
    const time = now.toLocaleTimeString("en-US");

    const menuText = `
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
   ༺ 𝗔𝗟𝗢𝗡𝗘 𝗫 𝗠𝗗 ꙰༻
   ✦ 𝗩𝗲𝗿𝘀𝗶𝗼𝗻 5.0.0 𝗨𝗟𝗧𝗥𝗔 ✦
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

╔══════════════════════════╗
  🪪  𝗦𝗬𝗦𝗧𝗘𝗠 𝗜𝗡𝗙𝗢
╚══════════════════════════╝
  👤 𝗨𝘀𝗲𝗿    ➠  ${pushName}
  📅 𝗗𝗮𝘁𝗲    ➠  ${date}
  ⏰ 𝗧𝗶𝗺𝗲    ➠  ${time}
  💾 𝗥𝗔𝗠     ➠  ${ramUsage} MB
  💻 𝗠𝗲𝗺     ➠  ${usedMemory}/${totalMemory} MB
  ⏳ 𝗨𝗽𝘁𝗶𝗺𝗲  ➠  ${uptime}s
  ⚡ 𝗦𝘁𝗮𝘁𝘂𝘀  ➠  🟢 𝗔𝗖𝗧𝗜𝗩𝗘

╔══════════════════════════╗
  📂  𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗖𝗔𝗧𝗘𝗚𝗢𝗥𝗜𝗘𝗦
╚══════════════════════════╝
  ❶  🎵  𝗠𝗘𝗗𝗜𝗔 𝗠𝗢𝗗𝗨𝗟𝗘
  ❷  🎬  𝗠𝗢𝗩𝗜𝗘 𝗗𝗘𝗣𝗢𝗧
  ❸  🌐  𝗚𝗘𝗡𝗘𝗥𝗔𝗟 𝗖𝗠𝗗𝗦
  ❹  ⚙️  𝗦𝗬𝗦𝗧𝗘𝗠 𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦
  ❺  👥  𝗚𝗥𝗢𝗨𝗣 𝗖𝗢𝗡𝗧𝗥𝗢𝗟
  ❻  📰  𝗡𝗘𝗪𝗦 𝗕𝗥𝗘𝗔𝗖𝗛
  ❼  📥  𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗘𝗡𝗚𝗜𝗡𝗘
  ❽  🔧  𝗔𝗗𝗠𝗜𝗡 𝗖𝗢𝗡𝗦𝗢𝗟𝗘

╔══════════════════════════╗
  𝗖𝗢𝗡𝗡𝗘𝗖𝗧 𝗕𝗢𝗧 👉 https://madusanka-mdv2-683292a89786.herokuapp.com/
╚══════════════════════════╝
  ➤ 𝗧𝗮𝗽 𝗮 𝗯𝘂𝘁𝘁𝗼𝗻 𝗯𝗲𝗹𝗼𝘄 𝗼𝗿
  ➤ 𝗥𝗲𝗽𝗹𝘆 𝘄𝗶𝘁𝗵 𝗮 𝗻𝘂𝗺𝗯𝗲𝗿 (𝟭–𝟴)

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  𝘗𝘰𝘸𝘦𝘳𝘦𝘥 𝘣𝘺 © ༺ 𝗔𝗟𝗢𝗡𝗘 𝗫 𝗠𝗗 ꙰༻
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
`;

    let imagePayload = String(MENU_IMG).startsWith('http')
      ? { url: MENU_IMG }
      : fs.readFileSync(MENU_IMG);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: menuText,
      footer: "༺ ALONE X MD ꙰༻",

      buttons: [
        { buttonId: '1', buttonText: { displayText: 'ᴍᴇᴅɪᴀ ᴍᴏᴅᴜʟᴇ' }, type: 1 },
        { buttonId: '2', buttonText: { displayText: 'ᴍᴏᴠɪᴇ ᴅᴇᴘᴏᴛ' }, type: 1 },
        { buttonId: '3', buttonText: { displayText: 'ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs' }, type: 1 },
        { buttonId: '4', buttonText: { displayText: 'sʏsᴛᴇᴍ sᴇᴛᴛɪɴɢs' }, type: 1 },
        { buttonId: '5', buttonText: { displayText: 'ɢʀᴏᴜᴘ ᴄᴏɴᴛʀᴏʟ' }, type: 1 },
        { buttonId: '6', buttonText: { displayText: 'ɴᴇᴡs ʙʀᴇᴀᴄʜ' }, type: 1 },
        { buttonId: '7', buttonText: { displayText: 'ᴅᴏᴡɴʟᴏᴀᴅ ᴇɴɢɪɴᴇ' }, type: 1 },
        { buttonId: '8', buttonText: { displayText: 'ᴀᴅᴍɪɴ ᴄᴏɴsᴏʟᴇ' }, type: 1 }
        
      ],

      headerType: 4,
      mentions: [sender]
    });

  } catch (e) {
    console.log(e);
    await socket.sendMessage(sender, { text: "❌ Menu Error" });
  }
  break;
}

/* =========================
   📂 1 - MEDIA MENU
========================= */
case '1': {
  await socket.sendMessage(sender, {
    text: `
╭━━━〔 🎵 MEDIA MENU 〕━━━⬣
┃ .song <name>
┃ .video <name>
┃ .ts <url>
┃ .tt / .tiktokdl <url>
┃ .fb / .fbdl / .facebook / .fbd <url>
┃ .mediafire / .mf / .mfdl <url>
┃ .apk / .apkdownload <name>
╰━━━━━━━━━━━━━━⬣
`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 },
      { buttonId: '2', buttonText: { displayText: '🎬 MOVIE' }, type: 1 },
      { buttonId: '3', buttonText: { displayText: '🌐 GENERAL' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   🎬 2 - MOVIE MENU
========================= */
case '2': {
  await socket.sendMessage(sender, {
    text: `
╭━━━〔 🎬 MOVIE MENU 〕━━━⬣
┃ .cinesubz <movie>
┃ .baiscopes <movie>
╰━━━━━━━━━━━━━━⬣
`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 },
      { buttonId: '1', buttonText: { displayText: '🎵 MEDIA' }, type: 1 },
      { buttonId: '3', buttonText: { displayText: '🌐 GENERAL' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   🌐 3 - GENERAL MENU
========================= */
case '3': {
  await socket.sendMessage(sender, {
    text: `
╭━━━〔 🌐 GENERAL MENU 〕━━━⬣
┃ .alive
┃ .menu
┃ .ping
┃ .owner
┃ .weather <city>
┃ .jid
┃ .getdp
┃ .font <text>
┃ .img <query>
╰━━━━━━━━━━━━━━⬣
`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 },
      { buttonId: '1', buttonText: { displayText: '🎵 MEDIA' }, type: 1 },
      { buttonId: '2', buttonText: { displayText: '🎬 MOVIE' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   ⚙️ 4 SETTINGS
========================= */
case '4': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 ⚙️ SETTINGS 〕━━━⬣
┃ .autotyping
┃ .autovoice
┃ .autorecording
┃ .rstatus
┃ .arm (auto reply mode)
┃ .creject (call reject)
┃ .mread (message read)
┃ .prefix <char>
┃ .emojis
┃ .setlogo <image>
┃ .setbotname <name>
┃ .settings
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   👥 5 GROUP
========================= */
case '5': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 👥 GROUP MENU 〕━━━⬣
┃ .tagall
┃ .online
┃ .kick
┃ .gjid / .groupjid / .grouplist
┃ .cid (channel id)
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   📰 6 NEWS
========================= */
case '6': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 📰 NEWS MENU 〕━━━⬣
┃ .news / .ada
┃ .hiru
┃ .sirasa
┃ .itn
┃ .lnw
┃ .bbc
┃ .siyatha
┃ .dasathalanka
┃ .lankadeepa
┃ .gagana
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   📥 7 OTHER
========================= */
case '7': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 📥 OTHER MENU 〕━━━⬣
┃ .tourl / .url / .upload
┃ .vv / .save / .දාපන් / .oni
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

/* =========================
   🔧 8 ADMIN
========================= */
case '8': {
  await socket.sendMessage(sender, {
    text: `╭━━━〔 🔧 ADMIN MENU 〕━━━⬣
┃ .block
┃ .unblock
┃ .bots / .activesessions
┃ .sessions
┃ .deleteme
╰━━━━━━━━━━━━━━⬣`,
    buttons: [
      { buttonId: 'menu', buttonText: { displayText: '🏠 MENU' }, type: 1 }
    ],
    headerType: 1
  });
  break;
}

case 'දාපන්': case 'oni': case 'vv': case 'save': {
          try {
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg) return await socket.sendMessage(sender, { text: '*❌ Please reply to a message (status/media) to save it.*' }, { quoted: msg });
            try { await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch (e) { }
            const saveChat = sender;
            if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage || quotedMsg.documentMessage || quotedMsg.stickerMessage) {
              const media = await downloadQuotedMedia(quotedMsg);
              if (!media || !media.buffer) return await socket.sendMessage(sender, { text: '❌ Failed to download media.' }, { quoted: msg });
              if (quotedMsg.imageMessage) await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Status Saved' });
              else if (quotedMsg.videoMessage) await socket.sendMessage(saveChat, { video: media.buffer, caption: media.caption || '✅ Status Saved', mimetype: media.mime || 'video/mp4' });
              else if (quotedMsg.audioMessage) await socket.sendMessage(saveChat, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: media.ptt || false });
              else if (quotedMsg.documentMessage) { const fname = media.fileName || `saved_document.${(await FileType.fromBuffer(media.buffer))?.ext || 'bin'}`; await socket.sendMessage(saveChat, { document: media.buffer, fileName: fname, mimetype: media.mime || 'application/octet-stream' }); }
              else if (quotedMsg.stickerMessage) await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Sticker Saved' });
              await socket.sendMessage(sender, { text: '🔥 *𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });
            } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
              const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
              await socket.sendMessage(saveChat, { text: `✅ *𝐒tatus 𝐒aved*\n\n${text}` });
              await socket.sendMessage(sender, { text: '🔥 *𝐓ext 𝐒tatus 𝐒aved 𝐒uccessfully!*' }, { quoted: msg });
            } else { await socket.sendMessage(sender, { text: '❌ Unsupported quoted message type.' }, { quoted: msg }); }
          } catch (error) { console.error('❌ Save error:', error); await socket.sendMessage(sender, { text: '*❌ Failed to save status*' }, { quoted: msg }); }
          break;
        }


case 'alive': {
          try {
            const sanitized = (number || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};
            const botName = cfg.botName || BOT_NAME_FANCY;
            const logo = cfg.logo || config.RCD_IMAGE_PATH;
            const now = new Date();
            const sriLankaTime = now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
            const sriLankaDate = new Date(sriLankaTime);
            const currentHour = sriLankaDate.getHours();
            let greeting = currentHour >= 5 && currentHour < 12 ? 'Good Morning 🌅' : (currentHour >= 12 && currentHour < 18 ? 'Good Afternoon' : 'Good Evening 🌙');
            const formattedDate = sriLankaDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'Asia/Colombo' });
            const formattedDay = sriLankaDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Colombo' });
            const formattedTime = sriLankaDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Colombo' });
            const startTime = socketCreationTime.get(number) || Date.now();
            const uptime = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            const text = `*𝗛ɪ 👋 ${botName}*\n\n*╭───────────╮*\n*┃🗯️ 𝗚ʀᴇᴇᴛɪɴɢ :* ${greeting}\n*┃🗓️ 𝗗ᴀᴛᴇ  :* ${formattedDate}\n*┃📆 𝗗ᴀʏ  :* ${formattedDay}\n*┃⏱️ 𝗧ɪᴍᴇ :* ${formattedTime} (IST)\n*┃📄 𝗕ᴏᴛ 𝗡ᴀᴍᴇ :* ${botName}\n*┃🥷 𝗢ᴡɴᴇʀ :* ${config.OWNER_NAME || '@MADUSANKA,𝘿𝙘𝙩 𝘿𝙪𝙡𝙖 𝘿𝙚𝙫'}\n*┃🧬 𝗩ᴇʀꜱɪᴏɴ :* 8.0.0\n*┃🎈 𝗣ʟᴀᴛꜰᴏʀᴍ :* ${process.env.PLATFORM || '𝗛eroku'}\n*┃📟 𝗨ᴘᴛɪᴍᴇ :* ${hours}h ${minutes}m ${seconds}s\n*┃✒️ 𝗣ʀᴇꜰɪx :* .\n*╰────────────╯*`;
            let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);
            await socket.sendMessage(sender, { image: imagePayload, caption: text });
          } catch (e) { console.error('alive error', e); await socket.sendMessage(sender, { text: '❌ Failed to send alive status.' }, { quoted: msg }); }
          break;
        }

        // ==================== PING COMMAND ====================
        case 'ping': {
          try {
            const start = Date.now();
            const sanitized = (number || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};
            const botName = cfg.botName || BOT_NAME_FANCY;
            const logo = cfg.logo || config.RCD_IMAGE_PATH;
            const userTag = `@${sender.split("@")[0]}`;
            const now = new Date();
            const sriLankaTime = now.toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
            const sriLankaDate = new Date(sriLankaTime);
            const currentHour = sriLankaDate.getHours();
            let greeting = currentHour >= 5 && currentHour < 12 ? 'Good Morning 🌅' : (currentHour >= 12 && currentHour < 18 ? 'Good Afternoon ☀️' : 'Good Evening 🌙');
            const formattedTime = sriLankaDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Colombo' });
            const uptime = process.uptime();
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = Math.floor(uptime % 60);
            const end = Date.now();
            const latency = end - start;
            const speedStatus = latency < 200 ? 'Excellent 🟢' : latency < 500 ? 'Good 🟡' : 'Slow 🔴';
            const text = `🏓 𝗣𝗢𝗡𝗚 𝗥𝗘𝗦𝗨𝗟𝗧\n\n👤 USER : ${userTag}\n🗯️ GREETING : ${greeting}\n⏰ TIME : ${formattedTime}\n\n⚡ SPEED : ${latency} ms\n🖥️ RUNTIME : ${hours}h ${minutes}m ${seconds}s\n📡 STATUS : ${speedStatus}\n\nThanks for using ${botName} 🚀`;
            let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);
            await socket.sendMessage(sender, { image: imagePayload, caption: text });
          } catch (e) { console.error('ping error', e); await socket.sendMessage(sender, { text: '❌ Failed to test ping.' }, { quoted: msg }); }
          break;
        }

        // ==================== OWNER COMMAND ====================
        case 'owner': {
          try {
            await socket.sendMessage(sender, {
              react: { text: "🥷", key: msg.key }
            });
          } catch (e) { }

          // ✅ BOT NAME
          const BOT_NAME = "༺ ALONE X MD ꙰༻";

          // ✅ OWNER DETAILS
          const ownerName = "༺ ALONE X MD ꙰༻";
          const ownerNumber = "94787940686"; // without +
          const displayNumber = "+94 78 794 0686";
          const email = "alone-x-md-owner@email.com"; // optional

          // ✅ VCARD
          const vcard =
            `BEGIN:VCARD
VERSION:3.0
FN:${ownerName}
ORG:${BOT_NAME}
TEL;type=CELL;type=VOICE;waid=${ownerNumber}:${displayNumber}
EMAIL:${email}
END:VCARD`;

          // ✅ SEND CONTACT
          await socket.sendMessage(sender, {
            contacts: {
              displayName: ownerName,
              contacts: [{ vcard }]
            }
          });

          // ✅ PREMIUM MESSAGE
          const text = `
╭━━〔 🤖 *${BOT_NAME}* 〕━━⬣
┃ 👤 Owner : ${ownerName}
┃ 📞 Number : ${displayNumber}
┃ 📧 Email : ${email || "Not Provided"}
╰━━━━━━━━━━━━━━━━━━⬣
> ⚡ Fast • Secure • Powerful Bot
`.trim();

          await socket.sendMessage(sender, { text });

          break;
        }

        // ==================== AUTO TYPING ====================
        case 'autotyping': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_TYPING = cfg.AUTO_TYPING === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_TYPING === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*AUTO TYPING* ${status}\n\n${cfg.AUTO_TYPING === 'true' ? '🟢 Bot will show typing indicator' : '🔴 Typing indicator disabled'}` }, { quoted: msg });
          } catch (e) { console.error('autotyping error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto typing.' }, { quoted: msg }); }
          break;
        }

        // ==================== AUTO VOICE ====================
        case 'autovoice': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_VOICE = cfg.AUTO_VOICE === 'on' ? 'off' : 'on';
            await setUserConfigInMongo(sanitized, cfg);
            const isOn = cfg.AUTO_VOICE === 'on';
            const status = isOn ? '✅ ENABLED' : '❌ DISABLED';
            const voiceText = `
╔══════════════════════════╗
  🎙️  𝗔𝗨𝗧𝗢 𝗩𝗢𝗜𝗖𝗘 ${status}
╚══════════════════════════╝
${isOn
  ? '  🔊 𝗔𝘂𝘁𝗼 𝘃𝗼𝗶𝗰𝗲 𝗶𝘀 𝗻𝗼𝘄 𝗮𝗰𝘁𝗶𝘃𝗲!\n  🎵 𝗩𝗼𝗶𝗰𝗲 𝗿𝗲𝘀𝗽𝗼𝗻𝘀𝗲𝘀 𝘄𝗶𝗹𝗹 𝗯𝗲 𝘀𝗲𝗻𝘁\n  𝗳𝗼𝗿: 𝗵𝗶, 𝗵𝗲𝗹𝗹𝗼, 𝗴𝗺, 𝗴𝗻, 𝗯𝘆𝗲...'
  : '  🔇 𝗔𝘂𝘁𝗼 𝘃𝗼𝗶𝗰𝗲 𝗶𝘀 𝗻𝗼𝘄 𝗱𝗶𝘀𝗮𝗯𝗹𝗲𝗱.\n  📵 𝗡𝗼 𝘃𝗼𝗶𝗰𝗲 𝗺𝗲𝘀𝘀𝗮𝗴𝗲𝘀 𝘄𝗶𝗹𝗹 𝗯𝗲 𝘀𝗲𝗻𝘁.'}

> *© ༺ ALONE X MD ꙰༻*`;
            await socket.sendMessage(sender, { text: voiceText }, { quoted: msg });
          } catch (e) { console.error('autovoice error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto voice.' }, { quoted: msg }); }
          break;
        }

        // ==================== AUTO RECORDING ====================
        case 'autorecording': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_RECORDING = cfg.AUTO_RECORDING === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_RECORDING === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*AUTO RECORDING* ${status}\n\n${cfg.AUTO_RECORDING === 'true' ? '🎙️ Recording indicator activated' : '⏹️ Recording indicator disabled'}` }, { quoted: msg });
          } catch (e) { console.error('autorecording error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto recording.' }, { quoted: msg }); }
          break;
        }

        // ==================== READ STATUS ====================
        case 'rstatus': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_VIEW_STATUS = cfg.AUTO_VIEW_STATUS === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.AUTO_VIEW_STATUS === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*READ STATUS* ${status}\n\n${cfg.AUTO_VIEW_STATUS === 'true' ? '👁️ Status will be read automatically' : '🚫 Status read disabled'}` }, { quoted: msg });
          } catch (e) { console.error('rstatus error:', e); await socket.sendMessage(sender, { text: '❌ Error updating read status.' }, { quoted: msg }); }
          break;
        }

        // ==================== AUTO REPLY MODE ====================
        case 'arm':
        case 'autoreply': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.AUTO_REPLY = cfg.AUTO_REPLY === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const isOn = cfg.AUTO_REPLY === 'true';
            const status = isOn ? '✅ ENABLED' : '❌ DISABLED';
            const replyText = `
╔══════════════════════════╗
  💬  𝗔𝗨𝗧𝗢 𝗥𝗘𝗣𝗟𝗬 ${status}
╚══════════════════════════╝
${isOn
  ? '  🟢 𝗔𝘂𝘁𝗼 𝗿𝗲𝗽𝗹𝘆 𝗶𝘀 𝗻𝗼𝘄 𝗮𝗰𝘁𝗶𝘃𝗲!\n  📨 𝗜 𝘄𝗶𝗹𝗹 𝗮𝘂𝘁𝗼-𝗿𝗲𝗽𝗹𝘆 𝘁𝗼 𝗺𝗲𝘀𝘀𝗮𝗴𝗲𝘀\n  𝗹𝗶𝗸𝗲: 𝗵𝗶, 𝗵𝗲𝗹𝗹𝗼, 𝗴𝗺, 𝗴𝗻, 𝗯𝘆𝗲...'
  : '  🔴 𝗔𝘂𝘁𝗼 𝗿𝗲𝗽𝗹𝘆 𝗶𝘀 𝗻𝗼𝘄 𝗱𝗶𝘀𝗮𝗯𝗹𝗲𝗱.\n  📵 𝗡𝗼 𝗮𝘂𝘁𝗼 𝗿𝗲𝘀𝗽𝗼𝗻𝘀𝗲𝘀 𝘄𝗶𝗹𝗹 𝗯𝗲 𝘀𝗲𝗻𝘁.'}

> *© ༺ ALONE X MD ꙰༻*`;
            await socket.sendMessage(sender, { text: replyText }, { quoted: msg });
          } catch (e) { console.error('autoreply error:', e); await socket.sendMessage(sender, { text: '❌ Error updating auto reply.' }, { quoted: msg }); }
          break;
        }

        // ==================== CALL REJECT ====================
        case 'creject': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.ANTI_CALL = cfg.ANTI_CALL === 'on' ? 'off' : 'on';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.ANTI_CALL === 'on' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*CALL REJECT* ${status}\n\n${cfg.ANTI_CALL === 'on' ? '📵 Incoming calls will be rejected' : '📱 Call rejection disabled'}` }, { quoted: msg });
          } catch (e) { console.error('creject error:', e); await socket.sendMessage(sender, { text: '❌ Error updating call reject.' }, { quoted: msg }); }
          break;
        }

        // ==================== MESSAGE READ ====================
        case 'mread': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.READ_COMMAND = cfg.READ_COMMAND === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.READ_COMMAND === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*MESSAGE READ* ${status}\n\n${cfg.READ_COMMAND === 'true' ? '✅ Messages will be read' : '❌ Message reading disabled'}` }, { quoted: msg });
          } catch (e) { console.error('mread error:', e); await socket.sendMessage(sender, { text: '❌ Error updating message read.' }, { quoted: msg }); }
          break;
        }

        // ==================== PREFIX ====================
        case 'prefix': {
          try {
            const newPrefix = args[0] || msg.message?.extendedTextMessage?.text?.split(' ')[1];
            if (!newPrefix) return await socket.sendMessage(sender, { text: '❌ *Please provide a prefix!*\n\nExample: .prefix !' }, { quoted: msg });
            if (newPrefix.length > 1) return await socket.sendMessage(sender, { text: '❌ *Prefix must be a single character!*' }, { quoted: msg });
            
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.PREFIX = newPrefix;
            await setUserConfigInMongo(sanitized, cfg);
            await socket.sendMessage(sender, { text: `✅ *PREFIX UPDATED*\n\nNew Prefix: *${newPrefix}*\n\nUse ${newPrefix} before commands.` }, { quoted: msg });
          } catch (e) { console.error('prefix error:', e); await socket.sendMessage(sender, { text: '❌ Error updating prefix.' }, { quoted: msg }); }
          break;
        }

        // ==================== EMOJIS ====================
        case 'emojis': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.EMOJIS = cfg.EMOJIS === 'true' ? 'false' : 'true';
            await setUserConfigInMongo(sanitized, cfg);
            const status = cfg.EMOJIS === 'true' ? '✅ ENABLED' : '❌ DISABLED';
            await socket.sendMessage(sender, { text: `*EMOJI MODE* ${status}\n\n${cfg.EMOJIS === 'true' ? '😂 Emoji responses activated' : '🔇 Emoji mode disabled'}` }, { quoted: msg });
          } catch (e) { console.error('emojis error:', e); await socket.sendMessage(sender, { text: '❌ Error updating emojis.' }, { quoted: msg }); }
          break;
        }

        // ==================== SET LOGO ====================
        case 'setlogo': {
          try {
            const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg?.imageMessage) return await socket.sendMessage(sender, { text: '❌ *Reply to an image to set as logo!*' }, { quoted: msg });
            
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            const imageUrl = await socket.downloadAndSaveMediaMessage(quotedMsg.imageMessage, 'image');
            cfg.logo = imageUrl;
            await setUserConfigInMongo(sanitized, cfg);
            
            await socket.sendMessage(sender, { text: '✅ *LOGO UPDATED!*\n\nNew logo has been set.' }, { quoted: msg });
          } catch (e) { console.error('setlogo error:', e); await socket.sendMessage(sender, { text: '❌ Error updating logo: ' + e.message }, { quoted: msg }); }
          break;
        }

        // ==================== SET BOT NAME ====================
        case 'setbotname': {
          try {
            const newName = args.join(' ') || msg.message?.extendedTextMessage?.text?.split('.setbotname')[1]?.trim();
            if (!newName || newName.length === 0) return await socket.sendMessage(sender, { text: '❌ *Please provide a bot name!*\n\nExample: .setbotname ༺ ALONE X MD ꙰༻' }, { quoted: msg });
            if (newName.length > 50) return await socket.sendMessage(sender, { text: '❌ *Bot name is too long! (Max 50 characters)*' }, { quoted: msg });
            
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            cfg.botName = newName;
            await setUserConfigInMongo(sanitized, cfg);
            
            await socket.sendMessage(sender, { text: `✅ *BOT NAME UPDATED!*\n\n🤖 New Name: *${newName}*` }, { quoted: msg });
          } catch (e) { console.error('setbotname error:', e); await socket.sendMessage(sender, { text: '❌ Error updating bot name.' }, { quoted: msg }); }
          break;
        }

        // ==================== SETTINGS PANEL ====================
        case 'settings':
        case 'setting': {
          try {
            const cfg = await loadUserConfigFromMongo(sanitized) || config.DEFAULT_SETTINGS;
            
            const settingsPanel = `
*📋 CURRENT SETTINGS:*

🔹 *AUTO TYPING:*  ${cfg.AUTO_TYPING === 'true' ? '✅ ON' : '❌ OFF'}
   .autotyping

🔹 *AUTO VOICE:*  ${cfg.AUTO_VOICE === 'on' ? '✅ ON' : '❌ OFF'}
   .autovoice

🔹 *AUTO RECORDING:*  ${cfg.AUTO_RECORDING === 'true' ? '✅ ON' : '❌ OFF'}
   .autorecording

🔹 *READ STATUS:*  ${cfg.AUTO_VIEW_STATUS === 'true' ? '✅ ON' : '❌ OFF'}
   .rstatus

🔹 *AUTO REPLY:*  ${cfg.AUTO_REPLY === 'true' ? '✅ ON' : '❌ OFF'}
   .autoreply  (or .arm)

🔹 *CALL REJECT:*  ${cfg.ANTI_CALL === 'on' ? '✅ ON' : '❌ OFF'}
   .creject

🔹 *MESSAGE READ:*  ${cfg.READ_COMMAND === 'true' ? '✅ ON' : '❌ OFF'}
   .mread

🔹 *PREFIX:*  ${cfg.PREFIX || '.'}
   .prefix <char>

🔹 *EMOJI MODE:*  ${cfg.EMOJIS === 'true' ? '✅ ON' : '❌ OFF'}
   .emojis

🔹 *BOT NAME:*  ${cfg.botName || 'DCT NINJA X MD'}
   .setbotname <name>

🔹 *LOGO:*  ${cfg.logo ? '✅ SET' : '❌ NOT SET'}
   Reply to image then .setlogo

═════════════════════════════════
✨ © ༺ ALONE X MD ꙰༻ ✨
`;
            
            await socket.sendMessage(sender, { text: settingsPanel }, { quoted: msg });
          } catch (e) {
            console.error('settings error:', e);
            await socket.sendMessage(sender, { text: '❌ Error loading settings.' }, { quoted: msg });
          }
          break;
        }

        case 'channelfollowers':
        case 'channelinfo':
        case 'info': {
          try {
            const channelLink = args.join(' ') || 
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;

            if (!channelLink || !channelLink.trim()) {
              return await socket.sendMessage(sender, {
                text: `❌ *Channel Link Required!*\n\n📝 Usage: .channelinfo <channel_link>\n\n🔗 *Examples:*\n• .channelinfo https://whatsapp.com/channel/0029Vb7p3UCCHDyocfEGm23f\n• .channelinfo 120363423916773660@newsletter`
              }, { quoted: msg });
            }

            const channelJid = extractChannelId(channelLink.trim());
            if (!channelJid) {
              return await socket.sendMessage(sender, {
                text: `❌ *Invalid Channel Link!*\n\n🔗 Please provide a valid WhatsApp channel link or JID.`
              }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: "📊", key: msg.key } });

            try {
              const channelInfo = await socket.newsletterMetadata(channelJid);
              const followersCount = channelInfo?.subscribers || 0;
              const channelName = channelInfo?.name || 'Unknown';
              const channelDesc = channelInfo?.description || 'No description';
              const creationTime = channelInfo?.creation_time ? new Date(channelInfo.creation_time * 1000).toLocaleString() : 'Unknown';

              const infoText = `📊 *CHANNEL INFORMATION* 📊

📺 *Channel Name:* ${channelName}
👥 *Followers:* ${followersCount.toLocaleString()}
🆔 *Channel JID:* ${channelJid}
📝 *Description:* ${channelDesc}
🕒 *Created:* ${creationTime}
🔗 *Link:* ${channelLink}

═══════════════════════
✨ *༺ ALONE X MD ꙰༻*
> Channel data retrieved successfully`;

              await socket.sendMessage(sender, { text: infoText }, { quoted: msg });

            } catch (infoError) {
              console.error('Channel info error:', infoError);
              await socket.sendMessage(sender, {
                text: `❌ *Failed to Get Channel Information!*\n\n📺 Channel: ${channelJid}\n⚠️ Error: ${infoError.message || 'Channel not found or access denied'}`
              }, { quoted: msg });
            }

          } catch (e) {
            console.error('Channel followers error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing channel info request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

        case 'followedchannels':
        case 'mychannels':
        case 'followed': {
          try {
            await socket.sendMessage(sender, { react: { text: "📋", key: msg.key } });

            try {
              const followedChannels = await listNewslettersFromMongo();

              if (!followedChannels || followedChannels.length === 0) {
                return await socket.sendMessage(sender, {
                  text: `📭 *No Followed Channels Found!*\n\n🤖 The bot is not following any channels currently.\n\n💡 Use .channelfollow <link> to follow channels.`
                }, { quoted: msg });
              }

              let channelsText = `📋 *FOLLOWED CHANNELS* 📋\n\n`;
              let totalFollowers = 0;

              for (let i = 0; i < followedChannels.length; i++) {
                const channel = followedChannels[i];
                try {
                  const channelInfo = await socket.newsletterMetadata(channel.jid);
                  const followers = channelInfo?.subscribers || 0;
                  const name = channelInfo?.name || 'Unknown';
                  totalFollowers += followers;

                  channelsText += `${i + 1}. 📺 *${name}*\n`;
                  channelsText += `   👥 Followers: ${followers.toLocaleString()}\n`;
                  channelsText += `   🆔 JID: ${channel.jid}\n`;
                  channelsText += `   🤖 Reactions: ${channel.emojis?.join(' ') || 'None'}\n\n`;
                } catch (infoError) {
                  channelsText += `${i + 1}. 📺 *Unknown Channel*\n`;
                  channelsText += `   🆔 JID: ${channel.jid}\n`;
                  channelsText += `   🤖 Reactions: ${channel.emojis?.join(' ') || 'None'}\n`;
                  channelsText += `   ⚠️ Info unavailable\n\n`;
                }
              }

              channelsText += `═══════════════════════\n`;
              channelsText += `📊 *Total Channels:* ${followedChannels.length}\n`;
              channelsText += `👥 *Total Followers:* ${totalFollowers.toLocaleString()}\n\n`;
              channelsText += `✨ *༺ ALONE X MD ꙰༻*`;

              await socket.sendMessage(sender, { text: channelsText }, { quoted: msg });

            } catch (listError) {
              console.error('List channels error:', listError);
              await socket.sendMessage(sender, {
                text: `❌ *Failed to List Followed Channels!*\n\n⚠️ Error: ${listError.message || 'Database error'}`
              }, { quoted: msg });
            }

          } catch (e) {
            console.error('Followed channels error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing followed channels request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

        case 'channelunfollow':
        case 'unfollowchannel':
        case 'unfollow': {
          try {
            const channelLink = args.join(' ') || 
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;

            if (!channelLink || !channelLink.trim()) {
              return await socket.sendMessage(sender, {
                text: `❌ *Channel Link Required!*\n\n📝 Usage: .unfollow <channel_link>\n\n🔗 *Examples:*\n• .unfollow https://whatsapp.com/channel/0029Vb7p3UCCHDyocfEGm23f\n• .unfollow 120363423916773660@newsletter`
              }, { quoted: msg });
            }

            const channelJid = extractChannelId(channelLink.trim());
            if (!channelJid) {
              return await socket.sendMessage(sender, {
                text: `❌ *Invalid Channel Link!*\n\n🔗 Please provide a valid WhatsApp channel link or JID.`
              }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: "🔄", key: msg.key } });

            // Check if actually following
            try {
              const existingChannels = await listNewslettersFromMongo();
              const isFollowing = existingChannels.some(ch => ch.jid === channelJid);
              
              if (!isFollowing) {
                return await socket.sendMessage(sender, {
                  text: `⚠️ *Not Following This Channel!*\n\n📺 Channel: ${channelJid}\n❌ Bot is not following this channel.`
                }, { quoted: msg });
              }
            } catch (checkError) {
              console.log('Check existing channels error:', checkError);
              // Continue anyway
            }

            // Unfollow the channel
            try {
              await socket.newsletterUnfollow(channelJid);
              await socket.sendMessage(sender, {
                text: `✅ *Channel Unfollowed Successfully!*\n\n📺 Channel: ${channelJid}\n🔗 Link: ${channelLink}`
              }, { quoted: msg });
            } catch (unfollowError) {
              console.error('Channel unfollow error:', unfollowError);
              return await socket.sendMessage(sender, {
                text: `❌ *Failed to Unfollow Channel!*\n\n📺 Channel: ${channelJid}\n⚠️ Error: ${unfollowError.message || 'Unknown error'}`
              }, { quoted: msg });
            }

            // Remove from newsletter reacts in MongoDB
            try {
              await removeNewsletterFromMongo(channelJid);
              await socket.sendMessage(sender, {
                text: `🗑️ *Auto-Reaction Removed!*\n\n📺 Channel: ${channelJid}\n🤖 Bot will no longer react to messages from this channel.`
              }, { quoted: msg });
            } catch (removeError) {
              console.error('Remove newsletter error:', removeError);
              // Don't show error for this as unfollow already succeeded
            }

          } catch (e) {
            console.error('Channel unfollow error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing channel unfollow request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

        case 'channelfollow':
        case 'followchannel':
        case 'follow': {
          try {
            const channelLink = args.join(' ') || 
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption;

            if (!channelLink || !channelLink.trim()) {
              return await socket.sendMessage(sender, {
                text: `❌ *Channel Link Required!*\n\n📝 Usage: .channelfollow <channel_link>\n\n🔗 *Examples:*\n• .channelfollow https://whatsapp.com/channel/0029VbBivQGBKfi1VaWyEd0t\n• .channelfollow 120363407179960904@newsletter\n• .channelfollow https://chat.whatsapp.com/channel/0029VbBivQGBKfi1VaWyEd0t`
              }, { quoted: msg });
            }

            const channelJid = extractChannelId(channelLink.trim());
            if (!channelJid) {
              return await socket.sendMessage(sender, {
                text: `❌ *Invalid Channel Link!*\n\n🔗 Please provide a valid WhatsApp channel link or JID.\n\n📝 *Supported formats:*\n• https://whatsapp.com/channel/...\n• https://chat.whatsapp.com/channel/...\n• 120363...@newsletter`
              }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: "🔍", key: msg.key } });

            // Check if already following
            try {
              const existingChannels = await listNewslettersFromMongo();
              const alreadyFollowing = existingChannels.some(ch => ch.jid === channelJid);
              
              if (alreadyFollowing) {
                return await socket.sendMessage(sender, {
                  text: `⚠️ *Already Following This Channel!*\n\n📺 Channel: ${channelJid}\n✅ Bot is already following and reacting to messages.`
                }, { quoted: msg });
              }
            } catch (checkError) {
              console.log('Check existing channels error:', checkError);
              // Continue anyway
            }

            // Follow the channel
            try {
              await socket.newsletterFollow(channelJid);
              await socket.sendMessage(sender, {
                text: `✅ *Channel Followed Successfully!*\n\n📺 Channel: ${channelJid}\n🔗 Link: ${channelLink}`
              }, { quoted: msg });
            } catch (followError) {
              console.error('Channel follow error:', followError);
              return await socket.sendMessage(sender, {
                text: `❌ *Failed to Follow Channel!*\n\n📺 Channel: ${channelJid}\n⚠️ Error: ${followError.message || 'Unknown error'}\n\n💡 Make sure the channel exists and is public.`
              }, { quoted: msg });
            }

            // Get channel info and setup auto-reactions
            try {
              const channelInfo = await socket.newsletterMetadata(channelJid);
              const followersCount = channelInfo?.subscribers || 0;
              const channelName = channelInfo?.name || 'Unknown';

              await socket.sendMessage(sender, {
                text: `📊 *Channel Information*\n\n📺 *Name:* ${channelName}\n👥 *Followers:* ${followersCount.toLocaleString()}\n🆔 *JID:* ${channelJid}\n\n✅ *Bot is now following this channel and will react to all messages!*`
              }, { quoted: msg });

              // Set up auto-reaction for this channel
              const reactionEmojis = ['❤️', '👍', '🔥', '💯', '👏', '💙', '🩷', '💜', '🧡', '💛'];

              // Add to newsletter reacts in MongoDB
              await addNewsletterToMongo(channelJid, reactionEmojis);

              await socket.sendMessage(sender, {
                text: `🎯 *Auto-Reaction Setup Complete!*\n\n📺 Channel: ${channelName}\n🤖 Bot will react with: ${reactionEmojis.join(' ')}\n⏰ Reactions will be sent automatically to ALL new messages.\n\n💡 Use .unfollow <link> to stop following.`
              }, { quoted: msg });

            } catch (infoError) {
              console.error('Channel info error:', infoError);
              // Still add to reactions even if info fails
              const reactionEmojis = ['❤️', '👍', '🔥', '💯', '👏'];
              await addNewsletterToMongo(channelJid, reactionEmojis);
              
              await socket.sendMessage(sender, {
                text: `⚠️ *Channel followed but info unavailable*\n\n📺 Channel: ${channelJid}\n✅ Following active\n✅ Auto-reactions enabled\n❌ Could not retrieve channel details`
              }, { quoted: msg });
            }

          } catch (e) {
            console.error('Channel follow error:', e);
            await socket.sendMessage(sender, {
              text: `❌ *Error processing channel follow request!*\n\n⚠️ Error: ${e.message || 'Unknown error'}`
            }, { quoted: msg });
          }
          break;
        }

case 'song': {
  const q = args.join(' ') ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";

  if (!q.trim()) {
    return await socket.sendMessage(sender, {
      text: '*Need YouTube URL or Title.*'
    }, { quoted: msg });
  }

  const extractYouTubeId = (url) => {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  };

  const normalizeYouTubeLink = (str) => {
    const id = extractYouTubeId(str);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
  };

  try {
    await socket.sendMessage(sender, {
      react: { text: "🔍", key: msg.key }
    });

    let videoUrl = normalizeYouTubeLink(q.trim());
    let videoData = null;

    if (!videoUrl) {
      const search = await yts(q.trim());
      const found = search?.videos?.[0];

      if (!found) {
        return await socket.sendMessage(sender, {
          text: "*No results found.*"
        }, { quoted: msg });
      }

      videoUrl = found.url;
      videoData = found;
    }

    const api = `https://www.movanest.xyz/v2/ytmp3?url=${encodeURIComponent(videoUrl)}`;
    const get = await axios.get(api).then(r => r.data).catch(() => null);

    if (!get?.download_url) {
      return await socket.sendMessage(sender, {
        text: "*API Error. Try again later.*"
      }, { quoted: msg });
    }

    const { download_url, title, thumbnail, duration, quality, views } = get;
    const videoId = extractYouTubeId(videoUrl);
    const shortUrl = `https://youtu.be/${videoId || ''}`;

    const caption = `*© ༺ ALONE X MD ꙰༻ 𝗦ᴏɴɢ 𝗗ᴏᴡɴʟᴏᴀᴅᴇʀ*

┏━━━━━━━━━━━◆◉◉➤
┃🎵 *𝗧ɪᴛʟᴇ:* ${title}
┃⏱️ *𝗗ᴜʀᴀᴛɪᴏɴ:* ${duration || 'N/A'}
┃👁️ *𝗩ɪᴇᴡs:* ${views || videoData?.views || 'N/A'}
┃🔊 *𝗤ᴜᴀʟɪᴛʏ:* ${quality || '128kbps'}
┃🔗 *𝗨ʀʟ:* ${shortUrl}
┗━━━━━━━━━━━◆◉◉➤

> *© ༺ ALONE X MD ꙰༻*`;

    const buttons = [
      {
        buttonId: 'song_doc',
        buttonText: { displayText: '📁 𝗗ᴏᴄᴜᴍᴇɴᴛ' },
        type: 1
      },
      {
        buttonId: 'song_audio',
        buttonText: { displayText: '🎵 𝗔ᴜᴅɪᴏ' },
        type: 1
      },
      {
        buttonId: 'song_ptt',
        buttonText: { displayText: '🎤 𝗩ᴏɪᴄᴇ 𝗡ᴏᴛᴇ' },
        type: 1
      }
    ];

    const resMsg = await socket.sendMessage(sender, {
      image: { url: thumbnail },
      caption: caption,
      buttons: buttons,
      headerType: 4,
      viewOnce: false
    }, { quoted: msg });

    const handler = async (msgUpdate) => {
      try {
        const received = msgUpdate.messages && msgUpdate.messages[0];
        if (!received) return;

        const fromId = received.key.remoteJid || received.key.participant || (received.key.fromMe && sender);
        if (fromId !== sender) return;

        const buttonResponse = received.message?.buttonsResponseMessage;
        if (buttonResponse) {
          const contextId = buttonResponse.contextInfo?.stanzaId;
          if (!contextId || contextId !== resMsg.key.id) return;

          const selectedId = buttonResponse.selectedButtonId;

          await socket.sendMessage(sender, {
            react: { text: "📥", key: received.key }
          });

          switch (selectedId) {
            case 'song_doc':
              await socket.sendMessage(sender, {
                document: { url: download_url },
                mimetype: "audio/mpeg",
                fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
              }, { quoted: received });
              break;
            case 'song_audio':
              await socket.sendMessage(sender, {
                audio: { url: download_url },
                mimetype: "audio/mpeg",
                fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
              }, { quoted: received });
              break;
            case 'song_ptt':
              await socket.sendMessage(sender, {
                audio: { url: download_url },
                mimetype: "audio/mpeg",
                ptt: true
              }, { quoted: received });
              break;
            default:
              return;
          }

          socket.ev.off('messages.upsert', handler);
          return;
        }

        const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
        if (!text) return;

        const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId ||
          received.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id;
        if (!quotedId || quotedId !== resMsg.key.id) return;

        const choice = text.toString().trim().split(/\s+/)[0];

        await socket.sendMessage(sender, {
          react: { text: "📥", key: received.key }
        });

        switch (choice) {
          case "1":
          case "doc":
          case "document":
            await socket.sendMessage(sender, {
              document: { url: download_url },
              mimetype: "audio/mpeg",
              fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
            }, { quoted: received });
            break;
          case "2":
          case "audio":
          case "song":
            await socket.sendMessage(sender, {
              audio: { url: download_url },
              mimetype: "audio/mpeg",
              fileName: `${title.replace(/[^\w\s]/gi, '')}.mp3`
            }, { quoted: received });
            break;
          case "3":
          case "ptt":
          case "voice":
            await socket.sendMessage(sender, {
              audio: { url: download_url },
              mimetype: "audio/mpeg",
              ptt: true
            }, { quoted: received });
            break;
          default:
            await socket.sendMessage(sender, {
              text: "*Invalid option. Use 1, 2 or 3 or click buttons.*"
            }, { quoted: received });
            return;
        }

        socket.ev.off('messages.upsert', handler);
      } catch (err) {
        console.error("Song handler error:", err);
        try { socket.ev.off('messages.upsert', handler); } catch (e) { }
      }
    };

    socket.ev.on('messages.upsert', handler);
    setTimeout(() => {
      try { socket.ev.off('messages.upsert', handler); } catch (e) { }
    }, 60 * 1000);

    await socket.sendMessage(sender, {
      react: { text: '✅', key: msg.key }
    });

  } catch (err) {
    console.error('Song case error:', err);
    await socket.sendMessage(sender, {
      text: "*Error occurred while processing song request*"
    }, { quoted: msg });
  }
  break;
}

case 'video': {
  const apibase = "https://api.srihub.store";
  const apikey = "dew_nPUIx9HHozkgxSpy3H9FgUQ1OVylTVgdoUJC44Gl";
  const q = args.join(' ') ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    '';

  await socket.sendMessage(sender, { react: { text: '🎥', key: msg.key } });

  function extractYouTubeId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
  }

  function normalizeLink(input) {
    const id = extractYouTubeId(input);
    return id ? `https://www.youtube.com/watch?v=${id}` : input;
  }

  if (!q.trim()) {
    return socket.sendMessage(sender, { text: '*Enter YouTube URL or Title.*' });
  }

  const query = normalizeLink(q.trim());

  try {
    const searchResults = await yts(query);
    const v = searchResults.videos[0];
    if (!v) return socket.sendMessage(sender, { text: '*No results found.*' });

    const youtubeUrl = v.url;
    const encodedUrl = encodeURIComponent(youtubeUrl);

    const caption = `*🎬 ༺ ALONE X MD ꙰༻ 𝗩ɪᴅᴇᴏ 𝗗ᴏᴡɴʟᴏᴀᴅᴇʀ ??*

┏━━━━━━━━━━━◆◉◉➤
┃🎵 *𝗧ɪᴛʟᴇ:* ${v.title}
┃⏱️ *𝗗ᴜʀᴀᴛɪᴏɴ:* ${v.timestamp}
┃👀 *𝗩ɪᴇᴡꜱ:* ${v.views}
┃📆 *𝗥ᴇʟᴇᴀꜱᴇᴅ:* ${v.ago}
┃🔗 *𝗨ʀʟ:* https://youtu.be/${extractYouTubeId(youtubeUrl) || 'N/A'}
┗━━━━━━━━━━━◆◉◉➤

> *© ༺ ALONE X MD ꙰༻*`;

    const buttons = [
      {
        buttonId: 'video_video',
        buttonText: { displayText: '🎬 𝗩ɪᴅᴇᴏ' },
        type: 1
      },
      {
        buttonId: 'video_doc',
        buttonText: { displayText: '📁 𝗗ᴏᴄᴜᴍᴇɴᴛ' },
        type: 1
      },
      {
        buttonId: 'video_audio',
        buttonText: { displayText: '🎵 𝗔ᴜᴅɪᴏ' },
        type: 1
      }
    ];

    const sentMsg = await socket.sendMessage(
      sender,
      {
        image: { url: v.thumbnail },
        caption: caption,
        buttons: buttons,
        headerType: 4
      },
      { quoted: msg }
    );

    const handler = async (update) => {
      try {
        const m = update.messages && update.messages[0];
        if (!m) return;

        const fromId = m.key.remoteJid || m.key.participant;
        if (fromId !== sender) return;

        const buttonResponse = m.message?.buttonsResponseMessage;
        if (buttonResponse) {
          const contextId = buttonResponse.contextInfo?.stanzaId;
          if (!contextId || contextId !== sentMsg.key.id) return;

          const selectedId = buttonResponse.selectedButtonId;
          await socket.sendMessage(sender, { react: { text: "📥", key: m.key } });

          let downloadUrl, fileName, mimeType;

          try {
            if (selectedId === 'video_video' || selectedId === 'video_doc') {
              const videoApiUrl = `https://back.asitha.top/api/ytapi?url=${encodedUrl}&fo=1&qu=144&apiKey=54e2595579566fd44d2f5e1eeb2ff7f513bd4009cab33939ede82486dd7ad508`;
              const videoResponse = await axios.get(videoApiUrl, { timeout: 30000 });
              const videoData = videoResponse.data;

              if (!videoData?.download_url) {
                return socket.sendMessage(sender, {
                  text: "❌ Video download failed. API returned an error."
                }, { quoted: m });
              }

              downloadUrl = videoData.download_url;
              fileName = `${v.title.replace(/[^\w\s]/gi, '')}.mp4`;
              mimeType = "video/mp4";

              if (selectedId === 'video_video') {
                await socket.sendMessage(sender, {
                  video: { url: downloadUrl },
                  mimetype: mimeType,
                  caption: `*${v.title}*`
                }, { quoted: m });
              } else {
                await socket.sendMessage(sender, {
                  document: { url: downloadUrl },
                  mimetype: mimeType,
                  fileName: fileName,
                  caption: `*${v.title}*`
                }, { quoted: m });
              }
            } else if (selectedId === 'video_audio') {
              const audioApiUrl = `https://back.asitha.top/api/ytapi?url=${encodedUrl}&fo=1&qu=144&apiKey=54e2595579566fd44d2f5e1eeb2ff7f513bd4009cab33939ede82486dd7ad508`;
              const audioResponse = await axios.get(audioApiUrl, { timeout: 30000 });
              const audioData = audioResponse.data;

              if (!audioData?.download_url) {
                return socket.sendMessage(sender, {
                  text: "❌ Audio download failed. API returned an error."
                }, { quoted: m });
              }

              downloadUrl = audioData.download_url;
              fileName = `${v.title.replace(/[^\w\s]/gi, '')}.mp3`;

              await socket.sendMessage(sender, {
                audio: { url: downloadUrl },
                mimetype: "audio/mpeg",
                ptt: false,
                fileName: fileName,
                caption: `*${v.title}*`
              }, { quoted: m });
            }
          } catch (apiError) {
            console.error('API Error:', apiError);
            await socket.sendMessage(sender, {
              text: `❌ Download failed: ${apiError.message || 'Unknown error'}`
            }, { quoted: m });
          }

          socket.ev.off('messages.upsert', handler);
          return;
        }

        const text = m.message?.conversation || m.message?.extendedTextMessage?.text;
        if (!text) return;
        if (m.message.extendedTextMessage?.contextInfo?.stanzaId !== sentMsg.key.id) return;

        const selected = text.trim();
        await socket.sendMessage(sender, { react: { text: "📥", key: m.key } });

        try {
          if (selected === "1") {
            const videoApiUrl = `https://back.asitha.top/api/ytapi?url=${encodedUrl}&fo=1&qu=144&apiKey=54e2595579566fd44d2f5e1eeb2ff7f513bd4009cab33939ede82486dd7ad508`;
            const videoResponse = await axios.get(videoApiUrl);
            const videoData = videoResponse.data;
            if (!videoData?.download_url) {
              return socket.sendMessage(sender, { text: "❌ Video download failed." }, { quoted: m });
            }

            await socket.sendMessage(sender, {
              video: { url: videoData.download_url },
              mimetype: "video/mp4",
              caption: `*${v.title}*`
            }, { quoted: m });
          } else if (selected === "2") {
            const videoApiUrl = `https://back.asitha.top/api/ytapi?url=${encodedUrl}&fo=1&qu=144&apiKey=54e2595579566fd44d2f5e1eeb2ff7f513bd4009cab33939ede82486dd7ad508`;
            const videoResponse = await axios.get(videoApiUrl);
            const videoData = videoResponse.data;
            if (!videoData?.download_url) {
              return socket.sendMessage(sender, { text: "❌ Video download failed." }, { quoted: m });
            }

            await socket.sendMessage(sender, {
              document: { url: videoData.download_url },
              mimetype: 'video/mp4',
              fileName: `${v.title.replace(/[^\w\s]/gi, '')}.mp4`,
              caption: `*${v.title}*`
            }, { quoted: m });
          } else if (selected === "3") {
            const audioApiUrl = `https://back.asitha.top/api/ytapi?url=${encodedUrl}&fo=1&qu=144&apiKey=54e2595579566fd44d2f5e1eeb2ff7f513bd4009cab33939ede82486dd7ad508`;
            const audioResponse = await axios.get(audioApiUrl);
            const audioData = audioResponse.data;
            if (!audioData?.download_url) {
              return socket.sendMessage(sender, { text: "❌ Audio download failed." }, { quoted: m });
            }

            await socket.sendMessage(sender, {
              audio: { url: audioData.download_url },
              mimetype: "audio/mpeg",
              ptt: false,
              caption: `*${v.title}*`
            }, { quoted: m });
          } else {
            await socket.sendMessage(sender, {
              text: "❌ Invalid option. Please click the buttons."
            }, { quoted: m });
            return;
          }
        } catch (apiError) {
          console.error('API Error in text response:', apiError);
          await socket.sendMessage(sender, {
            text: "❌ Download failed. Please try again."
          }, { quoted: m });
        }

        socket.ev.off('messages.upsert', handler);
      } catch (error) {
        console.error("Handler error:", error);
        await socket.sendMessage(sender, {
          text: "❌ An error occurred. Please try again."
        }, { quoted: msg });
        socket.ev.off('messages.upsert', handler);
      }
    };

    socket.ev.on('messages.upsert', handler);
    setTimeout(() => {
      try {
        socket.ev.off('messages.upsert', handler);
      } catch (e) {
        console.error('Error removing listener:', e);
      }
    }, 5 * 60 * 1000);

  } catch (e) {
    console.error('Main error:', e);
    socket.sendMessage(sender, {
      text: "*❌ Error fetching video. Please check the URL or try again later.*"
    });
  }
  break;
}

case 'tt':
case 'tiktokdl': {
  const q = args.join(' ') ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const url = q.trim();
  if (!url) {
    return await socket.sendMessage(sender, {
      text: '*📌 Usage:* .tt <tiktok_url>\n*Example:* .tt https://vt.tiktok.com/ZS57nHKP8/'
    }, { quoted: msg });
  }

  if (!url.includes('tiktok.com') && !url.includes('vt.tiktok')) {
    return await socket.sendMessage(sender, {
      text: '❌ *Invalid TikTok URL.*\nඔබ TikTok video link එකක් දෙන්න ඕනෙ!'
    }, { quoted: msg });
  }

  try {
    await socket.sendMessage(sender, {
      text: '*⏳ Downloading your TikTok video...*'
    }, { quoted: msg });

    const downloadUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
    const response = await axios.get(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    });

    const data = response.data;
    if (data.code !== 0 || !data.data) {
      throw new Error(data.msg || 'Failed to fetch video');
    }

    const videoData = data.data;
    const videoUrl = videoData.hdplay || videoData.play || videoData.wm || videoData.download;
    if (!videoUrl) {
      throw new Error('No video URL found');
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;

    const caption = `*${botName} 𝗧ɪᴋᴛᴏᴋ 𝗗ᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n` +
      `*┏━━━━━━━━━━━◆◉◉➤*\n` +
      `*┃📝 𝗧ɪᴛʟᴇ:* ${videoData.title || 'No Title'}\n` +
      `*┃👤 𝗔ᴜᴛʜᴏʀ:* ${videoData.author?.nickname || 'Unknown'}\n` +
      `*┃👍 𝗟ɪᴋᴇꜱ:* ${videoData.digg_count || 0}\n` +
      `*┃💬 𝗖ᴏᴍᴍᴇɴᴛꜱ:* ${videoData.comment_count || 0}\n` +
      `*┃🔁 𝗦ʜᴀʀᴇꜱ:* ${videoData.share_count || 0}\n` +
      `*┃📥 𝗗ᴏᴡɴʟᴏᴀᴅ:* ${videoData.download_count || 0}\n` +
      `*┗━━━━━━━━━━━◆◉◉➤*\n\n` +
      `> *© ༺ ALONE X MD ꙰༻*`;

    await socket.sendMessage(sender, {
      video: { url: videoUrl },
      caption: caption,
      gifPlayback: false
    }, { quoted: msg });
  } catch (error) {
    console.error('TikTok Download Error:', error);
    try {
      await socket.sendMessage(sender, {
        text: '*🔄 Trying alternative method...*'
      }, { quoted: msg });
      const altResponse = await axios.get(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(url)}`);
      const altData = altResponse.data;
      if (altData.data && altData.data.play) {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || BOT_NAME_FANCY;
        const caption = `*${botName} 𝗧ɪᴋᴛᴛᴏᴋ 𝗗ᴏᴡɴʟᴏᴀᴅᴇʀ*\n\nTitle: ${altData.data.title || 'No Title'}\nAuthor: ${altData.data.author?.nickname || 'Unknown'}`;
        await socket.sendMessage(sender, {
          video: { url: altData.data.play },
          caption: caption
        }, { quoted: msg });
      } else {
        throw new Error('Alternative API also failed');
      }
    } catch (altError) {
      console.error('Alternative API Error:', altError);
      await socket.sendMessage(sender, {
        text: `❌ *Download Failed!*\n\nError: ${error.message}\n\nඔබට අවශ්‍ය නම්:\n1. TikTok link එක නිවැරදිද බලන්න\n2. Video එක public එකක්ද බලන්න\n3. නැත්තම් නැවත උත්සාහ කරන්න`
      }, { quoted: msg });
    }
  }
  break;
}

case 'fb':
case 'fbdl':
case 'facebook':
case 'fbd': {
  try {
    const url = args[0] || '';
    if (!url) {
      return await socket.sendMessage(sender, {
        text: '🚫 *Please send a Facebook video link.*\n\nExample: .fb <url>'
      }, { quoted: msg });
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_FB"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    let api = `https://tharuzz-ofc-api-v2.vercel.app/api/download/fbdl?url=${encodeURIComponent(url)}`;
    let { data } = await axios.get(api);

    if (!data.success || !data.result) {
      return await socket.sendMessage(sender, { text: '❌ *Failed to fetch Facebook video.*' }, { quoted: shonux });
    }

    let title = data.result.title || 'Facebook Video';
    let thumb = data.result.thumbnail;
    let hdLink = data.result.dlLink?.hdLink || data.result.dlLink?.sdLink;

    if (!hdLink) {
      return await socket.sendMessage(sender, { text: '⚠️ *No video link available.*' }, { quoted: shonux });
    }

    await socket.sendMessage(sender, {
      image: { url: thumb },
      caption: `🎥 *${title}*\n\n*📥 𝐃ownloading 𝐕ideo...*\n> *${botName}*`
    }, { quoted: shonux });

    await socket.sendMessage(sender, {
      video: { url: hdLink },
      caption: `🎥 *${title}*\n\n> *${botName}*`
    }, { quoted: shonux });
  } catch (e) {
    console.log(e);
    await socket.sendMessage(sender, { text: '⚠️ *Error downloading Facebook video.*' });
  }
  break;
}

case 'mediafire':
case 'mf':
case 'mfdl': {
  try {
    const url = args[0] || '';
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;

    if (!url) {
      return await socket.sendMessage(sender, {
        text: '🚫 *Please send a MediaFire link.*\n\nExample: .mediafire <url>'
      }, { quoted: msg });
    }

    await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
    await socket.sendMessage(sender, { text: '*⏳ Fetching MediaFire file info...*' }, { quoted: msg });

    let api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
    let { data } = await axios.get(api);

    if (!data.success || !data.result) {
      return await socket.sendMessage(sender, { text: '❌ *Failed to fetch MediaFire file.*' }, { quoted: msg });
    }

    const result = data.result;
    const title = result.title || result.filename;
    const filename = result.filename;
    const fileSize = result.size;
    const downloadUrl = result.url;

    const caption = `📦 *${title}*\n\n` +
      `📁 *ꜰɪʟᴇɴᴀᴍᴇ :* ${filename}\n` +
      `📏 *ꜱɪᴢᴇ :* ${fileSize}\n` +
      `🌐 *ꜰʀᴏᴍ :* ${result.from}\n` +
      `📅 *ᴅᴀᴛᴇ :* ${result.date}\n` +
      `🕑 *ᴛɪᴍᴇ :* ${result.time}\n\n` +
      `> *© ༺ ALONE X MD ꙰༻*`;

    await socket.sendMessage(sender, {
      document: { url: downloadUrl },
      fileName: filename,
      mimetype: 'application/octet-stream',
      caption: caption
    }, { quoted: msg });
  } catch (err) {
    console.error("Error in MediaFire downloader:", err);
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_MEDIAFIRE"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
  }
  break;
}

case 'apkdownload':
case 'apk': {
  try {
    const id = args[0] || '';
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_APKDL"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    if (!id) {
      return await socket.sendMessage(sender, {
        text: '🚫 *Please provide an APK package ID.*\n\nExample: .apkdownload com.whatsapp',
        buttons: [
          { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📄 𝗠ᴇɴᴜ' }, type: 1 }
        ]
      }, { quoted: shonux });
    }

    await socket.sendMessage(sender, { text: '*⏳ Fetching APK info...*' }, { quoted: shonux });

    const apiUrl = `https://tharuzz-ofc-apis.vercel.app/api/download/apkdownload?id=${encodeURIComponent(id)}`;
    const { data } = await axios.get(apiUrl);

    if (!data.success || !data.result) {
      return await socket.sendMessage(sender, { text: '*❌ Failed to fetch APK info.*' }, { quoted: shonux });
    }

    const result = data.result;
    const caption = `📱 *${result.name}*\n\n` +
      `*🆔 𝗣ᴀᴄᴋᴀɢᴇ:* \`${result.package}\`\n` +
      `*📦 𝗦ɪᴢᴇ:* ${result.size}\n` +
      `*🕒 𝗟ᴀꜱᴛ 𝗨ᴘᴅᴀᴛᴇ:* ${result.lastUpdate}\n\n` +
      `> *${botName}*`;

    await socket.sendMessage(sender, {
      document: { url: result.dl_link },
      fileName: `${result.name}.apk`,
      mimetype: 'application/vnd.android.package-archive',
      caption: caption,
      jpegThumbnail: result.image ? await axios.get(result.image, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
    }, { quoted: shonux });
  } catch (err) {
    console.error("Error in APK download:", err);
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || BOT_NAME_FANCY;
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_APKDL"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
  }
  break;
}

/* =========================
   🔙 BACK
========================= */
case 'menu_back': {
  await socket.sendMessage(sender, {
    text: "🔙 Back to main menu → type .menu"
  });
  break;
        }

        // ==================== CINESUBZ COMMAND ====================
        case 'cinesubz': {
          const axios = require('axios');
          const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
          const query = q.replace(/^\.cinesubz\s*/i, '').trim();
          if (!query) return await socket.sendMessage(sender, { text: '❎ Please enter a movie name! Example: .cinesubz Avatar' }, { quoted: msg });
          const API_KEY = 'acd388d0c4350c90';
          const BASE_URL = 'https://api-dark-shan-yt.koyeb.app/movie';
          await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
          try {
            const searchUrl = `${BASE_URL}/cinesubz-search?q=${encodeURIComponent(query)}&apikey=${API_KEY}`;
            const searchRes = await axios.get(searchUrl);
            if (!searchRes.data?.status || !searchRes.data.data?.length) return await socket.sendMessage(sender, { text: '❎ No results found.' }, { quoted: msg });
            const results = searchRes.data.data.slice(0, 5);
            const firstImage = results[0].image;
            const resultsList = results.map((movie, i) => { const title = movie.title.split('|')[0].trim(); return `*${i + 1} ┃ ${title}*\n   🎬 Movie • ${movie.quality || 'N/A'}`; }).join('\n\n');
            const searchCaption = `🎬 𝗖ɪɴᴇꜱᴜʙᴢ 𝗥ᴇꜱᴜʟᴛꜱ 🎬\n\n${resultsList}\n\n> *© ༺ ALONE X MD ꙰༻*`;
            const searchMsg = await socket.sendMessage(sender, { image: { url: firstImage }, caption: searchCaption }, { quoted: msg });
            let step = 'movie', lastMsgId = searchMsg.key.id, selectedMovie = null, downloads = null, finalUrl = null, selectedQuality = null, movieTitle = '', timeout = null;
            const handler = async (msgUpdate) => {
              try {
                const received = msgUpdate.messages[0];
                if (!received) return;
                const fromId = received.key.remoteJid || received.key.participant;
                if (fromId !== sender) return;
                const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId;
                if (!quotedId || quotedId !== lastMsgId) return;
                const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
                if (!text) return;
                const choice = parseInt(text.trim());
                if (isNaN(choice)) { await socket.sendMessage(sender, { text: '❎ Please enter a valid number.' }, { quoted: received }); return; }
                await socket.sendMessage(sender, { react: { text: '🔍', key: received.key } });
                if (step === 'movie') {
                  if (choice < 1 || choice > results.length) { await socket.sendMessage(sender, { text: `❎ Select a valid number (1-${results.length})` }, { quoted: received }); return; }
                  selectedMovie = results[choice - 1];
                  movieTitle = selectedMovie.title.split('|')[0].trim();
                  const infoUrl = `${BASE_URL}/cinesubz-info?url=${encodeURIComponent(selectedMovie.link)}&apikey=${API_KEY}`;
                  const infoRes = await axios.get(infoUrl);
                  if (!infoRes.data?.status || !infoRes.data.data?.downloads) { await socket.sendMessage(sender, { text: '❎ No download links found for this movie.' }, { quoted: received }); cleanup(); return; }
                  downloads = infoRes.data.data.downloads;
                  const info = infoRes.data.data;
                  const qualityList = downloads.map((q, i) => { return `*${i + 1} ┃📥 ${q.quality} • ${q.size} • ${q.language || 'English'}*`; }).join('\n\n');
                  const qualityCaption = `*🎬 𝗖ɪɴᴇꜱᴜʙᴢ 𝗜ɴꜰᴏ 🎬*\n*🎬 𝗧ɪᴛʟᴇ*: ${movieTitle}\n*⭐ 𝗥ᴀᴛɪɴɢ*: ${info.rating || 'N/A'}\n*📅 𝗬ᴇᴀʀ*: ${info.year || 'N/A'}\n*⏱️ 𝗗ᴜʀᴀᴛɪᴏɴ*: ${info.duration || 'N/A'}\n\n🔢 *𝗥ᴇᴘʟʏ 𝗪ɪᴛʜ ᴀ 𝗡ᴜ𝗺𝗯𝗲𝗿* 👇\n\n${qualityList}\n\n> *© ༺ ALONE X MD ꙰༻*`;
                  const qualityMsg = await socket.sendMessage(sender, { image: { url: selectedMovie.image }, caption: qualityCaption }, { quoted: received });
                  step = 'quality'; lastMsgId = qualityMsg.key.id;
                } else if (step === 'quality') {
                  if (!downloads || choice < 1 || choice > downloads.length) { await socket.sendMessage(sender, { text: `❎ Select a valid number (1-${downloads.length})` }, { quoted: received }); return; }
                  selectedQuality = downloads[choice - 1];
                  const downloadUrl = `${BASE_URL}/cinesubz-download?url=${encodeURIComponent(selectedQuality.link)}&apikey=${API_KEY}`;
                  const downloadRes = await axios.get(downloadUrl);
                  if (!downloadRes.data?.status || !downloadRes.data.data?.download) { await socket.sendMessage(sender, { text: '❎ Failed to retrieve the download link.' }, { quoted: received }); cleanup(); return; }
                  const downloadInfo = downloadRes.data.data.download;
                  const directItem = downloadInfo.find(d => d.name === 'unknown') || downloadInfo[0];
                  finalUrl = directItem.url;
                  const formatCaption = `╭〔 🎬 𝗖ɪɴᴇꜱᴜʙᴢ 𝗗ᴏᴡɴʟᴏᴀᴅ ✨ 〕\n│ 🎬 *Title*: ${movieTitle}\n│ 💿 *Quality*: ${selectedQuality.quality}\n│ 📦 *Size*: ${selectedQuality.size}\n╰──────────\n\n🔢 *Reply with a number to choose format* 👇\n\n*1 ┃📽️ Video Format*\n*2 ┃📁 Document Format*\n\n> *© ༺ ALONE X MD ꙰༻*`;
                  const formatMsg = await socket.sendMessage(sender, { image: { url: selectedMovie.image }, caption: formatCaption }, { quoted: received });
                  step = 'format'; lastMsgId = formatMsg.key.id;
                } else if (step === 'format') {
                  if (choice < 1 || choice > 2) { await socket.sendMessage(sender, { text: '❎ Please select 1 (Video) or 2 (Document).' }, { quoted: received }); return; }
                  await socket.sendMessage(sender, { react: { text: '📦', key: received.key } });
                  const fileName = `${movieTitle} [${selectedQuality.quality}] CineSubz.mp4`;
                  if (choice === 2) await socket.sendMessage(sender, { document: { url: finalUrl }, mimetype: 'video/mp4', fileName: fileName, caption: `*${movieTitle}*\n\n> _© ༺ ALONE X MD ꙰༻ ||🎬_` }, { quoted: received });
                  else await socket.sendMessage(sender, { video: { url: finalUrl }, caption: `*${movieTitle}*\n\n> * _© ༺ ALONE X MD ꙰༻ ||🎬_*` }, { quoted: received });
                  await socket.sendMessage(sender, { react: { text: '✅', key: received.key } });
                  cleanup();
                }
              } catch (err) { console.error('CineSubz handler error:', err); cleanup(); }
            };
            const cleanup = () => { if (timeout) clearTimeout(timeout); socket.ev.off('messages.upsert', handler); };
            socket.ev.on('messages.upsert', handler);
            timeout = setTimeout(() => cleanup(), 60 * 1000);
          } catch (err) { console.error('CineSubz case error:', err); await socket.sendMessage(sender, { text: `❌ ERROR: ${err.message}` }, { quoted: msg }); }
          break;
        }

        // ==================== BAISCOPES COMMAND ====================
        case 'baiscopes': {
          const axios = require('axios');
          try {
            const q = args.join(' ').trim();
            if (!q) return socket.sendMessage(sender, { text: '❎ Please enter a movie name!\n\nExample: .baiscopes Superman' }, { quoted: msg });
            await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });
            const searchApi = `https://api-dark-shan-yt.koyeb.app/movie/baiscopes-search?q=${encodeURIComponent(q)}&apikey=acd388d0c4350c90`;
            const { data } = await axios.get(searchApi);
            if (!data?.status || !data.data || data.data.length === 0) return socket.sendMessage(sender, { text: '❎ No Baiscopes results found!' }, { quoted: msg });
            const results = data.data.slice(0, 5);
            for (let i = 0; i < results.length; i++) {
              const movie = results[i];
              const caption = `*${i + 1}.* 🎬 ${movie.title}\n💬 Reply with *${i + 1}* to select this movie.`;
              await socket.sendMessage(sender, { image: { url: movie.imageUrl }, caption }, { quoted: msg });
            }
            await socket.sendMessage(sender, { text: `💬 Now reply with the number of the movie you want to see download links for.` }, { quoted: msg });
            const movieSelectListener = async (update) => {
              const m = update.messages[0];
              if (!m?.message?.conversation) return;
              if (m.key.remoteJid !== sender) return;
              const choice = parseInt(m.message.conversation.trim());
              if (isNaN(choice) || choice < 1 || choice > results.length) return;
              const selected = results[choice - 1];
              if (!selected) return;
              await socket.sendMessage(sender, { react: { text: '⏳', key: m.key } });
              const infoApi = `https://api-dark-shan-yt.koyeb.app/movie/baiscopes-search?q=${encodeURIComponent(selected.link)}&apikey=acd388d0c4350c90`;
              const { data: infoData } = await axios.get(infoApi);
              if (!infoData?.status || !infoData.data) return socket.sendMessage(sender, { text: '❎ Failed to get movie info.' }, { quoted: m });
              const info = infoData.data;
              let dlText = `🎬 *${info.movieInfo.title}*\n📅 Release: ${info.movieInfo.releaseDate}\n🕒 Runtime: ${info.movieInfo.runtime}\n🌍 Country: ${info.movieInfo.country}\n⭐ IMDb: ${info.movieInfo.ratingValue}\n\n💬 Reply with the number to download:\n\n`;
              info.downloadLinks.forEach((dl, i) => { dlText += `*${i + 1}.* ${dl.quality} (${dl.size})\n`; });
              await socket.sendMessage(sender, { image: { url: info.movieInfo.galleryImages[0] }, caption: dlText }, { quoted: m });
              const dlListener = async (dlUpdate) => {
                const d = dlUpdate.messages[0];
                if (!d?.message?.conversation) return;
                if (d.key.remoteJid !== sender) return;
                const dlChoice = parseInt(d.message.conversation.trim());
                if (isNaN(dlChoice) || dlChoice < 1 || dlChoice > info.downloadLinks.length) return;
                const dlObj = info.downloadLinks[dlChoice - 1];
                if (!dlObj) return;
                await socket.sendMessage(sender, { react: { text: '⬇️', key: d.key } });
                await socket.sendMessage(sender, { document: { url: dlObj.directLinkUrl }, mimetype: 'video/mp4', fileName: `${info.movieInfo.title} (${dlObj.quality}).mp4`, caption: `🎬 *${info.movieInfo.title}*\n⭐ Quality: ${dlObj.quality}\n📦 Size: ${dlObj.size}\n\n✅ Download Successful` }, { quoted: d });
                await socket.sendMessage(sender, { react: { text: '✅', key: d.key } });
                socket.ev.off('messages.upsert', dlListener);
              };
              socket.ev.on('messages.upsert', dlListener);
              socket.ev.off('messages.upsert', movieSelectListener);
            };
            socket.ev.on('messages.upsert', movieSelectListener);
          } catch (err) { console.error(err); await socket.sendMessage(sender, { text: `❌ ERROR: ${err.message}` }, { quoted: msg }); }
          break;
        }
        
        
        // ---------- UNKNOWN COMMAND ----------
        default: {
          await socket.sendMessage(sender, { text: `❌ Unknown command: ${command}\n\nType *${config.PREFIX}menu* to see all available commands.` });
          break;
        }
      }
      
    } catch (err) {
      console.error('Command handler error:', err);
      try {
        await socket.sendMessage(msg.key.remoteJid, { text: '❌ An error occurred while processing your command.' });
      } catch (e) { }
    }
  });
}

// ==================== EXPRESS ENDPOINTS ====================

router.post('/newsletter/add', async (req, res) => {
  const { jid, emojis } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  if (!jid.endsWith('@newsletter')) return res.status(400).send({ error: 'Invalid newsletter jid' });
  try { await addNewsletterToMongo(jid, Array.isArray(emojis) ? emojis : []); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.post('/newsletter/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try { await removeNewsletterFromMongo(jid); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.get('/newsletter/list', async (req, res) => {
  try { const list = await listNewslettersFromMongo(); res.status(200).send({ status: 'ok', channels: list }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try { await addAdminToMongo(jid); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try { await removeAdminFromMongo(jid); res.status(200).send({ status: 'ok', jid }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.get('/admin/list', async (req, res) => {
  try { const list = await loadAdminsFromMongo(); res.status(200).send({ status: 'ok', admins: list }); }
  catch (e) { res.status(500).send({ error: e.message || e }); }
});

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  if (activeSockets.has(number.replace(/[^0-9]/g, ''))) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getSriLankaTimestamp() });
});

router.get('/ping', (req, res) => {
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: '༺ ALONE X MD ꙰༻', activesession: activeSockets.size });
});

router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
      await EmpirePair(number, mockRes);
      results.push({ number, status: 'connection_initiated' });
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Connect all error:', error); res.status(500).send({ error: 'Failed to connect all bots' }); }
});

router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
      try { await EmpirePair(number, mockRes); results.push({ number, status: 'connection_initiated' }); } catch (err) { results.push({ number, status: 'failed', error: err.message }); }
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Reconnect error:', error); res.status(500).send({ error: 'Failed to reconnect bots' }); }
});

router.get('/update-config', async (req, res) => {
  const { number, config: configString } = req.query;
  if (!number || !configString) return res.status(400).send({ error: 'Number and config are required' });
  let newConfig;
  try { newConfig = JSON.parse(configString); } catch (error) { return res.status(400).send({ error: 'Invalid config format' }); }
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const otp = generateOTP();
  otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
  try { await sendOTP(socket, sanitizedNumber, otp); res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' }); }
  catch (error) { otpStore.delete(sanitizedNumber); res.status(500).send({ error: 'Failed to send OTP' }); }
});

router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).send({ error: 'Number and OTP are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const storedData = otpStore.get(sanitizedNumber);
  if (!storedData) return res.status(400).send({ error: 'No OTP request found for this number' });
  if (Date.now() >= storedData.expiry) { otpStore.delete(sanitizedNumber); return res.status(400).send({ error: 'OTP has expired' }); }
  if (storedData.otp !== otp) return res.status(400).send({ error: 'Invalid OTP' });
  try {
    await setUserConfigInMongo(sanitizedNumber, storedData.newConfig);
    otpStore.delete(sanitizedNumber);
    const sock = activeSockets.get(sanitizedNumber);
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});

// ==================== CLEANUP ====================

process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) { }
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch (e) { }
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

initMongo().catch(err => console.warn('Mongo init failed at startup', err));

// Auto reconnect existing sessions on startup
(async () => {
  try {
    const nums = await getAllNumbersFromMongo();
    if (nums && nums.length) {
      console.log(`Found ${nums.length} sessions to reconnect...`);
      for (const n of nums) {
        if (!activeSockets.has(n)) {
          console.log(`Reconnecting session ${n}...`);
          const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
          await EmpirePair(n, mockRes);
          await delay(2000);
        }
      }
    }
  } catch (e) { console.error('Auto reconnect error:', e); }
})();

module.exports = router;
