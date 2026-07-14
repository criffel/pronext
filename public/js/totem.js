const pathParts = window.location.pathname.split('/');
let storeSlug = pathParts.length > 2 && pathParts[1] === 'totem' ? pathParts[2] : null;

// Fallback se usado via /totem.html?store=loja
if (!storeSlug) {
  const urlParams = new URLSearchParams(window.location.search);
  storeSlug = urlParams.get('store');
}

if (!storeSlug) {
  document.body.innerHTML = '<div style="text-align:center; padding: 3rem; color: #fff;"><h1>Erro</h1><p>Filial não informada na URL.</p></div>';
} else {
  initTotem();
}

async function initTotem() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    
    const storeObj = config.stores[storeSlug];
    if (storeObj) {
      document.getElementById('store-title').textContent = storeObj.name;
    } else {
      document.getElementById('store-title').textContent = storeSlug;
    }

    const sectorsGrid = document.getElementById('sectors-grid');
    sectorsGrid.innerHTML = '';

    const icons = {
      acougue: 'fa-drumstick-bite',
      padaria: 'fa-bread-slice',
      rotisseria: 'fa-kitchen-set',
      frios: 'fa-cheese',
      peixaria: 'fa-fish'
    };

    for (const key in config.sectors) {
      const sector = config.sectors[key];
      
      const btn = document.createElement('div');
      btn.className = `sector-btn ${key}`;
      btn.innerHTML = `
        <i class="fa-solid ${icons[key] || 'fa-tag'} sector-icon"></i>
        <span>${sector.name}</span>
      `;
      
      btn.addEventListener('click', () => handleSectorClick(key, sector.name));
      sectorsGrid.appendChild(btn);
    }
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
    document.getElementById('sectors-grid').innerHTML = '<div style="color:var(--color-danger); text-align:center; font-size:1.5rem;">Erro ao conectar ao servidor.</div>';
  }
}

let isGenerating = false;

async function handleSectorClick(sectorSlug, sectorName) {
  if (isGenerating) return;
  isGenerating = true;

  try {
    // Toca som de inicialização opcional, mas vamos usar apenas no sucesso.
    // getAudioContext(); // desbloqueia no click do usuario
    
    const response = await fetch('/api/toledo/call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        store: storeSlug,
        sector: sectorSlug,
        guiche: 'Totem'
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Erro desconhecido');
    }
    
    const ticket = await response.json();
    showSuccessModal(ticket, sectorName);
    
  } catch (err) {
    console.error('Erro ao gerar senha:', err);
    alert('Não foi possível gerar a senha: ' + err.message);
  } finally {
    isGenerating = false;
  }
}

function showSuccessModal(ticket, sectorName) {
  const modal = document.getElementById('success-modal');
  const modalTicket = document.getElementById('modal-ticket');
  const modalSector = document.getElementById('modal-sector');
  
  modalTicket.textContent = ticket.formatted || '---';
  modalSector.textContent = sectorName;
  
  modal.classList.add('active');
  
  // Toca som (definido no HTML)
  if (typeof playSuccessSound === 'function') {
    playSuccessSound();
  }
  
  // Auto-close após 5 segundos
  setTimeout(() => {
    modal.classList.remove('active');
  }, 5000);
}
