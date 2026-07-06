// Inicializa conexão Socket.io
const socket = io();

// Elementos da Página
const elTicketNumber = document.getElementById('ticket-number');
const elSectorName = document.getElementById('sector-name');
const elWaitingAhead = document.getElementById('waiting-ahead');
const elCurrentCalled = document.getElementById('current-called');
const elCurrentGuiche = document.getElementById('current-guiche'); // Mantido apenas para evitar quebras se o ID existir
const elAlertContainer = document.getElementById('called-modal');
const elAlertSector = document.getElementById('alert-sector');
const elBtnDismiss = document.getElementById('btn-dismiss');

// Obter loja e setor a partir da URL (ex: /cliente/machado-tarumas/acougue)
const pathParts = window.location.pathname.split('/');
const storeSlug = pathParts[2];
let sector = pathParts[3];
// Normaliza o nome do setor (remove acentos, caixa baixa)
sector = sector.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Variáveis de Estado
let myTicket = null;
let wakeLock = null;

// Aplica classe de cor do setor no body
document.body.classList.add(sector);

// Tenta obter ticket existente do localStorage (isolado por filial)
const localStorageKey = `filapro_ticket_${storeSlug}_${sector}`;
const cachedTicket = localStorage.getItem(localStorageKey);
let existingTicket = null;
if (cachedTicket) {
  try {
    existingTicket = JSON.parse(cachedTicket);
  } catch (e) {
    console.error('Erro ao ler ticket do cache', e);
  }
}

// Ao conectar, registra o cliente no servidor
socket.on('connect', () => {
  console.log('Conectado ao servidor.');
  socket.emit('register_client', {
    loja: storeSlug,
    sector: sector,
    existingTicket: existingTicket
  });
  
  // Ativa Wake Lock para manter a tela ligada se suportado
  requestWakeLock();
});

// Recebe a senha gerada ou recuperada
socket.on('ticket_assigned', ({ ticket, position }) => {
  myTicket = ticket;
  localStorage.setItem(localStorageKey, JSON.stringify(ticket));
  
  // Atualiza interface
  elTicketNumber.textContent = ticket.formatted;
  elSectorName.textContent = ticket.sectorName;
  updateWaitingCount(position);
  
  console.log(`Minha senha: ${ticket.formatted} no setor ${ticket.sectorName}`);
});

// Recebe atualizações de posicionamento na fila
socket.on('queue_position', ({ position, currentCalled }) => {
  updateWaitingCount(position);
  
  if (currentCalled) {
    elCurrentCalled.textContent = currentCalled.formatted;
  } else {
    elCurrentCalled.textContent = '---';
  }
});

// Alerta: É a vez do cliente!
socket.on('your_turn', ({ ticket, isRecall }) => {
  console.log('É A MINHA VEZ!', ticket);
  
  // Modifica tela para alerta
  document.body.classList.add('called-alert');
  elAlertSector.textContent = ticket.sectorName;
  elAlertContainer.style.display = 'flex';
  
  // Executa efeitos
  playChime();
  vibrateDevice();
  
  // Se for recall, pisca a tela de forma mais agressiva
  if (isRecall) {
    console.log('Chamada repetida!');
  }
});

// Ação de Dispensar Alerta
elBtnDismiss.addEventListener('click', () => {
  // Limpa alerta visual
  document.body.classList.remove('called-alert');
  elAlertContainer.style.display = 'none';
  
  // Remove do localStorage para poder gerar uma nova senha ao recarregar a página
  localStorage.removeItem(localStorageKey);
  
  // Recarrega a página para pegar uma nova senha se o cliente quiser reentrar na fila
  window.location.reload();
});

// Atualiza o texto do contador de pessoas à frente
function updateWaitingCount(position) {
  if (position === 0) {
    elWaitingAhead.textContent = 'Você é o PRÓXIMO!';
    elWaitingAhead.style.color = '#38bdf8';
  } else {
    elWaitingAhead.textContent = `${position} pessoa${position > 1 ? 's' : ''}`;
    elWaitingAhead.style.color = 'var(--text-primary)';
  }
}

// Sintetizador de Áudio nativo usando Web Audio API
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    
    // Primeiro tom (Ding - Agudo)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(659.25, now); // E5
    osc1.frequency.exponentialRampToValueAtTime(329.63, now + 0.6); // E4
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.8);
    
    // Segundo tom (Dong - Mais Grave e Encorpado)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(523.25, now + 0.25); // C5
    osc2.frequency.exponentialRampToValueAtTime(261.63, now + 0.95); // C4
    gain2.gain.setValueAtTime(0.25, now + 0.25);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.25);
    osc2.stop(now + 1.2);
  } catch (err) {
    console.error('Falha ao reproduzir áudio WebAudio:', err);
  }
}

// API de Vibração do HTML5
function vibrateDevice() {
  if (navigator.vibrate) {
    // Padrão de vibração: Vibra 400ms, pausa 200ms, vibra 400ms, pausa 200ms, vibra 800ms
    navigator.vibrate([400, 200, 400, 200, 800]);
  }
}

// Função para tentar manter a tela ativa usando WakeLock
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock ativo. A tela não irá desligar.');
      
      // Se a página for minimizada/oculta e voltar, re-solicita
      document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      });
    } catch (err) {
      console.warn(`Wake Lock falhou: ${err.name}, ${err.message}`);
    }
  }
}

// Erros
socket.on('error_message', (msg) => {
  alert(msg);
});
