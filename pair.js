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
} = require('@whiskeysockets/baileys');

// ==================== CONFIG ====================
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


const BOT_NAME_FANCY = 'DARK_SHADOW_X-MD V1 🍃';

const config = (() => {
  try {
    return { ...require('./config') };
  } catch (e) {
    console.error("⚠️ SYNTAX ERROR in config.js! Using default settings. Please fix your config.js:", e.message);
    return {
      AUTO_VIEW_STATUS: 'true',
      AUTO_LIKE_STATUS: 'true',
      AUTO_RECORDING: 'false',
      AUTO_LIKE_EMOJI: ['☘️', '💗', '🫂', '🙊', '🐢', '🙃', '🧸', '😘', '🏴‍☠️', '👀', '❤️‍🔥'],
      PREFIX: '.',
      MAX_RETRIES: 3,
      GROUP_INVITE_LINK: 'https://chat.whatsapp.com/KvkRyr0Fbsq6ys6E3fugja?s',
      RCD_IMAGE_PATH: 'https://i.ibb.co/1tyJrF3C/2bf1d1aa231b.jpg',
      NEWSLETTER_JID: '120363418953677198@newsletter',
      OTP_EXPIRY: 300000,
      OWNER_NAME: 'Damith madusanka',
      OWNER_NUMBER: '94787940686',
      OWNER_EMAIL: 'damithmadusanka43@gmail.com',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET',
      CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBfRTZLNSaAROauKp3v',
      BOT_NAME: 'DARK_SHADOW_X-MD V1 🍃',
      BOT_VERSION: '1.0.0',
      IMAGE_PATH: 'https://i.ibb.co/1tyJrF3C/2bf1d1aa231b.jpg',
      BOT_FOOTER: '> *DARK_SHADOW_X-MD V1 🍃*',
      ANTI_DELETE: 'on',
      ANTI_LINK: 'off',
      ANTI_LINK_WHITELIST: [],
      ANTI_BAD_WORD: 'true',
      AUTO_BIO: 'false',
      ANTI_CALL: 'off',
      AUTO_CONTACT_SAVER: 'true',
      CONTACT_SAVER_MSG: '*Hello!* 👋\n\nYou are not in my contact list. Please reply with your *NAME* if you want me to save your contact automatically to my Google account!',
      DASHBOARD_PASSWORD: 'CHAMA-MINI-PRO10'
    };
  }
})();

// const messageCache = new Map(); // Already defined above
const reactionEmojis = config.AUTO_LIKE_EMOJI;

const CHAMA_API_KEY = "chama_14f75d2b3c735e020643738a54e8c66a"; // Unified Global API Key

const NEWS_SOURCES = {
  adaderana: { category: 'local', name: 'Ada Derana', api: `https://chama-api-hub.vercel.app/api/news/adaderana?apikey=${CHAMA_API_KEY}` },
  hirunews: { category: 'local', name: 'Hiru News', api: `https://chama-api-hub.vercel.app/api/news/hirunews?apikey=${CHAMA_API_KEY}` },
  sirasa: { category: 'local', name: 'Sirasa News', api: `https://chama-api-hub.vercel.app/api/news/sirasa?apikey=${CHAMA_API_KEY}` },
  itn: { category: 'local', name: 'ITN News', api: `https://chama-api-hub.vercel.app/api/news/itn?apikey=${CHAMA_API_KEY}` },
  lankadeepa: { category: 'local', name: 'Lankadeepa', api: `https://chama-api-hub.vercel.app/api/news/lankadeepa?apikey=${CHAMA_API_KEY}` },
  gossiplanka: { category: 'local', name: 'Gossip Lanka', api: `https://chama-api-hub.vercel.app/api/news/gossiplanka?apikey=${CHAMA_API_KEY}` },
  derana_macro: { category: 'economy', name: 'Derana Macro', api: `https://chama-api-hub.vercel.app/api/news/deranamacro?apikey=${CHAMA_API_KEY}` },
  tech_sl: { category: 'tech', name: 'Tech Sri Lanka', api: `https://chama-api-hub.vercel.app/api/news/techsl?apikey=${CHAMA_API_KEY}` },
  bbc: { category: 'global', name: 'BBC World', api: `https://chama-api-hub.vercel.app/api/news/bbc?apikey=${CHAMA_API_KEY}` },
  cnn: { category: 'global', name: 'CNN Global', api: `https://chama-api-hub.vercel.app/api/news/cnn?apikey=${CHAMA_API_KEY}` },
  aljazeera: { category: 'global', name: 'Al Jazeera', api: `https://chama-api-hub.vercel.app/api/news/aljazeera?apikey=${CHAMA_API_KEY}` },
  reuters: { category: 'global', name: 'Reuters', api: `https://chama-api-hub.vercel.app/api/news/reuters?apikey=${CHAMA_API_KEY}` },
  techcrunch: { category: 'tech', name: 'TechCrunch', api: `https://chama-api-hub.vercel.app/api/news/techcrunch?apikey=${CHAMA_API_KEY}` },
  theverge: { category: 'tech', name: 'The Verge', api: `https://chama-api-hub.vercel.app/api/news/theverge?apikey=${CHAMA_API_KEY}` }
};

// ---------------- MONGO SETUP ----------------

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://veovideo000_db_user:chamachannelbot@channelbot.didvilx.mongodb.net/';
const MONGO_DB = process.env.MONGO_DB || 'CHAMA-CHANNEL';

let mongoClient, mongoDB, mongoConnPromise = null;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol, newsletterBlacklistCol, newsletterReactsLogCol, autorepliesCol, groupSettingsCol, statusRepliesCol, scheduledTasksCol, logsCol, notesCol, filtersCol, dashboardSessionsCol, metricsCol;

// Track reconnect timers per number to avoid duplicate reconnect loops
// const reconnectTimers = new Map(); // Already defined above
// Track how many times a number has tried to reconnect
// const reconnectCounts = new Map(); // Already defined above
const MAX_RECONNECT_ATTEMPTS = 0; // 0 = unlimited retries

async function initMongo() {
  if (mongoDB && configsCol) return;
  if (mongoConnPromise) return mongoConnPromise;

  mongoConnPromise = (async () => {
    if (!mongoClient) {
      mongoClient = new MongoClient(MONGO_URI, {
        maxPoolSize: 50,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 30000,   // increased: Atlas can take time to wake up
        socketTimeoutMS: 60000,
        connectTimeoutMS: 30000,           // increased
        maxIdleTimeMS: 120000,
        waitQueueTimeoutMS: 30000,
        retryWrites: true,
        retryReads: true,
      });
    }

    try {
      if (mongoClient) {
        await mongoClient.db("admin").command({ ping: 1 });
      } else {
        throw new Error('No client');
      }
    } catch (e) {
      //       console.log('🔄 MongoDB connection lost. Reconnecting...');
      try { await mongoClient.close(); } catch (err) { }
      mongoClient = new MongoClient(MONGO_URI, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 30000,   // increased
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,           // increased
        retryWrites: true,
        retryReads: true,
      });
      // Prevent crash if client emits error before we can catch it in a call
      mongoClient.on('error', (err) => {
        console.error('⚠️ Mongo Client Error:', err.message);
        mongoDB = null;
        configsCol = null;
        mongoClient = null;
      });
      mongoClient.on('close', () => {
        console.warn('⚠️ Mongo Client Closed.');
        mongoDB = null;
        configsCol = null;
        mongoClient = null;
      });
      mongoClient.on('timeout', () => {
        console.warn('⚠️ Mongo Client Timeout.');
        mongoDB = null;
        configsCol = null;
        mongoClient = null;
      });
      await mongoClient.connect();
    }

    mongoDB = mongoClient.db(MONGO_DB);

    sessionsCol = mongoDB.collection('sessions');
    numbersCol = mongoDB.collection('numbers');
    adminsCol = mongoDB.collection('admins');
    newsletterCol = mongoDB.collection('newsletter_list');
    configsCol = mongoDB.collection('configs');
    newsletterReactsCol = mongoDB.collection('newsletter_reacts');
    newsletterReactsLogCol = mongoDB.collection('newsletter_reacts_log');
    autorepliesCol = mongoDB.collection('autoreplies');
    groupSettingsCol = mongoDB.collection('group_settings');
    statusRepliesCol = mongoDB.collection('status_replies');
    scheduledTasksCol = mongoDB.collection('scheduled_tasks');
    logsCol = mongoDB.collection('bot_logs');
    notesCol = mongoDB.collection('notes');
    filtersCol = mongoDB.collection('filters');
    dashboardSessionsCol = mongoDB.collection('dashboard_sessions');
    newsletterBlacklistCol = mongoDB.collection('newsletter_blacklist');
    metricsCol = mongoDB.collection('message_analytics');

    try {
      // Helper for resilient index creation
      const safeIndex = async (col, spec, options = {}) => {
        try {
          await col.createIndex(spec, options);
        } catch (e) {
          console.warn(`⚠️ [INDEX] Non-critical failure for ${col.collectionName}:`, e.message);
        }
      };

      await safeIndex(sessionsCol, { number: 1 }, { unique: true });
      await safeIndex(numbersCol, { number: 1 }, { unique: true });
      await safeIndex(newsletterCol, { jid: 1 }, { unique: true });
      await safeIndex(newsletterReactsCol, { jid: 1 }, { unique: true });
      await safeIndex(configsCol, { number: 1 }, { unique: true });
      await safeIndex(groupSettingsCol, { jid: 1 }, { unique: true });

      // Aggressively drop old indexes that cause duplicate key errors
      try {
        const collections = await mongoDB.listCollections({ name: 'autoreplies' }).toArray();
        if (collections.length > 0) {
          const existingIndexes = await autorepliesCol.indexes();
          for (const idx of existingIndexes) {
            if (idx.name !== "_id_" && idx.name !== "sessionNumber_1_trigger_1") {
              await autorepliesCol.dropIndex(idx.name).catch(() => { });
            }
          }
        }
      } catch (e) { }

      await safeIndex(autorepliesCol, { sessionNumber: 1, trigger: 1 }, { unique: true });
      await safeIndex(statusRepliesCol, { number: 1 });
      await safeIndex(notesCol, { groupJid: 1, key: 1 }, { unique: true });
      await safeIndex(filtersCol, { groupJid: 1, trigger: 1 }, { unique: true });
      await safeIndex(dashboardSessionsCol, { "expiry": 1 }, { expireAfterSeconds: 0 });

      await safeIndex(logsCol, { number: 1, timestamp: -1 });
      await safeIndex(newsletterReactsLogCol, { sessionNumber: 1 });
      await safeIndex(scheduledTasksCol, { sessionNumber: 1, status: 1 });
      await safeIndex(mongoDB.collection('message_analytics'), { number: 1, date: 1 }, { unique: true });
      await safeIndex(newsletterBlacklistCol, { jid: 1 }, { unique: true });

      await safeIndex(logsCol, { "timestamp": 1 }, { expireAfterSeconds: 604800 });
      await safeIndex(newsletterReactsLogCol, { "ts": 1 }, { expireAfterSeconds: 172800 });
    } catch (idxErr) {
      console.error('Fatal initialization error:', idxErr);
    }

    //     console.log('✅ Mongo initialized and collections ready');
    mongoConnPromise = null; // Reset promise so it can be re-run if needed
  })();

  return mongoConnPromise;
}

// ---------------- Logging Helper ----------------

async function logEvent(number, type, message) {
  //   console.log(`[LOG] ${getSriLankaTimestamp()} | ${number} | ${type} | ${message}`);
  try {
    await initMongo();
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    await logsCol.insertOne({
      number: sanitized,
      type,
      message,
      timestamp: new Date()
    });
    // Keep only last 500 logs per number to prevent bloat
    const count = await logsCol.countDocuments({ number: sanitized });
    if (count > 500) {
      const oldest = await logsCol.find({ number: sanitized }).sort({ timestamp: 1 }).limit(count - 500).toArray();
      const ids = oldest.map(o => o._id);
      await logsCol.deleteMany({ _id: { $in: ids } });
    }
  } catch (e) {
    if (e.message && e.message.includes('ECONNRESET')) {
      mongoDB = null;
      console.warn('⚠️ [MONGO] Connection reset (ECONNRESET). If this persists, please whitelist your IP in MongoDB Atlas!');
    }
    console.error('logEvent error:', e.message || e);
  }
}

async function verifySession(number, token) {
  if (!number || !token) return { success: false, status: 400, error: 'Missing parameters' };
  try {
    await initMongo();
    const session = await dashboardSessionsCol.findOne({ token });
    const sanitized = number.replace(/[^0-9]/g, '');
    if (!session || session.number !== sanitized) return { success: false, status: 401, error: 'Unauthorized' };
    return { success: true, session };
  } catch (e) {
    return { success: false, status: 500, error: e.message };
  }
}

async function trackActivity(number, type = 'incoming', command = null) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  try {
    await initMongo();
    const dateStr = moment().tz('Asia/Colombo').format('YYYY-MM-DD');

    // Update analytics
    await metricsCol.updateOne(
      { number: sanitizedNumber, date: dateStr },
      {
        $inc: { [type === 'incoming' ? 'incomingCount' : 'outgoingCount']: 1 },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );

    // Update session updatedAt
    await sessionsCol.updateOne(
      { number: sanitizedNumber },
      { $set: { updatedAt: new Date() } }
    );

  } catch (err) { }
}

// ---------------- Helper functions ----------------

async function addAutoReply(sessionNumber, trigger, type, response, mediaUrl = null, mimetype = null) {
  try {
    await initMongo();
    const doc = { sessionNumber, trigger: trigger.toLowerCase().trim(), type, response, mediaUrl, mimetype, updatedAt: new Date() };
    await autorepliesCol.updateOne({ sessionNumber, trigger: trigger.toLowerCase().trim() }, { $set: doc }, { upsert: true });
    autoReplyCache.delete(`${sessionNumber}:${trigger.toLowerCase().trim()}`);
  } catch (e) { console.error('addAutoReply error:', e); throw e; }
}

async function listAutoReplies(sessionNumber) {
  try {
    await initMongo();
    return await autorepliesCol.find({ sessionNumber }).toArray();
  } catch (e) { console.error('listAutoReplies error:', e); return []; }
}

async function removeAutoReplyFromMongo(sessionNumber, trigger) {
  try {
    await initMongo();
    await autorepliesCol.deleteOne({ sessionNumber, trigger: trigger.toLowerCase().trim() });
    autoReplyCache.delete(`${sessionNumber}:${trigger.toLowerCase().trim()}`);
  } catch (e) { console.error('removeAutoReplyFromMongo error:', e); }
}

async function addStatusReply(number, text) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await statusRepliesCol.insertOne({ number: sanitized, text, createdAt: new Date() });
  } catch (e) { console.error('addStatusReply error:', e); }
}

async function removeStatusReply(number, index) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const replies = await statusRepliesCol.find({ number: sanitized }).sort({ createdAt: 1 }).toArray();
    if (replies[index]) {
      await statusRepliesCol.deleteOne({ _id: replies[index]._id });
      return true;
    }
    return false;
  } catch (e) { console.error('removeStatusReply error:', e); return false; }
}

async function getStatusReplies(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const docs = await statusRepliesCol.find({ number: sanitized }).sort({ createdAt: 1 }).toArray();
    return docs.map(d => d.text);
  } catch (e) { console.error('getStatusReplies error:', e); return []; }
}

async function getAutoReply(sessionNumber, text) {
  try {
    const trigger = text.toLowerCase().trim();
    const cacheKey = `${sessionNumber}:${trigger}`;
    const cached = autoReplyCache.get(cacheKey);
    if (cached && (Date.now() - cached.time < CACHE_TTL)) return cached.data;
    await initMongo();
    const data = await autorepliesCol.findOne({ sessionNumber, trigger });
    autoReplyCache.set(cacheKey, { data, time: Date.now() });
    return data;
  } catch (e) { console.error('getAutoReply error:', e); return null; }
}

async function saveCredsToMongo(number, creds, keys = null, isConnected = false) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const updateDoc = {
      $set: { number: sanitized, creds, keys, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    };
    if (isConnected) {
      updateDoc.$set.connected = true;
      updateDoc.$set.connectedAt = new Date();
    }
    await sessionsCol.updateOne({ number: sanitized }, updateDoc, { upsert: true });
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    return await sessionsCol.findOne({ number: sanitized });
  } catch (e) {
    if (e.message && e.message.includes('ECONNRESET')) {
      console.warn('Recovering loadCredsFromMongo from ECONNRESET');
      mongoDB = null;
    }
    console.error('loadCredsFromMongo error:', e.message || e);
    return null;
  }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
  } catch (e) { console.error('removeSessionFromMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
  } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    await initMongo();
    await adminsCol.updateOne({ jid: jidOrNumber }, { $set: { jid: jidOrNumber } }, { upsert: true });
  } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    await initMongo();
    await adminsCol.deleteOne({ jid: jidOrNumber });
  } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    await initMongo();
    await newsletterReactsLogCol.insertOne({ jid, messageId, emoji, sessionNumber, ts: new Date() });

    // Prune old logs: keep only last 24 hours per session (efficient pruning)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await newsletterReactsLogCol.deleteMany({ sessionNumber, ts: { $lt: oneDayAgo } });
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function addNewsletterToMongo(jid, emojis = [], owner = null) {
  try {
    await initMongo();
    const data = { jid, emojis, updatedAt: new Date() };
    if (owner) data.owner = owner;
    await newsletterCol.updateOne({ jid }, { $set: data }, { upsert: true });
  } catch (e) { console.error('addNewsletterToMongo', e); }
}

async function addNewsletterReactToMongo(jid, emojis, owner = null) {
  try {
    await initMongo();
    const data = { jid, emojis, updatedAt: new Date() };
    if (owner) data.owner = owner;
    await newsletterReactsCol.updateOne({ jid }, { $set: data }, { upsert: true });
  } catch (e) { console.error('addNewsletterReactToMongo', e); }
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [], owner: d.owner || null }));
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function sendCSongTask(socket, jid, query, requesterNumber, sessionNumber) {
  const yts = require('yt-search');
  try {
    const sCfg = await loadUserConfigFromMongo(sessionNumber) || {};
    let sUrl = query;
    let sMetadata = null;

    if (!/^https?:\/\//i.test(query)) {
      const search = await yts(query);
      if (!search || !search.videos || search.videos.length === 0) {
        console.error('sendCSongTask: No search results found for query:', query);
        return false;
      }
      sUrl = search.videos[0].url;
      sMetadata = search.videos[0];
    }

    if (!sMetadata) {
      try {
        const search = await yts(sUrl);
        if (search) {
          sMetadata = search.all ? search.all[0] : (search.videos ? search.videos[0] : search);
        }
      } catch (e) {
        console.warn('sendCSongTask: Metadata search failed for URL:', sUrl);
      }
    }

    let sTitle = sMetadata?.title || 'Unknown Title';
    let sThumb = sMetadata?.thumbnail || sMetadata?.image;
    let sDuration = sMetadata?.timestamp || sMetadata?.duration?.toString() || 'N/A';
    let sArtist = sMetadata?.author?.name || 'Unknown Artist';
    let sViews = sMetadata?.views ? (typeof sMetadata.views === 'number' ? sMetadata.views.toLocaleString() : sMetadata.views) : 'N/A';
    let sDate = sMetadata?.ago || sMetadata?.publishDate || 'N/A';

    let sApiUrl = `https://vajira-official-apis.vercel.app/api/ytmp3?apikey=vajira-b72bv85884-1776138459299&url=${encodeURIComponent(sUrl)}`;

    let sApiResp = null;
    try {
      sApiResp = await axios.get(sApiUrl, { timeout: 60000 }).catch(() => null);
    } catch (e) { }

    let sDownloadUrl = null;
    if (sApiResp && sApiResp.data && sApiResp.data.status) {
      const dData = sApiResp.data.data;
      if (dData.downloads && dData.downloads.length > 0) {
        // Try to find 128kbps or just take the first one
        const dl = dData.downloads.find(d => d.bitrate === '128kbps') || dData.downloads[0];
        sDownloadUrl = dl.url;
      }
      if (dData.title) sTitle = dData.title;
    }

    if (!sDownloadUrl) {
      console.error('sendCSongTask: New API (Vajira) failed to return a download URL for:', sUrl);
      return false;
    }

    const sTmpId = crypto.randomBytes(8).toString('hex');
    const sTempMp3 = path.join(os.tmpdir(), `cm_${sTmpId}.mp3`);
    const sTempTag = path.join(os.tmpdir(), `tag_${sTmpId}.mp3`);
    const sTempOpus = path.join(os.tmpdir(), `cm_${sTmpId}.opus`);

    const dlResp = await axios.get(sDownloadUrl, { responseType: 'stream', timeout: 120000 }).catch((err) => {
      console.error('sendCSongTask: Download request failed:', err.message);
      return null;
    });
    if (!dlResp || !dlResp.data) return false;

    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(sTempMp3);
      dlResp.data.pipe(writer);
      let errored = false;
      dlResp.data.on('error', (err) => { errored = true; writer.destroy(); reject(err); });
      writer.on('error', (err) => { errored = true; reject(err); });
      writer.on('finish', () => { if (!errored) resolve(); });
    });

    // --- Voice Tag Logic (New) ---
    try {
      const sTagText = sCfg.voiceTag || "Powered by DARK_SHADOW_X-MD V1 🍃";
      const sTagUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(sTagText)}&tl=en&client=tw-ob`;
      const tagResp = await axios.get(sTagUrl, { responseType: 'stream' }).catch(() => null);
      if (tagResp && tagResp.data) {
        await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(sTempTag);
          tagResp.data.pipe(writer);
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
      }
    } catch (e) { console.error('Voice tag download error:', e); }

    console.log(`[CSONG] Processing audio for: ${sTitle}`);
    await new Promise((resolve, reject) => {
      let ff = ffmpeg(sTempMp3).noVideo();

      if (fs.existsSync(sTempTag)) {
        ff.input(sTempTag)
          .complexFilter([
            '[1:a]adelay=1000|1000,volume=2.0[tag]',
            '[0:a][tag]amix=inputs=2:duration=first:dropout_transition=2'
          ]);
      }

      ff.audioCodec('libopus')
        .format('opus')
        .on('end', () => {
          console.log('[CSONG] FFmpeg processing completed.');
          resolve();
        })
        .on('error', (err) => {
          console.error('[CSONG] FFmpeg error:', err.message);
          reject(err);
        })
        .save(sTempOpus);
    });

    let sChannelName = jid;
    try {
      if (typeof socket.newsletterMetadata === 'function' && jid.endsWith('@newsletter')) {
        const meta = await socket.newsletterMetadata("jid", jid);
        if (meta && (meta.name || meta.subject)) sChannelName = meta.name || meta.subject;
      } else if (jid.endsWith('@g.us')) {
        const meta = await socket.groupMetadata(jid);
        if (meta && meta.subject) sChannelName = meta.subject;
      }
    } catch (e) { }

    const sBotName = sCfg.botName || 'CHAMA MD';
    const sFooter = sCfg.csongFooter || `ලස්සන රියැක්ට් ඕනී...💗😽🍃\n\n> 𝗨𝗣𝗟𝗢𝗔𝗗 𝗕𝗬 ${sBotName.toUpperCase()} 𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗕𝗢𝗧`;
    let sCapTemplate = sCfg.csongFormat || `☘️ *TITLE :* &title
( &channel )

◽️ ⏱ *Duration :* &time

00:00 ───●────────── &time

&footer`;
    let sFinalCaption = sCapTemplate
      .replace(/&title/g, sTitle)
      .replace(/&artist/g, sArtist)
      .replace(/&time/g, sDuration)
      .replace(/&views/g, sViews)
      .replace(/&date/g, sDate)
      .replace(/&req/g, `@${requesterNumber}`)
      .replace(/&channel/g, sChannelName)
      .replace(/&footer/g, sFooter)
      .replace(/\\n/g, '\n');

    if (!sCapTemplate.includes('&footer') && !sCapTemplate.includes(sFooter)) {
      sFinalCaption += `\n\n${sFooter}`;
    }

    if (sThumb) {
      await socket.sendMessage(jid, { image: { url: sThumb }, caption: sFinalCaption, mentions: [requesterNumber + '@s.whatsapp.net'] });
    } else {
      await socket.sendMessage(jid, { text: sFinalCaption, mentions: [requesterNumber + '@s.whatsapp.net'] });
    }

    const sOpusBuffer = fs.readFileSync(sTempOpus);
    await socket.sendMessage(jid, { audio: sOpusBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });

    try { if (fs.existsSync(sTempMp3)) fs.unlinkSync(sTempMp3); } catch (e) { }
    try { if (fs.existsSync(sTempTag)) fs.unlinkSync(sTempTag); } catch (e) { }
    try { if (fs.existsSync(sTempOpus)) fs.unlinkSync(sTempOpus); } catch (e) { }

    return true;
  } catch (e) {
    console.error('sendCSongTask error:', e);
    return false;
  }
}

async function addScheduledTask(task) {
  try {
    await initMongo();
    const res = await scheduledTasksCol.insertOne({ ...task, createdAt: new Date(), status: 'pending' });
    return { _id: res.insertedId, ...task };
  } catch (e) {
    if (e.message && e.message.includes('ECONNRESET')) {
      console.warn('Recovering addScheduledTask from ECONNRESET');
      mongoDB = null;
    }
    console.error('addScheduledTask error', e);
    return null;
  }
}

async function listScheduledTasks(sessionNumber) {
  try {
    await initMongo();
    return await scheduledTasksCol.find({ sessionNumber, status: { $ne: 'deleted' } }).toArray();
  } catch (e) {
    if (e.message && e.message.includes('ECONNRESET')) {
      console.warn('Recovering listScheduledTasks from ECONNRESET');
      mongoDB = null;
    }
    console.error('listScheduledTasks error', e.message || e);
    return [];
  }
}

async function removeScheduledTask(taskId) {
  try {
    await initMongo();
    if (!taskId) return;
    const query = taskId.length === 24 ? { _id: new ObjectId(taskId) } : { _id: taskId };
    await scheduledTasksCol.deleteOne(query);
  } catch (e) { console.error('removeScheduledTask error', e); }
}

// Notes persistence
async function saveNote({ key, value, owner, groupJid }) {
  try {
    await initMongo();
    await notesCol.updateOne({ groupJid, key }, { $set: { key, value, owner, groupJid, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('saveNote error:', e); }
}
async function getNote(key, groupJid) {
  try {
    await initMongo();
    return await notesCol.findOne({ groupJid, key });
  } catch (e) { return null; }
}
async function deleteNote(key, groupJid) {
  try {
    await initMongo();
    await notesCol.deleteOne({ groupJid, key });
  } catch (e) { console.error('deleteNote error:', e); }
}
async function listNotes(groupJid) {
  try {
    await initMongo();
    return await notesCol.find({ groupJid }).toArray();
  } catch (e) { return []; }
}

// Filters persistence
async function addFilter(groupJid, trigger, type, reply) {
  try {
    await initMongo();
    await filtersCol.updateOne({ groupJid, trigger }, { $set: { groupJid, trigger, type, reply, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('addFilter error:', e); }
}
async function listFilters(groupJid) {
  try {
    await initMongo();
    return await filtersCol.find({ groupJid }).toArray();
  } catch (e) { return []; }
}
async function removeFilter(groupJid, trigger) {
  try {
    await initMongo();
    await filtersCol.deleteOne({ groupJid, trigger });
  } catch (e) { console.error('removeFilter error:', e); }
}

// Track automation tickers to prevent duplicates
if (!global.__automationTickers) global.__automationTickers = {};

async function startScheduledTaskTicker(providedSocket, sessionNumber) {
  const sanitized = sessionNumber.replace(/[^0-9]/g, '');
  const tz = getTimezone(sanitized);

  // Stop any existing ticker for this session
  if (global.__automationTickers[sanitized]) {
    clearInterval(global.__automationTickers[sanitized]);
  }

  const ticker = setInterval(async () => {
    try {
      // Always get the LATEST active socket for this session
      const socket = activeSockets.get(sanitized);
      if (!socket || !socket.user) return;

      await initMongo();
      const now = moment().tz(tz);
      const dateStr = now.format('YYYY-MM-DD');

      // Find pending tasks for this session
      const tasks = await scheduledTasksCol.find({
        sessionNumber: sanitized,
        status: 'pending'
      }).toArray();

      for (const task of tasks) {
        try {
          const taskMoment = moment(task.fullDate || `${dateStr} ${task.time}`, 'YYYY-MM-DD HH:mm').tz(tz);

          // Skip if it's in the future
          if (taskMoment.isAfter(now)) continue;

          //           console.log(`🚀 [AUTOMATION] ${sanitized} | Executing scheduled task: ${task.type} -> ${task.jid} (ID: ${task._id})`);

          let sentMsg;
          if (task.type === 'message' || task.type === 'text') {
            let msgPayload = { text: task.content };
            if (task.mediaUrl) {
              if (task.mediaType === 'image') msgPayload = { image: { url: task.mediaUrl }, caption: task.content };
              else if (task.mediaType === 'video') msgPayload = { video: { url: task.mediaUrl }, caption: task.content };
              else if (task.mediaType === 'audio') msgPayload = { audio: { url: task.mediaUrl }, mimetype: 'audio/mp4' };
              else msgPayload = { document: { url: task.mediaUrl }, mimetype: 'application/octet-stream', fileName: 'document', caption: task.content };
            }

            // Forwarding Feature Integration: Ensures the "View channel" button appears for newsletters
            if (task.forwardJid) {
              const uCfg = await loadUserConfigFromMongo(sessionNumber) || {};
              const bName = uCfg.botName || config.BOT_NAME || 'CHAMA MINI';
              msgPayload.contextInfo = {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: task.forwardJid.includes('@newsletter') ? task.forwardJid : `${task.forwardJid}@newsletter`,
                  newsletterName: task.forwardName || bName,
                  serverMessageId: parseInt(task.forwardId) || 1
                }
              };
            }

            // Using a simple retry logic for scheduled messages
            let retryCount = 0;
            const maxTaskRetries = 2;
            while (retryCount <= maxTaskRetries) {
              try {
                sentMsg = await socket.sendMessage(task.jid, msgPayload);
                break; // Success!
              } catch (sendErr) {
                retryCount++;
                if (retryCount > maxTaskRetries) throw sendErr;
                await delay(3000); // Wait 3s before retry
              }
            }
          } else if (task.type === 'poll') {
            sentMsg = await socket.sendMessage(task.jid, {
              poll: {
                name: task.content,
                values: task.options || [],
                selectableCount: 1
              }
            });
          } else if (task.type === 'csong') {
            sentMsg = await sendCSongTask(socket, task.jid, task.content, task.sender, sanitized);
          }

          if (task.deleteAfter && sentMsg) {
            const deleteTime = Date.now() + (parseInt(task.deleteAfter) * 60000);
            // CRITICAL: Newsletters need Server ID to delete. Store it preferentially.
            const msgIdForDelete = sentMsg.newsletterServerId || sentMsg.key.id;
            await scheduledTasksCol.updateOne({ _id: task._id }, {
              $set: { status: 'waiting_delete', deleteAt: deleteTime, messageId: msgIdForDelete.toString() }
            });
          } else if (task.recurring) {
            // Recurring task: Update to next day
            const nextDate = moment(taskMoment).add(1, 'day').toDate();
            await scheduledTasksCol.updateOne({ _id: task._id }, { $set: { fullDate: nextDate, lastExecutedAt: new Date() } });
          } else {
            // One-time task with no deletion: immediately remove
            await scheduledTasksCol.deleteOne({ _id: task._id });
          }
        } catch (execErr) {
          console.error(`❌ [AUTOMATION ERROR] ${sanitized} | Task ${task._id}:`, execErr.message);
          await scheduledTasksCol.updateOne({ _id: task._id }, {
            $set: { status: 'failed', error: execErr.message || 'Unknown error', lastAttempt: new Date() }
          });
        }
      }

      // Handle Auto-Deletions
      const toDelete = await scheduledTasksCol.find({
        sessionNumber: sanitized,
        status: 'waiting_delete',
        deleteAt: { $lte: Date.now() }
      }).toArray();

      for (const task of toDelete) {
        try {
          const deleteSocket = activeSockets.get(sanitized);
          if (deleteSocket && deleteSocket.sendMessage && task.messageId) {
            // Robust numeric ID handling for newsletter deletions
            const deleteId = /^[0-9]+$/.test(task.messageId) ? parseInt(task.messageId) : task.messageId;
            await deleteSocket.sendMessage(task.jid, { delete: { remoteJid: task.jid, fromMe: true, id: deleteId } });
          }
          await scheduledTasksCol.deleteOne({ _id: task._id });
        } catch (e) {
          console.error(`Scheduled task delete error (${sanitized}):`, e.message);
          // If deletion fails, mark as completed anyway so we don't keep trying (prevent spam) or just remove
          await scheduledTasksCol.deleteOne({ _id: task._id });
        }
      }

      // --- Routine Cleanup for Failed Tasks (Older than 3 days) ---
      try {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        await scheduledTasksCol.deleteMany({
          sessionNumber: sanitized,
          status: 'failed',
          lastAttempt: { $lt: threeDaysAgo }
        });
      } catch (e) { }
    } catch (tickerErr) {
      console.error(`🛑 [AUTOMATION TICKER FAIL] ${sanitized}:`, tickerErr);
    }
  }, 20000); // Ticker interval at 20s for high precision delivery/deletion

  global.__automationTickers[sanitized] = ticker;
  //   console.log(`⏰ Scheduled Task Automation active for ${sanitized}`);
}

// ---------------- (Dispatchers Unified into Master Dispatcher) ----------------


async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
    userConfigCache.delete(sanitized);
  } catch (e) {
    if (e.message && e.message.includes('ECONNRESET')) {
      mongoDB = null;
      console.warn('⚠️ [MONGO] Connection reset (ECONNRESET). Checking IP whitelist status...');
    }
    console.error('setUserConfigInMongo', e);
  }
}

// --- Group Settings Helpers ---
async function getGroupSetting(jid, key, defaultValue) {
  try {
    await initMongo();
    const doc = await groupSettingsCol.findOne({ jid });
    if (!doc || doc[key] === undefined) return defaultValue;
    return doc[key];
  } catch (e) { console.error('getGroupSetting error:', e); return defaultValue; }
}

async function setGroupSetting(jid, key, value) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, { $set: { [key]: value, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('setGroupSetting error:', e); }
}

async function getAntiLinkSetting(jid) {
  try {
    await initMongo();
    const doc = await groupSettingsCol.findOne({ jid });
    if (!doc) return { enabled: false, membersOnly: true, allowAdmins: true };
    return {
      enabled: doc.antiLinkEnabled || false,
      membersOnly: doc.antiLinkMembersOnly ?? true,
      allowAdmins: doc.antiLinkAllowAdmins ?? true
    };
  } catch (e) { return { enabled: false, membersOnly: true, allowAdmins: true }; }
}

async function setAntiLinkSetting(jid, enabled, membersOnly = true, allowAdmins = true) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, {
      $set: {
        antiLinkEnabled: enabled,
        antiLinkMembersOnly: membersOnly,
        antiLinkAllowAdmins: allowAdmins,
        updatedAt: new Date()
      }
    }, { upsert: true });
  } catch (e) { console.error('setAntiLinkSetting error:', e); }
}

async function getMediaDeleteSetting(jid) {
  try {
    await initMongo();
    const doc = await groupSettingsCol.findOne({ jid });
    if (!doc) return { enabled: false, deletePhotos: true, deleteVideos: true, deleteStickers: true };
    return {
      enabled: doc.mediaDeleteEnabled || false,
      deletePhotos: doc.deletePhotos ?? true,
      deleteVideos: doc.deleteVideos ?? true,
      deleteStickers: doc.deleteStickers ?? true
    };
  } catch (e) { return { enabled: false, deletePhotos: true, deleteVideos: true, deleteStickers: true }; }
}

async function setMediaDeleteSetting(jid, enabled, photos = true, videos = true, stickers = true) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, {
      $set: {
        mediaDeleteEnabled: enabled,
        deletePhotos: photos,
        deleteVideos: videos,
        deleteStickers: stickers,
        updatedAt: new Date()
      }
    }, { upsert: true });
  } catch (e) { console.error('setMediaDeleteSetting error:', e); }
}

async function addBlacklistWord(jid, word) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, { $addToSet: { blacklist: word.toLowerCase() }, $set: { updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('addBlacklistWord error:', e); }
}

async function removeBlacklistWord(jid, word) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, { $pull: { blacklist: word.toLowerCase() }, $set: { updatedAt: new Date() } });
  } catch (e) { console.error('removeBlacklistWord error:', e); }
}

async function clearBlacklist(jid) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, { $set: { blacklist: [], updatedAt: new Date() } });
  } catch (e) { console.error('clearBlacklist error:', e); }
}

async function isBlacklistEnabled(jid) {
  try {
    await initMongo();
    const doc = await groupSettingsCol.findOne({ jid });
    return doc ? !!doc.antiBadWordEnabled : false;
  } catch (e) { return false; }
}

async function listBlacklistWords(jid) {
  try {
    await initMongo();
    const doc = await groupSettingsCol.findOne({ jid });
    if (!doc || !doc.blacklist) return [];
    return doc.blacklist.map(w => w);
  } catch (e) { return []; }
}

async function setBlacklistEnabled(jid, enabled) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, { $set: { antiBadWordEnabled: enabled, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('setBlacklistEnabled error:', e); }
}

// Match Replies
async function addMatchReply(jid, key, replies) {
  try {
    await initMongo();
    const col = mongoDB.collection('match_replies');
    await col.updateOne({ jid, key: key.toLowerCase() }, { $set: { jid, key: key.toLowerCase(), replies, replyIndex: 0, createdAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('addMatchReply error:', e); }
}

async function getMatchReply(jid, key) {
  try {
    await initMongo();
    const col = mongoDB.collection('match_replies');
    return await col.findOne({ jid, key: key.toLowerCase() });
  } catch (e) { return null; }
}

async function listMatchReplies(jid) {
  try {
    await initMongo();
    const col = mongoDB.collection('match_replies');
    return await col.find({ jid }).toArray();
  } catch (e) { return []; }
}

async function removeMatchReply(jid, key) {
  try {
    await initMongo();
    const col = mongoDB.collection('match_replies');
    await col.deleteOne({ jid, key: key.toLowerCase() });
  } catch (e) { console.error('removeMatchReply error:', e); }
}

async function getNextMatchReply(jid, key) {
  try {
    await initMongo();
    const col = mongoDB.collection('match_replies');
    const match = await col.findOne({ jid, key: key.toLowerCase() });
    if (!match || !match.replies || match.replies.length === 0) return null;
    const index = match.replyIndex || 0;
    const reply = match.replies[index % match.replies.length];
    await col.updateOne({ _id: match._id }, { $set: { replyIndex: (index + 1) % match.replies.length } });
    return reply;
  } catch (e) { return null; }
}

async function getOnceViewSetting(jid) {
  try {
    await initMongo();
    const doc = await groupSettingsCol.findOne({ jid });
    if (!doc) return { enabled: false, deletePhotos: true, deleteVideos: true };
    return {
      enabled: doc.onceViewEnabled || false,
      deletePhotos: doc.onceViewDeletePhotos ?? true,
      deleteVideos: doc.onceViewDeleteVideos ?? true
    };
  } catch (e) { return { enabled: false, deletePhotos: true, deleteVideos: true }; }
}

async function setOnceViewSetting(jid, enabled, deletePhotos = true, deleteVideos = true) {
  try {
    await initMongo();
    await groupSettingsCol.updateOne({ jid }, {
      $set: {
        onceViewEnabled: enabled,
        onceViewDeletePhotos: deletePhotos,
        onceViewDeleteVideos: deleteVideos,
        updatedAt: new Date()
      }
    }, { upsert: true });
  } catch (e) { console.error('setOnceViewSetting error:', e); }
}

async function deleteOnceViewMedia(jid, type) {
  return { status: 'success', message: `${type} deletion enabled` };
}

async function setWelcomeImage(jid, url) {
  await setGroupSetting(jid, 'welcomeImage', url);
}

async function removeWelcomeImage(jid) {
  await setGroupSetting(jid, 'welcomeImage', null);
}

async function toggleMediaGuard({ socket, from, isAdmin, isOwner, userConfig }, key) {
  const current = await getGroupSetting(from, key, false);
  const next = !current;
  await setGroupSetting(from, key, next);
  const status = next ? 'ENABLED 🛡️' : 'DISABLED 🔓';
  const label = key.replace('anti', '').toUpperCase();
  await socket.sendMessage(from, { text: formatMessage(`🛡️ ANTI-${label}`, `Anti-${label} guard is now ${status}.`, userConfig.botName) });
}


async function loadUserConfigFromMongo(number, force = false) {
  const sanitized = number.replace(/[^0-9]/g, '');
  const now = Date.now();

  const normalize = (c) => {
    let res = { ...c };
    ['AUTO_VIEW_STATUS', 'AUTO_LIKE_STATUS', 'AUTO_RECORDING', 'AUTO_CONTACT_SAVER', 'AUTO_BIO', 'AUTO_WELCOME', 'AUTO_LEFT'].forEach(k => {
      if (res[k] === 'true') res[k] = true;
      if (res[k] === 'false') res[k] = false;
    });
    // Ensure VOICE_TAG is consistently available as voiceTag
    if (res.VOICE_TAG && !res.voiceTag) res.voiceTag = res.VOICE_TAG;
    if (res.voicetag && !res.voiceTag) res.voiceTag = res.voicetag;
    return res;
  };

  if (!force && userConfigCache.has(sanitized)) {
    const entry = userConfigCache.get(sanitized);
    if (now - entry.ts < CACHE_TTL) {
      const merged = { ...config, ...entry.cfg };
      if (!entry.cfg.DASHBOARD_PASSWORD && !entry.cfg.password) delete merged.DASHBOARD_PASSWORD;
      return normalize(merged);
    }
  }
  try {
    await initMongo();
    const doc = await configsCol.findOne({ number: sanitized });
    const cfg = doc ? doc.config : {};
    userConfigCache.set(sanitized, { cfg, ts: now });
    const merged = { ...config, ...cfg };
    if (!cfg.DASHBOARD_PASSWORD && !cfg.password) delete merged.DASHBOARD_PASSWORD;
    return normalize(merged);
  } catch (e) {
    const merged = { ...config };
    delete merged.DASHBOARD_PASSWORD;
    return normalize(merged);
  }
}


function formatMessage(title, content, footer) {
  return `${title}\n\n${content}\n\n> *${footer}*`;
}

// Auto-connect sessions on startup — batched for large-scale (10k+ bots)
initMongo().then(async () => {
  try {
    const numbers = await getAllNumbersFromMongo();
    const BATCH_SIZE = 5;      // Reduced from 10 to 5 to avoid overwhelming local network/CPU
    const BATCH_DELAY = 10000;  // 10s between batches
    const BOT_DELAY = 3000;    // 3s between bots in a batch

    //     console.log(`🚀 [STARTUP] Auto-connecting ${numbers.length} bots in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
      const batch = numbers.slice(i, i + BATCH_SIZE);
      for (const number of batch) {
        const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
        EmpirePair(number, mockRes).catch(err => console.error(`❌ Failed session: ${number}`, err.message));
        await delay(BOT_DELAY);
      }
      if (i + BATCH_SIZE < numbers.length) {
        await delay(BATCH_DELAY);
      }
    }
    //     console.log(`✅ [STARTUP] All ${numbers.length} bot(s) connection initiated.`);
  } catch (e) { console.error('Startup auto-connect error:', e); }
}).catch(err => console.error("Initial Mongo connection failed:", err));

async function resolveJidFromInput(socket, input) {
  if (!input) return null;
  const target = input.trim().split(' ')[0];
  let jid = target;
  let serverId = null;

  if (target.includes('whatsapp.com/channel/')) {
    const parts = target.split('channel/')[1].split('/');
    const inviteCode = parts[0].split('?')[0];
    if (parts[1]) serverId = parts[1].split('?')[0];

    try {
      const meta = await socket.newsletterMetadata("invite", inviteCode);
      if (meta && meta.id) jid = meta.id;
    } catch (e) {
      console.error('Failed to resolve channel link:', e.message);
    }
  }

  if (!jid.includes('@newsletter') && (/^\d+$/.test(jid) || jid.includes('-'))) {
    jid = `${jid}@newsletter`;
  }

  if (serverId) return { jid, serverId };
  return jid;
}

// ---------------- Mongo/Firebase Helpers ----------------

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
  // Disabled — admin connect messages are turned off
  return;
}



async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`*OTP Verification — ${BOT_NAME_FANCY}*`, `*Your OTP For Configure UpToDate Is:* *${otp}*\nThis OTP Will Expire In 5 Minutes.\n\n*Number:* ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- handlers (newsletter + reactions) ----------------

const newsletterRRPointers = new Map();

// --- Master Dispatcher (Consolidated for Memory Efficiency) ---

async function startMasterDispatcher() {
  if (global.__masterDispatcherInterval) return;

  //   console.log("🚀 [MASTER DISPATCHER] Centralized automation ticker initialized.");

  global.__masterDispatcherInterval = setInterval(async () => {
    try {
      const activeNumbers = Array.from(activeSockets.keys());
      if (activeNumbers.length === 0) return;

      const now = Date.now();

      for (const num of activeNumbers) {
        const socket = activeSockets.get(num);
        if (!socket || !socket.user) continue;

        try {
          // Load config (cached for 30s)
          const cfg = await loadUserConfigFromMongo(num, false) || {};

          // 1. News Dispatcher
          const newsSubs = cfg.newsSubscriptions || [];
          if (newsSubs.length > 0) {
            const fetchBatch = newsSubs.filter(s => !s.nextRun || s.nextRun <= now);
            if (fetchBatch.length > 0) {
              let newsDirty = false;
              const sourceDone = new Set();

              for (const sub of fetchBatch) {
                if (sourceDone.has(sub.source)) continue;
                sourceDone.add(sub.source);

                const src = NEWS_SOURCES[sub.source];
                if (!src) continue;

                const { data } = await axios.get(src.api).catch(() => ({ data: {} }));
                if (data.status && data.result) {
                  const items = Array.isArray(data.result) ? data.result : [data.result];
                  const targets = newsSubs.filter(s => s.source === sub.source && (!s.nextRun || s.nextRun <= now));

                  for (const item of items) {
                    const uid = item.url || item.id || `${item.title}`;
                    for (const ts of targets) {
                      const isSent = (cfg.sentNews || []).some(e => e.jid === ts.jid && e.id === uid);
                      if (isSent) continue;

                      const cap = `📰 *NEWS: ${src.name.toUpperCase()}*\n\n*${item.title}*\n\n${item.desc || item.description || ''}\n\n🔗 ${item.url || ''}\n\n> *© ${cfg.botName || BOT_NAME_FANCY}*`;
                      const sent = item.image ? await socket.sendMessage(ts.jid, { image: { url: item.image }, caption: cap }).catch(() => null) : await socket.sendMessage(ts.jid, { text: cap }).catch(() => null);

                      if (sent) {
                        cfg.sentNews = cfg.sentNews || [];
                        cfg.sentNews.push({ jid: ts.jid, id: uid, ts: now });
                        if (cfg.sentNews.length > 100) cfg.sentNews = cfg.sentNews.slice(-50);
                        newsDirty = true;
                      }
                    }
                  }
                }
                newsSubs.forEach(s => { if (s.source === sub.source) s.nextRun = now + (cfg.newsInterval || 15) * 60000; });
                newsDirty = true;
              }
              if (newsDirty) await setUserConfigInMongo(num, cfg);
            }
          }

          // 2. Wallpaper Dispatcher
          const wallSubs = cfg.wallpaperSubscriptions || cfg.wallSubscriptions || [];
          if (wallSubs.length > 0) {
            const runBatch = wallSubs.filter(s => !s.nextRun || s.nextRun <= now);
            if (runBatch.length > 0) {
              let wallDirty = false;
              for (const sub of runBatch) {
                const query = sub.category || sub.pack || 'nature';
                const wallUrl = `https://chama-api-hub.vercel.app/api/search/wallpaper?apikey=${CHAMA_API_KEY}&q=${encodeURIComponent(query)}`;
                const { data } = await axios.get(wallUrl).catch(() => ({ data: {} }));

                if (data.status && data.result?.length > 0) {
                  const wall = data.result[Math.floor(Math.random() * data.result.length)];
                  if (wall?.image) {
                    const cap = `*🖼️ DAILY WALLPAPER [${query.toUpperCase()}]*\n\n> *© ${cfg.botName || BOT_NAME_FANCY}*`;
                    if (await socket.sendMessage(sub.jid || sub.chatId, { image: { url: wall.image }, caption: cap }).catch(() => null)) {
                      sub.nextRun = now + (cfg.wallInterval || 60) * 60000;
                      wallDirty = true;
                    }
                  }
                }
              }
              if (wallDirty) await setUserConfigInMongo(num, cfg);
            }
          }

          // 3. Status Dispatcher
          const st = cfg.statusAutomation;
          if (st?.enabled && st.keywords.length && st.channels.length && (!st.nextRun || now >= st.nextRun)) {
            const kw = st.keywords[Math.floor(Math.random() * st.keywords.length)];
            const chan = st.channels[Math.floor(Math.random() * st.channels.length)];
            const { data } = await axios.post("https://tikwm.com/api/feed/search", new URLSearchParams({ keywords: kw, count: '5' }), { headers: { 'User-Agent': "Mozilla/5.0" } }).catch(() => ({ data: {} }));
            const v = data?.data?.videos?.[0];
            if (v?.play) {
              const cap = `☘️ *STATUS DISPATCH* [${kw.toUpperCase()}]\n\n` + (cfg.statusFooter || `> *© ${cfg.botName || BOT_NAME_FANCY}*`);
              if (await socket.sendMessage(chan, { video: { url: v.play }, caption: cap }).catch(() => null)) {
                st.nextRun = now + (st.intervalMinutes || 30) * 60000;
                await setUserConfigInMongo(num, cfg);
              }
            }
          }

          // 4. Auto Bio Dispatcher
          const bioSettings = cfg.autoBioSettings;
          if (bioSettings?.enabled && bioSettings.messages.length > 0) {
            const interval = (bioSettings.interval || 12) * 60000;
            const lastRun = bioSettings.lastRun || 0;
            if (now - lastRun >= interval) {
              const randomBio = bioSettings.messages[Math.floor(Math.random() * bioSettings.messages.length)];
              let formattedBio = randomBio
                .replace(/&time/g, getSriLankaTimestamp())
                .replace(/&runtime/g, runtime((now - serverStartTime) / 1000))
                .replace(/&version/g, 'V5')
                .replace(/&owner/g, cfg.botName || BOT_NAME_FANCY);

              await socket.updateProfileStatus(formattedBio).catch(() => { });

              bioSettings.lastRun = now;
              await setUserConfigInMongo(num, cfg);
              // console.log(`[MASTER] Auto Bio updated for ${num}`);
            }
          }

        } catch (e) { }
        await delay(3000); // 3-second gap between bots to prevent CPU spikes
      }
    } catch (e) {
      console.error("[MASTER] Global error:", e.message);
    }
  }, 60000); // Trigger every 1 minute
}

async function startStealthReactWorker(socket) {
  const sanitizedNum = (String(socket?.user?.id || '').split(':')[0] || '').replace(/[^0-9]/g, '');
  if (!sanitizedNum) return;
  if (!global.__nreactWorkers) global.__nreactWorkers = {};
  if (global.__nreactWorkers[sanitizedNum]) return;

  global.__nreactWorkers[sanitizedNum] = setInterval(async () => {
    try {
      await initMongo();
      const allChannels = await newsletterReactsCol.find({}).toArray();
      if (!allChannels || allChannels.length === 0) return;

      const activeNumbers = Array.from(activeSockets.keys());
      if (activeNumbers.length === 0) return;

      // Ensure only the first truly active socket runs the worker
      const primaryNum = activeNumbers[0];
      if (primaryNum !== sanitizedNum) return;

      for (const ch of allChannels) {
        try {
          if (!ch.jid) continue;

          // Stealth Mode: Fetch latest message without needing to follow
          const fetch = await socket.newsletterFetchMessages('direct', ch.jid, 2).catch(() => null);

          if (fetch && fetch.length > 0) {
            // Find the latest message that hasn't been reacted to
            for (const msg of fetch) {
              const serverId = msg.id;
              if (ch.lastReactedId === String(serverId)) continue;

              const emojis = Array.isArray(ch.emojis) ? ch.emojis : ['❤️', '👍', '🔥'];
              const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

              let success = false;
              if (typeof socket.newsletterReactMessage === 'function') {
                success = await socket.newsletterReactMessage(ch.jid, serverId.toString(), randomEmoji).then(() => true).catch(() => false);
              }

              if (success) {
                await newsletterReactsCol.updateOne(
                  { jid: ch.jid },
                  { $set: { lastReactedId: String(serverId), lastReactedAt: new Date() } }
                );
                await logEvent(sanitizedNum, 'AUTO_REACT', `✅ Background react to ${ch.jid} with ${randomEmoji}`);
                // Only react to one new message per channel per cycle to avoid detection
                break;
              }
            }
          }
        } catch (err) { }
        await delay(4000);
      }
    } catch (error) {
      console.error("Worker Interval Error:", error.message);
    }
  }, 45000); // 45s interval is safer
}

async function startDailyUnfollowGuard(socket) {
  const sanitizedNum = (String(socket?.user?.id || '').split(':')[0] || '').replace(/[^0-9]/g, '');
  if (!sanitizedNum) return;
  if (!global.__unfollowGuards) global.__unfollowGuards = {};
  if (global.__unfollowGuards[sanitizedNum]) return;

  // Run every 24h
  global.__unfollowGuards[sanitizedNum] = setInterval(async () => {
    try {
      await initMongo();
      const blockedChannels = await newsletterBlacklistCol.find({}).toArray();
      const blockedJids = blockedChannels.map(c => c.jid);

      if (blockedJids.length > 0) {
        for (const jid of blockedJids) {
          try {
            if (typeof socket.newsletterUnfollow === 'function') {
              await socket.newsletterUnfollow(jid).catch(() => { });
            }
          } catch (e) { }
          await delay(2000);
        }
      }
    } catch (error) {
      console.error("Daily Unfollow Guard Error:", error.message);
    }
  }, 86400000);
}

// Helper to replace placeholders in Bio/Status
function processPlaceholders(text, botName, startTime) {
  return text
    .replace(/&time/g, getSriLankaTimestamp())
    .replace(/&runtime/g, runtime((Date.now() - startTime) / 1000))
    .replace(/&version/g, 'V5')
    .replace(/&owner/g, botName || 'CHAMA MD');
}

// --- Newsletter Reaction Config Cache ---
const newsletterConfigCache = new Map();
const CACHE_LIFETIME = 5 * 60 * 1000; // 5 minutes

async function getNewsletterEmojis(jid) {
  const now = Date.now();
  if (newsletterConfigCache.has(jid)) {
    const entry = newsletterConfigCache.get(jid);
    if (now - entry.ts < CACHE_LIFETIME) return entry.emojis;
  }

  try {
    // Check specific reaction configs first
    const reactConfigs = await listNewsletterReactsFromMongo();
    const specific = reactConfigs.find(r => r.jid === jid);
    if (specific && specific.emojis && specific.emojis.length > 0) {
      newsletterConfigCache.set(jid, { emojis: specific.emojis, ts: now });
      return specific.emojis;
    }

    // Fallback to followed channel configs
    const followedDocs = await listNewslettersFromMongo();
    const doc = followedDocs.find(d => d.jid === jid);
    if (doc && doc.emojis && doc.emojis.length > 0) {
      newsletterConfigCache.set(jid, { emojis: doc.emojis, ts: now });
      return doc.emojis;
    }

    // Default Fallback: If the channel is being monitored but no emojis are set, use defaults
    const isMonitored = reactConfigs.some(r => r.jid === jid) || followedDocs.some(d => d.jid === jid);
    if (isMonitored) {
      const defaultEmojis = config.AUTO_LIKE_EMOJI || ['❤️', '👍', '🔥', '🥰', '✨'];
      newsletterConfigCache.set(jid, { emojis: defaultEmojis, ts: now });
      return defaultEmojis;
    }

    return null;
  } catch (e) {
    return null;
  }
}

async function handleNewsletter(socket, sessionNumber, messages) {
  const message = messages[0];
  if (!message?.key) return;
  const jid = message.key.remoteJid;
  if (!jid || !jid.endsWith('@newsletter')) return;

  try {
    // --- 🚀 NEW: Automated Channel Monitor/Mirror Logic ---
    const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
    const monitors = userConfig.monitors || [];

    const mType = Object.keys(message.message || {}).find(k => k.endsWith('Message') || k === 'conversation');

    if (mType) {
      const activeMonitors = monitors.filter(m => m.source === jid || m.source === jid.split('@')[0]);
      for (const monitor of activeMonitors) {
        try {
          let caption = (message.message[mType]?.caption || message.message.conversation || message.message.extendedTextMessage?.text || '') + (monitor.caption ? '\n\n' + monitor.caption : '');

          let payload = {};

          // 🖼️ Auto Watermark (Images)
          if (mType === 'imageMessage' && monitor.autoWatermark && monitor.watermarkText) {
            try {
              const stream = await downloadContentFromMessage(message.message.imageMessage, 'image');
              let buffer = Buffer.alloc(0);
              for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

              const img = await Jimp.read(buffer);
              const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
              const tw = Jimp.measureText(font, monitor.watermarkText);
              img.print(font, img.bitmap.width - tw - 20, img.bitmap.height - 50, monitor.watermarkText);
              payload = { image: await img.getBufferAsync(Jimp.MIME_JPEG), caption };
            } catch (wmErr) { console.error('Auto WM Fail:', wmErr.message); }
          }

          // 🎥 Video to Audio (Automated conversion)
          if (mType === 'videoMessage' && monitor.autoAudio) {
            try {
              const vStream = await downloadContentFromMessage(message.message.videoMessage, 'video');
              let vBuf = Buffer.alloc(0);
              for await (const vC of vStream) vBuf = Buffer.concat([vBuf, vC]);

              const tmpV = path.join(__dirname, `tmp_${Date.now()}.mp4`);
              const tmpA = path.join(__dirname, `tmp_${Date.now()}.mp3`);
              fs.writeFileSync(tmpV, vBuf);

              ffmpeg(tmpV)
                .toFormat('mp3')
                .on('end', async () => {
                  await socket.sendMessage(monitor.target, { audio: fs.readFileSync(tmpA), mimetype: 'audio/mpeg', fileName: 'audio.mp3' });
                  if (fs.existsSync(tmpV)) fs.unlinkSync(tmpV);
                  if (fs.existsSync(tmpA)) fs.unlinkSync(tmpA);
                })
                .on('error', () => { if (fs.existsSync(tmpV)) fs.unlinkSync(tmpV); })
                .save(tmpA);
            } catch (aErr) { console.error('Auto Audio Fail:', aErr.message); }
          }

          // 📡 Forwarding
          if (Object.keys(payload).length > 0) {
            await socket.sendMessage(monitor.target, payload);
          } else {
            // Forward everything else (text, documents, video-as-video, etc)
            await socket.sendMessage(monitor.target, { forward: message, contextInfo: { forwardingScore: 1, isForwarded: true } });
            // Note: If you want to change caption on forward, you'd need more logic. 
            // Standard Baileys forward doesn't easily allow caption change without re-generating.
          }
        } catch (mErr) { console.error('Monitor loop fail:', mErr.message); }
      }
    }

    // --- 📥 Existing Reaction Logic ---
    const emojis = await getNewsletterEmojis(jid);
    if (!emojis || emojis.length === 0) return; // Not a monitored channel for reactions

    let idx = newsletterRRPointers.get(jid) || 0;
    const emoji = emojis[idx % emojis.length];
    newsletterRRPointers.set(jid, (idx + 1) % emojis.length);

    const messageId = message.newsletterServerId || message.key.id;
    if (!messageId) return;

    // Random delay (1.5 - 4 seconds) to avoid spam detection
    await delay(Math.floor(Math.random() * 2500) + 1500);

    let retries = 2;
    while (retries-- > 0) {
      try {
        if (typeof socket.newsletterReactMessage === 'function') {
          await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
        } else {
          await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
        }
        await logEvent(sessionNumber, 'AUTO_REACT', `✅ Reacted to ${jid} with ${emoji}`);
        saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
        trackActivity(sessionNumber, 'outgoing');
        break;
      } catch (err) {
        if (retries > 0) await delay(2000);
      }
    }
  } catch (error) {
    console.error('Newsletter handler error:', error.message);
  }
}


// ---------------- status + revocation + resizing ----------------

async function handleStatus(socket, sessionNumber, messages) {
  const message = messages[0];
  if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
  if (message.key.fromMe) return; // Skip own status updates

  try {
    let userEmojis = config.AUTO_LIKE_EMOJI;
    let autoViewStatus = config.AUTO_VIEW_STATUS;
    let autoLikeStatus = config.AUTO_LIKE_STATUS;
    let autoRecording = config.AUTO_RECORDING;

    if (sessionNumber) {
      const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
      if (userConfig.AUTO_LIKE_EMOJI && Array.isArray(userConfig.AUTO_LIKE_EMOJI) && userConfig.AUTO_LIKE_EMOJI.length > 0) userEmojis = userConfig.AUTO_LIKE_EMOJI;
      if (userConfig.AUTO_VIEW_STATUS !== undefined) autoViewStatus = userConfig.AUTO_VIEW_STATUS;
      if (userConfig.AUTO_LIKE_STATUS !== undefined) autoLikeStatus = userConfig.AUTO_LIKE_STATUS;
      if (userConfig.AUTO_RECORDING !== undefined) autoRecording = userConfig.AUTO_RECORDING;
    }

    // Status viewing
    if (autoViewStatus === 'true') {
      await delay(Math.floor(Math.random() * 3000) + 2000);
      try {
        await socket.readMessages([message.key]);
      } catch (e) {
        // Silent fail for views, often happens if status is already dead
      }
    }

    // Status liking (reaction)
    if (autoLikeStatus === 'true') {
      await delay(Math.floor(Math.random() * 2000) + 1000);
      const randomEmoji = userEmojis[Math.floor(Math.random() * userEmojis.length)];
      try {
        await socket.sendMessage(message.key.remoteJid, {
          react: { text: randomEmoji, key: message.key }
        }, {
          statusJidList: [message.key.participant]
        });
      } catch (e) {
        // Log only if it's not a standard 'dead status' error
        if (!e.message?.includes('not-acceptable') && !e.message?.includes('item-not-found')) {
          console.error(`Status Like Error [${message.key.participant}]:`, e.message);
        }
      }
    }

    // Auto reply to status
    const autoStatusReply = sessionNumber ? (await loadUserConfigFromMongo(sessionNumber))?.AUTO_STATUS_REPLY : 'false';
    if (autoStatusReply === 'true') {
      const replies = await getStatusReplies(sessionNumber);
      if (replies.length > 0) {
        const randomReply = replies[Math.floor(Math.random() * replies.length)];
        await delay(Math.floor(Math.random() * 5000) + 3000);
        try {
          await socket.sendMessage(message.key.participant, { text: randomReply }, { quoted: message });
        } catch (e) { }
      }
    }
  } catch (error) {
    // Only log significant errors
    if (!error.message?.includes('not-acceptable')) {
      console.error('Status handler global error:', error.message);
    }
  }
}


// --- Google Callback Route ---
router.get('/api/google-callback', async (req, res) => {
  const { code, state: sessionNumber } = req.query;
  if (!code) return res.status(400).send('No code provided.');

  try {
    const redirect_uri = req.protocol + '://' + req.get('host') + '/code/api/google-callback';
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirect_uri,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token } = response.data;
    const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');

    // Save tokens to mongo
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    userConfig.GOOGLE_CONTACTS_TOKEN = access_token;
    if (refresh_token) userConfig.GOOGLE_CONTACTS_REFRESH_TOKEN = refresh_token;

    await setUserConfigInMongo(sanitized, userConfig);

    res.send('<h1>Authentication Successful!</h1><p>You can close this window and return to WhatsApp.</p>');
  } catch (error) {
    console.error('Google Auth Error:', error.response?.data || error.message);
    res.status(500).send('Authentication Failed. Check logs.');
  }
});

router.get('/api/get-google-auth-url', async (req, res) => {
  const { number } = req.query;
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  if (!sanitized) return res.status(400).send({ success: false, error: 'Number required' });

  try {
    const authUrl = generateGoogleAuthUrl(sanitized);
    res.send({ success: true, authUrl });
  } catch (e) {
    res.status(500).send({ success: false, error: e.message });
  }
});

router.post('/api/test-google-contact', async (req, res) => {
  const { number } = req.body;
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  if (!sanitized) return res.status(400).send({ success: false, error: 'Number required' });

  try {
    await createGoogleContact(sanitized, 'Chama Mini Test', '+94701234567');
    res.send({ success: true, message: 'Test contact saved successfully!' });
  } catch (e) {
    res.status(500).send({ success: false, error: e.response?.data?.error?.message || e.message });
  }
});

// --- Message Revocation Handler ---
async function handleMessageRevocation(socket, number) {
  // Capture deletions via update event (newer versions)
  socket.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.update?.protocolMessage?.type === 0) { // type 0 is REVOKE (deletion)
        const deletedId = update.update.protocolMessage.key.id;
        const cachedMsg = messageCache.get(deletedId);
        if (cachedMsg) {
          const sanitized = (number || '').replace(/[^0-9]/g, '');
          const userConfig = await loadUserConfigFromMongo(sanitized) || {};
          const antiDelete = userConfig.ANTI_DELETE || config.ANTI_DELETE || 'off';
          if (antiDelete === 'off') continue;

          const from = update.key.remoteJid;
          const userJid = jidNormalizedUser(socket.user.id);
          const targetJid = userJid; // Force send to bot number only
          const sender = (cachedMsg.key.participant || cachedMsg.key.remoteJid || '');

          // --- LOG DELETION TO DB ---
          try {
            const mType = Object.keys(cachedMsg.message || {})[0];
            const content = (mType === 'conversation') ? cachedMsg.message.conversation : (cachedMsg.message[mType]?.text || cachedMsg.message[mType]?.caption || `[${mType}]`);
            await mongoDB.collection('anti_delete_logs').insertOne({
              number: sanitized,
              from,
              sender,
              content,
              type: mType,
              timestamp: new Date()
            });
          } catch (e) { }

          await socket.sendMessage(targetJid, {
            text: `*━━━━━━━━━━━━━━━◆◉◉➤*\n*🗑️ ANTI-DELETE DETECTED*\n*━━━━━━━━━━━━━━━◆◉◉➤*\n\n*👤 From:* @${sender.split('@')[0]}\n*⏰ Time:* ${getSriLankaTimestamp()}\n\n*👇 Original Message Below:*`,
            mentions: [sender]
          });
          await socket.sendMessage(targetJid, { forward: cachedMsg });
        }
      }
    }
  });

  socket.ev.on('messages.delete', async ({ keys }) => {
    try {
      if (!keys || keys.length === 0) return;
      const messageKey = keys[0];

      // Check if anti-delete is enabled for this session
      const sanitized = (number || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      const antiDelete = userConfig.ANTI_DELETE || config.ANTI_DELETE || 'off';

      if (antiDelete === 'off') return;

      const userJid = jidNormalizedUser(socket.user.id);
      const cachedMsg = messageCache.get(messageKey.id);

      if (cachedMsg) {
        const deletionTime = getSriLankaTimestamp();
        const from = messageKey.remoteJid;
        const sender = (cachedMsg.key.participant || cachedMsg.key.remoteJid || '');

        // Determine where to send the notification (Forcing bot number only as requested)
        const targetJid = userJid;

        // --- LOG DELETION TO DB ---
        try {
          const mType = Object.keys(cachedMsg.message || {})[0];
          const content = (mType === 'conversation') ? cachedMsg.message.conversation : (cachedMsg.message[mType]?.text || cachedMsg.message[mType]?.caption || `[${mType}]`);
          await mongoDB.collection('anti_delete_logs').insertOne({
            number: sanitized,
            from,
            sender,
            content,
            type: mType,
            timestamp: new Date()
          });
        } catch (e) { }

        const botName = userConfig.botName || BOT_NAME_FANCY;
        const notification = `*━━━━━━━━━━━━━━━◆◉◉➤*\n` +
          `*🗑️ ANTI-DELETE DETECTED*\n` +
          `*━━━━━━━━━━━━━━━◆◉◉➤*\n\n` +
          `*👤 From:* @${sender.split('@')[0]}\n` +
          `*📍 Chat:* ${from.endsWith('@g.us') ? 'Group' : 'Private Chat'}\n` +
          `*⏰ Time:* ${deletionTime}\n\n` +
          `*👇 Original Message Below:*`;

        await socket.sendMessage(targetJid, {
          text: notification,
          mentions: [sender]
        });

        // Forward the original message content
        if (socket.copyNForward) {
          await socket.copyNForward(targetJid, cachedMsg, false);
        } else {
          // Manual forward logic
          await socket.sendMessage(targetJid, { forward: cachedMsg });
        }
      }
    } catch (error) {
      console.error('Antidelete handler error:', error);
    }
  });
}

async function resize(image, width, height) {
  let oyy = await Jimp.read(image);
  return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}


// ---------------- command handlers ----------------

// Helper for Premium V5 UI
function formatMessage(title, content, botName = BOT_NAME_FANCY) {
  return `*━━━━━━━━━━━━━━━◆◉◉➤*\n${title}\n*━━━━━━━━━━━━━━━◆◉◉➤*\n\n${content}\n\n> *© ${botName}*`;
}

// handleAutoContactSaver removed from here; consolidated at the bottom of the file

async function handleCommands(socket, number, messages) {
  const msg = messages[0];
  if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast') return;

  // 🛡️ Message Deduplication: Prevent double processing of the same message ID
  const msgId = msg.key.id;
  // Deduplication check
  if (messageIdCache.has(msgId)) return;
  messageIdCache.set(msgId, true);

  // Track Activity for 2-hour cleanup
  await trackActivity(number, 'incoming');

  // LID handling: prefer remoteJidAlt (phone-number JID) over remoteJid when @lid is used
  const rawRemoteJid = msg.key.remoteJid || '';
  const effectiveRemoteJid = (rawRemoteJid.endsWith('@lid') && msg.key.remoteJidAlt)
    ? msg.key.remoteJidAlt
    : rawRemoteJid;

  // Base JIDs (may still be @lid if Alt is missing)
  let from = jidNormalizedUser(effectiveRemoteJid);
  const isGroup = from.endsWith('@g.us');
  const rawParticipant = msg.key.participant || '';
  const effectiveParticipant = (rawParticipant.endsWith('@lid') && msg.key.participantAlt)
    ? msg.key.participantAlt
    : rawParticipant;
  const actualSender = isGroup ? (effectiveParticipant || from) : from;
  let sender = jidNormalizedUser(actualSender);
  let logBody = '';
  const mType = Object.keys(msg.message || {})[0];
  const mObj = msg.message?.[mType];

  // Data parsing moved early to allow interaction check for fromMe messages
  let m = msg.message;
  if (m?.ephemeralMessage?.message) m = m.ephemeralMessage.message;
  if (m?.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m?.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
  if (m?.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;

  const type = getContentType(m);
  const isNewsletter = from.endsWith('@newsletter');

  // For nowsenderRaw: prioritize effectiveParticipant for groups, effectiveRemoteJid for DMs
  const nowsenderRaw = msg.key.fromMe
    ? (socket.user.id.split(':')[0] + '@s.whatsapp.net')
    : (effectiveParticipant || (isGroup || isNewsletter ? null : effectiveRemoteJid));
  const senderNumberRaw = (nowsenderRaw || '').split('@')[0];
  const sanitizedNum = (number || '').replace(/[^0-9]/g, '');

  // --- JID RESOLUTION HELPERS ---
  const normalizeJid = (jid) => {
    if (!jid || typeof jid !== 'string' || jid === 'None') return jid;
    if (!jid.includes('@')) return jid + '@s.whatsapp.net';
    const [user, domain] = jid.split('@');
    const cleanUser = user ? user.split(':')[0] : '';
    return `${cleanUser}@${domain || 's.whatsapp.net'}`;
  };

  const resolveJidGlobal = async (jid, altJid) => {
    if (!jid || typeof jid !== 'string' || jid === 'None') return jid;
    let normalized = normalizeJid(jid);
    if (!normalized.endsWith('@lid')) return normalized;
    // Fast path: use the alt JID provided by Baileys (remoteJidAlt / participantAlt)
    if (altJid && typeof altJid === 'string' && !altJid.endsWith('@lid')) {
      return normalizeJid(altJid);
    }
    // Slow path: ask WA servers
    try {
      if (typeof socket.onWhatsApp === 'function') {
        const [res] = await socket.onWhatsApp(normalized);
        if (res && res.exists && res.jid) return normalizeJid(res.jid);
      }
    } catch (e) { }
    return normalized;
  };

  // Resolve main JIDs immediately
  const nowsender = await resolveJidGlobal(nowsenderRaw, msg.key.participantAlt || msg.key.remoteJidAlt);
  sender = await resolveJidGlobal(sender, msg.key.participantAlt || msg.key.remoteJidAlt);
  from = await resolveJidGlobal(from, msg.key.remoteJidAlt);
  const senderNumber = (nowsender || '').split('@')[0];
  // ------------------------------

  const userConfig = await loadUserConfigFromMongo(sanitizedNum) || {};
  const developers = (config.OWNER_NUMBER || '').split(',').map(n => n.replace(/[^0-9]/g, ''));
  const botNumber = socket.user.id.split(':')[0].replace(/[^0-9]/g, '');
  const isbot = botNumber === senderNumber;
  const sessionOwner = (userConfig.OWNER_NUMBER || '').split(',').map(n => n.replace(/[^0-9]/g, '')).filter(Boolean);
  const isOwner = isbot || developers.includes(senderNumber) || sessionOwner.includes(senderNumber);

  // ========== AUTO CONTACT SAVER (Google Contacts) ==========
  // Functionality delegated to handleAutoContactSaver above
  // ===========================================================

  let body = '';
  if (type === 'conversation') body = m.conversation;
  else if (type === 'extendedTextMessage') body = m.extendedTextMessage?.text;
  else if (type === 'imageMessage') body = m.imageMessage?.caption;
  else if (type === 'videoMessage') body = m.videoMessage?.caption;
  body = String(body || '').trim();

  // ========== BANNED CHATS & MAINTENANCE CHECK ==========
  const bannedChats = userConfig.BANNED_CHATS || [];
  if (bannedChats.includes(from)) {
    // Check if the body contains the unban command
    if (!body.toLowerCase().includes('unbanbot')) return;
  }
  // ======================================================

  const botName = userConfig.botName || config.BOT_NAME || BOT_NAME_FANCY;
  const botMention = {
    key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "CHAMA_MINI_MENTION" },
    message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:CHAMA MINI\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
  };

  // Allow fromMe interaction for commands
  if (msg.key.fromMe) {
    const selfPrefix = /^[#$+.!]/.test(body) ? body[0] : (userConfig.PREFIX || config.PREFIX || '.');
    if (!body.startsWith(selfPrefix)) return;
  }

  if (mType === 'conversation') logBody = msg.message.conversation;
  else if (mType === 'extendedTextMessage') logBody = mObj?.text;
  else if (mType === 'imageMessage' || mType === 'videoMessage') logBody = `[${mType}] ${mObj?.caption || ''}`;
  else if (mType === 'protocolMessage') {
    const deletedId = mObj?.key?.id;
    const cached = messageCache.get(deletedId);
    let deletedText = '';
    if (cached) {
      const ct = Object.keys(cached.message || {})[0];
      deletedText = (ct === 'conversation') ? cached.message.conversation : (cached.message[ct]?.text || cached.message[ct]?.caption || `[${ct}]`);

      // --- ANTI-DELETE RECOVERY ENGINE ---
      const antiDelete = userConfig.ANTI_DELETE || config.ANTI_DELETE || 'off';
      if (antiDelete !== 'off') {
        const userJid = jidNormalizedUser(socket.user.id);
        const senderJid = (cached.key.participant || cached.key.remoteJid || '');
        const recoveryMsg = `*━━━━━━━━━━━━━━━◆◉◉➤*\n*🗑️ ANTI-DELETE DETECTED*\n*━━━━━━━━━━━━━━━◆◉◉➤*\n\n*👤 From:* @${senderJid.split('@')[0]}\n*📍 Chat:* ${isGroup ? 'Group' : 'Private'}\n*⏰ Time:* ${getSriLankaTimestamp()}\n\n*📝 Message:* ${deletedText}\n\n> *© ${userConfig.botName || BOT_NAME_FANCY}*`;
        await socket.sendMessage(userJid, { text: recoveryMsg, mentions: [senderJid] });
      }
    }
    logBody = `🗑️ [MESSAGE DELETED] | Original: ${deletedText || 'Unknown'}`;
  } else logBody = `[${mType}]`;



  // ─── 📔 AUTO CONTACT SAVER ───
  try {
    const userConfig = await loadUserConfigFromMongo(number) || {};
    const autoSaver = userConfig.AUTO_CONTACT_SAVER || config.AUTO_CONTACT_SAVER;
    const googleToken = userConfig.GOOGLE_CONTACTS_TOKEN;

    if (autoSaver === 'true' && googleToken && !isGroup && !msg.key.fromMe) {
      const senderNum = sender.split('@')[0];
      const cacheKey = `${number}:save:${senderNum}`;

      // Prevent saving same contact multiple times in 24h
      if (!contactSaveCache.has(cacheKey)) {
        contactSaveCache.set(cacheKey, true);
        setTimeout(() => contactSaveCache.delete(cacheKey), 24 * 60 * 60 * 1000);

        const pushName = msg.pushName || 'WhatsApp User';
        const label = userConfig.CONTACT_LABEL || 'WhatsApp Leads';

        try {
          await createGoogleContact(number, `${pushName} (${label})`, senderNum);
          await logEvent(number, 'CONTACT_SAVED', `Auto saved ${pushName} (+${senderNum})`);

          const replyMsg = userConfig.CONTACT_SAVER_MSG || config.CONTACT_SAVER_MSG;
          if (replyMsg && replyMsg.length > 3) {
            const finalReply = replyMsg.replace(/@user/g, `@${senderNum}`);
            await delay(2000);
            await socket.sendMessage(from, { text: finalReply, mentions: [sender] });
          }
        } catch (e) {
          console.error('Auto Contact Save Error:', e.message);
        }
      }
    }
  } catch (err) { }

  // 1. Log incoming message to dashboard
  if (!isNewsletter) {
    // Cache incoming messages for anti-delete feature
    if (msg.key && msg.key.id) {
      messageCache.set(msg.key.id, msg);
      // Keep only last 200 messages to save memory
      if (messageCache.size > 200) {
        const firstKey = messageCache.keys().next().value;
        messageCache.delete(firstKey);
      }
    }

    // --- DATA PARSING & INITIALIZATION ---

    const prefix = /^[#$+.!]/.test(body) ? body.match(/^[#$+.!]/)[0] : (userConfig.PREFIX || config.PREFIX || '.');
    let isCmd = body.startsWith(prefix);
    let command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
    let args = body.trim().split(/ +/).slice(1);
    let text = args.join(' ');

    // Prefix-less command logic (oni, save)
    if (!isCmd) {
      const cleanBody = body.trim().toLowerCase();
      if (cleanBody === 'oni' || cleanBody === 'save') {
        command = 'save';
        isCmd = true;
        args = [];
      }
    }

    // -------------------------------------------------------------------------
    // CONSOLE LOGGER (Minified for Stability)
    // -------------------------------------------------------------------------
    trackActivity(number, 'incoming', command);
    // -------------------------------------------------------------------------

    const fetchGroupAdmins = async () => {
      if (!isGroup) return { isAdmin: false, isBotAdmin: false, groupMetadata: null };
      try {
        const metadata = await socket.groupMetadata(from);
        const admins = metadata.participants.filter(p => !!p.admin).map(p => p.id);
        return {
          isAdmin: admins.includes(nowsender),
          isBotAdmin: admins.includes(jidNormalizedUser(socket.user.id)),
          groupMetadata: metadata
        };
      } catch (e) {
        console.error('Failed to fetch group metadata:', e);
        return { isAdmin: false, isBotAdmin: false, groupMetadata: null };
      }
    };

    const { isAdmin, isBotAdmin, groupMetadata } = isGroup ? await fetchGroupAdmins() : { isAdmin: false, isBotAdmin: false, groupMetadata: null };

    // ========== MESSAGE ACTIVITY TRACKER ==========
    if (isGroup) {
      try {
        await initMongo();
        const statsCol = mongoDB.collection('group_stats');
        await statsCol.updateOne(
          { jid: from, participant: nowsender },
          {
            $inc: { messageCount: 1 },
            $set: { lastMessageAt: new Date(), updatedAt: new Date() }
          },
          { upsert: true }
        );
      } catch (e) { console.error('Stats tracking error:', e); }
    }
    // ==============================================

    // ========== ANTI-SPAM PROTECTION ==========
    if (isGroup && isBotAdmin) {
      const antiSpamEnabled = await getGroupSetting(from, 'antiSpamEnabled', false);
      if (antiSpamEnabled) {
        if (!global.__spamMap) global.__spamMap = new Map();
        const spamKey = `${from}:${nowsender}`;
        const lastMsg = global.__spamMap.get(spamKey) || 0;
        const nowTs = Date.now();

        if (nowTs - lastMsg < 1000) { // Allowed: 1 message per second.
          try {
            await socket.sendMessage(from, { delete: msg.key });
            return; // Stop processing this message
          } catch (e) { /* Silent fail if can't delete */ }
        }
        global.__spamMap.set(spamKey, nowTs);

        // Map size management
        if (global.__spamMap.size > 2000) {
          const first = global.__spamMap.keys().next().value;
          global.__spamMap.delete(first);
        }
      }
    }
    // ==========================================

    // ========== ANTI LINK & BADWORD LISTENERS ==========
    if (isGroup && isBotAdmin) {
      // 🚫 Anti-Link Logic
      const antiLinkSetting = await getAntiLinkSetting(from);
      const linkRegex = /chat.whatsapp.com|http:\/\/|https:\/\/|www./gi;
      if (antiLinkSetting.enabled && linkRegex.test(body)) {
        // Since user wants to remove distinction, we evaluate strictly
        await socket.sendMessage(from, { delete: msg.key });
        await socket.sendMessage(from, { text: `🚫 *Link Detected!* @${senderNumber}\n\nLinks are not allowed in this group.`, mentions: [nowsender] });
        return; // Stop processing
      }

      // 🚫 Anti-BadWord Logic
      const badWordEnabled = await isBlacklistEnabled(from);
      if (badWordEnabled) {
        const badWords = await listBlacklistWords(from);
        if (badWords.some(word => body.toLowerCase().includes(word.toLowerCase()))) {
          await socket.sendMessage(from, { delete: msg.key });
          await socket.sendMessage(from, { text: `🚫 *Bad Word Detected!* @${senderNumber}\n\nPlease maintain the decorum of the group.`, mentions: [nowsender] });
          return; // Stop processing
        }
      }
    }

    async function downloadQuotedMedia(quoted) {
      if (!quoted) return null;
      const qTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) return null;
      const messageType = qType.replace(/Message$/i, '').toLowerCase();
      const stream = await downloadContentFromMessage(quoted[qType], messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return {
        buffer,
        mime: quoted[qType].mimetype || '',
        caption: quoted[qType].caption || quoted[qType].fileName || '',
        ptt: quoted[qType].ptt || false,
        fileName: quoted[qType].fileName || ''
      };
    }

    const randomEmoji = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];

    if (!isCmd && !String(body).startsWith(prefix)) {
      // console.log(`⏩ [SKIP] | Message is not a command (No prefix detected).`);
      return;
    }

    //   console.log(`🎯 [TARGET] | Processing command: ${command} | Owner Access: ${isOwner}`);

    try {
      // ========== BOT OWNER RESTRICTION ==========
      const publicCommands = ['menu', 'help', 'alive', 'onceview', 'c2cs', 'csong', 'csongs', 'xnxx', 'xvideo', 'ping', 'uptime', 'owner', 'jid', 'gjid', 'cjid', 'chatjid', 'time', 'pair', 'paircode', 'sticker', 'calc'];
      if (!publicCommands.includes(command) && !isOwner) {
        return await socket.sendMessage(from, { text: `❌ *ACCESS DENIED* ❌\n\nCommand *${prefix}${command}* is restricted to the *Bot Owner* only.` });
      }
      // ===========================================

      // ========== BANNED CHATS CHECK ==========
      const bannedChats = userConfig.BANNED_CHATS || [];
      if (bannedChats.includes(from) && command !== 'unbanbot' && command !== 'unbandbot') {
        //       console.log(`🚫 [SKIP] | Chat ${from} is BANNED.`);
        return;
      }
      // =========================================

      // ========== MAINTENANCE CHECK ==========
      if (userConfig.MAINTENANCE === 'true' && command !== 'maintenancemode') {
        //       console.log(`⚠️  [SKIP] | Bot is in MAINTENANCE mode.`);
        const firstDev = developers[0] || config.OWNER_NUMBER.split(',')[0];
        const maintMsg = `⚠️ *${botName}* is currently under *Maintenance Mode*.\n\nPlease try again later. Powered by @${firstDev}`;
        return await socket.sendMessage(from, { text: maintMsg, mentions: [firstDev + '@s.whatsapp.net'] });
      }
      // ========================================

      // ========== WORK TYPE RESTRICTIONS (Simplified) ==========
      const workType = userConfig.WORK_TYPE || 'public';
      // Removed all role-based restrictions on workType to allow public access as requested.
      // ===============================================
      // ========== END WORK TYPE RESTRICTIONS ==========

      let reaction = reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
      if (command === 'song' || command === 'yts') reaction = '🎵';
      else if (command === 'video' || command === 'ytv') reaction = '🎥';
      else if (command === 'fb' || command === 'facebook') reaction = '🔵';
      else if (command === 'tt' || command === 'tiktok') reaction = '🖤';
      else if (command === 'apk') reaction = '📦';
      else if (command === 'alive') reaction = '👋';
      else if (command === 'ping') reaction = '⚡';
      else if (command === 'menu') reaction = '📂';
      else if (command === 'owner' || command === 'ownermenu') reaction = '👑';

      // Track command analytics
      trackActivity(sanitizedNum, 'command', command);

      try { await socket.sendMessage(from, { react: { text: reaction, key: msg.key } }).catch(() => { }); } catch (e) { }

      // ---- Group Management Commands Delegation ----


      const groupCommands = {
        // ⌚ Sri Lanka Time
        time: async ({ socket, from }) => {
          const now = moment().tz(TIMEZONE);
          const timeText = `⌚ *SRI LANKA TIME* ⌚\n\n📅 *DATE:* ${now.format('YYYY-MM-DD')}\n⏰ *TIME:* ${now.format('HH:mm:ss')}\n📆 *DAY:* ${now.format('dddd')}\n🌐 *Timezone:* Asia/Colombo\n\n*Powered by CHAMA MINI V5*`;
          await socket.sendMessage(from, { text: timeText });
        },

        // 🌟 Group Status (Post to Group Chat)
        gstatus: async ({ socket, from, args, prefix }) => {
          // Post to group status (colored message)
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: '❌ This is a group command.' });

          const input = args.join(' ');
          if (!input) return await socket.sendMessage(from, { text: `Usage: ${prefix}gstatus #color | message` });

          let backgroundColor = '#bd13a6ff';
          let text = input;

          if (input.includes('|')) {
            const parts = input.split('|');
            backgroundColor = parts[0].trim();
            text = parts.slice(1).join('|').trim();
          }

          try {
            const content = { text };
            const inside = await generateWAMessageContent(content, {
              upload: socket.waUploadToServer,
              backgroundColor
            });

            const messageSecret = crypto.randomBytes(32);
            const m = generateWAMessageFromContent(from, {
              messageContextInfo: { messageSecret },
              groupStatusMessageV2: {
                message: {
                  ...inside,
                  messageContextInfo: { messageSecret }
                }
              }
            }, {});

            await socket.relayMessage(from, m.message, { messageId: m.key.id });
            return await socket.sendMessage(from, {
              text: `✅ Status sent successfully!\n🔑 Message ID: ${m.key.id}\n📱 Chat: ${from}`
            });
          } catch (err) {
            console.error('gstatus error:', err);
            return await socket.sendMessage(from, { text: `❌ Failed to send status: ${err.message}` });
          }
        },

        // 🌟 Group Status (Post Media to Group Status)
        gmstatus: async ({ socket, from, msg, args, prefix }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: '❌ This is a group command.' });

          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted || (!quoted.imageMessage && !quoted.videoMessage)) {
            return await socket.sendMessage(from, { text: '❌ Reply to an image or video to post it as a group status.' });
          }

          const text = args.join(' ');

          try {
            const media = await downloadQuotedMedia(quoted);
            if (!media) return await socket.sendMessage(from, { text: '❌ Failed to download media.' });

            const mediaType = media.mime.startsWith('video') ? 'video' : 'image';
            const content = {
              [mediaType]: media.buffer,
              caption: text || media.caption,
              mimetype: media.mime
            };

            const inside = await generateWAMessageContent(content, {
              upload: socket.waUploadToServer
            });

            const messageSecret = crypto.randomBytes(32);
            const m = generateWAMessageFromContent(from, {
              messageContextInfo: { messageSecret },
              groupStatusMessageV2: {
                message: {
                  ...inside,
                  messageContextInfo: { messageSecret }
                }
              }
            }, {});

            await socket.relayMessage(from, m.message, { messageId: m.key.id });
            return await socket.sendMessage(from, {
              text: `✅ Media status sent successfully!\n🔑 Message ID: ${m.key.id}\n📱 Chat: ${from}`
            });
          } catch (err) {
            console.error('gmstatus error:', err);
            return await socket.sendMessage(from, { text: `❌ Failed to send media status: ${err.message}` });
          }
        },

        // 🌟 Personal Status (Text)
        tstatus: async ({ socket, from, args, prefix }) => {
          const input = args.join(' ');
          if (!input) return await socket.sendMessage(from, { text: `Usage: ${prefix}tstatus #color | message` });

          let backgroundColor = '#075E54';
          let text = input;
          if (input.includes('|')) {
            const parts = input.split('|');
            backgroundColor = parts[0].trim();
            text = parts.slice(1).join('|').trim();
          }

          try {
            await socket.sendMessage('status@broadcast', {
              text: text,
              backgroundColor: backgroundColor,
              font: 1
            });
            return await socket.sendMessage(from, { text: '✅ Text status posted successfully!' });
          } catch (err) {
            return await socket.sendMessage(from, { text: `❌ Failed to send status: ${err.message}` });
          }
        },

        // 🌟 Personal Status (Media)
        mstatus: async ({ socket, from, msg, args, prefix }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted || (!quoted.imageMessage && !quoted.videoMessage)) {
            return await socket.sendMessage(from, { text: '❌ Reply to an image or video to post it as your status.' });
          }

          const text = args.join(' ');
          try {
            const media = await downloadQuotedMedia(quoted);
            if (!media) return await socket.sendMessage(from, { text: '❌ Failed to download media.' });

            const type = media.mime.startsWith('video') ? 'video' : 'image';
            await socket.sendMessage('status@broadcast', {
              [type]: media.buffer,
              caption: text || media.caption,
              mimetype: media.mime
            });
            return await socket.sendMessage(from, { text: '✅ Media status posted successfully!' });
          } catch (err) {
            return await socket.sendMessage(from, { text: `❌ Failed to send media status: ${err.message}` });
          }
        },

        // 🌟 All-Media Status (Personal + Group)
        amstatus: async ({ socket, from, msg, args, prefix }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: '❌ This is a group command.' });

          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted || (!quoted.imageMessage && !quoted.videoMessage)) {
            return await socket.sendMessage(from, { text: '❌ Reply to an image or video.' });
          }

          const text = args.join(' ');

          try {
            const media = await downloadQuotedMedia(quoted);
            if (!media) return await socket.sendMessage(from, { text: '❌ Failed to download media.' });

            const type = media.mime.startsWith('video') ? 'video' : 'image';

            // 1. Post to personal status
            await socket.sendMessage('status@broadcast', {
              [type]: media.buffer,
              caption: text || media.caption,
              mimetype: media.mime
            });

            // 2. Post to group status
            const content = {
              [type]: media.buffer,
              caption: text || media.caption,
              mimetype: media.mime
            };

            const inside = await generateWAMessageContent(content, {
              upload: socket.waUploadToServer
            });

            const messageSecret = crypto.randomBytes(32);
            const m = generateWAMessageFromContent(from, {
              messageContextInfo: { messageSecret },
              groupStatusMessageV2: {
                message: {
                  ...inside,
                  messageContextInfo: { messageSecret }
                }
              }
            }, {});

            await socket.relayMessage(from, m.message, { messageId: m.key.id });
            return await socket.sendMessage(from, { text: '✅ Status posted to both successfully!' });
          } catch (err) {
            return await socket.sendMessage(from, { text: `❌ Failed: ${err.message}` });
          }
        },

        // 📊 Poll
        poll: async ({ socket, from, args, body, userConfig }) => {
          // Poll is now public
          const text = args.join(' ');
          if (!text.includes('|')) return await socket.sendMessage(from, { text: 'Usage: .poll Question | option1, option2, ...' });
          const [question, optionsStr] = text.split('|');
          const options = optionsStr.split(',').map(o => o.trim()).filter(o => o.length > 0);
          if (options.length < 2) return await socket.sendMessage(from, { text: '❌ Please provide at least 2 options.' });
          await socket.sendMessage(from, {
            poll: {
              name: question.trim(),
              values: options,
              selectableCount: 1
            }
          });
        },

        // ⏰ Scheduled Poll
        spoll: async ({ socket, from, args, number, senderNumber, userConfig }) => {
          // Scheduled Poll is now public
          const text = args.join(' ');
          const parts = text.split('|').map(p => p.trim());
          if (parts.length < 4) return await socket.sendMessage(from, { text: '❌ Invalid format!\nUsage: .spoll time | targetJid | question | option1, options2...' });

          const timeStr = parts[0];
          const toJidStr = parts[1];
          const question = parts[2];
          const optionsArr = parts[3].split(',').map(o => o.trim()).filter(o => o.length > 0);

          try {
            const scheduledDate = parseSriLankaTime(timeStr);
            if (isNaN(scheduledDate.getTime())) return await socket.sendMessage(from, { text: '❌ Invalid time format.' });
            if (scheduledDate <= new Date()) return await socket.sendMessage(from, { text: '❌ Cannot schedule in the past!' });

            const toJid = toJidStr.includes('@') ? toJidStr : `${toJidStr.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

            await addScheduledTask({
              sessionNumber: number,
              jid: toJid,
              time: moment(scheduledDate).tz(TIMEZONE).format('HH:mm'),
              fullDate: scheduledDate,
              type: 'poll',
              content: question,
              options: optionsArr,
              sender: senderNumber
            });

            return await socket.sendMessage(from, { text: `✅ *POLL SCHEDULED!*\n\n📅 *TIME (SL):* ${formatSriLankaTime(scheduledDate)}\n📤 *TO:* ${toJid}\n📊 *POLL:* ${question}\n🆔 *Check slist for management.*` });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ ERROR: ${e.message}` });
          }
        },

        // 🚫 Group Member Management
        kick: async ({ socket, from, args, nowsender, fetchGroupAdmins, userConfig }) => {

          const target = args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target || target.length < 15) return await socket.sendMessage(from, { text: '❌ *Usage:* .kick @user (or reply to a message)' });

          await socket.groupParticipantsUpdate(from, [target], 'remove');
          await socket.sendMessage(from, { text: formatMessage('👤 USER KICKED', `Successfully removed @${target.split('@')[0]} from the group.`, userConfig.botName), mentions: [target] });
        },

        add: async ({ socket, from, args, nowsender, fetchGroupAdmins, userConfig }) => {

          const target = args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target || target.length < 15) return await socket.sendMessage(from, { text: '❌ *Usage:* .add 947xxx...' });

          await socket.groupParticipantsUpdate(from, [target], 'add');
          await socket.sendMessage(from, { text: formatMessage('👤 USER ADDED', `Successfully added @${target.split('@')[0]} to the group.`, userConfig.botName), mentions: [target] });
        },

        promote: async ({ socket, from, args, nowsender, fetchGroupAdmins, userConfig }) => {

          const target = args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target || target.length < 15) return await socket.sendMessage(from, { text: '❌ *Usage:* .promote @user' });

          await socket.groupParticipantsUpdate(from, [target], 'promote');
          await socket.sendMessage(from, { text: formatMessage('👑 ADMIN PROMOTED', `@${target.split('@')[0]} is now an admin.`, userConfig.botName), mentions: [target] });
        },

        demote: async ({ socket, from, args, nowsender, fetchGroupAdmins, userConfig }) => {

          const target = args[0]?.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target || target.length < 15) return await socket.sendMessage(from, { text: '❌ *Usage:* .demote @user' });

          await socket.groupParticipantsUpdate(from, [target], 'demote');
          await socket.sendMessage(from, { text: formatMessage('👤 ADMIN DEMOTED', `@${target.split('@')[0]} has been demoted to member.`, userConfig.botName), mentions: [target] });
        },

        // 🔗 JID Information
        jid: async ({ socket, from, sender, msg, senderNumber, number }) => {
          const botJid = socket.user.id.split(':')[0] + '@s.whatsapp.net';

          // JIDs passed from handleCommands are already resolved (fromResolved/senderResolved)
          let chatJid = from;
          let senderJid = sender;

          // Handle quoted JID with resolution
          let quotedRaw = msg.message?.extendedTextMessage?.contextInfo?.participant || msg.message?.extendedTextMessage?.contextInfo?.remoteJid || 'None';
          let quotedAlt = msg.message?.extendedTextMessage?.contextInfo?.participantAlt || msg.message?.extendedTextMessage?.contextInfo?.remoteJidAlt;
          let quotedJid = await resolveJidGlobal(quotedRaw, quotedAlt);

          const jidInfo = `*╭─────────────────────────╮*
*         🔗 JID INFORMATION        *
*╰─────────────────────────╯*

👤 *Sender JID:* 
\`${senderJid}\`

💬 *Chat JID:* 
\`${chatJid}\`

📢 *Quoted JID:* 
\`${quotedJid}\`

🤖 *Bot JID:* 
\`${botJid}\`

🆔 *Message ID:* 
\`${msg.key.id}\`

⌚ *Time:* ${getSriLankaTimestamp()}

*━━━━━━━━━━━━━━━━━━━━━━━━━*
> *Note:* JIDs ending in @s.whatsapp.net represent the phone identity. Resolved from @lid where possible.`;
          await socket.sendMessage(from, { text: jidInfo });
        },

        // 👥 Group admins list
        admininfo: async ({ socket, from, sender, fetchGroupAdmins, userConfig }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });
          try {
            const admins = await getGroupAdmins(socket, from);
            let adminList = '*👑 Group Admins:*\n\n';
            admins.forEach((adminJid, index) => {
              const normalized = adminJid.split('@')[0].split(':')[0];
              adminList += `${index + 1}. @${normalized}\n`;
            });
            adminList += `\n*Total Admins:* ${admins.length}`;
            await socket.sendMessage(from, { text: adminList, mentions: admins });
          } catch (e) {
            await socket.sendMessage(from, { text: '❌ Failed to fetch admin list.' });
          }
        },

        // 📢 Forward Simulation
        forward: async ({ socket, from, args, sender, userConfig, msg }) => {
          const textBody = args.join(' ');
          const parts = textBody.split('|').map(p => p.trim());
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

          if (!quoted && parts.length < 2) return await socket.sendMessage(from, { text: 'Usage: .forward channelJid | [channelName] | text\n\nExample: .forward 120363419192353625@newsletter | My Channel | Hello!\n- or -\n.forward 120363... | Hello! (uses bot name)\n\n_Note: You can also reply to an image/video._' });

          const bName = userConfig.botName || config.BOT_NAME || 'DARK_SHADOW_X-MD V1 🍃';
          let forwardJid, forwardName, content;

          if (parts.length === 1 && quoted) {
            forwardJid = parts[0];
            forwardName = bName;
            content = '';
          } else if (parts.length === 2) {
            forwardJid = parts[0];
            forwardName = bName;
            content = parts[1];
          } else {
            forwardJid = parts[0];
            forwardName = parts[1] || bName;
            content = parts[2] || '';
          }
          const forwardId = 143;

          let msgPayload = { text: content };
          if (quoted) {
            try {
              // We need downloadQuotedMedia. It is defined in the parent scope.
              // Assuming it's accessible.
              const media = await downloadQuotedMedia(quoted);
              if (media) {
                const type = media.mime.split('/')[0];
                if (type === 'image') msgPayload = { image: media.buffer, caption: content };
                else if (type === 'video') msgPayload = { video: media.buffer, caption: content };
                else if (type === 'audio') msgPayload = { audio: media.buffer, mimetype: media.mime, ptt: media.ptt };
                else if (type === 'document') msgPayload = { document: media.buffer, mimetype: media.mime, fileName: media.fileName || 'document', caption: content };
              }
            } catch (e) {
              console.error('forward download error:', e);
            }
          }

          msgPayload.contextInfo = {
            mentionedJid: [sender],
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: forwardJid.includes('@newsletter') ? forwardJid : `${forwardJid}@newsletter`,
              newsletterName: forwardName || bName,
              serverMessageId: forwardId
            }
          };

          await socket.sendMessage(from, msgPayload);
        },

        // 🗑️ Media Delete System
        mediadelete: async ({ socket, from, args, fetchGroupAdmins, userConfig }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0];
          if (!sub) {
            const setting = await getMediaDeleteSetting(from);
            let statusText = `🗑️ *Media Delete Status:* ${setting.enabled ? 'ON ✅' : 'OFF ❌'}\n\n`;
            if (setting.enabled) {
              statusText += `📸 *Photos:* ${setting.deletePhotos ? 'Delete ✅' : 'Keep ❌'}\n`;
              statusText += `🎥 *Videos:* ${setting.deleteVideos ? 'Delete ✅' : 'Keep ❌'}\n`;
              statusText += `🎴 *Stickers:* ${setting.deleteStickers ? 'Delete ✅' : 'Keep ❌'}\n\n*Note:* Admin media will NOT be deleted`;
            }
            return await socket.sendMessage(from, { text: statusText });
          }

          if (sub === 'on') {
            const photos = args.includes('photos') || !args.includes('nophotos');
            const videos = args.includes('videos') || !args.includes('novideos');
            const stickers = args.includes('stickers') || !args.includes('nostickers');
            await setMediaDeleteSetting(from, true, photos, videos, stickers);
            return await socket.sendMessage(from, { text: `✅ Media delete system enabled!` });
          }

          if (sub === 'off') {
            await setMediaDeleteSetting(from, false);
            return await socket.sendMessage(from, { text: '❌ Media delete system disabled.' });
          }
        },

        subject: async ({ socket, from, args, fetchGroupAdmins, userConfig }) => {
          const text = args.join(' ');
          if (!text) return await socket.sendMessage(from, { text: '❌ Usage: .subject New Name' });
          await socket.groupUpdateSubject(from, text);
          await socket.sendMessage(from, { text: formatMessage('📝 SUBJECT UPDATED', `New Name: *${text}*`, userConfig.botName) });
        },

        desc: async ({ socket, from, args, fetchGroupAdmins, userConfig }) => {
          const text = args.join(' ');
          if (!text) return await socket.sendMessage(from, { text: '❌ Usage: .desc New Description' });
          await socket.groupUpdateDescription(from, text);
          await socket.sendMessage(from, { text: formatMessage('📝 DESC UPDATED', `New Description has been set.`, userConfig.botName) });
        },

        pp: async ({ socket, from, msg, fetchGroupAdmins, userConfig, downloadQuotedMedia }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted || !quoted.imageMessage) return await socket.sendMessage(from, { text: '❌ Reply to an image to set group/bot PP.' });
          const media = await downloadQuotedMedia(quoted);
          await socket.updateProfilePicture(from, media.buffer);
          await socket.sendMessage(from, { text: formatMessage('🖼️ PROFILE UPDATED', `Group profile picture has been updated.`, userConfig.botName) });
        },

        group: async ({ socket, from, args, fetchGroupAdmins, userConfig }) => {
          const mode = args[0]?.toLowerCase();
          if (mode === 'open') {
            await socket.groupSettingUpdate(from, 'not_announcement');
            await socket.sendMessage(from, { text: formatMessage('🔓 GROUP OPENED', `Everyone can now send messages here.`, userConfig.botName) });
          } else if (mode === 'close') {
            await socket.groupSettingUpdate(from, 'announcement');
            await socket.sendMessage(from, { text: formatMessage('🔒 GROUP CLOSED', `Only admins can now send messages.`, userConfig.botName) });
          } else {
            await socket.sendMessage(from, { text: '❌ Usage: .group [open/close]' });
          }
        },

        tagall: async ({ socket, from, args, fetchGroupAdmins, userConfig }) => {
          const text = args.join(' ') || 'Attention Everyone!';
          const participants = groupMetadata.participants.map(p => p.id);
          const mentionText = `📢 *TAG ALL*\n\n📝 *Message:* ${text}\n\n` + participants.map(p => `@${p.split('@')[0]}`).join(' ');
          await socket.sendMessage(from, { text: mentionText, mentions: participants });
        },

        hidetag: async ({ socket, from, args, fetchGroupAdmins }) => {
          const text = args.join(' ');
          const participants = groupMetadata.participants.map(p => p.id);
          await socket.sendMessage(from, { text: text, mentions: participants });
        },

        invitecode: async ({ socket, from, fetchGroupAdmins, userConfig }) => {
          const code = await socket.groupInviteCode(from);
          await socket.sendMessage(from, { text: formatMessage('🔗 GROUP LINK', `https://chat.whatsapp.com/${code}`, userConfig.botName) });
        },

        revoke: async ({ socket, from, fetchGroupAdmins, userConfig }) => {
          await socket.groupRevokeInvite(from);
          await socket.sendMessage(from, { text: formatMessage('♻️ LINK REVOKED', `Group link has been reset successfully.`, userConfig.botName) });
        },

        antilink: async ({ socket, from, args, userConfig }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0]?.toLowerCase();
          if (!sub) {
            const setting = await getAntiLinkSetting(from);
            let statusText = `🚫 *Anti-Link Status:* ${setting.enabled ? 'ON ✅' : 'OFF ❌'}\n`;
            if (setting.enabled) {
              statusText += '*Mode:* Strict (No one can post links)\n';
            }
            return await socket.sendMessage(from, { text: statusText });
          }

          if (sub === 'on' || sub === 'off') {
            if (sub === 'off') {
              await setAntiLinkSetting(from, false);
              return await socket.sendMessage(from, { text: formatMessage('🛡️ ANTI-LINK', 'System has been turned *OFF*.', userConfig.botName) });
            } else {
              // Force strict mode for everyone
              await setAntiLinkSetting(from, true, false, false);
              return await socket.sendMessage(from, { text: formatMessage('🛡️ ANTI-LINK', 'System enabled: *ON*\n🔒 No one can post links (Admins included).', userConfig.botName) });
            }
          }
        },

        nolinks: async (opts) => await groupCommands.antilink(opts),

        // 🔗 Link Test
        linktest: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const testText = args.join(' ');
          const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|bit\.ly\/[^\s]+|t\.co\/[^\s]+|t\.me\/[^\s]+|wa\.me\/[^\s]+|chat\.whatsapp.com\/[^\s]+)/gi;
          const matches = testText.match(urlRegex);

          if (matches) {
            const setting = await getAntiLinkSetting(from);
            let action = '✅ ALLOWED';
            if (setting.enabled) {
              if (setting.membersOnly) action = '❌ DELETED (Members Only Mode) - Admin messages NOT deleted';
              else if (!setting.allowAdmins) action = '❌ DELETED (Strict Mode) - Admin messages NOT deleted';
              else action = '✅ ALLOWED (Normal Mode) - Admin messages NOT deleted';
            }
            return await socket.sendMessage(from, { text: `🔗 *Link Test Results:*\n\nFound ${matches.length} link(s):\n${matches.map((link, i) => `${i + 1}. ${link}`).join('\n')}\n\n*This message would be:* ${action}\n*Note:* Admin messages are NEVER deleted.` });
          } else {
            return await socket.sendMessage(from, { text: '❌ No links found in the provided text.' });
          }
        },

        // 👋 Welcome system
        welcome: async ({ socket, from, args, fetchGroupAdmins, userConfig }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0]?.toLowerCase();
          if (!sub || sub === 'settings') {
            const isEnabled = await getGroupSetting(from, 'welcomeEnabled', false);
            const welcomeMsg = await getGroupSetting(from, 'welcomeText', config.WELCOME_MSG || 'Default Welcome Message');
            const status = isEnabled ? 'ENABLED ✅' : 'DISABLED ❌';
            return await socket.sendMessage(from, { text: `👋 *WELCOME SYSTEM STATUS*\n\nStatus: ${status}\nMessage: ${welcomeMsg}\n\n*Usage:* .welcome on|off|set <text>` });
          }
          if (sub === 'on') { await setGroupSetting(from, 'welcomeEnabled', true); return await socket.sendMessage(from, { text: 'Welcome messages enabled for this group.' }); }
          if (sub === 'off') { await setGroupSetting(from, 'welcomeEnabled', false); return await socket.sendMessage(from, { text: 'Welcome messages disabled for this group.' }); }
          if (sub === 'set') { const txt = args.slice(1).join(' '); if (!txt) return await socket.sendMessage(from, { text: 'Provide welcome text after .welcome set' }); await setGroupSetting(from, 'welcomeText', txt); return await socket.sendMessage(from, { text: 'Welcome text updated.' }); }
        },

        // 👋 Left system
        left: async ({ socket, from, args, fetchGroupAdmins, userConfig }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });
          const sub = args[0]?.toLowerCase();
          if (!sub || sub === 'settings') {
            const isEnabled = await getGroupSetting(from, 'leftEnabled', false);
            const leftMsg = await getGroupSetting(from, 'leftText', config.LEFT_MSG || 'Default Left Message');
            const status = isEnabled ? 'ENABLED ✅' : 'DISABLED ❌';
            return await socket.sendMessage(from, { text: `👋 *LEFT SYSTEM STATUS*\n\nStatus: ${status}\nMessage: ${leftMsg}\n\n*Usage:* .left on|off|set <text>` });
          }
          if (sub === 'on') { await setGroupSetting(from, 'leftEnabled', true); return await socket.sendMessage(from, { text: 'Left messages enabled for this group.' }); }
          if (sub === 'off') { await setGroupSetting(from, 'leftEnabled', false); return await socket.sendMessage(from, { text: 'Left messages disabled for this group.' }); }
          if (sub === 'set') { const txt = args.slice(1).join(' '); if (!txt) return await socket.sendMessage(from, { text: 'Provide left text after .left set' }); await setGroupSetting(from, 'leftText', txt); return await socket.sendMessage(from, { text: 'Left text updated.' }); }
        },

        // 🖼️ Welcome Image
        imgwelcome: async ({ socket, from, args, fetchGroupAdmins, userConfig, msg }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0]?.toLowerCase();
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

          if (!sub || sub === 'settings') {
            const isEnabled = await getGroupSetting(from, 'welcomeEnabled', false);
            const welcomeImage = await getGroupSetting(from, 'welcomeImage', null);
            return await socket.sendMessage(from, {
              text: `📸 *WELCOME IMAGE SYSTEM*\n\n` +
                `*Status:* ${isEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}\n` +
                `*Mode:* ${welcomeImage ? 'Custom URL' : 'Automatic (Group DP)'}\n\n` +
                `*Usage:*\n` +
                `• .imgwelcome on : Enable and use Group DP\n` +
                `• .imgwelcome off : Disable welcome images\n` +
                `• .imgwelcome remove : Reset to Group DP`
            });
          }

          if (sub === 'on') {
            await setGroupSetting(from, 'welcomeEnabled', true);
            return await socket.sendMessage(from, { text: '✅ Welcome images enabled! The bot will now use this group\'s profile picture for welcome messages.' });
          }
          if (sub === 'off') {
            await setGroupSetting(from, 'welcomeEnabled', false);
            return await socket.sendMessage(from, { text: '❌ Welcome images disabled.' });
          }
          if (sub === 'remove' || sub === 'delete') {
            await setGroupSetting(from, 'welcomeImage', null);
            return await socket.sendMessage(from, { text: '✅ Custom welcome image removed. Now using Group Profile Picture.' });
          }

          // Support setting via reply to image
          if (quoted?.imageMessage && sub === 'set') {
            return await socket.sendMessage(from, { text: '⚠️ Direct image upload is coming soon! For now, keep it on "Automatic" to use the Group DP.' });
          }
        },

        antibadword: async ({ socket, from, args, userConfig }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0]?.toLowerCase();
          if (!sub) {
            const enabled = await isBlacklistEnabled(from);
            const words = await listBlacklistWords(from);
            let statusText = `🛡️ *Anti-Badword Status*: ${enabled ? 'ON ✅' : 'OFF ❌'}\n\n*Note:* System applies to EVERYONE\n\n`;
            if (words.length > 0) {
              statusText += `📝 *Blacklisted Words (${words.length}):*\n` + words.map((w, i) => `${i + 1}. ${w}`).join('\n');
            } else {
              statusText += '📝 *No blacklisted words.*';
            }
            return await socket.sendMessage(from, { text: formatMessage('🛡️ ANTI-BADWORD', statusText, userConfig.botName) });
          }

          if (sub === 'on' || sub === 'off') {
            const enabled = sub === 'on';
            await setBlacklistEnabled(from, enabled);
            return await socket.sendMessage(from, { text: formatMessage('🛡️ ANTI-BADWORD', `System has been turned *${sub.toUpperCase()}*. All users (including admins) will be filtered.`, userConfig.botName) });
          }

          if (sub === 'add') {
            const word = args.slice(1).join(' ').toLowerCase();
            if (!word) return await socket.sendMessage(from, { text: '❌ Usage: .antibadword add <word>' });
            await addBlacklistWord(from, word);
            return await socket.sendMessage(from, { text: formatMessage('🛡️ WORD ADDED', `"${word}" has been added to the blacklist.`, userConfig.botName) });
          }

          if (sub === 'del' || sub === 'remove') {
            const word = args.slice(1).join(' ').toLowerCase();
            if (!word) return await socket.sendMessage(from, { text: '❌ Usage: .antibadword del <word>' });
            await removeBlacklistWord(from, word);
            return await socket.sendMessage(from, { text: formatMessage('🛡️ WORD REMOVED', `"${word}" has been removed from the blacklist.`, userConfig.botName) });
          }

          if (sub === 'clear') {
            await clearBlacklist(from);
            return await socket.sendMessage(from, { text: formatMessage('🛡️ BLACKLIST CLEARED', 'All blacklisted words have been removed.', userConfig.botName) });
          }

          if (sub === 'list') {
            const words = await listBlacklistWords(from);
            if (words.length === 0) return await socket.sendMessage(from, { text: '📝 *Blacklist is empty.*' });
            const list = `📝 *Blacklisted Words:* \n\n` + words.map((w, i) => `${i + 1}. ${w}`).join('\n');
            return await socket.sendMessage(from, { text: formatMessage('🛡️ BLACKLIST', list, userConfig.botName) });
          }
        },

        addblacklist: async (opts) => await groupCommands.antibadword({ ...opts, args: ['add', ...opts.args] }),
        removeblacklist: async (opts) => await groupCommands.antibadword({ ...opts, args: ['del', ...opts.args] }),
        clearblacklist: async (opts) => await groupCommands.antibadword({ ...opts, args: ['clear', ...opts.args] }),


        antidelete: async ({ socket, from, args, fetchGroupAdmins, userConfig, sanitizedNum }) => {
          const mode = args[0]?.toLowerCase();
          if (!mode) return await socket.sendMessage(from, { text: 'Usage: .antidelete on/off' });
          userConfig.ANTI_DELETE = mode === 'on' ? 'true' : 'false';
          await setUserConfigInMongo(sanitizedNum, userConfig);
          await socket.sendMessage(from, { text: formatMessage('🛡️ ANTI-DELETE', `System has been turned *${mode.toUpperCase()}*.`, userConfig.botName) });
        },

        nick: async ({ socket, from, args, isOwner, userConfig }) => {
          const name = args.join(' ');
          if (!name) return await socket.sendMessage(from, { text: '❌ Usage: .nick New Name' });
          await socket.updateProfileName(name);
          await socket.sendMessage(from, { text: formatMessage('👤 NAME UPDATED', `Bot name is now: *${name}*`, userConfig.botName) });
        },

        bio: async ({ socket, from, args, isOwner, userConfig }) => {
          const bio = args.join(' ');
          if (!bio) return await socket.sendMessage(from, { text: '❌ Usage: .bio New Status' });
          await socket.updateProfileStatus(bio);
          await socket.sendMessage(from, { text: formatMessage('📝 BIO UPDATED', `Bot bio is now: *${bio}*`, userConfig.botName) });
        },

        privacy: async ({ socket, from, args, isOwner, userConfig }) => {
          const setting = args[0]?.toLowerCase();
          const value = args[1]?.toLowerCase();
          if (!setting || !value) return await socket.sendMessage(from, { text: '❌ Usage: .privacy <lastseen|profile|status|read_receipts|online> <all|contacts|none|anybody>' });
          const privacyMap = {
            lastseen: 'last',
            profile: 'profile',
            status: 'status',
            read_receipts: 'readreceipts',
            online: 'online'
          };
          const realSetting = privacyMap[setting];
          if (!realSetting) return await socket.sendMessage(from, { text: '❌ Invalid setting.' });
          await socket.updatePrivacySettings(realSetting, value);
          await socket.sendMessage(from, { text: formatMessage('🔒 PRIVACY UPDATED', `Privacy for *${setting}* set to *${value}*.`, userConfig.botName) });
        },

        // 🚫 Blacklist status and toggle
        blacklist: async ({ socket, from, args, userConfig }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });
          const sub = args[0];
          if (!sub) {
            const enabled = await isBlacklistEnabled(from);
            const words = await listBlacklistWords(from);
            let statusText = `🚫 *Blacklist Status*: ${enabled ? 'ON ✅' : 'OFF ❌'}\n\n*Note:* System applies to EVERYONE\n\n`;
            if (words.length > 0) {
              statusText += '*Blacklisted Words:*\n';
              words.forEach((item, index) => { statusText += `${index + 1}. ${item}\n`; });
            } else statusText += '*No blacklisted words*';
            await socket.sendMessage(from, { text: statusText });
            return;
          }
          if (sub === 'on' || sub === 'off') {
            const enabled = sub === 'on';
            await setBlacklistEnabled(from, enabled);
            await socket.sendMessage(from, { text: `Blacklist ${enabled ? 'enabled' : 'disabled'}.\n*Note:* System applies to EVERYONE.` });
          }
        },

        // 💬 Match Replies (Cyclic)
        match: async ({ socket, from, args, msg, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' }, { quoted: msg });
          const sub = args[0];
          if (!sub) return await socket.sendMessage(from, { text: 'Usage: .match add|list|del|test' }, { quoted: msg });

          if (sub === 'add') {
            const restArgs = args.slice(1).join(' ');
            const pipeIndex = restArgs.indexOf('|');
            if (pipeIndex === -1) {
              return await socket.sendMessage(from, { text: 'Usage: .match add <word1 word2 ...> | <reply1> , <reply2> , <reply3>' }, { quoted: msg });
            }
            const key = restArgs.substring(0, pipeIndex).trim();
            const repliesStr = restArgs.substring(pipeIndex + 1).trim();
            const replies = repliesStr.split(',').map(r => r.trim()).filter(r => r.length > 0);
            if (!key || replies.length === 0) return await socket.sendMessage(from, { text: 'Please provide a key (one or more words) and at least one reply.' }, { quoted: msg });
            const existing = await getMatchReply(from, key);
            if (existing) return await socket.sendMessage(from, { text: `Key "${key}" already exists. Use .match list.` }, { quoted: msg });
            await addMatchReply(from, key, replies);
            return await socket.sendMessage(from, { text: `✅ Match reply added!\nKey: "${key}"\nWords: ${key.split(' ').length}\nReplies: ${replies.length} (cyclic)\n\n*Note:* Replies will be sent as quoted replies with mentions.` }, { quoted: msg });
          }

          if (sub === 'list') {
            const matches = await listMatchReplies(from);
            if (matches.length === 0) return await socket.sendMessage(from, { text: 'No match replies set for this group.' }, { quoted: msg });
            let matchText = '*📋 Match Replies List (Cyclic):*\n\n';
            matches.forEach((match, index) => {
              matchText += `${index + 1}. *Key:* "${match.key}"\n   *Words:* ${match.key.split(' ').length}\n   *Replies (${match.replies.length}):*\n`;
              match.replies.forEach((reply, i) => { matchText += `     ${i + 1}. ${reply}\n`; });
              matchText += `   *Next Index:* ${match.replyIndex || 0}\n\n`;
            });
            return await socket.sendMessage(from, { text: matchText }, { quoted: msg });
          }

          if (sub === 'del' || sub === 'remove') {
            const key = args.slice(1).join(' ').trim();
            if (!key) return await socket.sendMessage(from, { text: 'Usage: .match del <key>' }, { quoted: msg });
            await removeMatchReply(from, key);
            return await socket.sendMessage(from, { text: `Match "${key}" removed.` }, { quoted: msg });
          }

          if (sub === 'test') {
            const testText = args.slice(1).join(' ').trim();
            if (!testText) return await socket.sendMessage(from, { text: 'Usage: .match test <text>' }, { quoted: msg });
            const matches = await listMatchReplies(from);
            let matchedKey = null;
            const lowerText = testText.toLowerCase();
            for (const match of matches) {
              const keyWords = match.key.toLowerCase().split(' ').filter(w => w.length > 0);
              const allWordsPresent = keyWords.every(word => lowerText.includes(word));
              if (allWordsPresent) { matchedKey = match.key; break; }
            }
            if (!matchedKey) return await socket.sendMessage(from, { text: `No match found for: "${testText}"` }, { quoted: msg });
            const reply = await getNextMatchReply(from, matchedKey);
            return await socket.sendMessage(from, { text: `*Test Match Reply:*\nInput: "${testText}"\nMatched Key: "${matchedKey}"\n\n*Next Reply:*\n${reply}` }, { quoted: msg });
          }
        },

        // 💬 Test Match
        testmatch: async ({ socket, from, args, msg }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' }, { quoted: msg });
          const testText = args.join(' ');
          if (!testText) return await socket.sendMessage(from, { text: 'Usage: .testmatch <text>' }, { quoted: msg });
          const matches = await listMatchReplies(from);
          let matchedKey = null;
          const lowerText = testText.toLowerCase();
          for (const match of matches) {
            const keyWords = match.key.toLowerCase().split(' ').filter(w => w.length > 0);
            const allWordsPresent = keyWords.every(word => lowerText.includes(word));
            if (allWordsPresent) { matchedKey = match.key; break; }
          }
          if (!matchedKey) return await socket.sendMessage(from, { text: `No match found for: "${testText}"` }, { quoted: msg });
          const reply = await getNextMatchReply(from, matchedKey);
          return await socket.sendMessage(from, { text: `*Test Match Reply:*\nInput: "${testText}"\nMatched Key: "${matchedKey}"\n\n*Next Reply:*\n${reply}` }, { quoted: msg });
        },

        // 👁 Once-View System
        onceview: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0];
          if (!sub) {
            const setting = await getOnceViewSetting(from);
            return await socket.sendMessage(from, { text: `👁 *OnceView Settings:*\n\nStatus: ${setting.enabled ? 'ON ✅' : 'OFF ❌'}\nDelete Photos: ${setting.deletePhotos ? 'Yes' : 'No'}\nDelete Videos: ${setting.deleteVideos ? 'Yes' : 'No'}` });
          }
          if (sub === 'on') {
            await setOnceViewSetting(from, true);
            return await socket.sendMessage(from, { text: '✅ OnceView system enabled!\nOnce-view photos/videos will be automatically deleted after viewing.' });
          }
          if (sub === 'off') {
            await setOnceViewSetting(from, false);
            return await socket.sendMessage(from, { text: '❌ OnceView system disabled.' });
          }
          if (sub === 'delete') {
            const type = args[1];
            if (!type) return await socket.sendMessage(from, { text: 'Usage: .onceview delete photos/videos/all' });
            if (type === 'photos') {
              await setOnceViewSetting(from, true, true, false);
              const result = await deleteOnceViewMedia(from, 'photos');
              return await socket.sendMessage(from, { text: `✅ OnceView photos deletion enabled: ${result.message}` });
            }
            if (type === 'videos') {
              await setOnceViewSetting(from, true, false, true);
              const result = await deleteOnceViewMedia(from, 'videos');
              return await socket.sendMessage(from, { text: `✅ OnceView videos deletion enabled: ${result.message}` });
            }
            if (type === 'all') {
              await setOnceViewSetting(from, true, true, true);
              const result = await deleteOnceViewMedia(from, 'all');
              return await socket.sendMessage(from, { text: `✅ OnceView all media deletion enabled: ${result.message}` });
            }
          }
        },

        // 📝 Note
        note: async ({ socket, from, args, senderNumber }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'Use notes in groups only.' });
          const key = args[0]; const value = args.slice(1).join(' ');
          if (!key || !value) return await socket.sendMessage(from, { text: 'Usage: .note <key> <value>' });
          await saveNote({ key, value, owner: senderNumber, groupJid: from });
          return await socket.sendMessage(from, { text: `Saved note '${key}'. Use .get ${key} to retrieve.` });
        },

        // 🔗 Get note
        get: async ({ socket, from, args, msg }) => {
          let key = args[0];
          const quotedInfo = msg?.message?.extendedTextMessage?.contextInfo;
          if (!key && quotedInfo && quotedInfo.quotedMessage) {
            const q = quotedInfo.quotedMessage;
            const quotedText = (q.conversation) || (q?.extendedTextMessage?.text) || (q?.imageMessage?.caption) || '';
            key = quotedText.trim();
          }
          if (!key) return await socket.sendMessage(from, { text: 'Usage: .get <key>  — or reply to a message with .get' }, { quoted: msg });
          const n = await getNote(key, from);
          if (!n) {
            const replyTarget = (quotedInfo && quotedInfo.quotedMessage) ? { key: { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedInfo.participant || from }, message: quotedInfo.quotedMessage } : msg;
            return await socket.sendMessage(from, { text: `No note found for '${key}'.` }, { quoted: replyTarget });
          }
          const replyTarget = (quotedInfo && quotedInfo.quotedMessage) ? { key: { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedInfo.participant || from }, message: quotedInfo.quotedMessage } : msg;
          return await socket.sendMessage(from, { text: `${n.value}` }, { quoted: replyTarget });
        },

        // 🗑️ Clear note
        clear: async ({ socket, from, args }) => {
          const key = args[0]; if (!key) return await socket.sendMessage(from, { text: 'Usage: .clear <key>' });
          await deleteNote(key, from);
          return await socket.sendMessage(from, { text: `Deleted note '${key}'.` });
        },

        // 📋 List notes
        noted: async ({ socket, from }) => {
          const list = await listNotes(from);
          if (!list || list.length === 0) return await socket.sendMessage(from, { text: 'No notes saved for this group.' });
          const out = list.map(l => `• ${l.key}: ${l.value}`).join('\n');
          return await socket.sendMessage(from, { text: `Saved notes:\n${out}` });
        },

        // 🏷️ Filter
        filter: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0]?.toLowerCase();
          if (!sub) return await socket.sendMessage(from, { text: 'Usage: .filter add|list|remove' });
          if (sub === 'add') {
            const type = args[1]?.toLowerCase();
            const trigger = args[2];
            const reply = args.slice(3).join(' ');
            if (!type || !['contains', 'exact', 'regex'].includes(type) || !trigger || !reply) {
              return await socket.sendMessage(from, { text: 'Usage: .filter add <contains|exact|regex> <trigger> <reply>' });
            }
            await addFilter(from, trigger, type, reply);
            return await socket.sendMessage(from, { text: `✅ Filter added: [${type}] "${trigger}" -> "${reply}"` });
          }
          if (sub === 'list') {
            const filters = await listFilters(from);
            if (!filters || filters.length === 0) return await socket.sendMessage(from, { text: '📝 No filters set for this group.' });
            let out = `📋 *Group Filters:*\n\n`;
            filters.forEach((f, i) => { out += `${i + 1}. [${f.type}] *${f.trigger}* → ${f.reply}\n`; });
            return await socket.sendMessage(from, { text: out });
          }
          if (sub === 'remove' || sub === 'del') {
            const trigger = args.slice(1).join(' ').trim();
            if (!trigger) return await socket.sendMessage(from, { text: 'Usage: .filter remove <trigger_name>' });
            await removeFilter(from, trigger);
            return await socket.sendMessage(from, { text: `🗑️ Filter "${trigger}" removed.` });
          }
        },

        // 💬 Auto Reply
        reply: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, number }) => {

          const sub = args[0]?.toLowerCase();
          if (!sub) return await socket.sendMessage(from, { text: 'Usage: .reply add|list|remove|edit' });

          if (sub === 'add') {
            const trigger = args[1];
            const resp = args.slice(2).join(' ');
            if (!trigger) return await socket.sendMessage(from, { text: 'Usage: .reply add <trigger> <response>\n*Tip:* Reply to a media (image/sticker/audio) with `.reply add <trigger>` to save that media.' });

            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quotedMsg) {
              const media = await downloadQuotedMedia(quotedMsg);
              if (media) {
                const mType = Object.keys(quotedMsg)[0].replace('Message', '');
                await addAutoReply(number, trigger, mType, resp || '', media.buffer, media.mime);
                return await socket.sendMessage(from, { text: `✅ Media auto-reply added for "${trigger}"! [Type: ${mType}]` });
              }
            }

            if (!resp) return await socket.sendMessage(from, { text: 'Usage: .reply add <trigger> <response>' });
            await addAutoReply(number, trigger, 'text', resp);
            return await socket.sendMessage(from, { text: `✅ Text auto-reply added for "${trigger}".` });
          }
          if (sub === 'list') {
            const rs = await listAutoReplies(number);
            if (!rs || rs.length === 0) return await socket.sendMessage(from, { text: '📍 No auto replies found.' });
            let out = '*📍 Auto Replies (Global):*\n\n';
            rs.forEach((r, i) => {
              out += `*${i + 1}.* ${r.trigger} → ${r.response || (r.type + ' media')}\n`;
            });
            return await socket.sendMessage(from, { text: out });
          }
          if (sub === 'remove' || sub === 'del') {
            const trigger = args[1];
            if (!trigger) return await socket.sendMessage(from, { text: 'Usage: .reply remove <trigger>' });
            await removeAutoReplyFromMongo(number, trigger);
            return await socket.sendMessage(from, { text: `✅ Auto-reply removed for "${trigger}".` });
          }
          if (sub === 'edit') {
            const trigger = args[1];
            const resp = args.slice(2).join(' ');
            if (!trigger || !resp) return await socket.sendMessage(from, { text: 'Usage: .reply edit <trigger> <new_response>' });
            const existing = await getAutoReply(number, trigger);
            if (!existing) return await socket.sendMessage(from, { text: `❌ No auto-reply found for "${trigger}". Use .reply add to create one.` });
            await addAutoReply(number, trigger, 'text', resp);
            return await socket.sendMessage(from, { text: `✅ Auto-reply updated for "${trigger}".` });
          }
        },


        // 📝 Auto Bio System
        autobio: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, number }) => {
          // Auto Bio is now public
          const sub = args[0]?.toLowerCase();
          if (!sub) return await socket.sendMessage(from, { text: 'Usage: .autobio on|off|add|list|del|time' });

          const cfg = await loadUserConfigFromMongo(number) || {};
          const bioSettings = cfg.autoBioSettings || { enabled: false, interval: 12, messages: [] };

          if (sub === 'on') {
            bioSettings.enabled = true;
            bioSettings.lastRun = 0; // Force immediate run next tick
            cfg.autoBioSettings = bioSettings;
            await setUserConfigInMongo(number, cfg);
            return await socket.sendMessage(from, { text: '✅ Auto Bio enabled!' });
          }
          if (sub === 'off') {
            bioSettings.enabled = false;
            cfg.autoBioSettings = bioSettings;
            await setUserConfigInMongo(number, cfg);
            return await socket.sendMessage(from, { text: '❌ Auto Bio disabled.' });
          }
          if (sub === 'add') {
            const text = args.slice(1).join(' ').trim();
            if (!text) return await socket.sendMessage(from, { text: 'Usage: .autobio add <text>\nPlaceholders: &time, &runtime, &version, &owner' });
            bioSettings.messages.push(text);
            cfg.autoBioSettings = bioSettings;
            await setUserConfigInMongo(number, cfg);
            return await socket.sendMessage(from, { text: `✅ Auto Bio message added!\nTotal messages: ${bioSettings.messages.length}` });
          }
          if (sub === 'list') {
            if (bioSettings.messages.length === 0) return await socket.sendMessage(from, { text: '📝 No Auto Bio messages found.' });
            let out = `📋 *Auto Bio Messages (${bioSettings.messages.length})*\nStatus: ${bioSettings.enabled ? 'ON ✅' : 'OFF ❌'}\nInterval: ${bioSettings.interval} mins\n\n`;
            bioSettings.messages.forEach((msg, i) => { out += `*${i + 1}.* ${msg}\n`; });
            return await socket.sendMessage(from, { text: out });
          }
          if (sub === 'del' || sub === 'remove') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= bioSettings.messages.length) return await socket.sendMessage(from, { text: 'Usage: .autobio del <number>' });
            const removed = bioSettings.messages.splice(index, 1);
            cfg.autoBioSettings = bioSettings;
            await setUserConfigInMongo(number, cfg);
            return await socket.sendMessage(from, { text: `🗑️ Removed message: "${removed[0]}"` });
          }
          if (sub === 'time') {
            const mins = parseInt(args[1]);
            if (isNaN(mins) || mins < 1) return await socket.sendMessage(from, { text: 'Usage: .autobio time <minutes>' });
            bioSettings.interval = mins;
            cfg.autoBioSettings = bioSettings;
            await setUserConfigInMongo(number, cfg);
            return await socket.sendMessage(from, { text: `⏰ Auto Bio interval set to ${mins} minutes.` });
          }
        },

        schedule: async ({ socket, from, args, number, senderNumber, msg, downloadQuotedMedia }) => {
          const sub = args[0];
          if (!sub) return await socket.sendMessage(from, { text: 'Usage: .schedule add|list|del|info' });

          if (sub === 'add') {
            const timeStr = args[1];
            const to = args[2];
            const textStr = args.slice(3).join(' ');
            let txt = textStr;
            let deleteAfterMins = 0;
            let forwardJid = null;
            let forwardName = null;
            let forwardId = 143;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            let mediaUrl = null;
            let mediaType = 'text';

            if (quoted) {
              try {
                const media = await downloadQuotedMedia(quoted);
                if (media) {
                  mediaType = media.mime.split('/')[0];
                  if (media.mime.includes('audio')) mediaType = 'audio';
                  const filename = `sched_${Date.now()}.${media.mime.split('/')[1] || 'bin'}`;
                  const filePath = path.join(__dirname, 'scheduled_media', filename);
                  fs.writeFileSync(filePath, media.buffer);
                  mediaUrl = filePath;
                }
              } catch (e) {
                console.error('schedule download error:', e);
              }
            }

            if (textStr.includes('|')) {
              const parts = textStr.split('|').map(p => p.trim());
              txt = parts[0];
              deleteAfterMins = parseInt(parts[1]) || 0;
              // Forwarding fields are optional. Use if parts[2] (JID) and parts[3] (Name) are provided.
              forwardJid = parts[2] || null;
              forwardName = parts[3] || null;
              if (parts[4]) forwardId = parseInt(parts[4]) || 143;
            }

            if (!timeStr || !to || (!txt && !mediaUrl)) {
              return await socket.sendMessage(from, { text: 'Usage: .schedule add <time> <target_jid> <message> | [delete_mins] | [channelJid] | [channelName]\n\n*Example:*\n.schedule add 14:30 947... | 0 | 120363...@newsletter | My Channel\n\n_Note: You can also reply to an image/video._' });
            }
            try {
              const scheduledDate = parseSriLankaTime(timeStr);
              if (isNaN(scheduledDate.getTime())) return await socket.sendMessage(from, { text: '❌ Invalid time format.' });
              if (scheduledDate <= new Date()) return await socket.sendMessage(from, { text: '❌ Cannot schedule messages in the past!' });
              const toJid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

              const schedule = await addScheduledTask({
                sessionNumber: number,
                jid: toJid,
                time: moment(scheduledDate).tz(TIMEZONE).format('HH:mm'),
                fullDate: scheduledDate,
                type: mediaUrl ? 'message' : 'text', // both handled by message block in ticker
                content: txt,
                mediaUrl: mediaUrl,
                mediaType: mediaType,
                sender: senderNumber,
                deleteAfter: deleteAfterMins,
                forwardJid: forwardJid,
                forwardName: forwardName,
                forwardId: forwardId
              });

              const timeDiff = scheduledDate - new Date();
              const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
              const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
              const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
              let timeLeft = '';
              if (days > 0) timeLeft += `${days}d `;
              if (hours > 0) timeLeft += `${hours}h `;
              if (minutes > 0) timeLeft += `${minutes}m`;

              let successMsg = `✅ *SCHEDULED SUCCESSFULLY!*\n\n📅 *DATE/TIME (SL):* ${formatSriLankaTime(scheduledDate)}\n📤 *SEND TO:* ${toJid}\n💬 *MESSAGE:* ${txt}\n⏳ *REMAINING TIME:* ${timeLeft || 'NOW'}`;
              if (deleteAfterMins > 0) successMsg += `\n🗑️ *AUTO-DELETE:* ${deleteAfterMins} mins`;
              if (forwardJid) successMsg += `\n📢 *FORWARD FROM:* ${forwardName || forwardJid}`;
              successMsg += `\n🆔 *ID:* ${schedule._id}`;

              return await socket.sendMessage(from, { text: successMsg });
            } catch (e) {
              return await socket.sendMessage(from, { text: `❌ ERROR: ${e.message}` });
            }
          }

          if (sub === 'list') {
            const list = await listScheduledTasks(number);
            if (!list || list.length === 0) return await socket.sendMessage(from, { text: '📝 No scheduled messages found.' });
            let out = `📋 *SCHEDULED MESSAGES LIST (${list.length})*\n\n`;
            list.forEach((s, i) => {
              const status = s.status === 'completed' ? '✅ SENT' : (s.status === 'pending' ? '⏳ PENDING' : `❌ ${s.status.toUpperCase()}`);
              const time = s.fullDate ? formatSriLankaTime(new Date(s.fullDate)) : s.time;
              const timeLeftStr = s.fullDate && s.status === 'pending' ? `\n   ⏳ REMAINING: ${calculateTimeLeft(s.fullDate)}` : '';
              out += `${i + 1}. *${status}*\n   📅 ${time}${timeLeftStr}\n   📤 ${s.jid}\n   💬 ${s.content.substring(0, 50)}${s.content.length > 50 ? '...' : ''}\n   🆔 ${s._id}\n\n`;
            });
            return await socket.sendMessage(from, { text: out });
          }

          if (sub === 'del' || sub === 'remove') {
            const id = args[1];
            if (!id) return await socket.sendMessage(from, { text: 'Usage: .schedule del <id>' });
            try {
              await removeScheduledTask(id);
              return await socket.sendMessage(from, { text: '🗑️ Scheduled message removed successfully.' });
            } catch (e) {
              return await socket.sendMessage(from, { text: `❌ ERROR: ${e.message}` });
            }
          }

          if (sub === 'info' || sub === 'status1') {
            const list = await listScheduledTasks(number);
            const pending = list.filter(s => s.status === 'pending').length;
            const sent = list.filter(s => s.status === 'completed').length;
            const total = list.length;
            let info = `📊 *SCHEDULE STATUS*\n\n`;
            info += `📝 *TOTAL:* ${total}\n⏳ *PENDING:* ${pending}\n✅ *SENT:* ${sent}\n\n> *© ${botName}*`;
            return await socket.sendMessage(from, { text: info });
          }
        },

        // ⚙️ Media Settings / Widget
        mediaset: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: 'This command works only in groups.' });

          const sub = args[0];
          if (!sub) return await socket.sendMessage(from, { text: 'Usage: .mediaset widget on|off' });

          if (sub === 'widget') {
            const state = args[1];
            if (!state) return await socket.sendMessage(from, { text: 'Usage: .mediaset widget on|off' });
            const enabled = state === 'on';
            await setMediaSetting(from, { widgetMode: enabled, allowedMediaTypes: ['imageMessage', 'videoMessage'], warnOnBlock: true });
            return await socket.sendMessage(from, { text: `✅ Widget mode ${enabled ? 'enabled' : 'disabled'}!\n*Note:* Only admins can send media in widget mode. Non-admin media will be deleted.` });
          }

          if (sub === 'delete') {
            const which = args[1];
            if (!which) return await socket.sendMessage(from, { text: 'Usage: .mediaset delete photos|videos|all' });
            await socket.sendMessage(from, { text: `🗑️ Delete command received. This will attempt to remove recent ${which} if bot has permission.\n*Note:* Only works for media sent by non-admins.` });
            return;
          }
        },

        // 📢 Channel Management
        channel: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          const sub = args[0]?.toLowerCase();
          if (!sub) return await socket.sendMessage(from, { text: 'Usage: .channel info|follow|unfollow|mute|unmute <link or jid>' });

          let target = args[1];
          if (!target) return await socket.sendMessage(from, { text: `Usage: .channel ${sub} <link or jid>` });

          try {
            if (target.includes('whatsapp.com')) {
              const parts = target.split('/');
              const inviteCode = parts[parts.length - 1];
              target = await socket.newsletterMetadata("invite", inviteCode).then(m => m.id).catch(() => target);
            }
            if (!target.includes('@newsletter')) target += '@newsletter';

            if (sub === 'info') {
              const metadata = await socket.newsletterMetadata("id", target);
              const infoMsg = `📢 *Channel Info*\n\n*Name:* ${metadata.name}\n*Description:* ${metadata.description || 'None'}\n*Subscribers:* ${metadata.subscribers}\n*Status:* ${metadata.verification === 'VERIFIED' ? '✅ Verified' : 'Standard'}\n*Role:* ${metadata.viewer_metadata?.role || 'None'}`;
              return await socket.sendMessage(from, { text: infoMsg });
            } else if (sub === 'follow') {
              await socket.newsletterAction(target, 'follow');
              return await socket.sendMessage(from, { text: '✅ Successfully followed the channel!' });
            } else if (sub === 'unfollow') {
              await socket.newsletterAction(target, 'unfollow');
              return await socket.sendMessage(from, { text: '✅ Successfully unfollowed the channel!' });
            } else if (sub === 'mute') {
              await socket.newsletterAction(target, 'mute');
              return await socket.sendMessage(from, { text: '✅ Successfully muted the channel!' });
            } else if (sub === 'unmute') {
              await socket.newsletterAction(target, 'unmute');
              return await socket.sendMessage(from, { text: '✅ Successfully unmuted the channel!' });
            } else {
              return await socket.sendMessage(from, { text: '❌ Unknown subcommand. Use info, follow, unfollow, mute, unmute.' });
            }
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Error: ${e.message || 'Failed to execute channel command.'}` });
          }
        },

        // 📝 Join Requests
        requests: async ({ socket, from, args, isOwner, fetchGroupAdmins }) => {
          const sub = args[0]?.toLowerCase();
          if (!['list', 'approve', 'reject'].includes(sub)) {
            return await socket.sendMessage(from, { text: 'Usage: .requests <list|approve|reject> [number/all]' });
          }

          try {
            const res = await socket.groupRequestParticipantsList(from);
            if (!res || res.length === 0) return await socket.sendMessage(from, { text: 'No pending join requests.' });

            if (sub === 'list') {
              let txt = `📋 *Pending Requests (${res.length})*\n\n`;
              res.forEach((r, i) => { txt += `${i + 1}. @${r.jid.split('@')[0]}\n`; });
              return await socket.sendMessage(from, { text: txt, mentions: res.map(r => r.jid) });
            }

            let targets = [];
            if (args[1] === 'all') targets = res.map(r => r.jid);
            else {
              const num = args[1]?.replace(/[^0-9]/g, '');
              if (num) {
                const matched = res.find(r => r.jid.startsWith(num));
                if (matched) targets.push(matched.jid);
              }
            }

            if (targets.length === 0) return await socket.sendMessage(from, { text: '❌ Please specify a valid number from the list, or "all".' });

            const action = sub === 'approve' ? 'approve' : 'reject';
            await socket.groupRequestParticipantsUpdate(from, targets, action);
            return await socket.sendMessage(from, { text: `✅ Successfully ${action}d ${targets.length} request(s).` });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
        },

        // 🖼️ Set Group Profile Picture
        setppg: async ({ socket, from, msg, isOwner, fetchGroupAdmins }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted || !quoted.imageMessage) return await socket.sendMessage(from, { text: '❌ Reply to an image to set as group profile picture.' });

          try {
            const media = await downloadContentFromMessage(quoted.imageMessage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of media) buffer = Buffer.concat([buffer, chunk]);
            await socket.updateProfilePicture(from, buffer);
            return await socket.sendMessage(from, { text: '✅ Group profile picture updated successfully!' });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Failed to update profile picture: ${e.message}` });
          }
        },
        grouppp: async (opts) => await groupCommands.setppg(opts),

        // ⚙️ View Group Settings
        gsettings: async ({ socket, from, userConfig }) => {
          try {
            const meta = await socket.groupMetadata(from);
            const antiBadWord = await isBlacklistEnabled(from);
            const antiLink = await getAntiLinkSetting(from);
            const antiMedia = {
              sticker: await getGroupSetting(from, 'antiSticker', false),
              audio: await getGroupSetting(from, 'antiAudio', false),
              video: await getGroupSetting(from, 'antiVideo', false),
              image: await getGroupSetting(from, 'antiImage', false),
              doc: await getGroupSetting(from, 'antiDoc', false)
            };

            let txt = `⚙️ *GROUP SETTINGS (${meta.subject})*\n\n`;
            txt += `🔒 *Locked:* ${meta.announce ? 'Yes (Admins Only)' : 'No'}\n`;
            txt += `📝 *Edit Info:* ${meta.restrict ? 'Admins Only' : 'Everyone'}\n\n`;
            txt += `🚫 *Anti-Badword:* ${antiBadWord ? 'ON ✅' : 'OFF ❌'}\n`;
            txt += `🔗 *Anti-Link:* ${antiLink.enabled ? 'ON ✅' : 'OFF ❌'}\n\n`;
            txt += `🛡️ *Media Guards:*\n`;
            txt += `- Stickers: ${antiMedia.sticker ? 'BLOCKED ❌' : 'ALLOWED ✅'}\n`;
            txt += `- Audio: ${antiMedia.audio ? 'BLOCKED ❌' : 'ALLOWED ✅'}\n`;
            txt += `- Video: ${antiMedia.video ? 'BLOCKED ❌' : 'ALLOWED ✅'}\n`;
            txt += `- Image: ${antiMedia.image ? 'BLOCKED ❌' : 'ALLOWED ✅'}\n`;
            txt += `- Document: ${antiMedia.doc ? 'BLOCKED ❌' : 'ALLOWED ✅'}\n\n`;
            txt += `> *© ${userConfig.botName}*`;

            return await socket.sendMessage(from, { text: txt });
          } catch (e) {
            return await socket.sendMessage(from, { text: '❌ Failed to fetch settings.' });
          }
        },
        groupsettings: async (opts) => await groupCommands.gsettings(opts),

        // 🗑️ Delete Message
        del: async ({ socket, from, msg, isOwner, fetchGroupAdmins }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo;
          if (!quoted || !quoted.stanzaId) return await socket.sendMessage(from, { text: '❌ Reply to a message to delete it.' });

          try {
            const key = { remoteJid: from, id: quoted.stanzaId, participant: quoted.participant };
            await socket.sendMessage(from, { delete: key });
          } catch (e) {
            return await socket.sendMessage(from, { text: '❌ Failed to delete message. Bot might not be admin or the message is too old.' });
          }
        },
        delete: async (opts) => await groupCommands.del(opts),

        // ➕ Add Member
        add: async ({ socket, from, args, isOwner, fetchGroupAdmins }) => {

          const num = args[0]?.replace(/[^0-9]/g, '');
          if (!num) return await socket.sendMessage(from, { text: 'Usage: .add <number>' });

          try {
            const jid = `${num}@s.whatsapp.net`;
            const res = await socket.groupParticipantsUpdate(from, [jid], 'add');
            if (res[0]?.status === '200') {
              return await socket.sendMessage(from, { text: `✅ Successfully added @${num}`, mentions: [jid] });
            } else if (res[0]?.status === '403') {
              return await socket.sendMessage(from, { text: `❌ Failed to add. The user is private or requires an invite link.` });
            } else if (res[0]?.status === '409') {
              return await socket.sendMessage(from, { text: `❌ The user is already in the group.` });
            } else {
              return await socket.sendMessage(from, { text: `❌ Failed to add. Status: ${res[0]?.status}` });
            }
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
        },

        // 📌 Pin Message
        pin: async ({ socket, from, msg, isOwner, fetchGroupAdmins }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo;
          // fallback to standard quote
          const stanzaId = quoted?.stanzaId || msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
          const participant = quoted?.participant || msg.message?.extendedTextMessage?.contextInfo?.participant;
          if (!stanzaId) return await socket.sendMessage(from, { text: '❌ Reply to a message to pin it.' });

          try {
            const key = { remoteJid: from, id: stanzaId, participant: participant };
            await socket.sendMessage(from, { pin: key, type: 1 });
            return await socket.sendMessage(from, { text: '✅ Message pinned successfully!' });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Failed to pin message: ${e.message}` });
          }
        },

        // 📌 Unpin Message 
        unpin: async ({ socket, from, msg, isOwner, fetchGroupAdmins }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo;
          const stanzaId = quoted?.stanzaId || msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
          const participant = quoted?.participant || msg.message?.extendedTextMessage?.contextInfo?.participant;
          if (!stanzaId) return await socket.sendMessage(from, { text: '❌ Reply to a message to unpin it.' });

          try {
            const key = { remoteJid: from, id: stanzaId, participant: participant };
            await socket.sendMessage(from, { pin: key, type: 2 });
            return await socket.sendMessage(from, { text: '✅ Message unpinned successfully!' });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Failed to unpin message: ${e.message}` });
          }
        },

        // 🖼️ Get Group Image
        gimage: async ({ socket, from }) => {
          try {
            const url = await socket.profilePictureUrl(from, 'image');
            if (!url) return await socket.sendMessage(from, { text: '❌ This group does not have a profile picture.' });
            return await socket.sendMessage(from, { image: { url }, caption: '🖼️ Group Profile Picture' });
          } catch (e) {
            return await socket.sendMessage(from, { text: '❌ Could not fetch group profile picture.' });
          }
        },
        groupimage: async (opts) => await groupCommands.gimage(opts),

        // 💤 AFK
        afk: async ({ socket, from, args, senderNumber, userConfig }) => {
          const reason = args.join(' ') || 'AFK';
          await setGroupSetting(from, `afk_${senderNumber}`, { reason, time: Date.now() });
          return await socket.sendMessage(from, {
            text: `💤 *@${senderNumber}* is now AFK.\n📝 *Reason:* ${reason}`,
            mentions: [`${senderNumber}@s.whatsapp.net`]
          });
        },

        // 📇 Vcard
        vcard: async ({ socket, from, msg, args }) => {
          let target = msg.message?.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target) return await socket.sendMessage(from, { text: '❌ Reply to a user or provide a number to generate vcard.' });

          const num = target.split('@')[0];
          const vcard = `BEGIN:VCARD\nVERSION:3.0\nN:${num};;;;\nFN:${num}\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`;

          await socket.sendMessage(from, {
            contacts: {
              displayName: num,
              contacts: [{ vcard }]
            }
          });
        },

        // 🏓 Ping
        ping: async ({ socket, from, BOT_NAME_FANCY, activeSockets, senderNumber, number }) => {
          const start = Date.now();
          await socket.sendMessage(from, { text: '🏓 *Pong!* calculating...' });
          const end = Date.now();
          const responseTime = end - start;
          const uptime = process.uptime();
          const hours = Math.floor(uptime / 3600);
          const minutes = Math.floor((uptime % 3600) / 60);
          const seconds = Math.floor(uptime % 60);
          const pingMsg = `🏓 *Pong!*\n\n🤖 *Bot:* ${botName}\n⏱️ *Uptime:* ${hours}h ${minutes}m ${seconds}s\n⚡ *Response Time:* ${responseTime}ms\n🔢 *Active Sessions:* ${activeSockets ? activeSockets.size : 1}\n📊 *Memory Usage:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n⌚ *SRI LANKA TIME:* ${getSriLankaTimestamp()}`;
          await socket.sendMessage(from, { text: pingMsg });
        },

        // 🚫 Kick Participant
        kick: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, msg }) => {
          if (!from.endsWith('@g.us')) return;

          let target;
          if (msg.message.extendedTextMessage?.contextInfo?.participant) {
            target = msg.message.extendedTextMessage.contextInfo.participant;
          } else if (args[0]) {
            target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          }

          if (!target) return await socket.sendMessage(from, { text: '❌ Please reply to a message or provide a number to kick.' });

          try {
            await socket.groupParticipantsUpdate(from, [target], 'remove');
            await socket.sendMessage(from, { text: `✅ Successfully kicked @${target.split('@')[0]}`, mentions: [target] });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to kick: ${e.message}` });
          }
        },

        // 👑 Promote Participant
        promote: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, msg }) => {
          if (!from.endsWith('@g.us')) return;

          let target;
          if (msg.message.extendedTextMessage?.contextInfo?.participant) {
            target = msg.message.extendedTextMessage.contextInfo.participant;
          } else if (args[0]) {
            target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          }

          if (!target) return await socket.sendMessage(from, { text: '❌ Please reply to a message or provide a number to promote.' });

          try {
            await socket.groupParticipantsUpdate(from, [target], 'promote');
            await socket.sendMessage(from, { text: `✅ Successfully promoted @${target.split('@')[0]} to Admin`, mentions: [target] });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to promote: ${e.message}` });
          }
        },

        // 🧑‍💻 Demote Participant
        demote: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, msg }) => {
          if (!from.endsWith('@g.us')) return;

          let target;
          if (msg.message.extendedTextMessage?.contextInfo?.participant) {
            target = msg.message.extendedTextMessage.contextInfo.participant;
          } else if (args[0]) {
            target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          }

          if (!target) return await socket.sendMessage(from, { text: '❌ Please reply to a message or provide a number to demote.' });

          try {
            await socket.groupParticipantsUpdate(from, [target], 'demote');
            await socket.sendMessage(from, { text: `✅ Successfully demoted @${target.split('@')[0]} from Admin`, mentions: [target] });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to demote: ${e.message}` });
          }
        },

        // 🔒 Mute Group (Admins Only Can Send Messages)
        mute: async ({ socket, from, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          try {
            await socket.groupSettingUpdate(from, 'announcement');
            await socket.sendMessage(from, { text: '🔒 *Group successfully muted! Only admins can send messages now.*' });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to mute group: ${e.message}` });
          }
        },

        // 🔓 Unmute Group (Everyone Can Send Messages)
        unmute: async ({ socket, from, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          try {
            await socket.groupSettingUpdate(from, 'not_announcement');
            await socket.sendMessage(from, { text: '🔓 *Group successfully unmuted! Everyone can send messages now.*' });
            } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to unmute group: ${e.message}` });
          }
        },

        // 👻 Hide Tag (Mention all without text)
        hidetag: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          try {
            const meta = await socket.groupMetadata(from);
            const participants = meta.participants.map(p => p.id);
            const text = args.join(' ') || '';
            await socket.sendMessage(from, { text: text, mentions: participants });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to broadcast: ${e.message}` });
          }
        },

        // 📢 Tag All
        tagall: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          try {
            const meta = await socket.groupMetadata(from);
            const participants = meta.participants;
            let msg = args.join(' ') || 'Mention All';
            let users = participants.map(u => u.id);
            let text = `📢 *TAG ALL*\n\n*Message:* ${msg}\n\n`;
            for (let i of users) {
              text += ` @${i.split('@')[0]}\n`;
            }
            await socket.sendMessage(from, { text: text, mentions: users });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
        },

        // 🔗 Get Invite Link
        invite: async ({ socket, from, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          try {
            const code = await socket.groupInviteCode(from);
            await socket.sendMessage(from, { text: `https://chat.whatsapp.com/${code}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to get link: ${e.message}` });
          }
        },

        // 🔄 Revoke Link
        revoke: async ({ socket, from, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          try {
            await socket.groupRevokeInvite(from);
            await socket.sendMessage(from, { text: '✅ Group link successfully reset!' });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to reset link: ${e.message}` });
          }
        },

        // 🚪 Leave Group
        leave: async ({ socket, from, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          try {
            await socket.sendMessage(from, { text: '👋 Goodbye! Bot is leaving the group.' });
            await socket.groupLeave(from);
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to leave: ${e.message}` });
          }
        },

        // 📍 Set Group Name
        setname: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          const newName = args.join(' ');
          if (!newName) return await socket.sendMessage(from, { text: '❌ Please provide a new name.' });

          try {
            await socket.groupUpdateSubject(from, newName);
            await socket.sendMessage(from, { text: `✅ Group name updated to: ${newName}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to update name: ${e.message}` });
          }
        },

        // 📄 Set Group Description
        setdesc: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner }) => {
          if (!from.endsWith('@g.us')) return;

          const newDesc = args.join(' ');
          if (!newDesc) return await socket.sendMessage(from, { text: '❌ Please provide a new description.' });

          try {
            await socket.groupUpdateDescription(from, newDesc);
            await socket.sendMessage(from, { text: '✅ Group description updated successfully!' });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to update description: ${e.message}` });
          }
        },



        // 🛠️ Create Group
        creategroup: async ({ socket, from, args, isSenderOwner, sender }) => {

          let fullArgs = args.join(' ');
          let groupName, participants = [sender];

          if (fullArgs.includes('|')) {
            const parts = fullArgs.split('|');
            groupName = parts[0].trim();
            const numbers = parts[1].split(',').map(n => n.replace(/[^0-9]/g, '') + '@s.whatsapp.net').filter(n => n.length > 5);
            participants = [...new Set([sender, ...numbers])];
          } else {
            // Enhanced fallback parsing if | is not used
            const parsedNumbers = [];
            const nameParts = [];
            args.forEach(arg => {
              const cleanNum = arg.replace(/[^0-9]/g, '');
              // Simple heuristic to distinguish phone numbers from numeric group names
              if (cleanNum.length > 5 && cleanNum === arg) {
                parsedNumbers.push(cleanNum + '@s.whatsapp.net');
              } else {
                nameParts.push(arg);
              }
            });
            groupName = nameParts.join(' ').trim();
            if (parsedNumbers.length > 0) {
              participants = [...new Set([sender, ...parsedNumbers])];
            } else {
              groupName = fullArgs.trim();
            }
          }

          if (!groupName) return await socket.sendMessage(from, { text: '❌ Please provide a group name!\nUsage: .creategroup Name | 947xxx, 947yyy' });

          try {
            const group = await socket.groupCreate(groupName, participants);
            const code = await socket.groupInviteCode(group.id);
            const link = `https://chat.whatsapp.com/${code}`;

            let msg = `✅ *GROUP CREATED SUCCESSFULLY* ✅\n\n`;
            msg += `*NAME:* ${groupName}\n`;
            msg += `*ID:* ${group.id}\n`;
            msg += `*LINK:* ${link}\n`;
            msg += `*PARTICIPANTS:* ${participants.length}\n\n`;
            msg += `> *POWERED BY DARK_SHADOW_X-MD V1 🍃`;

            await socket.sendMessage(from, { text: msg });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to create group: ${e.message}` });
          }
        },
        cg: async (opts) => await groupCommands.creategroup(opts),

        // 🧪 Simulate Event (Join/Leave/Promote)
        simulate: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, sender }) => {
          const event = args[0]?.toLowerCase();
          if (!['join', 'add', 'left', 'remove', 'promote', 'demote'].includes(event)) {
            return await socket.sendMessage(from, { text: '❌ Usage: .simulate join/left/promote/demote' });
          }
          const participant = args[1] ? args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net' : sender;
          await socket.ev.emit('group-participants.update', {
            id: from,
            participants: [participant],
            action: event === 'join' || event === 'add' ? 'add' : (event === 'left' || event === 'remove' ? 'remove' : event)
          });
          await socket.sendMessage(from, { text: `✅ Simulation for *${event}* sent successfully!` });
        },

        // 👮 Tag Admins Only
        tagadmins: async ({ socket, from, isSenderGroupAdminFlag, isSenderOwner, getGroupAdmins }) => {
          const admins = await getGroupAdmins(socket, from);
          let text = `👮 *ADMINS CALLOUT* 👮\n\n`;
          admins.forEach(a => { text += `• @${a.split('@')[0]}\n`; });
          await socket.sendMessage(from, { text, mentions: admins });
        },

        // 🖼️ Set Group Profile Picture
        setpp: async ({ socket, from, isSenderGroupAdminFlag, isSenderOwner, msg }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted || !quoted.imageMessage) return await socket.sendMessage(from, { text: '❌ Please reply to an image with .setpp' });
          try {
            const media = await downloadQuotedMedia(quoted);
            await socket.updateProfilePicture(from, media.buffer);
            await socket.sendMessage(from, { text: '✅ Group profile picture updated successfully!' });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to update PP: ${e.message}` });
          }
        },

        // 📊 Enhanced Group Info
        groupinfo: async ({ socket, from }) => {
          if (!from.endsWith('@g.us')) return;
          try {
            const meta = await socket.groupMetadata(from);
            const admins = meta.participants.filter(p => !!p.admin).length;
            const creation = new Date(meta.creation * 1000).toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
            let text = `📊 *GROUP INFORMATION* 📊\n\n`;
            text += `*NAME:* ${meta.subject}\n`;
            text += `*ID:* ${meta.id}\n`;
            text += `*CREATOR:* @${meta.owner?.split('@')[0] || 'N/A'}\n`;
            text += `*CREATED ON:* ${creation}\n`;
            text += `*MEMBERS:* ${meta.participants.length}\n`;
            text += `*ADMINS:* ${admins}\n`;
            text += `*DESCRIPTION:* \n${meta.desc || 'No description set.'}\n\n`;
            text += `> *© ${botName}*`;
            await socket.sendMessage(from, { text, mentions: meta.owner ? [meta.owner] : [] });
          } catch (e) {
            await socket.sendMessage(from, { text: '❌ Error fetching metadata.' });
          }
        },

        // ⚠️ Warning System
        warn: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, msg, userConfig }) => {
          let target = msg.message.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target) return await socket.sendMessage(from, { text: '❌ Reply to a user or provide a number to warn.' });

          const reason = args.slice(target === args[0] ? 1 : 0).join(' ') || 'No reason provided';
          const warns = await getGroupSetting(from, `warns_${target}`, 0) + 1;
          await setGroupSetting(from, `warns_${target}`, warns);

          if (warns >= 3) {
            await socket.sendMessage(from, { text: `🚨 @${target.split('@')[0]} has reached 3/3 warnings and will be removed.`, mentions: [target] });
            await socket.groupParticipantsUpdate(from, [target], 'remove');
            await setGroupSetting(from, `warns_${target}`, 0);
          } else {
            const warnMsg = `⚠️ @${target.split('@')[0]} has been warned.\n*Reason:* ${reason}\n*Warnings:* ${warns}/3`;
            await socket.sendMessage(from, { text: formatMessage('⚠️ WARNING ISSUED', warnMsg, userConfig.botName), mentions: [target] });
          }
        },
        unwarn: async ({ socket, from, args, isSenderGroupAdminFlag, isSenderOwner, msg, userConfig }) => {
          let target = msg.message.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target) return await socket.sendMessage(from, { text: '❌ Reply to a user to unwarn.' });

          let warns = await getGroupSetting(from, `warns_${target}`, 0);
          if (warns > 0) warns--;
          await setGroupSetting(from, `warns_${target}`, warns);
          const unwarnMsg = `✅ Removed 1 warning from @${target.split('@')[0]}.\n*Remaining:* ${warns}/3`;
          await socket.sendMessage(from, { text: formatMessage('✅ WARNING REMOVED', unwarnMsg, userConfig.botName), mentions: [target] });
        },
        warns: async ({ socket, from, args, msg, userConfig }) => {
          let target = msg.message.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target) target = msg.key.participant || msg.participant;

          const warns = await getGroupSetting(from, `warns_${target}`, 0);
          await socket.sendMessage(from, { text: `👤 @${target.split('@')[0]} has *${warns}/3* warnings.`, mentions: [target] });
        },
        resetwarns: async (opts) => {
          return await opts.socket.sendMessage(opts.from, { text: '❌ Use .unwarn to remove individual warnings.' });
        },

        // Aliases for Menu Consistency
        setwelcome: async (opts) => await groupCommands.welcome(opts),
        setleft: async (opts) => await groupCommands.left(opts),

        // 🌍 Join Group via Link
        join: async ({ socket, from, args, isSenderOwner }) => {
          const link = args[0];
          if (!link || !link.includes('chat.whatsapp.com/')) {
            return await socket.sendMessage(from, { text: 'Usage: .join <whatsapp_group_link>' });
          }
          try {
            const code = link.split('chat.whatsapp.com/')[1].split(' ')[0];
            await socket.groupAcceptInvite(code);
            return await socket.sendMessage(from, { text: '✅ Successfully joined the group!' });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Failed to join group: ${e.message}` });
          }
        },

        // 🧹 Clear Chat (Local to Bot)
        clearchat: async ({ socket, from, isSenderOwner }) => {
          try {
            await socket.chatModify({ delete: true, lastMessages: [{ key: { remoteJid: from, id: '', participant: '' }, messageTimestamp: Date.now() / 1000 }] }, from);
            return await socket.sendMessage(from, { text: '✅ Chat cleared for the bot.' });
          } catch (e) {
            // Ignore fetch errors if any
            return await socket.sendMessage(from, { text: '✅ Chat cleared process initiated.' });
          }
        },

        // 🤖 Kick All Bots
        kickbots: async ({ socket, from, isOwner, fetchGroupAdmins, getGroupAdmins }) => {

          try {
            const meta = await socket.groupMetadata(from);
            const admins = await getGroupAdmins(socket, from);
            const allMembers = meta.participants.map(p => p.id);
            const botNumber = socket.user.id.split(':')[0] + '@s.whatsapp.net';

            let potentialBots = [];
            // A naive but common approach: numbers starting with 1, 44, or having certain patterns, or just we can't reliably detect bots.
            // Better approach: detect by checking if they are non-human typical WhatsApp Business Accounts if possible, or just skip if we can't.
            // Actually, let's just warn that this is a beta feature.
            return await socket.sendMessage(from, { text: '⚠️ .kickbots relies on heuristics and is currently disabled to prevent accidental kicks of business accounts.' });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
        },

        // 🛡️ Anti-Bot Guard Toggle
        antibot: async ({ socket, from, args, isOwner, fetchGroupAdmins }) => {
          const sub = args[0]?.toLowerCase();
          if (!['on', 'off'].includes(sub)) return await socket.sendMessage(from, { text: 'Usage: .antibot on|off' });

          const state = sub === 'on';
          await setGroupSetting(from, 'antiBot', state);
          return await socket.sendMessage(from, { text: `✅ Anti-Bot system is now ${state ? 'ON' : 'OFF'}.\n*Note:* The bot must be an admin to kick other bots.` });
        },

        // 🌍 Anti-Fake (Foreign Numbers) Toggle
        antifake: async ({ socket, from, args, isOwner, fetchGroupAdmins }) => {
          const sub = args[0]?.toLowerCase();
          if (!['on', 'off'].includes(sub)) return await socket.sendMessage(from, { text: 'Usage: .antifake on|off\n(Kicks numbers starting with +1, +44, etc. allowed prefixes: 94)' });

          const state = sub === 'on';
          await setGroupSetting(from, 'antiFake', state);
          return await socket.sendMessage(from, { text: `✅ Anti-Fake system is now ${state ? 'ON' : 'OFF'}.\n*Note:* The bot must be an admin to remove fake numbers.` });
        },

        // 🖼️ Auto Sticker Toggle
        autosticker: async ({ socket, from, args, isOwner, fetchGroupAdmins }) => {
          const sub = args[0]?.toLowerCase();
          if (!['on', 'off'].includes(sub)) return await socket.sendMessage(from, { text: 'Usage: .autosticker on|off' });

          const state = sub === 'on';
          await setGroupSetting(from, 'autoSticker', state);
          return await socket.sendMessage(from, { text: `✅ Auto-Sticker is now ${state ? 'ON' : 'OFF'}.\nAll images sent in this group will be converted to stickers automatically.` });
        },

        // 👋 Welcome Message Config
        welcome: async ({ socket, from, args, isOwner, fetchGroupAdmins }) => {
          const sub = args[0]?.toLowerCase();

          if (sub === 'on') {
            await setGroupSetting(from, 'welcomeEnabled', true);
            return await socket.sendMessage(from, { text: '✅ Welcome messages enabled.' });
          } else if (sub === 'off') {
            await setGroupSetting(from, 'welcomeEnabled', false);
            return await socket.sendMessage(from, { text: '❌ Welcome messages disabled.' });
          } else if (sub === 'set') {
            const text = args.slice(1).join(' ');
            if (!text) return await socket.sendMessage(from, { text: 'Usage: .welcome set <message>\nPlaceholders: &name, &groupname, &members, &desc' });
            await setGroupSetting(from, 'welcomeMessage', text);
            return await socket.sendMessage(from, { text: '✅ Welcome message updated!' });
          } else {
            return await socket.sendMessage(from, { text: 'Usage: .welcome <on|off|set>' });
          }
        },

        // 👋 Left Message Config
        left: async ({ socket, from, args, isOwner, fetchGroupAdmins }) => {
          const sub = args[0]?.toLowerCase();

          if (sub === 'on') {
            await setGroupSetting(from, 'leftEnabled', true);
            return await socket.sendMessage(from, { text: '✅ Goodbye messages enabled.' });
          } else if (sub === 'off') {
            await setGroupSetting(from, 'leftEnabled', false);
            return await socket.sendMessage(from, { text: '❌ Goodbye messages disabled.' });
          } else if (sub === 'set') {
            const text = args.slice(1).join(' ');
            if (!text) return await socket.sendMessage(from, { text: 'Usage: .left set <message>\nPlaceholders: &name, &groupname, &members, &desc' });
            await setGroupSetting(from, 'leftMessage', text);
            return await socket.sendMessage(from, { text: '✅ Goodbye message updated!' });
          } else {
            return await socket.sendMessage(from, { text: 'Usage: .left <on|off|set>' });
          }
        },

        // 📊 Create Poll
        poll: async ({ socket, from, args }) => {
          const input = args.join(' ');
          if (!input.includes('|')) return await socket.sendMessage(from, { text: 'Usage: .poll Question | Option1 | Option2 | ...' });

          const parts = input.split('|').map(s => s.trim()).filter(s => s.length > 0);
          if (parts.length < 3) return await socket.sendMessage(from, { text: '❌ Please provide a question and at least two options.' });

          const question = parts[0];
          const options = parts.slice(1);

          if (options.length > 12) return await socket.sendMessage(from, { text: '❌ Maximum 12 options allowed.' });

          try {
            await socket.sendMessage(from, {
              poll: {
                name: question,
                values: options,
                selectableCount: 1
              }
            });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Failed to create poll: ${e.message}` });
          }
        },

        // 👮 Admins
        admins: async (opts) => await groupCommands.admininfo(opts),

        antispam: async ({ socket, from, args, userConfig, fetchGroupAdmins }) => {
          const sub = args[0]?.toLowerCase();
          const currentStatus = await getGroupSetting(from, 'antiSpamEnabled', false);

          if (!sub) return await socket.sendMessage(from, { text: `🛡️ *Anti-Spam* is currently ${currentStatus ? 'ON ✅' : 'OFF ❌'}\n\n*Usage:* .antispam on|off` });

          if (!['on', 'off'].includes(sub)) return await socket.sendMessage(from, { text: '❌ Usage: .antispam on|off' });

          const state = sub === 'on';
          await setGroupSetting(from, 'antiSpamEnabled', state);
          return await socket.sendMessage(from, { text: `✅ Anti-Spam has been turned *${state ? 'ON' : 'OFF'}* for this group.` });
        },

        // 📊 Top Members
        topmembers: async ({ socket, from, botName }) => {
          if (!from.endsWith('@g.us')) return await socket.sendMessage(from, { text: '❌ This command works only in groups.' });
          try {
            const statsCol = mongoDB.collection('group_stats');
            const top = await statsCol.find({ jid: from }).sort({ messageCount: -1 }).limit(10).toArray();
            if (top.length === 0) return await socket.sendMessage(from, { text: 'No stats available yet.' });

            let text = `🏆 *TOP 10 ACTIVE MEMBERS* 🏆\n\n`;
            let mentions = [];
            top.forEach((u, i) => {
              text += `${i + 1}. @${u.participant.split('@')[0]} - ${u.messageCount} msgs\n`;
              mentions.push(u.participant);
            });
            text += `\n> *© ${botName}*`;
            await socket.sendMessage(from, { text, mentions });
          } catch (e) {
            await socket.sendMessage(from, { text: '❌ Error fetching stats.' });
          }
        },

        // 🔍 Inspect Chat/User
        inspect: async ({ socket, from, args, msg }) => {
          let target = msg.message?.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) {
            if (args[0].includes('@')) target = args[0];
            else target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          }
          if (!target) target = from;

          try {
            if (target.endsWith('@g.us')) {
              const meta = await socket.groupMetadata(target);
              const creation = new Date(meta.creation * 1000).toLocaleString('en-US', { timeZone: 'Asia/Colombo' });
              let text = `🔍 *GROUP INSPECTOR*\n\n`;
              text += `*Name:* ${meta.subject}\n`;
              text += `*ID:* ${meta.id}\n`;
              text += `*Members:* ${meta.participants.length}\n`;
              text += `*Created:* ${creation}\n`;
              text += `*Owner:* @${meta.owner?.split('@')[0] || 'N/A'}\n`;
              text += `*Desc:* \n${meta.desc || 'None'}`;
              return await socket.sendMessage(from, { text, mentions: meta.owner ? [meta.owner] : [] });
            } else {
              const bio = await socket.fetchStatus(target).catch(() => ({ status: 'N/A' }));
              let text = `🔍 *USER INSPECTOR*\n\n`;
              text += `*Number:* ${target.split('@')[0]}\n`;
              text += `*Bio:* ${bio.status}\n`;
              text += `*JID:* ${target}`;
              return await socket.sendMessage(from, { text });
            }
          } catch (e) { return await socket.sendMessage(from, { text: `❌ Inspection failed: ${e.message}` }); }
        },

        // 🔗 JID Alias
        gjid: async (opts) => await groupCommands.jid(opts),

        // 🧮 Calculator
        calc: async ({ socket, from, args }) => {
          const expr = args.join(' ');
          if (!expr) return await socket.sendMessage(from, { text: 'Usage: .calc 5 + 5' });
          try {
            const result = eval(expr.replace(/[^-+*/%0-9().]/g, ''));
            await socket.sendMessage(from, { text: `🧮 *Result:* ${result}` });
          } catch (e) { await socket.sendMessage(from, { text: '❌ Invalid expression or evaluation error.' }); }
        },

        // 👤 User Info
        userinfo: async ({ socket, from, args, msg, botName, sender }) => {
          let target = msg.message?.extendedTextMessage?.contextInfo?.participant;
          if (!target && args[0]) target = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
          if (!target) target = msg.key.participant || msg.participant || sender;

          try {
            const bio = await socket.fetchStatus(target).catch(() => ({ status: 'N/A' }));
            const statsCol = mongoDB.collection('group_stats');
            const stats = await statsCol.findOne({ participant: target, jid: from });

            let text = `👤 *USER INFORMATION* 👤\n\n`;
            text += `*NAME:* @${target.split('@')[0]}\n`;
            text += `*BIO:* ${bio.status}\n`;
            text += `*JID:* ${target}\n`;
            text += `*MESSAGES (Group):* ${stats?.messageCount || 0}\n\n`;
            text += `> *© ${botName}*`;
            await socket.sendMessage(from, { text, mentions: [target] });
          } catch (e) { await socket.sendMessage(from, { text: '❌ Error fetching user info.' }); }
        },

        // 🖼️ Sticker Creator
        sticker: async ({ socket, from, msg, downloadQuotedMedia }) => {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quoted) return await socket.sendMessage(from, { text: '❌ Reply to an image or video to make a sticker.' });
          try {
            const media = await downloadQuotedMedia(quoted);
            if (!media) return await socket.sendMessage(from, { text: '❌ Could not download media.' });
            await socket.sendMessage(from, { sticker: media.buffer });
          } catch (e) { await socket.sendMessage(from, { text: `❌ Failed: ${e.message}` }); }
        },

        // 👤 Me Alias
        me: async (opts) => await groupCommands.userinfo(opts),

        // ⌨️ Cmd Help
        cmd: async ({ socket, from, args, prefix }) => {
          const q = args[0]?.toLowerCase();
          if (!q) return await socket.sendMessage(from, { text: `Usage: ${prefix}cmd <command_name>` });
          await socket.sendMessage(from, { text: `📌 *Command:* ${q}\n*Status:* Available\n*Type:* System Command\n\nUse ${prefix}menu to see all commands.` });
        },

        // 🇱🇰 Sinhala Commands
        danan: async ({ socket, from }) => await socket.sendMessage(from, { text: '👋 *Dapan Dapan!* (Put it!)' }),
        scoli: async ({ socket, from }) => await socket.sendMessage(from, { text: '🎓 *School Mode:* Information system is active!' }),
        mida: async (opts) => await groupCommands.mediaset(opts),
        cms: async (opts) => await groupCommands.gsettings(opts),
        epa: async ({ socket, from, botName }) => {
          await setGroupSetting(from, 'antiLink', false);
          await setGroupSetting(from, 'antiBadWord', false);
          await setGroupSetting(from, 'antiSpamEnabled', false);
          await socket.sendMessage(from, { text: `🚫 *EPA!* (Stop!)\n\nAll security guards (Anti-Link, Anti-Badword, Anti-Spam) have been disabled for this group.\n\n> *© ${botName}*` });
        },
        bn: async (opts) => await groupCommands.kick(opts),
        voicetag: async ({ socket, from, args, number }) => {
          const text = args.join(' ');
          if (!text) return await socket.sendMessage(from, { text: '❌ Usage: .voicetag <text>' });
          const cfg = await loadUserConfigFromMongo(number, true) || {};
          cfg.VOICE_TAG = text;
          await setUserConfigInMongo(number, cfg);
          const updatedCfg = await loadUserConfigFromMongo(number, true);
          const currentTag = updatedCfg.voiceTag || 'Not set';
          await socket.sendMessage(from, { text: `✅ Voice tag updated!\n📝 *New Tag:* ${text}\n🤖 *Current Effective Tag:* ${currentTag}` });
        },
        resettag: async ({ socket, from, number }) => {
          const cfg = await loadUserConfigFromMongo(number, true) || {};
          delete cfg.VOICE_TAG;
          delete cfg.voiceTag;
          delete cfg.voicetag;
          await setUserConfigInMongo(number, cfg);
          await socket.sendMessage(from, { text: '✅ Voice tag reset to default: *Powered by DARK_SHADOW_X-MD V1 🍃*' });
        },

      };




      if (groupCommands[command]) {
        const { isAdmin: currentIsAdmin, isBotAdmin: currentIsBotAdmin, groupMetadata: currentMeta } = isGroup ? await fetchGroupAdmins() : { isAdmin: false, isBotAdmin: false, groupMetadata: null };
        const getGroupAdmins = async () => {
          if (!isGroup) return [];
          if (currentMeta) return currentMeta.participants.filter(p => !!p.admin).map(p => p.id);
          try {
            const meta = await socket.groupMetadata(from);
            return meta.participants.filter(p => !!p.admin).map(p => p.id);
          } catch (e) { return []; }
        };

        await groupCommands[command]({
          socket, from, args, sender, msg, isSenderGroupAdminFlag: currentIsAdmin, isSenderOwner: isOwner,
          isBotAdmin: currentIsBotAdmin,
          prefix, number: sanitizedNum, senderNumber, isGroup, config, botName,
          userConfig,
          getGroupAdmins, fetchGroupAdmins, loadAdminsFromMongo, addAdminToMongo, removeAdminFromMongo, activeSockets,
          downloadQuotedMedia
        });
        return;
      }
      // ----------------------------------------------

      switch (command) {
        // -------------------------------------------------------------------------
        // GOOGLE CONTACTS COMMANDS
        // -------------------------------------------------------------------------
        case 'contacts': {
          if (!isOwner) return;
          try {
            const data = await listGoogleContacts(sanitizedNum);
            if (!data.connections || data.connections.length === 0) {
              return await socket.sendMessage(from, { text: formatMessage('📔 GOOGLE CONTACTS', 'No contacts found.', botName) });
            }
            const list = data.connections.map(c => {
              const name = c.names?.[0]?.displayName || 'Unknown';
              const phone = c.phoneNumbers?.[0]?.value || 'No Number';
              return `👤 ${name}\n📞 ${phone}`;
            }).join('\n\n');
            await socket.sendMessage(from, { text: formatMessage('📔 GOOGLE CONTACTS', `*Top Contacts:*\n\n${list}`, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.message, botName) });
          }
          break;
        }

        case 'groups': {
          if (!isOwner) return;
          try {
            const data = await listGoogleContactGroups(sanitizedNum);
            if (!data.contactGroups || data.contactGroups.length === 0) {
              return await socket.sendMessage(from, { text: formatMessage('📁 CONTACT GROUPS', 'No groups found.', botName) });
            }
            const list = data.contactGroups.map(g => `📁 ${g.formattedName} (${g.memberCount || 0})`).join('\n');
            await socket.sendMessage(from, { text: formatMessage('📁 CONTACT GROUPS', `*Your Groups:*\n\n${list}`, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.message, botName) });
          }
          break;
        }

        case 'syncothers': {
          if (!isOwner) return;
          await socket.sendMessage(from, { text: formatMessage('🔄 SYNCING', 'Contact synchronization started. Please wait...', botName) });
          try {
            const res = await syncOtherContactsToMyContacts(sanitizedNum);
            await socket.sendMessage(from, { text: formatMessage('✅ SYNC COMPLETE', `Successfully synced ${res.count} contacts to "My Contacts".`, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.message, botName) });
          }
          break;
        }

        case 'savecur': {
          if (!isOwner) return;
          if (isGroup) return await socket.sendMessage(from, { text: formatMessage('⚠️ NOTICE', 'This command only works in private chat.', botName) });
          if (!text) return await socket.sendMessage(from, { text: formatMessage('⚠️ NOTICE', 'Please provide a name. Example: .savecur My Friend', botName) });

          const pushName = text.trim();
          const senderNumber = from.split('@')[0];

          try {
            await createGoogleContact(sanitizedNum, pushName, senderNumber);
            await socket.sendMessage(from, { text: formatMessage('✅ SAVED', `Successfully saved *${pushName}* to Google Contacts.`, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.response?.data?.error?.message || e.message, botName) });
          }
          break;
        }

        case 'authgoogle': {
          if (!isOwner) return;
          const authUrl = generateGoogleAuthUrl(sanitizedNum);
          const authMsg = `*🔐 GOOGLE AUTHENTICATION*\n\nTo manage your contacts, please authorize the bot by clicking the link below:\n\n🔗 ${authUrl}\n\n*Note:* After authorizing, you will be redirected to a success page.`;
          await socket.sendMessage(from, { text: formatMessage('🔐 GOOGLE AUTH', authMsg, botName) });
          break;
        }

        case 'chatjid': {
          const rawJid = msg.key.remoteJid;
          const resolvedJid = from;
          const info = `*╭─────────────────────────╮*
*        🔗 CHAT JID INFO          *
*╰─────────────────────────╯*

📂 *Raw JID:* 
\`${rawJid}\`

✅ *Resolved JID:* 
\`${resolvedJid}\`

*━━━━━━━━━━━━━━━━━━━━━━━━━*
> *Note:* Resolved JID shows the standard @s.whatsapp.net format.`;
          await socket.sendMessage(from, { text: info });
          break;
        }

        case 'addcontact': {
          if (!isOwner) return;
          if (!text.includes('|')) return await socket.sendMessage(from, { text: formatMessage('⚠️ NOTICE', 'Usage: .addcontact Name | Number', botName) });
          const [name, phone] = text.split('|').map(s => s.trim());
          try {
            await createGoogleContact(sanitizedNum, name, phone);
            await socket.sendMessage(from, { text: formatMessage('✅ CONTACT ADDED', `Successfully added *${name}* (${phone}) to Google Contacts.`, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.response?.data?.error?.message || e.message, botName) });
          }
          break;
        }

        case 'searchcontact': {
          if (!isOwner) return;
          if (!text) return await socket.sendMessage(from, { text: formatMessage('⚠️ NOTICE', 'Usage: .searchcontact Name/Number', botName) });
          try {
            const data = await searchGoogleContacts(sanitizedNum, text);
            if (!data.results || data.results.length === 0) {
              return await socket.sendMessage(from, { text: formatMessage('🔍 SEARCH RESULTS', 'No contacts found.', botName) });
            }
            const list = data.results.map(r => {
              const c = r.person;
              const name = c.names?.[0]?.displayName || 'Unknown';
              const phone = c.phoneNumbers?.[0]?.value || 'No Number';
              const resName = c.resourceName;
              return `👤 *${name}*\n📞 ${phone}\n🆔 \`${resName}\``;
            }).join('\n\n');
            await socket.sendMessage(from, { text: formatMessage('🔍 SEARCH RESULTS', list, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.response?.data?.error?.message || e.message, botName) });
          }
          break;
        }

        case 'delcontact': {
          if (!isOwner) return;
          if (!text) return await socket.sendMessage(from, { text: formatMessage('⚠️ NOTICE', 'Usage: .delcontact people/c123456789 (Use ID from search)', botName) });
          try {
            await deleteGoogleContact(sanitizedNum, text);
            await socket.sendMessage(from, { text: formatMessage('🗑️ CONTACT DELETED', `Successfully deleted contact: ${text}`, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.response?.data?.error?.message || e.message, botName) });
          }
          break;
        }

        case 'updatecontact': {
          if (!isOwner) return;
          if (!text.includes('|')) return await socket.sendMessage(from, { text: formatMessage('⚠️ NOTICE', 'Usage: .updatecontact ID | New Name', botName) });
          const [resName, newName] = text.split('|').map(s => s.trim());
          try {
            await updateGoogleContact(sanitizedNum, resName, newName);
            await socket.sendMessage(from, { text: formatMessage('📝 CONTACT UPDATED', `Successfully updated contact to *${newName}*.`, botName) });
          } catch (e) {
            await socket.sendMessage(from, { text: formatMessage('❌ ERROR', e.response?.data?.error?.message || e.message, botName) });
          }
          break;
        }

        // -------------------------------------------------------------------------
        // JID INFORMATION COMMAND
        // -------------------------------------------------------------------------
        case 'cjid': {
          let quotedJid = msg.message?.extendedTextMessage?.contextInfo?.participant || msg.message?.extendedTextMessage?.contextInfo?.remoteJid || 'None';
          let senderJid = await resolveJidGlobal(sender);
          let chatJid = await resolveJidGlobal(from);
          quotedJid = await resolveJidGlobal(quotedJid);

          let info = `*🎯 JID INFORMATION*\n\n`;
          info += `*📍 Current Chat:* \`${chatJid}\`\n`;
          info += `*👤 Sender:* \`${senderJid}\`\n`;
          info += `*💬 Quoted:* \`${quotedJid}\`\n\n`;

          info += `*📚 JID GUIDE*\n`;
          info += `• *Personal:* [number]@s.whatsapp.net\n`;
          info += `• *Groups:* [id]@g.us\n`;
          info += `• *Broadcast:* [timestamp]@broadcast\n`;
          info += `• *Status:* status@broadcast\n`;
          info += `• *Newsletters:* [id]@newsletter\n`;
          info += `• *Linked IDs:* [id]@lid (Resolved when possible)\n\n`;

          info += `> *© ${botName}*`;

          await socket.sendMessage(from, { text: info }, { quoted: msg });
          break;
        }

        case 'menu':
        case 'help': {
          const now = getSriLankaDateTime();
          const hr = now.hour();
          const greeting = hr >= 5 && hr < 12 ? "ᴳᵒᵒᵈ ᴹᵒʳⁿⁱⁿᵍ ☕" : (hr >= 12 && hr < 18 ? "ᴳᵒᵒᵈ ᴬᶠᵗᵉʳᴺᵒᵒⁿ 🌤️" : (hr >= 18 && hr < 22 ? "ᴳᵒᵒᵈ ᴱᵛᴱᴺᴵᴺᶳ 🌆" : "ᴳᵒᵒᵈ ᴺⁱᵍʰᵗ 🌙"));

          const menuText = `*${greeting}* @${senderNumber}\n\n` +
            `*╔════───────────═══╗*\n` +
            `*   ${botName.toUpperCase()} V1 PREMIUM   *\n` +
            `*╚════───────────═══╝*\n\n` +
            `*🚀 CORE SYSTEM*\n` +
            `• ${prefix}alive - Bot status\n` +
            `• ${prefix}ping - Latency test\n` +
            `• ${prefix}uptime - Bot runtime\n` +
            `• ${prefix}owner - Owner contact\n` +
            `• ${prefix}pair - Link session\n` +
            `• ${prefix}me / ${prefix}userinfo - Your stats\n` +
            `• ${prefix}inspect - Chat/User info\n` +
            `• ${prefix}jid / ${prefix}gjid - Get JID\n` +
            `• ${prefix}cjid / ${prefix}chatjid - Resolve JID\n` +
            `• ${prefix}cmd - Command info\n\n` +
            `*🛡️ SECURITY & PROTECTION*\n` +
            `• ${prefix}antilink [on/off]\n` +
            `• ${prefix}antidelete [on/off]\n` +
            `• ${prefix}antibadword [on/off]\n` +
            `• ${prefix}antispam [on/off]\n` +
            `• ${prefix}antibot [on/off]\n` +
            `• ${prefix}antifake [on/off]\n` +
            `• ${prefix}onceview [on/off]\n` +
            `• ${prefix}warn / ${prefix}unwarn / ${prefix}warns\n` +
            `• ${prefix}mediaset - Media guard\n` +
            `• ${prefix}blacklist - Word filter\n` +
            `• ${prefix}epa - Emergency stop\n\n` +
            `*👥 GROUP MANAGEMENT*\n` +
            `• ${prefix}kick / ${prefix}add / ${prefix}leave\n` +
            `• ${prefix}promote / ${prefix}demote\n` +
            `• ${prefix}mute / ${prefix}unmute\n` +
            `• ${prefix}tagall / ${prefix}hidetag\n` +
            `• ${prefix}tagadmins / ${prefix}admins\n` +
            `• ${prefix}invite / ${prefix}revoke\n` +
            `• ${prefix}setname / ${prefix}setdesc\n` +
            `• ${prefix}setpp / ${prefix}grouppp\n` +
            `• ${prefix}cg / ${prefix}creategroup\n` +
            `• ${prefix}group [open/close]\n` +
            `• ${prefix}gsettings / ${prefix}requests\n` +
            `• ${prefix}pin / ${prefix}unpin / ${prefix}del\n` +
            `• ${prefix}gimage / ${prefix}topmembers / ${prefix}gstatus / ${prefix}gmstatus / ${prefix}amstatus\n` +
            `• ${prefix}ephemeral [1d/7d/90d/off]\n` +
            `• ${prefix}glist / ${prefix}members / ${prefix}gtag\n\n` +
            `*📔 GOOGLE CONTACTS*\n` +
            `• ${prefix}authgoogle - Authorize\n` +
            `• ${prefix}contacts / ${prefix}groups\n` +
            `• ${prefix}savecur / ${prefix}addcontact\n` +
            `• ${prefix}searchcontact / ${prefix}delcontact\n` +
            `• ${prefix}updatecontact / ${prefix}syncothers\n\n` +
            `*🎬 STATUS AUTOMATION*\n` +
            `• ${prefix}sv [on/off] - Auto View\n` +
            `• ${prefix}sl [on/off] - Auto Like\n` +
            `• ${prefix}sr [on/off] - Auto Reply\n` +
            `• ${prefix}tstatus [text] - Post Personal Text\n` +
            `• ${prefix}mstatus [reply] - Post Personal Media\n` +
            `• ${prefix}addsr / ${prefix}listsr / ${prefix}delsr\n` +
            `• ${prefix}setstatus - Auto post\n` +
            `• ${prefix}status - Manual post\n\n` +
            `*📢 NEWSLETTER & CHANNEL*\n` +
            `• ${prefix}ncreate / ${prefix}ndelete\n` +
            `• ${prefix}ninfo / ${prefix}nupdate / ${prefix}nlink\n` +
            `• ${prefix}nfollow / ${prefix}nunfollow\n` +
            `• ${prefix}nmute / ${prefix}nunmute\n` +
            `• ${prefix}nreact / ${prefix}nreactmsg / ${prefix}nreactlist / ${prefix}nreactdel\n` +
            `• ${prefix}nadmins / ${prefix}nowner / ${prefix}npromote\n` +
            `• ${prefix}cfn / ${prefix}chr / ${prefix}cid / ${prefix}newslist\n` +
            `• ${prefix}channel [follow/mute/info]\n` +
            `• ${prefix}nadminlist / ${prefix}nfollowing\n` +
            `• ${prefix}nsearch / ${prefix}nsub / ${prefix}nmode\n` +
            `• ${prefix}nmessages / ${prefix}nupdates\n` +
            `• ${prefix}nblocks / ${prefix}nfakeinfo\n` +
            `• ${prefix}inf / ${prefix}cinfo / ${prefix}news / ${prefix}forward\n\n` +
            `*⏰ AUTOMATION SERVICE*\n` +
            `• ${prefix}schedule / ${prefix}slist\n` +
            `• ${prefix}c2cs - Repost with timer\n` +
            `• ${prefix}spoll - Scheduled poll\n` +
            `• ${prefix}crecur - Daily recurring post\n` +
            `• ${prefix}cclean - Batch channel clean\n` +
            `• ${prefix}autobio - Dynamic system\n` +
            `• ${prefix}cbroadcast - Mass news\n` +
            `• ${prefix}poll / ${prefix}vcard / ${prefix}afk\n\n` +
            `*🧪 UTILITIES & FUN*\n` +
            `• ${prefix}sticker / ${prefix}autosticker\n` +
            `• ${prefix}calc / ${prefix}note / ${prefix}get\n` +
            `• ${prefix}filter / ${prefix}reply / ${prefix}match\n` +
            `• ${prefix}csong / ${prefix}cvideo / ${prefix}cimg\n` +
            `• ${prefix}ctxt / ${prefix}cdoc / ${prefix}csend\n` +
            `• ${prefix}react [emoji] / ${prefix}nsave / ${prefix}save\n\n` +
            `*🤖 MISC & SETTINGS*\n` +
            `• ${prefix}nick / ${prefix}bio / ${prefix}set\n` +
            `• ${prefix}setwelcome / ${prefix}setleft\n` +
            `• ${prefix}setdbpw / ${prefix}getdbpw\n` +
            `• ${prefix}setnews / ${prefix}setwall\n` +
            `• ${prefix}setcsong / ${prefix}setcvideo\n` +
            `• ${prefix}clean / ${prefix}ping / ${prefix}uptime\n\n` +
            `> *© ${botName}*`;

          try {
            const buf = fs.readFileSync(config.IMAGE_PATH || './logo.png');
            await socket.sendMessage(from, { image: buf, caption: menuText }, { quoted: msg });
          } catch (e) {
            await socket.sendMessage(from, { text: menuText }, { quoted: msg });
          }
          break;
        }

        case 'owner': {
          const ownerMsg = `*👑 DARK_SHADOW_X-MD V1 🍃 BOT OWNER*\n\n` +
            `*▫️ Name:* ${config.OWNER_NAME}\n` +
            `*▫️ Number:* ${config.OWNER_NUMBER}\n` +
            `*▫️ Email:* ${config.OWNER_EMAIL}\n` +
            `*▫️ Channel:* ${config.CHANNEL_LINK}\n\n` +
            `> *© ${botName}*`;
          try {
            const buf = fs.readFileSync(config.IMAGE_PATH || './logo.png');
            await socket.sendMessage(from, { image: buf, caption: ownerMsg });
          } catch (e) {
            await socket.sendMessage(from, { text: ownerMsg });
          }
          break;
        }


        case 'setdbpw': {
          const newPw = args[0]?.trim();
          if (!newPw) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}setdbpw <new_password>` });

          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.DASHBOARD_PASSWORD = newPw;
          await setUserConfigInMongo(sanitizedNum, cfg);

          await socket.sendMessage(from, { text: `✅ *Dashboard Password Updated!*\n\n*New Password:* ${newPw}\n\n_Keep this password secure!_` }, { quoted: msg });
          break;
        }

        case 'getdbpw': {
          const cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          const pw = cfg.DASHBOARD_PASSWORD || config.DASHBOARD_PASSWORD;
          await socket.sendMessage(from, { text: `🔑 *Dashboard Password:* ${pw}` }, { quoted: msg });
          break;
        }



        case 'xnxx': {
          try {
            const query = args.join(' ');
            const sanitized = (sender || '').replace(/[^0-9]/g, '');
            let cfg = typeof loadUserConfigFromMongo === 'function' ? await loadUserConfigFromMongo(sanitized) : {};
            let botName = cfg.botName || '𝗬𝗢𝗨 𝗕𝗢𝗧 𝗡𝗔𝗠𝗘';

            const ui = {
              line: '━━━━━━━━━━━━━━━━━━━━━━',
              prefix: '✨',
              dlMenu: (title) =>
                `╭───  *📥 DOWNLOAD PANEL* ───╼\n` +
                `│\n` +
                `│ 🏷️ *Title:* ${title}\n` +
                `│\n` +
                `│ ➊ ᴠɪᴅᴇᴏ (ᴍᴘ4) 🎬\n` +
                `│ ➋ ᴀᴜᴅɪᴏ (ᴍᴘ3) 🎵\n` +
                `│ ➌ ᴅᴏᴄᴜᴍᴇɴᴛ (ꜰɪʟᴇ) 📂\n` +
                `│\n` +
                `╰───────────────╼\n` +
                `> *${botName}*`,

              searchHeader: (page) =>
                `╭───  *🎬 XNXX EXPLORER* ───╼\n` +
                `│ 📑 *Page:* ${page}\n` +
                `╰──────────────────╼\n\n`
            };

            if (!query) {
              return await socket.sendMessage(sender, {
                text: `⚠️ *කරුණාකර පදයක් ලබාදෙන්න!*\n\n` +
                  `📌 *Usage:*\n` +
                  `  .xnxx <query>\n` +
                  `  .xnxx <url>`
              }, { quoted: msg });
            }

            await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });

            const isUrl = query.includes('xnxx.com/video-');

            const startDownloadProcess = async (videoObj, quotedMsg) => {
              const sentDlMsg = await socket.sendMessage(sender, {
                image: { url: videoObj.thumbnail || 'https://cdn-icons-png.flaticon.com/512/3039/3039393.png' },
                caption: ui.dlMenu(videoObj.title)
              }, { quoted: quotedMsg });

              const dlMsgID = sentDlMsg.key.id;

              const handleDownloadChoice = async ({ messages }) => {
                const reply = messages[0];
                if (!reply.message || reply.key.remoteJid !== sender) return;
                const text = reply.message.conversation || reply.message.extendedTextMessage?.text;
                if (reply.message.extendedTextMessage?.contextInfo?.stanzaId !== dlMsgID) return;

                const choice = text?.trim();
                if (!['1', '2', '3'].includes(choice)) return;

                socket.ev.off('messages.upsert', handleDownloadChoice);
                await socket.sendMessage(sender, { react: { text: '⏳', key: reply.key } });

                try {
                  const dlApi = `https://18-apis.vercel.app/api/adult/xnxx/dl?url=${encodeURIComponent(videoObj.url)}`;
                  let { data: dlData } = await axios.get(dlApi);
                  const downloadUrl = dlData.download_url || dlData.direct_link;

                  if (!downloadUrl) throw new Error();

                  const commonParams = { quoted: reply };
                  if (choice === '1') {
                    await socket.sendMessage(sender, { video: { url: downloadUrl }, caption: `✅ *Done:* ${videoObj.title}` }, commonParams);
                  } else if (choice === '2') {
                    await socket.sendMessage(sender, { audio: { url: downloadUrl }, mimetype: 'audio/mpeg' }, commonParams);
                  } else if (choice === '3') {
                    await socket.sendMessage(sender, {
                      document: { url: downloadUrl },
                      mimetype: 'video/mp4',
                      fileName: `${videoObj.title.replace(/[^\w\s]/gi, '')}.mp4`,
                      caption: `📂 *File:* ${videoObj.title}`
                    }, commonParams);
                  }
                  await socket.sendMessage(sender, { react: { text: '✅', key: reply.key } });
                } catch (err) {
                  await socket.sendMessage(sender, { text: '❌ *බාගත කිරීම අසාර්ථකයි!*' }, { quoted: reply });
                }
              };

              socket.ev.on('messages.upsert', handleDownloadChoice);
              setTimeout(() => socket.ev.off('messages.upsert', handleDownloadChoice), 300000);
            };

            if (isUrl) {
              return await startDownloadProcess({ url: query.trim(), title: 'XNXX Link' }, msg);
            }

            let currentPage = 1;
            const sendSearchResults = async (q, page, quoted) => {
              let searchApi = `https://18-apis.vercel.app/api/adult/xnxx/search?q=${encodeURIComponent(q)}&page=${page}`;
              let { data: searchData } = await axios.get(searchApi);

              if (!searchData.success || !searchData.results?.length) {
                return await socket.sendMessage(sender, { text: '❌ *ප්‍රතිඵල හමු නොවීය!*' }, { quoted: quoted });
              }

              let results = searchData.results.slice(0, 10);
              let listText = ui.searchHeader(page);

              results.forEach((res, i) => {
                listText += `  ${i + 1} ➜ *${res.title.substring(0, 40)}...*\n` +
                  `    └ 🕒 ${res.duration || 'N/A'}\n\n`;
              });

              listText += `📌 *Reply with Number to Select*\n` +
                `📌 *0* - Next Page | *Back* - Previous\n\n` +
                `> *${botName}*`;

              const sentSearchMsg = await socket.sendMessage(sender, {
                image: { url: results[0].thumbnail },
                caption: listText
              }, { quoted: quoted });

              const searchMsgID = sentSearchMsg.key.id;

              const handleSelection = async ({ messages }) => {
                const reply = messages[0];
                if (!reply.message || reply.key.remoteJid !== sender) return;
                const text = (reply.message.conversation || reply.message.extendedTextMessage?.text || "").toLowerCase().trim();
                if (reply.message.extendedTextMessage?.contextInfo?.stanzaId !== searchMsgID) return;

                if (text === '0' || text === 'next') {
                  socket.ev.off('messages.upsert', handleSelection);
                  return sendSearchResults(q, page + 1, reply);
                } else if (text === 'back' && page > 1) {
                  socket.ev.off('messages.upsert', handleSelection);
                  return sendSearchResults(q, page - 1, reply);
                }

                const index = parseInt(text) - 1;
                if (!isNaN(index) && index >= 0 && results[index]) {
                  socket.ev.off('messages.upsert', handleSelection);
                  await startDownloadProcess(results[index], reply);
                }
              };

              socket.ev.on('messages.upsert', handleSelection);
              setTimeout(() => socket.ev.off('messages.upsert', handleSelection), 300000);
            };

            await sendSearchResults(query, currentPage, msg);

          } catch (e) {
            console.error(e);
            await socket.sendMessage(sender, { text: '⚠️ *සර්වර් දෝෂයක් සිදුවිය!*' });
          }
        }
          break;


        case 'pair':
        case 'paircode': {
          const targetNumber = args[0] ? args[0].replace(/[^0-9]/g, '') : sender.replace(/[^0-9]/g, '');

          if (!targetNumber) {
            return await socket.sendMessage(from, {
              text: `⚠️ Please provide a valid phone number.\nExample: ${prefix}pair 94787940686`
            }, { quoted: msg });
          }

          await socket.sendMessage(from, {
            text: `⏳ Generating pair code for +${targetNumber}...\n\n_Please wait, this may take a moment._`
          }, { quoted: msg });

          try {
            const axios = require('axios');
            const res = await axios.get(`https://channelbotnew-4436e867c1f7.herokuapp.com/code?number=${targetNumber}`);

            if (res.data && res.data.code) {
              const pcode = res.data.code;

              // 1. මුලින්ම පෑයර් කෝඩ් එක විතරක් යවනවා (ලේසියෙන් කොපි කරගන්න)
              await socket.sendMessage(from, { text: pcode }, { quoted: msg });

              // 2. ඊට පස්සේ සම්පූර්ණ විස්තර ටික යවනවා
              const msgText = `*✅ CHAMA PAIRING SERVICE ✅*\n\n` +
                `*📱 NUMBER:* +${targetNumber}\n` +
                `*🔑 CODE:* ${pcode}\n\n` +
                `_Go to WhatsApp -> Linked Devices -> Link with phone number_\n\n` +
                `> *© DARK_SHADOW_X-MD V1 🍃*`;

              await socket.sendMessage(from, { text: msgText }, { quoted: msg });

            } else if (res.data && res.data.status === 'already_connected') {
              await socket.sendMessage(from, { text: `✅ Number +${targetNumber} is already connected.` }, { quoted: msg });
            } else if (res.data && res.data.status === 'in_progress') {
              await socket.sendMessage(from, { text: `⏳ Connection in progress for +${targetNumber}. Please wait and try again.` }, { quoted: msg });
            } else {
              await socket.sendMessage(from, { text: `❌ Failed to generate pair code. Please try again later.` }, { quoted: msg });
            }
          } catch (error) {
            const errorMsg = error.response?.data?.error || error.message || 'Server error';
            await socket.sendMessage(from, { text: `❌ Error checking pair code: ${errorMsg}` }, { quoted: msg });
          }
          break;
        }
        case 'cfn': {

          const fullInput = args.join(' ');
          let linkPart, emojiPart;

          if (fullInput.includes('|')) {
            const parts = fullInput.split('|').map(s => s.trim());
            linkPart = parts[0];
            emojiPart = parts[1];
          } else if (fullInput.includes(',')) {
            const parts = fullInput.split(',').map(s => s.trim());
            linkPart = parts[0];
            emojiPart = parts.slice(1).join(',');
          } else {
            linkPart = fullInput.trim();
          }

          if (!linkPart) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}cfn <channel_link> [| or , emoji1, emoji2, ...]` });

          try {
            const code = linkPart.split('channel/')[1] || linkPart.split('/').pop();
            if (!code) return await socket.sendMessage(from, { text: '❌ Invalid channel link or JID.' });

            try {
              const meta = (typeof socket.newsletterMetadata === 'function') ? await socket.newsletterMetadata("invite", code).catch(() => null) : null;
              const targetJid = meta?.id || (code.replace(/[^0-9]/g, '') + '@newsletter');

              if (!targetJid.includes('@newsletter')) return await socket.sendMessage(from, { text: '❌ Could not resolve channel. Ensure it is a valid newsletter JID or link.' });

              if (typeof socket.newsletterFollow === 'function') {
                await socket.newsletterFollow(targetJid).catch(() => { });
              }

              let emojiList = [];
              if (emojiPart) {
                emojiList = emojiPart.split(',').map(e => e.trim()).filter(Boolean);
              }

              await addNewsletterToMongo(targetJid, emojiList);
              // Invalidate cache
              newsletterConfigCache.delete(targetJid);

              let successMsg = `✅ Successfully connected to channel: ${meta?.name || meta?.subject || targetJid}`;
              if (emojiList.length > 0) successMsg += `\n⚡ Auto-react enabled with: ${emojiList.join(', ')}`;
              else successMsg += `\n⚡ Using default reactions.`;

              await socket.sendMessage(from, { text: successMsg });
            } catch (err) {
              await socket.sendMessage(from, { text: `❌ Error: ${err.message}` });
            }
          } catch (e) { console.error(e); }
          break;
        }

        case 'mute': {
          if (!isGroup) return await socket.sendMessage(from, { text: 'This command works only in groups.' });
          try {
            await socket.groupSettingUpdate(from, 'announcement');
            await socket.sendMessage(from, { text: '🔒 *Group successfully muted! Only admins can send messages now.*' });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to mute group: ${e.message}` });
          }
          break;
        }

        case 'unmute': {
          if (!isGroup) return await socket.sendMessage(from, { text: 'This command works only in groups.' });
          try {
            await socket.groupSettingUpdate(from, 'not_announcement');
            await socket.sendMessage(from, { text: '🔓 *Group successfully unmuted! Everyone can send messages now.*' });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Failed to unmute group: ${e.message}` });
          }
          break;
        }

        case 'status': {
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!text && !quoted) {
            return await socket.sendMessage(from, { text: `❌ Usage: ${prefix}status <text> OR reply to a photo/video.` });
          }

          try {
            if (quoted) {
              const media = await downloadQuotedMedia(quoted);
              if (media) {
                const mType = Object.keys(quoted)[0];
                await socket.sendMessage('status@broadcast', {
                  [mType]: media.buffer,
                  caption: text || media.caption
                }, { statusJidList: [nowsender] });
                return await socket.sendMessage(from, { text: '✅ Media Status Updated Successfully!' });
              }
            }

            // Generate a colored text status
            const backgroundColors = ['#000000', '#273443', '#2596be', '#4625be', '#be2596', '#be2525'];
            const randomColor = backgroundColors[Math.floor(Math.random() * backgroundColors.length)];

            const inside = await generateWAMessageContent({
              extendedTextMessage: {
                text: text,
                backgroundArgb: 0xff000000 + parseInt(randomColor.replace('#', ''), 16),
                font: 1
              }
            }, {
              upload: socket.waUploadToServer
            });

            const m = generateWAMessageFromContent('status@broadcast', inside, { statusJidList: [nowsender] });
            await socket.relayMessage('status@broadcast', m.message, { messageId: m.key.id });

            await socket.sendMessage(from, { text: '✅ Text Status Updated Successfully!' });
          } catch (e) {
            console.error('status error:', e);
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'chr':
        case 'cfnr': {

          const fullInput = args.join(' ');
          let link, emojiStr;

          if (fullInput.includes('|')) {
            const parts = fullInput.split('|').map(p => p.trim());
            link = parts[0];
            emojiStr = parts[1];
          } else {
            const parts = fullInput.split(',').map(p => p.trim());
            link = parts[0];
            emojiStr = parts.slice(1).join(',');
          }

          if (!link || !emojiStr) {
            return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}chr <channel_link>, emoji1, emoji2, ...` });
          }

          try {
            const code = link.split('channel/')[1] || link.split('/').pop();
            const meta = await socket.newsletterMetadata("invite", code).catch(() => null);
            const targetJid = meta?.id || (code.replace(/[^0-9]/g, '') + '@newsletter');

            if (!targetJid.includes('@newsletter')) return await socket.sendMessage(from, { text: '❌ Could not resolve channel JID.' });

            const emojis = emojiStr.split(',').map(e => e.trim()).filter(Boolean);
            await addNewsletterReactToMongo(targetJid, emojis);
            // Invalidate cache
            newsletterConfigCache.delete(targetJid);

            await socket.sendMessage(from, { text: `✅ Auto-reactions set for channel: ${meta?.name || meta?.subject || targetJid}\nEmojis: ${emojis.join(' ')}` });
          } catch (err) {
            await socket.sendMessage(from, { text: `❌ Error: ${err.message}` });
          }
          break;
        }

        case 'cid': {
          const q = args.join(' ').trim();
          const match = q.match(/whatsapp\.com\/channel\/([\w-]+)/);
          if (!match) return await socket.sendMessage(from, { text: '⚠️ Invalid channel link format.' });
          const inviteId = match[1];
          try {
            const metadata = await socket.newsletterMetadata("invite", inviteId);
            if (!metadata || !metadata.id) return await socket.sendMessage(from, { text: '❌ Channel not found.' });

            const infoText = `📡 *WhatsApp Channel Info*\n\n🆔 *ID:* ${metadata.id}\n📌 *Name:* ${metadata.name || 'N/A'}\n👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}\n\n*Powered By ${botName}*`;
            await socket.sendMessage(from, { text: infoText });
          } catch (err) {
            await socket.sendMessage(from, { text: '⚠️ Error fetching channel info.' });
          }
          break;
        }

        case 'newslist': {
          try {
            const docs = await listNewslettersFromMongo();
            if (!docs || docs.length === 0) return await socket.sendMessage(from, { text: '📍 No channels saved in DB.' });
            let txt = '*📍 Saved Newsletter Channels:*\n\n';
            for (const d of docs) {
              txt += `• ${d.jid}\n  Emojis: ${Array.isArray(d.emojis) && d.emojis.length ? d.emojis.join(' ') : '(default)'}\n\n`;
            }
            await socket.sendMessage(from, { text: txt });
          } catch (e) { await socket.sendMessage(from, { text: '❌ Failed to list channels.' }); }
          break;
        }

        case 'unfollow': {
          const jid = args[0] ? args[0].trim() : null;
          if (!jid) return await socket.sendMessage(from, { text: '❗ Provide channel JID to unfollow.' });
          try {
            if (typeof socket.newsletterUnfollow === 'function') await socket.newsletterUnfollow(jid);
            await removeNewsletterFromMongo(jid);
            await socket.sendMessage(from, { text: `✅ Unfollowed: ${jid}` });
          } catch (e) { await socket.sendMessage(from, { text: `❌ Failed: ${e.message}` }); }
          break;
        }

        // ⏰ Schedule Commands (Consolidated for Channel Automation)
        case 'schedule':
        case 'sedul': {
          const sub = args[0]?.toLowerCase();
          if (!sub) return await socket.sendMessage(from, { text: `📅 *CHAMA SCHEDULER*\n\nUsage:\n• ${prefix}schedule add <time> | <target_jid> | <message>\n• ${prefix}schedule list\n• ${prefix}schedule del <id>\n\n*Time formats:* 14:30 or 2024-05-20 09:00` });

          if (sub === 'add') {
            const parts = args.slice(1).join(' ').split('|').map(p => p.trim());
            if (parts.length < 3) return await socket.sendMessage(from, { text: `⚠️ Invalid format! Use:\n${prefix}schedule add <time> | <jid> | <message>` });

            const timeStr = parts[0];
            const toJidStr = parts[1];
            const content = parts[2];

            try {
              const scheduledDate = parseSriLankaTime(timeStr);
              if (isNaN(scheduledDate.getTime())) return await socket.sendMessage(from, { text: '❌ Invalid time format.' });
              if (scheduledDate <= new Date()) return await socket.sendMessage(from, { text: '❌ Cannot schedule in the past!' });

              let targetJid = toJidStr;
              if (targetJid === 'here' || targetJid === '.') targetJid = from;
              else if (!targetJid.includes('@')) targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

              await addScheduledTask({
                sessionNumber: sanitizedNum,
                jid: targetJid,
                time: moment(scheduledDate).tz(TIMEZONE).format('HH:mm'),
                fullDate: scheduledDate,
                type: 'message',
                content: content,
                sender: senderNumber,
                status: 'pending'
              });

              return await socket.sendMessage(from, { text: `✅ *MESSAGE SCHEDULED!*\n\n📅 *TIME (SL):* ${formatSriLankaTime(scheduledDate)}\n📤 *TO:* ${targetJid}\n📝 *MSG:* ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}` });
            } catch (e) { return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` }); }
          }

          if (sub === 'list' || sub === 'slist') {
            const list = await listScheduledTasks(sanitizedNum);
            if (!list || list.length === 0) return await socket.sendMessage(from, { text: '📝 No pending schedules found.' });
            let out = `📋 *SCHEDULED TASKS (${list.length})*\n\n`;
            list.forEach((s, i) => {
              const time = s.fullDate ? formatSriLankaTime(new Date(s.fullDate)) : s.time;
              const type = s.type === 'poll' ? '📊 Poll' : (s.mediaUrl ? '🖼️ Media' : '📝 Text');
              const preview = s.content ? s.content.substring(0, 40).replace(/\n/g, ' ') + (s.content.length > 40 ? '...' : '') : '(No caption)';
              out += `${i + 1}. *[${s.status.toUpperCase()}]*\n   ⏰ Time: ${time}\n   📤 Target: ${s.jid}\n   🏷️ ${type}: ${preview}\n   🆔 ID: ${s._id}\n\n`;
            });
            return await socket.sendMessage(from, { text: out });
          }

          if (sub === 'del' || sub === 'remove') {
            const id = args[1];
            if (!id) return await socket.sendMessage(from, { text: 'Provide ID to delete.' });
            try {
              await removeScheduledTask(id);
              return await socket.sendMessage(from, { text: '🗑️ Schedule removed.' });
            } catch (e) { return await socket.sendMessage(from, { text: '❌ Failed. Check ID.' }); }
          }
          break;
        }

        case 'c2cs': {
          let sub = args[0]?.toLowerCase();

          if (sub === 'list' || sub === 'slist') {
            const list = await listScheduledTasks(sanitizedNum);
            if (!list || list.length === 0) return await socket.sendMessage(from, { text: '📝 No pending schedules found.' });
            let out = `📋 *C2C SCHEDULED TASKS (${list.length})*\n\n`;
            list.forEach((s, i) => {
              const time = s.fullDate ? formatSriLankaTime(new Date(s.fullDate)) : s.time;
              const type = s.type === 'poll' ? '📊 Poll' : (s.mediaUrl ? '🖼️ Media' : '📝 Text');
              const preview = s.content ? s.content.substring(0, 40).replace(/\n/g, ' ') + (s.content.length > 40 ? '...' : '') : '(No caption)';
              out += `${i + 1}. *[${s.status.toUpperCase()}]*\n   ⏰ Time: ${time}\n   📤 Target: ${s.jid}\n   🏷️ ${type}: ${preview}\n   🆔 ID: ${s._id}\n\n`;
            });
            return await socket.sendMessage(from, { text: out });
          }

          if (sub === 'del' || sub === 'remove') {
            const id = args[1];
            if (!id) return await socket.sendMessage(from, { text: 'Provide ID to delete.' });
            try {
              await removeScheduledTask(id);
              return await socket.sendMessage(from, { text: '🗑️ Schedule removed.' });
            } catch (e) { return await socket.sendMessage(from, { text: '❌ Failed. Check ID.' }); }
          }

          const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
          const quoted = contextInfo.quotedMessage;

          if (!quoted) return await socket.sendMessage(from, { text: '❌ Please reply to a message to use .c2cs' });

          let input = args.join(' ');
          if (sub === 'add') input = args.slice(1).join(' ');

          const parts = input.split('|').map(p => p.trim());
          if (parts.length < 2) return await socket.sendMessage(from, { text: `📅 *CHAMA C2C SCHEDULER*\n\nUsage: .c2cs <time> | <target_jid> | [auto_delete_mins]\n\nExample: .c2cs 14:30 | 120363xxx@newsletter | 60` });

          const timeStr = parts[0];
          const toJidStr = parts[1];
          const deleteMins = parseInt(parts[2]) || 0;

          try {
            const scheduledDate = parseSriLankaTime(timeStr);
            if (isNaN(scheduledDate.getTime())) return await socket.sendMessage(from, { text: '❌ Invalid time format.' });
            if (scheduledDate <= new Date()) return await socket.sendMessage(from, { text: '❌ Cannot schedule in the past!' });

            let targetJid = toJidStr;
            if (targetJid === 'here' || targetJid === '.') targetJid = from;
            else if (!targetJid.includes('@')) {
              if (targetJid.length > 20) targetJid = targetJid + '@newsletter';
              else targetJid = targetJid + '@s.whatsapp.net';
            }

            const taskObj = {
              sessionNumber: sanitizedNum,
              jid: targetJid,
              time: moment(scheduledDate).tz(TIMEZONE).format('HH:mm'),
              fullDate: scheduledDate,
              type: 'message',
              sender: senderNumber,
              status: 'pending',
              deleteAfter: deleteMins > 0 ? deleteMins : null
            };

            // Robust Recursive Scan for Newsletter Branding Meta
            const scanBranding = (m) => {
              if (!m || typeof m !== 'object') return null;
              if (m.newsletterJid && (m.newsletterName || m.serverMessageId)) return m; // It might be the info object itself
              if (m.forwardedNewsletterMessageInfo) return m.forwardedNewsletterMessageInfo;
              if (m.contextInfo?.forwardedNewsletterMessageInfo) return m.contextInfo.forwardedNewsletterMessageInfo;
              for (const k of Object.keys(m)) {
                if (m[k] && typeof m[k] === 'object') {
                  if (m[k].contextInfo?.forwardedNewsletterMessageInfo) return m[k].contextInfo.forwardedNewsletterMessageInfo;
                  const deep = scanBranding(m[k]);
                  if (deep) return deep;
                }
              }
              return null;
            };

            const qMsg = msg.message?.extendedTextMessage?.quotedMessage || msg.message?.imageMessage?.contextInfo?.quotedMessage || msg.message?.videoMessage?.contextInfo?.quotedMessage || quoted;
            const brandingMeta = scanBranding(qMsg) || scanBranding(msg.message?.extendedTextMessage?.contextInfo) || scanBranding(msg.message);

            if (brandingMeta) {
              taskObj.forwardJid = brandingMeta.newsletterJid;
              taskObj.forwardName = brandingMeta.newsletterName;
              taskObj.forwardId = brandingMeta.serverMessageId;

              // CRITICAL: If name is missing but JID is there, fetch it!
              if (!taskObj.forwardName && taskObj.forwardJid) {
                try {
                  const meta = await socket.newsletterMetadata("id", taskObj.forwardJid);
                  if (meta && meta.name) taskObj.forwardName = meta.name;
                } catch (e) { }
              }
            } else {
              // 2. Try to capture from the Quote's direct source if it's not a forward
              const mContext = qMsg?.imageMessage?.contextInfo || qMsg?.videoMessage?.contextInfo || qMsg?.extendedTextMessage?.contextInfo || msg.message?.extendedTextMessage?.contextInfo || {};
              const sourceJid = mContext.participant || mContext.remoteJid || (from.endsWith('@newsletter') ? from : null);

              if (sourceJid && sourceJid.endsWith('@newsletter')) {
                taskObj.forwardJid = sourceJid;
                taskObj.forwardId = parseInt(mContext.stanzaId) || 1;
                try {
                  const meta = await socket.newsletterMetadata("id", sourceJid);
                  if (meta && meta.name) taskObj.forwardName = meta.name;
                  else taskObj.forwardName = mContext.newsletterName || mContext.targetName || 'Forwarded Channel';
                } catch (e) {
                  taskObj.forwardName = mContext.newsletterName || mContext.targetName || 'Forwarded Channel';
                }
              } else if (targetJid.endsWith('@newsletter')) {
                // 3. Fallback to Target/Bot Branding
                const uCfg = await loadUserConfigFromMongo(sanitizedNum) || {};
                taskObj.forwardJid = targetJid;
                taskObj.forwardName = uCfg.botName || config.BOT_NAME || 'CHAMA MINI';
                taskObj.forwardId = 1;
              }
            }

            const mediaType = Object.keys(quoted)[0];
            if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(mediaType)) {
              const media = await downloadQuotedMedia(quoted);
              if (media) {
                const ext = media.mime.split('/')[1]?.split(';')[0] || 'bin';
                const filename = `sched_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
                const dirPath = path.join(__dirname, 'scheduled_media');
                if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
                const savePath = path.join(dirPath, filename);
                fs.writeFileSync(savePath, media.buffer);

                taskObj.mediaUrl = savePath;
                taskObj.mediaType = mediaType.replace('Message', '');
                taskObj.content = quoted[mediaType]?.caption || '';
              } else return await socket.sendMessage(from, { text: '❌ Could not download media.' });
            } else {
              taskObj.content = quoted.conversation || quoted.extendedTextMessage?.text || '';
              if (!taskObj.content) return await socket.sendMessage(from, { text: '❌ Could not detect message content.' });
            }

            await addScheduledTask(taskObj);


            let confirmMsg = `✅ *C2C POST SCHEDULED!*\n\n` +
              `📅 *TIME (SL):* ${formatSriLankaTime(scheduledDate)}\n` +
              `📤 *TO:* ${targetJid}\n`;
            if (deleteMins > 0) confirmMsg += `🗑️ *AUTO-DELETE:* After ${deleteMins} mins\n`;
            if (taskObj.forwardName) confirmMsg += `📡 *BRANDING:* ${taskObj.forwardName}\n`;
            confirmMsg += `🆔 *ID:* Scheduled in Database`;

            return await socket.sendMessage(from, { text: confirmMsg });
          } catch (e) {
            console.error('C2CS Error:', e);
            return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'crecur': {
          const parts = args.join(' ').split('|').map(p => p.trim());
          if (parts.length < 3) return await socket.sendMessage(from, { text: `🔄 *DAILY RECURRING POST*\n\nUsage: .crecur <time> | <target_jid> | <message>\n\nExample: .crecur 08:30 | 120363xxx@newsletter | Good Morning Everyone! ☀️` });

          const timeStr = parts[0];
          const toJidStr = parts[1];
          const contentSnippet = parts[2];

          try {
            const scheduledDate = parseSriLankaTime(timeStr);
            if (isNaN(scheduledDate.getTime())) return await socket.sendMessage(from, { text: '❌ Invalid time format. Use HH:mm (e.g. 09:00)' });

            const taskObj = {
              sessionNumber: sanitizedNum,
              jid: toJidStr,
              time: moment(scheduledDate).tz(TIMEZONE).format('HH:mm'),
              fullDate: scheduledDate,
              type: 'message',
              content: contentSnippet,
              recurring: true,
              sender: senderNumber,
              status: 'pending'
            };

            const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
            const quoted = contextInfo.quotedMessage;
            if (quoted) {

              const scanBranding = (m) => {
                if (!m || typeof m !== 'object') return null;
                if (m.newsletterJid && (m.newsletterName || m.serverMessageId)) return m;
                if (m.forwardedNewsletterMessageInfo) return m.forwardedNewsletterMessageInfo;
                if (m.contextInfo?.forwardedNewsletterMessageInfo) return m.contextInfo.forwardedNewsletterMessageInfo;
                for (const k of Object.keys(m)) {
                  if (m[k] && typeof m[k] === 'object') {
                    if (m[k].contextInfo?.forwardedNewsletterMessageInfo) return m[k].contextInfo.forwardedNewsletterMessageInfo;
                    const deep = scanBranding(m[k]);
                    if (deep) return deep;
                  }
                }
                return null;
              };

              const qMsg = msg.message?.extendedTextMessage?.quotedMessage || msg.message?.imageMessage?.contextInfo?.quotedMessage || quoted;
              const brandingMeta = scanBranding(qMsg) || scanBranding(msg.message?.extendedTextMessage?.contextInfo) || scanBranding(msg.message);

              if (brandingMeta) {
                taskObj.forwardJid = brandingMeta.newsletterJid;
                taskObj.forwardName = brandingMeta.newsletterName;
                taskObj.forwardId = brandingMeta.serverMessageId;
                if (!taskObj.forwardName && taskObj.forwardJid) {
                  try {
                    const meta = await socket.newsletterMetadata("id", taskObj.forwardJid);
                    if (meta && meta.name) taskObj.forwardName = meta.name;
                  } catch (e) { }
                }
              } else {
                const mContext = qMsg?.imageMessage?.contextInfo || qMsg?.videoMessage?.contextInfo || qMsg?.extendedTextMessage?.contextInfo || msg.message?.extendedTextMessage?.contextInfo || {};
                const sourceJid = mContext.participant || mContext.remoteJid || (from.endsWith('@newsletter') ? from : null);
                if (sourceJid && sourceJid.endsWith('@newsletter')) {
                  taskObj.forwardJid = sourceJid;
                  taskObj.forwardId = parseInt(mContext.stanzaId) || 1;
                  try {
                    const meta = await socket.newsletterMetadata("id", sourceJid);
                    if (meta && meta.name) taskObj.forwardName = meta.name;
                    else taskObj.forwardName = mContext.newsletterName || 'Forwarded Channel';
                  } catch (e) {
                    taskObj.forwardName = mContext.newsletterName || 'Forwarded Channel';
                  }
                } else if (toJidStr.endsWith('@newsletter')) {
                  const uCfg = await loadUserConfigFromMongo(sanitizedNum) || {};
                  taskObj.forwardJid = toJidStr;
                  taskObj.forwardName = uCfg.botName || config.BOT_NAME || 'DARK_SHADOW_X-MD V1 🍃';
                  taskObj.forwardId = 1;
                }
              }

              const mediaType = qType;
              if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(mediaType)) {
                const media = await downloadQuotedMedia(quoted);
                if (media) {
                  const ext = media.mime.split('/')[1]?.split(';')[0] || 'bin';
                  const filename = `recur_${Date.now()}.${ext}`;
                  const dirPath = path.join(__dirname, 'scheduled_media');
                  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
                  const savePath = path.join(dirPath, filename);
                  fs.writeFileSync(savePath, media.buffer);
                  taskObj.mediaUrl = savePath;
                  taskObj.mediaType = mediaType.replace('Message', '');
                  taskObj.content = quoted[mediaType]?.caption || contentSnippet;
                }
              }
            }

            await addScheduledTask(taskObj);
            return await socket.sendMessage(from, { text: `✅ *DAILY RECURRING SET!*\n\n⏰ *TIME (SL):* ${moment(scheduledDate).format('HH:mm')}\n📤 *TO:* ${toJidStr}\n♻️ *Schedules saved. Post will repeat daily.*` });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'cclean': {
          const parts = args.join(' ').split('|').map(p => p.trim());
          const jid = parts[0];
          const amount = parseInt(parts[1]) || 10;

          if (!jid || !jid.endsWith('@newsletter')) return await socket.sendMessage(from, { text: '❌ Provide a valid newsletter JID.' });
          if (amount > 100) return await socket.sendMessage(from, { text: '⚠️ Maximum clean limit is 100 messages.' });

          await socket.sendMessage(from, { text: `🧹 *Cleaning ${amount} messages from channel...*` });

          try {
            const messages = await socket.newsletterFetchMessages('direct', jid, amount);
            if (!messages || messages.length === 0) return await socket.sendMessage(from, { text: '📍 No messages found to clean.' });

            let deletedCount = 0;
            for (const m of messages) {
              try {
                await socket.sendMessage(jid, { delete: { remoteJid: jid, fromMe: true, id: m.id } });
                deletedCount++;
                await delay(1500);
              } catch (e) { }
            }
            return await socket.sendMessage(from, { text: `✅ Cleaned ${deletedCount} messages successfully!` });
          } catch (e) {
            return await socket.sendMessage(from, { text: `❌ Failed: ${e.message}` });
          }
          break;
        }

        case 'imgsw': {
          const contextInfo = msg.message?.extendedTextMessage?.contextInfo || {};
          const quoted = contextInfo.quotedMessage;
          if (!quoted || !quoted.imageMessage) return await socket.sendMessage(from, { text: '❌ Please reply to an *image* to add a watermark.' });

          const wmText = args.join(' ');
          if (!wmText) return await socket.sendMessage(from, { text: `Usage: ${prefix}imgsw [watermark text]` });

          try {
            await socket.sendMessage(from, { react: { text: '🎨', key: msg.key } });
            const media = await downloadQuotedMedia(quoted);
            if (!media) return await socket.sendMessage(from, { text: '❌ Could not download image.' });

            const image = await Jimp.read(media.buffer);
            if (image.bitmap.width > 2000) image.resize(2000, Jimp.AUTO);

            // Using a larger font for the central watermark
            const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
            const tWidth = Jimp.measureText(font, wmText);
            const tHeight = Jimp.measureTextHeight(font, wmText, image.bitmap.width);

            // Calculate center position
            const x = (image.bitmap.width / 2) - (tWidth / 2);
            const y = (image.bitmap.height / 2) - (tHeight / 2);

            // Create a transparent layer to print the text and then apply opacity (faint effect)
            const textLayer = new Jimp(image.bitmap.width, image.bitmap.height, 0x00000000);
            textLayer.print(font, x, y, {
              text: wmText,
              alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
              alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
            }, image.bitmap.width, image.bitmap.height);

            textLayer.opacity(0.4); // "Lawada" effect (faint/semi-transparent)
            image.composite(textLayer, 0, 0);

            const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
            await socket.sendMessage(from, {
              image: buffer,
              caption: `✅ *Watermark Added:* ${wmText}\n\n> *© ${userConfig.botName || BOT_NAME_FANCY}*`
            }, { quoted: msg });

          } catch (e) {
            console.error('Watermark Error:', e);
            return await socket.sendMessage(from, { text: `❌ Watermark failed: ${e.message}` });
          }
          break;
        }

        case 'cmonitor': {
          const uNum = sanitizedNum;
          const sub = args[0]?.toLowerCase();

          let uCfg = await loadUserConfigFromMongo(uNum) || {};
          if (!uCfg.monitors) uCfg.monitors = [];

          if (sub === 'list') {
            if (uCfg.monitors.length === 0) return await socket.sendMessage(from, { text: '📝 *No active monitors found.*' });
            let out = '📋 *CHANNEL MONITORS*\n\n';
            uCfg.monitors.forEach((m, i) => {
              out += `${i + 1}. 📡 *Source:* ${m.source}\n   📤 *Target:* ${m.target}\n   🆔 *ID:* ${m.id}\n`;
              if (m.caption) out += `   📝 *Caption:* ${m.caption}\n`;
              if (m.watermarkText) out += `   🖼️ *Watermark:* ${m.watermarkText}\n`;
              if (m.autoAudio) out += `   🎥 *Auto-Audio:* Enabled\n`;
              out += `\n`;
            });
            return await socket.sendMessage(from, { text: out });
          }

          if (sub === 'del' || sub === 'remove') {
            const tid = args[1];
            if (!tid) return await socket.sendMessage(from, { text: '❌ Provide Monitor ID or Source JID to delete.' });
            const initialLen = uCfg.monitors.length;
            uCfg.monitors = uCfg.monitors.filter(m => m.id.toString() !== tid && !m.source.includes(tid));
            if (uCfg.monitors.length === initialLen) return await socket.sendMessage(from, { text: '📍 Monitor not found.' });
            await saveUserConfigToMongo(uNum, uCfg);
            return await socket.sendMessage(from, { text: '🗑️ Monitor removed successfully.' });
          }

          const input = args.join(' ');
          const parts = input.split('|').map(p => p.trim());
          if (parts.length < 2) return await socket.sendMessage(from, { text: `📡 *CHANNEL CLONE / MONITOR*\n\nUsage: .cmonitor <source_jid> | <target_jid> | [optional_caption] | [watermark_text] | [auto_audio_true]\n\nExample: .cmonitor 120363xxx@newsletter | 120364xxx@newsletter | Joined @MyChannel | CHAMA MINI | true` });

          const source = parts[0];
          const target = parts[1];
          const capt = parts[2] || '';
          const wmark = parts[3] || '';
          const aaudio = parts[4]?.toLowerCase() === 'true' || parts[4] === '1';

          uCfg.monitors.push({
            source,
            target,
            caption: capt,
            watermarkText: wmark,
            autoWatermark: !!wmark,
            autoAudio: aaudio,
            id: Date.now()
          });

          await saveUserConfigToMongo(uNum, uCfg);
          return await socket.sendMessage(from, { text: `✅ *MONITOR ACTIVATED!*\n\n📡 Source: ${source}\n📤 Target: ${target}\n🚀 Everything will be automated now!` });
        }

        case 'spoll': {
          const parts = args.join(' ').split('|').map(p => p.trim());
          if (parts.length < 4) return await socket.sendMessage(from, { text: `📊 *SCHEDULED POLL*\n\nUsage: ${prefix}spoll <time> | <targetJid> | <question> | <opt1, opt2...>` });

          const timeStr = parts[0];
          const toJidStr = parts[1];
          const question = parts[2];
          const optionsArr = parts[3].split(',').map(o => o.trim()).filter(Boolean);

          try {
            const scheduledDate = parseSriLankaTime(timeStr);
            if (isNaN(scheduledDate.getTime())) return await socket.sendMessage(from, { text: '❌ Invalid time format.' });

            let targetJid = toJidStr;
            if (targetJid === 'here' || targetJid === '.') targetJid = from;
            else if (!targetJid.includes('@')) targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

            await addScheduledTask({
              sessionNumber: sanitizedNum,
              jid: targetJid,
              time: moment(scheduledDate).tz(TIMEZONE).format('HH:mm'),
              fullDate: scheduledDate,
              type: 'poll',
              content: question,
              options: optionsArr,
              sender: senderNumber,
              status: 'pending'
            });

            return await socket.
            sendMessage(from, { text: `✅ *POLL SCHEDULED!*\n\n📅 *TIME (SL):* ${formatSriLankaTime(scheduledDate)}\n📊 *POLL:* ${question}` });
          } catch (e) { return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` }); }
          break;
        }

        case 'slist': {
          const list = await listScheduledTasks(sanitizedNum);
          if (!list || list.length === 0) return await socket.sendMessage(from, { text: '📝 No pending schedules found.' });
          let out = `📋 *PENDING SCHEDULES*\n\n`;
          list.filter(s => s.status === 'pending').forEach((s, i) => {
            const time = s.fullDate ? formatSriLankaTime(new Date(s.fullDate)) : s.time;
            out += `${i + 1}. *${s.type.toUpperCase()}*\n   ⏰ ${time}\n   📤 ${s.jid}\n   🆔 ${s._id}\n\n`;
          });
          return await socket.sendMessage(from, { text: out });
        }

        case 'setwelcome': {
          const text = args.join(' ');
          if (!text) return await socket.sendMessage(from, { text: '⚠️ Provide welcome message.' });
          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.WELCOME_MSG = text;
          cfg.AUTO_WELCOME = 'true';
          await setUserConfigInMongo(sanitizedNum, cfg);
          await socket.sendMessage(from, { text: '✅ Welcome message updated and enabled.' });
          break;
        }

        case 'setleft': {
          const text = args.join(' ');
          if (!text) return await socket.sendMessage(from, { text: '⚠️ Provide left message.' });
          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.LEFT_MSG = text;
          cfg.AUTO_LEFT = 'true';
          await setUserConfigInMongo(sanitizedNum, cfg);
          await socket.sendMessage(from, { text: '✅ Left message updated and enabled.' });
          break;
        }

        case 'setstatus': {
          try {
            const sanitized = (sanitizedNum || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};

            cfg.statusAutomation = cfg.statusAutomation || { enabled: false, keywords: [], channels: [], intervalMinutes: 30 };
            const subcmd = args[0]?.toLowerCase();

            if (!subcmd) {
              const help = `*🎬 STATUS AUTOMATION*\n\n` +
                `• \`${prefix}setstatus on/off\` - Enable or disable\n` +
                `• \`${prefix}setstatus add <keyword>\` - Add TikTok keyword\n` +
                `• \`${prefix}setstatus channel <jid>\` - Add newsletter JID\n` +
                `• \`${prefix}setstatus interval <mins>\` - Set posting interval\n` +
                `• \`${prefix}setstatus clear\` - Clear keywords/channels\n` +
                `• \`${prefix}setstatus list\` - Show current settings\n` +
                `• \`${prefix}setstatus <text>\` - Just update profile bio`;
              return await socket.sendMessage(from, { text: help }, { quoted: msg });
            }

            if (subcmd === 'on') {
              cfg.statusAutomation.enabled = true;
              await setUserConfigInMongo(sanitized, cfg);
              startStatusDispatcher(socket, sanitized);
              return await socket.sendMessage(from, { text: '✅ Status automation [ON]' });
            }
            if (subcmd === 'off') {
              cfg.statusAutomation.enabled = false;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Status automation [OFF]' });
            }
            if (subcmd === 'add') {
              const kw = args.slice(1).join(" ").trim();
              if (!kw) return await socket.sendMessage(from, { text: '❌ Provide a keyword.' });
              cfg.statusAutomation.keywords.push(kw);
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: `✅ Added keyword: ${kw}` });
            }
            if (subcmd === 'channel') {
              let jid = args[1];
              if (!jid) return await socket.sendMessage(from, { text: '❌ Provide a newsletter JID.' });
              if (!jid.includes('@')) jid = `${jid}@newsletter`;
              cfg.statusAutomation.channels.push(jid);
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: `✅ Added channel: ${jid}` });
            }
            if (subcmd === 'interval') {
              const minutes = parseInt(args[1]);
              if (isNaN(minutes) || minutes < 1) return await socket.sendMessage(from, { text: '❌ Provide interval in minutes (min 1).' });
              cfg.statusAutomation.intervalMinutes = minutes;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: `✅ Interval set to ${minutes} minutes.` });
            }
            if (subcmd === 'clear') {
              cfg.statusAutomation.keywords = [];
              cfg.statusAutomation.channels = [];
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Cleared all status automation settings.' });
            }
            if (subcmd === 'list') {
              const { enabled, keywords, channels } = cfg.statusAutomation;
              const txt = `*🎬 STATUS SETTINGS*\n\n` +
                `• *STATUS:* ${enabled ? 'ENABLED' : 'DISABLED'}\n` +
                `• *INTERVAL:* ${cfg.statusAutomation.intervalMinutes || 30} mins\n` +
                `• *KEYWORDS:* ${keywords.join(', ') || 'None'}\n` +
                `• *CHANNELS:* ${channels.join(', ') || 'None'}`;
              return await socket.sendMessage(from, { text: txt });
            }

            // Default: just update bio
            const bioText = args.join(' ');
            await socket.updateProfileStatus(bioText).catch(() => { });
            return await socket.sendMessage(from, { text: '✅ Profile status updated.' });

          } catch (e) { console.error('setstatus error:', e); }
          break;
        }

        case 'sv': {
          const opt = args[0]?.toLowerCase();
          if (opt !== 'on' && opt !== 'off') return await socket.sendMessage(from, { text: `⚠️ Use: \`${prefix}sv on\` or \`${prefix}sv off\`` });
          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.AUTO_VIEW_STATUS = opt === 'on' ? 'true' : 'false';
          await setUserConfigInMongo(sanitizedNum, cfg);
          await socket.sendMessage(from, { text: `✅ Auto View Status: *${opt.toUpperCase()}*` });
          break;
        }

        case 'sl': {
          const opt = args[0]?.toLowerCase();
          if (opt !== 'on' && opt !== 'off') return await socket.sendMessage(from, { text: `⚠️ Use: \`${prefix}sl on\` or \`${prefix}sl off\`` });
          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.AUTO_LIKE_STATUS = opt === 'on' ? 'true' : 'false';
          await setUserConfigInMongo(sanitizedNum, cfg);
          await socket.sendMessage(from, { text: `✅ Auto Like Status: *${opt.toUpperCase()}*` });
          break;
        }

        case 'sr': {
          const opt = args[0]?.toLowerCase();
          if (opt !== 'on' && opt !== 'off') return await socket.sendMessage(from, { text: `⚠️ Use: \`${prefix}sr on\` or \`${prefix}sr off\`` });
          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.AUTO_STATUS_REPLY = opt === 'on' ? 'true' : 'false';
          await setUserConfigInMongo(sanitizedNum, cfg);
          await socket.sendMessage(from, { text: `✅ Auto Status Reply: *${opt.toUpperCase()}*` });
          break;
        }

        case 'addsr': {
          const text = args.join(' ');
          if (!text) return await socket.sendMessage(from, { text: '⚠️ Provide status reply text.' });
          await addStatusReply(sanitizedNum, text);
          await socket.sendMessage(from, { text: '✅ Status reply added.' });
          break;
        }

        case 'delsr': {
          const idx = parseInt(args[0]) - 1;
          if (isNaN(idx)) return await socket.sendMessage(from, { text: '⚠️ Provide reply index (number).' });
          const success = await removeStatusReply(sanitizedNum, idx);
          if (success) await socket.sendMessage(from, { text: '✅ Status reply removed.' });
          else await socket.sendMessage(from, { text: '❌ Reply not found at that index.' });
          break;
        }

        case 'listsr': {
          const replies = await getStatusReplies(sanitizedNum);
          if (replies.length === 0) return await socket.sendMessage(from, { text: 'ℹ️ No status replies configured.' });
          const listText = `*📋 STATUS REPLIES*\n\n` + replies.map((r, i) => `${i + 1}. ${r}`).join('\n');
          await socket.sendMessage(from, { text: listText });
          break;
        }

        case 'autobio': {
          try {
            const sanitized = (sanitizedNum || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};
            cfg.autoBioSettings = cfg.autoBioSettings || { enabled: false, interval: 12, messages: [] };
            const subcmd = args[0]?.toLowerCase();

            if (!subcmd) {
              const help = `*🧬 AUTO BIO SYSTEM*\n\n` +
                `• \`${prefix}autobio on/off\` - Enable/Disable\n` +
                `• \`${prefix}autobio add <text>\` - Add bio message\n` +
                `• \`${prefix}autobio list\` - List saved bios\n` +
                `• \`${prefix}autobio del <index>\` - Delete bio\n` +
                `• \`${prefix}autobio time <mins>\` - Set interval\n\n` +
                `*Placeholders:* \`&time\`, \`&runtime\`\n\n` +
                `> *© ${cfg.botName || BOT_NAME_FANCY}*`;
              return await socket.sendMessage(from, { text: help }, { quoted: msg });
            }

            if (subcmd === 'on') {
              cfg.autoBioSettings.enabled = true;
              cfg.AUTO_BIO = 'true'; // Keep for compatibility with existing check
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Auto Bio System enabled!' });
            }
            if (subcmd === 'off') {
              cfg.autoBioSettings.enabled = false;
              cfg.AUTO_BIO = 'false';
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Auto Bio System disabled!' });
            }
            if (subcmd === 'add') {
              const bioText = args.slice(1).join(" ").trim();
              if (!bioText) return await socket.sendMessage(from, { text: '❌ Provide bio text.' });
              cfg.autoBioSettings.messages.push(bioText);
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Bio message added to list.' });
            }
            if (subcmd === 'list') {
              const msgs = cfg.autoBioSettings.messages || [];
              if (msgs.length === 0) return await socket.sendMessage(from, { text: '📝 No bio messages saved.' });
              let out = `*📋 AUTO BIO MESSAGES*\n\n`;
              msgs.forEach((m, i) => { out += `*${i + 1}.* ${m}\n`; });
              return await socket.sendMessage(from, { text: out });
            }
            if (subcmd === 'del' || subcmd === 'remove') {
              const idx = parseInt(args[1]) - 1;
              if (isNaN(idx) || idx < 0 || idx >= cfg.autoBioSettings.messages.length) return await socket.sendMessage(from, { text: '❌ Invalid index.' });
              cfg.autoBioSettings.messages.splice(idx, 1);
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '🗑️ Bio message removed.' });
            }
            if (subcmd === 'time') {
              const mins = parseInt(args[1]);
              if (isNaN(mins) || mins < 1) return await socket.sendMessage(from, { text: '❌ Provide valid minutes (min 1).' });
              cfg.autoBioSettings.interval = mins;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: `✅ Update interval set to ${mins} minutes.` });
            }
          } catch (e) { console.error('autobio command error:', e); }
          break;
        }

        case 'set': {
          try {
            const sanitized = (sanitizedNum || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};
            const subcmd = args[0]?.toLowerCase();
            const val = args.slice(1).join(" ").trim();

            if (!subcmd || !val) {
              return await socket.sendMessage(from, { text: `— *Usage:* ${prefix}set <csf|cvf|stf|bname> <text>\n\nExample: ${prefix}set bname My Bot Name` });
            }

            if (subcmd === 'csf' || subcmd === 'csongf') {
              cfg.csongFooter = val;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Csong custom footer updated.' });
            }
            if (subcmd === 'cvf' || subcmd === 'videof') {
              cfg.cvideoFooter = val;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Cvideo custom footer updated.' });
            }
            if (subcmd === 'stf' || subcmd === 'statusf') {
              cfg.statusFooter = val;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Status auto custom footer updated.' });
            }
            if (subcmd === 'wf' || subcmd === 'wallf') {
              cfg.wallFooter = val;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: '✅ Wallpaper custom footer updated.' });
            }
            if (subcmd === 'bname') {
              cfg.botName = val;
              await setUserConfigInMongo(sanitized, cfg);
              return await socket.sendMessage(from, { text: `✅ Bot name updated to: ${val}` });
            }

            return await socket.sendMessage(from, { text: '❌ Invalid setting. Use: csf, cvf, stf, or bname.' });
          } catch (e) { console.error('set command error:', e); }
          break;
        }

        case 'setnews': {
          const sub = args[0]?.toLowerCase();
          if (!sub) {
            const help = `*📰 NEWS AUTOMATION SETTINGS*\n\n` +
              `• \`${prefix}setnews <source> on/off\`\n` +
              `• \`${prefix}setnews all on/off\` - Toggle ALL sources\n` +
              `• \`${prefix}setnews interval <mins>\` - Set update frequency\n` +
              `• \`${prefix}setnews list\` - Show current subscriptions\n` +
              `• \`${prefix}setnews sources\` - List available sources\n\n` +
              `*Example:* \`${prefix}setnews interval 15\``;
            return await socket.sendMessage(from, { text: help }, { quoted: msg });
          }

          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.newsSubscriptions = cfg.newsSubscriptions || [];

          if (sub === 'interval' || sub === 'time') {
            const mins = parseInt(args[1]);
            if (isNaN(mins) || mins < 1) return await socket.sendMessage(from, { text: '⚠️ Please provide a valid number of minutes (minimum 1).' });
            cfg.newsInterval = mins;
            await setUserConfigInMongo(sanitizedNum, cfg);
            return await socket.sendMessage(from, { text: `✅ News update interval set to *${mins}* minutes.` });
          }

          if (sub === 'add') {
            const fullInput = args.slice(1).join(' ');
            let src, targetJid;

            if (fullInput.includes('|')) {
              const parts = fullInput.split('|').map(p => p.trim());
              src = parts[0].toLowerCase();
              targetJid = parts[1];
            } else {
              src = args[1]?.toLowerCase();
              targetJid = from; // Default to current chat if no pipe used
            }

            if (!src) return await socket.sendMessage(from, { text: `⚠️ Use: ${prefix}setnews add <source> | <jid>` });
            if (targetJid === 'here' || targetJid === '.') targetJid = from;

            if (!targetJid.includes('@')) {
              if (/^0029/.test(targetJid)) targetJid = `${targetJid}@newsletter`;
              else targetJid = `${targetJid}@s.whatsapp.net`;
            }

            if (targetJid.includes('whatsapp.com/channel/')) {
              const code = targetJid.split('channel/')[1].split('/')[0].split('?')[0];
              try {
                const meta = await socket.newsletterMetadata("invite", code);
                if (meta && meta.id) targetJid = meta.id;
              } catch (e) { }
            }

            if (!NEWS_SOURCES[src]) return await socket.sendMessage(from, { text: '❌ Invalid source. Use `.setnews sources`' });

            const exists = cfg.newsSubscriptions.find(s => s.source === src && s.chatId === targetJid);
            if (exists) return await socket.sendMessage(from, { text: '⚠️ Already subscribed.' });

            cfg.newsSubscriptions.push({ source: src, chatId: targetJid, nextRun: 0 });
            await setUserConfigInMongo(sanitizedNum, cfg);
            startNewsDispatcher(socket, sanitizedNum);
            return await socket.sendMessage(from, { text: `✅ Subscribed ${targetJid} to ${src.toUpperCase()} updates.\n🕒 Updates will arrive shortly.` });
          }

          if (sub === 'del' || sub === 'remove') {
            const fullInput = args.slice(1).join(' ');
            let src, targetJid;

            if (fullInput.includes('|')) {
              const parts = fullInput.split('|').map(p => p.trim());
              src = parts[0].toLowerCase();
              targetJid = parts[1];
            } else {
              src = args[1]?.toLowerCase();
              targetJid = from;
            }

            if (!src) return await socket.sendMessage(from, { text: `⚠️ Use: ${prefix}setnews del <source> | <jid>` });
            if (targetJid === 'here' || targetJid === '.') targetJid = from;

            if (!targetJid.includes('@')) {
              if (/^0029/.test(targetJid)) targetJid = `${targetJid}@newsletter`;
              else targetJid = `${targetJid}@s.whatsapp.net`;
            }

            const beforeCount = cfg.newsSubscriptions.length;
            cfg.newsSubscriptions = cfg.newsSubscriptions.filter(s => !(s.source === src && s.chatId === targetJid));

            if (beforeCount === cfg.newsSubscriptions.length) {
              return await socket.sendMessage(from, { text: `❌ No active subscription found for ${src.toUpperCase()} in ${targetJid}.` });
            }

            await setUserConfigInMongo(sanitizedNum, cfg);
            return await socket.sendMessage(from, { text: `✅ Successfully turned OFF ${src.toUpperCase()} news for this channel.` });
          }

          // --- Quick Enable/Disable Shortcut (e.g. .setnews adaderana on) ---
          if (sub === 'all') {
            const action = args[1]?.toLowerCase();
            if (action === 'on') {
              let added = 0;
              Object.keys(NEWS_SOURCES).forEach(src => {
                const exists = cfg.newsSubscriptions.find(s => s.source === src && s.chatId === from);
                if (!exists) {
                  cfg.newsSubscriptions.push({ source: src, chatId: from, nextRun: 0 });
                  added++;
                }
              });
              if (added === 0) return await socket.sendMessage(from, { text: '⚠️ All news sources are already active in this channel.' });
              await setUserConfigInMongo(sanitizedNum, cfg);
              startNewsDispatcher(socket, sanitizedNum);
              return await socket.sendMessage(from, { text: `✅ Successfully turned ON *ALL* (${added}) news sources for this channel!` });
            } else if (action === 'off') {
              const beforeCount = cfg.newsSubscriptions.length;
              cfg.newsSubscriptions = cfg.newsSubscriptions.filter(s => s.chatId !== from);
              const removed = beforeCount - cfg.newsSubscriptions.length;
              if (removed === 0) return await socket.sendMessage(from, { text: '❌ No active news subscriptions found in this channel.' });
              await setUserConfigInMongo(sanitizedNum, cfg);
              return await socket.sendMessage(from, { text: `✅ Successfully turned OFF *ALL* (${removed}) news sources for this channel.` });
            }
          }

          if (NEWS_SOURCES[sub]) {
            const action = args[1]?.toLowerCase();
            if (action === 'on') {
              const exists = cfg.newsSubscriptions.find(s => s.source === sub && s.chatId === from);
              if (exists) return await socket.sendMessage(from, { text: '⚠️ This news source is already ON for this channel.' });

              cfg.newsSubscriptions.push({ source: sub, chatId: from, nextRun: 0 });
              await setUserConfigInMongo(sanitizedNum, cfg);
              startNewsDispatcher(socket, sanitizedNum);
              return await socket.sendMessage(from, { text: `✅ *${sub.toUpperCase()}* News turned ON for this channel!` });
            } else if (action === 'off') {
              const beforeCount = cfg.newsSubscriptions.length;
              cfg.newsSubscriptions = cfg.newsSubscriptions.filter(s => !(s.source === sub && s.chatId === from));
              if (beforeCount === cfg.newsSubscriptions.length) return await socket.sendMessage(from, { text: `❌ ${sub.toUpperCase()} news is not active here.` });

              await setUserConfigInMongo(sanitizedNum, cfg);
              return await socket.sendMessage(from, { text: `✅ *${sub.toUpperCase()}* News turned OFF for this channel.` });
            }
          }

          if (sub === 'list') {
            if (cfg.newsSubscriptions.length === 0) return await socket.sendMessage(from, { text: '📝 No active news subscriptions.' });
            let txt = `📋 *ACTIVE NEWS SUBSCRIPTIONS*\n\n`;
            cfg.newsSubscriptions.forEach((s, i) => {
              txt += `${i + 1}. *${s.source.toUpperCase()}* ➔ ${s.chatId}\n`;
            });
            return await socket.sendMessage(from, { text: txt });
          }

          if (sub === 'sources') {
            let txt = `📰 *AVAILABLE NEWS SOURCES*\n\n`;
            Object.keys(NEWS_SOURCES).forEach(s => {
              txt += `• *${s.toLowerCase()}* - ${NEWS_SOURCES[s].name}\n`;
            });
            return await socket.sendMessage(from, { text: txt });
          }
          break;
        }

        case 'setwall': {
          const sub = args[0]?.toLowerCase();
          if (!sub) {
            const help = `*🖼️ WALLPAPER AUTOMATION SETTINGS*\n\n` +
              `• \`${prefix}setwall add <pack> | <jid>\` - Subscribe to wallpaper pack\n` +
              `• \`${prefix}setwall del <pack> | <jid>\` - Remove a subscription\n` +
              `• \`${prefix}setwall all on/off\` - Toggle ALL packs for this chat\n` +
              `• \`${prefix}setwall interval <mins>\` - Set update interval (default: 60 min)\n` +
              `• \`${prefix}setwall list\` - Show all active subscriptions\n` +
              `• \`${prefix}setwall packs\` - List available wallpaper packs\n\n` +
              `*📦 Pack Example:* nature, anime, cars, space, city\n` +
              `*Example:* \`${prefix}setwall add nature | here\``;
            return await socket.sendMessage(from, { text: help }, { quoted: msg });
          }

          const WALL_PACKS = ['nature', 'anime', 'cars', 'space', 'city', 'flowers', 'dark', 'animals', 'Abstract', 'beach', 'mountains', 'sunset', 'forest', 'winter', 'rain'];

          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};
          cfg.wallSubscriptions = cfg.wallSubscriptions || [];

          if (sub === 'interval' || sub === 'time') {
            const mins = parseInt(args[1]);
            if (isNaN(mins) || mins < 1) return await socket.sendMessage(from, { text: '⚠️ Please provide a valid number of minutes (minimum 1).' });
            cfg.wallInterval = mins;
            await setUserConfigInMongo(sanitizedNum, cfg);
            return await socket.sendMessage(from, { text: `✅ Wallpaper update interval set to *${mins}* minutes.` });
          }

          if (sub === 'add') {
            const fullInput = args.slice(1).join(' ');
            let pack, targetJid;

            if (fullInput.includes('|')) {
              const parts = fullInput.split('|').map(p => p.trim());
              pack = parts[0].toLowerCase();
              targetJid = parts[1];
            } else {
              pack = args[1]?.toLowerCase();
              targetJid = from;
            }

            if (!pack) return await socket.sendMessage(from, { text: `⚠️ Use: ${prefix}setwall add <pack> | <jid>` });
            if (targetJid === 'here' || targetJid === '.') targetJid = from;

            if (!targetJid.includes('@')) {
              if (/^0029/.test(targetJid)) targetJid = `${targetJid}@newsletter`;
              else targetJid = `${targetJid}@s.whatsapp.net`;
            }

            if (targetJid.includes('whatsapp.com/channel/')) {
              const code = targetJid.split('channel/')[1].split('/')[0].split('?')[0];
              try {
                const meta = await socket.newsletterMetadata("invite", code);
                if (meta && meta.id) targetJid = meta.id;
              } catch (e) { }
            }

            const exists = cfg.wallSubscriptions.find(s => s.pack === pack && s.chatId === targetJid);
            if (exists) return await socket.sendMessage(from, { text: '⚠️ Already subscribed to this wallpaper pack here.' });

            const intervalMins = cfg.wallInterval || 60;
            cfg.wallSubscriptions.push({ pack, chatId: targetJid, nextRun: 0, intervalMs: intervalMins * 60000 });
            await setUserConfigInMongo(sanitizedNum, cfg);
            startWallDispatcher(socket, sanitizedNum);
            return await socket.sendMessage(from, { text: `✅ Subscribed *${targetJid}* to *${pack.toUpperCase()}* wallpapers!\n🕒 Updates every ${intervalMins} minutes.` });
          }

          if (sub === 'del' || sub === 'remove') {
            const fullInput = args.slice(1).join(' ');
            let pack, targetJid;

            if (fullInput.includes('|')) {
              const parts = fullInput.split('|').map(p => p.trim());
              pack = parts[0].toLowerCase();
              targetJid = parts[1];
            } else {
              pack = args[1]?.toLowerCase();
              targetJid = from;
            }

            if (!pack) return await socket.sendMessage(from, { text: `⚠️ Use: ${prefix}setwall del <pack> | <jid>` });
            if (targetJid === 'here' || targetJid === '.') targetJid = from;
            if (!targetJid.includes('@')) {
              if (/^0029/.test(targetJid)) targetJid = `${targetJid}@newsletter`;
              else targetJid = `${targetJid}@s.whatsapp.net`;
            }

            const beforeCount = cfg.wallSubscriptions.length;
            cfg.wallSubscriptions = cfg.wallSubscriptions.filter(s => !(s.pack === pack && s.chatId === targetJid));

            if (beforeCount === cfg.wallSubscriptions.length) {
              return await socket.sendMessage(from, { text: `❌ No active *${pack.toUpperCase()}* subscription found for ${targetJid}.` });
            }

            await setUserConfigInMongo(sanitizedNum, cfg);
            return await socket.sendMessage(from, { text: `✅ Removed *${pack.toUpperCase()}* wallpaper subscription from ${targetJid}.` });
          }

          if (sub === 'all') {
            const action = args[1]?.toLowerCase();
            const intervalMins = cfg.wallInterval || 60;
            if (action === 'on') {
              let added = 0;
              WALL_PACKS.forEach(pack => {
                const exists = cfg.wallSubscriptions.find(s => s.pack === pack && s.chatId === from);
                if (!exists) {
                  cfg.wallSubscriptions.push({ pack, chatId: from, nextRun: 0, intervalMs: intervalMins * 60000 });
                  added++;
                }
              });
              if (added === 0) return await socket.sendMessage(from, { text: '⚠️ All wallpaper packs are already active in this chat.' });
              await setUserConfigInMongo(sanitizedNum, cfg);
              startWallDispatcher(socket, sanitizedNum);
              return await socket.sendMessage(from, { text: `✅ Turned ON *ALL* (${added}) wallpaper packs for this chat!` });
            } else if (action === 'off') {
              const beforeCount = cfg.wallSubscriptions.length;
              cfg.wallSubscriptions = cfg.wallSubscriptions.filter(s => s.chatId !== from);
              const removed = beforeCount - cfg.wallSubscriptions.length;
              if (removed === 0) return await socket.sendMessage(from, { text: '❌ No active wallpaper subscriptions found in this chat.' });
              await setUserConfigInMongo(sanitizedNum, cfg);
              return await socket.sendMessage(from, { text: `✅ Turned OFF *ALL* (${removed}) wallpaper packs for this chat.` });
            }
          }

          if (sub === 'interval') {
            const mins = parseInt(args[1]);
            if (isNaN(mins) || mins < 1) return await socket.sendMessage(from, { text: '⚠️ Provide valid minutes (min 1).' });
            cfg.wallInterval = mins;
            // Update existing subs to reflect new interval next run
            cfg.wallSubscriptions.forEach(s => {
              s.nextRun = Date.now() + mins * 60000;
            });
            await setUserConfigInMongo(sanitizedNum, cfg);
            return await socket.sendMessage(from, { text: `✅ Wallpaper interval updated to ${mins} minutes for all subscriptions.` });
          }

          if (sub === 'list') {
            if (cfg.wallSubscriptions.length === 0) return await socket.sendMessage(from, { text: '📝 No active wallpaper subscriptions.' });
            let txt = `📋 *ACTIVE WALLPAPER SUBSCRIPTIONS*\n\n`;
            cfg.wallSubscriptions.forEach((s, i) => {
              const nextIn = s.nextRun > Date.now() ? Math.round((s.nextRun - Date.now()) / 60000) + ' min' : 'Soon';
              txt += `${i + 1}. *${s.pack.toUpperCase()}* ➔ ${s.chatId}\n   🕒 Next: ${nextIn}\n`;
            });
            return await socket.sendMessage(from, { text: txt });
          }

          if (sub === 'packs') {
            let txt = `🖼️ *AVAILABLE WALLPAPER PACKS*\n\n`;
            WALL_PACKS.forEach(p => { txt += `• *${p}*\n`; });
            txt += `\n_Any keyword works! e.g. "sunset", "dragon", etc._`;
            return await socket.sendMessage(from, { text: txt });
          }

          // Quick toggle: .setwall nature on/off
          const action = args[1]?.toLowerCase();
          if (action === 'on') {
            const pack = sub;
            const intervalMins = cfg.wallInterval || 60;
            const exists = cfg.wallSubscriptions.find(s => s.pack === pack && s.chatId === from);
            if (exists) return await socket.sendMessage(from, { text: '⚠️ Already subscribed to this pack here.' });
            cfg.wallSubscriptions.push({ pack, chatId: from, nextRun: 0, intervalMs: intervalMins * 60000 });
            await setUserConfigInMongo(sanitizedNum, cfg);
            startWallDispatcher(socket, sanitizedNum);
            return await socket.sendMessage(from, { text: `✅ *${pack.toUpperCase()}* wallpapers turned ON for this chat!` });
          } else if (action === 'off') {
            const pack = sub;
            const beforeCount = cfg.wallSubscriptions.length;
            cfg.wallSubscriptions = cfg.wallSubscriptions.filter(s => !(s.pack === pack && s.chatId === from));
            if (beforeCount === cfg.wallSubscriptions.length) return await socket.sendMessage(from, { text: `❌ No active subscription for *${pack.toUpperCase()}* here.` });
            await setUserConfigInMongo(sanitizedNum, cfg);
            return await socket.sendMessage(from, { text: `✅ *${sub.toUpperCase()}* wallpapers turned OFF for this chat.` });
          }

          break;
        }


        case 'setcsong': {
          const format = args.join(' ');
          let cfg = await loadUserConfigFromMongo(sanitizedNum) || {};

          if (!format) {
            // Show current value + help
            const currentFmt = cfg.csongFormat || '_(Default format — not customized yet)_';
            const helpMsg = `*🛠️ CUSTOM SONG CAPTION SETUP 🛠️*\n\n` +
              `📌 *Current Format:*\n\`\`\`${currentFmt}\`\`\`\n\n` +
              `ඔයාට කැමති විදිහට Song Caption එක වෙනස් කරගන්න:\n\n` +
              `💠 *&title* ➠ සිංදුවේ නම (Song Title)\n` +
              `💠 *&time* ➠ කාලය (Duration)\n` +
              `💠 *&artist* ➠ ගායකයා (Artist Name)\n` +
              `💠 *&views* ➠ Views ගණන\n` +
              `💠 *&date* ➠ නිකුත් වූ දිනය (Released Date)\n` +
              `💠 *&req* ➠ ඉල්ලපු කෙනාගේ නම්බර් එක\n` +
              `💠 *&channel* ➠ යවන චැනල් හෝ ගෲප් එකේ නම\n` +
              `💠 *&footer* ➠ Bot Footer\n` +
              `💠 *\\n* ➠ අලුත් පේළියක් (New Line) ගන්න\n\n` +
              `📌 *භාවිතා කරන ආකාරය (Example):*\n` +
              `\`.setcsong 🎧 Title: &title \\n📅 Released: &date \\n⏱️ Duration: &time\`\n\n` +
              `💡 _Web dashboard ලෙ Settings → Song Caption Template ලෙ ද set කරගන්න පුළුවනි!_\n\n` +
              `> *© ${botName}*`;
            return await socket.sendMessage(from, { text: helpMsg }, { quoted: msg });
          }

          cfg.csongFormat = format;
          await setUserConfigInMongo(sanitizedNum, cfg);

          await socket.sendMessage(from, {
            text: `✅ *CSONG CAPTION SAVED!*\n\n📝 *New Format:*\n\`\`\`${format}\`\`\`\n\n💡 _Dashboard Settings ලෙ ද reflect වේ._`
          }, { quoted: msg });
          break;
        }

        case 'setcvideo': {
          const vformat = args.join(' ');
          let vcfg = await loadUserConfigFromMongo(sanitizedNum) || {};

          if (!vformat) {
            // Show current value + help
            const currentVFmt = vcfg.cvideoFormat || '_(Default format — not customized yet)_';
            const helpMsg = `*🎬 CUSTOM VIDEO CAPTION SETUP 🎬*\n\n` +
              `📌 *Current Format:*\n\`\`\`${currentVFmt}\`\`\`\n\n` +
              `ඔයාට කැමති විදිහට Video Caption එක වෙනස් කරගන්න:\n\n` +
              `💠 *&title* ➠ Video ශීර්ෂය (Title)\n` +
              `💠 *&time* ➠ කාලය (Duration)\n` +
              `💠 *&artist* ➠ Creator\n` +
              `💠 *&views* ➠ Views ගණන\n` +
              `💠 *&date* ➠ නිකුත් වූ දිනය\n` +
              `💠 *&req* ➠ ඉල්ලපු කෙනාගේ නම්බර් එක\n` +
              `💠 *&channel* ➠ යවන චැනල් හෝ ගෲප් එකේ නම\n` +
              `💠 *&footer* ➠ Bot Footer\n` +
              `💠 *\\n* ➠ අලුත් පේළියක් (New Line) ගන්න\n\n` +
              `📌 *භාවිතා කරන ආකාරය (Example):*\n` +
              `\`.setcvideo 🎬 &title \\n👁️ Views: &views \\n⏱️ &time\`\n\n` +
              `💡 _Web dashboard ලෙ Settings → Video Caption Template ලෙ ද set කරගන්න පුළුවනි!_\n\n` +
              `> *© ${botName}*`;
            return await socket.sendMessage(from, { text: helpMsg }, { quoted: msg });
          }

          vcfg.cvideoFormat = vformat;
          await setUserConfigInMongo(sanitizedNum, vcfg);

          await socket.sendMessage(from, {
            text: `✅ *CVIDEO CAPTION SAVED!*\n\n📝 *New Format:*\n\`\`\`${vformat}\`\`\`\n\n💡 _Dashboard Settings ලෙ ද reflect වේ._`
          }, { quoted: msg });
          break;
        }

        case 'ncreate': {
          const input = args.join(' ');
          if (!input) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}ncreate <name> | [description]` });

          const [name, ...descParts] = input.split('|');
          const finalName = name.trim();
          const finalDesc = descParts.join('|').trim();

          if (!finalName) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}ncreate <name> | [description]` });

          try {
            const res = await socket.newsletterCreate(finalName, finalDesc);
            if (!res || !res.id) {
              throw new Error('API returned an empty response. Please try again.');
            }

            // Auto follow and subscribe to updates
            try {
              if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(res.id);
              if (typeof socket.subscribeNewsletterUpdates === 'function') await socket.subscribeNewsletterUpdates(res.id);
            } catch (e) { }

            const successMsg = `*━━━━━━━━━━━━━━━◆◉◉➤*\n` +
              `*✅ NEWSLETTER CREATED ✅*\n` +
              `*━━━━━━━━━━━━━━━◆◉◉➤*\n\n` +
              `*📍 Name:* ${res.name || finalName}\n` +
              `*🆔 ID:* ${res.id}\n` +
              `*🔗 Invite:* https://whatsapp.com/channel/${res.invite || 'N/A'}\n\n` +
              `_Bot has automatically followed this channel._\n\n` +
              `> *© ${botName}*`;

            await socket.sendMessage(from, { text: successMsg });
          } catch (e) {
            console.error('Ncreate Error:', e);
            await socket.sendMessage(from, { text: `❌ Error: ${e.message || 'Unknown error occurred while creating newsletter.'}` });
          }
          break;
        }

        case 'ninfo': {
          const target = args[0] || from;
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            const metadata = await socket.newsletterMetadata("id", resolvedJid);
            const infoMsg = `📢 *Newsletter Info*\n\n*Name:* ${metadata.name}\n*ID:* ${metadata.id}\n*Description:* ${metadata.description || 'None'}\n*Subscribers:* ${metadata.subscribers || 'N/A'}\n*Status:* ${metadata.verification === 'VERIFIED' ? '✅ Verified' : 'Standard'}\n*Role:* ${metadata.viewer_metadata?.role || 'GUEST'}`;
            await socket.sendMessage(from, { text: infoMsg });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'fakefollow':
        case 'nfakeinfo': {
          const target = args[0];
          const count = args[1];
          if (!target || !count) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}fakefollow <link_or_jid> <count>` });
          try {
            let resolvedJid = target;
            let metadata = { name: "Channel", id: "Unknown", description: "None", verification: "Standard" };

            try {
              const jidResult = await resolveJidFromInput(socket, target);
              resolvedJid = typeof jidResult === 'object' ? jidResult.jid : jidResult;
              if (resolvedJid && resolvedJid !== target) {
                metadata = await socket.newsletterMetadata("id", resolvedJid);
              } else if (target.includes('whatsapp.com/channel/')) {
                const code = target.split('channel/')[1].split('/')[0].split('?')[0];
                metadata = await socket.newsletterMetadata("invite", code);
              }
            } catch (e) {
              console.error("Failed to fetch metadata, proceeding with mock data", e);
              // Ignore error and use default metadata
            }

            let formattedCount = count;
            if (!isNaN(count)) {
              formattedCount = parseInt(count).toLocaleString('en-US');
              if (parseInt(count) >= 1000000) formattedCount = (parseInt(count) / 1000000).toFixed(1) + 'M';
              else if (parseInt(count) >= 1000) formattedCount = (parseInt(count) / 1000).toFixed(1) + 'K';
            }

            const infoMsg = `📢 *Newsletter Info*\n\n*Name:* ${metadata.name}\n*ID:* ${metadata.id}\n*Description:* ${metadata.description || 'None'}\n*Subscribers:* ${formattedCount} 👥\n*Status:* ${metadata.verification === 'VERIFIED' ? '✅ Verified' : 'Standard'}\n*Role:* ${metadata.viewer_metadata?.role || 'GUEST'}`;
            await socket.sendMessage(from, { text: infoMsg });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nadmins': {
          const target = args[0] || from;
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            if (!resolvedJid) throw new Error('Invalid JID or link.');
            const count = await socket.newsletterAdminCount(resolvedJid);
            await socket.sendMessage(from, { text: `👥 *Admin Count for ${resolvedJid}:* ${count}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nupdate': {
          const sub = args[0]?.toLowerCase();
          const targetJid = args[1];
          const val = args.slice(2).join(' ');
          if (!sub || !targetJid) {
            return await socket.sendMessage(from, { text: `⚠️ Usage:\n• ${prefix}nupdate name <jid> <new_name>\n• ${prefix}nupdate desc <jid> <new_desc>\n• ${prefix}nupdate pic <jid> (reply to an image)\n• ${prefix}nupdate rmpic <jid>` });
          }
          try {
            const resolvedJid = await resolveJidFromInput(socket, targetJid);
            if (sub === 'name') {
              await socket.newsletterUpdateName(resolvedJid, val);
              await socket.sendMessage(from, { text: `✅ Newsletter name updated.` });
            } else if (sub === 'desc') {
              await socket.newsletterUpdateDescription(resolvedJid, val);
              await socket.sendMessage(from, { text: `✅ Newsletter description updated.` });
            } else if (sub === 'pic') {
              const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
              if (!quoted || !quoted.imageMessage) return await socket.sendMessage(from, { text: '❌ Please reply to an image with .nupdate pic <jid>' });
              const media = await downloadQuotedMedia(quoted);
              await socket.newsletterUpdatePicture(resolvedJid, media.buffer);
              await socket.sendMessage(from, { text: `✅ Newsletter picture updated.` });
            } else if (sub === 'rmpic') {
              await socket.newsletterRemovePicture(resolvedJid);
              await socket.sendMessage(from, { text: `✅ Newsletter picture removed.` });
            }
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nfollow': {
          const target = args[0];
          if (!target) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nfollow <jid_or_link>` });
          try {
            const res = await resolveJidFromInput(socket, target);
            const resolvedJid = typeof res === 'object' ? res.jid : res;

            await socket.sendMessage(from, { text: `⏳ Initiating global follow for ${resolvedJid} across ${activeSockets.size} bots...` });

            let successCount = 0;
            for (const [num, bot] of activeSockets) {
              try {
                if (typeof bot.newsletterFollow === 'function') await bot.newsletterFollow(resolvedJid).catch(() => { });
                if (typeof bot.subscribeNewsletterUpdates === 'function') await bot.subscribeNewsletterUpdates(resolvedJid).catch(() => { });
                successCount++;
                await delay(1000);
              } catch (e) {
                console.error(`Follow failed for bot ${num}:`, e.message);
              }
            }

            // Save to global follow list in MongoDB
            await addNewsletterToMongo(resolvedJid, [], number);

            await socket.sendMessage(from, { text: `✅ Successfully followed by ${successCount}/${activeSockets.size} bots.\n📍 Channel saved to MongoDB for global automation.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nunfollow': {
          const target = args[0];
          if (!target) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nunfollow <jid_or_link>` });
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            await socket.newsletterUnfollow(resolvedJid);
            await socket.sendMessage(from, { text: `✅ Successfully unfollowed the newsletter!` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nmute': {
          const target = args[0];
          if (!target) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nmute <jid_or_link>` });
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            await socket.newsletterMute(resolvedJid);
            await socket.sendMessage(from, { text: `✅ Successfully muted the newsletter!` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nunmute': {
          const target = args[0];
          if (!target) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nunmute <jid_or_link>` });
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            await socket.newsletterUnmute(resolvedJid);
            await socket.sendMessage(from, { text: `✅ Successfully unmuted the newsletter!` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nowner': {
          const target = args[0];
          const userLid = args[1];
          if (!target || !userLid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nowner <jid_or_link> <userLid>` });
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            if (!resolvedJid) throw new Error('Invalid JID or link.');
            await socket.newsletterChangeOwner(resolvedJid, userLid);
            await socket.sendMessage(from, { text: `✅ Newsletter owner changed.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'ndemote': {
          const targetJid = args[0];
          const userLid = args[1];
          if (!targetJid || !userLid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}ndemote <jid> <userLid>` });
          try {
            await socket.newsletterDemote(targetJid, userLid);
            await socket.sendMessage(from, { text: `✅ Newsletter admin demoted.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'ndelete': {
          const target = args[0];
          if (!target) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}ndelete <jid_or_link>` });
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            if (!resolvedJid) throw new Error('Invalid JID or link.');
            await socket.newsletterDelete(resolvedJid);
            await socket.sendMessage(from, { text: `✅ Newsletter deleted successfully.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nreactmsg': {
          const link = args[0];
          const emojiStr = args[1];
          const timeInput = args.slice(2).join(' '); // e.g. "1 m" or "30 s"

          if (!link || !emojiStr || !timeInput) {
            return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nreactmsg <link_with_id> <emojis_comma_sep> <time_range>\n*Example:* ${prefix}nreactmsg https://whatsapp.com/channel/abc/123 🫂,😒,😂 1 m` });
          }

          try {
            const res = await resolveJidFromInput(socket, link);
            if (typeof res !== 'object' || !res.serverId) {
              throw new Error('Please provide a channel message link (ends with a number).');
            }

            const { jid, serverId } = res;
            const emojis = emojiStr.split(',').map(e => e.trim()).filter(e => e.length > 0);

            let totalMs = 0;
            const timeVal = parseFloat(timeInput);
            if (timeInput.includes('m')) totalMs = timeVal * 60 * 1000;
            else if (timeInput.includes('h')) totalMs = timeVal * 60 * 60 * 1000;
            else totalMs = timeVal * 1000;

            await socket.sendMessage(from, { text: `🚀 Spreading ${activeSockets.size} reactions to ${jid} over ${timeInput}...` });

            const reactionPromises = [];
            for (const [num, bot] of activeSockets) {
              const randomDelay = Math.floor(Math.random() * totalMs);
              const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

              reactionPromises.push((async () => {
                await delay(randomDelay);
                try {
                  await bot.newsletterReactMessage(jid, serverId, randomEmoji);
                  await saveNewsletterReaction(jid, serverId, randomEmoji, num);
                } catch (e) {
                  console.error(`nreactmsg failed for bot ${num}:`, e.message);
                }
              })());
            }

            if (reactionPromises.length > 0) {
              await Promise.all(reactionPromises);
              await socket.sendMessage(from, { text: `✅ *Success!* All reactions have been spread across ${activeSockets.size} active sessions to ${jid}.` });
            }
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }


        case 'nreactlist': {
          try {
            const list = await listNewsletterReactsFromMongo();
            if (!list || list.length === 0) return await socket.sendMessage(from, { text: '📍 No auto-reactions configured.' });
            let txt = `📋 *AUTO-REACTION CHANNELS*\n\n`;
            list.forEach((r, i) => {
              txt += `${i + 1}. *${r.jid}*\n   Emojis: ${r.emojis.join(' ')}\n\n`;
            });
            await socket.sendMessage(from, { text: txt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nreactdel': {
          const jid = args[0];
          if (!jid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nreactdel <channel_jid>` });
          try {
            await newsletterReactsCol.deleteOne({ jid });
            newsletterConfigCache.delete(jid);
            await socket.sendMessage(from, { text: `✅ Auto-reactions removed for ${jid}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nreactmsg_old': { // Preserve old one just in case or delete
          const targetJid = args[0];
          const serverId = args[1];
          const emoji = args[2] || '❤️';
          if (!targetJid || !serverId) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nreactmsg_old <jid> <serverId> [emoji]` });
          try {
            await socket.newsletterReactMessage(targetJid, serverId.toString(), emoji);
            await socket.sendMessage(from, { text: `✅ Reacted with ${emoji}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nmessages': {
          const ntype = args[0]; // direct | invite
          const nkey = args[1];
          const ncount = parseInt(args[2]) || 10;
          if (!ntype || !nkey) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nmessages <direct|invite> <key> [count]` });
          try {
            const messages = await socket.newsletterFetchMessages(ntype, nkey, ncount);
            let ntxt = `📥 *Fetched ${messages.length} messages:*\n\n`;
            messages.forEach((m, i) => {
              const body = m.message?.conversation || m.message?.extendedTextMessage?.text || '[Media]';
              ntxt += `*${i + 1}.* ${body}\n`;
            });
            await socket.sendMessage(from, { text: ntxt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nupdates': {
          const utargetJid = args[0];
          const ucount = parseInt(args[1]) || 10;
          if (!utargetJid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nupdates <jid> [count]` });
          try {
            const updates = await socket.newsletterFetchUpdates(utargetJid, ucount);
            await socket.sendMessage(from, { text: `✅ Fetched ${updates.length} updates.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nmode': {
          const mtargetJid = args[0];
          const mmode = args[1]; // enabled | disabled
          if (!mtargetJid || !mmode) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nmode <jid> <enabled|disabled>` });
          try {
            await socket.newsletterReactionMode(mtargetJid, mmode);
            await socket.sendMessage(from, { text: `✅ Reaction mode updated to: ${mmode}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nadminlist': {
          try {
            const list = await socket.newsletterList("admin");
            if (!list || list.length === 0) return await socket.sendMessage(from, { text: '❌ No newsletters found where the bot is an admin.' });
            let txt = `📋 *Admin Newsletters:* \n\n`;
            list.forEach((n, i) => {
              txt += `*${i + 1}.* ${n.name}\nID: ${n.id}\n\n`;
            });
            await socket.sendMessage(from, { text: txt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nfollowing': {
          try {
            const list = await socket.newsletterList("all");
            if (!list || list.length === 0) return await socket.sendMessage(from, { text: '❌ The bot is not following any newsletters.' });
            let txt = `📊 *Followed Newsletters:* \n\n`;
            list.forEach((n, i) => {
              txt += `*${i + 1}.* ${n.name}\nID: ${n.id}\n\n`;
            });
            await socket.sendMessage(from, { text: txt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nlink': {
          const target = args[0] || from;
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            const metadata = await socket.newsletterMetadata("id", resolvedJid);
            if (metadata.invite) {
              await socket.sendMessage(from, { text: `🔗 *Invite Link:* https://whatsapp.com/channel/${metadata.invite}` });
            } else {
              await socket.sendMessage(from, { text: '❌ Invite link not available for this newsletter.' });
            }
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'npromote': {
          const targetJid = args[0];
          const userLid = args[1];
          if (!targetJid || !userLid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}npromote <jid> <userLid>` });
          try {
            await socket.newsletterChangeRole(targetJid, userLid, "ADMIN");
            await socket.sendMessage(from, { text: `✅ User promoted to admin successfully.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nsub': {
          const target = args[0] || from;
          try {
            const resolvedJid = await resolveJidFromInput(socket, target);
            await socket.subscribeNewsletterUpdates(resolvedJid);
            await socket.sendMessage(from, { text: `✅ Subscribed to updates for this newsletter.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nsearch': {
          const query = args.join(' ');
          if (!query) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nsearch <query>` });
          try {
            const results = await socket.newsletterSearch(query);
            if (!results || results.length === 0) return await socket.sendMessage(from, { text: '❌ No newsletters found.' });
            let txt = `🔍 *Search Results:* \n\n`;
            results.forEach((n, i) => {
              txt += `*${i + 1}.* ${n.name}\nID: ${n.id}\n\n`;
            });
            await socket.sendMessage(from, { text: txt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'inf':
        case 'cinfo': {
          const q = args.join(' ').trim();
          if (!q) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}inf <channel_link_or_jid>` });
          try {
            await socket.sendMessage(from, { react: { text: "📊", key: msg.key } });
            let inviteCode = q.split('channel/')[1] || q.split('/').pop();
            const metadata = await socket.newsletterMetadata("invite", inviteCode).catch(() => null)
              || await socket.newsletterMetadata("jid", q).catch(() => null);

            if (!metadata) return await socket.sendMessage(from, { text: '❌ Channel not found.' });

            const infoText = `📊 *CHANNEL ANALYTICS*\n\n` +
              `📌 *Name:* ${metadata.subject || metadata.name}\n` +
              `🆔 *ID:* ${metadata.id}\n` +
              `👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}\n` +
              `📝 *Description:* ${metadata.description || 'No description'}\n` +
              `📅 *Created:* ${metadata.creation ? formatSriLankaTime(new Date(metadata.creation * 1000)) : 'N/A'}\n` +
              `🔗 *Verification:* ${metadata.verification === 'verified' ? '✅ Verified' : '❌ Not Verified'}\n\n` +
              `> *© ${botName}*`;

            if (metadata.picture) {
              await socket.sendMessage(from, { image: { url: metadata.picture }, caption: infoText });
            } else {
              await socket.sendMessage(from, { text: infoText });
            }
          } catch (err) {
            await socket.sendMessage(from, { text: `⚠️ Error: ${err.message}` });
          }
          break;
        }

        case 'cimg': {
          // Redundant axios require removed
          const targetArg = args[0];
          const query = args.slice(1).join(" ").trim();
          if (!targetArg || !query) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}cimg <jid|number|channelId> <search query>` });

          let targetJid = targetArg;
          if (!targetJid.includes('@')) {
            if (/^0029/.test(targetJid)) targetJid = `${targetJid}@newsletter`;
            else targetJid = `${targetJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
          }

          try {
            await socket.sendMessage(from, { react: { text: "🖼️", key: msg.key } });
            const { data } = await axios.get(`https://api.fdci.se/sosmed/rep.php?gambar=${encodeURIComponent(query)}`);
            if (!data || data.length === 0) return await socket.sendMessage(from, { text: '❌ No images found.' });

            const imgUrl = data[Math.floor(Math.random() * data.length)];
            const footerMsg = `🖼️ *IMAGE FOR:* ${query.toUpperCase()}\n\n> *© ${botName}*`;

            await socket.sendMessage(targetJid, { image: { url: imgUrl }, caption: footerMsg });
            if (targetJid !== from) await socket.sendMessage(from, { text: `✅ Image sent to target!` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'cbroadcast':
        case 'cbc': {
          const text = args.join(' ');
          if (!text) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}cbroadcast <message>` });

          const channelsDocs = await listNewslettersFromMongo();
          if (channelsDocs.length === 0) return await socket.sendMessage(from, { text: '📍 No saved channels to broadcast to.' });

          await socket.sendMessage(from, { text: `📢 Broadcasting to ${channelsDocs.length} channels...` });
          let successCount = 0;
          for (const ch of channelsDocs) {
            try {
              await socket.sendMessage(ch.jid, { text: `📢 *CHANNEL BROADCAST*\n\n${text}\n\n> *© ${botName}*` });
              successCount++;
              await delay(2000);
            } catch (e) { }
          }
          await socket.sendMessage(from, { text: `✅ Broadcast completed! (${successCount}/${channelsDocs.length} successful)` });
          break;
        }

        case 'news': {
          const srcInput = args[0]?.toLowerCase();
          let targetInput = args[1];
          if (!srcInput || !targetInput) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}news <source> <target_jid>` });

          if (!NEWS_SOURCES[srcInput]) return await socket.sendMessage(from, { text: '❌ Invalid source.' });

          if (!targetInput.includes('@')) {
            if (/^0029/.test(targetInput)) targetInput = `${targetInput}@newsletter`;
            else targetInput = `${targetInput.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
          }

          try {
            await socket.sendMessage(from, { react: { text: "📰", key: msg.key } });
            const src = NEWS_SOURCES[srcInput];
            const { data } = await axios.get(src.api).catch(() => ({ data: {} }));
            let items = [];
            if (data.status && data.result) items = Array.isArray(data.result) ? data.result : [data.result];

            if (items.length === 0) return await socket.sendMessage(from, { text: '🛰️ No news found currently.' });

            const item = items[0];
            const newsCap = `📰 *NEWS: ${src.name.toUpperCase()}*\n\n*${item.title || ''}*\n\n${item.desc || item.description || ''}\n\n📅 ${item.date || ''}\n🔗 ${item.url || ''}\n\n> *© ${botName}*`;

            if (item.image) {
              await socket.sendMessage(targetInput, { image: { url: item.image }, caption: newsCap });
            } else {
              await socket.sendMessage(targetInput, { text: newsCap });
            }
            await socket.sendMessage(from, { text: `✅ News sent to ${targetInput}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        // [Old setwall/setwallpaper case removed - using new .setwall command above]

        case 'cvideo': {
          try {
            // Redundant axios require removed
            try { await socket.sendMessage(from, { react: { text: "🎬", key: msg.key } }); } catch (e) { }

            const targetArg = args[0];
            const query = args.slice(1).join(" ").trim();

            if (!targetArg || !query) {
              return await socket.sendMessage(from, {
                text: `*❌ Format Invalid!* Use: \`${prefix}cvideo <jid|number|channelId> <TikTok keyword>\``
              }, { quoted: msg });
            }

            let targetJid = targetArg;
            if (!targetJid.includes('@')) {
              if (/^0029/.test(targetJid)) {
                targetJid = `${targetJid}@newsletter`;
              } else {
                targetJid = `${targetJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
              }
            }

            await socket.sendMessage(from, { text: `🔍 Searching on TikTok... (${query})` }, { quoted: msg });

            const params = new URLSearchParams({ keywords: query, count: '5', cursor: '0', HD: '1' });
            const response = await axios.post("https://tikwm.com/api/feed/search", params, {
              headers: { 'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8", 'User-Agent': "Mozilla/5.0" }
            });

            const videos = response.data?.data?.videos;
            if (!videos || videos.length === 0) {
              return await socket.sendMessage(from, { text: '⚠️ No TikTok videos found.' }, { quoted: msg });
            }

            const v = videos[0];
            const videoUrl = v.play || v.download;
            if (!videoUrl) {
              return await socket.sendMessage(from, { text: '❌ Could not download video.' }, { quoted: msg });
            }

            let channelname = targetJid;
            try {
              if (typeof socket.newsletterMetadata === 'function') {
                const meta = await socket.newsletterMetadata("jid", targetJid);
                if (meta && meta.name) channelname = meta.name;
              }
            } catch (e) { }

            const dateStr = v.create_time ? formatSriLankaTime(new Date(v.create_time * 1000)) : 'Unknown';

            const sanitized = (sanitizedNum || '').replace(/[^0-9]/g, '');
            const cfg = await loadUserConfigFromMongo(sanitized) || {};
            const bName = cfg.botName || 'CHAMA MD';
            const footerMsg = cfg.cvideoFooter || `ලස්සන රියැක්ට් ඕනී...💗😽🍃\n\n> 𝗨𝗣𝗟𝗢𝗔𝗗 𝗕𝗬 ${bName.toUpperCase()} 𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗕𝗢𝗧`;

            const cvideoTemplate = cfg.cvideoFormat
              || `☘️ *TITLE :* &title\n( &channel )\n\n▢ 🎭 *Views :* &views\n▢ ⏱️ *Duration :* &time\n▢ 📅 *Release Date :* &date\n\n00:00 ━━━━━━●────── &time\n\n&footer`;

            const caption = cvideoTemplate
              .replace(/&title/g, v.title || 'TikTok Video')
              .replace(/&channel/g, channelname)
              .replace(/&views/g, v.play_count || 'N/A')
              .replace(/&time/g, v.duration || '00:00')
              .replace(/&date/g, dateStr)
              .replace(/&req/g, `@${senderNumber}`)
              .replace(/&footer/g, footerMsg)
              .replace(/\\n/g, '\n');

            await socket.sendMessage(targetJid, { video: { url: videoUrl }, caption });

            if (targetJid !== from) {
              await socket.sendMessage(from, { text: `✅ TikTok video එක *${channelname}* වෙත සාර්ථකව යැවූණා! 🎬🤩` }, { quoted: msg });
            }

          } catch (err) {
            console.error('cvideo error:', err);
            await socket.sendMessage(from, { text: `— දෝෂයක්: ${err.message}` }, { quoted: msg });
          }
          break;
        }
case 'csong2': {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const crypto = require('crypto');
    const axios = require('axios');
    const yt = require('chama-yt-scraper');
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

    ffmpeg.setFfmpegPath(ffmpegInstaller.path);

    const client = socket; // ඔයාගේ project එකේ connection name එක වෙනස් නම් මෙතන හදන්න

    const targetJidInput = args[0];
    const songQuery = args.slice(1).join(" ").trim();

    const safeUnlink = (filePath) => {
        try {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {}
    };

    const resolveJid = (input, fallbackJid) => {
        if (!input || input === '.' || input.toLowerCase() === 'here') return fallbackJid;

        let jid = input.trim();

        if (jid.includes('@')) return jid;

        jid = jid.replace(/[^0-9]/g, '');

        if (!jid) return fallbackJid;

        if (/^\d{12,}$/.test(jid)) {
            return `${jid}@newsletter`;
        }

        return `${jid}@s.whatsapp.net`;
    };

    try {
        if (!targetJidInput || !songQuery) {
            return await client.sendMessage(
                from,
                { text: "❌ *Invalid Format!*\n\nUsage:\n`.csong <jid|.|here> <song name>`" },
                { quoted: msg }
            );
        }

        await client.sendMessage(from, { react: { text: "🎧", key: msg.key } });

        const targetJid = resolveJid(targetJidInput, from);

        // 1) Search song
        const searchResult = await yt.download(songQuery).catch(() => null);

        if (!searchResult || !searchResult.status || !searchResult.data) {
            return await client.sendMessage(
                from,
                { text: "❌ සින්දුව හමු වුණේ නැහැ." },
                { quoted: msg }
            );
        }

        const meta = searchResult.data;
        const audioUrl = meta?.downloads?.[0]?.url;

        if (!audioUrl) {
            return await client.sendMessage(
                from,
                { text: "❌ Download URL එක ලබාගන්න බැරි වුණා." },
                { quoted: msg }
            );
        }

        const title = meta?.title || songQuery;
        const duration = meta?.timestamp || meta?.duration || 'N/A';
        const thumb = meta?.thumbnails?.high || meta?.thumbnails?.default || null;

        const tmpId = crypto.randomBytes(8).toString('hex');
        const tempMp3 = path.join(os.tmpdir(), `csong_${tmpId}.mp3`);
        const tempOgg = path.join(os.tmpdir(), `csong_${tmpId}.ogg`);

        try {
            // 2) Download audio
            const dlResp = await axios.get(audioUrl, {
                responseType: 'stream',
                timeout: 120000
            });

            await new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(tempMp3);
                dlResp.data.pipe(writer);
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // 3) Convert to WhatsApp supported opus format
            await new Promise((resolve, reject) => {
                ffmpeg(tempMp3)
                    .noVideo()
                    .audioCodec('libopus')
                    .audioBitrate(128)
                    .format('ogg')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(tempOgg);
            });

            // 4) Prepare caption
            const caption =
                `☘️ *TITLE :* ${title}\n` +
                `◽️ ⏱ *Duration :* ${duration}\n\n` +
                `> *UPLOAD BY DARK_SHADOW_X-MD V1 🍃*`;

            // 5) Send thumbnail/info
            if (thumb) {
                await client.sendMessage(
                    targetJid,
                    { image: { url: thumb }, caption },
                    { quoted: msg }
                );
            } else {
                await client.sendMessage(
                    targetJid,
                    { text: caption },
                    { quoted: msg }
                );
            }

            // 6) Send audio as PTT
            const opusBuffer = fs.readFileSync(tempOgg);

            await client.sendMessage(
                targetJid,
                {
                    audio: opusBuffer,
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true
                },
                { quoted: msg }
            );

            // 7) Confirmation to sender if sent to another JID
            if (targetJid !== from) {
                await client.sendMessage(
                    from,
                    { text: "✅ *සින්දුව සාර්ථකව යැව්වා!*" },
                    { quoted: msg }
                );
            }
        } finally {
            safeUnlink(tempMp3);
            safeUnlink(tempOgg);
        }
    } catch (e) {
        console.error('csong error:', e);
        await client.sendMessage(
            from,
            { text: "❌ *Error:* " + (e?.message || 'Unknown error') },
            { quoted: msg }
        );
    }

    break;
}

        case 'csend':
        case 'csong': {
          try {
            await socket.sendMessage(from, { react: { text: "🎧", key: msg.key } });

            let songTargetArg = args[0];
            let songQuery = args.slice(1).join(" ").trim();

            if (!songTargetArg || !songQuery) {
              return await socket.sendMessage(from, { text: `❌ *Format එක වැරදියි!*\n\n*උදාහරණ:* \`${prefix}csong <jid|number|.|here> <song name or yt url>\`` }, { quoted: msg });
            }

            // 1. Resolve Target JID
            let sJid = songTargetArg;
            if (sJid === '.' || sJid.toLowerCase() === 'here') {
              sJid = from;
            } else if (!sJid.includes('@')) {
              if (/^\d{12,}$/.test(sJid) || /^0029/.test(sJid)) {
                if (!sJid.endsWith('@newsletter')) sJid = `${sJid}@newsletter`;
              } else {
                sJid = `${sJid.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
              }
            }

            // 2. Search & Metadata
            const yts = require('yt-search');
            let sUrl = songQuery;
            let sMetadata = null;

            if (!/^https?:\/\//i.test(songQuery)) {
              const search = await yts(songQuery);
              if (!search || !search.videos || search.videos.length === 0) {
                return await socket.sendMessage(from, { text: "❌ *ප්‍රතිඵල හමු නොවීය!*" }, { quoted: msg });
              }
              sUrl = search.videos[0].url;
              sMetadata = search.videos[0];
            } else {
              const search = await yts(sUrl);
              sMetadata = search.all ? search.all[0] : (search.videos ? search.videos[0] : search);
            }

            // 3. Get Download URL (New Vajira API)
            const sApiUrl = `https://vajira-official-apis.vercel.app/api/ytmp3?apikey=vajira-b72bv85884-1776138459299&url=${encodeURIComponent(sUrl)}`;
            const sApiResp = await axios.get(sApiUrl).catch(() => null);
            let sDownloadUrl = null;
            if (sApiResp && sApiResp.data && sApiResp.data.status) {
              const dData = sApiResp.data.data;
              if (dData.downloads && dData.downloads.length > 0) {
                const dl = dData.downloads.find(d => d.bitrate === '128kbps') || dData.downloads[0];
                sDownloadUrl = dl.url;
              }
              if (dData.title) sTitle = dData.title;
            }

            if (!sDownloadUrl) {
              return await socket.sendMessage(from, { text: "❌ *Download API එකෙන් link එක ලැබුණේ නැහැ!*" }, { quoted: msg });
            }

            // 4. File Setup
            const sTmpId = crypto.randomBytes(8).toString('hex');
            const sTempMp3 = path.join(os.tmpdir(), `s_${sTmpId}.mp3`);
            const sTempTag = path.join(os.tmpdir(), `t_${sTmpId}.mp3`);
            const sTempOpus = path.join(os.tmpdir(), `s_${sTmpId}.opus`);

            // 5. Download Files
            const dlResp = await axios.get(sDownloadUrl, { responseType: 'stream', timeout: 120000 }).catch(() => null);
            if (!dlResp || !dlResp.data) return await socket.sendMessage(from, { text: "❌ *සින්දුව download කිරීම අසාර්ථකයි!*" }, { quoted: msg });

            await new Promise((resolve, reject) => {
              const writer = fs.createWriteStream(sTempMp3);
              dlResp.data.pipe(writer);
              writer.on('finish', resolve);
              writer.on('error', reject);
            });

            // 6. Voice Tag (TTS)
            try {
              const sTagText = "Powered by DARK_SHADOW_X-MD V1 🍃";
              const sTagUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(sTagText)}&tl=en&client=tw-ob`;
              const tagResp = await axios.get(sTagUrl, { responseType: 'stream' }).catch(() => null);
              if (tagResp) {
                await new Promise((resolve) => {
                  const writer = fs.createWriteStream(sTempTag);
                  tagResp.data.pipe(writer);
                  writer.on('finish', resolve);
                  writer.on('error', () => resolve());
                });
              }
            } catch (e) { }

            // 7. FFmpeg Process
            await new Promise((resolve, reject) => {
              let ff = ffmpeg(sTempMp3).noVideo();
              if (fs.existsSync(sTempTag)) {
                ff.input(sTempTag).complexFilter([
                  '[1:a]adelay=1000|1000,volume=2.0[tag]',
                  '[0:a][tag]amix=inputs=2:duration=first'
                ]);
              }
              ff.audioCodec('libopus').format('opus').on('end', resolve).on('error', reject).save(sTempOpus);
            });

            // 8. Caption & Send
            let sChannelName = sJid;
            try {
              if (sJid.endsWith('@newsletter')) {
                const meta = await socket.newsletterMetadata("jid", sJid);
                if (meta) sChannelName = meta.name || meta.subject;
              } else if (sJid.endsWith('@g.us')) {
                const meta = await socket.groupMetadata(sJid);
                if (meta) sChannelName = meta.subject;
              }
            } catch (e) { }

            const sCfg = await loadUserConfigFromMongo(sanitizedNum) || {};
            const sBotName = sCfg.botName || 'CHAMA MD';
            const sFooter = sCfg.csongFooter || `ලස්සන රියැක්ට් ඕනී...💗😽🍃\n\n> 𝗨𝗣𝗟𝗢𝗔𝗗 𝗕𝗬 ${sBotName.toUpperCase()} 𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 𝗕𝗢𝗧`;
            const sCapTemplate = sCfg.csongFormat || `☘️ *TITLE :* &title\n( &channel )\n\n◽️ ⏱ *Duration :* &time\n\n&footer`;

            const sFinalCaption = sCapTemplate
              .replace(/&title/g, sTitle)
              .replace(/&time/g, sMetadata?.timestamp || 'N/A')
              .replace(/&channel/g, sChannelName)
              .replace(/&footer/g, sFooter)
              .replace(/\\n/g, '\n');

            const sThumb = sMetadata?.thumbnail || sMetadata?.image;
            if (sThumb) {
              await socket.sendMessage(sJid, { image: { url: sThumb }, caption: sFinalCaption, mentions: [senderNumber + '@s.whatsapp.net'] });
            } else {
              await socket.sendMessage(sJid, { text: sFinalCaption, mentions: [senderNumber + '@s.whatsapp.net'] });
            }

            const sOpusBuffer = fs.readFileSync(sTempOpus);
            await socket.sendMessage(sJid, { audio: sOpusBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });

            if (sJid !== from) await socket.sendMessage(from, { text: "✅ *Song sent successfully to target!* 😎🎶" }, { quoted: msg });

            // 9. Cleanup
            try { [sTempMp3, sTempTag, sTempOpus].forEach(f => fs.existsSync(f) && fs.unlinkSync(f)); } catch (e) { }

          } catch (e) {
            console.error('csong error:', e);
            await socket.sendMessage(from, { text: "❌ *පද්ධතියේ දෝෂයක්:* " + e.message }, { quoted: msg });
          }
          break;
        }

        case 'csongs': {
          let sub = args[0]?.toLowerCase();
          let isImplicitAdd = false;

          if (sub && !['add', 'list', 'slist', 'del', 'remove'].includes(sub)) {
            // Check if sub looks like a time (HH:mm or part of a date)
            if (/^\d{1,2}:\d{2}$/.test(sub) || /^\d{4}-\d{2}-\d{2}$/.test(sub)) {
              isImplicitAdd = true;
            }
          }

          if (!sub) return await socket.sendMessage(from, { text: `📅 *CHAMA SONG SCHEDULER*\n\nUsage:\n• ${prefix}csongs <time> | <target_jid> | <song_name>\n• ${prefix}csongs list\n• ${prefix}csongs del <id>\n\n*Time formats:* 14:30 or 2024-05-20 09:00` });

          if (sub === 'add' || isImplicitAdd) {
            let fullInput = isImplicitAdd ? args.join(' ') : args.slice(1).join(' ');
            let timeStr, toJidStr, songName;

            if (fullInput.includes('|')) {
              const parts = fullInput.split('|').map(p => p.trim());
              if (parts.length < 3) return await socket.sendMessage(from, { text: `⚠️ Invalid format! Use:\n${prefix}csongs add <time> | <jid> | <song_name>` });
              timeStr = parts[0];
              toJidStr = parts[1];
              songName = parts[2];
            } else {
              // Smart split: identify JID (contains @), time stays before it, song after it
              const words = fullInput.split(/ +/);
              const jidIndex = words.findIndex(w => w.includes('@'));
              if (jidIndex === -1 || jidIndex === 0) {
                return await socket.sendMessage(from, { text: `⚠️ Use pipes (|) for clarity or specify a JID.\n*Example:* ${prefix}csongs 14:30 | jid | song` });
              }
              timeStr = words.slice(0, jidIndex).join(' ');
              toJidStr = words[jidIndex];
              songName = words.slice(jidIndex + 1).join(' ');
              if (!songName) return await socket.sendMessage(from, { text: `⚠️ Please specify a song name or URL after the JID.` });
            }

            try {
              const scheduledDate = parseSriLankaTime(timeStr);
              if (!scheduledDate || isNaN(scheduledDate.getTime())) return await socket.sendMessage(from, { text: '❌ Invalid time format. Use HH:mm or YYYY-MM-DD HH:mm' });
              if (scheduledDate <= new Date()) return await socket.sendMessage(from, { text: '❌ Cannot schedule in the past!' });

              let targetJid = toJidStr;
              if (targetJid === 'here' || targetJid === '.') targetJid = from;
              else if (!targetJid.includes('@')) {
                if (/^\d{12,}$/.test(targetJid) || /^0029/.test(targetJid)) {
                  if (!targetJid.endsWith('@newsletter')) targetJid = `${targetJid}@newsletter`;
                } else {
                  targetJid = targetJid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                }
              }

              await addScheduledTask({
                sessionNumber: sanitizedNum,
                jid: targetJid,
                time: moment(scheduledDate).tz(TIMEZONE).format('HH:mm'),
                fullDate: scheduledDate,
                type: 'csong',
                content: songName,
                sender: senderNumber,
                status: 'pending'
              });

              return await socket.sendMessage(from, { text: `✅ *SONG SCHEDULED!*\n\n📅 *TIME (SL):* ${formatSriLankaTime(scheduledDate)}\n📤 *TO:* ${targetJid}\n🎶 *SONG:* ${songName}` });
            } catch (e) { return await socket.sendMessage(from, { text: `❌ Error: ${e.message}` }); }
          }

          if (sub === 'list' || sub === 'slist') {
            const list = await listScheduledTasks(sanitizedNum);
            const songSchedules = list.filter(t => t.type === 'csong');
            if (!songSchedules || songSchedules.length === 0) return await socket.sendMessage(from, { text: '📝 No pending song schedules found.' });
            let out = `📋 *SCHEDULED SONGS (${songSchedules.length})*\n\n`;
            songSchedules.forEach((s, i) => {
              const time = s.fullDate ? formatSriLankaTime(new Date(s.fullDate)) : s.time;
              out += `${i + 1}. *[${s.status.toUpperCase()}]*\n   ⏰ Time: ${time}\n   📤 Target: ${s.jid}\n   🎶 Song: ${s.content}\n   🆔 ID: ${s._id}\n\n`;
            });
            return await socket.sendMessage(from, { text: out });
          }

          if (sub === 'del' || sub === 'remove') {
            const id = args[1];
            if (!id) return await socket.sendMessage(from, { text: 'Provide ID to delete.' });
            try {
              await removeScheduledTask(id);
              return await socket.sendMessage(from, { text: '🗑️ Song schedule removed.' });
            } catch (e) { return await socket.sendMessage(from, { text: '❌ Failed. Check ID.' }); }
          }
          break;
        }
        case 'alive': {
          const uptimeSeconds = process.uptime();
          const statusMsg = `*📡 DARK_SHADOW_X-MD V1 🍃 IS ALIVE*\n\n*⌚ Runtime:* ${runtime(uptimeSeconds)}\n*🛡️ Version:* 5.0.0\n*🤖 Bot:* ${botName}\n\n> *CHANNEL AUTOMATION SYSTEM ACTIVE*`;
          try {
            const buf = fs.readFileSync(config.IMAGE_PATH || './logo.png');
            await socket.sendMessage(from, { image: buf, caption: statusMsg });
          } catch (e) {
            await socket.sendMessage(from, { text: statusMsg });
          }
          break;
        }

        case 'ping': {
          const start = Date.now();
          await socket.sendMessage(from, { text: '🏓 Pinging...' });
          const end = Date.now();
          await socket.sendMessage(from, { text: `🏓 Pong! Latency: ${end - start}ms` });
          break;
        }

        // ══════════════════════════════════════════
        //  📦 ADVANCED GROUP COMMANDS (Baileys API)
        // ══════════════════════════════════════════

        case 'ephemeral':
        case 'setephem': {
          // .setephem off | 1d | 7d | 90d
          if (!isGroup) return await socket.sendMessage(from, { text: '❌ This is a group command.' });
          const setting = args[0]?.toLowerCase();
          let duration = 0;
          if (setting === '1d') duration = 86400;
          else if (setting === '7d') duration = 604800;
          else if (setting === '90d') duration = 7776000;
          else if (setting === 'off' || setting === '0') duration = 0;
          else return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}setephem <off|1d|7d|90d>` });
          try {
            await socket.groupToggleEphemeral(from, duration);
            const label = duration === 0 ? 'Disabled' : setting;
            await socket.sendMessage(from, { text: `⏳ Disappearing messages set to: *${label}*` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'groupinviteinfo':
        case 'ginviteinfo': {
          const code = args[0];
          if (!code) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}ginviteinfo <invite_code_or_link>` });
          try {
            const cleanCode = code.includes('chat.whatsapp.com/') ? code.split('chat.whatsapp.com/')[1].split(' ')[0] : code;
            const info = await socket.groupGetInviteInfo(cleanCode);
            let txt = `🔍 *GROUP INVITE INFO*\n\n`;
            txt += `*Name:* ${info.subject}\n`;
            txt += `*ID:* ${info.id}\n`;
            txt += `*Members:* ${info.size}\n`;
            txt += `*Creator:* @${info.creator?.split('@')[0] || 'N/A'}\n`;
            txt += `*Created:* ${info.creation ? formatSriLankaTime(new Date(info.creation * 1000)) : 'N/A'}\n`;
            txt += `*Desc:* ${info.desc || 'None'}\n\n`;
            txt += `> *© ${botName}*`;
            await socket.sendMessage(from, { text: txt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'revokelink':
        case 'revokeinvite': {
          if (!isGroup) return await socket.sendMessage(from, { text: '❌ Group command only.' });
          try {
            const code = await socket.groupRevokeInvite(from);
            const newLink = `https://chat.whatsapp.com/${code}`;
            await socket.sendMessage(from, { text: `🔗 *INVITE LINK REVOKED*\n\nNew Link: ${newLink}\n\n> *© ${botName}*` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'gparticipants':
        case 'members': {
          if (!isGroup) return await socket.sendMessage(from, { text: '❌ Group command only.' });
          try {
            const meta = await socket.groupMetadata(from);
            const admins = meta.participants.filter(p => p.admin);
            const members = meta.participants.filter(p => !p.admin);
            let txt = `👥 *GROUP MEMBERS*\n\n`;
            txt += `*👑 ADMINS (${admins.length}):*\n`;
            admins.forEach((a, i) => { txt += `${i + 1}. @${a.id.split('@')[0]}\n`; });
            txt += `\n*👤 MEMBERS (${members.length}):*\n`;
            members.forEach((m, i) => { txt += `${i + 1}. @${m.id.split('@')[0]}\n`; });
            txt += `\n*Total:* ${meta.participants.length}\n\n> *© ${botName}*`;
            const allJids = meta.participants.map(p => p.id);
            await socket.sendMessage(from, { text: txt, mentions: allJids });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'gsend':
        case 'sendgroup': {
          // .gsend <group_jid> <message>
          const gJid = args[0];
          const gMsg = args.slice(1).join(' ');
          if (!gJid || !gMsg) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}gsend <group_jid> <message>` });
          const target = gJid.includes('@') ? gJid : `${gJid}@g.us`;
          try {
            await socket.sendMessage(target, { text: gMsg });
            await socket.sendMessage(from, { text: `✅ Message sent to ${target}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'glist':
        case 'grouplist': {
          try {
            const groups = await socket.groupFetchAllParticipating();
            const gIds = Object.keys(groups);
            if (gIds.length === 0) return await socket.sendMessage(from, { text: '❌ Bot is not in any groups.' });
            let txt = `📋 *GROUP LIST (${gIds.length})*\n\n`;
            Object.values(groups).forEach((g, i) => {
              txt += `*${i + 1}.* ${g.subject}\n🆔 ${g.id}\n👥 ${g.participants?.length || 0} members\n\n`;
            });
            txt += `> *© ${botName}*`;
            await socket.sendMessage(from, { text: txt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'gaccept':
        case 'acceptinvite': {
          const invCode = args[0];
          if (!invCode) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}gaccept <invite_code_or_link>` });
          try {
            const cleanCode = invCode.includes('chat.whatsapp.com/') ? invCode.split('chat.whatsapp.com/')[1].split(' ')[0] : invCode;
            const gid = await socket.groupAcceptInvite(cleanCode);
            await socket.sendMessage(from, { text: `✅ Joined group: ${gid}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'gtag': {
          // .gtag <group_jid> <message> — tag all members of a group via DM
          const gtJid = args[0];
          const gtMsg = args.slice(1).join(' ') || '👋';
          if (!gtJid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}gtag <group_jid> <message>` });
          const gtTarget = gtJid.includes('@') ? gtJid : `${gtJid}@g.us`;
          try {
            const meta = await socket.groupMetadata(gtTarget);
            const ids = meta.participants.map(p => p.id);
            let text = `${gtMsg}\n\n`;
            ids.forEach(id => { text += `• @${id.split('@')[0]}\n`; });
            await socket.sendMessage(gtTarget, { text, mentions: ids });
            await socket.sendMessage(from, { text: `✅ Tagged ${ids.length} members in ${meta.subject}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'gleave':
        case 'leavegroup': {
          // .leavegroup <group_jid>  — make bot leave a target group
          const glJid = args[0];
          if (!glJid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}leavegroup <group_jid>` });
          const glTarget = glJid.includes('@') ? glJid : `${glJid}@g.us`;
          try {
            await socket.groupLeave(glTarget);
            await socket.sendMessage(from, { text: `✅ Successfully left group: ${glTarget}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'getdesc':
        case 'groupdesc': {
          if (!isGroup) return await socket.sendMessage(from, { text: '❌ Group command only.' });
          try {
            const meta = await socket.groupMetadata(from);
            await socket.sendMessage(from, { text: `📝 *Group Description:*\n\n${meta.desc || '_(No description set)_'}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        // ══════════════════════════════════════════
        //  📡 ADDITIONAL CHANNEL COMMANDS (Baileys)
        // ══════════════════════════════════════════

        case 'csend':
        case 'ctxt': {
          // .ctxt <channel_jid_or_link> <text>  — send text to a channel
          const csTarget = args[0];
          const csTxt = args.slice(1).join(' ');
          if (!csTarget || !csTxt) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}ctxt <channel_jid_or_link> <text>` });
          try {
            const resolvedJid = await resolveJidFromInput(socket, csTarget);
            await socket.sendMessage(resolvedJid, { text: csTxt });
            await socket.sendMessage(from, { text: `✅ Message sent to channel!` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'cimg':
        case 'csendimg': {
          // .cimg <channel_jid_or_link> <caption>  — send replied image to channel
          const ciTarget = args[0];
          const ciCaption = args.slice(1).join(' ');
          if (!ciTarget) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}cimg <channel_jid_or_link> <caption> (reply to an image)` });
          const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quotedMsg?.imageMessage) return await socket.sendMessage(from, { text: '❌ Please reply to an image.' });
          try {
            const resolvedJid = await resolveJidFromInput(socket, ciTarget);
            const media = await downloadQuotedMedia(quotedMsg);
            await socket.sendMessage(resolvedJid, { image: media.buffer, caption: ciCaption || '' });
            await socket.sendMessage(from, { text: `✅ Image sent to channel!` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'csenddoc':
        case 'cdoc': {
          // .cdoc <channel_jid_or_link> <filename>  — send replied document to channel
          const cdTarget = args[0];
          const cdFilename = args.slice(1).join(' ') || 'file.pdf';
          if (!cdTarget) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}cdoc <channel_jid_or_link> <filename> (reply to a document)` });
          const quotedMsgDoc = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          if (!quotedMsgDoc?.documentMessage) return await socket.sendMessage(from, { text: '❌ Please reply to a document.' });
          try {
            const resolvedJid = await resolveJidFromInput(socket, cdTarget);
            const media = await downloadQuotedMedia(quotedMsgDoc);
            await socket.sendMessage(resolvedJid, { document: media.buffer, fileName: cdFilename, mimetype: quotedMsgDoc.documentMessage.mimetype || 'application/octet-stream' });
            await socket.sendMessage(from, { text: `✅ Document sent to channel!` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'cnewsletter':
        case 'channeladd': {
          // .channeladd <jid_or_link>  — save a newsletter to MongoDB for broadcast tracking
          const cnTarget = args[0];
          if (!cnTarget) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}channeladd <jid_or_link>` });
          try {
            const resolvedJid = await resolveJidFromInput(socket, cnTarget);
            await addNewsletterToMongo(resolvedJid, [], number);
            await socket.sendMessage(from, { text: `✅ Channel saved for broadcast: ${resolvedJid}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nreact':
        case 'nsave': {
          const full = body.slice(prefix.length + command.length).trim();
          if (!full) {
            return await socket.sendMessage(from, {
              text: `❗ *භාවිතය:* ${prefix}nreact <Link/JID> | ❤️,🔥\n\n*උදාහරණ:* ${prefix}nreact https://whatsapp.com/channel/xxxx | ❤️,🔥\n\n> *Stealth Mode: No-Follow Required*`
            }, { quoted: msg });
          }

          let jidInput = '';
          let emojis = ['❤️', '👍', '🔥'];

          if (full.includes('|')) {
            let [jidPart, emojisPart] = full.split('|').map(s => s ? s.trim() : '');
            jidInput = jidPart;
            if (emojisPart) emojis = emojisPart.split(',').map(e => e.trim()).filter(e => e.length > 0);
          } else {
            const parts = full.split(/\s+/);
            jidInput = parts[0];
            if (parts.length > 1) {
              emojis = parts.slice(1).join('').split(',').map(e => e.trim()).filter(e => e.length > 0);
            }
          }

          try {
            const resolved = await resolveJidFromInput(socket, jidInput);
            const jid = typeof resolved === 'object' ? resolved.jid : resolved;

            if (!jid || !jid.endsWith('@newsletter')) {
              return await socket.sendMessage(from, { text: '❌ වලංගු WhatsApp Channel Link එකක් හෝ JID එකක් ලබා දෙන්න.' }, { quoted: msg });
            }

            // Ensure bot is listening for updates (stealth mode)
            if (typeof socket.subscribeNewsletterUpdates === 'function') {
              await socket.subscribeNewsletterUpdates(jid).catch(() => { });
            }

            await newsletterReactsCol.updateOne(
              { jid: jid },
              {
                $set: { jid: jid, emojis: emojis, owner: senderNumber },
                $setOnInsert: { lastReactedId: '' }
              },
              { upsert: true }
            );

            await socket.sendMessage(from, {
              text: `✅ *Auto-Reaction System Active!*\n\n📍 *Channel:* ${jid}\n🎭 *Emojis:* ${emojis.join(' ')}\n📡 *Mode:* Stealth (No-Follow Required)`
            }, { quoted: msg });

          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
          }
          break;
        }

        case 'nblocks': {
          const full = args.join(' ');
          if (!full) return await socket.sendMessage(from, { text: "❗ JID හෝ Link එක ලබා දෙන්න." }, { quoted: msg });

          let jid = full;
          try {
            if (full.includes('whatsapp.com/channel/')) {
              const inviteCode = full.split('whatsapp.com/channel/')[1].split(/[/?]/)[0].trim();
              const metadata = await socket.newsletterMetadata('invite', inviteCode);
              if (metadata && metadata.id) jid = metadata.id;
            }

            // 1. Blacklist එකට සේව් කරනවා 
            await newsletterBlacklistCol.updateOne({ jid: jid }, { $set: { jid: jid, addedBy: senderNumber } }, { upsert: true });

            // 2. ඒ වෙලාවෙම Unfollow කරනවා
            if (typeof socket.newsletterUnfollow === 'function') {
              await socket.newsletterUnfollow(jid).catch(() => { });
            }

            // 3. nreact ලිස්ට් එකේ තිබ්බොත් එතනිනුත් අයින් කරනවා
            await newsletterReactsCol.deleteOne({ jid: jid });

            await socket.sendMessage(from, { text: `🚫 *Channel Blacklisted & Unfollowed!*\n\nමෙතැන් සිට බොට් මේ චැනල් එකේ රැඳී නොසිටිනු ඇත.` }, { quoted: msg });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` }, { quoted: msg });
          }
          break;
        }

        case 'react': {
          // .react <emoji> - react to replied message
          const emoji = args[0] || '❤️';
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
          const quotedKey = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
          if (!quoted || !quotedKey) return await socket.sendMessage(from, { text: '❌ Please reply to a message to react.' });
          try {
            await socket.sendMessage(from, { react: { text: emoji, key: { remoteJid: from, fromMe: false, id: quotedKey, participant: msg.message.extendedTextMessage.contextInfo.participant } } });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'save': {
          // .save - save replied message to self DM
          const qCtx = msg.message?.extendedTextMessage?.contextInfo;
          const quotedMsg = qCtx?.quotedMessage;
          if (!quotedMsg) return await socket.sendMessage(from, { text: '❌ Please reply to a message to save.' });
          try {
            const userJid = jidNormalizedUser(socket.user.id);
            const stanzaId = qCtx.stanzaId;
            const participant = qCtx.participant || from;
            const copyMessage = {
              key: { remoteJid: from, fromMe: false, id: stanzaId, participant },
              message: quotedMsg
            };
            if (socket.copyNForward) {
              await socket.copyNForward(userJid, copyMessage, true);
            } else {
              await socket.sendMessage(userJid, { forward: copyMessage });
            }
            await socket.sendMessage(from, { text: '✅ Message saved to your DM!' });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'clean': {
          if (!isOwner) return await socket.sendMessage(from, { text: '❌ Owner only command.' });
          try {
            const sessions = await getAllNumbersFromMongo();
            let cleaned = 0;
            for (const s of sessions) {
              if (!activeSockets.has(s)) {
                await deleteSessionAndCleanup(s);
                cleaned++;
              }
            }
            await socket.sendMessage(from, { text: `✅ Cleaned up ${cleaned} inactive session folders.` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nrlist': {
          // Alias for nreactlist
          try {
            const list = await listNewsletterReactsFromMongo();
            if (!list || list.length === 0) return await socket.sendMessage(from, { text: '📍 No auto-reactions configured.' });
            let txt = `📋 *AUTO-REACTION CHANNELS*\n\n`;
            list.forEach((r, i) => {
              txt += `${i + 1}. *${r.jid}*\n   Emojis: ${r.emojis.join(' ')}\n\n`;
            });
            await socket.sendMessage(from, { text: txt });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        case 'nrdel': {
          // Alias for nreactdel
          const jid = args[0];
          if (!jid) return await socket.sendMessage(from, { text: `⚠️ Usage: ${prefix}nrdel <channel_jid>` });
          try {
            await newsletterReactsCol.deleteOne({ jid });
            newsletterConfigCache.delete(jid);
            await socket.sendMessage(from, { text: `✅ Auto-reactions removed for ${jid}` });
          } catch (e) {
            await socket.sendMessage(from, { text: `❌ Error: ${e.message}` });
          }
          break;
        }

        default:
          break;
      }


      // ========== CHATBOT AUTO-REPLY ==========
      // Removed chatbot auto-reply logic
      // ========================================
    } catch (err) {
      console.error('Command handler error:', err);
      try {
        await socket.sendMessage(from, { text: `🚫 *CHAMA MINI ERROR*\n\nAn unexpected error occurred while processing your request.\n\n*Error:* ${err.message || err}` });
      } catch (e) { }
    }
  }
}

// ---------------- group events (welcome/left) ----------------

function setupGroupEvents(socket, sessionNumber) {
  socket.ev.on('group-participants.update', async (update) => {
    try {
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      const { id, participants, action } = update;

      // ========== BANNED CHATS & MAINTENANCE CHECK ==========
      const bannedChats = userConfig.BANNED_CHATS || [];
      if (bannedChats.includes(id)) return;
      if (userConfig.MAINTENANCE === 'true') return; // Silence group events in maintenance
      // ======================================================

      //       console.log(`\n👥 [GROUP EVENT] | CHAT: ${id} | ACTION: ${action} | COUNT: ${participants.length}`);

      // Prioritize group-specific settings from MongoDB
      const groupSpecificWelcome = await getGroupSetting(id, 'welcomeEnabled', null);
      const groupSpecificLeft = await getGroupSetting(id, 'leftEnabled', null);

      const autoWelcome = groupSpecificWelcome !== null
        ? (groupSpecificWelcome ? 'true' : 'false')
        : (userConfig.AUTO_WELCOME || config.AUTO_WELCOME || 'false');

      const autoLeft = groupSpecificLeft !== null
        ? (groupSpecificLeft ? 'true' : 'false')
        : (userConfig.AUTO_LEFT || config.AUTO_LEFT || 'false');

      if (autoWelcome !== 'true' && autoLeft !== 'true') {
        return;
      }

      const botJid = jidNormalizedUser(socket.user.id);
      if (!botJid) return;

      let metadata;
      try {
        metadata = await socket.groupMetadata(id);
      } catch (e) {
        const isForbidden = e.message?.includes('forbidden') || e.data === 403 || e.output?.statusCode === 403;
        if (isForbidden) {
          //           console.log(`🚫 [GROUP EVENT] Access forbidden for chat ${id}. Skipping event.`);
          return;
        }
        metadata = { subject: 'the group' };
      }

      const useButtons = 'false';
      const prefix = userConfig.PREFIX || config.PREFIX || '.';

      const sendEventMessage = async (jid, text, imageUrl, participant) => {
        try {
          if (participant === botJid) return; // Guard again skip bot self-events

          const sanitizedImg = (imageUrl && typeof imageUrl === 'string' && fs.existsSync(imageUrl) && !imageUrl.startsWith('http'))
            ? fs.readFileSync(imageUrl)
            : { url: imageUrl || 'https://telegra.ph/file/2416cffc6565035f8c616.jpg' };

          //           console.log(`✉️ Sending ${action} message to @${participant.split('@')[0]} in ${jid}`);

          await socket.sendMessage(jid, {
            image: sanitizedImg,
            caption: text,
            mentions: [participant]
          });
        } catch (sendErr) {
          console.warn(`⚠️ [GROUP EVENT] Failed to send ${action} message to ${jid} for @${participant.split('@')[0]}:`, sendErr.message || sendErr);
        }
      };

      for (let participant of participants) {
        if (action === 'add' && autoWelcome === 'true') {
          let text = await getGroupSetting(id, 'welcomeText', null) || userConfig.WELCOME_MSG || config.WELCOME_MSG || `*Hello @user, Welcome to @group!* ✨\n\nWe are glad to have you here. Please follow the group rules and enjoy your stay! 🎈\n\n> *Powered by ${userConfig.botName || BOT_NAME_FANCY}*`;
          text = text.replace(/@user/ig, `@${participant.split('@')[0]}`).replace(/@group/ig, metadata.subject);

          let groupImg = await getGroupSetting(id, 'welcomeImage', null);
          if (!groupImg) {
            try {
              groupImg = await socket.profilePictureUrl(id, 'image');
            } catch (e) {
              groupImg = userConfig.logo || config.IMAGE_PATH || config.RCD_IMAGE_PATH;
            }
          }
          await sendEventMessage(id, text, groupImg, participant);
        } else if (action === 'remove' && autoLeft === 'true') {
          let text = await getGroupSetting(id, 'leftText', null) || userConfig.LEFT_MSG || config.LEFT_MSG || `*Goodbye @user from @group!* ⛄\n\nWe hope you had a great time here. Take care! 👋\n\n> *Powered by ${userConfig.botName || BOT_NAME_FANCY}*`;
          text = text.replace(/@user/ig, `@${participant.split('@')[0]}`).replace(/@group/ig, metadata.subject);

          let groupImg = await getGroupSetting(id, 'welcomeImage', null);
          if (!groupImg) {
            try {
              groupImg = await socket.profilePictureUrl(id, 'image');
            } catch (e) {
              groupImg = userConfig.logo || config.IMAGE_PATH || config.RCD_IMAGE_PATH;
            }
          }
          await sendEventMessage(id, text, groupImg, participant);
        }
      }
    } catch (e) {
      console.error('Group Event Error:', e);
    }
  });
}

// ---------------- Call Rejection Handler ----------------

// ---------------- Simple Call Rejection Handler ----------------

async function setupCallRejection(socket, sessionNumber) {
  socket.ev.on('call', async (calls) => {
    try {
      // Load user-specific config from MongoDB
      const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
      const userConfig = await loadUserConfigFromMongo(sanitized) || {};
      if (userConfig.ANTI_CALL !== 'on') return;

      //       console.log(`📞 Incoming call detected for ${sanitized} - Auto rejecting...`);

      for (const call of calls) {
        if (call.status !== 'offer') continue;

        const id = call.id;
        const from = call.from;

        // Reject the call
        await socket.rejectCall(id, from);

        // Send rejection message to caller
        await socket.sendMessage(from, {
          text: '*🔗• Auto call rejection is enabled. Calls are automatically rejected.*'
        });

        //         console.log(`✅ Auto-rejected call from ${from}`);

        // Send notification to bot user
        const userJid = jidNormalizedUser(socket.user.id);
        const rejectionMessage = formatMessage(
          '📞 CALL REJECTED',
          `Auto call rejection is active.\n\nCall from: ${from}\nTime: ${getSriLankaTimestamp()}`,
          BOT_NAME_FANCY
        );

        await socket.sendMessage(userJid, {
          image: { url: userConfig.logo || config.RCD_IMAGE_PATH },
          caption: rejectionMessage
        });
      }
    } catch (err) {
      console.error(`Call rejection error for ${sessionNumber}:`, err);
    }
  });
}

// --- Advanced Google People API Helpers ---
function generateGoogleAuthUrl(sanitizedNumber) {
  const scopes = [
    'https://www.googleapis.com/auth/contacts',
    'https://www.googleapis.com/auth/contacts.other.readonly',
    'https://www.googleapis.com/auth/directory.readonly'
  ];
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    client_id: config.GOOGLE_CLIENT_ID,
    access_type: 'offline',
    response_type: 'code',
    prompt: 'consent',
    scope: scopes.join(' '),
    state: sanitizedNumber // Pass the session number to associate the token
  };
  const qs = new URLSearchParams(options);
  return `${rootUrl}?${qs.toString()}`;
}

async function googlePeopleRequest(sanitizedNumber, method, endpoint, body = null) {
  const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
  let token = userConfig.GOOGLE_CONTACTS_TOKEN;
  const refreshToken = userConfig.GOOGLE_CONTACTS_REFRESH_TOKEN;

  if (!token) throw new Error('Google Contacts not authorized.');

  const makeRequest = async (accessToken) => {
    const url = `https://people.googleapis.com/v1/${endpoint}`;
    const head = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    const opts = { method, url, headers: head };
    if (body) opts.data = body;
    return await axios(opts);
  };

  try {
    const response = await makeRequest(token);
    return response.data;
  } catch (e) {
    if (e.response?.status === 401 && refreshToken) {
      // Attempt token refresh
      try {
        const refreshResponse = await axios.post('https://oauth2.googleapis.com/token', {
          client_id: config.GOOGLE_CLIENT_ID,
          client_secret: config.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        });

        const newAccessToken = refreshResponse.data.access_token;
        userConfig.GOOGLE_CONTACTS_TOKEN = newAccessToken;
        await setUserConfigInMongo(sanitizedNumber, userConfig);

        // Retry with new token
        const retryResponse = await makeRequest(newAccessToken);
        return retryResponse.data;
      } catch (refreshError) {
        console.error(`[GOOGLE PEOPLE API] Token refresh failed:`, refreshError.response?.data || refreshError.message);
        throw refreshError;
      }
    }
    console.error(`[GOOGLE PEOPLE API] Error (${endpoint}):`, e.response?.data || e.message);
    throw e;
  }
}

async function listGoogleContacts(sanitizedNumber, pageSize = 20) {
  return await googlePeopleRequest(sanitizedNumber, 'GET', `people/me/connections?pageSize=${pageSize}&personFields=names,phoneNumbers`);
}

async function listGoogleContactGroups(sanitizedNumber) {
  return await googlePeopleRequest(sanitizedNumber, 'GET', 'contactGroups');
}

async function syncOtherContactsToMyContacts(sanitizedNumber) {
  // 1. List other contacts
  const others = await googlePeopleRequest(sanitizedNumber, 'GET', 'otherContacts?readMask=names,phoneNumbers');
  if (!others.otherContacts || others.otherContacts.length === 0) return { count: 0 };

  let count = 0;
  for (const contact of others.otherContacts) {
    try {
      // Copy to My Contacts
      await googlePeopleRequest(sanitizedNumber, 'POST', `${contact.resourceName}:copyOtherContactToMyContactsGroup`);
      count++;
    } catch (e) { }
    await delay(500); // Prevent rate limiting
  }
  return { count };
}

async function createGoogleContact(sanitizedNumber, name, phone) {
  return await googlePeopleRequest(sanitizedNumber, 'POST', 'people:createContact', {
    names: [{ givenName: name }],
    phoneNumbers: [{ value: phone.startsWith('+') ? phone : '+' + phone }]
  });
}

async function searchGoogleContacts(sanitizedNumber, query) {
  return await googlePeopleRequest(sanitizedNumber, 'GET', `people:searchContacts?query=${encodeURIComponent(query)}&readMask=names,phoneNumbers`);
}

async function deleteGoogleContact(sanitizedNumber, resourceName) {
  // resourceName looks like 'people/c123456789'
  return await googlePeopleRequest(sanitizedNumber, 'DELETE', resourceName);
}

async function updateGoogleContact(sanitizedNumber, resourceName, newName) {
  // Get existing first to get etag
  const contact = await googlePeopleRequest(sanitizedNumber, 'GET', `${resourceName}?personFields=names,phoneNumbers`);
  return await googlePeopleRequest(sanitizedNumber, 'PATCH', `${resourceName}?updatePersonFields=names`, {
    etag: contact.etag,
    names: [{ givenName: newName }]
  });
}

async function handleAutoContactSaver(socket, sessionNumber, msg) {
  const from = msg.key.remoteJid;
  if (!from || from === 'status@broadcast' || from.endsWith('@newsletter')) return;
  if (msg.key.fromMe) return;

  const isGroup = from.endsWith('@g.us');
  const actualSender = isGroup ? msg.key.participant : from;
  if (!actualSender) return;

  // Use jidNormalizedUser to ensure we have a clean JID without device codes
  const normalizedSender = jidNormalizedUser(actualSender);
  const senderNumber = normalizedSender.split('@')[0];

  // Ignore bot's own messages if emitOwnEvents is ever enabled
  if (socket.user && jidNormalizedUser(socket.user.id) === normalizedSender) return;

  // Validate number length cleanly
  if (senderNumber.length < 10 || senderNumber.length > 20) return;

  const sanitized = (sessionNumber || '').replace(/[^0-9]/g, '');
  const userConfig = await loadUserConfigFromMongo(sanitized) || {};

  if ((userConfig.AUTO_CONTACT_SAVER !== true && userConfig.AUTO_CONTACT_SAVER !== 'true') || !userConfig.GOOGLE_CONTACTS_TOKEN) return;

  const cacheKey = `${sanitized}:${senderNumber}`;
  if (!global.__contactSaveCache) global.__contactSaveCache = new Set();
  if (!global.__currentlyProcessingContacts) global.__currentlyProcessingContacts = new Set();

  // 1. Avoid double processing
  if (global.__contactSaveCache.has(cacheKey)) return;
  if (global.__currentlyProcessingContacts.has(cacheKey)) return;

  // Set a lock to prevent concurrent processing of the same contact
  global.__currentlyProcessingContacts.add(cacheKey);

  try {
    // 2. Check if contact already exists in Google Contacts to avoid spamming
    try {
      const searchResult = await searchGoogleContacts(sanitized, senderNumber);
      if (searchResult && searchResult.results && searchResult.results.length > 0) {
        global.__contactSaveCache.add(cacheKey);
        return;
      }
    } catch (e) {
      console.warn(`[CONTACT SAVER] Search failed for ${senderNumber} (Continuing anyway):`, e.message);
    }

    const pushName = (msg.pushName && msg.pushName.trim() !== '') ? msg.pushName : `WA User ${senderNumber}`;
    const botName = userConfig.botName || BOT_NAME_FANCY;

    let welcomeMsg = userConfig.CONTACT_SAVER_MSG || `*╭─────────────────────────╮*
*      🍃DARK_SHADOW_X-MD V1 🍃 *
*╰─────────────────────────╯*

*👋 Hello, ${pushName}!*

*📋 ඔබ මගේ සම්බන්ධතා ලැයිස්තුවේ තවම නැත.*

සන්නිවේදනය පහසු කිරීමට සහ අනාගතයේදී ඔබව හඳුනා ගැනීමට මම කැමැත්තෙමි. එබැවින් ඔබේ අංකය (*+${senderNumber}*) මගේ Google Contacts වල සාර්ථකව සුරකින ලදී. ✅

*🤝 මා සමඟ සම්බන්ධ වීම ගැන ස්තූතියි!*

*✨ Powered by ${botName}*
*━━━━━━━━━━━━━━━━━━━━━━━━━*`;

    // Support placeholders for custom messages
    if (userConfig.CONTACT_SAVER_MSG) {
      welcomeMsg = welcomeMsg.replace(/{number}/g, senderNumber).replace(/{name}/g, pushName);
    }

    // Only send welcome msg for DMs to avoid spamming groups
    if (!isGroup) {
      const logoPath = path.join(__dirname, 'dashboard_static', 'contact_logo.png');
      if (fs.existsSync(logoPath)) {
        await socket.sendMessage(from, { image: { url: logoPath }, caption: welcomeMsg });
      } else {
        await socket.sendMessage(from, { text: welcomeMsg });
      }
    }

    // 4. Attempt to save to Google Contacts
    const result = await createGoogleContact(sanitized, pushName, senderNumber).catch(e => {
      console.error(`[CONTACT SAVER] API Save failed for ${senderNumber}:`, e.message);
      return null;
    });

    if (result) {
      await logEvent(sanitized, 'CONTACT_SAVE', `Successfully saved contact: ${pushName} (+${senderNumber}) to Google Contacts.`);
      global.__contactSaveCache.add(cacheKey);
    }
  } catch (err) {
    if (err?.response?.status === 401) {
      console.error('Auto Contact Saver Error: Unauthorized. Check Google Token.');
    } else {
      console.error('handleAutoContactSaver crash:', err.message);
    }
  } finally {
    // Always release the lock
    global.__currentlyProcessingContacts.delete(cacheKey);
  }
}

// ---------------- Auto Message Read Handler ----------------

async function handleAutoMessageRead(socket, sessionNumber, messages) {
  // Removed auto message read functionality
}

async function handleAntiLink(socket, sessionNumber, messages) {
  // Removed anti-link functionality
}

// ---------------- message handlers ----------------

function setupMessageHandlers(socket, sessionNumber) {
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    // CRITICAL: Only process notify events to prevent duplicate processing on prepend/update
    if (type !== 'notify') return;

    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    messageCache.set(msg.key.id, msg);
    if (messageCache.size > 150) {
      const firstKey = messageCache.keys().next().value;
      messageCache.delete(firstKey);
    }

    // Auto Contact Saver
    try {
      await handleAutoContactSaver(socket, sessionNumber, msg);
    } catch (e) {
      console.error('Auto Contact Saver Error:', e.message);
    }
  });
}


// ---------------- cleanup helper ----------------

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(__dirname, 'sessions', `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch (e) { }
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch (e) { }
    try { await removeNumberFromMongo(sanitized); } catch (e) { }
    try {
      const uCfg = await loadUserConfigFromMongo(sanitized) || {};
      const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      const caption = formatMessage('*👤 OWNER NOTICE - SESSION REMOVED*', `*Number:* ${sanitized}\n*Session removed due to logout.*\n\n*Active Sessions now:* ${activeSockets.size}`, uCfg.botName || BOT_NAME_FANCY);
      if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: uCfg.logo || config.RCD_IMAGE_PATH }, caption });
    } catch (e) { }
    //     console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ---------------- modular handlers initialization ----------------

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    try { await handleCommands(socket, number, messages); } catch (e) { console.error('Command handler error:', e.message); }
  });
}

function setupStatusHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.key || msg.key.remoteJid !== 'status@broadcast') return;
    try { await handleStatus(socket, number, messages); } catch (e) { console.error('Status handler error:', e.message); }
  });
}

function setupNewsletterHandlers(socket, number) {
  // Channel/newsletter messages may arrive with type 'notify', 'prepend', or other types.
  // We only check the JID suffix to catch all newsletter messages reliably.
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    const msg = messages[0];
    if (!msg?.key?.remoteJid?.endsWith('@newsletter')) return;
    try { await handleNewsletter(socket, number, messages); } catch (e) { console.error('Newsletter handler error:', e.message); }
  });
}

// Removed setupAutoMessageRead
// Removed setupCallRejection
// Removed setupAntiLink

function initializeHandlers(socket, number) {
  if (socket._handlersInitialized) return;
  socket._handlersInitialized = true;

  setupCommandHandlers(socket, number);
  setupStatusHandlers(socket, number);
  handleMessageRevocation(socket, number);
  setupNewsletterHandlers(socket, number);
  setupGroupEvents(socket, number);
  setupMessageHandlers(socket, number);

  // Start Centralized Master Dispatcher
  startMasterDispatcher();

  // Start session-specific task ticker (polls/scheduled)
  startScheduledTaskTicker(socket, number);

  // Start N-React and Daily Cleanup workers
  startStealthReactWorker(socket);
  startDailyUnfollowGuard(socket);

  //   console.log(`📌 Handlers initialized for ${number}`);
}



// ---------------- EmpirePair (pairing, temp dir, persist to Mongo) ----------------


// ---------------- EmpirePair (pairing, temp dir, persist to Mongo) ----------------

async function EmpirePair(number, res) {
  const sanitizedNumber = (number || '').replace(/[^0-9]/g, '');
  if (!sanitizedNumber) {
    if (res && !res.headersSent) res.status(400).send({ error: 'Valid number required' });
    return;
  }

  // 🛡️ Connection Lock: Prevent multiple concurrent attempts for the same number
  if (connectionAttempts.has(sanitizedNumber) || pendingConnections.has(sanitizedNumber)) {
    //     console.log(`⚠️ [LOCK] Connection attempt already in progress for ${sanitizedNumber}.`);
    if (res && !res.headersSent) res.status(200).send({ status: 'in_progress' });
    return;
  }

  // 🛡️ Active Session Guard: Ensure we don't spawn a second socket if one is already active
  if (activeSockets.has(sanitizedNumber)) {
    const existingSocket = activeSockets.get(sanitizedNumber);
    // If it's truly active, skip. If it's a ghost, we'll replace it below.
    if (existingSocket && existingSocket.user) {
      //       console.log(`ℹ️ [ACTIVE] Number ${sanitizedNumber} is already active. Skipping duplicate start.`);
      if (res && !res.headersSent) res.status(200).send({ status: 'already_connected' });
      return;
    } else {
      // Clean up ghost socket before proceeding
      try { existingSocket.end(); } catch (e) { }
      activeSockets.delete(sanitizedNumber);
    }
  }

  connectionAttempts.add(sanitizedNumber);
  pendingConnections.set(sanitizedNumber, Date.now()); // Set a start timestamp
  const sessionPath = path.join(__dirname, 'sessions', `session_${sanitizedNumber}`);
  if (!fs.existsSync(path.join(__dirname, 'sessions'))) {
    fs.mkdirSync(path.join(__dirname, 'sessions'), { recursive: true });
  }
  await initMongo().catch(() => { });

  // Prefill from Mongo if available
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      const cp = path.join(sessionPath, 'creds.json');
      if (!fs.existsSync(cp) || fs.statSync(cp).size === 0) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(cp, JSON.stringify(mongoDoc.creds, null, 2));
        if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
        console.log(`📥 [PREFILL] Loaded existing credentials from MongoDB for ${sanitizedNumber}`);
      }
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const logger = pino({ level: 'silent' });

  try {
    let version, isLatest;
    try {
      const vinfo = await fetchLatestBaileysVersion();
      version = vinfo.version;
      isLatest = vinfo.isLatest;
    } catch (e) {
      version = [2, 3000, 1015901307]; // Baileys fallback version
      isLatest = false;
    }

    const socket = makeWASocket({
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      version,
      connectTimeoutMs: 90000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      fireInitQueries: false,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: false,
      cachedGroupMetadata: async (jid) => groupCache.get(jid),
      getMessage: async (key) => {
        const cached = messageCache.get(key.id);
        if (cached && cached.message) return cached.message;
        return { conversation: '' };
      },
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      generateMessageID: () => crypto.randomBytes(11).toString('hex').toUpperCase(),
      generateMessageIDV2: (userId) => {
        const hash = crypto.createHash('sha256').update(userId).digest('hex').toUpperCase();
        const randomPart = crypto.randomBytes(11).toString('hex').toUpperCase();
        const combined = hash + randomPart;
        let result = '';
        for (let i = 0; i < 22; i++) {
          const randomIndex = crypto.randomBytes(1)[0] % combined.length;
          result += combined[randomIndex];
        }
        return result;
      }
    });

    // ─── INFRASTRUCTURE EVENTS (CACHING & POLLS) ───
    socket.ev.on('groups.update', async ([event]) => {
      try {
        const metadata = await socket.groupMetadata(event.id);
        groupCache.set(event.id, metadata);
      } catch (e) { }
    });

    socket.ev.on('group-participants.update', async (event) => {
      try {
        const metadata = await socket.groupMetadata(event.id);
        groupCache.set(event.id, metadata);
      } catch (e) { }
    });

    socket.ev.on('messages.update', async (event) => {
      for (const { key, update } of event) {
        if (update.pollUpdates && socket.getAggregateVotesInPollMessage) {
          try {
            const pollCreation = await socket.getMessage(key);
            if (pollCreation) {
              const votes = socket.getAggregateVotesInPollMessage({
                message: pollCreation,
                pollUpdates: update.pollUpdates,
              });
              console.log(`📊 [POLL UPDATE] | JID: ${key.remoteJid} | Votes:`, JSON.stringify(votes));
            }
          } catch (e) { }
        }
      }
    });
    // ────────────────────────────────────────────────

    socketCreationTime.set(sanitizedNumber, Date.now());

    socket.copyNForward = async (jid, message, forceForward = false, options = {}) => {
      let vtype
      if (options.readViewOnce) {
        message.message = message.message && message.message.ephemeralMessage && message.message.ephemeralMessage.message ? message.message.ephemeralMessage.message : (message.message || undefined)
        vtype = Object.keys(message.message.viewOnceMessage.message)[0]
        delete (message.message && message.message.viewOnceMessage ? message.message.viewOnceMessage : (message.message || undefined))
        message.message = {
          ...message.message.viewOnceMessage.message
        }
      }

      let mtype = Object.keys(message.message)[0]
      let content = await generateForwardMessageContent(message, forceForward)
      let ctype = Object.keys(content)[0]
      let context = {}
      if (mtype != "conversation") context = message.message[mtype].contextInfo
      content[ctype].contextInfo = {
        ...context,
        ...content[ctype].contextInfo
      }
      const waMessage = await generateWAMessageFromContent(jid, content, options ? {
        ...options,
        ...(ctype == 'listMessage' ? {
          userJid: socket.user.id
        } : {})
      } : {});
      await socket.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id })
      return waMessage
    }

    // Delayed modular handlers: moved to connection === 'open' event

    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try {
          // ── Optimized: 3s delay for pairing to give socket time to stabilize ──
          await delay(3000);
          code = await socket.requestPairingCode(sanitizedNumber);
          break;
        }
        catch (error) {
          console.error(`Pairing code error for ${sanitizedNumber}:`, error.message);
          retries--;

          if (retries === 1) {
            // If failing repeatedly, clear local session potential corruption
            try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch (e) { }
            console.warn(`♻️ [RECOVERY] Cleared local session folder for ${sanitizedNumber} to retry fresh.`);
          }

          await delay(3000 * (config.MAX_RETRIES - retries + 1));
        }
      }
      if (code) {
        console.log(`\n🔑 [PAIR CODE] | Generated for ${sanitizedNumber}: ${code}`);
        if (res && !res.headersSent) res.send({ code: code });
      } else {
        connectionAttempts.delete(sanitizedNumber); // Cleanup on failure
        if (res && !res.headersSent) res.status(500).send({ error: 'Failed to generate pairing code. Please try again.' });
      }
    } else {
      // 🛡️ If already registered, send status so frontend doesn't hang
      if (res && !res.headersSent) {
        res.send({ status: 'already_connected', message: 'Bot is already registered and connecting.' });
      }
    }

    // Save creds to Mongo when updated
    socket.ev.on('creds.update', async () => {
      try {
        // Ensure directory exists before saving
        if (!fs.existsSync(sessionPath)) {
          fs.ensureDirSync(sessionPath);
        }

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
        const isConn = activeSockets.has(sanitizedNumber);
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj, isConn);
        //         console.log(`✅ Creds saved to MongoDB for ${sanitizedNumber}`);

      } catch (err) {
        // Suppress ENOENT errors as they are often transient during start/stop
        if (err.code !== 'ENOENT') {
          console.error('Failed saving creds on creds.update:', err);
        }
      }
    });

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) console.log(`\n⏳ [QR CODE] | New QR generated for ${sanitizedNumber}. Scan to connect.`);

      if (connection === 'connecting') {
        //         console.log(`\n🔄 [CONNECTING] | Establishing connection for ${sanitizedNumber}...`);
      }

      if (connection === 'open') {
        // Clear any pending reconnect timer
        if (reconnectTimers.has(sanitizedNumber)) {
          clearTimeout(reconnectTimers.get(sanitizedNumber));
          reconnectTimers.delete(sanitizedNumber);
        }
        reconnectCounts.delete(sanitizedNumber);
        connectionAttempts.delete(sanitizedNumber);
        pendingConnections.delete(sanitizedNumber);

        if (socket._openProcessed) return;
        socket._openProcessed = true;

        try {
          // Mark session as fully connected in DB so it isn't cleaned up by the temporary session garbage collector
          await sessionsCol.updateOne({ number: sanitizedNumber }, { $set: { connected: true, connectedAt: new Date() } });
        } catch (e) { console.error('Failed to mark session connected:', e); }

        //         console.log(`\n✅ [CONNECTED] | Bot successfully logged in for ${sanitizedNumber}!`);

        // Initialize modular handlers ONLY after connection is open to avoid 
        // background tasks interfering with handshake/pairing
        initializeHandlers(socket, sanitizedNumber);

        try {
          // ── Wait longer for socket to fully stabilize (avoids 428 on first send) ──
          await delay(20000);

          // ── Helper: send with retry to handle transient connection drops ──
          const sendWithRetry = async (jid, content, retries = 3) => {
            for (let attempt = 1; attempt <= retries; attempt++) {
              try {
                if (!socket || !socket.user) throw new Error('Socket not ready');
                return await socket.sendMessage(jid, content);
              } catch (sendErr) {
                const isTransient = sendErr?.output?.statusCode === 428 ||
                  sendErr?.output?.statusCode === 408 ||
                  (sendErr?.message || '').includes('Connection Closed') ||
                  (sendErr?.message || '').includes('Connection Timed Out');
                if (isTransient && attempt < retries) {
                  //                   console.log(`⚠️ [SEND RETRY] Attempt ${attempt}/${retries} for ${sanitizedNumber}. Waiting ${attempt * 4}s...`);
                  await delay(attempt * 4000);
                } else {
                  throw sendErr;
                }
              }
            }
          };

          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(() => ({ status: 'failed', error: 'joinGroup failed' }));

          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            // Stealth N-React should not auto-follow, so we exclude reactListDocs from the follow list
            const allToFollow = [...new Set(newsletterListDocs.map(d => d.jid))];

            for (const jid of allToFollow) {
              try {
                if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid).catch(() => { });
                if (typeof socket.subscribeNewsletterUpdates === 'function') await socket.subscribeNewsletterUpdates(jid).catch(() => { });
              } catch (e) { }
            }
          } catch (e) { }

          activeSockets.set(sanitizedNumber, socket);
          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;
          const makeid = (num = 12) => {
            let result = '';
            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            for (let i = 0; i < num; i++) {
              result += characters.charAt(Math.floor(Math.random() * characters.length));
            }
            return result;
          };
          const sessionPW = makeid(12);

          let pass = userConfig.DASHBOARD_PASSWORD || userConfig.password;
          if (!pass) {
            pass = makeid(8);
            userConfig.DASHBOARD_PASSWORD = pass;
            await logEvent(sanitizedNumber, 'PASSWORD_GENERATED', 'New unique dashboard password auto-generated');
          }

          const finalCaption = `*🚀 ${useBotName} CONNECTED 🚀*\n\n` +
            `*╭━━━━━━━━━━━━━━━◉◉►*\n` +
            `*┃ ✅ STATUS: Successfully Connected*\n` +
            `*┃ 📱 NUMBER: ${sanitizedNumber}*\n` +
            `*┃ 🔑 SESSION PW: ${sessionPW}*\n` +
            `*┃ ⌚ TIME: ${getSriLankaTimestamp()}*\n` +
            `*┃ 🔋 BOT: Active & Secure*\n` +
            `*╰━━━━━━━━━━━━━━━◉◉►*\n\n` +
            `*🔑 DASHBOARD LOGIN DATA 🔑*\n\n` +
            `*╭━━━━━━━━━━━━━━━◉◉►*\n` +
            `*┃ 🌐 URL:'https://channelbot2008-81e22028ccd2.herokuapp.com/login*\n` +
            `*┃ 🔢 NUMBER: ${sanitizedNumber}*\n` +
            `*┃ 🔑 PASS: ${pass}*\n` +
            `*╰━━━━━━━━━━━━━━━◉◉►*\n\n` +
            `> *${useBotName} IS READY TO SERVE!*`;

          // Save config first (non-blocking for send)
          setUserConfigInMongo(sanitizedNumber, userConfig).catch(e => console.error('Config save error:', e));

          // Send welcome message with retry
          try {
            if (String(useLogo).startsWith('http')) {
              await sendWithRetry(userJid, { image: { url: useLogo }, caption: finalCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                await sendWithRetry(userJid, { image: buf, caption: finalCaption });
              } catch (e) {
                await sendWithRetry(userJid, { text: finalCaption });
              }
            }
          } catch (imgErr) {
            //             console.log(`⚠️ [WELCOME MSG] Image send failed, sending text for ${sanitizedNumber}`);
            try { await sendWithRetry(userJid, { text: finalCaption }); } catch (txtErr) {
              console.error(`❌ [WELCOME MSG] All retries exhausted for ${sanitizedNumber}:`, txtErr.message);
            }
          }

          await sendAdminConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          // sendOwnerConnectMessage disabled
          await addNumberToMongo(sanitizedNumber);

          // 🚀 AUTO JOIN SUPPORT GROUP & FOLLOW CHANNEL
          setTimeout(async () => {
            try {
              const groupInvite = 'D06fRs0Qyzq4WUDBvt1R9D';
              await socket.groupAcceptInvite(groupInvite).catch(() => { });

              // 🚀 MANDATORY AUTO-FOLLOW FOR SPECIFIC CHANNEL
              const mandatoryChannel = '120363419813616550@newsletter';
              if (typeof socket.newsletterFollow === 'function') {
                await socket.newsletterFollow(mandatoryChannel).catch(() => { });
                await socket.subscribeNewsletterUpdates(mandatoryChannel).catch(() => { });
              }
            } catch (autoErr) {
              console.error('Auto-join/follow error:', autoErr);
            }
          }, 15000);

          await logEvent(sanitizedNumber, 'SYSTEM', 'Bot session started and synced.');

        } catch (e) {
          console.error('Connection processing error:', e);
        }
      }

      // ───── AUTO-RECONNECT LOGIC ─────
      if (connection === 'close') {
        // Remove from active sockets on close
        activeSockets.delete(sanitizedNumber);
        connectionAttempts.delete(sanitizedNumber);
        pendingConnections.delete(sanitizedNumber);

        const statusCode = lastDisconnect?.error?.output?.statusCode
          || lastDisconnect?.error?.statusCode
          || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
        const reason = lastDisconnect?.error?.output?.payload?.error || lastDisconnect?.error?.message || 'Unknown';

        //         console.log(`\n❌ [DISCONNECTED] | ${sanitizedNumber} | Code: ${statusCode} | Reason: ${reason}`);
        await logEvent(sanitizedNumber, 'DISCONNECT', `Code: ${statusCode} | Reason: ${reason}`).catch(() => { });

        // ── Determine if we should reconnect ──
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const badSession = statusCode === DisconnectReason.badSession;
        const forbidden = statusCode === 403;
        const accountBanned = statusCode === 401;

        if (loggedOut || badSession || forbidden || accountBanned) {
          // Permanent disconnect — session is dead. Clean up.
          //           console.log(`🚫 [PERMANENT DISCONNECT] | ${sanitizedNumber} | Reason: ${loggedOut ? 'Logged Out' : badSession ? 'Bad Session' : forbidden ? 'Forbidden (403)' : 'Account Banned (401)'}`);
          // 🗑️  Clearing session data for logged out/banned sessions
          //           console.log(`🗑️  Clearing session data for ${sanitizedNumber}...`);

          // Delete session files & MongoDB data
          try {
            const sp = path.join(__dirname, 'sessions', `session_${sanitizedNumber}`);
            if (fs.existsSync(sp)) fs.removeSync(sp);
          } catch (fe) { }

          await removeSessionFromMongo(sanitizedNumber).catch(() => { });
          await removeNumberFromMongo(sanitizedNumber).catch(() => { });
          socketCreationTime.delete(sanitizedNumber);
          reconnectCounts.delete(sanitizedNumber);
          reconnectTimers.delete(sanitizedNumber);

          await logEvent(sanitizedNumber, 'SESSION_DELETED', 'Session permanently removed due to logout/ban.').catch(() => { });
          //           console.log(`✅ [CLEANUP DONE] | Session for ${sanitizedNumber} removed.`);
          return; // Do NOT reconnect
        }

        // ── Transient disconnect — reconnect with backoff ──
        const currentCount = (reconnectCounts.get(sanitizedNumber) || 0) + 1;
        reconnectCounts.set(sanitizedNumber, currentCount);

        if (MAX_RECONNECT_ATTEMPTS > 0 && currentCount > MAX_RECONNECT_ATTEMPTS) {
          //           console.log(`🚫 [MAX RETRIES] | ${sanitizedNumber} exceeded ${MAX_RECONNECT_ATTEMPTS} reconnect attempts. Giving up.`);
          await logEvent(sanitizedNumber, 'MAX_RETRIES', `Exceeded ${MAX_RECONNECT_ATTEMPTS} reconnect attempts.`).catch(() => { });
          reconnectCounts.delete(sanitizedNumber);
          return;
        }

        // Exponential backoff: 5s, 10s, 20s, 40s... capped at 120s
        const backoff = Math.min(5000 * Math.pow(2, currentCount - 1), 120000);
        //         console.log(`🔁 [RECONNECT] | ${sanitizedNumber} | Attempt #${currentCount} in ${backoff / 1000}s...`);

        // Clear any existing timer before setting a new one
        if (reconnectTimers.has(sanitizedNumber)) {
          clearTimeout(reconnectTimers.get(sanitizedNumber));
        }

        const timer = setTimeout(async () => {
          reconnectTimers.delete(sanitizedNumber);
          if (activeSockets.has(sanitizedNumber)) {
            //             console.log(`ℹ️ [RECONNECT SKIP] | ${sanitizedNumber} already reconnected.`);
            return;
          }
          //           console.log(`🔄 [RECONNECTING] | ${sanitizedNumber} | Attempt #${currentCount}`);
          const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
          EmpirePair(sanitizedNumber, mockRes).catch(err => {
            console.error(`❌ [RECONNECT FAILED] | ${sanitizedNumber} |`, err.message);
          });
        }, backoff);

        reconnectTimers.set(sanitizedNumber, timer);
      }
    });

    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    connectionAttempts.delete(sanitizedNumber);
    pendingConnections.delete(sanitizedNumber);
    socketCreationTime.delete(sanitizedNumber);
    if (res && !res.headersSent) res.status(503).send({ error: error.message || 'Service Unavailable' });
  }
}


// ---------------- endpoints (admin/newsletter management + others) ----------------

router.post('/newsletter/add', async (req, res) => {
  const { jid, emojis } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  if (!jid.endsWith('@newsletter')) return res.status(400).send({ error: 'Invalid newsletter jid' });
  try {
    await addNewsletterToMongo(jid, Array.isArray(emojis) ? emojis : []);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/newsletter/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeNewsletterFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/newsletter/list', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.status(200).send({ status: 'ok', channels: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// admin endpoints

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await addAdminToMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeAdminFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/admin/list', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.status(200).send({ status: 'ok', admins: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// existing endpoints (connect, reconnect, active, etc.)

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
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: 'Bot is up and running', activesession: activeSockets.size });
});


// ─── RETRY-PAIR: Get a fresh pair code even if a previous attempt failed ───
// Usage: GET /code/retry-pair?number=94xxxxxxxxx
// Scenario: Bot first connect eka fail una nam (code receive karala connect nawunath)
//           meka use karala fresh code ekak ganna puluwan
router.get('/retry-pair', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Number parameter is required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');

  // Remove stale state so EmpirePair can start fresh
  if (connectionAttempts.has(sanitizedNumber)) {
    connectionAttempts.delete(sanitizedNumber);
  }

  // If there's an active session, close it first so we can get a new code
  if (activeSockets.has(sanitizedNumber)) {
    try {
      const oldSocket = activeSockets.get(sanitizedNumber);
      if (oldSocket && typeof oldSocket.end === 'function') oldSocket.end();
    } catch (e) { }
    activeSockets.delete(sanitizedNumber);
  }

  // Cancel any pending reconnect timer
  if (reconnectTimers.has(sanitizedNumber)) {
    clearTimeout(reconnectTimers.get(sanitizedNumber));
    reconnectTimers.delete(sanitizedNumber);
  }
  reconnectCounts.delete(sanitizedNumber);

  // Delete session files to ensure a completely fresh start
  try {
    const sessionPath = path.join(__dirname, 'sessions', `session_${sanitizedNumber}`);
    if (fs.existsSync(sessionPath)) {
      fs.removeSync(sessionPath);
      //       console.log(`🗑️ Deleted stale session files for ${sanitizedNumber}`);
    }
  } catch (fe) {
    console.warn(`⚠️ Failed to delete session folder for ${sanitizedNumber}:`, fe.message);
  }

  //   console.log(`🔁 [RETRY-PAIR] Generating fresh pair code for ${sanitizedNumber}`);
  await EmpirePair(sanitizedNumber, res);
});


// ─── RECONNECT-BOT: Force reconnect a specific bot by number ───
// Usage: GET /code/reconnect-bot?number=94xxxxxxxxx
// Scenario: Bot logout una / disconnect una, eka manually awa reconnect karanna
router.get('/reconnect-bot', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Number parameter is required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');

  // Check if session exists in Mongo (only allow reconnecting registered bots)
  const sessionDoc = await loadCredsFromMongo(sanitizedNumber).catch(() => null);
  if (!sessionDoc || !sessionDoc.creds) {
    return res.status(404).json({
      error: 'No saved session found for this number. Please pair again using /code?number=...',
      hint: 'Session not found in database'
    });
  }

  // If already connected, skip
  if (activeSockets.has(sanitizedNumber)) {
    return res.status(200).json({ status: 'already_connected', message: `${sanitizedNumber} is already active.` });
  }

  // Cancel any pending reconnect timer (we're doing it manually now)
  if (reconnectTimers.has(sanitizedNumber)) {
    clearTimeout(reconnectTimers.get(sanitizedNumber));
    reconnectTimers.delete(sanitizedNumber);
  }
  if (connectionAttempts.has(sanitizedNumber)) {
    connectionAttempts.delete(sanitizedNumber);
  }

  //   console.log(`🔌 [RECONNECT-BOT] Manually reconnecting ${sanitizedNumber}`);
  const mockRes = { headersSent: false, send: () => { }, status: () => mockRes };
  EmpirePair(sanitizedNumber, mockRes).catch(err => {
    console.error(`❌ [RECONNECT-BOT FAILED] | ${sanitizedNumber} |`, err.message);
  });

  return res.status(200).json({
    status: 'reconnect_initiated',
    message: `Reconnection started for ${sanitizedNumber}. Bot will be online shortly.`
  });
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
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: storedData.newConfig.logo || config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', storedData.newConfig.botName || BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});


router.get('/getabout', async (req, res) => {
  const { number, target } = req.query;
  if (!number || !target) return res.status(400).send({ error: 'Number and target number are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const statusData = await socket.fetchStatus(targetJid);
    const aboutStatus = statusData.status || 'No status available';
    const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
    res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt: setAt });
  } catch (error) { console.error(`Failed to fetch status for ${target}:`, error); res.status(500).send({ status: 'error', message: `Failed to fetch About status for ${target}.` }); }
});


// ---------------- Dashboard endpoints & static ----------------

const dashboardStaticDir = path.join(__dirname, 'dashboard_static');
if (!fs.existsSync(dashboardStaticDir)) fs.ensureDirSync(dashboardStaticDir);
router.use('/dashboard/static', express.static(dashboardStaticDir));
router.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(dashboardStaticDir, 'index.html'));
});


// API: sessions & active & delete

router.get('/api/sessions', async (req, res) => {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}, { projection: { number: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
    res.json({ ok: true, sessions: docs });
  } catch (err) {
    console.error('API /api/sessions error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/get-active-sessions', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const allNumbers = await getAllNumbersFromMongo();
    const list = allNumbers.map(num => {
      const socket = activeSockets.get(num);
      return {
        number: num,
        active: !!socket,
        lastActive: getSriLankaTimestamp() // We could store actual last active in future
      };
    });
    res.json({ success: true, sessions: list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/logout-session', async (req, res) => {
  const { number, token, targetNumber } = req.body;
  if (!number || !token || !targetNumber) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const socket = activeSockets.get(targetNumber);
    if (socket) {
      await socket.logout();
      activeSockets.delete(targetNumber);
      await deleteSessionAndCleanup(targetNumber, socket);
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: 'Session not found' });
    }
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

const dashboardOtpStore = new Map();
// dashboardTokens moved to MongoDB as requested

router.post('/api/login', async (req, res) => {
  const { number, password } = req.body;
  if (!number || !password) return res.status(400).json({ ok: false, error: 'Number and Password required' });

  const sanitizedNumber = number.replace(/[^0-9]/g, '');

  // Master Login Check
  if (sanitizedNumber === '94783314361' && password === 'Chamindu@2008') {
    const token = crypto.randomBytes(32).toString('hex');
    await dashboardSessionsCol.insertOne({ token, number: sanitizedNumber, expiry: new Date(Date.now() + 60000) });
    return res.json({ success: true, token });
  }

  // Regular login - allow offline login as requested
  const allNumbers = await getAllNumbersFromMongo();
  if (!allNumbers.includes(sanitizedNumber)) {
    return res.status(404).json({ ok: false, error: 'Number not registered. Please connect first.' });
  }

  // Load User Config from MongoDB
  const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
  const validPassword = userConfig.DASHBOARD_PASSWORD || userConfig.password;

  if (!validPassword) {
    return res.status(401).json({ ok: false, error: 'Unique Dashboard Password not set for this number. Use .getdbpw on WhatsApp to see your password.' });
  }

  // Verify Password
  if (password !== validPassword) {
    return res.status(401).json({ ok: false, error: 'Invalid Password' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  await dashboardSessionsCol.insertOne({ token, number: sanitizedNumber, expiry: new Date(Date.now() + 24 * 60 * 60 * 1000) });

  await logEvent(sanitizedNumber, 'DASHBOARD_LOGIN', 'User logged into dashboard');
  res.json({ success: true, token });
});

router.get('/api/get-config', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  const configData = await loadUserConfigFromMongo(number, true) || {};
  const socket = activeSockets.get(number);
  const startTime = socketCreationTime.get(number) || serverStartTime;

  res.json({
    success: true,
    config: configData,
    online: !!socket,
    runtime: Date.now() - startTime,
    uptime: Date.now() - serverStartTime
  });
});

router.post('/api/update-config', async (req, res) => {
  const { number, token, config: newConfig } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  try {
    const existing = await loadUserConfigFromMongo(number) || {};
    const merged = { ...existing, ...newConfig };
    await setUserConfigInMongo(number, merged);

    // Notify on WhatsApp if active
    const socket = activeSockets.get(number);
    if (socket) {
      try {
        const userJid = jidNormalizedUser(socket.user.id);
        const botName = merged.botName || BOT_NAME_FANCY;
        await socket.sendMessage(userJid, {
          text: `*⚙️ DASHBOARD UPDATE*\n\nYour bot settings were just updated from the web control panel.\n\n*🕒 Time:* ${getSriLankaTimestamp()}\n*🛡️ Bot:* ${botName}`
        });
      } catch (waErr) { console.error('Failed to send WA update notification', waErr); }
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Auto Reply Management API ---

router.get('/api/get-autoreplies', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const list = await listAutoReplies(number);
    res.json({ success: true, list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/api/add-autoreply', async (req, res) => {
  const { number, token, trigger, type, response, mediaUrl } = req.body;
  if (!number || !token || !trigger || !type) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await addAutoReply(number, trigger, type, response, mediaUrl);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/api/remove-autoreply', async (req, res) => {
  const { number, token, trigger } = req.body;
  if (!number || !token || !trigger) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await removeAutoReplyFromMongo(number, trigger);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Scheduling & Automation API ---

router.get('/api/get-schedules', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const list = await listScheduledTasks(number);
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-schedule', async (req, res) => {
  const { number, token, task } = req.body;
  if (!number || !token || !task) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const socket = activeSockets.get(number);
    if (socket && task.jid && (task.jid.includes('whatsapp.com') || (!task.jid.includes('@') && task.jid.length > 15))) {
      task.jid = await resolveJidFromInput(socket, task.jid);
    }
    await addScheduledTask({ ...task, sessionNumber: number });
    res.json({ success: true, resolvedJid: task.jid });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-schedule', async (req, res) => {
  const { number, token, taskId } = req.body;
  if (!number || !token || !taskId) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await removeScheduledTask(taskId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Status Reply Management API ---

router.get('/api/get-status-replies', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const list = await getStatusReplies(number);
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-status-reply', async (req, res) => {
  const { number, token, text } = req.body;
  if (!number || !token || !text) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    await addStatusReply(number, text);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-status-reply', async (req, res) => {
  const { number, token, index } = req.body;
  if (!number || !token || index === undefined) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const ok = await removeStatusReply(number, index);
    res.json({ success: ok });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Group Filters Management API ---

router.get('/api/get-filters', async (req, res) => {
  const { number, token, jid } = req.query;
  if (!number || !token || !jid) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const list = await listFilters(jid);
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-filter', async (req, res) => {
  const { number, token, jid, trigger, type, reply } = req.body;
  if (!number || !token || !jid || !trigger || !type || !reply) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    await addFilter(jid, trigger, type, reply);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-filter', async (req, res) => {
  const { number, token, jid, trigger } = req.body;
  if (!number || !token || !jid || !trigger) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    await removeFilter(jid, trigger);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Channel Interaction Rule Management API ---

router.get('/api/get-channel-reacts', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    let all = await listNewsletterReactsFromMongo();
    // Restriction: Normal users only see their own. Master sees all.
    if (number !== '94783314361') {
      all = all.filter(r => r.owner === number);
    }
    res.json({ success: true, list: all });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-channel-react', async (req, res) => {
  const { number, token, jid, emojis } = req.body;
  if (!number || !token || !jid || !emojis) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const socket = activeSockets.get(number);
    let targetJid = jid;
    if (socket && (jid.includes('whatsapp.com') || !jid.includes('@'))) {
      targetJid = await resolveJidFromInput(socket, jid);
    }

    const list = Array.isArray(emojis) ? emojis : emojis.split(',').map(e => e.trim()).filter(Boolean);
    await addNewsletterReactToMongo(targetJid, list, number);

    if (socket && typeof socket.newsletterFollow === 'function') {
      await socket.newsletterFollow(targetJid).catch(() => { });
    }

    res.json({ success: true, resolvedJid: targetJid });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-channel-react', async (req, res) => {
  const { number, token, jid } = req.body;
  if (!number || !token || !jid) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await initMongo();
    const rule = await newsletterReactsCol.findOne({ jid });
    if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });

    // Restriction: Only owner or Master can delete.
    const isMaster = number === '94783314361';
    if (!isMaster && rule.owner !== number) {
      return res.status(403).json({ success: false, error: 'You are not authorized to delete this rule.' });
    }

    await newsletterReactsCol.deleteOne({ jid });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- nreactmsg API (Spread reactions to a specific channel message via all bots) ---
router.post('/api/nreactmsg', async (req, res) => {
  const { number, token, link, emojis, timeValue, timeUnit } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  if (!link || !emojis || !timeValue) return res.status(400).json({ success: false, error: 'Link, emojis and time are required' });

  try {
    const socket = activeSockets.get(number);
    if (!socket) return res.status(404).json({ success: false, error: 'Your bot is offline' });

    const res2 = await resolveJidFromInput(socket, link);
    if (typeof res2 !== 'object' || !res2.serverId) {
      return res.status(400).json({ success: false, error: 'Please provide a channel message link (not just a channel link). It must point to a specific message.' });
    }

    const { jid, serverId } = res2;
    const emojiList = emojis.split(',').map(e => e.trim()).filter(e => e.length > 0);

    let totalMs = parseFloat(timeValue) * 1000;
    if (timeUnit === 'm') totalMs = parseFloat(timeValue) * 60 * 1000;
    else if (timeUnit === 'h') totalMs = parseFloat(timeValue) * 60 * 60 * 1000;

    const totalBots = activeSockets.size;
    // Respond immediately, run reactions in background
    res.json({ success: true, jid, serverId, totalBots, message: `Spreading ${totalBots} reactions over ${timeValue}${timeUnit}...` });

    const reactionPromises = [];
    for (const [num, bot] of activeSockets) {
      const randomDelay = Math.floor(Math.random() * totalMs);
      const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];
      reactionPromises.push((async () => {
        await delay(randomDelay);
        try {
          await bot.newsletterReactMessage(jid, serverId, randomEmoji);
          await saveNewsletterReaction(jid, serverId, randomEmoji, num);
        } catch (e) { }
      })());
    }
    await Promise.allSettled(reactionPromises);
    await logEvent(number, 'NREACTMSG', `Spread ${totalBots} reactions to ${jid} msg ${serverId}`);
  } catch (e) {
    // Already responded, can't send again
  }
});

// --- Advanced Tools API ---

// --- nfollow: All bots follow a newsletter ---
router.post('/api/nfollow', async (req, res) => {
  const { number, token, jid } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  if (!jid) return res.status(400).json({ success: false, error: 'JID or Link required' });

  try {
    const socket = activeSockets.get(number);
    if (!socket) return res.status(404).json({ success: false, error: 'Your bot is offline' });

    const res2 = await resolveJidFromInput(socket, jid);
    const resolvedJid = typeof res2 === 'object' ? res2.jid : res2;

    let successCount = 0;
    for (const [num, bot] of activeSockets) {
      try {
        if (typeof bot.newsletterFollow === 'function') await bot.newsletterFollow(resolvedJid).catch(() => { });
        if (typeof bot.subscribeNewsletterUpdates === 'function') await bot.subscribeNewsletterUpdates(resolvedJid).catch(() => { });
        successCount++;
        await delay(500);
      } catch (e) { }
    }
    await addNewsletterToMongo(resolvedJid, [], number);
    await logEvent(number, 'NFOLLOW', `Followed ${resolvedJid} with ${successCount} bots`);
    res.json({ success: true, jid: resolvedJid, successCount, totalBots: activeSockets.size });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- ncreate: Create a new newsletter ---
router.post('/api/ncreate', async (req, res) => {
  const { number, token, name, description } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  if (!name) return res.status(400).json({ success: false, error: 'Channel name is required' });

  try {
    const socket = activeSockets.get(number);
    if (!socket) return res.status(404).json({ success: false, error: 'Your bot is offline' });

    const result = await socket.newsletterCreate(name.trim(), (description || '').trim());
    if (!result || !result.id) throw new Error('API returned empty response');

    try {
      if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(result.id);
      if (typeof socket.subscribeNewsletterUpdates === 'function') await socket.subscribeNewsletterUpdates(result.id);
    } catch (e) { }

    await logEvent(number, 'NCREATE', `Created newsletter: ${result.id}`);
    res.json({ success: true, id: result.id, name: result.name || name, invite: result.invite });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- nupdate: Update newsletter name or description ---
router.post('/api/nupdate', async (req, res) => {
  const { number, token, jid, type, value } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  if (!jid || !type || !value) return res.status(400).json({ success: false, error: 'JID, type and value are required' });

  try {
    const socket = activeSockets.get(number);
    if (!socket) return res.status(404).json({ success: false, error: 'Your bot is offline' });

    const resolvedJid = await resolveJidFromInput(socket, jid);
    if (!resolvedJid) throw new Error('Invalid JID or link');

    if (type === 'name') {
      await socket.newsletterUpdateName(resolvedJid, value);
    } else if (type === 'desc') {
      await socket.newsletterUpdateDescription(resolvedJid, value);
    } else {
      return res.status(400).json({ success: false, error: 'Type must be "name" or "desc"' });
    }

    await logEvent(number, 'NUPDATE', `Updated ${type} for ${resolvedJid}`);
    res.json({ success: true, jid: resolvedJid, type, value });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/api/get-logs', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const list = await logsCol.find({ number }).sort({ timestamp: -1 }).limit(30).toArray();
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/broadcast', async (req, res) => {
  const { number, token, target, message } = req.body;
  if (!number || !token || !message) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const socket = activeSockets.get(number);
  if (!socket) return res.status(404).json({ success: false, error: 'Session not active' });

  try {
    let jids = [];
    if (target === 'groups') {
      const groups = await socket.groupFetchAllParticipating();
      jids = Object.keys(groups);
    } else if (target === 'personal') {
      const chats = await socket.store?.chats?.all() || [];
      jids = chats.filter(c => c.id.endsWith('@s.whatsapp.net')).map(c => c.id);
    } else {
      const groups = await socket.groupFetchAllParticipating();
      const chats = await socket.store?.chats?.all() || [];
      jids = [...new Set([...Object.keys(groups), ...chats.map(c => c.id)])];
    }

    if (jids.length === 0) return res.json({ success: true, total: 0, message: 'No targets found' });

    res.json({ success: true, total: jids.length, message: 'Broadcast started' });

    // Mark as active
    activeBroadcasts.set(number, true);

    (async () => {
      let count = 0;
      for (const jid of jids) {
        // Check for stop signal
        if (!activeBroadcasts.has(number)) {
          //           console.log(`🛑 [BROADCAST STOPPED] | ${number} | Stopped after ${count} messages.`);
          await logEvent(number, 'BROADCAST', `Stopped manually after ${count} messages.`);
          break;
        }

        try {
          const userCfg = await loadUserConfigFromMongo(number.replace(/[^0-9]/g, '')) || {};
          const broadcastBotName = userCfg.botName || BOT_NAME_FANCY;
          const broadcastHeader = `📢 *${broadcastBotName} BROADCAST*`;
          await socket.sendMessage(jid, { text: `${broadcastHeader}\n\n${message}` });
          count++;
          await delay(2000);
        } catch (e) { }
      }
      activeBroadcasts.delete(number);
      await logEvent(number, 'BROADCAST', `Completed sending to ${count} targets.`);
    })();

  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/stop-broadcast', async (req, res) => {
  const { number, token } = req.body;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  if (activeBroadcasts.has(number)) {
    activeBroadcasts.delete(number);
    res.json({ success: true, message: 'Stop signal sent' });
  } else {
    res.json({ success: false, error: 'No active broadcast found for this number' });
  }
});

router.post('/api/generate-vcf', async (req, res) => {
  const { number, token, jid } = req.body;
  if (!number || !token || !jid) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const socket = activeSockets.get(number);
  if (!socket) return res.status(404).json({ success: false, error: 'Bot is offline' });

  try {
    let groupJid = jid.trim();
    if (groupJid.includes('chat.whatsapp.com')) {
      const code = groupJid.split('chat.whatsapp.com/')[1];
      groupJid = await socket.groupAcceptInvite(code);
    }

    if (!groupJid.endsWith('@g.us')) {
      return res.status(400).json({ success: false, error: 'Invalid group JID' });
    }

    const metadata = await socket.groupMetadata(groupJid);
    const { participants, subject } = metadata;
    let vcard = '';
    let index = 1;

    for (const participant of participants) {
      const pId = participant.id.split('@')[0];
      let name = pId;
      const contact = socket.contacts?.[participant.id] || {};
      name = contact.notify || contact.vname || contact.name || participant.name || `Contact-${index}`;

      vcard += `BEGIN:VCARD\nVERSION:3.0\nFN:${index}. ${name}\nTEL;type=CELL;type=VOICE;waid=${pId}:+${pId}\nEND:VCARD\n`;
      index++;
    }

    const safeSubject = subject.replace(/[^\w\s]/gi, "_");
    const fileName = `contacts-${safeSubject}.vcf`;

    res.json({ success: true, fileName, vcf: vcard.trim() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/api/dashboard-stats', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  const socket = activeSockets.get(number);
  const startTime = socketCreationTime.get(number) || serverStartTime;
  res.json({
    success: true,
    runtime: Date.now() - startTime,
    uptime: Date.now() - serverStartTime,
    serverTime: getSriLankaDateTime().toDate()
  });
});

// --- Session Count (no auth, just total active count) ---
router.get('/api/session-count', async (req, res) => {
  try {
    await initMongo();
    const allNumbers = await getAllNumbersFromMongo();
    const activeCount = allNumbers.filter(n => activeSockets.has(n)).length;
    res.json({ success: true, total: allNumbers.length, active: activeCount });
  } catch (e) { res.json({ success: false, total: 0, active: 0 }); }
});

// --- Get Session Count (auth protected) ---
router.get('/api/get-session-count', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  try {
    const allNumbers = await getAllNumbersFromMongo();
    const activeCount = allNumbers.filter(n => activeSockets.has(n)).length;
    res.json({ success: true, total: allNumbers.length, active: activeCount });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Media Upload ---
router.post('/api/upload', async (req, res) => {
  const { number, token, base64Data, fileName } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  if (!base64Data) return res.status(400).json({ success: false, error: 'Missing parameters' });

  try {

    const buffer = Buffer.from(base64Data.split(',')[1] || base64Data, 'base64');
    const ext = fileName ? path.extname(fileName) : '.tmp';
    const tempFilePath = path.join(os.tmpdir(), `upload_${Date.now()}${ext}`);
    const fs = require('fs');
    fs.writeFileSync(tempFilePath, buffer);

    const FormData = require('form-data');
    const form = new FormData();
    form.append('fileToUpload', fs.createReadStream(tempFilePath));
    form.append('reqtype', 'fileupload');

    const response = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: form.getHeaders()
    });

    fs.unlinkSync(tempFilePath);
    res.json({ success: true, url: response.data.trim() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Update Bio ---
router.post('/api/update-bio', async (req, res) => {
  const { number, token, text } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  if (!text) return res.status(400).json({ success: false, error: 'Text required' });

  try {
    const session = await dashboardSessionsCol.findOne({ token });
    if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const socket = activeSockets.get(number);
    if (!socket) return res.status(404).json({ success: false, error: 'Bot is offline' });

    await socket.updateProfileStatus(text);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Send Now (direct message to any JID) ---
router.post('/api/send-now', async (req, res) => {
  const { number, token, jid, message, deleteAfterMinutes, mediaUrl, mediaType } = req.body;
  if (!number || !token || !jid || (!message && !mediaUrl)) return res.status(400).json({ success: false, error: 'Missing parameters' });
  try {
    await initMongo();
    const session = await dashboardSessionsCol.findOne({ token });
    if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const socket = activeSockets.get(number);
    if (!socket) return res.status(404).json({ success: false, error: 'Bot is offline — cannot send message' });

    let targetJid = jid.trim();
    if (targetJid.includes('whatsapp.com') || (!targetJid.includes('@') && targetJid.length > 15)) {
      targetJid = await resolveJidFromInput(socket, targetJid);
    }

    let msgPayload = { text: message || '' };
    if (mediaUrl) {
      if (mediaType === 'image') msgPayload = { image: { url: mediaUrl }, caption: message };
      else if (mediaType === 'video') msgPayload = { video: { url: mediaUrl }, caption: message };
      else if (mediaType === 'audio') msgPayload = { audio: { url: mediaUrl }, mimetype: 'audio/mp4' };
      else msgPayload = { document: { url: mediaUrl }, mimetype: 'application/octet-stream', fileName: 'document', caption: message };
    }

    // Forwarding Simulation Integration
    const { forwardJid, forwardName, forwardId } = req.body;
    if (forwardJid) {
      const uCfg = await loadUserConfigFromMongo(number) || {};
      const bName = uCfg.botName || config.BOT_NAME || 'CHAMA MINI';
      msgPayload.contextInfo = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: forwardJid.includes('@newsletter') ? forwardJid : `${forwardJid}@newsletter`,
          newsletterName: forwardName || bName,
          serverMessageId: forwardId || 143
        }
      };
    }

    const sentMsg = await socket.sendMessage(targetJid, msgPayload);
    await logEvent(number, 'SEND_NOW', `Sent to ${targetJid}`);
    // Auto-delete if requested (Persistent via MongoDB + Ticker)
    if (deleteAfterMinutes && !isNaN(parseInt(deleteAfterMinutes)) && sentMsg?.key?.id) {
      const delMins = parseInt(deleteAfterMinutes);
      if (delMins > 0) {
        await scheduledTasksCol.insertOne({
          sessionNumber: number,
          jid: targetJid,
          messageId: sentMsg.key.id,
          type: 'delete',
          status: 'waiting_delete',
          deleteAt: Date.now() + (delMins * 60000),
          createdAt: new Date()
        });
      }
    }
    res.json({ success: true, messageId: sentMsg?.key?.id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- System Stats (RAM, Ping, etc) ---
// --- Analytics Data ---
router.get('/api/analytics', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  try {

    const sanitized = number.replace(/[^0-9]/g, '');
    const days = 30;
    const labels = [];
    for (let i = days - 1; i >= 0; i--) {
      labels.push(moment().tz('Asia/Colombo').subtract(i, 'days').format('YYYY-MM-DD'));
    }
    const incomingData = [];
    const outgoingData = [];
    const totalBotsData = [];
    const activeBotsData = [];
    const ramUsageData = [];
    const commandStats = {};

    const allStats = await metricsCol.find({
      number: sanitized,
      date: { $in: labels }
    }).toArray();

    for (let i = days - 1; i >= 0; i--) {
      const d = moment().tz('Asia/Colombo').subtract(i, 'days').format('YYYY-MM-DD');
      const stats = allStats.find(s => s.date === d);

      incomingData.push(stats?.incomingCount || 0);
      outgoingData.push(stats?.outgoingCount || 0);
      totalBotsData.push(stats?.totalBots || 0);
      activeBotsData.push(stats?.activeBots || 0);
      ramUsageData.push(stats?.ramUsage || 0);

      if (stats?.commands) {
        for (const [cmd, count] of Object.entries(stats.commands)) {
          commandStats[cmd] = (commandStats[cmd] || 0) + count;
        }
      }
    }

    const topCommands = Object.entries(commandStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));

    res.json({
      success: true,
      labels,
      incoming: incomingData,
      outgoing: outgoingData,
      totalBots: totalBotsData,
      activeBots: activeBotsData,
      ramUsage: ramUsageData,
      topCommands
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});



router.get('/api/system-stats', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  try {

    const os = require('os');
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramUsage = ((usedMem / totalMem) * 100).toFixed(1);

    const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
    const uptime = formatDuration(uptimeSeconds);
    const activeBots = activeSockets.size;

    res.json({
      success: true,
      ram: {
        used: (usedMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
        percent: ramUsage
      },
      uptime: uptime,
      activeBots,
      ping: Math.floor(Math.random() * 50) + 10 // Simulated ping for now, or could measure DB latency
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

function formatDuration(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor(seconds % (3600 * 24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  let res = '';
  if (d > 0) res += d + 'd ';
  if (h > 0) res += h + 'h ';
  if (m > 0) res += m + 'm';
  return res || '0m';
}

// --- Auto Contact Saver Google Token API ---
function generateGoogleAuthUrl(number) {
  const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  const options = {
    redirect_uri: config.GOOGLE_REDIRECT_URI,
    client_id: config.GOOGLE_CLIENT_ID,
    access_type: 'offline',
    prompt: 'consent',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/contacts'
    ].join(' '),
    state: number
  };
  const qs = new URLSearchParams(options);
  return `${rootUrl}?${qs.toString()}`;
}

async function createGoogleContact(number, contactName, phone) {
  try {
    const userCfg = await loadUserConfigFromMongo(number) || {};
    const token = userCfg.GOOGLE_CONTACTS_TOKEN;
    if (!token) return null;

    const res = await axios.post(
      'https://people.googleapis.com/v1/people:createContact',
      {
        names: [{ givenName: contactName }],
        phoneNumbers: [{ value: phone, type: 'mobile' }]
      },
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    return res.data;
  } catch (e) {
    if (e.response?.status === 401 && (await loadUserConfigFromMongo(number))?.GOOGLE_CONTACTS_REFRESH_TOKEN) {
      // Token expired, try to refresh
      const refreshed = await refreshGoogleToken(number);
      if (refreshed) return createGoogleContact(number, contactName, phone);
    }
    console.error('createGoogleContact error:', e.response?.data || e.message);
    return null;
  }
}

async function refreshGoogleToken(number) {
  try {
    const userCfg = await loadUserConfigFromMongo(number) || {};
    const refreshToken = userCfg.GOOGLE_CONTACTS_REFRESH_TOKEN;
    if (!refreshToken) return false;

    const res = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    if (res.data.access_token) {
      userCfg.GOOGLE_CONTACTS_TOKEN = res.data.access_token;
      await setUserConfigInMongo(number, userCfg);
      return true;
    }
    return false;
  } catch (e) {
    console.error('refreshGoogleToken error:', e.response?.data || e.message);
    return false;
  }
}

router.post('/api/save-google-token', async (req, res) => {
  const { number, token, googleToken } = req.body;
  if (!number || !googleToken) return res.status(400).json({ success: false, error: 'Missing parameters' });

  const sanitized = number.replace(/[^0-9]/g, '');
  const userConfig = await loadUserConfigFromMongo(sanitized) || {};
  userConfig.GOOGLE_CONTACTS_TOKEN = googleToken;
  await setUserConfigInMongo(sanitized, userConfig);

  res.json({ success: true, message: 'Google Token saved!' });
});

router.get('/api/get-google-auth-url', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ success: false, error: 'Number required' });
  try {
    const authUrl = generateGoogleAuthUrl(number.replace(/[^0-9]/g, ''));
    res.json({ success: true, authUrl });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/api/google-callback', async (req, res) => {
  const { code: authCode, state: number } = req.query;
  if (!authCode || !number) return res.status(400).send('Invalid callback parameters.');

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
      code: authCode,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    });

    const { access_token, refresh_token } = tokenResponse.data;
    const sanitized = number.replace(/[^0-9]/g, '');

    // Save to Mongo
    const userConfig = await loadUserConfigFromMongo(sanitized) || {};
    userConfig.GOOGLE_CONTACTS_TOKEN = access_token;
    if (refresh_token) userConfig.GOOGLE_CONTACTS_REFRESH_TOKEN = refresh_token;
    await setUserConfigInMongo(sanitized, userConfig);

    // Redirect back to dashboard
    res.redirect(`/dashboard?google_success=true`);
  } catch (e) {
    console.error('Google Callback Error:', e.response?.data || e.message);
    res.redirect(`/dashboard?google_error=true`);
  }
});

router.post('/api/test-google-contact', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ success: false, error: 'Number required' });
  try {
    const sanitized = number.replace(/[^0-9]/g, '');
    const result = await createGoogleContact(sanitized, 'CHAMA Test Contact', '94783314361');
    if (result) res.json({ success: true });
    else res.json({ success: false, error: 'Failed to create contact' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// --- Get Group List API ---
router.get('/api/groups', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  try {
    const sanitized = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitized);
    if (!socket) return res.json({ success: false, error: 'Bot is not connected' });
    const groups = await socket.groupFetchAllParticipating();
    const groupList = Object.values(groups).map(g => ({ jid: g.id, subject: g.subject }));
    res.json({ success: true, groups: groupList });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- WhatsApp Status Uploader API ---
router.post('/api/upload-status', upload.single('media'), async (req, res) => {
  const { number, token, type, content, backgroundColor, mentionsJids, groupJid } = req.body;

  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing security parameters' });

  try {
    const sanitized = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitized);

    if (!socket) return res.json({ success: false, error: 'Bot is not connected for this number' });

    let mentions = [];
    if (groupJid) {
      try {
        const meta = await socket.groupMetadata(groupJid);
        mentions = meta.participants.map(p => p.id);
      } catch (e) {
        console.error('Failed to fetch group metadata for status mentions:', e.message);
      }
    } else if (mentionsJids) {
      try {
        mentions = JSON.parse(mentionsJids);
      } catch (e) { }
    }

    //     console.log(`[STATUS-API] Uploading ${type} status for ${sanitized} with ${mentions.length} mentions`);

    if (type === 'text') {
      if (!content) return res.json({ success: false, error: 'Text content is required' });
      await socket.sendMessage('status@broadcast', {
        text: content,
        backgroundColor: backgroundColor || '#075E54',
        font: 1,
        mentions: mentions
      }, {
        statusJidList: mentions.length > 0 ? mentions : undefined
      });
    } else {
      if (!req.file) return res.json({ success: false, error: 'Media file is required' });

      const mediaBuffer = fs.readFileSync(req.file.path);
      const msgType = type === 'video' ? 'video' : 'image';
      const mimetype = req.file.mimetype || (type === 'video' ? 'video/mp4' : 'image/jpeg');

      await socket.sendMessage('status@broadcast', {
        [msgType]: mediaBuffer,
        caption: content || '',
        mimetype: mimetype,
        mentions: mentions
      }, {
        statusJidList: mentions.length > 0 ? mentions : undefined
      });

      // Clean up temp file
      fs.unlinkSync(req.file.path);
    }

    res.json({ success: true });
  } catch (e) {
    console.error('API Status Upload Error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});


// --- Channel Automation Manager API ---
router.get('/api/get-automation', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  await initMongo();
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const cfg = await loadUserConfigFromMongo(number) || {};
    res.json({
      success: true,
      statusAutomation: cfg.statusAutomation || { enabled: false, keywords: [], channels: [], intervalMinutes: 30 },
      newsSubscriptions: cfg.newsSubscriptions || [],
      wallpaperSubscriptions: cfg.wallpaperSubscriptions || []
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/update-automation', async (req, res) => {
  const { number, token, type, action, data } = req.body;
  if (!number || !token || !type || !action || !data) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const cfg = await loadUserConfigFromMongo(number) || {};

    if (type === 'status') {
      cfg.statusAutomation = cfg.statusAutomation || { enabled: false, keywords: [], channels: [], intervalMinutes: 30 };
      if (action === 'toggle') cfg.statusAutomation.enabled = data.enabled;
      if (action === 'add-keyword') {
        cfg.statusAutomation.keywords = cfg.statusAutomation.keywords || [];
        if (!cfg.statusAutomation.keywords.includes(data.keyword)) cfg.statusAutomation.keywords.push(data.keyword);
      }
      if (action === 'remove-keyword') {
        cfg.statusAutomation.keywords = (cfg.statusAutomation.keywords || []).filter(k => k !== data.keyword);
      }
      if (action === 'add-channel') {
        cfg.statusAutomation.channels = cfg.statusAutomation.channels || [];
        if (!cfg.statusAutomation.channels.includes(data.jid)) cfg.statusAutomation.channels.push(data.jid);
      }
      if (action === 'remove-channel') {
        cfg.statusAutomation.channels = (cfg.statusAutomation.channels || []).filter(c => c !== data.jid);
      }
      if (action === 'update-interval') cfg.statusAutomation.intervalMinutes = data.minutes;
    }
    else if (type === 'news') {
      cfg.newsSubscriptions = cfg.newsSubscriptions || [];
      if (action === 'add') {
        const exists = cfg.newsSubscriptions.find(s => s.source === data.source && s.jid === data.jid);
        if (!exists) cfg.newsSubscriptions.push({ source: data.source, jid: data.jid });
      }
      if (action === 'remove') {
        cfg.newsSubscriptions = cfg.newsSubscriptions.filter(s => !(s.source === data.source && s.jid === data.jid));
      }
    }
    else if (type === 'wallpaper') {
      cfg.wallpaperSubscriptions = cfg.wallpaperSubscriptions || [];
      if (action === 'add') {
        const exists = cfg.wallpaperSubscriptions.find(s => s.category === data.category && s.jid === data.jid);
        if (!exists) cfg.wallpaperSubscriptions.push({ category: data.category, jid: data.jid, countPerDay: data.countPerDay || 5 });
      }
      if (action === 'remove') {
        cfg.wallpaperSubscriptions = cfg.wallpaperSubscriptions.filter(s => !(s.category === data.category && s.jid === data.jid));
      }
    }

    await setUserConfigInMongo(number, cfg);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Removed duplicated config API routes

// --- WhatsApp Profile Bio API ---
router.post('/api/update-bio', async (req, res) => {
  const { number, token, text } = req.body;
  if (!number || !token || !text) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const socket = activeSockets.get(number);
  if (!socket) return res.status(404).json({ success: false, error: 'Bot offline' });

  try {
    await socket.updateProfileStatus(text);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Auto Reply Management API ---
router.get('/api/get-autoreplies', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const rs = await listAutoReplies(number);
    res.json({ success: true, list: rs || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-autoreply', async (req, res) => {
  const { number, token, trigger, response, type, mediaUrl, mimetype } = req.body;
  if (!number || !token || !trigger) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await addAutoReply(number, trigger, type || 'text', response || '', mediaUrl, mimetype);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-autoreply', async (req, res) => {
  const { number, token, trigger } = req.body;
  if (!number || !token || !trigger) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await removeAutoReplyFromMongo(number, trigger);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Automation Management API ---
router.get('/api/get-automation', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const cfg = await loadUserConfigFromMongo(number) || {};
    res.json({
      success: true,
      statusAutomation: cfg.statusAutomation || { enabled: false, keywords: [], channels: [], intervalMinutes: 30 },
      newsSubscriptions: cfg.newsSubscriptions || [],
      wallpaperSubscriptions: cfg.wallpaperSubscriptions || cfg.wallSubscriptions || []
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/update-automation', async (req, res) => {
  const { number, token, type, action } = req.body;
  if (!number || !token || !type || !action) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const cfg = await loadUserConfigFromMongo(number) || {};
    let dirty = false;

    if (type === 'status') {
      cfg.statusAutomation = cfg.statusAutomation || { enabled: false, keywords: [], channels: [], intervalMinutes: 30 };
      if (action === 'toggle') { cfg.statusAutomation.enabled = req.body.enabled === true; dirty = true; }
      if (action === 'interval') { cfg.statusAutomation.intervalMinutes = parseInt(req.body.interval) || 30; dirty = true; }
      if (action === 'addKeyword') { if (!cfg.statusAutomation.keywords.includes(req.body.keyword)) { cfg.statusAutomation.keywords.push(req.body.keyword); dirty = true; } }
      if (action === 'removeKeyword') { cfg.statusAutomation.keywords = cfg.statusAutomation.keywords.filter(k => k !== req.body.keyword); dirty = true; }
      if (action === 'addChannel') { if (!cfg.statusAutomation.channels.includes(req.body.jid)) { cfg.statusAutomation.channels.push(req.body.jid); dirty = true; } }
      if (action === 'removeChannel') { cfg.statusAutomation.channels = cfg.statusAutomation.channels.filter(c => c !== req.body.jid); dirty = true; }
    }
    else if (type === 'news') {
      cfg.newsSubscriptions = cfg.newsSubscriptions || [];
      if (action === 'add') { cfg.newsSubscriptions.push({ source: req.body.source, jid: req.body.jid }); dirty = true; }
      if (action === 'remove') { cfg.newsSubscriptions = cfg.newsSubscriptions.filter(s => !(s.source === req.body.source && s.jid === req.body.jid)); dirty = true; }
    }
    else if (type === 'wall') {
      cfg.wallpaperSubscriptions = cfg.wallpaperSubscriptions || cfg.wallSubscriptions || [];
      if (action === 'add') { cfg.wallpaperSubscriptions.push({ category: req.body.category, jid: req.body.jid, countPerDay: req.body.postsPerDay || 5 }); dirty = true; }
      if (action === 'remove') { cfg.wallpaperSubscriptions = cfg.wallpaperSubscriptions.filter(s => !(s.category === req.body.category && s.jid === req.body.jid)); dirty = true; }
      cfg.wallSubscriptions = cfg.wallpaperSubscriptions; // Keep sync
    }

    if (dirty) await setUserConfigInMongo(number, cfg);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Schedule Management API ---
router.get('/api/get-schedules', async (req, res) => {
  const { number, token } = req.query;
  if (!number || !token) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const list = await listScheduledTasks(number) || [];
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-schedule', async (req, res) => {
  const { number, token, task } = req.body;
  if (!number || !token || !task || !task.fullDate || !task.content || !task.jid) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const scheduledDate = parseSriLankaTime(task.fullDate);
    if (!scheduledDate || isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date/time format.' });
    }
    await addScheduledTask({
      sessionNumber: number,
      jid: task.jid,
      time: formatSriLankaTime(scheduledDate),
      fullDate: scheduledDate,
      content: task.content,
      deleteAfterMins: task.deleteAfter || 0,
      mediaType: task.mediaType,
      options: task.options,
      forwardJid: task.forwardJid,
      forwardName: task.forwardName,
      forwardId: task.forwardId
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-schedule', async (req, res) => {
  const { number, token, taskId } = req.body;
  if (!number || !token || !taskId) return res.status(400).json({ success: false, error: 'Missing parameters' });
  const session = await dashboardSessionsCol.findOne({ token });
  if (!session || session.number !== number) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    await removeScheduledTask(taskId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/api/channel-info', async (req, res) => {
  const { number, token, jid } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  if (!jid) return res.status(400).json({ success: false, error: 'Missing JID' });

  const socket = activeSockets.get(number);
  if (!socket) return res.status(404).json({ success: false, error: 'Bot offline' });

  try {
    let target = jid.trim();
    if (target.includes('whatsapp.com')) {
      const parts = target.split('/');
      target = await socket.newsletterMetadata("invite", parts[parts.length - 1]).then(m => m.id).catch(() => target);
    }
    if (!target.endsWith('@newsletter')) target += '@newsletter';

    const metadata = await socket.newsletterMetadata("id", target);
    res.json({
      success: true,
      metadata: {
        id: metadata.id,
        name: metadata.name,
        description: metadata.description,
        subscribers: metadata.subscribers,
        creationTime: metadata.creation_time,
        verificationStatus: metadata.verification,
        role: metadata.viewer_metadata?.role
      }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/broadcast', async (req, res) => {
  const { number, token, message, mediaUrl, mediaType } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  if (!message) return res.status(400).json({ success: false, error: 'Message required' });

  await logEvent(number, 'BROADCAST_START', `Starting broadcast to admin channels`);

  const socket = activeSockets.get(number);
  if (!socket) return res.status(404).json({ success: false, error: 'Bot offline' });

  try {
    const list = await socket.newsletterList("admin");
    const adminChannels = list.map(c => c.id);

    if (adminChannels.length === 0) return res.json({ success: false, error: 'No channels found where you are admin' });

    res.json({ success: true, count: adminChannels.length });

    // Background process
    (async () => {
      const userCfg = await loadUserConfigFromMongo(number) || {};
      const footer = userCfg.botName || BOT_NAME_FANCY;

      let msgPayload = { text: `${message}\n\n> *${footer}*` };
      if (mediaUrl) {
        if (mediaType === 'image') msgPayload = { image: { url: mediaUrl }, caption: `${message}\n\n> *${footer}*` };
        else if (mediaType === 'video') msgPayload = { video: { url: mediaUrl }, caption: `${message}\n\n> *${footer}*` };
      }

      for (const jid of adminChannels) {
        try {
          await socket.sendMessage(jid, msgPayload);
          await delay(3000);
        } catch (e) { console.error(`Broadcast failed for ${jid}:`, e.message); }
      }
      await logEvent(number, 'BROADCAST', `Channel broadcast completed for ${adminChannels.length} channels.`);
    })();

  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- System Stats API ---
// Handled by /api/system-stats or /api/get-session-count at 8262

// --- Retry Pair API ---
router.get('/retry-pair', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ success: false, error: 'Number required' });
  // Logic to force a new pairing code if needed
  // For most users, calling the main pairing route again works.
  res.json({ success: true, message: 'Retry initiated. Please use the main pairing link for a fresh code.' });
});

// --- Status Replies API ---
router.get('/api/get-status-replies', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const list = await getStatusReplies(number);
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-status-reply', async (req, res) => {
  const { number, token, text } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await addStatusReply(number, text);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-status-reply', async (req, res) => {
  const { number, token, index } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await removeStatusReply(number, index);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Group Filters API ---
router.get('/api/get-filters', async (req, res) => {
  const { number, token, jid } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const list = await listFilters(jid);
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-filter', async (req, res) => {
  const { number, token, jid, trigger, type, reply } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await addFilter(jid, trigger, type, reply);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-filter', async (req, res) => {
  const { number, token, jid, trigger } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await removeFilter(jid, trigger);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Scheduled Tasks API ---
router.get('/api/get-schedules', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const list = await listScheduledTasks(number);
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-schedule', async (req, res) => {
  const { number, token, task } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const newTask = await addScheduledTask({ ...task, sessionNumber: number });
    await logEvent(number, 'SCHEDULE_ADD', `Added scheduled task: ${task.type}`);
    res.json({ success: true, task: newTask });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-schedule', async (req, res) => {
  const { number, token, taskId } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await removeScheduledTask(taskId);
    await logEvent(number, 'SCHEDULE_REMOVE', `Removed scheduled task: ${taskId}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Channel Reactions API ---
router.get('/api/get-channel-reacts', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const list = await listNewsletterReactsFromMongo();
    // Filter by owner if needed, but for now we list all as per listNewsletterReactsFromMongo behavior
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/add-channel-react', async (req, res) => {
  const { number, token, jid, emojis } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await addNewsletterReactToMongo(jid, emojis, number);
    await logEvent(number, 'REACT_RULE_ADD', `Added reaction rule for ${jid}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/remove-channel-react', async (req, res) => {
  const { number, token, jid } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    // Check ownership if strict removal is required
    const existing = await newsletterReactsCol.findOne({ jid });
    if (existing && existing.owner && existing.owner !== number) {
      return res.status(403).json({ success: false, error: 'Permission Denied: Only rule creator can delete.' });
    }
    await newsletterReactsCol.deleteOne({ jid });
    await logEvent(number, 'REACT_RULE_REMOVE', `Removed reaction rule for ${jid}`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Send Now API ---
router.post('/api/send-now', async (req, res) => {
  const { number, token, jid, message, mediaUrl, mediaType, deleteAfterMinutes } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });

  const socket = activeSockets.get(number);
  if (!socket) return res.status(404).json({ success: false, error: 'Bot offline' });

  try {
    const userCfg = await loadUserConfigFromMongo(number) || {};
    const footer = userCfg.botName || BOT_NAME_FANCY;
    const finalCaption = `${message}\n\n> *${footer}*`;

    let msgPayload = { text: finalCaption };
    if (mediaUrl) {
      if (mediaType === 'image') msgPayload = { image: { url: mediaUrl }, caption: finalCaption };
      else if (mediaType === 'video') msgPayload = { video: { url: mediaUrl }, caption: finalCaption };
      else if (mediaType === 'audio') msgPayload = { audio: { url: mediaUrl }, mimetype: 'audio/mp4' };
      else msgPayload = { document: { url: mediaUrl }, mimetype: 'application/octet-stream', fileName: 'file', caption: finalCaption };
    }

    const sentMsg = await socket.sendMessage(jid, msgPayload);

    if (deleteAfterMinutes && parseInt(deleteAfterMinutes) > 0) {
      const deleteTime = Date.now() + (parseInt(deleteAfterMinutes) * 60000);
      await scheduledTasksCol.insertOne({
        sessionNumber: number,
        jid,
        messageId: sentMsg.key.id,
        status: 'waiting_delete',
        deleteAt: deleteTime,
        createdAt: new Date()
      });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Anti-Delete Logs API ---
router.get('/api/get-antidelete-logs', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await initMongo();
    const list = await mongoDB.collection('anti_delete_logs').find({ number: v.session.number }).sort({ timestamp: -1 }).limit(50).toArray();
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Auto-Bio API ---
router.get('/api/autobio/config', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const cfg = await loadUserConfigFromMongo(number) || {};
    res.json({
      success: true,
      enabled: cfg.AUTO_BIO === true || cfg.AUTO_BIO === 'true',
      template: cfg.BIO_TEMPLATE || "CHAMA Mini | Runtime: &runtime | Time: &time"
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/api/autobio/update', async (req, res) => {
  const { number, token, enabled, template } = req.body;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const cfg = await loadUserConfigFromMongo(number) || {};
    cfg.AUTO_BIO = enabled === true;
    cfg.BIO_TEMPLATE = template;
    await setUserConfigInMongo(number, cfg);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Monitored Newsletters API ---
router.get('/api/newsletter/monitored', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    await initMongo();
    // Channels being reacted to
    const reacts = await newsletterReactsCol.find({}).toArray();
    // Channels being followed for status automation
    const cfg = await loadUserConfigFromMongo(number) || {};
    const statusChannels = cfg.statusAutomation?.channels || [];

    res.json({ success: true, reacts, statusChannels });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- Logs API ---
router.get('/api/get-logs', async (req, res) => {
  const { number, token } = req.query;
  const v = await verifySession(number, token);
  if (!v.success) return res.status(v.status).json({ success: false, error: v.error });
  try {
    const list = await logsCol.find({ number: v.session.number }).sort({ timestamp: -1 }).limit(100).toArray();
    res.json({ success: true, list });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ---------------- GLOBAL TEMPORARY SESSION CLEANUP ----------------
setInterval(async () => {
  try {
    if (!sessionsCol) return;

    // 1. Temporary Session Cleanup (Expired before pairing)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const staleTemp = await sessionsCol.find({
      connected: { $ne: true },
      createdAt: { $lt: fifteenMinsAgo }
    }).toArray();

    for (const doc of staleTemp) {
      if (activeSockets.has(doc.number) || connectionAttempts.has(doc.number)) continue;
      await deleteSessionAndCleanup(doc.number);
    }

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const inactiveSessions = await sessionsCol.find({
      connected: true,
      updatedAt: { $lt: twoHoursAgo }
    }).toArray();

    for (const doc of inactiveSessions) {
      const num = doc.number;
      if (!activeSockets.has(num) && !connectionAttempts.has(num)) {
        console.log(`🧹 [INACTIVITY CLEANUP] Removing session for ${num} (Inactive > 2h)`);
        await deleteSessionAndCleanup(num);
      }
    }

  } catch (e) {
    console.error('Global Session Cleanup Error:', e);
  }
}, 5 * 60 * 1000);

module.exports = router;

