const Parser = require('rss-parser');
const axios = require('axios');
const parser = new Parser();

const sources = [
  { name: 'Google News (KR)', url: 'https://news.google.com/rss/search?q=Tornado+Cash+OR+TORN&hl=ko&gl=KR&ceid=KR:ko' }
];

async function tryParse(url) {
  try {
    const feed = await parser.parseURL(url);
    return { ok: true, items: feed.items ? feed.items.length : 0 };
  } catch (e) {
    // fallback: try axios
    try {
      const r = await axios.get(url, { timeout: 10000 });
      const txt = String(r.data || '').slice(0,300);
      return { ok: false, message: 'parser failed, http ok', contentSample: txt };
    } catch (e2) {
      return { ok: false, message: e2.message };
    }
  }
}

(async () => {
  for (const s of sources) {
    process.stdout.write(`---\nChecking ${s.name} (${s.url})\n`);
    try {
      const res = await tryParse(s.url);
      console.log(res);
    } catch (e) {
      console.error('error', e && e.message);
    }
  }
})();