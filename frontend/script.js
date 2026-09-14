/* ============================================================
   MAYA V1 — Frontend logic  (SECURE: no API key in this file)
   Web Speech STT → Backend /api/assistant → TTS output
   Safe command router for phone actions (Web APIs + Android bridge)
   ============================================================ */
'use strict';

/* ---------- CONFIG (localStorage-persisted, no secrets) ---------- */
const cfg = {
  apiBase: localStorage.getItem('maya.apiBase') || '',
  ttsOn:  localStorage.getItem('maya.ttsOn')  !== '0',
  sttOn:  localStorage.getItem('maya.sttOn')  !== '0',
  confirmActions: localStorage.getItem('maya.confirm') !== '0'
};
if(!cfg.apiBase){
  // Default: same host serving this page, or local dev backend
  cfg.apiBase = (location.protocol.startsWith('http') ? location.origin : 'http://localhost:3000');
}

/* ---------- HELPERS ---------- */
const $ = id => document.getElementById(id);
const chatArea=$('chatArea'), textIn=$('textIn'), sendBtn=$('sendBtn'),
      micBtn=$('micBtn'), statusText=$('statusText'), statusDot=$('statusDot'),
      netDot=$('netDot'), muteBtn=$('muteBtn'), muteIcon=$('muteIcon'),
      settingsBtn=$('settingsBtn'), settingsSheet=$('settingsSheet'),
      sheetBackdrop=$('sheetBackdrop'), closeSheet=$('closeSheet'),
      ttsToggle=$('ttsToggle'), sttToggle=$('sttToggle'),
      confirmToggle=$('confirmToggle'), apiBaseIn=$('apiBase'),
      confirmBackdrop=$('confirmBackdrop'), confirmTitle=$('confirmTitle'),
      confirmMsg=$('confirmMsg'), confirmYes=$('confirmYes'), confirmNo=$('confirmNo'),
      quickRow=$('quickRow'), logoOrb=$('logoOrb');

const MESSAGES={
  offline:      'You seem to be offline. Please check your internet connection.',
  serverDown:   'Maya’s brain isn’t reachable right now. Please try again in a moment.',
  micDenied:    'Microphone permission was denied. Please enable the microphone for Maya in your browser/app settings to talk to her.',
  micHTTPS:     'Voice input needs a secure (HTTPS) connection. Please open Maya over HTTPS, or use the text box.',
  noSTT:        'Voice input isn’t supported in this browser. You can still type your commands.',
  noTTS:        'Voice output isn’t available on this device, but Maya can still reply in text.',
  speechFail:   'Sorry, I couldn’t hear that clearly. Please try again.',
  invalid:      'I didn’t catch a valid command there. Try “What is the time?” or “Open YouTube”.',
  unsupported:  'That action requires the Android version of Maya.',
  rateLimited:  'You’re sending messages too quickly. Please wait a few seconds.',
  badRequest:   'That request didn’t look right. Please rephrase and try again.'
};

/* ---------- STATUS ---------- */
function setStatus(text, cls){
  statusText.textContent = text;
  statusDot.className = 'status-dot' + (cls ? ' ' + cls : '');
  logoOrb.classList.remove('busy');
  if(cls === 'think' || cls === 'speak' || cls === 'listen') logoOrb.classList.add('busy');
}
function netUpdate(){ netDot.classList.toggle('off', !navigator.onLine); }
addEventListener('online', ()=>{ netUpdate(); addMaya('Back online. I’m ready again.'); });
addEventListener('offline', ()=>{ netUpdate(); addMaya(MESSAGES.offline, 'notice'); });

