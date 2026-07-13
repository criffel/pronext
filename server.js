const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const webpush = require('web-push');
const { initToledoListener } = require('./toledo-listener');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Configuração do Web Push (VAPID) para notificações em background/tela bloqueada
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BODBKn45anyO-H_lFXzj3XbXAKd7EeAm95cwqbszUCki5HXuFoyvpAla6cJvZHKYglAvlMsGgGCMT-egm4_9GS8';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'I8hkvQychaAdJRnnn7UjN1cQ1AXz7Bq-OjkEUgqtmns';

webpush.setVapidDetails(
  'mailto:cristiano.timachado@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// Lista real de lojas do grupo
const STORES = {
  'super-atacado-primaveras': { name: 'Super Atacado Primaveras', prefix: 'SAP' },
  'machado-tarumas': { name: 'Machado Tarumãs', prefix: 'MT' },
  'machado-itaubas': { name: 'Machado Itaúbas', prefix: 'MI' },
  'machado-jardim-primaveras': { name: 'Machado Jardim Primaveras', prefix: 'MJP' },
  'machado-aeroporto': { name: 'Machado Aeroporto', prefix: 'MA' },
  'machado-tancredo-neves': { name: 'Machado Tancredo Neves', prefix: 'MTN' },
  'super-atacado-vitoria-regia': { name: 'Super Atacado Vitória Régia', prefix: 'SAV' },
  'super-atacado-supercenter': { name: 'Super Atacado Supercenter', prefix: 'SSC' },
  'super-atacado-br-163': { name: 'Super Atacado BR 163', prefix: 'SBR' }
};

// Lista real de setores customizados
const SECTORS = {
  acougue: { name: 'Açougue', prefix: 'A' },
  padaria: { name: 'Padaria', prefix: 'P' },
  rotisseria: { name: 'Rotisseria', prefix: 'R' },
  frios: { name: 'Frios', prefix: 'F' },
  peixaria: { name: 'Peixaria', prefix: 'PE' }
};

// Inicialização do estado das filas e histórico por filial em memória
const DATA_FILE = path.join(__dirname, 'data.json');
let queues = {};
let globalHistory = {};

function initQueues() {
  for (const storeSlug in STORES) {
    queues[storeSlug] = {};
    globalHistory[storeSlug] = [];
    for (const sectorSlug in SECTORS) {
      queues[storeSlug][sectorSlug] = {
        lastNumber: 0,
        waiting: [],
        called: []
      };
    }
  }
}

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (data.queues && data.globalHistory) {
        queues = data.queues;
        globalHistory = data.globalHistory;
        console.log('📦 Dados das filas carregados do disco com sucesso.');
        return;
      }
    } catch (err) {
      console.error('⚠️ Erro ao carregar data.json. Iniciando com filas vazias.', err);
    }
  }
  initQueues();
}

let saveTimeout = null;
function saveData() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const data = { queues, globalHistory };
      fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8', (err) => {
        if (err) console.error('⚠️ Erro ao salvar data.json:', err);
      });
    } catch (err) {
      console.error('⚠️ Erro ao salvar data.json:', err);
    }
  }, 2000);
}

// Carrega os dados na inicialização
loadData();

app.use(express.json());

// Serve arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Chave de autenticação para rotas administrativas
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'filapro-admin-2026';
function requireAdminKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apikey;
  if (key !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Chave de autenticação inválida.' });
  }
  next();
}

// Rota de Landing Page (Seletor central de filiais)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota para a interface de configuração de balanças
app.get('/config/balancas', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'config.html'));
});

// API para ler as configurações de balanças Toledo
app.get('/api/toledo/config', (req, res) => {
  const configPath = path.join(__dirname, 'toledo-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      return res.json(JSON.parse(raw));
    }
  } catch (err) {
    console.error('Erro ao ler toledo-config.json:', err);
  }
  res.json({ enabled: true, port: 9050, mappings: {} });
});

// API para ler as configurações filtradas para um Relay específico de uma loja
app.get('/api/toledo/relay-config', (req, res) => {
  const { store } = req.query;
  const storeSlug = store ? store.toLowerCase() : '';
  const configPath = path.join(__dirname, 'toledo-config.json');
  let mappings = {};

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // Filtra os mapeamentos que pertencem a esta loja específica
      for (const ip in config.mappings) {
        if (config.mappings[ip].store.toLowerCase() === storeSlug) {
          mappings[ip] = config.mappings[ip];
        }
      }
    }
  } catch (err) {
    console.error('Erro ao processar relay-config:', err);
  }

  res.json({ store: storeSlug, mappings });
});

