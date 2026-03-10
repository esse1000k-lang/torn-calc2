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

    let items = await fetchNews();
    // sort newest-first and keep only the 7 most recent for the home ticker
    items = (Array.isArray(items) ? items.slice() : []).sort((a,b) => {
      const ta = a.isoDate || a.pubDate || a.timestamp || '';
      const tb = b.isoDate || b.pubDate || b.timestamp || '';
      const sa = isNaN(Date.parse(ta)) ? 0 : Date.parse(ta);
      const sb = isNaN(Date.parse(tb)) ? 0 : Date.parse(tb);
      return sb - sa;
    }).slice(0, 7);
    if (!items || items.length === 0) {
      cur.querySelector('.news-text').textContent = '새로운 뉴스가 없습니다.';
      return;
    }

    let idx = 0;
    const ANIM_MS = 520;
    // initialize current item
    cur.querySelector('.news-text').textContent = textFor(items[0]);
    saveHistory({ title: textFor(items[0]), url: items[0].link || items[0].url || '' , source: items[0].source||'', time: items[0].isoDate||items[0].pubDate||items[0].published });

    function animateTo(nextIndex) {
      const curItem = items[idx];
      const nextItem = items[nextIndex];
      const curTextEl = cur.querySelector('.news-text');
      const nxtTextEl = nxt.querySelector('.news-text');

      // set next content into next slot
      nxtTextEl.textContent = textFor(nextItem);
      // ensure next is visible for animation
      nxt.classList.remove('anim-in');
      cur.classList.remove('anim-out');
      void nxt.offsetWidth; // force reflow

      // animate: bring next in, push current out
      nxt.classList.add('anim-in');
      cur.classList.add('anim-out');

      // after animation, commit next into current slot and clear next
      setTimeout(() => {
        curTextEl.textContent = textFor(nextItem);
        saveHistory({ title: textFor(nextItem), url: nextItem.link || nextItem.url || '' , source: nextItem.source||'', time: nextItem.isoDate||nextItem.pubDate||nextItem.published });
        // clear classes and next slot
        nxt.classList.remove('anim-in');
        cur.classList.remove('anim-out');
        nxtTextEl.textContent = '';
      }, ANIM_MS + 20);
    }

    cur.addEventListener('click', (e) => { e.preventDefault(); window.location.href = '/news.html'; });
    nxt.addEventListener('click', (e) => { e.preventDefault(); window.location.href = '/news.html'; });

    // rotation timer uses animateTo for lively transitions
    setInterval(() => {
      const nextIndex = (idx + 1) % items.length;
      animateTo(nextIndex);
      idx = nextIndex;
    }, 6000);
  }

  // auto-init when DOM ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
