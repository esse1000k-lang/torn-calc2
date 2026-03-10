const RSSParser = require('rss-parser');
const axios = require('axios');
const parser = new RSSParser();

const feeds = [
  { name: 'CoinDesk Korea', url: 'https://www.coindeskkorea.com/rss/allArticle.xml' },
  { name: 'TokenPost', url: 'https://www.tokenpost.kr/rss' },
  { name: 'Block Media', url: 'https://www.blockmedia.co.kr/feed' }
];

const KW = ['토네이도 캐시','tornadocash','tornado cash','torn'];

async function parseFeedWithFallback(url) {
  try {
    return await parser.parseURL(url);
  } catch (err) {
    try {
      const resp = await axios.get(url, { timeout: 10000 });
      const html = String(resp.data || '');
      let m = html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]*href=["']([^"']+)["']/i);
      if (!m) m = html.match(/href=["']([^"']+\.(?:xml|rss|atom))["']/i);
      if (m && m[1]) {
        const feedUrl = new URL(m[1], url).toString();
        try { return await parser.parseURL(feedUrl); } catch (e) {}
      }
      return await parser.parseString(html);
    } catch (e) {
      throw err;
    }
  }
}

(async ()=>{
  for (const f of feeds) {
    try {
      const feed = await parseFeedWithFallback(f.url);
      const items = Array.isArray(feed.items) ? feed.items : [];
      let matches = [];
      let min = null, max = null;
      for (const it of items) {
        const txt = ((it.title||'') + ' ' + (it.content||it.contentSnippet||it.summary||'')).toLowerCase();
        if (KW.some(k => txt.includes(k))) matches.push(it);
        const d = it.isoDate || it.pubDate || null;
        if (d) {
          const ts = Date.parse(d);
          if (!isNaN(ts)) {
            if (min === null || ts < min) min = ts;
            if (max === null || ts > max) max = ts;
          }
        }
      }
      console.log('\n=== ' + f.name + ' ===');
      console.log('feed url:', f.url);
      console.log('total items:', items.length);
      console.log('tornado-related matches:', matches.length);
      if (min && max) console.log('items date range:', new Date(min).toISOString(), '->', new Date(max).toISOString());
      if (matches.length) {
        console.log('\nMatched items (up to 20):');
        for (const it of matches.slice(0,20)) {
          console.log('-', (it.title||'(no title)') + (it.isoDate||it.pubDate ? ' | ' + (it.isoDate||it.pubDate) : ''));
        }
      }
    } catch (e) {
      console.error('\nERROR for', f.name, e && e.message);
    }
  }
})();