/* ---------- CHAT UI ---------- */
function escapeHTML(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function scrollChat(){ chatArea.scrollTo({ top: chatArea.scrollHeight, behavior:'smooth' }); }

function addUser(text){
  const el=document.createElement('div');
  el.className='card user-card';
  el.textContent=text;
  chatArea.appendChild(el); scrollChat();
}
function addMaya(text, cls='', meta=''){
  const wrap=document.createElement('div'); wrap.className='nova-card';
  const av=document.createElement('div'); av.className='nova-avatar'; av.textContent='✦';
  const b=document.createElement('div'); b.className='nova-bubble'; if(cls)b.classList.add(cls);
  b.innerHTML=escapeHTML(text).replace(/\n/g,'<br>');
  if(meta){ const m=document.createElement('span'); m.className='meta'; m.textContent=meta; b.appendChild(m); }
  wrap.appendChild(av); wrap.appendChild(b);
  chatArea.appendChild(wrap); scrollChat();
}
let typingEl=null;
function showTyping(){
  hideTyping();
  const wrap=document.createElement('div'); wrap.className='nova-card';
  wrap.innerHTML='<div class="nova-avatar">✦</div><div class="nova-bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  chatArea.appendChild(wrap); typingEl=wrap; scrollChat();
}
function hideTyping(){ if(typingEl){ typingEl.remove(); typingEl=null; } }

/* ============================================================
   UART: ANDROID NATIVE BRIDGE (injected by MainActivity)
   In a normal browser window.MayaNative is undefined and every
   native-only action cleanly reports the Android requirement.
   ============================================================ */
const native = window.MayaNative || null;
function hasNative(fnName){ return !!native && typeof native[fnName] === 'function'; }

/* ============================================================
   TEXT-TO-SPEECH  (AudioResources: Android TTS preferred over web)
   ============================================================ */
function speak(text){
  if(!text) return;
  if(!cfg.ttsOn) return;
  if(hasNative('speak')){ try{ native.speak(text); setStatus('Speaking…','speak'); }catch(_){} return; }
  if(!('speechSynthesis' in window)){ addMaya(MESSAGES.noTTS,'notice'); return; }
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(text);
    u.lang=navigator.language||'en-US';
    u.rate=1.04; u.pitch=1.05; u.volume=1;
    u.onstart=()=>setStatus('Speaking…','speak');
    u.onend =()=>setStatus('Maya is ready');
    u.onerror=e=>{
      if(e.error==='interrupted'||e.error==='canceled') return;
      addMaya('My voice output had a small hiccup — my full reply is above.','notice');
      setStatus('Maya is ready');
    };
    const voices=speechSynthesis.getVoices();
    const pref=voices.find(v=>/female|zira|samantha|google uk english female/i.test(v.name))||voices.find(v=>v.lang.startsWith((u.lang||'en').slice(0,2)));
    if(pref) u.voice=pref;
    speechSynthesis.speak(u);
  }catch(_){ addMaya(MESSAGES.noTTS,'notice'); }
}
function stopSpeaking(){
  if(hasNative('stopSpeech')){ try{ native.stopSpeech(); }catch(_){} }
  else if('speechSynthesis' in window) speechSynthesis.cancel();
}

/* ============================================================
   SPEECH RECOGNITION (Web Speech API — provided by Android Chrome
   or the Android wrapper's onDeviceSpeechRecognizer)
   ============================================================ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec=null, wantListen=false;

function buildRecognizer(){
  if(!SR) return null;
  let r;
  try{ r = new SR(); }catch(_){ return null; }
  r.lang = native && native.speechLang ? native.speechLang() : (navigator.language||'en-US');
  r.interimResults = true;
  r.maxAlternatives = 1;
  r.continuous = false;

  r.onstart=()=>{
    micBtn.classList.add('listening');
    setStatus('Listening…','listen');
    if(hasNative('vibrate')) try{ native.vibrate(18); }catch(_){}
  };
  r.onresult=e=>{
    let interim='', final='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const res=e.results[i];
      if(res.isFinal) final+=res[0].transcript; else interim+=res[0].transcript;
    }
    if(final.trim()) handleUserCommand(final.trim());
  };
  r.onerror=e=>{
    micBtn.classList.remove('listening');
    if(!wantListen) return;
    wantListen=false;
    if(e.error==='not-allowed' || e.error==='service-not-allowed') addMaya(MESSAGES.micDenied,'error');
    else if(e.error==='audio-capture') addMaya('I can’t access any microphone on this device.','error');
    else if(e.error==='network') addMaya(MESSAGES.offline,'error');
    else if(e.error==='not-found') addMaya('No speech engine found. Please install a voice input service, or type instead.','notice');
    else if(e.error!=='aborted') addMaya(MESSAGES.speechFail,'notice');
    setStatus('Maya is ready');
  };
  r.onend=()=>{
    micBtn.classList.remove('listening');
    if(wantListen){ // browser auto-stops after silence — restart once to keep listening
      wantListen=false;
      try{ r.start(); wantListen=true; }catch(_){ wantListen=false; setStatus('Maya is ready'); }
      return;
    }
    if(statusText.textContent==='Listening…') setStatus('Maya is ready');
  };
  return r;
}
if(SR) rec=buildRecognizer();

async function toggleMic(){
  stopSpeaking();
  if(!SR || !rec){ addMaya(MESSAGES.noSTT,'notice'); return; }
  if(!cfg.sttOn){ addMaya('Voice input is turned off in Settings. You can type instead.'); return; }
  if(micBtn.classList.contains('listening')){ wantListen=false; try{ rec.stop(); }catch(_){} return; }

  // Permission pre-check where supported (denied → friendly error, never silent retry)
  if(navigator.permissions && navigator.permissions.query){
    try{
      const p=await navigator.permissions.query({ name:'microphone' });
      if(p.state==='denied'){ addMaya(MESSAGES.micDenied,'error'); return; }
      if(p.state==='prompt' && location.protocol!=='https:' && !hasNative('speak')){
        if(location.hostname!=='localhost'){ addMaya(MESSAGES.micHTTPS,'notice'); return; }
      }
    }catch(_){ /* permission API unsupported: proceed, the SR onerror handles denial */ }
  }

  if(state.thinking){ addMaya('Hold on, I’m still thinking about your last message.'); return; }
  try{ rec.start(); wantListen=true; }
  catch(e){ /* already started */ wantListen=true; }
}
const state={ thinking:false };

