const socket = io();

// ─── Elementos da Interface ──────────────────────────────
const elCallOverlay   = document.getElementById('tv-call-overlay');
const elMainTicket    = document.getElementById('tv-main-ticket');
const elMainSector    = document.getElementById('tv-main-sector');
const elHistoryPanel  = document.getElementById('tv-history-panel');
const elVoiceControl  = document.getElementById('voice-control');
const elVoiceIcon     = document.getElementById('voice-icon');
const elProgressBar   = document.getElementById('slide-progress-bar');
const elSliderArea    = document.getElementById('tv-slider-area');

// ─── Estado ─────────────────────────────────────────────
let soundEnabled = true;
let callTimeout  = null;
let currentSlideIndex = 0;
let slideInterval = null;

let queuesStatusGlobal = {};
const pathParts = window.location.pathname.split('/');
const storeSlug = pathParts[2] || '';
const tvSectorSlug = pathParts[3] || null;

const SLIDE_DURATION = 7000; // ms por slide
let slides = Array.from(document.querySelectorAll('.mk-slide'));
let dots   = Array.from(document.querySelectorAll('.slide-dot'));

if (tvSectorSlug) {
  // Filtra slides mantendo apenas o geral e o do setor
  slides.forEach(slide => {
    if (!slide.classList.contains('general') && !slide.classList.contains(tvSectorSlug)) {
      slide.remove();
    }
  });
  // Recarrega slides do DOM
  slides = Array.from(document.querySelectorAll('.mk-slide'));
  
  // Remove dots extras
  const dotsContainer = document.getElementById('slide-dots');
  if (dotsContainer) {
    dotsContainer.innerHTML = '';
    slides.forEach((_, i) => {
      const d = document.createElement('div');
      d.className = 'slide-dot';
      if (i === 0) d.classList.add('active');
      dotsContainer.appendChild(d);
    });
    dots = Array.from(document.querySelectorAll('.slide-dot'));
  }
}

// ─── Relógio em Tempo Real ───────────────────────────────
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');

  const elClock = document.getElementById('tv-clock');
  const elDate  = document.getElementById('tv-date');
  if (elClock) elClock.textContent = `${h}:${m}:${s}`;

  if (elDate) {
    const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    elDate.textContent = `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]}`;
  }
}
updateClock();
setInterval(updateClock, 1000);

// ─── Carrossel com Progress Bar ──────────────────────────
function goToSlide(index) {
  slides[currentSlideIndex].classList.remove('active');
  dots[currentSlideIndex].classList.remove('active');

  currentSlideIndex = (index + slides.length) % slides.length;

  slides[currentSlideIndex].classList.add('active');
  dots[currentSlideIndex].classList.add('active');

  startProgressBar();
}

function startProgressBar() {
  elProgressBar.style.transition = 'none';
  elProgressBar.style.width = '0%';

  // força reflow antes de ativar a transição
  void elProgressBar.offsetWidth;
  elProgressBar.style.transition = `width ${SLIDE_DURATION}ms linear`;
  elProgressBar.style.width = '100%';
}

function startSlideshow() {
  if (slideInterval) clearInterval(slideInterval);
  startProgressBar();
  slideInterval = setInterval(() => {
    goToSlide(currentSlideIndex + 1);
  }, SLIDE_DURATION);
}

function pauseSlideshow() {
  if (slideInterval) clearInterval(slideInterval);
  slideInterval = null;
  elProgressBar.style.transition = 'none';
  elProgressBar.style.width = '0%';
}

// Inicia carrossel
startSlideshow();

// ─── QR Code ─────────────────────────────────────────────
function generateQrOnCanvas(canvasId, value) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (typeof QRious !== 'undefined') {
    try {
      new QRious({
        element: canvas,
        value: value,
        size: 260,
        background: '#ffffff',
        foreground: '#05060f',
        level: 'H'
      });
    } catch (e) {
      drawFallbackText(canvas, value);
    }
  } else {
    drawFallbackText(canvas, value);
  }
}

