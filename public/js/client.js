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
let pushSubscription = null;
let vibrationInterval = null;

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
  sendRegistration();
  
  // Ativa Wake Lock para manter a tela ligada se suportado
  requestWakeLock();
});

// Envia o registro inicial do cliente com a assinatura Push opcional
function sendRegistration() {
  socket.emit('register_client', {
    loja: storeSlug,
    sector: sector,
    existingTicket: existingTicket,
    subscription: pushSubscription
  });
}

// Helper para converter a chave pública VAPID do formato base64 para Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Registra Service Worker e inscreve no Web Push se suportado
if ('serviceWorker' in navigator && 'PushManager' in window) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('Service Worker registrado:', reg);
      
      // Solicita permissão para notificações
      return Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          // Busca configuração VAPID do servidor
          return fetch('/api/config')
            .then(res => res.json())
            .then(config => {
              if (config.publicVapidKey) {
                const options = {
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToUint8Array(config.publicVapidKey)
                };
                return reg.pushManager.subscribe(options);
              }
            });
        }
      });
    })
    .then(sub => {
      if (sub) {
        console.log('Assinatura Push criada com sucesso.');
        pushSubscription = sub;
        if (socket.connected) {
          sendRegistration();
        }
      }
    })
    .catch(err => {
      console.warn('Configuração de Push Notifications não suportada ou recusada:', err);
    });
}

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
  
  const elAlertGuiche = document.getElementById('alert-guiche');
  if (elAlertGuiche) {
    if (ticket.guiche) {
      elAlertGuiche.textContent = ticket.guiche;
      elAlertGuiche.style.display = 'block';
    } else {
      elAlertGuiche.style.display = 'none';
    }
  }
  
  elAlertContainer.style.display = 'flex';
  
  // Executa efeitos
  playChime();
  vibrateDevice();
  
  if (isRecall) {
    console.log('Chamada repetida!');
  }
});

// Ação de Dispensar Alerta
elBtnDismiss.addEventListener('click', () => {
  // Limpa alerta visual e para vibração
  document.body.classList.remove('called-alert');
  elAlertContainer.style.display = 'none';
  stopVibration();
  
  // Remove o ticket do localStorage para não re-carregar como ativo
  localStorage.removeItem(localStorageKey);
  myTicket = null;

  // Configura os links do card de finalizado
  document.getElementById('link-back-selection').href = `/retirar/${storeSlug}`;
  
  // Oculta painel ativo e exibe painel de finalização
  document.getElementById('main-card').style.display = 'none';
  document.getElementById('finished-card').style.display = 'block';
});

// Ação de Solicitar Nova Senha no mesmo setor
document.getElementById('btn-new-ticket').addEventListener('click', () => {
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

// Sintetizador de Áudio nativo usando Web Audio API
function playChime() {
  try {
    const ctx = getAudioContext();
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

// API de Vibração do HTML5 (Melhorada para rodar em loop até o atendido clicar)
function vibrateDevice() {
  if (navigator.vibrate) {
    navigator.vibrate(0); // Para vibrações anteriores
    if (vibrationInterval) clearInterval(vibrationInterval);
    
    // Padrão forte: vibra 500ms, pausa 250ms, vibra 500ms, pausa 250ms, vibra 800ms
    const pattern = [500, 250, 500, 250, 800, 250, 800];
    navigator.vibrate(pattern);
    
    // Repete a vibração a cada 5 segundos enquanto o modal estiver aberto
    vibrationInterval = setInterval(() => {
      navigator.vibrate(pattern);
    }, 5000);
  }
}

function stopVibration() {
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
  if (vibrationInterval) {
    clearInterval(vibrationInterval);
    vibrationInterval = null;
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
