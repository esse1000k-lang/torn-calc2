const RSSParser = require('rss-parser');
const parser = new RSSParser();
// Simple checker for the three Korean RSS feeds the app uses
(async ()=>{
  const urls = [
    { name: 'CoinDesk Korea', url: 'https://www.coindeskkorea.com/rss/allArticle.xml' },
    { name: 'TokenPost', url: 'https://www.tokenpost.kr/rss' },
    { name: 'Block Media', url: 'https://www.blockmedia.co.kr/feed' }
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
