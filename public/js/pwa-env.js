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

  // Apply saved theme preference (light/dark)
  try {
    var saved = localStorage.getItem('torn_theme');
    if (saved === 'light') {
      document.body.classList.add('theme-light');
      if (metaTheme) metaTheme.setAttribute('content', '#ffffff');
    } else {
      document.body.classList.remove('theme-light');
      if (metaTheme) metaTheme.setAttribute('content', '#0a0a0b');
    }
  } catch (e) {
    // ignore
  }

  function setViewportHeight() {
    doc.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
  }
  setViewportHeight();
  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', function () { setTimeout(setViewportHeight, 100); });
})();

// Generate light-theme CSS variable overrides from current :root values.
(function () {
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function hexToRgb(hex) {
    if (!hex) return null;
    hex = hex.trim();
    if (hex.startsWith('rgb')) {
      const m = hex.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map(p => parseFloat(p.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] }; 
    }
    if (hex[0] === '#') hex = hex.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length !== 6) return null;
    const r = parseInt(hex.slice(0,2),16);
    const g = parseInt(hex.slice(2,4),16);
    const b = parseInt(hex.slice(4,6),16);
    return { r, g, b };
  }
  function rgbToHex(c) { return '#' + [c.r, c.g, c.b].map(v=>clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join(''); }
  function mix(a, b, t) { return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }; }

  var root = document.documentElement;
  var computed = getComputedStyle(root);
  var vars = [
    '--bg-dark','--bg-card','--border','--neon','--neon-dim','--neon-glow','--text','--text-muted','--danger'
  ];

  var white = { r:255,g:255,b:255 };
  var black = { r:0,g:0,b:0 };

  var mapping = {
    '--bg-dark': { target: white, t: 0.96 },
    '--bg-card': { target: white, t: 0.94 },
    '--border': { target: white, t: 0.88 },
    '--neon': { target: {r:11,g:122,b:63}, t: 0.45 },
    '--neon-dim': { target: {r:10,g:107,b:54}, t: 0.45 },
    '--neon-glow': { target: null, t: null },
    '--text': { target: black, t: 0.9 },
    '--text-muted': { target: black, t: 0.7 },
    '--danger': { target: null, t: null }
  };

  function buildLightVars() {
    var lines = [];
    vars.forEach(function(v){
      var raw = computed.getPropertyValue(v) || '';
      raw = raw.trim();
      var m = mapping[v];
      if (!raw) return;
      var rgb = hexToRgb(raw) || null;
      if (!rgb) {
        // If value is rgba(...) or non-hex, try to keep as-is for glow values
        if (m && m.target == null) {
          lines.push(v + ': ' + raw + ';');
        }
        return;
      }
      if (m && m.target) {
        var mixed = mix(rgb, m.target, m.t);
        lines.push(v + ': ' + rgbToHex(mixed) + ';');
      } else if (v === '--neon-glow') {
        // reduce alpha for glow in light mode
        var glow = raw.replace(/rgba?\(([^)]+)\)/, function(_, g){
          var parts = g.split(',').map(s=>s.trim());
          var r = parseInt(parts[0]), gr = parseInt(parts[1]), b = parseInt(parts[2]);
          var a = parts[3] ? parseFloat(parts[3]) : 1;
          var na = Math.max(0.06, a * 0.35);
          return 'rgba(' + r + ',' + gr + ',' + b + ',' + na + ')';
        });
        lines.push(v + ': ' + glow + ';');
      } else {
        // fallback: blend towards white
        var mixed = mix(rgb, white, 0.9);
        lines.push(v + ': ' + rgbToHex(mixed) + ';');
      }
    });
    return lines.join('\n');
  }

  function injectLightStyle() {
    var id = 'generated-theme-light-vars';
    var existing = document.getElementById(id);
    var css = 'body.theme-light {\n' + buildLightVars() + '\n}';
    if (existing) {
      existing.textContent = css;
    } else {
      var style = document.createElement('style');
      style.id = id;
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  // generate on load and whenever theme is toggled via localStorage
  try { injectLightStyle(); } catch(e){}
  window.addEventListener('storage', function (e) {
    if (e.key === 'torn_theme') injectLightStyle();
  });
})();