function drawFallbackText(canvas, value) {
  const ctx = canvas.getContext('2d');
  canvas.width = 260; canvas.height = 260;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 260, 260);
  ctx.fillStyle = '#05060f';
  ctx.font = 'bold 14px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Acesse:', 130, 90);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 13px Outfit, sans-serif';
  ctx.fillText(value.replace('http://', '').slice(0, 30), 130, 130);
}

// ─── Configuração Inicial ─────────────────────────────────

fetch('/api/config')
  .then(res => res.json())
  .then(config => {
    const storeObj = config.stores[storeSlug];

    // Nome da loja na topbar e no slide geral
    if (storeObj) {
      const elTopbarStore = document.getElementById('tv-store-name');
      const elSlideTitle  = document.getElementById('tv-title-store');
      if (elTopbarStore) elTopbarStore.textContent = storeObj.name;
      if (elSlideTitle)  elSlideTitle.innerHTML = storeObj.name.replace(' ', '<br>');
    }

    // QR Code Geral: leva para a página de autoatendimento para escolher setor
    const generalQrUrl = `${window.location.origin}/retirar/${storeSlug}`;
    generateQrOnCanvas('qr-tv-general', generalQrUrl);

    // QR Codes por setor (Senha Rápida): direciona direto para o cliente gerar a senha no setor
    generateQrOnCanvas('qr-tv-acougue', `${window.location.origin}/cliente/${storeSlug}/acougue`);
    generateQrOnCanvas('qr-tv-padaria', `${window.location.origin}/cliente/${storeSlug}/padaria`);
    generateQrOnCanvas('qr-tv-rotisseria', `${window.location.origin}/cliente/${storeSlug}/rotisseria`);
    generateQrOnCanvas('qr-tv-frios', `${window.location.origin}/cliente/${storeSlug}/frios`);
    generateQrOnCanvas('qr-tv-peixaria', `${window.location.origin}/cliente/${storeSlug}/peixaria`);
  })
  .catch(() => {
    generateQrOnCanvas('qr-tv-general', `${window.location.origin}/retirar/${storeSlug}`);
    generateQrOnCanvas('qr-tv-acougue', `${window.location.origin}/cliente/${storeSlug}/acougue`);
    generateQrOnCanvas('qr-tv-padaria', `${window.location.origin}/cliente/${storeSlug}/padaria`);
    generateQrOnCanvas('qr-tv-rotisseria', `${window.location.origin}/cliente/${storeSlug}/rotisseria`);
    generateQrOnCanvas('qr-tv-frios', `${window.location.origin}/cliente/${storeSlug}/frios`);
    generateQrOnCanvas('qr-tv-peixaria', `${window.location.origin}/cliente/${storeSlug}/peixaria`);
  });

// ─── Socket.io ───────────────────────────────────────────

socket.on('initial_state', ({ globalHistory, queuesStatus }) => {
  if (tvSectorSlug) {
    globalHistory = globalHistory.filter(h => h.sector === tvSectorSlug);
  }
  renderHistory(globalHistory);
  
  if (queuesStatus) {
    if (tvSectorSlug) {
      const sectorStatus = {};
      if (queuesStatus[tvSectorSlug]) sectorStatus[tvSectorSlug] = queuesStatus[tvSectorSlug];
      queuesStatusGlobal = sectorStatus;
    } else {
      queuesStatusGlobal = queuesStatus;
    }
    renderWaitingList();
  }
});

socket.on('queues_status_update', (queuesStatus) => {
  if (tvSectorSlug) {
    const sectorStatus = {};
    if (queuesStatus[tvSectorSlug]) sectorStatus[tvSectorSlug] = queuesStatus[tvSectorSlug];
    queuesStatusGlobal = sectorStatus;
  } else {
    queuesStatusGlobal = queuesStatus;
  }
  renderWaitingList();
});

socket.on('play_call', ({ ticket, isRecall, globalHistory }) => {
  if (tvSectorSlug && ticket.sector !== tvSectorSlug) return;

  showCall(ticket);
  
  if (tvSectorSlug) {
    globalHistory = globalHistory.filter(h => h.sector === tvSectorSlug);
  }
  renderHistory(globalHistory);

  // Flash visual
  elSliderArea.classList.remove('tv-flash');
  void elSliderArea.offsetWidth;
  elSliderArea.classList.add('tv-flash');

  if (soundEnabled) {
    playChime();
    setTimeout(() => playSpeech(ticket), 1000);
  }
});

