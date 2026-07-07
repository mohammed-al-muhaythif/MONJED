import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import OpenAI, { toFile } from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = Number(process.env.PORT) || 3000;

if (!OPENAI_API_KEY) {
  console.error('ERROR: set OPENAI_API_KEY in .env');
  process.exit(1);
}

const TRANSCRIPTION_MODEL = process.env.TRANSCRIPTION_MODEL || 'whisper-1';
const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL || 'gpt-4o-mini';
const TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'alloy';
const MIN_AUDIO_BYTES = 200;
const MAX_PENDING_CHUNKS = 10;
const HEARTBEAT_INTERVAL_MS = 30000;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  timeout: 30000,
  maxRetries: 2
});

const EXACT_SPAM_PHRASES = new Set([
  'thank you for watching',
  'thanks for watching',
  'please subscribe',
  'subscribe to my channel',
  'like and subscribe',
  "don't forget to subscribe",
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
  "i'm from mbc",
  'this is mbc',
  "you're watching",
  'you are watching',
  'welcome back',
  'coming up',
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
]);

const SPAM_PATTERNS = [
  /please\s+subscribe/,
  /subscribe\s+(to|on|in)/,
  /don'?t\s+forget\s+to\s+subscribe/,
  /make\s+sure\s+to\s+subscribe/,
  /remember\s+to\s+subscribe/,
  /hit\s+(the\s+)?bell/,
  /smash\s+(that\s+)?like/,
  /like\s+and\s+subscribe/,
  /subscribe\s+and\s+like/,
  /thank\s+you\s+(for\s+watching|so\s+much)/,
  /thanks\s+(for\s+watching|guys)/,
  /see\s+you\s+(next|in\s+the\s+next|later|soon|tomorrow)/,
  /catch\s+you\s+(next|later)/,
  /until\s+next\s+time/,
  /stay\s+tuned/,
  /coming\s+up\s+(next|after)/,
  /watch\s+(this\s+)?next/,
  /check\s+out\s+(this|my)/,
  /link\s+in\s+(the\s+)?description/,
  /comment\s+below/,
  /let\s+me\s+know\s+in\s+(the\s+)?comment/,
  /(i\s+am|i'm|this\s+is)\s+(from\s+)?mbc/,
  /mbc\s+(presents|news)/,
  /^mbc\d*$/,
  /breaking\s+news/,
  /stay\s+with\s+us/,
  /you'?re\s+watching/,
  /welcome\s+(back|to)/,
  /チャンネル登録/,
  /お願い.*します/,
  /ご視聴.*ありがとう/,
  /高評価/,
  /コメント.*ください/,
  /구독/,
  /좋아요/,
  /감사합니다/,
  /اشترك/,
  /لا تنسى الاشتراك/,
  /enjoy\s+your\s+meal/,
  /share\s+this\s+video/,
  /turn\s+on\s+notifications/
];

const ARABIC_SPAM_PATTERNS = [
  /يرجى\s+الاشتراك/,
  /اشترك\s+في\s+القناة/,
  /شكر.*لمشاهدة/,
  /شكر.*لك.*مشاهد/,
  /لا\s+تنسى\s+الاشتراك/,
  /اضغط.*الجرس/,
  /ضع.*لايك/
];

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const app = express();
app.use(express.static(publicDir));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const calls = new Map();

function getOrCreateCall(callId) {
  let call = calls.get(callId);
  if (!call) {
    call = {
      callId,
      callerWs: null,
      operators: new Set(),
      pendingChunks: [],
      processing: false,
      detectedLanguage: null,
      lastUpdated: Date.now()
    };
    calls.set(callId, call);
  }
  return call;
}

function cleanupCall(callId) {
  const call = calls.get(callId);
  if (call && !call.callerWs && call.operators.size === 0 && !call.processing && call.pendingChunks.length === 0) {
    calls.delete(callId);
  }
}

function send(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(obj));
  } catch (err) {
    console.error('send error:', err.message);
  }
}

