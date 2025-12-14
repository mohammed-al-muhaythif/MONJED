const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const connIndicator = document.getElementById('connIndicator');
const timerSpan = document.getElementById('timer');
const repliesPre = document.getElementById('replies');
const callIdInput = document.getElementById('callId');

let ws = null;
let mediaRecorder = null;
let timerInterval = null;
let startTime = null;
let audioSendInterval = null;
let audioContext = null;
let analyser = null;
let isRecordingActive = false;
let silenceTimeout = null;
let hasVoiceActivity = false;

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

// ⭐ كشف النشاط الصوتي
function setupVoiceDetection(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  const microphone = audioContext.createMediaStreamSource(stream);
  
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.8;
  microphone.connect(analyser);
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  function checkAudioLevel() {
    analyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;
    
    // ⭐ LOWERED threshold from 20 to 15 - more sensitive
    if (average > 15) {
      if (!hasVoiceActivity) {
        console.log('🎤 Voice detected! Starting recording...');
        hasVoiceActivity = true;
        if (!isRecordingActive && mediaRecorder && mediaRecorder.state === 'inactive') {
          mediaRecorder.start();
          isRecordingActive = true;
        }
      }
      
      if (silenceTimeout) clearTimeout(silenceTimeout);
      silenceTimeout = setTimeout(() => {
        console.log('🔇 Silence detected');
        hasVoiceActivity = false;
      }, 1500);
    }
    
    requestAnimationFrame(checkAudioLevel);
  }
  
  checkAudioLevel();
}

async function sendAudioChunk() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    console.log('⚠️ MediaRecorder not recording, skipping send');
    return;
  }

  mediaRecorder.stop();
  isRecordingActive = false;
}

connectBtn.onclick = async () => {
  const callId = callIdInput.value.trim();
  if (!callId) return alert('ادخل Call ID');

  ws = new WebSocket(`ws://${location.host}`);
  
  ws.onopen = async () => {
    console.log('✅ WebSocket connected');

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ Microphone access granted');
      
      setupVoiceDetection(stream);
      
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
      }
      
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      
      mediaRecorder.ondataavailable = async (e) => {
        if (e.data && e.data.size > 0) {
          console.log(`📦 Chunk ready: ${(e.data.size / 1024).toFixed(2)} KB`);
          
          // ⭐ LOWERED minimum size for 3.5 second chunks
          if (e.data.size < 1500) {  // Adjusted for 3.5 seconds
            console.log('⚠️ Chunk too small, skipping');
            // ⭐ ALWAYS restart recording after processing
            if (mediaRecorder.state === 'inactive' && hasVoiceActivity) {
              setTimeout(() => {
                if (mediaRecorder.state === 'inactive') {
                  mediaRecorder.start();
                  isRecordingActive = true;
                }
              }, 100);
            }
            return;
          }
          
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            const callId = callIdInput.value.trim();
            
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ 
                type: 'audio-chunk',
                callId, 
                file: base64,
                timestamp: Date.now()
              }));
              console.log(`✅ Sent chunk: ${(e.data.size / 1024).toFixed(2)} KB`);
            }
            
            // ⭐ ALWAYS restart recording after sending
            setTimeout(() => {
              if (mediaRecorder.state === 'inactive' && hasVoiceActivity) {
                mediaRecorder.start();
                isRecordingActive = true;
              }
            }, 100);
          };
          reader.readAsDataURL(e.data);
        }
      };
      
      mediaRecorder.onstart = () => {
        console.log('🎤 Recording chunk started');
      };
      
      mediaRecorder.onstop = () => {
        console.log('⏸️ Recording chunk stopped');
      };
      
      mediaRecorder.onerror = (e) => {
        console.error('❌ MediaRecorder error:', e);
      };
      
      // ⭐ Changed to 3.5 seconds
      audioSendInterval = setInterval(() => {
        sendAudioChunk();
      }, 3500); // 3.5 seconds
      
      console.log('✅ Voice detection active - sending audio every 3.5 seconds when voice detected');
      
    } catch (err) {
      console.error('❌ Microphone error:', err);
      alert('تعذر الوصول إلى الميكروفون: ' + err.message);
    }
  };

  ws.onmessage = (evt) => {
    const d = JSON.parse(evt.data);

    if (d.type === 'operator-reply') {
      const text = d.text || '';
      repliesPre.textContent += `[الموظف] ${text}\n`;
      repliesPre.scrollTop = repliesPre.scrollHeight;

      console.log("Received operator-reply, audio length =", d.audio ? d.audio.length : "NO_AUDIO");

      if (d.audio) {
        try {
          const mimeType = d.mime || 'audio/mpeg';
          const audio = new Audio(`data:${mimeType};base64,${d.audio}`);
          audio.play().catch(err => console.log("audio.play() failed:", err));
        } catch (err) {
          console.log("Audio creation/playback error:", err);
        }
      }
    }
    else if (d.type === 'transcription') {
      repliesPre.textContent += `[نسخ] ${d.text || ''}\n`;
      repliesPre.scrollTop = repliesPre.scrollHeight;
      console.log('📝 Transcription received:', d.text);
    }
    else if (d.type === 'error') {
      console.error('❌ Server error:', d.message);
    }
    else if (d.type === 'registered') {
      console.log('✅ Registered as caller');
    }
  };

  ws.onclose = () => {
    console.log('❌ WebSocket closed');
    connIndicator.textContent = 'مفصول';
    connIndicator.classList.remove('connected');
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    
    if (audioSendInterval) {
      clearInterval(audioSendInterval);
      audioSendInterval = null;
    }
    
    if (silenceTimeout) {
      clearTimeout(silenceTimeout);
      silenceTimeout = null;
    }
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    timerSpan.textContent = '00:00';
    isRecordingActive = false;
    hasVoiceActivity = false;
  };

  ws.onerror = (e) => {
    console.error('❌ WebSocket error:', e);
  };
};

disconnectBtn.onclick = async () => {
  console.log('🛑 Disconnect button clicked');
  
  if (audioSendInterval) {
    clearInterval(audioSendInterval);
    audioSendInterval = null;
  }

  if (silenceTimeout) {
    clearTimeout(silenceTimeout);
    silenceTimeout = null;
  }

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    console.log('🎤 Recording stopped');
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (ws) {
    setTimeout(() => {
      ws.close();
      console.log('🔌 WebSocket closed');
    }, 200);
  }
  
  isRecordingActive = false;
  hasVoiceActivity = false;
};