// API para atualizar as configurações de balanças Toledo
app.post('/api/toledo/config', requireAdminKey, (req, res) => {
  const configPath = path.join(__dirname, 'toledo-config.json');
  try {
    const { mappings } = req.body;
    let config = { enabled: true, port: 9050, mappings: {} };
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    config.mappings = mappings || {};
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    res.json(config);
  } catch (err) {
    console.error('Erro ao salvar toledo-config.json:', err);
    res.status(500).json({ error: 'Erro ao gravar as configurações de balanças.' });
  }
});

// API para receber chamadas de balanças Toledo via Relay Local (HTTP POST)
app.post('/api/toledo/call', (req, res) => {
  const { store, sector, number, guiche } = req.body;
  const storeSlug = store ? store.toLowerCase() : '';
  const sectorSlug = sector ? sector.toLowerCase() : '';

  if (!STORES[storeSlug] || !SECTORS[sectorSlug]) {
    return res.status(404).json({ error: 'Loja ou Setor inválido.' });
  }

  const queue = queues[storeSlug][sectorSlug];
  let ticket = null;
  const ticketNum = parseInt(number, 10);

  if (!isNaN(ticketNum) && ticketNum > 0) {
    const ticketIndex = queue.waiting.findIndex(t => t.number === ticketNum);
    if (ticketIndex !== -1) {
      ticket = queue.waiting.splice(ticketIndex, 1)[0];
    } else {
      const formatted = `${SECTORS[sectorSlug].prefix}${String(ticketNum).padStart(3, '0')}`;
      ticket = {
        number: ticketNum,
        formatted,
        loja: storeSlug,
        sector: sectorSlug,
        sectorName: SECTORS[sectorSlug].name,
        socketId: null,
        createdAt: Date.now()
      };
      queue.lastNumber = Math.max(queue.lastNumber, ticketNum);
    }
  } else {
    // Chamada padrão de próximo se não houver número
    if (queue.waiting.length === 0) {
      return res.status(400).json({ error: 'Fila vazia no setor.' });
    }
    ticket = queue.waiting.shift();
  }

  ticket.status = 'called';
  ticket.calledAt = Date.now();
  ticket.guiche = guiche || 'Balcão';

  if (!queue.called.some(t => t.number === ticket.number)) {
    queue.called.push(ticket);
  }

  globalHistory[storeSlug].unshift({
    formatted: ticket.formatted,
    sector: ticket.sector,
    sectorName: ticket.sectorName,
    calledAt: ticket.calledAt,
    guiche: ticket.guiche
  });

  if (globalHistory[storeSlug].length > 10) {
    globalHistory[storeSlug].pop();
  }

  triggerCall(storeSlug, ticket);
  res.json({ success: true, ticket });
});

// Endpoint para download do script do Agente Local (Relay)
app.get('/api/toledo/download-relay', (req, res) => {
  const filePath = path.join(__dirname, 'toledo_relay.py');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'toledo_relay.py');
  } else {
    res.status(404).send('Script do agente não encontrado no servidor.');
  }
});

// Rota dinâmica para Clientes de uma filial e setor
app.get('/cliente/:loja/:setor', (req, res) => {
  const { loja, setor } = req.params;
  const storeSlug = loja.toLowerCase();
  const sectorSlug = setor.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  if (STORES[storeSlug] && SECTORS[sectorSlug]) {
    res.sendFile(path.join(__dirname, 'public', 'cliente.html'));
  } else {
    res.status(404).send('Filial ou Setor inválido. Verifique os parâmetros da URL.');
  }
});

// Rota dinâmica para Autoatendimento do Cliente de uma filial específica
app.get('/retirar/:loja', (req, res) => {
  const { loja } = req.params;
  const storeSlug = loja.toLowerCase();
  if (STORES[storeSlug]) {
    res.sendFile(path.join(__dirname, 'public', 'retirar.html'));
  } else {
    res.status(404).send('Filial inválida na URL de autoatendimento.');
  }
});

// Rota dinâmica para TV de uma filial específica
app.get('/tv/:loja', (req, res) => {
  const { loja } = req.params;
  const storeSlug = loja.toLowerCase();
  if (STORES[storeSlug]) {
    res.sendFile(path.join(__dirname, 'public', 'tv.html'));
  } else {
    res.status(404).send('Filial inválida na URL da TV.');
  }
});

// Rota dinâmica para Atendente de uma filial específica
app.get('/atendente/:loja', (req, res) => {
  const { loja } = req.params;
  const storeSlug = loja.toLowerCase();
  if (STORES[storeSlug]) {
    res.sendFile(path.join(__dirname, 'public', 'atendente.html'));
  } else {
    res.status(404).send('Filial inválida na URL do Atendente.');
  }
});

