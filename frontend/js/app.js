// app.js — Rádio do Gugu: Mural + Catálogo + Conto + Fila + Tabs
(function () {
  'use strict';
  if (window.__APP_LOADED__) return;
  window.__APP_LOADED__ = true;

  // === SOCKET.IO ===
  const socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => console.info('[gugu] conectado', socket.id));
  socket.on('disconnect', () => console.warn('[gugu] desconectado'));

  // === ABAS (tabs SPA) ===
  function ativarTab(nome) {
    document.querySelectorAll('.tab').forEach(t => {
      const ativo = t.dataset.tab === nome;
      t.classList.toggle('active', ativo);
      t.setAttribute('aria-selected', ativo ? 'true' : 'false');
    });
    document.querySelectorAll('.tabs').forEach(s => s.classList.remove('active'));
    const tab = document.getElementById('tab-' + nome);
    if (tab) tab.classList.add('active');
    try { localStorage.setItem('gugu_tab', nome); } catch (e) {}
    if (nome === 'musica') carregarCatalogo();
    if (nome === 'status') carregarFila();
  }

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab) ativarTab(tab);
    });
  });

  // Restaura última aba (ou query ?tab=musica)
  const params = new URLSearchParams(location.search);
  const initialTab = params.get('tab') || localStorage.getItem('gugu_tab') || 'mural';
  ativarTab(initialTab);

  // === MURAL PÚBLICO ===
  const muralForm = document.getElementById('mural-form');
  const muralCards = document.getElementById('mural-cards');

  function renderMural(list) {
    if (!muralCards) return;
    if (!list || list.length === 0) {
      muralCards.innerHTML = '<div class="empty-state">Nenhum pedido ainda. Sê o primeiro a gritar no escuro.</div>';
      return;
    }
    muralCards.innerHTML = list.map(o => `
      <div class="mural-card ${o.ehConto ? 'eh-conto' : ''}">
        <div class="mural-card-header">
          <strong>${o.ehConto ? '📖' : '🎵'} ${escapeHtml(o.nome)}</strong>
          <small>${formatDate(o.criadaEm)}</small>
        </div>
        <p>${escapeHtml(o.pedido)}</p>
      </div>
    `).join('');
  }

  function carregarMural() {
    fetch('/api/oracoes').then(r => r.json()).then(data => renderMural(data.recentes || [])).catch(() => {});
  }

  socket.on('oracao-nova', (o) => {
    if (!muralCards) return;
    const empty = muralCards.querySelector('.empty-state');
    if (empty) empty.remove();
    const div = document.createElement('div');
    div.className = 'mural-card ' + (o.ehConto ? 'eh-conto' : '');
    div.innerHTML = `
      <div class="mural-card-header">
        <strong>${o.ehConto ? '📖' : '🎵'} ${escapeHtml(o.nome)}</strong>
        <small>agora</small>
      </div>
      <p>${escapeHtml(o.pedido)}</p>
    `;
    muralCards.prepend(div);
  });

  if (muralForm) {
    muralForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nome = document.getElementById('mural-nome').value.trim();
      const pedido = document.getElementById('mural-pedido').value.trim();
      if (!nome || !pedido) return;
      const btn = muralForm.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = '⏳ Enviando...';
      fetch('/api/oracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, pedido })
      }).then(r => r.json()).then(data => {
        if (data.sucesso) {
          muralForm.reset();
          toast(data.oracao.ehConto ? '📖 Conto vai ao ar...' : '🎵 Brega vai ao ar!', 'success');
        } else {
          toast(data.erro || 'Falha ao enviar', 'error');
        }
      }).catch(() => toast('Falha de rede', 'error'))
        .finally(() => {
          btn.disabled = false;
          btn.textContent = '📡 Manda pro Ar';
        });
    });
    carregarMural();
  }

  // === CATÁLOGO DE MÚSICAS ===
  let catalogoCarregado = false;
  function carregarCatalogo() {
    if (catalogoCarregado) return;
    catalogoCarregado = true;
    const info = document.getElementById('catalogo-info');
    const grid = document.getElementById('catalogo-grid');
    if (!grid) return;
    fetch('/api/catalogo').then(r => r.json()).then(data => {
      if (info) info.remove();
      if (!data.faixas || data.faixas.length === 0) {
        grid.innerHTML = '<div class="catalogo-empty">Catálogo vazio. Mande MP3s pra /root/radio-gugu-music/musicas/</div>';
        return;
      }
      grid.innerHTML = data.faixas.map(f => `
        <div class="catalogo-item">
          <div class="catalogo-info">
            <div class="catalogo-titulo">${escapeHtml(f.titulo)}</div>
            ${f.artista ? `<div class="catalogo-artista">${escapeHtml(f.artista)}</div>` : ''}
          </div>
          <button class="catalogo-btn" data-titulo="${escapeAttr(f.titulo)}" data-artista="${escapeAttr(f.artista || '')}">Pedir</button>
        </div>
      `).join('');
      grid.querySelectorAll('.catalogo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const titulo = btn.dataset.titulo;
          const artista = btn.dataset.artista;
          const musica = artista ? `${titulo} - ${artista}` : titulo;
          // Preenche o mural e muda pra aba mural
          document.getElementById('mural-nome').value = 'Web-Ouvinte';
          document.getElementById('mural-pedido').value = 'Toca ' + musica;
          ativarTab('mural');
          toast('Pedido pronto. Confirma no Mural.', 'success');
        });
      });
    }).catch(() => {
      if (info) info.textContent = 'Erro carregando catálogo';
    });
  }

  // === PEDIDO CONTO ===
  const contoForm = document.getElementById('conto-form');
  const contoResposta = document.getElementById('conto-resposta');

  document.querySelectorAll('.sugestao-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('conto-pedido').value = 'Quero ouvir: ' + chip.dataset.conto;
    });
  });

  if (contoForm) {
    contoForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pedido = document.getElementById('conto-pedido').value.trim();
      if (!pedido) return;
      const btn = contoForm.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = '⏳ Gugu tá pensando...';
      contoResposta.innerHTML = '<div class="conto-resposta">🕯️ O Gugu tá vasculhando os porões da memória...</div>';

      fetch('/api/oracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: 'Conto-Pedido', pedido: pedido })
      }).then(r => r.json()).then(data => {
        if (data.sucesso) {
          contoResposta.innerHTML = `<div class="conto-resposta"><strong>🎙️ Gugu:</strong><br>${escapeHtml(data.oracao.fala)}</div>`;
          toast('📖 Conto mandado pro ar', 'success');
          contoForm.reset();
        } else {
          contoResposta.innerHTML = `<div class="conto-resposta" style="border-color:var(--red-glow)">� ${escapeHtml(data.erro || 'Falhou')}</div>`;
        }
      }).catch(() => {
        contoResposta.innerHTML = '<div class="conto-resposta" style="border-color:var(--red-glow)">❌ Rede caiu. Tenta de novo.</div>';
      }).finally(() => {
        btn.disabled = false;
        btn.textContent = '📖 Narra esse Conto';
      });
    });
  }

  // === FILA / STATUS (atualiza por socket + polling) ===
  const filaItens = document.getElementById('fila-itens');
  const statProcessadas = document.getElementById('stat-processadas');
  const statTempo = document.getElementById('stat-tempo');
  const statFila = document.getElementById('stat-fila');

  function renderFila(data) {
    if (!filaItens) return;
    if (data.processando) {
      const it = data.itens && data.itens[0];
      filaItens.innerHTML = `
        <div class="fila-item">
          <div class="fila-dot"></div>
          <div class="fila-info">
            <strong>🎙️ Tocando agora</strong>
            <small>${it ? escapeHtml(it.nome || 'locução') + ' • ' + (it.duration || 'curta') : 'em andamento'}</small>
          </div>
        </div>
        ${(data.itens || []).slice(1).map(i => `
          <div class="fila-item">
            <div class="fila-dot idle"></div>
            <div class="fila-info">
              <strong>#${escapeHtml(i.id)}</strong>
              <small>${escapeHtml(i.nome || 'anônimo')} • ${escapeHtml(i.duration || 'curta')}</small>
            </div>
          </div>
        `).join('')}
        ${(!data.itens || data.itens.length === 0) ? '<div class="empty-state" style="padding:16px;margin-top:8px">Fila esvaziou.</div>' : ''}
      `;
    } else if (data.itens && data.itens.length > 0) {
      filaItens.innerHTML = data.itens.map(i => `
        <div class="fila-item">
          <div class="fila-dot idle"></div>
          <div class="fila-info">
            <strong>#${escapeHtml(i.id)}</strong>
            <small>${escapeHtml(i.nome || 'anônimo')} • ${escapeHtml(i.duration || 'curta')}</small>
          </div>
        </div>
      `).join('');
    } else {
      filaItens.innerHTML = '<div class="empty-state">Fila vazia. Pode mandar o primeiro pedido.</div>';
    }
    if (statProcessadas) statProcessadas.textContent = data.stats && data.stats.processadas || 0;
    if (statTempo) statTempo.textContent = (data.stats && data.stats.ultimoTempoSeg ? data.stats.ultimoTempoSeg + 's' : '0s');
    if (statFila) statFila.textContent = data.tamanho || 0;
  }

  function carregarFila() {
    fetch('/api/fila').then(r => r.json()).then(renderFila).catch(() => {});
  }

  socket.on('fila-status', renderFila);

  // Polling de fila a cada 10s (defesa — socket pode cair)
  setInterval(() => {
    const statusTab = document.getElementById('tab-status');
    if (statusTab && statusTab.classList.contains('active')) carregarFila();
  }, 10000);

  // === ONLINE COUNT ===
  socket.on('online-count', (n) => {
    const oc = document.getElementById('online-count');
    if (oc) oc.textContent = n;
  });

  // === UTILITÁRIOS ===
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function formatDate(d) {
    try { return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  // === TOAST ===
  function createToastEl() {
    const el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast hidden';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    return el;
  }
  function toast(msg, type) {
    const el = document.getElementById('toast') || createToastEl();
    el.textContent = msg;
    el.className = 'toast toast-' + (type || 'success');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 4000);
  }
})();
