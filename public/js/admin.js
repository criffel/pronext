document.addEventListener('DOMContentLoaded', () => {
  const selectStore = document.getElementById('select-store');
  const inputApiKey = document.getElementById('input-apikey');
  const btnLogin = document.getElementById('btn-login');
  const authBlock = document.getElementById('auth-block');
  const dashboardContent = document.getElementById('dashboard-content');
  
  const kpiTotal = document.getElementById('kpi-total');
  const kpiPeak = document.getElementById('kpi-peak');
  
  let sectorChartInst = null;
  let hourChartInst = null;

  let token = '';

  // Carrega lojas
  fetch('/api/stores')
    .then(res => res.json())
    .then(stores => {
      selectStore.innerHTML = '<option value="" disabled selected>Selecione a Filial...</option>';
      stores.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        selectStore.appendChild(opt);
      });
    });

  btnLogin.addEventListener('click', doLogin);
  selectStore.addEventListener('change', () => {
    if (dashboardContent.style.display !== 'none') {
      loadDashboard();
    }
  });

  async function doLogin() {
    const store = selectStore.value;
    const username = document.getElementById('input-username').value.trim();
    const password = document.getElementById('input-password').value;

    if (!store) return alert('Selecione uma filial.');
    if (!username || !password) return alert('Preencha usuário e senha.');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro no login');
      
      token = data.token;
      authBlock.style.display = 'none';
      dashboardContent.style.display = 'block';
      
      loadDashboard();
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadDashboard() {
    const store = selectStore.value;
    if (!store || !token) return;

    try {
      // Fetch Stats
      const resStats = await fetch(`/api/stats?store=${store}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resStats.ok) throw new Error('Falha ao carregar estatísticas');
      const data = await resStats.json();
      renderCharts(data);

      // Fetch Media
      loadMedia(store);
      
      // Load Stores Table
      loadStoreManager();
    } catch (err) {
      alert(err.message);
    }
  }

  // --- MEDIA MANAGER ---
  const btnAddMedia = document.getElementById('btn-add-media');
  btnAddMedia.addEventListener('click', async () => {
    const store = selectStore.value;
    const url = document.getElementById('media-url').value.trim();
    const type = document.getElementById('media-type').value;
    const duration = document.getElementById('media-duration').value;

    if (!url) return alert('Preencha a URL da mídia');

    try {
      const res = await fetch('/api/media', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ store, media_url: url, media_type: type, duration: parseInt(duration) })
      });
      if (!res.ok) throw new Error('Erro ao salvar mídia');
      
      document.getElementById('media-url').value = '';
      loadMedia(store);
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadMedia(store) {
    const res = await fetch(`/api/media?store=${store}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const mediaList = await res.json();
    const tbody = document.getElementById('media-list');
    tbody.innerHTML = '';
    
    mediaList.forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding: 1rem; border-bottom: 1px solid var(--border-glass);">${m.id}</td>
        <td style="padding: 1rem; border-bottom: 1px solid var(--border-glass);">${m.media_type.toUpperCase()}</td>
        <td style="padding: 1rem; border-bottom: 1px solid var(--border-glass); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <a href="${m.media_url}" target="_blank" style="color: #38bdf8;">${m.media_url}</a>
        </td>
        <td style="padding: 1rem; border-bottom: 1px solid var(--border-glass); text-align: right;">
          <button class="btn btn-delete" onclick="deleteMedia(${m.id})">Remover</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  window.deleteMedia = async function(id) {
    if (!confirm('Deseja remover esta mídia da TV?')) return;
    try {
      const res = await fetch(`/api/media/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadMedia(selectStore.value);
      }
    } catch (err) {
      alert('Erro ao excluir mídia');
    }
  }

  // --- STORE MANAGER ---
  const btnAddStore = document.getElementById('btn-add-store');
  btnAddStore.addEventListener('click', async () => {
    const id = document.getElementById('store-id').value.trim();
    const name = document.getElementById('store-name').value.trim();

    if (!id || !name) return alert('Preencha o Número e o Nome da loja');

    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ id, name })
      });
      if (!res.ok) throw new Error('Erro ao salvar loja');
      
      document.getElementById('store-id').value = '';
      document.getElementById('store-name').value = '';
      loadStoreManager();
      
      // Atualiza o select dropdown principal
      fetch('/api/stores')
        .then(r => r.json())
        .then(stores => {
          const currentVal = selectStore.value;
          selectStore.innerHTML = '<option value="" disabled selected>Selecione a Filial...</option>';
          stores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            selectStore.appendChild(opt);
          });
          selectStore.value = currentVal;
        });

    } catch (err) {
      alert(err.message);
    }
  });

  async function loadStoreManager() {
    const res = await fetch('/api/stores');
    const storeList = await res.json();
    const tbody = document.getElementById('store-list');
    tbody.innerHTML = '';
    
    storeList.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding: 1rem; border-bottom: 1px solid var(--border-glass); font-weight: bold;">${s.id}</td>
        <td style="padding: 1rem; border-bottom: 1px solid var(--border-glass);">${s.name}</td>
        <td style="padding: 1rem; border-bottom: 1px solid var(--border-glass); text-align: right;">
          <button class="btn btn-delete" onclick="deleteStore('${s.id}')">Excluir</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  window.deleteStore = async function(id) {
    if (!confirm('ATENÇÃO: Deseja realmente excluir esta filial e todas as suas configurações?')) return;
    try {
      const res = await fetch(`/api/stores/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        loadStoreManager();
      } else {
        const data = await res.json();
        alert(data.error || 'Erro ao excluir filial');
      }
    } catch (err) {
      alert('Erro ao excluir filial');
    }
  }

  function renderCharts(data) {
    const { callsBySector, callsByHour } = data;
    
    // KPI Total
    const totalCalls = callsBySector.reduce((sum, item) => sum + item.count, 0);
    kpiTotal.textContent = totalCalls;

    // KPI Pico
    if (callsByHour.length > 0) {
      const peak = callsByHour.reduce((prev, current) => (prev.count > current.count) ? prev : current);
      kpiPeak.textContent = `${peak.hour}h`;
    } else {
      kpiPeak.textContent = '--:--';
    }

    // Colors
    const colors = ['#38bdf8', '#fbbf24', '#a855f7', '#f43f5e', '#22c55e', '#f97316'];

    // Chart Setor
    const ctxSector = document.getElementById('sectorChart').getContext('2d');
    if (sectorChartInst) sectorChartInst.destroy();
    sectorChartInst = new Chart(ctxSector, {
      type: 'doughnut',
      data: {
        labels: callsBySector.map(s => s.sector.toUpperCase()),
        datasets: [{
          data: callsBySector.map(s => s.count),
          backgroundColor: colors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#cbd5e1' } }
        }
      }
    });

    // Chart Hora
    const ctxHour = document.getElementById('hourChart').getContext('2d');
    if (hourChartInst) hourChartInst.destroy();
    hourChartInst = new Chart(ctxHour, {
      type: 'bar',
      data: {
        labels: callsByHour.map(h => `${h.hour}h`),
        datasets: [{
          label: 'Chamadas',
          data: callsByHour.map(h => h.count),
          backgroundColor: 'rgba(56, 189, 248, 0.8)',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#cbd5e1' } },
          x: { grid: { display: false }, ticks: { color: '#cbd5e1' } }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
});
