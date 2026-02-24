(function () {
  var currentUser = null;
  var listeners = [];

  function notify(user) {
    currentUser = user;
    listeners.forEach(function (fn) { fn(user); });
  }

  function fetchMe() {
    return fetch('/api/me', { credentials: 'same-origin' })
      .then(function (res) {
        return res.json().then(function (data) {
          if (res.ok && data.ok && data.user) {
            notify(data.user);
            return data.user;
          }
          // 401 또는 세션 없음: 서버 재시작 등으로 세션 만료
          notify(null);
          return null;
        });
      })
      .catch(function () {
        // 네트워크 오류(서버 다운 등) 시 로그아웃 상태로 표시
        notify(null);
        return null;
      });
  }

  window.TornFiAuth = {
    onUser: function (fn) {
      listeners.push(fn);
      if (currentUser !== undefined) fn(currentUser);
    },
    getUser: function () { return currentUser; },
    init: function () {
      return fetchMe();
    },
    login: function (loginId, password) {
      return fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: loginId, password: password }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            notify(data.user);
            return data;
          }
          return Promise.reject(data);
        });
    },
    register: function (walletAddress, password, displayName, referrer) {
      return fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          walletAddress: walletAddress || undefined,
          password: password,
          displayName: displayName || undefined,
          referrer: referrer || undefined,
        }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            return data;
          }
          return Promise.reject(data);
        });
    },
    logout: function () {
      return fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { notify(null); });
    },
  };

  TornFiAuth.init();

  // 서버 재시작/다운 시 자동 로그아웃: 주기적으로 세션 유효성 확인
  var SESSION_CHECK_INTERVAL_MS = 60 * 1000;
  setInterval(function () {
    fetchMe();
  }, SESSION_CHECK_INTERVAL_MS);
})();