// Função para buscar IP de rede local
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// API de Status de uma loja
app.get('/api/status/:loja', (req, res) => {
  const storeSlug = req.params.loja.toLowerCase();
  if (STORES[storeSlug]) {
    res.json({
      queues: queues[storeSlug],
      globalHistory: globalHistory[storeSlug]
    });
  } else {
    res.status(404).json({ error: 'Loja inválida.' });
  }
});

// API de Configuração do Sistema
app.get('/api/config', (req, res) => {
  res.json({
    localIp: getLocalIp(),
    port: PORT,
    stores: STORES,
    sectors: SECTORS,
    publicVapidKey: VAPID_PUBLIC_KEY
  });
});

// Comunicação Socket.io Isolada por Filial (Rooms)
io.on('connection', (socket) => {
  console.log(`Novo dispositivo conectado via WebSockets: ${socket.id}`);

  // Rastreamento de socket → ticket para limpeza no disconnect
  const socketMeta = { loja: null, sector: null, ticketNumber: null };

  // Registro de TV em sala específica da filial
  socket.on('register_tv', (data) => {
    const { loja } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (STORES[storeSlug]) {
      socket.join(`${storeSlug}:tvs`);
      socket.emit('initial_state', {
        globalHistory: globalHistory[storeSlug],
        queuesStatus: getQueuesStatus(storeSlug)
      });
      console.log(`TV registrada na loja ${storeSlug}: ${socket.id}`);
    }
  });

  // Registro de Atendente na filial e setor
  socket.on('register_attendant', (data) => {
    const { loja, sector } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (STORES[storeSlug] && SECTORS[sector]) {
      socket.join(`${storeSlug}:attendants:${sector}`);
      socket.emit('queue_update', getQueueDetails(storeSlug, sector));
      console.log(`Atendente registrado na loja ${storeSlug}, setor ${sector}: ${socket.id}`);
    }
  });

  // Registro/Reconexão do Cliente
  socket.on('register_client', (data) => {
    const { loja, sector, existingTicket, subscription } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (!STORES[storeSlug] || !SECTORS[sector]) {
      return socket.emit('error_message', 'Loja ou Setor inválido no registro do cliente.');
    }

    socket.join(`${storeSlug}:clients:${sector}`);

    let ticket = null;

    if (existingTicket && existingTicket.loja === storeSlug && existingTicket.sector === sector) {
      // Tenta recuperar ticket na fila de espera
      const foundInWaiting = queues[storeSlug][sector].waiting.find(t => t.number === existingTicket.number);
      if (foundInWaiting) {
        ticket = foundInWaiting;
        ticket.socketId = socket.id;
        if (subscription) ticket.subscription = subscription;
      } else {
        // Tenta recuperar nos chamados recentes
        const foundInCalled = queues[storeSlug][sector].called.find(t => t.number === existingTicket.number);
        if (foundInCalled) {
          ticket = foundInCalled;
          ticket.socketId = socket.id;
          if (subscription) ticket.subscription = subscription;
        } else {
          // Se o ticket existe fisicamente mas não está na memória do servidor,
          // nós o criamos para permitir o acompanhamento pelo cliente!
          const ticketNum = parseInt(existingTicket.number);
          if (!isNaN(ticketNum) && ticketNum > 0) {
            // Atualiza lastNumber se for maior
            if (ticketNum > queues[storeSlug][sector].lastNumber) {
              queues[storeSlug][sector].lastNumber = ticketNum;
            }

            const formatted = `${SECTORS[sector].prefix}${String(ticketNum).padStart(3, '0')}`;
            ticket = {
              number: ticketNum,
              formatted,
              loja: storeSlug,
              sector,
              sectorName: SECTORS[sector].name,
              socketId: socket.id,
              createdAt: Date.now(),
              status: 'waiting',
              subscription: subscription || null
            };
            queues[storeSlug][sector].waiting.push(ticket);
            queues[storeSlug][sector].waiting.sort((a, b) => a.number - b.number);
          }
        }
      }
    }

    // Cria nova senha se não houver antiga ativa
    if (!ticket) {
      queues[storeSlug][sector].lastNumber += 1;
      const ticketNum = queues[storeSlug][sector].lastNumber;
      const formatted = `${SECTORS[sector].prefix}${String(ticketNum).padStart(3, '0')}`;

      ticket = {
        number: ticketNum,
        formatted,
        loja: storeSlug,
        sector,
        sectorName: SECTORS[sector].name,
        socketId: socket.id,
        createdAt: Date.now(),
        status: 'waiting',
        subscription: subscription || null
      };

      queues[storeSlug][sector].waiting.push(ticket);
    }

    // Junta-se ao canal privado da senha nesta loja
    socket.join(`${storeSlug}:ticket:${ticket.formatted}`);

    // Confirma ticket
    socket.emit('ticket_assigned', {
      ticket,
      position: getPositionInQueue(storeSlug, sector, ticket.number)
    });

    // Atualiza atendentes e TV daquela loja
    broadcastQueueUpdates(storeSlug, sector);
    console.log(`Cliente registrado: Senha ${ticket.formatted} na loja ${storeSlug}, setor ${sector}`);
    socketMeta.loja = storeSlug;
    socketMeta.sector = sector;
    socketMeta.ticketNumber = ticket.number;
  });

  // Atendente chama o próximo cliente na loja
  socket.on('call_next', (data) => {
    const { loja, sector, guiche } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (!STORES[storeSlug] || !SECTORS[sector]) return;

    const queue = queues[storeSlug][sector];
    if (queue.waiting.length === 0) {
      return socket.emit('queue_empty', 'Não há clientes aguardando na fila.');
    }

    const ticket = queue.waiting.shift();
    ticket.status = 'called';
    ticket.calledAt = Date.now();
    ticket.guiche = guiche || 'Balcão';

    queue.called.push(ticket);

    // Adiciona ao histórico daquela loja
    globalHistory[storeSlug].unshift({
      formatted: ticket.formatted,
      sector: ticket.sector,
      sectorName: ticket.sectorName,
      calledAt: ticket.calledAt,
      guiche: ticket.guiche
    });
    if (globalHistory[storeSlug].length > 10) {
      globalHistory[storeSlug].pop();
    }

    triggerCall(storeSlug, ticket);
  });

  // Atendente solicita re-chamada (Recall) na loja
  socket.on('recall_ticket', (data) => {
    const { loja, sector, guiche } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (!STORES[storeSlug] || !SECTORS[sector]) return;

    const queue = queues[storeSlug][sector];
    const lastCalled = queue.called[queue.called.length - 1];

    if (!lastCalled) {
      return socket.emit('error_message', 'Nenhuma senha chamada anteriormente neste setor.');
    }

    if (guiche) {
      lastCalled.guiche = guiche;
    }

    triggerCall(storeSlug, lastCalled, true);
  });

  // Atendente chama uma senha manual específica na loja
  socket.on('call_specific', (data) => {
    const { loja, sector, number, guiche } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (!STORES[storeSlug] || !SECTORS[sector]) return;

    const ticketNum = parseInt(number);
    if (isNaN(ticketNum)) {
      return socket.emit('error_message', 'Número de senha inválido.');
    }

    const queue = queues[storeSlug][sector];
    let ticketIndex = queue.waiting.findIndex(t => t.number === ticketNum);
    let ticket;

    if (ticketIndex !== -1) {
      ticket = queue.waiting.splice(ticketIndex, 1)[0];
    } else {
      const formatted = `${SECTORS[sector].prefix}${String(ticketNum).padStart(3, '0')}`;
      ticket = {
        number: ticketNum,
        formatted,
        loja: storeSlug,
        sector,
        sectorName: SECTORS[sector].name,
        socketId: null,
        createdAt: Date.now()
      };
      queue.lastNumber = Math.max(queue.lastNumber, ticketNum);
    }

    ticket.status = 'called';
    ticket.calledAt = Date.now();
    ticket.guiche = guiche || 'Balcão';

    if (!queue.called.some(t => t.number === ticket.number)) {
      queue.called.push(ticket);
    }

    globalHistory[storeSlug].unshift({
      formatted: ticket.formatted,
      sector: ticket.sector,
      sectorName: ticket.sectorName,
      calledAt: ticket.calledAt,
      guiche: ticket.guiche
    });
    if (globalHistory[storeSlug].length > 10) {
      globalHistory[storeSlug].pop();
    }

    triggerCall(storeSlug, ticket);
  });

  // Resetar filas de um setor na loja
  socket.on('reset_queue', (data) => {
    const { loja, sector } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (STORES[storeSlug] && SECTORS[sector]) {
      queues[storeSlug][sector].lastNumber = 0;
      queues[storeSlug][sector].waiting = [];
      queues[storeSlug][sector].called = [];

      // Filtra histórico daquela loja
      globalHistory[storeSlug] = globalHistory[storeSlug].filter(h => h.sector !== sector);

      saveData();

      broadcastQueueUpdates(storeSlug, sector);
      io.to(`${storeSlug}:tvs`).emit('initial_state', {
        globalHistory: globalHistory[storeSlug],
        queuesStatus: getQueuesStatus(storeSlug)
      });

      console.log(`Fila do setor ${sector} na loja ${storeSlug} foi zerada.`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Dispositivo desconectado: ${socket.id}`);
    // Remove cliente desconectado da fila de espera
    if (socketMeta.loja && socketMeta.sector && socketMeta.ticketNumber !== null) {
      const q = queues[socketMeta.loja]?.[socketMeta.sector];
      if (q) {
        const idx = q.waiting.findIndex(t => t.number === socketMeta.ticketNumber);
        if (idx !== -1) {
          q.waiting.splice(idx, 1);
          console.log(`🧹 Senha ${socketMeta.ticketNumber} removida da fila (cliente desconectou).`);
          broadcastQueueUpdates(socketMeta.loja, socketMeta.sector);
        }
      }
    }
  });
});

// Funções Auxiliares de Fila por Loja

function getQueueDetails(loja, sector) {
  return {
    waitingCount: queues[loja][sector].waiting.length,
    lastCalled: queues[loja][sector].called[queues[loja][sector].called.length - 1] || null,
    waitingList: queues[loja][sector].waiting.map(t => ({ number: t.number, formatted: t.formatted }))
  };
}

function getQueuesStatus(loja) {
  const status = {};
  for (const sector in SECTORS) {
    status[sector] = {
      waitingCount: queues[loja][sector].waiting.length,
      waitingList: queues[loja][sector].waiting.map(t => ({ number: t.number, formatted: t.formatted })),
      lastCalled: queues[loja][sector].called[queues[loja][sector].called.length - 1] || null
    };
  }
  return status;
}

function getPositionInQueue(loja, sector, ticketNumber) {
  const index = queues[loja][sector].waiting.findIndex(t => t.number === ticketNumber);
  return index === -1 ? 0 : index;
}

function broadcastQueueUpdates(loja, sector) {
  // Atualiza atendentes da loja no setor
  io.to(`${loja}:attendants:${sector}`).emit('queue_update', getQueueDetails(loja, sector));
  
  // Atualiza painel geral de TVs da loja
  io.to(`${loja}:tvs`).emit('queues_status_update', getQueuesStatus(loja));

  // Atualiza posições dos clientes da loja na fila
  queues[loja][sector].waiting.forEach((ticket) => {
    if (ticket.socketId) {
      const pos = getPositionInQueue(loja, sector, ticket.number);
      io.to(ticket.socketId).emit('queue_position', {
        position: pos,
        currentCalled: queues[loja][sector].called[queues[loja][sector].called.length - 1] || null
      });
    }
  });

  // Salva o estado atual no disco
  saveData();
}

function triggerCall(loja, ticket, isRecall = false) {
  // 1. Emite para as TVs da loja
  io.to(`${loja}:tvs`).emit('play_call', {
    ticket,
    isRecall,
    globalHistory: globalHistory[loja]
  });

  // 2. Emite canal privado do ticket do cliente
  io.to(`${loja}:ticket:${ticket.formatted}`).emit('your_turn', {
    ticket,
    isRecall
  });

  // 3. Envia Notificação Push em background se o cliente tiver assinatura ativa
  if (ticket.subscription) {
    const payload = JSON.stringify({
      title: `FilaPro - Sua Vez!`,
      body: `Senha ${ticket.formatted} chamada no setor ${ticket.sectorName}!`,
      url: `/cliente/${ticket.loja}/${ticket.sector}`
    });

    webpush.sendNotification(ticket.subscription, payload)
      .then(() => console.log(`Push enviado com sucesso para a senha ${ticket.formatted}`))
      .catch(err => {
        console.error(`Erro ao enviar Push para ${ticket.formatted}:`, err);
        // Limpa assinatura inválida ou expirada
        if (err.statusCode === 410 || err.statusCode === 404) {
          ticket.subscription = null;
        }
      });
  }

  // 4. Atualiza filas
  broadcastQueueUpdates(loja, ticket.sector);
}

// Inicializa escuta de balanças Toledo
initToledoListener(io, queues, globalHistory, STORES, SECTORS, triggerCall, broadcastQueueUpdates);

server.listen(PORT, () => {
  console.log('=================================================');
  console.log(`Servidor FilaPro Multi-Loja rodando na porta ${PORT}`);
  console.log(`Acesse http://localhost:${PORT} para iniciar`);
  console.log('=================================================');
});
