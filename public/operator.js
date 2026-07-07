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

const RECONNECT_DELAY_MS = 2000;

const callIdInput = document.getElementById('callIdOp');
const statusOp = document.getElementById('statusOp');
const detectedLangSpan = document.getElementById('detectedLang');
const langSelect = document.getElementById('langSelect');
const setLangBtn = document.getElementById('setLang');
const callerTextOriginal = document.getElementById('callerTextOriginal');
const callerTextTranslated = document.getElementById('callerTextTranslated');
const replyText = document.getElementById('replyText');
const sendReplyBtn = document.getElementById('sendReply');
const clearBtn = document.getElementById('clearBtn');

let ws = null;

function populateLangs() {
  Object.keys(LANGS).forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${LANGS[code]} (${code})`;
    langSelect.appendChild(opt);
  });
}
populateLangs();

function displayLang(code) {
  if (!code) return '—';
  return LANGS[code] ? `${LANGS[code]} (${code})` : code;
}

function appendText(el, text) {
  if (!text) return;
  if (el.textContent === '—') {
    el.textContent = text;
  } else {
    el.textContent += ' ' + text;
  }
  el.scrollTop = el.scrollHeight;
}

function handleServerMessage(evt) {
  let d;
  try {
    d = JSON.parse(evt.data);
  } catch {
    return;
  }

  if (d.type === 'transcription') {
    detectedLangSpan.textContent = displayLang(d.detectedLanguage || 'unknown');
    appendText(callerTextOriginal, d.text || '');
    appendText(callerTextTranslated, d.translation || '');
  } else if (d.type === 'language-changed' || d.type === 'language-updated') {
    if (!d.detectedLanguage || d.detectedLanguage === 'null') {
      detectedLangSpan.textContent = '—';
    } else {
      detectedLangSpan.textContent = displayLang(d.detectedLanguage);
    }
  } else if (d.type === 'registered') {
    if (d.detectedLanguage) {
      detectedLangSpan.textContent = displayLang(d.detectedLanguage);
    }
  } else if (d.type === 'error') {
    console.error('Server error:', d.message);
    alert('Server error: ' + d.message);
  }
}

function connectOperator() {
  const callId = callIdInput.value.trim();
  if (!callId) {
    alert('ادخل Call ID أولاً');
    return;
  }

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => {
    statusOp.textContent = 'متصل';
    statusOp.style.color = '#2ecc71';
    ws.send(JSON.stringify({ type: 'register', role: 'operator', callId }));
  };

  ws.onmessage = handleServerMessage;

  ws.onclose = () => {
    statusOp.textContent = 'مفصول';
    statusOp.style.color = '#e74c3c';
    setTimeout(connectOperator, RECONNECT_DELAY_MS);
  };

  ws.onerror = (e) => {
    console.error('WebSocket error:', e);
  };
}

connectOperator();

setLangBtn.onclick = () => {
  const code = langSelect.value;
  const callId = callIdInput.value.trim();
  if (!code) return alert('اختر لغة');
  if (!ws || ws.readyState !== WebSocket.OPEN) return alert('لم يتصل السيرفر بعد');

  ws.send(JSON.stringify({ type: 'set-language', callId, language: code }));
  detectedLangSpan.textContent = displayLang(code);
  alert('تم تعيين اللغة يدوياً');
};

sendReplyBtn.onclick = () => {
  const text = replyText.value.trim();
  const callId = callIdInput.value.trim();

  if (!text) return alert('اكتب رد الموظف');
  if (!ws || ws.readyState !== WebSocket.OPEN) return alert('لم يتصل السيرفر بعد');

  ws.send(JSON.stringify({ type: 'operator-reply', callId, text }));
  replyText.value = '';
  alert('تم إرسال الرد');
};

if (clearBtn) {
  clearBtn.onclick = () => {
    callerTextOriginal.textContent = '—';
    callerTextTranslated.textContent = '—';
  };
}