function broadcastToOperators(call, obj) {
  call.operators.forEach(op => send(op, obj));
}

function sendToCaller(call, obj) {
  send(call.callerWs, obj);
}

function normalizeLang(code) {
  if (!code) return null;
  const s = String(code).trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'und' || s === 'undefined' || s === 'null') return null;
  return s.split(/[^a-z]/)[0] || null;
}

function isSpamTranscription(text) {
  const normalized = text.trim().toLowerCase();
  if (EXACT_SPAM_PHRASES.has(normalized)) return true;
  return SPAM_PATTERNS.some(pattern => pattern.test(normalized));
}

function isSpamTranslation(text) {
  return ARABIC_SPAM_PATTERNS.some(pattern => pattern.test(text));
}

async function transcribeAudio(buffer) {
  const file = await toFile(buffer, 'chunk.webm', { type: 'audio/webm' });
  const result = await openai.audio.transcriptions.create({
    file,
    model: TRANSCRIPTION_MODEL
  });
  return (result.text || '').trim();
}

async function detectAndTranslate(text) {
  const completion = await openai.chat.completions.create({
    model: TRANSLATION_MODEL,
    messages: [
      {
        role: 'system',
        content: 'Detect the language of the user text and translate it to Arabic. Respond only with JSON in this exact shape: {"detectedLanguage":"<iso-639-1 code>","translation":"<Arabic translation>"}'
      },
      { role: 'user', content: text }
    ],
    temperature: 0,
    max_tokens: 800,
    response_format: { type: 'json_object' }
  });

  const content = completion.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(content);
    const translation = typeof parsed.translation === 'string' && parsed.translation ? parsed.translation : text;
    return {
      detectedLanguage: normalizeLang(parsed.detectedLanguage || parsed.language || parsed.lang),
      translation
    };
  } catch {
    return { detectedLanguage: null, translation: text };
  }
}

