const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connIndicator = document.getElementById('connIndicator');
const timerSpan = document.getElementById('timer');
const repliesPre = document.getElementById('replies');
const callIdInput = document.getElementById('callId');

const CHUNK_INTERVAL_MS = 3500;
const MIN_CHUNK_BYTES = 1500;
const VOICE_THRESHOLD = 15;
const SILENCE_TIMEOUT_MS = 1500;
const VOICE_CHECK_INTERVAL_MS = 100;

let ws = null;
let mediaRecorder = null;
let mediaStream = null;
let audioContext = null;
let timerInterval = null;
let startTime = null;
let audioSendInterval = null;
let voiceCheckInterval = null;
let silenceTimeout = null;
let isRecordingActive = false;
let hasVoiceActivity = false;

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function wsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}`;
}

function setupVoiceDetection(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;
  audioContext.createMediaStreamSource(stream).connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  voiceCheckInterval = setInterval(() => {
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const average = sum / dataArray.length;

    if (average > VOICE_THRESHOLD) {
      if (!hasVoiceActivity) {
        hasVoiceActivity = true;
        if (!isRecordingActive && mediaRecorder && mediaRecorder.state === 'inactive') {
          mediaRecorder.start();
          isRecordingActive = true;
        }
      }
      if (silenceTimeout) clearTimeout(silenceTimeout);
      silenceTimeout = setTimeout(() => {
        hasVoiceActivity = false;
      }, SILENCE_TIMEOUT_MS);
    }
  }, VOICE_CHECK_INTERVAL_MS);
}

function restartRecordingIfNeeded() {
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'inactive' && hasVoiceActivity) {
      mediaRecorder.start();
      isRecordingActive = true;
    }
  }, 100);
}

function flushCurrentChunk() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    isRecordingActive = false;
  }
}

function stopCapture() {
  if (audioSendInterval) {
    clearInterval(audioSendInterval);
    audioSendInterval = null;
  }
  if (voiceCheckInterval) {
    clearInterval(voiceCheckInterval);
    voiceCheckInterval = null;
  }
  if (silenceTimeout) {
    clearTimeout(silenceTimeout);
    silenceTimeout = null;
  }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    try {
      mediaRecorder.stop();
    } catch (err) {
      console.error('MediaRecorder stop error:', err);
    }
  }
  mediaRecorder = null;
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  isRecordingActive = false;
  hasVoiceActivity = false;
}

function sendChunk(base64) {
  const callId = callIdInput.value.trim();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'audio-chunk',
      callId,
      file: base64,
      timestamp: Date.now()
    }));
  }
}

async function startAudioCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  setupVoiceDetection(mediaStream);

  let mimeType = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'audio/webm';
  }

  mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;

    if (e.data.size < MIN_CHUNK_BYTES) {
      restartRecordingIfNeeded();
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1];
      if (base64) sendChunk(base64);
      restartRecordingIfNeeded();
    };
    reader.onerror = () => {
      console.error('FileReader error');
      restartRecordingIfNeeded();
    };
    reader.readAsDataURL(e.data);
  };

  mediaRecorder.onerror = (e) => {
    console.error('MediaRecorder error:', e);
  };

  audioSendInterval = setInterval(flushCurrentChunk, CHUNK_INTERVAL_MS);
}

function handleServerMessage(evt) {
  let d;
  try {
    d = JSON.parse(evt.data);
  } catch {
    return;
  }

  if (d.type === 'operator-reply') {
    const text = d.text || '';
    repliesPre.textContent += `[الموظف] ${text}\n`;
    repliesPre.scrollTop = repliesPre.scrollHeight;

    if (d.audio) {
      try {
        const mimeType = d.mime || 'audio/mpeg';
        const audio = new Audio(`data:${mimeType};base64,${d.audio}`);
        audio.play().catch(err => console.error('Audio playback failed:', err));
      } catch (err) {
        console.error('Audio playback error:', err);
      }
    }
  } else if (d.type === 'transcription') {
    repliesPre.textContent += `[نسخ] ${d.text || ''}\n`;
    repliesPre.scrollTop = repliesPre.scrollHeight;
  } else if (d.type === 'error') {
    console.error('Server error:', d.message);
  }
}

connectBtn.onclick = () => {
  const callId = callIdInput.value.trim();
  if (!callId) return alert('ادخل Call ID');

  ws = new WebSocket(wsUrl());

  ws.onopen = async () => {
    connIndicator.textContent = 'متصل';
    connIndicator.classList.add('connected');
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;

    ws.send(JSON.stringify({ type: 'register', role: 'caller', callId }));

    startTime = Date.now();
    timerInterval = setInterval(() => {
      timerSpan.textContent = formatTime(Date.now() - startTime);
    }, 500);

    try {
      await startAudioCapture();
    } catch (err) {
      console.error('Microphone error:', err);
      alert('تعذر الوصول إلى الميكروفون: ' + err.message);
    }
  };

  ws.onmessage = handleServerMessage;

  ws.onclose = () => {
    connIndicator.textContent = 'مفصول';
    connIndicator.classList.remove('connected');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    stopCapture();
    timerSpan.textContent = '00:00';
  };

  ws.onerror = (e) => {
    console.error('WebSocket error:', e);
  };
};

disconnectBtn.onclick = () => {
  stopCapture();
  if (ws) {
    setTimeout(() => ws.close(), 200);
  }
};
