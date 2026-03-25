const fs = require('fs');
const axios = require('axios');
const RSSParser = require('rss-parser');
const rssParser = new RSSParser();

const data = JSON.parse(fs.readFileSync('data/news_raw.json', 'utf8'));

function normalizeTitle(t) { return (t || '').replace(/\s+-\s+\S[^-]*$/, '').trim(); }

// 도메인 공통 불용어: 모든 기사에 등장하므로 중복 판별에 무의미한 단어
const STOP_WORDS = new Set([
  '토네이도', '캐시', 'tornado', 'cash', 'torn',
  '암호화폐', '가상화폐', '가상자산', '코인', 'crypto', 'cryptocurrency',
  '해킹', '해커', 'hack', 'hacked', 'hacking', 'hacker',
  '비트코인', 'bitcoin', 'btc', '이더리움', 'ethereum', 'eth',
  '블록체인', 'blockchain', '디파이', 'defi',
  '달러', '만', '억', '원', '규모', '약', '상당',
  '미국', '북한', '한국',
  '자금', '세탁', '제재', '탈취', '공격', '피해',
]);

function titleKeywords(title) {
  const text = normalizeTitle(title)
    .replace(/["'"'\[\](){}…·|:!?%$#@^&*~`「」『』《》〈〉]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.split(/[\s,]+/)
    .map(w => w.replace(/[^가-힣a-zA-Z0-9]/g, '')
      .replace(/(에서|에게|까지|부터|으로|에는|에도)$/, '')
      .replace(/(에|을|를|은|는|와|과|로)$/, ''))
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
}
function wordsMatch(a, b) {
  if (a === b) return true;
  if (a.length >= 3 && b.includes(a)) return true;
  if (b.length >= 3 && a.includes(b)) return true;
  if (a.length === b.length && a.length >= 3) {
    let d = 0;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i] && ++d > 1) return false; }
    return d === 1;
  }
  return false;
}
function areTitlesSimilar(kwA, kwB) {
  if (kwA.length < 3 || kwB.length < 3) return false;
  let overlap = 0;
  const used = new Set();
  for (const a of kwA) {
    for (let j = 0; j < kwB.length; j++) {
      if (!used.has(j) && wordsMatch(a, kwB[j])) { overlap++; used.add(j); break; }
    }
  }
  return overlap >= 2 && overlap / Math.min(kwA.length, kwB.length) >= 0.30;
}

// 기존 기사 키워드 인덱스 구축
const existingKw = [];
const existingTitles = [];
data.forEach(it => {
  existingKw.push(titleKeywords(it.title));
  existingTitles.push(it.title);
});

const googleSources = [
  { name: 'GN-TornadoCash', url: 'https://news.google.com/rss/search?q=Tornado+Cash+OR+TORN&hl=ko&gl=KR&ceid=KR:ko' },
  { name: 'GN-토네이도캐시', url: 'https://news.google.com/rss/search?q=%ED%86%A0%EB%84%A4%EC%9D%B4%EB%8F%84%EC%BA%90%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko' },
  { name: 'GN-TORNtoken', url: 'https://news.google.com/rss/search?q=TORN+token&hl=ko&gl=KR&ceid=KR:ko' },
  { name: 'GN-암호화폐해킹', url: 'https://news.google.com/rss/search?q=%EC%95%94%ED%98%B8%ED%99%94%ED%8F%90+%ED%95%B4%ED%82%B9+OR+%ED%95%B4%EC%BB%A4&hl=ko&gl=KR&ceid=KR:ko' }
];

async function simulate() {
  const freshItems = [];
  for (const s of googleSources) {
    try {
      const resp = await axios.get(s.url, { timeout: 10000, maxRedirects: 5, responseType: 'text' });
      const feed = await rssParser.parseString(String(resp.data || ''));
      if (feed && Array.isArray(feed.items)) {
        feed.items.forEach(item => freshItems.push({
          source: s.name, title: item.title || '',
          link: item.link || item.guid || '',
          isoDate: item.isoDate || item.pubDate || null
        }));
      }
    } catch (e) { console.error('RSS fail:', s.name, e.message); }
  }

  console.log('=== Google News에서 가져온 총 기사: ' + freshItems.length + '개 ===\n');

  // 링크 중복 제거 (피드 간 중복)
  const seen = new Set();
  const unique = freshItems.filter(it => {
    if (seen.has(it.link)) return false;
    seen.add(it.link);
    return true;
  });
  console.log('피드 간 링크 중복 제거 후: ' + unique.length + '개\n');

  let linkDup = 0, fuzzyDup = 0, added = 0;
  const blocked = [];
  const newsMapKeys = new Set(data.map(it => (it.link || it.title || '').trim()));

  unique.forEach(it => {
    const key = (it.link || it.title || '').trim();
    if (!key) return;

    // 링크 중복
    if (newsMapKeys.has(key)) {
      linkDup++;
      return;
    }

    // 퍼지 유사도 체크
    const kw = titleKeywords(it.title);
    for (let j = 0; j < existingKw.length; j++) {
      if (areTitlesSimilar(kw, existingKw[j])) {
        fuzzyDup++;
        blocked.push({
          title: it.title.substring(0, 70),
          matchedWith: existingTitles[j].substring(0, 70),
          myKw: kw.join(', '),
          matchKw: existingKw[j].join(', ')
        });
        return;
      }
    }

    added++;
    console.log('[추가 가능] ' + it.title.substring(0, 80));
  });

  console.log('\n=== 결과 ===');
  console.log('링크 일치로 차단: ' + linkDup + '개');
  console.log('퍼지 유사도로 차단: ' + fuzzyDup + '개');
  console.log('추가 가능: ' + added + '개');

  if (blocked.length > 0) {
    console.log('\n=== 퍼지 유사도로 차단된 기사 상세 ===');
    blocked.forEach((b, i) => {
      console.log('\n' + (i + 1) + '. [차단] ' + b.title);
      console.log('   [기존] ' + b.matchedWith);
      console.log('   [새 키워드] ' + b.myKw);
      console.log('   [기존 키워드] ' + b.matchKw);
    });
  }
}

simulate().catch(e => console.error('실패:', e));
