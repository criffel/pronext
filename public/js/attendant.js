const socket = io();

// Elementos de Configuração / Login
const panelSetup = document.getElementById('panel-setup');
const formSetup = document.getElementById('form-setup');
const selectSector = document.getElementById('select-sector');
const inputGuiche = document.getElementById('input-guiche');
const inputPin = document.getElementById('input-pin');

// Elementos do Painel do Atendente
const panelDashboard = document.getElementById('panel-dashboard');
const displaySector = document.getElementById('display-sector');
const displayGuiche = document.getElementById('display-guiche');
const displayWaitingCount = document.getElementById('display-waiting-count');
const displayLastCalled = document.getElementById('display-last-called');

// Ações
const btnCallNext = document.getElementById('btn-call-next');
const btnRecall = document.getElementById('btn-recall');
const formSpecific = document.getElementById('form-specific');
const inputSpecific = document.getElementById('input-specific');
const btnReset = document.getElementById('btn-reset');
const elWaitingList = document.getElementById('waiting-list');

// Estado Local e Rota da Filial
const pathParts = window.location.pathname.split('/');
const storeSlug = pathParts[2] || '';

let currentSector = '';
let currentConfig = null;

// Carrega os setores disponíveis da API de configuração
fetch('/api/config')
  .then(res => res.json())
  .then(config => {
    currentConfig = config;
    
    // Popula o select de setores
    selectSector.innerHTML = '<option value="" disabled selected>Selecione um setor...</option>';
    for (const key in config.sectors) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = config.sectors[key].name;
      selectSector.appendChild(option);
    }
    
    // Recupera dados salvos anteriormente no localStorage
    const cachedSector = localStorage.getItem('filapro_att_sector');
    if (cachedSector && config.sectors[cachedSector]) selectSector.value = cachedSector;

    const cachedGuiche = localStorage.getItem('filapro_att_guiche');
    if (cachedGuiche && inputGuiche) inputGuiche.value = cachedGuiche;
  })
  .catch(err => {
    console.error('Erro ao obter configuração de setores:', err);
  });

// Fluxo de Início de Atendimento (Setup)
formSetup.addEventListener('submit', (e) => {
  e.preventDefault();
  
  currentSector = selectSector.value;
  const currentGuiche = inputGuiche.value.trim();
  const currentPin = inputPin.value.trim();
  
  if (!currentSector) {
    alert('Por favor, selecione um setor.');
    return;
  }
  if (!currentPin) {
    alert('Por favor, digite o PIN de Acesso.');
    return;
  }
  
  // Salva no cache
  localStorage.setItem('filapro_att_sector', currentSector);
  localStorage.setItem('filapro_att_guiche', currentGuiche);
  
  // Transiciona interfaces
  panelSetup.style.display = 'none';
  panelDashboard.style.display = 'grid';
  
  // Atualiza textos
  const sectorName = currentConfig && currentConfig.sectors[currentSector] 
    ? currentConfig.sectors[currentSector].name 
    : currentSector;
  displaySector.textContent = sectorName;

  if (currentGuiche) {
    displayGuiche.textContent = currentGuiche;
    displayGuiche.style.display = 'inline-block';
  } else {
    displayGuiche.style.display = 'none';
  }
  
  // Aplica classe de cor do setor no container do painel
  panelDashboard.classList.add(currentSector);
  
  // Registra atendente no Socket especificando a filial, setor, guichê e PIN
  socket.emit('register_attendant', { loja: storeSlug, sector: currentSector, guiche: currentGuiche, pin: currentPin });
});

// Listener para erro de autenticação (PIN inválido)
socket.on('auth_error', (msg) => {
  alert(msg);
  // Reverte a interface
  panelSetup.style.display = 'block';
  panelDashboard.style.display = 'none';
  panelDashboard.classList.remove(currentSector);
  inputPin.value = ''; // Limpa o PIN incorreto
});

// Recebe atualizações da fila de espera do setor
socket.on('queue_update', ({ waitingCount, lastCalled, waitingList }) => {
  displayWaitingCount.textContent = waitingCount;
  
  if (lastCalled) {
    displayLastCalled.textContent = lastCalled.formatted;
  } else {
    displayLastCalled.textContent = '---';
  }
  
  // Renderiza fila de espera
  elWaitingList.innerHTML = '';
  if (waitingList.length === 0) {
    elWaitingList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 1rem;">Nenhum cliente na fila.</div>';
  } else {
    waitingList.forEach((ticket, idx) => {
      const item = document.createElement('div');
      item.className = 'waiting-ticket-item';
      item.innerHTML = `
        <span>${ticket.formatted}</span>
        <span class="waiting-ticket-badge">${idx === 0 ? 'Próximo' : `${idx + 1}º da fila`}</span>
      `;
      elWaitingList.appendChild(item);
    });
  }
});

// Comandos
btnCallNext.addEventListener('click', () => {
  const currentGuiche = inputGuiche.value.trim();
  socket.emit('call_next', { loja: storeSlug, sector: currentSector, guiche: currentGuiche });
});

btnRecall.addEventListener('click', () => {
  const currentGuiche = inputGuiche.value.trim();
  socket.emit('recall_ticket', { loja: storeSlug, sector: currentSector, guiche: currentGuiche });
});

formSpecific.addEventListener('submit', (e) => {
  e.preventDefault();
  const ticketNumber = inputSpecific.value.trim();
  if (!ticketNumber) return;
  
  const currentGuiche = inputGuiche.value.trim();
  socket.emit('call_specific', {
    loja: storeSlug,
    sector: currentSector,
    number: ticketNumber,
    guiche: currentGuiche
  });
  
  inputSpecific.value = '';
});

btnReset.addEventListener('click', () => {
  const confirmReset = confirm('ATENÇÃO: Isso irá zerar a numeração de senhas e a fila de espera deste setor hoje nesta filial. Deseja continuar?');
  if (confirmReset) {
    socket.emit('reset_queue', { loja: storeSlug, sector: currentSector });
  }
});

// Tratamento de Mensagens de Alerta ou Erro
socket.on('queue_empty', (msg) => {
  alert(msg);
});

socket.on('error_message', (msg) => {
  alert(msg);
});
