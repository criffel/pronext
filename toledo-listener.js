const net = require('net');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'toledo-config.json');

// Carrega as configurações do JSON
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[Toledo TCP] Erro ao ler toledo-config.json:', err);
  }
  return { enabled: true, port: 9050, mappings: {} };
}


// Analisa se o pacote recebido é um ticket texto válido ou um pacote de controle binário (heartbeat)
function parseTicketPayload(data) {
  if (data.length === 0) return { isBinary: true, text: '' };

  // Protocolo de Senha MIT da Toledo Prix 5/6:
  // Pacote de 22 bytes: STX (0x02) + 2 bytes opcode ASCII + ... + DLE (0x10) + ETX (0x03) + checksum
  // Opcode "06" = heartbeat/status (ignorar silenciosamente)
  // Opcode "01" = atendente pressionou o botão MIT (chamar próximo)
  if (data.length === 22 && data[0] === 0x02 && data[19] === 0x10 && data[20] === 0x03) {
    const opcode = data.toString('ascii', 1, 3);

    if (opcode === '06') {
      // Heartbeat puro - ignora sem processar
      return { isBinary: true, text: '' };
    }

    if (opcode === '01') {
      // Atendente pressionou o botão MIT na balança.
      // O número interno da balança é irrelevante para o FilaPro (fila virtual).
      // Retornamos texto vazio para acionar a lógica de "chamar próximo da fila virtual".
      console.log(`[Toledo TCP] ✓ Botão MIT pressionado (opcode=${opcode}) — chamando próximo da fila virtual.`);
      return { isBinary: false, text: '' };
    }

    // Outros opcodes - tratar como binário/desconhecido
    return { isBinary: true, text: '' };
  }

  // Protocolo ASCII simples (ex: simulador ou balanças sem MIT):
  // Se começar com STX (0x02), verifica o conteúdo até o ETX (0x03)
  if (data[0] === 0x02) {
    const etxIndex = data.indexOf(0x03);
    if (etxIndex !== -1) {
      let hasBinary = false;
      for (let i = 1; i < etxIndex; i++) {
        if (data[i] < 32 || data[i] > 126) { hasBinary = true; break; }
      }
      if (!hasBinary) {
        const text = data.toString('ascii', 1, etxIndex).trim();
        return { isBinary: false, text };
      }
    }
    return { isBinary: true, text: '' };
  }

  // Sem STX: verifica se todos os bytes são ASCII imprimíveis (32-126)
  for (let i = 0; i < data.length; i++) {
    if (data[i] < 32 || data[i] > 126) {
      return { isBinary: true, text: '' };
    }
  }
  const text = data.toString('ascii').trim();
  return { isBinary: false, text };
}

