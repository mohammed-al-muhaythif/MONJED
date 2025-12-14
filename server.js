// server.js (مُصحح - تصفية أقل للكلمات المهمة)
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { v4 as uuidv4 } from 'uuid';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;
if (!OPENAI_KEY) {
  console.error('ERROR: set OPENAI_API_KEY in .env');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Sessions map: callId -> { callerWs, operators:Set, buffer:[], processing, detectedLanguage }
const calls = {};

// Helper: broadcast to operators
function broadcastToOperators(callId, msgObj) {
  const c = calls[callId];
  if (!c) return;
  c.operators.forEach(op => {
    if (op.readyState === 1) op.send(JSON.stringify(msgObj));
  });
}

// Helper: notify caller
function sendToCaller(callId, obj) {
  const c = calls[callId];
  if (!c) return;
  if (c.callerWs && c.callerWs.readyState === 1) {
    c.callerWs.send(JSON.stringify(obj));
  }
}

// Helper: normalize language
function normalizeLang(code) {
  if (!code) return null;
  const s = String(code).trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'und' || s === 'undefined' || s === 'null') return null;
  return s.split(/[^a-z]/)[0];
}

async function textToSpeech(text) {
  try {
    const resp = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text
      },
      {
        responseType: "arraybuffer",
        headers: { Authorization: `Bearer ${OPENAI_KEY}` }
      }
    );

    return {
      base64: Buffer.from(resp.data).toString("base64"),
      mime: resp.headers["content-type"] || "audio/ogg"
    };

  } catch (err) {
    console.error("TTS Error:", err?.response?.data || err.message);
    return { base64: null, mime: "audio/ogg" };
  }
}

