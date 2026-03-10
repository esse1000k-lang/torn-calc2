require('dotenv').config();
const axios = require('axios');
const RSSParser = require('rss-parser');
const parser = new RSSParser();
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, '..', 'data', 'news_raw.json');

async function getTornadoNews() {
  console.log("🌪️ Tornado Cash & TORN 데이터 수집 시작...");
  let allNews = [];
  // focus on user-requested keywords (plus safe variants)
  const NEWS_KEYWORDS = ['토네이도 캐시', 'tornadocash', 'tornado cash', 'torn'];

  // Use the three user-provided Korean RSS feeds
  const sources = [
    { name: 'CoinDesk Korea', url: 'https://www.coindeskkorea.com/rss/allArticle.xml' },
    { name: 'TokenPost', url: 'https://www.tokenpost.kr/rss' },
    { name: 'Block Media', url: 'https://www.blockmedia.co.kr/feed' }
  ];

  try {
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
            try {
              const feedUrl = new URL(m[1], url).toString();
              return await parser.parseURL(feedUrl);
            } catch (e2) {}
          }
          return await parser.parseString(html);
        } catch (e) {
          throw err;
        }
      }
    }

    for (const s of sources) {
      try {
        console.log(`📡 ${s.name} 긁는 중...`);
        const feed = await parseFeedWithFallback(s.url);
        if (feed && Array.isArray(feed.items)) {
          const items = feed.items.map(item => ({
            source: s.name,
            title: item.title || '',
            link: item.link || item.guid || '',
            pubDate: item.isoDate || item.pubDate || null,
            summary: item.contentSnippet || item.summary || item.content || ''
          }));
          allNews.push(...items);
        }
      } catch (err) {
        console.warn(`${s.name} fetch failed:`, err && err.message);
      }
    }

    // 중복 제거 + 키워드 필터
    const unique = Array.from(new Map(allNews.map(i => [ (i.title||'').trim(), i ])).values())
      .filter(item => {
        const t = ((item.title||'') + ' ' + (item.summary||'')).toLowerCase();
        return NEWS_KEYWORDS.some(kw => t.includes(kw));
      });

    const processed = unique;

    // ensure data dir
    const outDir = path.dirname(OUT_FILE);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(OUT_FILE, JSON.stringify(processed, null, 2), 'utf8');
    console.log(`\n✅ 수집 완료: ${processed.length}개 항목을 ${OUT_FILE}에 저장했습니다.`);
  } catch (err) {
    console.error('❌ 실행 중 에러 발생:', err && err.message ? err.message : err);
  }
}

if (require.main === module) getTornadoNews();

module.exports = { getTornadoNews };
