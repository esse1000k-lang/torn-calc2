const RSSParser = require('rss-parser');
const parser = new RSSParser();
// Quick probe for the exact Korean RSS endpoints used by the app
// use a fallback-aware parse helper to handle feeds that expose RSS via HTML
(async ()=>{
  const feeds = [
    { name: 'CoinDesk Korea', url: 'https://www.coindeskkorea.com/rss/allArticle.xml' },
    { name: 'TokenPost', url: 'https://www.tokenpost.kr/rss' },
    { name: 'Block Media', url: 'https://www.blockmedia.co.kr/feed' }
  ];

  async function parseFeedWithFallback(url) {
    try {
      return await parser.parseURL(url);
    } catch (err) {
      try {
        const resp = await require('axios').get(url, { timeout: 10000 });
        const html = String(resp.data || '');
        let m = html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]*href=["']([^"']+)["']/i);
        if (!m) m = html.match(/href=["']([^"']+\.(?:xml|rss|atom))["']/i);
        if (m && m[1]) {
          const feedUrl = new URL(m[1], url).toString();
          try { return await parser.parseURL(feedUrl); } catch (e) {}
        }
        return await parser.parseString(html);
      } catch (e) { throw err; }
    }
  }

  for (const f of feeds) {
    try {
      const feed = await parseFeedWithFallback(f.url);
      console.log('\n===', f.name, '===');
      console.log('url:', f.url);
      console.log('items:', Array.isArray(feed.items)?feed.items.length:0);
      for (const it of (feed.items||[]).slice(0,5)) console.log(' -', it.title || '(no title)');
    } catch (e) {
      console.error('ERROR fetching', f.url, e && e.message);
    }
  }
})();
