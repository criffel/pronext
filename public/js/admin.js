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

  // Carrega lojas
  fetch('/api/config')
    .then(res => res.json())
    .then(config => {
      selectStore.innerHTML = '<option value="" disabled selected>Selecione a Filial...</option>';
      for (const key in config.stores) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = config.stores[key].name;
        selectStore.appendChild(opt);
      }
    });

  btnLogin.addEventListener('click', loadDashboard);
  selectStore.addEventListener('change', () => {
    if (dashboardContent.style.display !== 'none') {
      loadDashboard();
    }
  });

  function loadDashboard() {
    const store = selectStore.value;
    const apiKey = inputApiKey.value.trim();

    if (!store) return alert('Selecione uma filial.');
    if (!apiKey) return alert('Digite a chave administrativa.');

    fetch(`/api/stats?store=${store}`, {
      headers: {
        'x-api-key': apiKey
      }
    })
    .then(res => {
      if (!res.ok) throw new Error('Acesso Negado ou Erro no Servidor');
      return res.json();
    })
    .then(data => {
      authBlock.style.display = 'none';
      dashboardContent.style.display = 'block';
      renderCharts(data);
    })
    .catch(err => {
      alert(err.message);
    });
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