/* ============================================================
   AI BRAIN via BACKEND PROXY — the browser NEVER sends any API key.
   ============================================================ */
function recentHistory(){
  const cards=[...chatArea.querySelectorAll('.user-card, .nova-bubble')].slice(-8);
  return cards.map(el=>({
    role: el.classList.contains('user-card') ? 'user' : 'assistant',
    content: el.textContent.trim()
  })).filter(m=>m.content);
}

async function askAi(command){
  if(!navigator.onLine){ addMaya(MESSAGES.offline,'error'); return null; }
  state.thinking=true; showTyping(); setStatus('Thinking…','think');
  try{
    const res=await fetch(cfg.apiBase.replace(/\/+$/,'')+'/api/assistant',{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ message:command, history:recentHistory() })
    });
    hideTyping(); state.thinking=false;
    if(res.status===429){ addMaya(MESSAGES.rateLimited,'notice'); setStatus('Maya is ready'); return null; }
    if(res.status===400){ addMaya(MESSAGES.badRequest,'notice'); setStatus('Maya is ready'); return null; }
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data=await res.json();
    setStatus('Maya is ready');
    if(!data || !data.reply){ addMaya(MESSAGES.serverDown,'error'); return null; }
    return data.reply;
  }catch(err){
    hideTyping(); state.thinking=false;
    addMaya(navigator.onLine ? MESSAGES.serverDown : MESSAGES.offline,'error');
    setStatus('Maya is ready');
    return null;
  }
}

/* ============================================================
   SAFE COMMAND ROUTER
   Uses only official Web APIs or Android Intents (via bridge).
   Sensitive/native actions require user confirmation.
   ============================================================ */
function openingLabelFor(k){
  const map={ camera:'Camera', settings:'Settings', calculator:'Calculator', whatsapp:'WhatsApp', alarm:'Clock' };
  return 'Opening '+(map[k]||k)+'.';
}

function nativeIntent(kind){
  if(!hasNative('intent')) return { say:MESSAGES.unsupported, cls:'notice' };
  const go=()=>{ try{ native.intent(kind); return { say:openingLabelFor(kind) }; }catch(_){ return { say:'That action isn’t available on this device.', cls:'notice' }; } };
  return confirmThen(openingLabelFor(kind).replace('Opening ','Open ').replace('.',''), 'a native Android action (official intent)', go);
}

function openUrl(url, pretty){
  const go=()=>{
    if(hasNative('openUrl')){ try{ native.openUrl(url); return { say:pretty }; }catch(_){} }
    try{ window.open(url,'_blank','noopener'); return { say:pretty }; }
    catch(_){ return { say:MESSAGES.unsupported, cls:'notice' }; }
  };
  return confirmThen(pretty.replace('Opening ','Open '), url, go);
}

function goBack(){
  if(hasNative('goBack')){ try{ native.goBack(); return { say:'Going back.' }; }catch(_){} }
  if(history.length>1){ history.back(); return { say:'Going back.' }; }
  return { say:'I can’t go back from here.', cls:'notice' };
}

