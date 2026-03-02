(function () {
  var navMenuBtn = document.getElementById('navMenuBtn');
  var navMenuDropdown = document.getElementById('navMenuDropdown');
  var navMenuWrap = navMenuBtn && navMenuBtn.closest('.nav-menu-wrap');
  var navMenuLogin = document.getElementById('navMenuLogin');
  var navMenuRegister = document.getElementById('navMenuRegister');
  var navMenuProfile = document.getElementById('navMenuProfile');
  var navMenuAdmin = document.getElementById('navMenuAdmin');
  var navMenuLogout = document.getElementById('navMenuLogout');
  var mobileHomeLogin = document.getElementById('mobileHomeLogin');
  var mobileHomeRegister = document.getElementById('mobileHomeRegister');
  var mobileHomeProfile = document.getElementById('mobileHomeProfile');
  var logoutConfirmLayer = document.getElementById('logoutConfirmLayer');
  var logoutConfirmCancel = document.getElementById('logoutConfirmCancel');
  var logoutConfirmOk = document.getElementById('logoutConfirmOk');

  function closeNavMenu() {
    if (navMenuWrap) navMenuWrap.classList.remove('is-open');
    if (navMenuBtn) navMenuBtn.setAttribute('aria-expanded', 'false');
    if (navMenuDropdown) navMenuDropdown.setAttribute('aria-hidden', 'true');
  }

  function updateNav(user) {
    if (user) {
      if (navMenuLogin) navMenuLogin.classList.add('nav-menu-dropdown__item--hidden');
      if (navMenuRegister) navMenuRegister.classList.add('nav-menu-dropdown__item--hidden');
      if (navMenuProfile) navMenuProfile.classList.remove('nav-menu-dropdown__item--hidden');
      if (navMenuAdmin) navMenuAdmin.classList.toggle('nav-menu-dropdown__item--hidden', !user.isAdmin);
      if (navMenuLogout) navMenuLogout.classList.remove('nav-menu-dropdown__item--hidden');
      if (mobileHomeLogin) mobileHomeLogin.style.display = 'none';
      if (mobileHomeRegister) mobileHomeRegister.style.display = 'none';
      if (mobileHomeProfile) mobileHomeProfile.style.display = 'block';
    } else {
      if (navMenuLogin) navMenuLogin.classList.remove('nav-menu-dropdown__item--hidden');
      if (navMenuRegister) navMenuRegister.classList.remove('nav-menu-dropdown__item--hidden');
      if (navMenuProfile) navMenuProfile.classList.add('nav-menu-dropdown__item--hidden');
      if (navMenuAdmin) navMenuAdmin.classList.add('nav-menu-dropdown__item--hidden');
      if (navMenuLogout) navMenuLogout.classList.add('nav-menu-dropdown__item--hidden');
      if (mobileHomeLogin) mobileHomeLogin.style.display = 'block';
      if (mobileHomeRegister) mobileHomeRegister.style.display = 'block';
      if (mobileHomeProfile) mobileHomeProfile.style.display = 'none';
    }
  }

  if (navMenuBtn && navMenuDropdown) {
    navMenuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = navMenuWrap.classList.toggle('is-open');
      navMenuBtn.setAttribute('aria-expanded', open);
      navMenuDropdown.setAttribute('aria-hidden', !open);
    });
  }
  document.addEventListener('click', function (e) {
    if (navMenuWrap && navMenuDropdown && !navMenuWrap.contains(e.target)) closeNavMenu();
  });

  if (window.TornFiAuth && window.TornFiAuth.onUser) {
    window.TornFiAuth.onUser(updateNav);
  }

  if (navMenuLogout) {
    navMenuLogout.addEventListener('click', function () {
      closeNavMenu();
      if (logoutConfirmLayer) logoutConfirmLayer.style.display = 'flex';
    });
  }
  if (logoutConfirmCancel) logoutConfirmCancel.addEventListener('click', function () { if (logoutConfirmLayer) logoutConfirmLayer.style.display = 'none'; });
  if (logoutConfirmOk) logoutConfirmOk.addEventListener('click', function () {
    if (logoutConfirmLayer) logoutConfirmLayer.style.display = 'none';
    if (window.TornFiAuth && window.TornFiAuth.logout) {
      window.TornFiAuth.logout().then(function () { updateNav(null); window.location.href = '/'; });
    }
  });
  if (logoutConfirmLayer && logoutConfirmLayer.querySelector('.logout-confirm-backdrop')) {
    logoutConfirmLayer.querySelector('.logout-confirm-backdrop').addEventListener('click', function () { logoutConfirmLayer.style.display = 'none'; });
  }
})();
