/**
 * PWA 환경 감지: 표시 모드(standalone/browser), 뷰포트 높이(--vh) 적용
 */
(function () {
  var doc = document.documentElement;
  var metaTheme = document.querySelector('meta[name="theme-color"]');

  function isStandalone() {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
    if (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
    return false;
  }

  if (isStandalone()) {
    doc.classList.add('pwa-standalone');
    doc.classList.remove('pwa-browser');
    if (metaTheme) metaTheme.setAttribute('content', '#0a0a0b');
  } else {
    doc.classList.add('pwa-browser');
    doc.classList.remove('pwa-standalone');
  }

  function setViewportHeight() {
    doc.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  }
  setViewportHeight();
  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', function () { setTimeout(setViewportHeight, 100); });
})();