async function translateReply(text, targetLang) {
  const completion = await openai.chat.completions.create({
    model: TRANSLATION_MODEL,
    messages: [
      {
        role: 'system',
        content: `Translate the following Arabic text to ${targetLang}. Reply with the translated text only.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0,
    max_tokens: 1000
  });
  return completion.choices?.[0]?.message?.content?.trim() || text;
}

async function textToSpeech(text) {
  try {
    const response = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      base64: buffer.toString('base64'),
      mime: response.headers?.get?.('content-type') || 'audio/mpeg'
    };
  } catch (err) {
    console.error('TTS error:', err?.message || err);
    return { base64: null, mime: 'audio/mpeg' };
  }
}

function enqueueAudioChunk(call, base64) {
  if (call.pendingChunks.length >= MAX_PENDING_CHUNKS) {
    call.pendingChunks.shift();
  }
  call.pendingChunks.push(base64);
  void drainAudioQueue(call);
}

async function drainAudioQueue(call) {
  if (call.processing) return;
  call.processing = true;
  try {
    while (call.pendingChunks.length > 0) {
      const base64 = call.pendingChunks.shift();
      await processAudioChunk(call, base64);
    }
  } finally {
    call.processing = false;
    cleanupCall(call.callId);
  }
}

async function processAudioChunk(call, base64) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length < MIN_AUDIO_BYTES) return;

    const transcription = await transcribeAudio(buffer);
    if (!transcription) return;
    if (isSpamTranscription(transcription)) return;

    const { detectedLanguage, translation } = await detectAndTranslate(transcription);
    if (isSpamTranslation(translation)) return;

    const previousLanguage = call.detectedLanguage;
    call.detectedLanguage = detectedLanguage;
    call.lastUpdated = Date.now();

    broadcastToOperators(call, {
      type: 'transcription',
      callId: call.callId,
      text: transcription,
      detectedLanguage: detectedLanguage || 'unknown',
      translation
    });

    if (previousLanguage !== detectedLanguage) {
      broadcastToOperators(call, {
        type: 'language-changed',
        callId: call.callId,
        detectedLanguage: detectedLanguage || 'unknown'
      });
    }
  } catch (err) {
    console.error('audio processing error:', err?.message || err);
    broadcastToOperators(call, { type: 'error', message: 'Transcription failed' });
  }
}

async function handleOperatorReply(call, text) {
  const targetLang = call.detectedLanguage;

  if (!targetLang || targetLang.startsWith('ar')) {
    const audio = await textToSpeech(text);
    sendToCaller(call, {
      type: 'operator-reply',
      text,
      language: 'ar',
      audio: audio.base64,
      mime: audio.mime
    });
    return;
  }

  try {
    const translated = await translateReply(text, targetLang);
    const audio = await textToSpeech(translated);
    sendToCaller(call, {
      type: 'operator-reply',
      text: translated,
      language: targetLang,
      audio: audio.base64,
      mime: audio.mime
    });
  } catch (err) {
    console.error('operator reply error:', err?.message || err);
    const audio = await textToSpeech(text);
    sendToCaller(call, {
      type: 'operator-reply',
      text,
      language: 'ar',
      audio: audio.base64,
      mime: audio.mime
    });
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    try {
      const { type, role, callId, file, text, language } = msg;

      if (type === 'register') {
        if (!callId) {
          return send(ws, { type: 'error', message: 'missing callId' });
        }

        const call = getOrCreateCall(callId);

        if (role === 'caller') {
          call.callerWs = ws;
          ws.callId = callId;
          ws.role = 'caller';
          send(ws, { type: 'registered', role: 'caller', callId });
          console.log(`Caller registered: ${callId}`);
        } else if (role === 'operator') {
          call.operators.add(ws);
          ws.callId = callId;
          ws.role = 'operator';
          send(ws, { type: 'registered', role: 'operator', callId, detectedLanguage: call.detectedLanguage });
          console.log(`Operator registered for ${callId}`);
        }
        return;
      }

      if (type === 'audio-chunk' || type === 'audio-file') {
        const call = calls.get(callId);
        if (!callId || !call) {
          return send(ws, { type: 'error', message: 'Unknown callId' });
        }
        if (!file) {
          return send(ws, { type: 'error', message: 'No audio data' });
        }
        enqueueAudioChunk(call, file);
        return;
      }

      if (type === 'audio-end') {
        return;
      }

      if (type === 'set-language') {
        const call = calls.get(callId);
        if (!callId || !call) return;
        call.detectedLanguage = normalizeLang(language);
        broadcastToOperators(call, {
          type: 'language-updated',
          callId,
          detectedLanguage: call.detectedLanguage || 'unknown'
        });
        return;
      }

      if (type === 'operator-reply') {
        const call = calls.get(callId);
        if (!callId || !call) {
          return send(ws, { type: 'error', message: 'Unknown callId' });
        }
        await handleOperatorReply(call, text);
        return;
      }

      send(ws, { type: 'error', message: 'Unknown message type' });
    } catch (err) {
      console.error('message handling error:', err?.message || err);
      send(ws, { type: 'error', message: 'Internal server error' });
    }
  });

  ws.on('close', () => {
    for (const [callId, call] of calls) {
      if (call.callerWs === ws) {
        call.callerWs = null;
        call.detectedLanguage = null;
        console.log(`Caller disconnected: ${callId}`);
        broadcastToOperators(call, {
          type: 'language-updated',
          callId,
          detectedLanguage: null
        });
      }
      call.operators.delete(ws);
      cleanupCall(callId);
    }
  });

  ws.on('error', (err) => console.error('WebSocket error:', err.message));
});

const heartbeat = setInterval(() => {
  wss.clients.forEach(client => {
    if (client.isAlive === false) return client.terminate();
    client.isAlive = false;
    client.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

function shutdown() {
  clearInterval(heartbeat);
  wss.clients.forEach(client => client.terminate());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
