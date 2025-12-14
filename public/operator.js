// operator.js (مُصحح بالكامل)

const LANGS = {
  "ar":"العربية","en":"الإنجليزية","es":"الإسبانية","fr":"الفرنسية","de":"الألمانية",
  "it":"الإيطالية","pt":"البرتغالية","ru":"الروسية","zh":"الصينية","ja":"اليابانية",
  "ko":"الكورية","hi":"الهندية","ur":"الأردية","sw":"السواحيلية","ha":"الهاوسا",
  "am":"الأمهرية","bn":"البنغالية","ta":"التاميلية","te":"التيلوغوية","mr":"الماراثية",
  "tr":"التركية","vi":"الفيتنامية","th":"التايلاندية","pl":"البولندية","nl":"الهولندية",
  "ro":"الرومانية","el":"اليونانية","cs":"التشيكية","sv":"السويدية","hu":"الهنغارية",
  "fi":"الفنلندية","no":"النرويجية","da":"الدنماركية","sk":"السلوفاكية","bg":"البلغارية",
  "hr":"الكرواتية","sr":"الصربية","uk":"الأوكرانية","he":"العبرية","id":"الإندونيسية",
  "ms":"الماليزية","fil":"الفلبينية","fa":"الفارسية","ps":"الباشتو","ku":"الكردية",
  "so":"الصومالية","yo":"اليوروبا","ig":"الإيغبو","zu":"الزولو","xh":"الخوسا",
  "af":"الأفريقانية","sq":"الألبانية","hy":"الأرمينية","az":"الأذربيجانية","eu":"الباسكية",
  "be":"البيلاروسية","bs":"البوسنية","ca":"الكتالانية","et":"الإستونية","tl":"التاغالوغية",
  "ka":"الجورجية","gu":"الغوجاراتية","ht":"الكريولية الهايتية","is":"الآيسلندية",
  "ga":"الأيرلندية","kn":"الكانادا","kk":"الكازاخستانية","km":"الخميرية","lo":"اللاوية",
  "lv":"اللاتفية","lt":"الليتوانية","lb":"اللوكسمبورغية","mk":"المقدونية","mg":"المالاغاشية",
  "ml":"المالايالامية","mt":"المالطية","mi":"الماورية","mn":"المنغولية","ne":"النيبالية",
  "pa":"البنجابية","si":"السنهالية","sl":"السلوفينية","su":"السوندانية","tg":"الطاجيكية",
  "uz":"الأوزبكية","cy":"الويلزية","yi":"اليديشية","la":"اللاتينية","eo":"الإسبرانتو"
};

const callIdInput = document.getElementById('callIdOp');
const statusOp = document.getElementById('statusOp');
const detectedLangSpan = document.getElementById('detectedLang');
const langSelect = document.getElementById('langSelect');
const setLangBtn = document.getElementById('setLang');

const callerTextOriginal = document.getElementById('callerTextOriginal');
const callerTextTranslated = document.getElementById('callerTextTranslated');

const replyText = document.getElementById('replyText');
const sendReplyBtn = document.getElementById('sendReply');
const clearBtn = document.getElementById('clearBtn'); // زر المسح

let ws = null;

function populateLangs() {
  Object.keys(LANGS).forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = LANGS[code] + ` (${code})`;
    langSelect.appendChild(opt);
  });
}
populateLangs();

function displayLang(code) {
  if (!code) return '—';
  return LANGS[code] ? `${LANGS[code]} (${code})` : code;
}

function connectOperator() {
  const callId = callIdInput.value.trim();
  if (!callId) {
    alert('ادخل Call ID أولاً');
    return;
  }

  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    console.log('✅ Operator WebSocket connected');
    statusOp.textContent = 'متصل';
    statusOp.style.color = '#2ecc71';
    ws.send(JSON.stringify({ type: 'register', role: 'operator', callId }));
  };

  ws.onmessage = (evt) => {
    console.log('📨 Operator received message');
    const d = JSON.parse(evt.data);

    if (d.type === 'transcription') {
      console.log('📝 Transcription:', d);
      detectedLangSpan.textContent = displayLang(d.detectedLanguage || 'unknown');

      // ⭐ إضافة النص الجديد بدلاً من استبداله
      if (callerTextOriginal.textContent === '—') {
        callerTextOriginal.textContent = d.text || '';
      } else {
        callerTextOriginal.textContent += ' ' + (d.text || '');
      }

      if (callerTextTranslated.textContent === '—') {
        callerTextTranslated.textContent = d.translation || '';
      } else {
        callerTextTranslated.textContent += ' ' + (d.translation || '');
      }
      
      // تمرير للأسفل
      callerTextOriginal.scrollTop = callerTextOriginal.scrollHeight;
      callerTextTranslated.scrollTop = callerTextTranslated.scrollHeight;
    }

    else if (d.type === 'language-changed' || d.type === 'language-updated') {
      console.log('🌍 Language changed:', d.detectedLanguage);
      // ⭐ إذا كانت اللغة null، أعد تعيين العرض
      if (!d.detectedLanguage || d.detectedLanguage === 'null') {
        detectedLangSpan.textContent = '—';
      } else {
        detectedLangSpan.textContent = displayLang(d.detectedLanguage);
      }
    }

    else if (d.type === 'registered') {
      console.log('✅ Registered as operator');
      if (d.detectedLanguage) {
        detectedLangSpan.textContent = displayLang(d.detectedLanguage);
      }
    }

    else if (d.type === 'error') {
      console.error('❌ Server error:', d.message);
      alert('Server error: ' + d.message);
    }
  };

  ws.onclose = () => {
    console.log('❌ Operator WebSocket closed');
    statusOp.textContent = 'مفصول';
    statusOp.style.color = '#e74c3c';
    setTimeout(connectOperator, 2000);
  };

  ws.onerror = (e) => {
    console.error('❌ Operator WebSocket error:', e);
  };
}

// الاتصال تلقائياً عند التحميل
connectOperator();

setLangBtn.onclick = () => {
  const code = langSelect.value;
  const callId = callIdInput.value.trim();
  if (!code) return alert('اختر لغة');
  if (!ws || ws.readyState !== WebSocket.OPEN) return alert('لم يتصل السيرفر بعد');

  console.log(`🌍 Setting language manually to: ${code}`);
  ws.send(JSON.stringify({ type: 'set-language', callId, language: code }));
  detectedLangSpan.textContent = displayLang(code);
  alert('تم تعيين اللغة يدوياً');
};

sendReplyBtn.onclick = () => {
  const text = replyText.value.trim();
  const callId = callIdInput.value.trim();
  
  if (!text) return alert('اكتب رد الموظف');
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('لم يتصل السيرفر بعد');
    return;
  }

  console.log(`📤 Sending operator reply: "${text}"`);
  ws.send(JSON.stringify({ type: 'operator-reply', callId, text }));
  replyText.value = '';
  alert('تم إرسال الرد');
};

// ⭐ زر مسح النصوص
if (clearBtn) {
  clearBtn.onclick = () => {
    callerTextOriginal.textContent = '—';
    callerTextTranslated.textContent = '—';
    console.log('🧹 Text cleared');
  };
}