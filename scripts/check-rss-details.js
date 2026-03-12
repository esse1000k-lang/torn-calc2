const Parser = require('rss-parser');
const parser = new Parser();
const NEWS_KEYWORDS = ['토네이도 캐시','토네이도','토네이도캐시','tornadocash','tornado cash','tornado','torn','torn.'];

async function inspect(url, name) {
  try {
    const feed = await parser.parseURL(url);
    console.log(`---\n${name} - total items: ${feed.items.length}`);
    for (let i=0;i<Math.min(10, feed.items.length); i++) {
      const t = String(feed.items[i].title||'');
      const matched = NEWS_KEYWORDS.some(kw => t.toLowerCase().includes(kw));
      console.log(i+1, matched ? '[MATCH]' : '[     ]', t);
    }
  } catch (e) {
    console.error(name, 'error', e && e.message);
  }
}

(async()=>{
  await inspect('https://news.google.com/rss/search?q=Tornado+Cash+OR+TORN&hl=ko&gl=KR&ceid=KR:ko','Google News (KR)');
})();