function setReminderAction(raw){
  if(hasNative('reminder')){
    const go=()=>{
      try{ native.reminder(raw||''); return { say:'Let’s set your reminder — pick a title and time.' }; }
      catch(_){ return { say:'Reminder setup failed. Please try again.', cls:'notice' }; }
    };
    return confirmThen('Set a reminder', 'Maya will open the Android reminder/alarm picker.', go);
  }
  // Browser fallback: official Alarm scheme only works on some Androids; be honest instead of faking.
  return { say:'That action requires the Android version of Maya. (Reminders use Android’s official AlarmClock intent.)', cls:'notice' };
}

function searchGoogle(q){
  return openUrl('https://www.google.com/search?q='+encodeURIComponent(q), 'Opening Google search for “'+q+'”.');
}
function searchYouTube(q){
  return openUrl('https://www.youtube.com/results?search_query='+encodeURIComponent(q), 'Opening YouTube results for “'+q+'”.');
}

function tellTime(){
  return { say:'The time is '+new Date().toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})+'.' };
}
function tellDate(){
  return { say:'Today is '+new Date().toLocaleDateString(undefined,{weekday:'long', day:'numeric', month:'long', year:'numeric'})+'.' };
}

/* Confirmation helper */
function confirmThen(title, detail, fn){
  if(!cfg.confirmActions) return fn();
  pendingConfirm=fn;
  confirmTitle.textContent=title;
  confirmMsg.textContent='Maya wants to: '+detail+'\nAllow this action?';
  confirmBackdrop.classList.add('show');
  return { say:'Waiting for your confirmation to proceed.' };
}

