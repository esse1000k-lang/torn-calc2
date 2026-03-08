(function setupAdminGate() {
  const FP_KEY = 'insights-fp-raw';
  const form = document.getElementById('adminLoginForm');
  const keyInput = document.getElementById('adminMasterKey');
  const msg = document.getElementById('adminLoginMsg');
  const out = document.getElementById('adminNewKey');
  const regenBtn = document.getElementById('adminRegenerateKey');
  const onBtn = document.getElementById('adminEmergencyOn');
  const offBtn = document.getElementById('adminEmergencyOff');

  function ensureRaw(key) {
    let v = localStorage.getItem(key);
    if (!v) {
      v = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(key, v);
    }
    return v;
  }

  function headers() {
    return {
      'Content-Type': 'application/json',
      'x-device-fingerprint': ensureRaw(FP_KEY),
      'x-client-token': ensureRaw('insights-token-raw'),
    };
  }

  function call(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const masterKey = (keyInput.value || '').trim();
    if (!masterKey) return;
    call('/api/admin/login', { masterKey }).then(function (d) {
      if (!d.ok) {
        msg.textContent = d.message || '로그인 실패';
        return;
      }
      msg.textContent = '로그인 성공';
    });
  });

  regenBtn.addEventListener('click', function () {
    call('/api/admin/master-key/regenerate').then(function (d) {
      if (!d.ok) {
        out.textContent = d.message || '갱신 실패';
        return;
      }
      out.textContent = d.key;
      navigator.clipboard.writeText(d.key).catch(function () {});
    });
  });

  onBtn.addEventListener('click', function () {
    call('/api/admin/emergency-lock', { enabled: true }).then(function (d) {
      msg.textContent = d.ok ? 'Emergency Lock ON' : '실패';
    });
  });

  offBtn.addEventListener('click', function () {
    call('/api/admin/emergency-lock', { enabled: false }).then(function (d) {
      msg.textContent = d.ok ? 'Emergency Lock OFF' : '실패';
    });
  });
})();
