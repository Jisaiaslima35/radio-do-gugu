// pwa.js — Service worker register (Rádio do Gugu)
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function (reg) {
        console.info('[pwa] sw registrado, scope=', reg.scope);
      })
      .catch(function (err) {
        console.warn('[pwa] sw falhou:', err && err.message);
      });
  });
})();
