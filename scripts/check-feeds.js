const RSSParser = require('rss-parser');
const parser = new RSSParser();
// Simple checker for the three Korean RSS feeds the app uses
(async ()=>{
  const urls = [
    { name: 'TokenPost', url: 'https://www.tokenpost.kr/rss' },
    { name: 'Block Media', url: 'https://www.blockmedia.co.kr/feed' },
    { name: 'Google News (KR)', url: 'https://news.google.com/rss/search?q=Tornado+Cash+OR+TORN&hl=ko&gl=KR&ceid=KR:ko' }
  ];
  for (const u of urls) {
    try {
      const feed = await parser.parseURL(u.url);
      console.log('\n---- FEED:', u.name, u.url);
      console.log('items:', Array.isArray(feed.items)?feed.items.length:0);
      for (const it of (feed.items||[]).slice(0,5)) {
        console.log(' -', it.title || '(no title)');
      }
    } catch (e) {
      console.error('ERROR fetching', u.url, e && e.message);
    }
  }
})();
