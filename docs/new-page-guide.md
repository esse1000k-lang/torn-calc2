# 새 페이지 만들 때 체크리스트

앞으로 추가하는 모든 HTML 페이지에서 **공통 네비(고정 네비 + 로그인/관리자 메뉴)** 가 적용되도록 아래를 따른다.

## 1. head에 CSS

```html
<link rel="stylesheet" href="css/site.css">
```

- 고정 네비와 `body` padding-top은 `site.css`에 이미 정의되어 있음.

## 2. body 직후에 공통 네비

`<body>` 다음에 아래 블록을 **그대로** 넣는다.

```html
<nav class="site-nav">
  <div class="nav-brand">
    <a href="/" class="nav-logo">TornFi</a>
  </div>
  <a href="/admin.html" class="nav-admin-center" id="navAdminCenter" aria-label="관리자" style="display:none;">🛠️</a>
  <div class="nav-menu-wrap">
    <button type="button" class="nav-menu-btn" id="navMenuBtn" aria-label="메뉴" aria-expanded="false" aria-haspopup="true">☰</button>
    <div class="nav-menu-dropdown" id="navMenuDropdown" role="menu">
      <a href="/login.html" id="navLogin" role="menuitem" style="display:none;">로그인</a>
      <a href="/register.html" id="navRegister" role="menuitem" style="display:none;">회원가입</a>
      <div class="nav-menu-user" id="navMenuUser" style="display:none;">
        <a href="/profile.html" id="navProfile" role="menuitem">내 정보</a>
        <button type="button" id="navLogout" role="menuitem">로그아웃</button>
      </div>
    </div>
  </div>
</nav>
```

## 3. 스크립트 (로그인/관리자 메뉴 노출이 필요한 경우)

페이지 스크립트 전에 로드:

```html
<script src="js/auth.js"></script>
<script src="js/nav-logo.js"></script>
```

페이지 스크립트 안에서 (예: IIFE 맨 앞):

```javascript
var navLogin = document.getElementById('navLogin');
var navRegister = document.getElementById('navRegister');
var navProfile = document.getElementById('navProfile');
var navMenuUser = document.getElementById('navMenuUser');
var navAdminCenter = document.getElementById('navAdminCenter');
var navMenuBtn = document.getElementById('navMenuBtn');
var navMenuDropdown = document.getElementById('navMenuDropdown');
var navLogout = document.getElementById('navLogout');

function updateNav(user) {
  if (user) {
    if (navLogin) navLogin.style.display = 'none';
    if (navRegister) navRegister.style.display = 'none';
    if (navMenuUser) navMenuUser.style.display = 'block';
    if (navProfile) navProfile.style.display = 'block';
    if (navAdminCenter) navAdminCenter.style.display = user.isAdmin ? 'inline-flex' : 'none';
  } else {
    if (navLogin) navLogin.style.display = 'block';
    if (navRegister) navRegister.style.display = 'block';
    if (navMenuUser) navMenuUser.style.display = 'none';
    if (navProfile) navProfile.style.display = 'none';
    if (navAdminCenter) navAdminCenter.style.display = 'none';
  }
}

if (window.TornFiAuth) {
  window.TornFiAuth.onUser(updateNav);
  if (window.TornFiAuth.getUser()) updateNav(window.TornFiAuth.getUser());
  else window.TornFiAuth.init().then(function () { updateNav(window.TornFiAuth.getUser()); });
}

if (navMenuBtn && navMenuDropdown) {
  navMenuBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    navMenuDropdown.classList.toggle('is-open');
    navMenuBtn.setAttribute('aria-expanded', navMenuDropdown.classList.contains('is-open'));
  });
  navMenuDropdown.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('click', function () {
    navMenuDropdown.classList.remove('is-open');
    navMenuBtn.setAttribute('aria-expanded', 'false');
  });
}

if (navLogout) navLogout.addEventListener('click', function (e) {
  e.preventDefault();
  if (!confirm('로그아웃 하시겠습니까?')) return;
  if (window.TornFiAuth && window.TornFiAuth.logout) {
    window.TornFiAuth.logout().then(function () { updateNav(null); window.location.href = '/'; });
  }
});
```

## 참고할 기존 페이지

- `public/board.html` – 공통 네비 + updateNav
- `public/tornado-news.html` – 동일 패턴
- `public/calculator.html` – site.css 도입 + 네비 추가 예시

이렇게 하면 **앞으로 만드는 모든 페이지**에 고정 네비와 로그인/관리자 메뉴가 동일하게 적용된다.
