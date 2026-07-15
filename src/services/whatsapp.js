const axios = require('axios');

class WhatsAppService {
  constructor() {
    this.apiUrl = process.env.WHATSAPP_API_URL || 'http://localhost:8080/v1/messages';
    this.apiKey = process.env.WHATSAPP_API_KEY || 'mock-key';
    this.enabled = process.env.WHATSAPP_ENABLED === 'true';
  }

  /**
   * Envia uma mensagem no WhatsApp
   * @param {string} phone Número de telefone com DDI (ex: 5511999999999)
   * @param {string} message Texto da mensagem
   */
  async sendMessage(phone, message) {
    if (!this.enabled) {
      console.log(`[WhatsApp Mock] Para: ${phone} | Mensagem: ${message}`);
      return true;
    }

    try {
      // Exemplo genérico de envio (pode ser adaptado para Z-API, Evolution API, Twilio, etc)
      const payload = {
        number: phone,
        text: message
      };
      
      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // Previne travamento se a API não responder
      });
      
      console.log(`[WhatsApp] Mensagem enviada para ${phone}. ID: ${response.data.id || 'N/A'}`);
      return true;
    } catch (error) {
      // Simplifica o erro para não poluir os logs
      const errReason = error.response ? `HTTP ${error.response.status}` : error.code || error.message;
      console.error(`[WhatsApp Error] Falha ao enviar para ${phone}:`, errReason);
      return false;
    }
  }

  /**
   * Dispara alerta de aproximação na fila
   * @param {string} phone Número de telefone
   * @param {object} ticket Objeto do ticket (number, formatted, sectorName)
   * @param {number} positionsAhead Quantidade de pessoas na frente
   */
  async sendApproachingAlert(phone, ticket, positionsAhead) {
    if (!phone) return;
    
    // Formata o número (remove não-dígitos e garante o 55)
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 10 || cleanPhone.length === 11) {
      cleanPhone = '55' + cleanPhone;
    }

    const msg = `🔔 *FilaPro - Sua vez está chegando!*\n\nSua senha: *${ticket.formatted}* no setor *${ticket.sectorName}*.\nFaltam apenas *${positionsAhead}* pessoa(s) na sua frente. Por favor, aproxime-se do local de atendimento.`;
    
    await this.sendMessage(cleanPhone, msg);
  }
}

module.exports = new WhatsAppService();
