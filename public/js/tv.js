const socket = io();

// Elementos da Interface
const elMainContainer = document.getElementById('tv-main-card');
const elCallOverlay = document.getElementById('tv-call-overlay');
const elMainTicket = document.getElementById('tv-main-ticket');
const elMainSector = document.getElementById('tv-main-sector');
const elMainGuiche = document.getElementById('tv-main-guiche');
const elHistoryContainer = document.getElementById('tv-history-list');
const elVoiceControl = document.getElementById('voice-control');
const elVoiceStatusText = document.getElementById('voice-status-text');
const elVoiceDot = document.getElementById('voice-dot');

// Variáveis de Controle
let soundEnabled = false;
let callTimeout = null;
let currentSlideIndex = 0;
let slideInterval = null;
const slides = document.querySelectorAll('.marketing-slide');

// Inicia rotação das propagandas
function startSlideshow() {
  if (slideInterval) clearInterval(slideInterval);
  slideInterval = setInterval(() => {
    slides[currentSlideIndex].classList.remove('active');
    currentSlideIndex = (currentSlideIndex + 1) % slides.length;
    slides[currentSlideIndex].classList.add('active');
  }, 6000); // Troca de slide a cada 6 segundos
}

// Pausa carrossel (quando há senha em exibição)
function pauseSlideshow() {
  if (slideInterval) clearInterval(slideInterval);
}

// Inicia carrossel no carregamento
startSlideshow();

// Helper robusto para desenhar o QR Code ou exibir fallback de texto caso a biblioteca falhe no download (offline)
function generateQrOnCanvas(canvasId, value) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  if (typeof QRious !== 'undefined') {
    try {
      new QRious({
        element: canvas,
        value: value,
        size: 240,
        background: '#ffffff',
        foreground: '#0f111a',
        level: 'H'
      });
    } catch (e) {
      console.error('Erro ao instanciar QRious:', e);
      drawFallbackText(canvas, value);
    }
  } else {
    drawFallbackText(canvas, value);
  }
}

function drawFallbackText(canvas, value) {
  const ctx = canvas.getContext('2d');
  canvas.width = 240;
  canvas.height = 240;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 240, 240);
  
  // Bordas pretas simulando layout
  ctx.strokeStyle = '#0f111a';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 232, 232);
  
  ctx.fillStyle = '#0f111a';
  ctx.font = 'bold 15px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Acesse a fila em:', 120, 80);
  
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 16px Outfit, sans-serif';
  // Encurta a exibição se for muito longa
  const displayUrl = value.replace('http://', '');
  ctx.fillText(displayUrl, 120, 120);
  
  ctx.fillStyle = '#6b7280';
  ctx.font = '11px Outfit, sans-serif';
  ctx.fillText('Conecte no mesmo Wi-Fi', 120, 160);
}

// Obter loja a partir da URL (ex: /tv/machado-tarumas)
const pathParts = window.location.pathname.split('/');
const storeSlug = pathParts[2] || '';

// Carrega IP de rede do servidor para gerar o QR Code de autoatendimento na TV
fetch('/api/config')
  .then(res => res.json())
  .then(config => {
    // Atualiza título da TV com o nome da loja
    const storeObj = config.stores[storeSlug];
    if (storeObj) {
      const elStoreTitle = document.getElementById('tv-title-store');
      if (elStoreTitle) elStoreTitle.textContent = storeObj.name;
    }
    
    // QR Code direciona para a home com a filial pré-selecionada
    const baseUrl = `http://${config.localIp}:${config.port}/?loja=${storeSlug}`;
    generateQrOnCanvas('qr-tv-general', baseUrl);
  })
  .catch(err => {
    console.error('Erro ao buscar configuração de IP da TV:', err);
    generateQrOnCanvas('qr-tv-general', window.location.origin + `/?loja=${storeSlug}`);
  });

// Registro inicial da TV no servidor
socket.on('connect', () => {
  console.log(`TV Conectada ao Socket.io. Registrando na filial: ${storeSlug}`);
  socket.emit('register_tv', { loja: storeSlug });
});

// Recebe o estado inicial
socket.on('initial_state', ({ globalHistory }) => {
  updateDisplay(globalHistory);
});