socket.on('disconnect', () => {
  console.warn('TV desconectada do servidor!');
  const dot = document.querySelector('.topbar-dot');
  if (dot) {
    dot.style.background = '#ef4444';
    dot.style.boxShadow = '0 0 8px #ef4444';
    dot.title = 'Desconectado';
  }
});

socket.on('connect', () => {
  console.log(`TV conectada. Filial: ${storeSlug}`);
  socket.emit('register_tv', { loja: storeSlug });
  const dot = document.querySelector('.topbar-dot');
  if (dot) {
    dot.style.background = '#22c55e';
    dot.style.boxShadow = '0 0 8px #22c55e';
    dot.title = 'Conectado';
  }
});

function showCall(ticket) {
  elMainTicket.textContent = ticket.formatted;
  elMainSector.textContent = ticket.sectorName;

  const elMainGuiche = document.getElementById('tv-main-guiche');
  const elMetaSep = document.getElementById('tv-main-meta-sep');
  if (elMainGuiche && elMetaSep) {
    if (ticket.guiche) {
      elMainGuiche.textContent = ticket.guiche;
      elMainGuiche.style.display = 'inline';
      elMetaSep.style.display = 'inline-block';
    } else {
      elMainGuiche.style.display = 'none';
      elMetaSep.style.display = 'none';
    }
  }

  // Remove classes de setor anteriores e aplica o novo
  elCallOverlay.className = `active ${ticket.sector}`;
  elCallOverlay.id = 'tv-call-overlay';

  pauseSlideshow();

  if (callTimeout) clearTimeout(callTimeout);
  callTimeout = setTimeout(() => {
    elCallOverlay.classList.remove('active');
    startSlideshow();
  }, 12000);
}

// ─── Histórico ───────────────────────────────────────────
function renderHistory(historyList = []) {
  const items = historyList.slice(0, 3);
  elHistoryPanel.innerHTML = '';

  items.forEach((item, idx) => {
    const timeAgo = formatTimeAgo(item.calledAt);
    const div = document.createElement('div');
    div.className = `history-item ${item.sector}`;
    div.innerHTML = `
      <div class="history-num">${item.formatted}</div>
      <div class="history-info">
        <div class="history-sector">${item.sectorName}</div>
        <div class="history-guiche" style="font-size: 1.8vh; font-weight: 600; color: var(--muted);">${item.guiche || ''}</div>
        <div class="history-time">${timeAgo}</div>
      </div>
      <div class="history-tag">${idx === 0 ? '● Último' : `${idx + 1}º`}</div>
    `;
    elHistoryPanel.appendChild(div);
  });

  // Preenche com placeholders se necessário
  while (elHistoryPanel.children.length < 3) {
    const ph = document.createElement('div');
    ph.className = 'history-item history-empty';
    ph.innerHTML = `
      <div class="history-num" style="color:var(--muted)">---</div>
      <div class="history-info">
        <div class="history-sector">Aguardando</div>
      </div>
    `;
    elHistoryPanel.appendChild(ph);
  }
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  return `há ${Math.floor(diff / 3600)}h`;
}

// ─── Lista de Espera ──────────────────────────────────────
function renderWaitingList() {
  const elList = document.getElementById('tv-waiting-list');
  if (!elList) return;
  
  let allWaiting = [];
  for (const sector in queuesStatusGlobal) {
    if (queuesStatusGlobal[sector].waitingList) {
      queuesStatusGlobal[sector].waitingList.forEach(t => {
        allWaiting.push({
          sector: sector,
          formatted: t.formatted
        });
      });
    }
  }
  
  // Limita a 8 clientes para caber na tela com fonte grande
  allWaiting = allWaiting.slice(0, 8);
  
  elList.innerHTML = '';
  
  if (allWaiting.length === 0) {
    elList.innerHTML = `<div class="waiting-empty">Ninguém aguardando...</div>`;
    return;
  }
  
  const SECTOR_NAMES = {
    acougue: 'Açougue',
    padaria: 'Padaria',
    rotisseria: 'Rotisseria',
    frios: 'Frios',
    peixaria: 'Peixaria',
    general: 'Geral'
  };
  
  allWaiting.forEach(item => {
    const div = document.createElement('div');
    div.className = `waiting-item ${item.sector}`;
    div.innerHTML = `
      <div class="waiting-item-num">${item.formatted}</div>
      <div class="waiting-item-sector">${SECTOR_NAMES[item.sector] || item.sector}</div>
    `;
    elList.appendChild(div);
  });
}

