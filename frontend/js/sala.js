// sala.js — Sala privada com Gugu (chat 1:1)
(function () {
  'use strict';
  if (window.__SALA_LOADED__) return;
  window.__SALA_LOADED__ = true;

  const messagesEl = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send');
  const broadcastBtn = document.getElementById('btn-broadcast');

  if (!messagesEl || !inputEl) return;

  const username = 'Sala-' + Math.floor(Math.random() * 9999);
  let lastGuguResponse = '';
  let canBroadcast = false;

  // Mensagem inicial do Gugu
  addMessage({
    id: 'init',
    user: 'Gugu',
    text: 'Boa noite, criatura da madrugada. Chegou na sala certa. Fala baixo, aqui ninguém escuta.',
    isHermes: true,
    createdAt: new Date().toISOString()
  }, false);

  // === Envio ===
  function send() {
    const text = inputEl.value.trim();
    if (!text) return;
    addMessage({
      id: 'u-' + Date.now(),
      user: username,
      text: text,
      isHermes: false,
      createdAt: new Date().toISOString()
    }, true);
    inputEl.value = '';
    inputEl.disabled = true;
    sendBtn.disabled = true;

    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'msg msg-hermes msg-enter';
    typing.id = 'typing-indicator';
    typing.innerHTML = `
      <div class="msg-avatar">🎙️</div>
      <div class="msg-body">
        <div class="msg-meta"><strong>Gugu</strong><span class="msg-time">digitando...</span></div>
        <div class="msg-text">▌</div>
      </div>
    `;
    messagesEl.appendChild(typing);
    scrollDown();

    fetch('/api/sala/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, text })
    }).then(r => r.json()).then(data => {
      const ti = document.getElementById('typing-indicator');
      if (ti) ti.remove();
      addMessage({
        id: 'h-' + Date.now(),
        user: 'Gugu',
        text: data.resposta || 'Tô com interferência na biblioteca, criatura. Tenta de novo.',
        isHermes: true,
        createdAt: new Date().toISOString()
      }, true);
      lastGuguResponse = data.resposta || '';
      canBroadcast = !!data.pode_enviar_para_radio;
      if (broadcastBtn) broadcastBtn.disabled = !canBroadcast;
    }).catch(() => {
      const ti = document.getElementById('typing-indicator');
      if (ti) ti.remove();
      addMessage({
        id: 'e-' + Date.now(),
        user: 'Sistema',
        text: '❌ Rede caiu. Tenta de novo.',
        isHermes: true,
        createdAt: new Date().toISOString()
      }, true);
    }).finally(() => {
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    });
  }

  if (sendBtn) sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  // === Broadcast (sala → ar) ===
  if (broadcastBtn) {
    broadcastBtn.addEventListener('click', () => {
      if (!canBroadcast || !lastGuguResponse) return;
      broadcastBtn.disabled = true;
      broadcastBtn.textContent = '⏳ Mandando pro ar...';
      fetch('/api/sala/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, fala: lastGuguResponse })
      }).then(r => r.json()).then(data => {
        if (data.sucesso) {
          broadcastBtn.textContent = '✅ Foi pro ar!';
          setTimeout(() => {
            broadcastBtn.textContent = '📡 Enviar mensagem pro Ar';
            broadcastBtn.disabled = !canBroadcast;
          }, 3000);
        } else {
          broadcastBtn.textContent = '❌ Falhou';
          setTimeout(() => {
            broadcastBtn.textContent = '📡 Enviar mensagem pro Ar';
            broadcastBtn.disabled = !canBroadcast;
          }, 3000);
        }
      }).catch(() => {
        broadcastBtn.textContent = '❌ Rede caiu';
        setTimeout(() => {
          broadcastBtn.textContent = '📡 Enviar mensagem pro Ar';
          broadcastBtn.disabled = !canBroadcast;
        }, 3000);
      });
    });
  }

  // === Render helpers ===
  function addMessage(msg, animate) {
    const div = document.createElement('div');
    div.className = 'msg' + (msg.isHermes ? ' msg-hermes' : ' msg-user') + (animate ? ' msg-enter' : '');
    div.setAttribute('data-msg-id', msg.id);
    const time = new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      <div class="msg-avatar">${msg.isHermes ? '🎙️' : '👤'}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <strong>${escapeHtml(msg.user || 'Anônimo')}</strong>
          <span class="msg-time">${time}</span>
        </div>
        <div class="msg-text">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
      </div>
    `;
    messagesEl.appendChild(div);
    scrollDown();
  }

  function scrollDown() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  inputEl.focus();
})();
