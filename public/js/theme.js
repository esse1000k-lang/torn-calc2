/* Theme toggle with BroadcastChannel cross-tab sync */
(function(){
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  let channel;
  try { channel = new BroadcastChannel('torn_theme_channel'); } catch(e){}
  function isLight() { return document.body.classList.contains('theme-light'); }
  function setMetaColor() { if (metaTheme) metaTheme.setAttribute('content', isLight() ? '#ffffff' : '#0a0a0b'); }
  function renderIcon() {
    if (isLight()) {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" fill="currentColor" /></svg>';
    } else {
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor" /><g stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" /></g></svg>';
    }
  }
  function applyTheme(light) {
    if (light) document.body.classList.add('theme-light'); else document.body.classList.remove('theme-light');
    try { localStorage.setItem('torn_theme', light ? 'light' : 'dark'); } catch(e){}
    setMetaColor(); renderIcon();
    if (channel) channel.postMessage({ type: 'theme_changed', light: light });
  }
  function toggleTheme() { applyTheme(!isLight()); }
  if (channel) channel.onmessage = function(e) { if (e.data && e.data.type === 'theme_changed') { var light = e.data.light; if (light) document.body.classList.add('theme-light'); else document.body.classList.remove('theme-light'); setMetaColor(); renderIcon(); } };
  btn.addEventListener('click', toggleTheme);
  renderIcon(); setMetaColor();
})();
