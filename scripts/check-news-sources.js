/**
 * 뉴스 소스 URL에서 수집 가능한 문서가 있는지 확인
 * 실행: node scripts/check-news-sources.js
 */
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const sourcesFile = path.join(__dirname, '..', 'data', 'tornado-news-sources.json');
const KEYWORDS = ['프라이버시', '토네이도', 'tornado', 'TORN', '해킹', '세탁', 'privacy', 'mixer', 'laundering'];

function getSources() {
  if (!fs.existsSync(sourcesFile)) {
    return [
      { name: '코인니스', url: 'https://coinness.com/news' },
      { name: '블루밍비트', url: 'https://bloomingbit.io/' },
    ];
  }
  const data = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
  return (data.sources || []).filter(s => s.enabled !== false).map(s => ({ name: s.name, url: s.url }));
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 12000,
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function main() {
  const cheerio = require('cheerio');
  const sources = getSources();
  console.log('뉴스 소스 확인 (수집 가능 문서 여부)\n');

  (async () => {
    for (const source of sources) {
      console.log('---', source.name, source.url);
      try {
        const { status, body } = await fetchUrl(source.url);
        console.log('  HTTP', status, 'body 길이:', body.length, 'bytes');

        const $ = cheerio.load(body);
        const allLinks = $('a[href]').length;
        const newsLikeLinks = $('a[href*="news"], a[href*="article"]').length;
        const keywordInBody = KEYWORDS.some(kw => body.toLowerCase().includes(kw.toLowerCase()));
        console.log('  링크 수: 전체', allLinks, '| news/article 포함', newsLikeLinks);
        console.log('  본문에 키워드 포함:', keywordInBody ? '예' : '아니오');

        const candidates = [];
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          if (href && href.length > 15 && text.length > 5) {
            const hasKw = KEYWORDS.some(kw => (text + ' ' + href).toLowerCase().includes(kw.toLowerCase()));
            if (hasKw || candidates.length < 5) candidates.push({ text: text.slice(0, 50), href: href.slice(0, 55), hasKw });
          }
        });
        if (candidates.length > 0) {
          console.log('  샘플 링크 (최대 5):');
          candidates.slice(0, 5).forEach(c => console.log('    -', c.hasKw ? '[키워드O]' : '[키워드X]', c.text || '(제목없음)', '|', c.href));
        } else {
          console.log('  → 기사처럼 보이는 링크 없음 (페이지가 JS로 렌더링되었을 가능성)');
        }
      } catch (err) {
        console.log('  오류:', err.message);
      }
      console.log('');
    }
    console.log('정리: 위에서 "기사처럼 보이는 링크 없음"이면 해당 사이트는 서버에서 HTML만 가져와선 수집이 어렵습니다.');
    console.log('      (JavaScript로 목록을 그리는 SPA인 경우, Puppeteer 등 브라우저 자동화가 필요합니다.)');
  })();
}

main();