async function processAudioFile(callId, base64, filenameHint = null) {
  const c = calls[callId];
  if (!c) return;
  if (c.processing) {
    setTimeout(() => processAudioFile(callId, base64, filenameHint), 300);
    return;
  }
  c.processing = true;

  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
  const filename = filenameHint || `${Date.now()}-${uuidv4()}.webm`;
  const filepath = path.join(uploadsDir, filename);

  try {
    const buffer = Buffer.from(base64, 'base64');
    console.log(`📝 Writing audio file: ${filename}, size: ${(buffer.length / 1024).toFixed(2)} KB`);
    
    // ⭐ VERY LOW minimum for 3.5 second chunks - allow almost everything through
    if (buffer.length < 200) {  // Only reject extremely small chunks (adjusted for 3.5s)
      console.log('⚠️ Audio chunk too small (< 200 bytes), skipping');
      return;
    }
    
    fs.writeFileSync(filepath, buffer);

    const form = new FormData();
    form.append('file', fs.createReadStream(filepath));
    form.append('model', 'whisper-1');

    console.log(`🎤 Sending to Whisper API...`);
    const resp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_KEY}` },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    const transcription = resp.data.text || '';
    
    // ⭐ MINIMAL filtering - only skip truly empty results
    if (!transcription || transcription.trim().length === 0) {
      console.log('⚠️ Transcription empty, skipping');
      return;
    }
    
    const trimmed = transcription.trim().toLowerCase();
    
    // ⭐ ONLY filter EXACT YouTube/broadcast spam patterns - nothing else
    const exactSpamPhrases = [
      'thank you for watching',
      'thanks for watching',
      'please subscribe',
      'subscribe to my channel',
      'like and subscribe',
      'don\'t forget to subscribe',
      'hit the bell icon',
      'smash that like button',
      'see you in the next video',
      'see you next time',
      'catch you in the next one',
      'until next time',
      'see you soon',
      'thanks for tuning in',
      'stay tuned',
      'coming up next',
      'i am from mbc',
      'i\'m from mbc',
      'this is mbc',
      'you\'re watching',
      'you are watching',
      'welcome back',
      'coming up',
      // ⭐ إضافة كلمات البث التلفزيوني
      'mbc',
      'mbc1',
      'mbc2',
      'mbc3',
      'mbc4',
      'al arabiya',
      'alarabiya',
      'aljazeera',
      'al jazeera',
      'bbc arabic',
      'france 24',
      'dw arabic',
      'rt arabic',
      'sputnik',
      'cnbc arabia',
      'sky news arabia',
      'alhurra',
      'al hurra',
      'dubai tv',
      'abu dhabi tv',
      'saudi tv',
      'lbc',
      'mtv lebanon',
      'al mayadeen',
      'alhayat',
      'al hayat'
    ];
    
    // ⭐ REMOVED filler word filtering completely - let ALL real speech through
    // Only check for exact spam matches
    const isExactSpam = exactSpamPhrases.some(phrase => trimmed === phrase);
    
    if (isSpam) {
      console.log(`⚠️ Detected spam pattern: "${transcription}", skipping`);
      return;
    }
    
    console.log(`✅ Whisper transcription: "${transcription}"`);

    // ⭐ Check spam BEFORE translation to save API calls
    const trimmedOriginal = transcription.trim().toLowerCase();
    
    const spamPatterns = [
      // YouTube subscription phrases
      /please\s+subscribe/,
      /subscribe\s+(to|on|in)/,
      /don'?t\s+forget\s+to\s+subscribe/,
      /make\s+sure\s+to\s+subscribe/,
      /remember\s+to\s+subscribe/,
      /hit\s+(the\s+)?bell/,
      /smash\s+(that\s+)?like/,
      /like\s+and\s+subscribe/,
      /subscribe\s+and\s+like/,
      
      // Thank you phrases
      /thank\s+you\s+(for\s+watching|so\s+much)/,
      /thanks\s+(for\s+watching|guys)/,
      
      // See you phrases
      /see\s+you\s+(next|in\s+the\s+next|later|soon|tomorrow)/,
      /catch\s+you\s+(next|later)/,
      /until\s+next\s+time/,
      
      // Coming up / Stay tuned
      /stay\s+tuned/,
      /coming\s+up\s+(next|after)/,
      /watch\s+(this\s+)?next/,
      /check\s+out\s+(this|my)/,
      
      // Links and comments
      /link\s+in\s+(the\s+)?description/,
      /comment\s+below/,
      /let\s+me\s+know\s+in\s+(the\s+)?comment/,
      
      // TV/Broadcast phrases
      /(i\s+am|i'm|this\s+is)\s+(from\s+)?mbc/,
      /mbc\s+(presents|news)/,
      /^mbc\d*$/,
      /breaking\s+news/,
      /stay\s+with\s+us/,
      /you'?re\s+watching/,
      /welcome\s+(back|to)/,
      
      // Japanese YouTube spam (common patterns)
      /チャンネル登録/,  // Channel subscription
      /お願い.*します/,   // Please...
      /ご視聴.*ありがとう/, // Thank you for watching
      /高評価/,          // High rating/like
      /コメント.*ください/,  // Please comment
      
      // Korean spam
      /구독/,  // Subscribe
      /좋아요/, // Like
      /감사합니다/, // Thank you
      
      // Arabic common spam
      /اشترك/,  // Subscribe
      /لا تنسى الاشتراك/, // Don't forget to subscribe
      
      // General
      /enjoy\s+your\s+meal/,
      /share\s+this\s+video/,
      /turn\s+on\s+notifications/
    ];
    
    if (spamPatterns.some(pattern => pattern.test(trimmedOriginal))) {
      console.log(`⚠️ Detected spam in original text: "${transcription}", skipping`);
      return;
    }

    const chatBody = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Detect the language of the following text and translate it to Arabic. Reply with valid JSON: { "detectedLanguage": "<iso-639-1 code or name>", "translation": "<Arabic translation>" }' },
        { role: 'user', content: `Text: """${transcription}"""` }
      ],
      temperature: 0.0,
      max_tokens: 800
    };

    const chatResp = await axios.post('https://api.openai.com/v1/chat/completions', chatBody, {
      headers: { Authorization: `Bearer ${OPENAI_KEY}` }
    });

    const assistantText = chatResp.data.choices?.[0]?.message?.content || '';
    console.log(`🤖 GPT response: "${assistantText}"`);
    
    let detectedLanguage = null;
    let translation = transcription;

    try {
      const parsed = JSON.parse(assistantText);
      detectedLanguage = normalizeLang(parsed.detectedLanguage || parsed.language || parsed.lang);
      translation = parsed.translation || translation;
      console.log(`✅ Parsed - Language: ${detectedLanguage}, Translation: "${translation}"`);
    } catch (e) {
      console.log(`⚠️ Failed to parse JSON, using fallback`);
      detectedLanguage = normalizeLang((assistantText || '').trim().split(/\s+/)[0]);
      translation = assistantText || transcription;
    }

    // ⭐ SPAM CHECK #2: Also check Arabic translation for spam
    const arabicSpamPatterns = [
      /يرجى\s+الاشتراك/,  // Please subscribe
      /اشترك\s+في\s+القناة/,  // Subscribe to the channel
      /شكر.*لمشاهدة/,  // Thank you for watching
      /شكر.*لك.*مشاهد/,  // Thank you for watching (variation)
      /لا\s+تنسى\s+الاشتراك/,  // Don't forget to subscribe
      /اضغط.*الجرس/,  // Hit the bell
      /ضع.*لايك/,  // Put a like
    ];
    
    if (arabicSpamPatterns.some(pattern => pattern.test(translation))) {
      console.log(`⚠️ BLOCKED - Spam detected in translation: "${translation}"`);
      return;
    }

    const prevLang = c.detectedLanguage;
    c.detectedLanguage = detectedLanguage;
    c.lastUpdated = Date.now();

    console.log(`📤 Broadcasting to operators - Text: "${transcription}", Lang: ${detectedLanguage}, Translation: "${translation}"`);

    broadcastToOperators(callId, {
      type: 'transcription',
      callId,
      text: transcription,
      detectedLanguage: detectedLanguage || 'unknown',
      translation
    });

    if (prevLang !== detectedLanguage) {
      console.log(`Call ${callId} language changed: ${prevLang} -> ${detectedLanguage}`);
      broadcastToOperators(callId, { type: 'language-changed', callId, detectedLanguage: detectedLanguage || 'unknown' });
    }

  } catch (err) {
    console.error('processAudioFile error', err?.response?.data || err.message || err);
    broadcastToOperators(callId, { type: 'error', message: 'Transcription failed' });
  } finally {
    try { fs.unlinkSync(filepath); } catch {}
    c.processing = false;
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    const { type, role, callId, chunk, file, text, language } = msg;

    if (type === 'register') {
      if (!callId) return ws.send(JSON.stringify({ type: 'error', message: 'missing callId' }));

      if (!calls[callId]) {
        calls[callId] = { callerWs: null, operators: new Set(), buffer: [], processing: false, detectedLanguage: null };
      }

      const sess = calls[callId];

      if (role === 'caller') {
        sess.callerWs = ws;
        ws.callId = callId;
        ws.role = 'caller';
        ws.send(JSON.stringify({ type: 'registered', role: 'caller', callId }));
        console.log(`Caller registered: ${callId}`);
      }

      else if (role === 'operator') {
        sess.operators.add(ws);
        ws.callId = callId;
        ws.role = 'operator';
        ws.send(JSON.stringify({ type: 'registered', role: 'operator', callId, detectedLanguage: sess.detectedLanguage }));
        console.log(`Operator registered for ${callId}`);
      }

      return;
    }

    if (type === 'audio-chunk') {
      if (!callId || !calls[callId]) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Unknown callId' }));
      }
      
      if (!file) {
        console.error('❌ No file data in audio-chunk message');
        return ws.send(JSON.stringify({ type: 'error', message: 'No audio data' }));
      }
      
      console.log(`✅ Processing audio chunk for ${callId}, base64 length: ${file.length}`);
      processAudioFile(callId, file).catch(e => console.error('❌ processAudioFile error:', e));
      return;
    }

    if (type === 'audio-file') {
      if (!callId || !calls[callId])
        return ws.send(JSON.stringify({ type: 'error', message: 'Unknown callId' }));
      processAudioFile(callId, file).catch(e => console.error(e));
      return;
    }

    if (type === 'audio-end') {
      if (!callId || !calls[callId]) return;
      if (calls[callId].buffer?.length > 0) {
        const base64 = calls[callId].buffer.splice(0).join('');
        processAudioFile(callId, base64).catch(e => console.error(e));
      }
      return;
    }

    if (type === 'set-language') {
      if (!callId || !calls[callId]) return;
      calls[callId].detectedLanguage = normalizeLang(language);
      broadcastToOperators(callId, {
        type: 'language-updated',
        callId,
        detectedLanguage: calls[callId].detectedLanguage || 'unknown'
      });
      return;
    }

    if (type === 'operator-reply') {
      if (!callId || !calls[callId])
        return ws.send(JSON.stringify({ type: 'error', message: 'Unknown callId' }));

      const sess = calls[callId];
      const targetLang = sess.detectedLanguage || null;

      if (!targetLang || String(targetLang).startsWith('ar')) {
        const audio = await textToSpeech(text);
        console.log("TTS Bytes for operator reply:", audio ? (audio.base64 ? audio.base64.length : "NO_BASE64") : "NO_AUDIO_OBJECT");

        sendToCaller(callId, {
          type: 'operator-reply',
          text,
          language: 'ar',
          audio: audio.base64,
          mime: audio.mime
        });
        return;
      }

      try {
        const chatReq = {
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: `Translate the following Arabic text to ${targetLang}. Reply with translated text only.` },
            { role: 'user', content: text }
          ],
          temperature: 0.0,
          max_tokens: 1000
        };

        const chatResp = await axios.post('https://api.openai.com/v1/chat/completions', chatReq, {
          headers: { Authorization: `Bearer ${OPENAI_KEY}` }
        });

        const translated = chatResp.data.choices?.[0]?.message?.content?.trim() || text;
        const audio = await textToSpeech(translated);
        console.log("TTS Bytes for operator reply:", audio ? (audio.base64 ? audio.base64.length : "NO_BASE64") : "NO_AUDIO_OBJECT");

        sendToCaller(callId, {
          type: 'operator-reply',
          text: translated,
          language: targetLang,
          audio: audio.base64,
          mime: audio.mime
        });

      } catch (err) {
        console.error("operator-reply translation error", err);
        const audio = await textToSpeech(text);
        console.log("TTS Bytes for operator reply:", audio ? (audio.base64 ? audio.base64.length : "NO_BASE64") : "NO_AUDIO_OBJECT");

        sendToCaller(callId, {
          type: 'operator-reply',
          text,
          language: 'ar',
          audio: audio.base64,
          mime: audio.mime
        });
      }

      return;
    }

    ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
  });

  ws.on('close', () => {
    for (const id of Object.keys(calls)) {
      const s = calls[id];
      if (s.callerWs === ws) {
        s.callerWs = null;
        s.detectedLanguage = null;
        // ⭐ Stop any ongoing processing when caller disconnects
        s.processing = false;
        console.log(`🔄 Language reset for call ${id} - caller disconnected`);
        broadcastToOperators(id, { 
          type: 'language-updated', 
          callId: id, 
          detectedLanguage: null 
        });
      }
      if (s.operators.has(ws)) s.operators.delete(ws);
    }
    console.log('Client disconnected');
  });

  ws.on('error', (err) => console.error('WS error', err));
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});