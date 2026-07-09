const net = require('net');
const readline = require('readline');

const PORT = 9050;
const HOST = '127.0.0.1';

console.log('=================================================');
console.log('Simulador de Chamadas de Balança Toledo (Senha MIT)');
console.log('Este script simula uma balança física enviando dados.');
console.log(`Conectando em ${HOST}:${PORT}...`);
console.log('=================================================');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function sendTicket(ticketInput) {
  const client = new net.Socket();

  client.connect(PORT, HOST, () => {
    console.log(`\n[Simulador] Conectado ao servidor TCP FilaPro.`);
    const payload = ticketInput.trim();
    if (payload) {
      // Envia no formato STX + número + ETX que a Toledo envia
      console.log(`[Simulador] Enviando ticket específico: "${payload}"`);
      client.write('\x02' + payload + '\x03');
    } else {
      console.log(`[Simulador] Enviando sinal de chamada padrão (PRÓXIMA da fila)`);
      client.write('+'); // Envia '+' indicando chamada de incremento/próximo
    }
  });

  client.on('error', (err) => {
    console.error(`\n[Simulador] Erro de conexão: ${err.message}`);
    console.log('Certifique-se de que o servidor FilaPro (server.js) está rodando e a porta 9050 está aberta.');
    askCommand();
  });

  client.on('close', () => {
    console.log('[Simulador] Conexão encerrada com o servidor.');
    askCommand();
  });
}

function askCommand() {
  rl.question('\nDigite o número da senha para chamar (ou pressione ENTER para chamar a próxima): ', (answer) => {
    sendTicket(answer);
  });
}

// Inicia loop
askCommand();
