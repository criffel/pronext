// Configuração de Balanças Toledo
document.addEventListener('DOMContentLoaded', () => {
  const formScale = document.getElementById('form-scale');
  const selectStore = document.getElementById('select-store');
  const selectSector = document.getElementById('select-sector');
  const inputIp = document.getElementById('input-ip');
  const inputGuiche = document.getElementById('input-guiche');
  const inputApiKey = document.getElementById('input-apikey');
  const tbodyScales = document.getElementById('scales-list-tbody');

  let storesData = {};
  let sectorsData = {};
  let currentMappings = {};

  // 1. Carrega lojas e setores do sistema
  fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      storesData = config.stores;
      sectorsData = config.sectors;

      // Popula Select de Lojas
      selectStore.innerHTML = '<option value="" disabled selected>Selecione a Filial...</option>';
      for (const key in storesData) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = storesData[key].name;
        selectStore.appendChild(opt);
      }

      // Popula Select de Setores
      selectSector.innerHTML = '<option value="" disabled selected>Selecione o Setor...</option>';
      for (const key in sectorsData) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = sectorsData[key].name;
        selectSector.appendChild(opt);
      }

      // Após carregar os metadados, carrega as balanças cadastradas
      loadScales();
    })
    .catch(err => {
      console.error('Erro ao buscar metadados de configuração:', err);
      tbodyScales.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--color-danger); padding: 2rem;">Erro ao carregar metadados do servidor.</td></tr>';
    });

  // 2. Carrega as balanças cadastradas a partir do backend
  function loadScales() {
    fetch('/api/toledo/config')
      .then(res => res.json())
      .then(toledoConfig => {
        currentMappings = toledoConfig.mappings || {};
        renderScalesTable();
      })
      .catch(err => {
        console.error('Erro ao carregar balanças:', err);
        tbodyScales.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--color-danger); padding: 2rem;">Erro ao carregar lista de balanças do servidor.</td></tr>';
      });
  }

  // 3. Renderiza a tabela de balanças cadastradas
  function renderScalesTable() {
    tbodyScales.innerHTML = '';
    const ips = Object.keys(currentMappings);

    if (ips.length === 0) {
      tbodyScales.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhuma balança cadastrada.</td></tr>';
      return;
    }

    ips.forEach(ip => {
      const scale = currentMappings[ip];
      const storeName = storesData[scale.store] ? storesData[scale.store].name : scale.store;
      const sectorName = sectorsData[scale.sector] ? sectorsData[scale.sector].name : scale.sector;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: monospace; font-weight: bold; color: #38bdf8;">${ip}</td>
        <td>${storeName}</td>
        <td>${sectorName}</td>
        <td><span class="badge" style="background: rgba(255,255,255,0.05); padding: 0.35rem 0.75rem; border-radius: var(--border-radius-sm); border: 1px solid var(--border-glass);">${scale.guiche || ''}</span></td>
        <td>
          <button class="btn-delete" data-ip="${ip}">
            <i class="fa-solid fa-trash-can"></i> Excluir
          </button>
        </td>
      `;
      tbodyScales.appendChild(tr);
    });

    // Registra eventos para os botões de excluir
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const ipToDelete = e.currentTarget.getAttribute('data-ip');
        if (confirm(`Deseja realmente remover a balança com IP ${ipToDelete}?`)) {
          const apiKey = prompt("Digite a Chave de Administração para excluir:");
          if (apiKey) {
            deleteScale(ipToDelete, apiKey);
          }
        }
      });
    });
  }

  // 4. Cadastra/Salva uma nova balança
  formScale.addEventListener('submit', (e) => {
    e.preventDefault();

    const ip = inputIp.value.trim();
    const store = selectStore.value;
    const sector = selectSector.value;
    const guiche = inputGuiche.value.trim();
    const apiKey = inputApiKey.value.trim();

    if (!ip || !store || !sector || !guiche || !apiKey) {
      alert('Preencha todos os campos e a Chave de Administração.');
      return;
    }

    // Adiciona ou atualiza no mapeamento local
    currentMappings[ip] = { store, sector, guiche };

    saveConfigToServer(apiKey);
  });

  // 5. Deleta uma balança
  function deleteScale(ip, apiKey) {
    if (currentMappings[ip]) {
      delete currentMappings[ip];
      saveConfigToServer(apiKey);
    }
  }

  // 6. Envia as configurações atualizadas para o servidor
  function saveConfigToServer(apiKey) {
    fetch('/api/toledo/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({ mappings: currentMappings })
    })
      .then(res => {
        if (!res.ok) throw new Error('Falha ao salvar configurações no servidor.');
        return res.json();
      })
      .then(data => {
        currentMappings = data.mappings || {};
        renderScalesTable();
        
        // Limpa formulário
        inputIp.value = '';
        selectStore.value = '';
        selectSector.value = '';
        inputGuiche.value = '';
        
        alert('Configurações salvas e aplicadas com sucesso!');
      })
      .catch(err => {
        console.error(err);
        alert('Erro ao salvar as configurações. Verifique o console.');
      });
  }

  // 7. Configurações da URL de integração para o Agente Local
  const relayUrlText = document.getElementById('relay-url-text');
  if (relayUrlText) {
    // Busca a configuração central para calcular o IP e porta locais e montar a URL de forma precisa
    fetch('/api/config')
      .then(res => res.json())
      .then(config => {
        const serverOrigin = window.location.protocol + '//' + config.localIp + ':' + config.port;
        relayUrlText.textContent = serverOrigin;
      })
      .catch(() => {
        relayUrlText.textContent = window.location.origin;
      });
  }
});

// Função global para copiar a URL
function copyRelayUrl() {
  const text = document.getElementById('relay-url-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    alert('URL do Servidor Central copiada para a área de transferência com sucesso!');
  }).catch(err => {
    console.error('Erro ao copiar URL:', err);
    alert('Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.');
  });
}