function initToledoListener(io, queues, globalHistory, STORES, SECTORS, triggerCall, broadcastQueueUpdates) {
  let config = loadConfig();
  if (!config.enabled) {
    console.log('[Toledo TCP] Integração desabilitada no arquivo de configuração.');
    return;
  }

  const server = net.createServer((socket) => {
    // Normaliza o IP do cliente (remove prefixo IPv6 ::ffff: se presente)
    let remoteIp = socket.remoteAddress || '';
    if (remoteIp.startsWith('::ffff:')) {
      remoteIp = remoteIp.slice(7);
    }

    console.log(`[Toledo TCP] Balança conectada: ${remoteIp}`);

    socket.on('data', (data) => {
      // Recarrega configuração a cada chamada para obter alterações da GUI sem reiniciar o servidor
      config = loadConfig();
      if (!config.enabled) return;

      const hexData = data.toString('hex').toUpperCase();
      const { isBinary, text } = parseTicketPayload(data);

      console.log(`[Toledo TCP] Recebido de ${remoteIp}: [Hex: ${hexData}] | IsBinary: ${isBinary} | Texto: "${text}"`);

      if (isBinary) {
        // Envia resposta de confirmação ACK (0x06) que muitos protocolos Toledo exigem para confirmar recebimento
        socket.write(Buffer.from([0x06]));
        return;
      }

      // Mapeia o IP da balança para uma loja e setor
      const mapping = config.mappings[remoteIp];
      if (!mapping) {
        console.warn(`[Toledo TCP] Alerta: Conexão recebida da balança com IP ${remoteIp}, mas este IP não está cadastrado.`);
        return;
      }

      const { store, sector, guiche } = mapping;
      const storeSlug = store ? store.toLowerCase() : '';
      const sectorSlug = sector ? sector.toLowerCase() : '';

      if (!STORES[storeSlug] || !SECTORS[sectorSlug]) {
        console.error(`[Toledo TCP] Mapeamento inválido para o IP ${remoteIp}: Loja (${storeSlug}) ou Setor (${sectorSlug}) não existe.`);
        return;
      }

      // Procura por números no pacote enviado (ex: a senha inserida/chamada)
      const match = text.match(/\d+/);
      const queue = queues[storeSlug][sectorSlug];

      let ticket = null;

      if (match) {
        // Balança chamando uma senha específica (ex: "0045" ou "A045" -> 45)
        const ticketNum = parseInt(match[0], 10);
        console.log(`[Toledo TCP] Balança ${guiche || remoteIp} chamou a senha específica: ${ticketNum}`);

        const ticketIndex = queue.waiting.findIndex(t => t.number === ticketNum);
        if (ticketIndex !== -1) {
          // Remove da fila de espera e define como chamada
          ticket = queue.waiting.splice(ticketIndex, 1)[0];
        } else {
          // Se não existir na fila, cria o ticket na hora (ex: chamada avulsa/manual)
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
        // Se a balança conectar mas não enviar números (ou se for uma chamada padrão de "+" sem número),
        // chamamos a próxima senha da fila de espera
        console.log(`[Toledo TCP] Balança ${guiche || remoteIp} solicitou chamar a PRÓXIMA senha da fila.`);
        if (queue.waiting.length === 0) {
          console.log(`[Toledo TCP] Fila vazia no setor ${sectorSlug} da loja ${storeSlug}. Nenhuma senha para chamar.`);
          return;
        }
        ticket = queue.waiting.shift();
      }

      if (ticket) {
        ticket.status = 'called';
        ticket.calledAt = Date.now();
        ticket.guiche = guiche || `Balança (${remoteIp})`;

        // Adiciona à lista de chamados se não estiver lá
        if (!queue.called.some(t => t.number === ticket.number)) {
          queue.called.push(ticket);
        }

        // Adiciona ao histórico da loja
        globalHistory[storeSlug].unshift({
          formatted: ticket.formatted,
          sector: ticket.sector,
          sectorName: ticket.sectorName,
          calledAt: ticket.calledAt,
          guiche: ticket.guiche
        });

        // Limita o histórico a 10 itens
        if (globalHistory[storeSlug].length > 10) {
          globalHistory[storeSlug].pop();
        }

        // Dispara a chamada para TV, sockets dos clientes e push notification
        triggerCall(storeSlug, ticket);
        console.log(`[Toledo TCP] Sucesso: Senha ${ticket.formatted} chamada pela balança ${ticket.guiche}`);
      }
    });

    socket.on('error', (err) => {
      console.error(`[Toledo TCP] Erro no socket da balança ${remoteIp}:`, err.message);
    });

    socket.on('close', () => {
      console.log(`[Toledo TCP] Conexão encerrada com a balança ${remoteIp}`);
    });
  });

  const port = config.port || 9050;
  server.listen(port, () => {
    console.log('=================================================');
    console.log(`[Toledo TCP] Ouvindo conexões de balanças na porta ${port}`);
    console.log('=================================================');
  });

  server.on('error', (err) => {
    console.error('[Toledo TCP] Erro ao iniciar servidor TCP:', err);
  });
}

module.exports = { initToledoListener };