// Recebe notificações de chamada em tempo real
socket.on('play_call', ({ ticket, isRecall, globalHistory }) => {
  console.log('Nova chamada recebida:', ticket);
  
  // Atualiza painel principal e histórico
  updateDisplay(globalHistory, ticket);
  
  // Efeito visual de Flash no container principal
  elMainContainer.classList.remove('tv-flash');
  void elMainContainer.offsetWidth; // Força reflow para reiniciar animação
  elMainContainer.classList.add('tv-flash');
  
  // Toca o gongo e fala a senha (se som estiver ativado)
  if (soundEnabled) {
    playChime();
    
    // Pequeno delay entre o gongo e a voz para não misturar
    setTimeout(() => {
      speakTicket(ticket);
    }, 1200);
  }
});

// Atualiza o estado visual das senhas na tela
function updateDisplay(historyList, currentTicket = null) {
  if (currentTicket) {
    elMainTicket.textContent = currentTicket.formatted;
    elMainSector.textContent = currentTicket.sectorName;
    elMainGuiche.textContent = `Guichê ${currentTicket.guiche}`;
    
    // Configura classes de estilo e ativa o overlay de chamada
    elCallOverlay.className = 'tv-active-call-overlay active ' + currentTicket.sector;
    
    // Pausa as propagandas enquanto a senha está em destaque
    pauseSlideshow();
    
    // Oculta o overlay após 12 segundos, retornando às propagandas
    if (callTimeout) clearTimeout(callTimeout);
    callTimeout = setTimeout(() => {
      elCallOverlay.classList.remove('active');
      elCallOverlay.classList.remove('acougue', 'padaria', 'peixaria');
      startSlideshow();
    }, 12000);
  }
  
  // Renderiza o Histórico das últimas 3 senhas no rodapé (sempre visível)
  elHistoryContainer.innerHTML = '';
  
  // Mostra as últimas 3 senhas chamadas do histórico global
  const historyToRender = historyList.slice(0, 3);
  
  historyToRender.forEach((item) => {
    const card = document.createElement('div');
    card.className = `history-card ${item.sector}`;
    card.innerHTML = `
      <div class="history-ticket">${item.formatted}</div>
      <div class="history-label">${item.sectorName} - G. ${item.guiche}</div>
    `;
    elHistoryContainer.appendChild(card);
  });

  // Se não houver itens suficientes no histórico, preenche com placeholders vazios
  while (elHistoryContainer.children.length < 3) {
    const placeholder = document.createElement('div');
    placeholder.className = 'history-card';
    placeholder.style.opacity = '0.3';
    placeholder.innerHTML = `
      <div class="history-ticket">---</div>
      <div class="history-label">Aguardando...</div>
    `;
    elHistoryContainer.appendChild(placeholder);
  }
}

// Sintetizador de Áudio nativo usando Web Audio API
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    
    // Sequência de 3 notas harmônicas ascendentes (E5 -> G5 -> C6)
    const notes = [659.25, 783.99, 1046.50];
    const timings = [0, 0.15, 0.3];
    
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + timings[idx]);
      gain.gain.setValueAtTime(0.18, now + timings[idx]);
      gain.gain.exponentialRampToValueAtTime(0.001, now + timings[idx] + 0.8);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + timings[idx]);
      osc.stop(now + timings[idx] + 0.8);
    });
  } catch (err) {
    console.error('Falha ao tocar chime da TV:', err);
  }
}

// Sintetizador de Voz nativo (SpeechSynthesis)
function speakTicket(ticket) {
  try {
    // Ex: "A05" -> "A, zero, cinco" para soletrar legivelmente
    const letters = ticket.formatted.match(/[A-Za-z]+/)[0];
    const numbers = ticket.formatted.match(/\d+/)[0];
    const spelledNumbers = numbers.split('').join(' ');
    
    const spelling = `${letters.split('').join(' ')}, ${spelledNumbers}`;
    const text = `Senha ${spelling}, no guichê ${ticket.guiche}, setor ${ticket.sectorName}.`;
    
    // Cancela falas anteriores pendentes na fila
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.85; // Fala ligeiramente mais pausada para ambientes ruidosos
    utterance.pitch = 1.0;
    
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.error('Falha na síntese de voz:', err);
  }
}

// Habilitação de Áudio via Interação (Políticas de segurança do navegador)
elVoiceControl.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  
  if (soundEnabled) {
    elVoiceDot.classList.remove('muted');
    elVoiceStatusText.textContent = 'Som Ativado';
    elVoiceControl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    
    // Executa um chime de teste para inicializar o AudioContext
    playChime();
  } else {
    elVoiceDot.classList.add('muted');
    elVoiceStatusText.textContent = 'Som Mutado';
    elVoiceControl.style.borderColor = 'var(--border-glass)';
    window.speechSynthesis.cancel();
  }
});
