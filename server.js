const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Configuração do Web Push (VAPID) para notificações em background/tela bloqueada
webpush.setVapidDetails(
  'mailto:cristiano.timachado@gmail.com',
  'BODBKn45anyO-H_lFXzj3XbXAKd7EeAm95cwqbszUCki5HXuFoyvpAla6cJvZHKYglAvlMsGgGCMT-egm4_9GS8',
  'I8hkvQychaAdJRnnn7UjN1cQ1AXz7Bq-OjkEUgqtmns'
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
const queues = {};
const globalHistory = {};

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

// Serve arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rota de Landing Page (Seletor central de filiais)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    publicVapidKey: 'BODBKn45anyO-H_lFXzj3XbXAKd7EeAm95cwqbszUCki5HXuFoyvpAla6cJvZHKYglAvlMsGgGCMT-egm4_9GS8'
  });
});

// Comunicação Socket.io Isolada por Filial (Rooms)
io.on('connection', (socket) => {
  console.log(`Novo dispositivo conectado via WebSockets: ${socket.id}`);

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
  });

  // Atendente chama o próximo cliente na loja
  socket.on('call_next', (data) => {
    const { loja, sector } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (!STORES[storeSlug] || !SECTORS[sector]) return;

    const queue = queues[storeSlug][sector];
    if (queue.waiting.length === 0) {
      return socket.emit('queue_empty', 'Não há clientes aguardando na fila.');
    }

    const ticket = queue.waiting.shift();
    ticket.status = 'called';
    ticket.calledAt = Date.now();

    queue.called.push(ticket);

    // Adiciona ao histórico daquela loja
    globalHistory[storeSlug].unshift({
      formatted: ticket.formatted,
      sector: ticket.sector,
      sectorName: ticket.sectorName,
      calledAt: ticket.calledAt
    });
    if (globalHistory[storeSlug].length > 10) {
      globalHistory[storeSlug].pop();
    }

    triggerCall(storeSlug, ticket);
  });

  // Atendente solicita re-chamada (Recall) na loja
  socket.on('recall_ticket', (data) => {
    const { loja, sector } = data || {};
    const storeSlug = loja ? loja.toLowerCase() : '';
    if (!STORES[storeSlug] || !SECTORS[sector]) return;

    const queue = queues[storeSlug][sector];
    const lastCalled = queue.called[queue.called.length - 1];

    if (!lastCalled) {
      return socket.emit('error_message', 'Nenhuma senha chamada anteriormente neste setor.');
    }

    triggerCall(storeSlug, lastCalled, true);
  });

  // Atendente chama uma senha manual específica na loja
  socket.on('call_specific', (data) => {
    const { loja, sector, number } = data || {};
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
        createdAt: Date.now(),
        status: 'called'
      };
    }

    ticket.status = 'called';
    ticket.calledAt = Date.now();

    queue.called.push(ticket);

    globalHistory[storeSlug].unshift({
      formatted: ticket.formatted,
      sector: ticket.sector,
      sectorName: ticket.sectorName,
      calledAt: ticket.calledAt
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

server.listen(PORT, () => {
  console.log('=================================================');
  console.log(`Servidor FilaPro Multi-Loja rodando na porta ${PORT}`);
  console.log(`Acesse http://localhost:${PORT} para iniciar`);
  console.log('=================================================');
});
