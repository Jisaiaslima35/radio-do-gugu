// player.js — Player FULL-WIDTH + estado de UI
(function () {
  'use strict';

  var audio = document.getElementById('lp-audio');
  var btnPlay = document.getElementById('lp-play');
  var btnMute = document.getElementById('lp-mute');
  var range = document.getElementById('lp-volume');
  if (!audio || !btnPlay) return;

  var icoPlay = document.getElementById('lp-ico-play');
  var icoPause = document.getElementById('lp-ico-pause');
  var spinner = document.getElementById('lp-spinner');
  var icoVol = document.getElementById('lp-ico-vol');
  var icoMute = document.getElementById('lp-ico-mute');
  var state = document.getElementById('lp-state');
  var dot = document.getElementById('lp-dot');

  // Volume restore
  var salvo = parseInt(localStorage.getItem('gugu_vol') || '80', 10);
  if (isNaN(salvo) || salvo < 0 || salvo > 100) salvo = 80;
  audio.volume = salvo / 100;
  if (range) {
    range.value = salvo;
    pintarRange(salvo);
  }

  function pintarRange(v) {
    if (!range) return;
    range.style.background =
      'linear-gradient(90deg,#5b2a86 0%,#8b0000 ' + v + '%,rgba(255,255,255,.15) ' + v + '%,rgba(255,255,255,.15) 100%)';
  }

  function setUI(modo) {
    if (icoPlay) icoPlay.hidden = modo !== 'pause';
    if (icoPause) icoPause.hidden = modo !== 'play';
    if (spinner) spinner.hidden = modo !== 'load';
    if (dot) dot.classList.toggle('off', modo !== 'play');
    if (state) {
      state.textContent =
        modo === 'play' ? 'AO VIVO' :
        modo === 'load' ? 'CONECTANDO' :
        'PAUSADO';
    }
    if (btnPlay) btnPlay.setAttribute('aria-label', modo === 'play' ? 'Pausar rádio' : 'Tocar rádio');
  }

  var userWantsPlay = false;
  var reconnectTimer = null;
  var reconnectAttempts = 0;

  function clearReconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function togglePlay(forcarPlay) {
    if (!audio.paused && !forcarPlay) {
      userWantsPlay = false;
      clearReconnect();
      audio.pause();
      setUI('pause');
      return;
    }
    userWantsPlay = true;
    clearReconnect();
    reconnectAttempts = 0;
    setUI('load');
    audio.load();
    var p = audio.play();
    if (p && p.catch) {
      p.catch(function () {
        userWantsPlay = false;
        setUI('pause');
        if (state) state.textContent = 'TOQUE ▶';
      });
    }
  }

  if (btnPlay) btnPlay.addEventListener('click', function () { togglePlay(false); });

  audio.addEventListener('playing', function () {
    reconnectAttempts = 0;
    clearReconnect();
    if (userWantsPlay) setUI('play');
  });
  audio.addEventListener('pause', function () {
    if (!userWantsPlay) setUI('pause');
  });
  audio.addEventListener('waiting', function () {
    if (userWantsPlay) setUI('load');
  });
  audio.addEventListener('error', function () {
    if (!userWantsPlay) {
      setUI('pause');
      if (state) state.textContent = 'OFFLINE';
      return;
    }
    clearReconnect();
    if (reconnectAttempts >= 5) {
      setUI('pause');
      if (state) state.textContent = 'OFFLINE';
      return;
    }
    reconnectAttempts++;
    var delay = Math.min(15000, 1500 * reconnectAttempts);
    setUI('load');
    reconnectTimer = setTimeout(function () {
      audio.load();
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    }, delay);
  });

  if (btnMute) {
    btnMute.addEventListener('click', function () {
      audio.muted = !audio.muted;
      if (icoVol) icoVol.hidden = audio.muted;
      if (icoMute) icoMute.hidden = !audio.muted;
    });
  }

  if (range) {
    range.addEventListener('input', function () {
      var v = parseInt(range.value, 10);
      audio.volume = v / 100;
      pintarRange(v);
      localStorage.setItem('gugu_vol', String(v));
      if (v > 0 && audio.muted) {
        audio.muted = false;
        if (icoVol) icoVol.hidden = false;
        if (icoMute) icoMute.hidden = true;
      }
    });
  }

  setUI('pause');
})();