// ─── Áudio ───────────────────────────────────────────────
let globalAudioCtx = null;
function getAudioContext() {
  if (!globalAudioCtx || globalAudioCtx.state === 'closed') {
    globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume();
  }
  return globalAudioCtx;
}

function playChime() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const notes = [659.25, 783.99, 1046.50];
    const timings = [0, 0.18, 0.36];

    notes.forEach((freq, idx) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + timings[idx]);
      gain.gain.setValueAtTime(0.2, now + timings[idx]);
      gain.gain.exponentialRampToValueAtTime(0.001, now + timings[idx] + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + timings[idx]);
      osc.stop(now + timings[idx] + 0.9);
    });
  } catch (err) {
    console.error('Chime error:', err);
  }
}

// Pré-carrega vozes para evitar falhas assíncronas no TTS
let ptVoice = null;
function loadVoices() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    const voices = window.speechSynthesis.getVoices();
    ptVoice = voices.find(v => v.lang.includes('pt-BR') || v.lang.includes('pt_BR'));
  }
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

function playSpeech(ticket) {
  try {
    const lettersMatch = ticket.formatted.match(/[A-Za-z]+/);
    const numbersMatch = ticket.formatted.match(/\d+/);
    
    const letters = lettersMatch ? lettersMatch[0].split('').join(' ') : '';
    const numbers = numbersMatch ? parseInt(numbersMatch[0], 10) : '';
    
    const text = `Senha, ${letters}, ${numbers}, dirija-se ao, ${ticket.sectorName}`;

    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'pt-BR';
    utt.rate = 0.9;
    
    if (ptVoice) {
      utt.voice = ptVoice;
    } else {
      const voices = window.speechSynthesis.getVoices();
      const voice = voices.find(v => v.lang.includes('pt-BR') || v.lang.includes('pt_BR'));
      if (voice) utt.voice = voice;
    }

    window.speechSynthesis.speak(utt);
  } catch (err) {
    console.error('TTS error:', err);
  }
}

// ─── Controle de Voz ─────────────────────────────────────
elVoiceControl.addEventListener('click', (e) => {
  e.stopPropagation(); // Evita re-disparar o clique da janela
  soundEnabled = !soundEnabled;

  if (soundEnabled) {
    elVoiceIcon.className = 'fa-solid fa-volume-high';
    elVoiceIcon.style.color = '#22c55e';
    elVoiceIcon.style.filter = 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.4))';
    elVoiceControl.style.borderColor = 'rgba(34, 197, 94, 0.4)';
    playChime();
  } else {
    elVoiceIcon.className = 'fa-solid fa-volume-xmark';
    elVoiceIcon.style.color = '#ef4444';
    elVoiceIcon.style.filter = 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.4))';
    elVoiceControl.style.borderColor = 'var(--border)';
    window.speechSynthesis.cancel();
  }
});

// Desbloqueia o AudioContext/Autoplay na primeira interação com qualquer parte da tela
function unlockAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      const tempCtx = new AudioContextClass();
      if (tempCtx.state === 'suspended') {
        tempCtx.resume();
      }
    }
    // Força desbloqueio do sintetizador de voz (Safari/Chrome require synchronous user-gesture)
    window.speechSynthesis.cancel();
    const silentUtt = new SpeechSynthesisUtterance(' ');
    silentUtt.volume = 0;
    window.speechSynthesis.speak(silentUtt);
    console.log('Sintetizador e áudio desbloqueados.');
  } catch (e) {
    console.error('Erro ao desbloquear áudio:', e);
  }
  // Remove os ouvintes para não rodar novamente
  window.removeEventListener('click', unlockAudio);
  window.removeEventListener('touchstart', unlockAudio);
}
window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);
