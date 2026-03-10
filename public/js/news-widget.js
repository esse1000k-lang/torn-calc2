// Lightweight news widget: fetch /api/news/latest and show a one-line ticker.
(function () {
  const KEY = 'one_line_news_history_v1';
  function el(id) { return document.getElementById(id); }
  function saveHistory(item) {
    try {
      if (!item || !item.title) return;
      const raw = localStorage.getItem(KEY); const arr = raw ? JSON.parse(raw) : [];
      const last = arr.length ? arr[arr.length-1] : null;
      if (last && last.title === item.title) return;
      // preserve any translated fields if present
      const toSave = Object.assign({}, item, { shownAt: (new Date()).toISOString() });
      if (item.title_ko) toSave.title_ko = item.title_ko;
      if (item.summary_ko) toSave.summary_ko = item.summary_ko;
      arr.push(toSave);
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch (e) { console.warn(e); }
  }

  async function fetchNews() {
    try {
      const r = await fetch('/api/news/latest', { cache: 'no-store' });
      if (!r.ok) throw new Error('network');
      const j = await r.json();
      return (j && Array.isArray(j.items)) ? j.items : [];
    } catch (e) { console.warn('news fetch failed', e && e.message); return []; }
  }

  function textFor(it) {
    return (it && (it.title_ko || it.title || it.text || it.headline)) || '';
  }

  async function init() {
    const cur = el('newsLink');
    const nxt = el('newsLinkNext');
    const lbl = document.querySelector('.news-label');
    if (lbl) { lbl.style.cursor = 'pointer'; lbl.addEventListener('click', () => window.location.href = '/news.html'); }
    if (!cur || !nxt) return;

    const items = await fetchNews();
    if (!items || items.length === 0) {
      cur.querySelector('.news-text').textContent = '새로운 뉴스가 없습니다.';
      return;
    }

    let idx = 0;
    function show(i) {
      const it = items[i];
      cur.querySelector('.news-text').textContent = textFor(it).slice(0, 220);
      cur.href = '#';
      saveHistory({ title: textFor(it), url: it.link || it.url || '' , source: it.source||'', time: it.isoDate||it.pubDate||it.published });
      // prepare next
      const next = items[(i+1) % items.length];
      nxt.querySelector('.news-text').textContent = textFor(next).slice(0,220);
      nxt.href = '#';
    }

    cur.addEventListener('click', (e) => { e.preventDefault(); window.location.href = '/news.html'; });
    nxt.addEventListener('click', (e) => { e.preventDefault(); window.location.href = '/news.html'; });

    show(idx);
    setInterval(() => { idx = (idx + 1) % items.length; show(idx); }, 6000);
  }

  // auto-init when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
