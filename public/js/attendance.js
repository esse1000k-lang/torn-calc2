(function () {
  var todayLabel = document.getElementById('attendanceTodayLabel');
  var streakCount = document.getElementById('attendanceStreakCount');
  var streakWrap = document.getElementById('attendanceStreakWrap');
  var btn = document.getElementById('attendanceBtn');
  var hint = document.getElementById('attendanceHint');
  var leaderboard = document.getElementById('attendanceLeaderboard');
  var leaderboardEmpty = document.getElementById('attendanceLeaderboardEmpty');
  var calGrid = document.getElementById('attendanceCalGrid');
  var calMonth = document.getElementById('attendanceCalMonth');
  var calPrev = document.getElementById('attendanceCalPrev');
  var calNext = document.getElementById('attendanceCalNext');

  var attendanceHistory = [];
  var todayYMD = '';
  var viewYear = 0;
  var viewMonth = 0;

  function formatDate(str) {
    if (!str) return '';
    var d = new Date(str + 'T12:00:00Z');
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function toYMD(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  function renderCalendar() {
    if (!calGrid || !calMonth) return;
    var first = new Date(viewYear, viewMonth, 1);
    var last = new Date(viewYear, viewMonth + 1, 0);
    var startDay = first.getDay();
    var daysInMonth = last.getDate();
    var prevTail = new Date(viewYear, viewMonth, 0);
    var prevDays = prevTail.getDate();
    calMonth.textContent = viewYear + '년 ' + (viewMonth + 1) + '월';

    var cells = [];
    var i;
    for (i = 0; i < startDay; i++) {
      var d = prevDays - startDay + i + 1;
      cells.push({ day: d, other: true, date: new Date(viewYear, viewMonth - 1, d) });
    }
    for (i = 1; i <= daysInMonth; i++) {
      cells.push({ day: i, other: false, date: new Date(viewYear, viewMonth, i) });
    }
    var rest = 7 - (cells.length % 7);
    if (rest < 7) for (i = 1; i <= rest; i++) cells.push({ day: i, other: true, date: new Date(viewYear, viewMonth + 1, i) });

    calGrid.innerHTML = '';
    cells.forEach(function (cell) {
      var ymd = toYMD(cell.date);
      var isToday = ymd === todayYMD;
      var checked = attendanceHistory.indexOf(ymd) !== -1;
      var span = document.createElement('span');
      span.className = 'attendance-calendar__cell';
      if (cell.other) span.classList.add('attendance-calendar__cell--other');
      if (checked) span.classList.add('attendance-calendar__cell--checked');
      if (isToday) span.classList.add('attendance-calendar__cell--today');
      span.textContent = cell.day;
      span.setAttribute('data-date', ymd);
      calGrid.appendChild(span);
    });
  }

  function setViewMonth(y, m) {
    viewYear = y;
    viewMonth = m;
    renderCalendar();
  }

  function load() {
    fetch('/api/attendance', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) return;
        todayYMD = data.today || toYMD(new Date());
        attendanceHistory = Array.isArray(data.attendanceHistory) ? data.attendanceHistory : [];

        if (todayLabel) todayLabel.textContent = formatDate(data.today) || data.today;
        if (streakCount) streakCount.textContent = data.streak || 0;
        if (streakWrap) streakWrap.style.visibility = data.streak > 0 ? 'visible' : 'hidden';

        var user = window.TornFiAuth && window.TornFiAuth.getUser();
        if (!user || !user.id) {
          if (btn) { btn.textContent = '오늘 출석하기'; btn.disabled = true; btn.classList.remove('attendance-btn--done'); }
          if (hint) hint.textContent = '로그인하면 출석할 수 있어요.';
        } else if (data.todayChecked) {
          if (btn) { btn.textContent = '오늘 출석 완료 ✓'; btn.disabled = true; btn.classList.add('attendance-btn--done'); }
          if (hint) hint.textContent = '내 하트 ' + (data.myHearts || 0) + '개 · 내일 또 만나요!';
        } else {
          if (btn) { btn.textContent = '오늘 출석하기'; btn.disabled = false; btn.classList.remove('attendance-btn--done'); }
          if (hint) hint.textContent = '눌러서 하트 1개 받기' + (data.streak >= 6 ? ' (+ 보너스 준비됐어요!)' : '');
        }

        var now = new Date();
        if (!viewYear && !viewMonth) setViewMonth(now.getFullYear(), now.getMonth());
        else renderCalendar();

        var list = data.leaderboard || [];
        if (leaderboard && leaderboardEmpty) {
          leaderboardEmpty.style.display = list.length > 0 ? 'none' : 'block';
          var existing = leaderboard.querySelectorAll('li:not(#attendanceLeaderboardEmpty)');
          existing.forEach(function (el) { el.remove(); });
          list.forEach(function (item, i) {
            var li = document.createElement('li');
            li.innerHTML = '<span class="attendance-billboard__rank">' + (i + 1) + '</span><span class="attendance-billboard__name">' + escapeHtml(item.displayName) + '</span><span class="attendance-billboard__streak">연속 <strong>' + item.streak + '</strong>일</span>';
            leaderboard.appendChild(li);
          });
        }
      })
      .catch(function () {});
  }

  if (calPrev) calPrev.addEventListener('click', function () {
    if (viewMonth === 0) setViewMonth(viewYear - 1, 11);
    else setViewMonth(viewYear, viewMonth - 1);
  });
  if (calNext) calNext.addEventListener('click', function () {
    if (viewMonth === 11) setViewMonth(viewYear + 1, 0);
    else setViewMonth(viewYear, viewMonth + 1);
  });

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  if (btn) {
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      fetch('/api/attendance', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            var granted = data.granted || 1;
            var pop = document.createElement('div');
            pop.className = 'attendance-heart-pop';
            pop.setAttribute('aria-live', 'polite');
            pop.textContent = '\u2764\uFE0F +' + granted;
            document.body.appendChild(pop);
            pop.offsetHeight;
            pop.classList.add('is-active');
            setTimeout(function () {
              if (pop.parentNode) pop.parentNode.removeChild(pop);
            }, 2000);

            btn.textContent = '오늘 출석 완료 ✓';
            btn.classList.add('attendance-btn--done');
            if (hint) hint.textContent = (data.message || '') + ' · 내 하트 ' + (data.myHearts || 0) + '개';
            load();
          } else {
            btn.disabled = false;
            if (data.message) alert(data.message);
          }
        })
        .catch(function () { btn.disabled = false; });
    });
  }

  load();
})();