/* Router table */
function route(command){
  const c=command.toLowerCase().trim();
  let m;

  if(/^(hello|hi|hey)[ ,!]? ?(maya)?\b/.test(c)) return { say:'Hello! I’m Maya. How can I help you?' };
  if(/who are you|what are you/.test(c)) return { say:'I’m Maya — “My AI Assistant”. I can answer questions and help with simple phone actions.' };
  if((m=c.match(/(?:what(?:'s| is) the )?time\b/))) return tellTime();
  if(/what(?:'s| is) (?:the |today's )?date|what day is it/.test(c)) return tellDate();

  if((m=c.match(/^open google\b/)))       return openUrl('https://www.google.com','Opening Google.');
  if((m=c.match(/^open youtube\b/)))      return openUrl('https://www.youtube.com','Opening YouTube.');
  if((m=c.match(/^open gmail\b/)))        return openUrl('https://mail.google.com','Opening Gmail.');
  if((m=c.match(/^open maps? (?:maps)?\b/))) {
    if(hasNative('intent')) return nativeIntent('maps');
    return openUrl('https://www.google.com/maps','Opening Maps.');
  }

  if((m=c.match(/^(?:open|start) (?:the )?camera\b/)))     return nativeIntent('camera');
  if((m=c.match(/^(?:open|start) (?:the )?(?:calculator|calc)\b/))) return nativeIntent('calculator');
  if((m=c.match(/^open (?:the )?(?:phone )?settings?\b/))) return nativeIntent('settings');
  if((m=c.match(/^open (?:the )?clock\b/)))                return nativeIntent('alarm');
  if((m=c.match(/^open whatsapp\b/)))                      return nativeIntent('whatsapp');

  if((m=c.match(/^(?:go )?back\b|show my assistant\b/))) {
    if(/show my assistant/.test(c)) return { say:'I’m right here with you — Maya, ready when you are.' };
    return goBack();
  }

  if((m=c.match(/^(?:set|create) (?:a|an) reminder\b|^remind me (?:to )?(.+)$/))) return setReminderAction(m[1]||'');
  if((m=c.match(/^(?:set|create) (?:a|an) alarm(?: for (.+))?$/))) return nativeIntent('alarm');

  if((m=c.match(/^(?:search |look up )google (?:for )?(.+)$/))) return searchGoogle(m[1]);
  if((m=c.match(/^search google for (.+)$/)))                   return searchGoogle(m[1]);
  if((m=c.match(/^search (?:for )?(.+)$/)))                     return searchGoogle(m[1]);
  if((m=c.match(/^(?:search |look up )youtube (?:for )?(.+)$/))) return searchYouTube(m[1]);
  if((m=c.match(/^search youtube for (.+)$/)))                  return searchYouTube(m[1]);

  if((m=c.match(/^(?:open|launch|start) (.+)$/))){
    const name=m[1].replace(/ app$/,'').trim();
    if(hasNative('openApp')){
      return confirmThen('Open "'+name+'" app?','Maya will try to launch this installed app.',()=>{
        try{ const out=native.openApp(name); return { say: out && out.opened ? 'Opening '+name+'.' : 'I couldn’t find “'+name+'” on this phone.' }; }
        catch(_){ return { say:'I couldn’t open that app.', cls:'notice' }; }
      });
    }
    return { say:MESSAGES.unsupported, cls:'notice' };
  }

  return null; // not a phone action → AI brain
}

/* ============================================================
   MAIN PIPELINE
   ============================================================ */
async function handleUserCommand(command){
  stopSpeaking();
  if(!command){ addMaya(MESSAGES.invalid,'notice'); return; }
  addUser(command);
  try{
    const r=route(command);
    if(r){ addMaya(r.say || MESSAGES.confirmedDone, r.cls||''); speak(r.say); return; }
  }catch(_){ /* fallthrough to AI */ }
  const reply=await askAi(command);
  if(reply){ addMaya(reply); speak(reply); }
}

/* ============================================================
   EVENTS
   ============================================================ */
sendBtn.addEventListener('click',()=>{
  const v=textIn.value.trim(); if(!v){ addMaya(MESSAGES.invalid,'notice'); return; }
  textIn.value=''; v && handleUserCommand(v);
});
textIn.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); sendBtn.click(); } });
micBtn.addEventListener('click',toggleMic);
quickRow.querySelectorAll('.quick-btn').forEach(b=>
  b.addEventListener('click',()=>handleUserCommand(b.dataset.cmd)));

muteBtn.addEventListener('click',()=>{
  cfg.ttsOn=!cfg.ttsOn; persist();
  if(!cfg.ttsOn) stopSpeaking();
  syncSettings(); muteBtn.classList.remove('active');
});
settingsBtn.addEventListener('click',()=>{ syncSettings(); settingsSheet.classList.add('show'); sheetBackdrop.classList.add('show'); });
closeSheet.addEventListener('click',closeSettings);
sheetBackdrop.addEventListener('click',closeSettings);
function closeSettings(){
  settingsSheet.classList.remove('show'); sheetBackdrop.classList.remove('show');
  cfg.apiBase=apiBaseIn.value.trim()||cfg.apiBase; persist();
}
ttsToggle.addEventListener('change',e=>{ cfg.ttsOn=e.target.checked; if(!cfg.ttsOn) stopSpeaking(); persist(); syncSettings(); });
sttToggle.addEventListener('change',e=>{ cfg.sttOn=e.target.checked; persist(); syncSettings(); });
confirmToggle.addEventListener('change',e=>{ cfg.confirmActions=e.target.checked; persist(); syncSettings(); });
confirmYes.addEventListener('click',()=>{
  confirmBackdrop.classList.remove('show');
  const fn=pendingConfirm; pendingConfirm=null;
  const r=fn ? fn() : null;
  if(r){ addMaya(r.say||'Done.', r.cls||''); speak(r.say||'Done.'); } else { addMaya('Okay, done.'); speak('Okay, done.'); }
});
confirmNo.addEventListener('click',()=>{
  confirmBackdrop.classList.remove('show'); pendingConfirm=null;
  addMaya('No problem, I cancelled that.'); speak('No problem, I cancelled that.');
});

function persist(){
  localStorage.setItem('maya.apiBase',cfg.apiBase);
  localStorage.setItem('maya.ttsOn',cfg.ttsOn?'1':'0');
  localStorage.setItem('maya.sttOn',cfg.sttOn?'1':'0');
  localStorage.setItem('maya.confirm',cfg.confirmActions?'1':'0');
}
function syncSettings(){
  muteIcon.textContent = cfg.ttsOn ? '🔊' : '🔇';
  muteBtn.classList.toggle('active', cfg.ttsOn);
  ttsToggle.checked=cfg.ttsOn;
  sttToggle.checked=cfg.sttOn;
  confirmToggle.checked=cfg.confirmActions;
  apiBaseIn.value=cfg.apiBase;
}

/* ---------- BOOT ---------- */
netUpdate(); syncSettings(); setStatus('Maya is ready');
// Register PWA service worker (Web fallback only; native app doesn't need this)
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
// Allow the Android wrapper to tell Maya a native TTS result finished
window.mayaNativeEvent = function(event, payload){
  if(event==='speakEnd'){ setStatus('Maya is ready'); }
  if(event==='micPermission' && payload==='denied') addMaya(MESSAGES.micDenied,'error');
};
