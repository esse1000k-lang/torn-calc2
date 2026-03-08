(function setupInsightsPage() {
  const FP_KEY = 'insights-fp-raw';
  const TOKEN_KEY = 'insights-token-raw';
  const QUOTA_KEY = 'insights-quota-day';
  const boardTabs = document.getElementById('insightsBoardTabs');
  const listEl = document.getElementById('insightsList');
  const composeForm = document.getElementById('insightsCompose');
  const titleEl = document.getElementById('insightsTitle');
  const contentEl = document.getElementById('insightsContent');
  const sortEl = document.getElementById('insightsSort');
  const searchEl = document.getElementById('insightsSearch');
  const quotaEl = document.getElementById('insightsQuotaText');
  const emergencyEl = document.getElementById('insightsEmergencyText');
  let currentBoard = 'main';
  let boards = [];
  let serverTimeUtc = Date.now();

  function ensureRaw(key) {
    let v = localStorage.getItem(key);
    if (!v) {
      v = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(key, v);
    }
    return v;
  }

  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'x-device-fingerprint': ensureRaw(FP_KEY),
      'x-client-token': ensureRaw(TOKEN_KEY),
    };
  }

  function dayKeyFromServer() {
    const d = new Date(serverTimeUtc);
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  }

  function setQuotaText() {
    const raw = localStorage.getItem(QUOTA_KEY);
    let count = 0;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.day === dayKeyFromServer()) count = Number(parsed.count || 0);
      } catch {}
    }
    const remain = Math.max(0, 3 - count);
    quotaEl.textContent = `남은 작성 횟수 ●`.repeat(remain).trim() || '남은 작성 횟수 없음';
  }

  function bumpQuotaLocal() {
    const day = dayKeyFromServer();
    const raw = localStorage.getItem(QUOTA_KEY);
    let count = 0;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.day === day) count = Number(parsed.count || 0);
      } catch {}
    }
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ day, count: count + 1 }));
    setQuotaText();
  }

  function renderBoards() {
    boardTabs.innerHTML = boards.map(function (b) {
      const active = b.key === currentBoard;
      return `<button type="button" class="insights-board-tab ${active ? 'insights-board-tab--active' : ''}" data-board="${b.key}">${b.name}</button>`;
    }).join('');
  }

  function renderPosts(posts) {
    if (!posts.length) {
      listEl.innerHTML = '<p class="insights-empty">게시글이 없습니다.</p>';
      return;
    }
    listEl.innerHTML = posts.map(function (post) {
      const created = new Date(post.createdAt).toLocaleString('ko-KR');
      return `
      <article class="insights-post ${post.status === 'isolated' ? 'insights-post--isolated' : ''}" data-id="${post.id}">
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.content).replace(/\n/g, '<br>')}</p>
        <div class="insights-meta">
          <span>조회 ${post.views}</span>
          <span>오염도 ${Number(post.pollutionScore || 0).toFixed(2)}%</span>
          <span>${created}</span>
        </div>
        <div class="insights-actions">
          <button type="button" data-action="view">조회 반영</button>
          <button type="button" data-action="eval">평가</button>
          <button type="button" data-action="report">신고</button>
        </div>
      </article>`;
    }).join('');
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function fetchState() {
    return fetch('/api/insights/state').then(function (r) { return r.json(); }).then(function (d) {
      boards = Array.isArray(d.boards) ? d.boards : [];
      serverTimeUtc = Number(d.serverTimeUtc || Date.now());
      renderBoards();
      emergencyEl.style.display = d.emergencyLock ? 'block' : 'none';
      setQuotaText();
      return d;
    });
  }

  function fetchPosts() {
    const q = encodeURIComponent(searchEl.value || '');
    const sort = encodeURIComponent(sortEl.value || 'latest');
    const board = encodeURIComponent(currentBoard);
    return fetch(`/api/insights?board=${board}&sort=${sort}&q=${q}`).then(function (r) { return r.json(); }).then(function (d) {
      renderPosts(Array.isArray(d.posts) ? d.posts : []);
    });
  }

  composeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const title = (titleEl.value || '').trim();
    const content = (contentEl.value || '').trim();
    if (!title || !content) return;
    fetch('/api/insights', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ boardKey: currentBoard, title, content, images: [], videos: [] }),
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, data: d }; }); })
      .then(function (result) {
        if (!result.data.ok) {
          alert(result.data.message || '등록 실패');
          return;
        }
        titleEl.value = '';
        contentEl.value = '';
        bumpQuotaLocal();
        fetchPosts();
      });
  });

  boardTabs.addEventListener('click', function (e) {
    const btn = e.target.closest('.insights-board-tab');
    if (!btn) return;
    currentBoard = btn.getAttribute('data-board') || 'main';
    renderBoards();
    fetchPosts();
  });

  listEl.addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-action]');
    const post = e.target.closest('.insights-post');
    if (!btn || !post) return;
    const action = btn.getAttribute('data-action');
    const postId = post.getAttribute('data-id');
    const enteredAtServerMs = serverTimeUtc - 3500;
    if (action === 'view') {
      fetch(`/api/insights/${encodeURIComponent(postId)}/view`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ enteredAtServerMs }),
      }).then(function () { fetchPosts(); });
      return;
    }
    if (action === 'eval') {
      fetch(`/api/insights/${encodeURIComponent(postId)}/evaluate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ data: 3, risk: 3, novelty: 3, enteredAtServerMs }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) alert(d.message || '평가 실패');
        fetchPosts();
      });
      return;
    }
    if (action === 'report') {
      fetch(`/api/insights/${encodeURIComponent(postId)}/report`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ reason: 'lack', enteredAtServerMs }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) alert(d.message || '신고 실패');
        fetchPosts();
      });
    }
  });

  sortEl.addEventListener('change', fetchPosts);
  searchEl.addEventListener('input', function () {
    window.clearTimeout(searchEl._t);
    searchEl._t = window.setTimeout(fetchPosts, 250);
  });

  fetchState().then(fetchPosts);
})();
