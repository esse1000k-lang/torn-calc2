require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const { Contract, Interface, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const RSSParser = require('rss-parser');
const rssParser = new RSSParser();
const { getKimchiPremium } = require('./scripts/compute-kimchi');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CALC_PRICE_CACHE_TTL_MS = 12 * 1000;
const CALC_PREMIUM_CACHE_TTL_MS = 3 * 1000;
const CALC_TOTAL_STAKED_CACHE_TTL_MS = 60 * 1000;
let calcPriceCache = null;
let calcPremiumCache = null;
let calcTotalStakedCache = null;
// ── News system: accumulate-and-merge design ──
// news_raw.json is the single source of truth (persistent, survives restarts).
// New articles are merged in; old articles stay until 180-day expiry.
const NEWS_POLL_INTERVAL_MS = 5 * 60 * 1000; // poll RSS every 5 min
const NEWS_RETENTION_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
const NEWS_FILE = path.join(__dirname, 'data', 'news_raw.json');

// Strip trailing " - SourceName" (Google News syndication pattern) for dedup
function normalizeTitle(title) {
  return (title || '').replace(/\s+-\s+\S[^-]*$/, '').trim();
}

// Extract keywords from title for fuzzy similarity matching
function titleKeywords(title) {
  const text = normalizeTitle(title)
    .replace(/["'"'\[\](){}…·|:!?%$#@^&*~`「」『』《》〈〉]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return text.split(/[\s,]+/)
    .map(w => w.replace(/[^가-힣a-zA-Z0-9]/g, '')
      .replace(/(에서|에게|까지|부터|으로|에는|에도)$/, '')
      .replace(/(에|을|를|은|는|와|과|로)$/, ''))
    .filter(w => w.length >= 2);
}

// Check if two words match: exact, substring (≥3 chars), or edit-distance-1 (same length ≥3)
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

// Check if two titles are about the same topic (fuzzy keyword overlap)
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

// In-memory mirror of news_raw.json (Map keyed by link for fast dedup)
let newsMap = new Map();
let newsLastPoll = 0; // timestamp of last successful poll

// Load existing articles from disk at startup
try {
  if (fs.existsSync(NEWS_FILE)) {
    const saved = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8'));
    if (Array.isArray(saved)) {
      const loadedKw = [];
      const loadedNorm = new Set();
      saved.forEach(it => {
        const key = (it.link || it.title || '').trim();
        if (!key) return;
        const norm = normalizeTitle(it.title);
        if (norm && loadedNorm.has(norm)) return;
        const kw = titleKeywords(it.title);
        for (let j = 0; j < loadedKw.length; j++) {
          if (areTitlesSimilar(kw, loadedKw[j])) return;
        }
        newsMap.set(key, it);
        if (norm) loadedNorm.add(norm);
        loadedKw.push(kw);
      });
      console.log('News loaded from disk:', newsMap.size, 'articles');
    }
  }
} catch (e) { console.warn('Could not load news from disk:', e && e.message); }

/* ── Shared RPC provider & contract constants (created once) ── */
const TORN_TOKEN = '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C';
const GOVERNANCE = '0x2F50508a8a3D323B91336FA3eA6ae50E55f32185';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const DEFILLAMA_COINS = 'ethereum:0x77777FeDdddFfC19Ff86DB637967013e6C6A116C,ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const STAKING_CONTRACT_ADDRESS = '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce';
const REWARD_CONTRACT_ADDRESS = '0x5B3f656C80E8ddb9ec01Dd9018815576E9238c29';

const SHARED_RPC_URL = (() => {
  const raw = process.env.CALC_RPC_URL || process.env.INFURA_URL || '';
  return /^https?:\/\//i.test(raw) ? raw : (raw ? ('https://mainnet.infura.io/v3/' + raw) : '');
})();
const sharedProvider = new JsonRpcProvider(SHARED_RPC_URL || 'https://rpc.ankr.com/eth', 1);

// Cache the immutable Uniswap V2 pair address (TORN/WETH)
let cachedPairAddr = null;
async function getUniswapPairAddress() {
  if (cachedPairAddr) return cachedPairAddr;
  try {
    const factory = new Contract(UNISWAP_V2_FACTORY, ['function getPair(address,address) view returns (address)'], sharedProvider);
    const addr = await factory.getPair(TORN_TOKEN, WETH);
    if (addr && addr !== '0x0000000000000000000000000000000000000000') {
      cachedPairAddr = addr;
    }
    return cachedPairAddr;
  } catch { return null; }
}
// Pre-warm pair address on startup
setTimeout(() => getUniswapPairAddress().catch(() => {}), 500);

const pairAbi = ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'];
const pairIface = new Interface(pairAbi);
const balanceIface = new Interface(['function balanceOf(address account) view returns (uint256)']);
const multicallContract = new Contract(MULTICALL3, ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)'], sharedProvider);

// Wallet contracts (created once, reused across all requests)
const stakingContract = new Contract(STAKING_CONTRACT_ADDRESS, ['function lockedBalance(address account) view returns (uint256)'], sharedProvider);
const rewardContract = new Contract(REWARD_CONTRACT_ADDRESS, ['function checkReward(address account) view returns (uint256 rewards)'], sharedProvider);
const tornTokenContract = new Contract(TORN_TOKEN, ['function balanceOf(address account) view returns (uint256)'], sharedProvider);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression({ level: 6, threshold: 512 }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '2h',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
// Prevent browsers from caching API responses to ensure clients always fetch fresh data
app.use('/api', (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } catch (e) {}
  next();
});

function validateAndNormalizeEthAddress(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed;
}

function writeJsonSafe(file, obj) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp.' + Date.now() + '.' + Math.floor(Math.random() * 100000);
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch (e) {
    // preserve original behavior of not throwing to callers, but log to console for ops visibility
    try { console.error('writeJsonSafe failed for', file, e && e.message); } catch {}
  }
}

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calculator.html'));
});

app.get('/api/calculator/premium', async (_req, res) => {
  const now = Date.now();
  if (calcPremiumCache && now - calcPremiumCache.at < CALC_PREMIUM_CACHE_TTL_MS) {
    return res.json(calcPremiumCache.data);
  }

  try {
    // Use the fast, standalone calculator which fetches Upbit, Binance and FX.
    const kim = await getKimchiPremium({ timeoutMs: 2000 });

    const payload = {
      ok: kim.ok === true,
      sources: {
        upbitKrw: kim.upbitKrw ?? null,
        binanceUsdt: kim.binanceUsdt ?? null,
        usdToKrw: kim.usdToKrw ?? null,
      },
      derived: {
        foreignBtcKrw: kim.foreignKrw ?? null,
      },
      premium: kim.premiumPercent ?? null,
      btcKrw: kim.upbitKrw ?? kim.foreignKrw ?? null,
    };

    calcPremiumCache = { at: now, data: payload };
    return res.json(payload);
  } catch (e) {
    // fallback to cached value if available
    if (calcPremiumCache) return res.json(calcPremiumCache.data);
    return res.status(502).json({ ok: false, message: e && e.message ? e.message : 'premium fetch failed' });
  }
});

app.get('/api/calculator/prices', async (_req, res) => {
  const now = Date.now();
  if (calcPriceCache && now - calcPriceCache.at < CALC_PRICE_CACHE_TTL_MS) {
    return res.json(calcPriceCache.data);
  }

  const timeoutFetch = (url, ms = 8000) => fetch(url, { signal: AbortSignal.timeout(ms) });

  // totalStaked uses cache if fresh, else will be fetched via multicall below
  const totalStakedFromCache = (calcTotalStakedCache && now - calcTotalStakedCache.at < CALC_TOTAL_STAKED_CACHE_TTL_MS)
    ? calcTotalStakedCache.data : null;

  // Uniswap + totalStaked in a single Multicall3 batch (1 RPC call instead of 3)
  const onChainPromise = (async () => {
    try {
      const pairAddr = await getUniswapPairAddress();
      if (!pairAddr) return { tornPriceInEth: null, totalStaked: totalStakedFromCache };
      const calls = [
        { target: pairAddr, allowFailure: false, callData: pairIface.encodeFunctionData('getReserves', []) },
        { target: pairAddr, allowFailure: false, callData: pairIface.encodeFunctionData('token0', []) },
      ];
      // Include totalStaked in the same multicall if cache is stale
      const needStaked = totalStakedFromCache === null;
      if (needStaked) {
        calls.push({ target: TORN_TOKEN, allowFailure: true, callData: balanceIface.encodeFunctionData('balanceOf', [GOVERNANCE]) });
      }
      const results = await multicallContract.aggregate3(calls);
      // Decode Uniswap reserves
      let tornPriceInEth = null;
      if (results?.[0]?.returnData && results?.[1]?.returnData) {
        const [reserve0, reserve1] = pairIface.decodeFunctionResult('getReserves', results[0].returnData);
        const token0Addr = pairIface.decodeFunctionResult('token0', results[1].returnData)[0];
        const isTorn0 = String(token0Addr).toLowerCase() === TORN_TOKEN.toLowerCase();
        const reserveTorn = isTorn0 ? reserve0 : reserve1;
        const reserveWeth = isTorn0 ? reserve1 : reserve0;
        if (reserveTorn !== 0n) tornPriceInEth = Number(reserveWeth) / Number(reserveTorn);
      }
      // Decode totalStaked if fetched
      let totalStaked = totalStakedFromCache;
      if (needStaked && results?.[2]?.success && results[2].returnData) {
        const [wei] = balanceIface.decodeFunctionResult('balanceOf', results[2].returnData);
        totalStaked = Number(wei) / 1e18;
      }
      return { tornPriceInEth, totalStaked };
    } catch { return { tornPriceInEth: null, totalStaked: totalStakedFromCache }; }
  })();

  const [llamaRes, coingeckoRes, mexcRes, onChainRes, gasFeeDataResult, latestBlockResult, upbitRes] = await Promise.allSettled([
    timeoutFetch('https://coins.llama.fi/prices/current/' + DEFILLAMA_COINS).then((r) => r.json()),
    timeoutFetch('https://api.coingecko.com/api/v3/simple/price?ids=tornado-cash,bitcoin,ethereum&vs_currencies=krw').then((r) => r.json()),
    timeoutFetch('https://api.mexc.com/api/v3/ticker/price?symbol=TORNUSDT').then((r) => r.json()),
    onChainPromise,
    sharedProvider.getFeeData().catch(() => null),
    sharedProvider.getBlock('latest').catch(() => null),
    timeoutFetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC').then((r) => r.json()),
  ]);

  const llama = llamaRes.status === 'fulfilled' ? llamaRes.value : null;
  const coingecko = coingeckoRes.status === 'fulfilled' ? coingeckoRes.value : null;
  const mexc = mexcRes.status === 'fulfilled' ? mexcRes.value : null;
  const onChain = onChainRes.status === 'fulfilled' ? onChainRes.value : {};
  const tornPriceInEth = onChain.tornPriceInEth ?? null;
  const totalStakedMaybe = onChain.totalStaked ?? null;
  const gasFeeData = gasFeeDataResult.status === 'fulfilled' ? gasFeeDataResult.value : null;
  const latestBlock = latestBlockResult.status === 'fulfilled' ? latestBlockResult.value : null;
  const upbit = upbitRes.status === 'fulfilled' ? upbitRes.value : null;

  const coins = (llama && llama.coins) || {};
  const ethPriceUsd = coins['ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2']?.price || 0;
  const btcPriceUsd = coins['ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599']?.price || 0;
  const defiLlamaTorn = coins['ethereum:0x77777FeDdddFfC19Ff86DB637967013e6C6A116C']?.price || 0;
  const tornPriceUsdDex = tornPriceInEth && ethPriceUsd ? tornPriceInEth * ethPriceUsd : 0;
  const mexcObj = Array.isArray(mexc) ? mexc[0] : mexc;
  const tornPriceUsdCex = mexcObj?.price ? Number(mexcObj.price) || 0 : 0;
  const tornPriceUsdCenter = defiLlamaTorn > 0 ? defiLlamaTorn : 0;
  const tornPriceUsd = tornPriceUsdDex || tornPriceUsdCenter || tornPriceUsdCex;
  const upbitBtcKrw = Array.isArray(upbit) && upbit[0]?.trade_price ? Number(upbit[0].trade_price) : 0;
  const btcKrw = coingecko?.bitcoin?.krw || upbitBtcKrw || calcPriceCache?.data?.btcKrw || calcPremiumCache?.data?.btcKrw || null;
  const ethKrw = coingecko?.ethereum?.krw || ((btcKrw && btcPriceUsd > 0 && ethPriceUsd > 0) ? (btcKrw / btcPriceUsd) * ethPriceUsd : 0) || calcPriceCache?.data?.ethKrw || 0;
  const premium = calcPremiumCache?.data?.premium != null ? calcPremiumCache.data.premium : (calcPriceCache?.data?.premium != null ? calcPriceCache.data.premium : null);
  const CALCULATOR_GAS_LIMIT = 120000n;
  const MIN_FAST_TIP_WEI = 1170000000n;
  const feeDataBaseWei = typeof gasFeeData?.lastBaseFeePerGas === 'bigint'
    ? gasFeeData.lastBaseFeePerGas
    : (typeof latestBlock?.baseFeePerGas === 'bigint' ? latestBlock.baseFeePerGas : 0n);
  const feeDataPriorityWei = typeof gasFeeData?.maxPriorityFeePerGas === 'bigint' ? gasFeeData.maxPriorityFeePerGas : 0n;
  const effectivePriorityWei = feeDataPriorityWei > MIN_FAST_TIP_WEI ? feeDataPriorityWei : MIN_FAST_TIP_WEI;
  const maxFeePerGasWei = feeDataBaseWei > 0n
    ? ((feeDataBaseWei * 120n) / 100n) + effectivePriorityWei
    : 0n;
  const gasPriceGwei = maxFeePerGasWei > 0n
    ? Number(maxFeePerGasWei) / 1e9
    : (calcPriceCache?.data?.gasPriceGwei || 0);
  const gasCostEth = maxFeePerGasWei > 0n ? Number(maxFeePerGasWei * CALCULATOR_GAS_LIMIT) / 1e18 : 0;
  const gasCostKrw = gasCostEth > 0 && ethKrw > 0
    ? gasCostEth * ethKrw
    : 0;

  let totalStaked = typeof totalStakedMaybe === 'number' ? totalStakedMaybe : 0;
  if (totalStaked > 0) calcTotalStakedCache = { at: now, data: totalStaked };
  else if (typeof calcTotalStakedCache?.data === 'number') {
    totalStaked = calcTotalStakedCache.data;
  }

  const payload = {
    ok: true,
    tornPriceUsdDex,
    tornPriceUsdCex,
    tornPriceUsdCenter,
    tornPriceUsd,
    ethPriceUsd,
    btcPriceUsd,
    btcKrw,
    ethKrw,
    gasPriceGwei,
    gasCostKrw,
    premium,
    totalStaked,
    tornPriceKrw: coingecko?.['tornado-cash']?.krw || calcPriceCache?.data?.tornPriceKrw || 0,
  };

  calcPriceCache = { at: now, data: payload };
  res.json(payload);
});

app.get('/api/calculator/wallet', async (req, res) => {
  const walletAddress = validateAndNormalizeEthAddress(String(req.query.walletAddress || ''));
  if (!walletAddress) return res.status(400).json({ ok: false, message: '유효한 이더리움 주소가 아닙니다.' });

  try {
    const [stakedWei, rewardWei, balanceWei, ethBalanceWei] = await Promise.all([
      stakingContract.lockedBalance(walletAddress),
      rewardContract.checkReward(walletAddress).catch(() => 0n),
      tornTokenContract.balanceOf(walletAddress).catch(() => 0n),
      sharedProvider.getBalance(walletAddress).catch(() => 0n),
    ]);
    const toNumber = (value) => Number(value) / Math.pow(10, 18);
    res.json({
      ok: true,
      walletAddress,
      staked: toNumber(stakedWei),
      reward: toNumber(rewardWei),
      walletBalance: toNumber(balanceWei),
      ethBalance: toNumber(ethBalanceWei),
    });
  } catch (error) {
    res.status(502).json({ ok: false, message: error?.message || '지갑 조회에 실패했습니다.' });
  }
});

// ── News: accumulate-and-merge fetch logic ──
let newsFetchLock = 0; // prevent concurrent fetches
const NEWS_FETCH_LOCK_TIMEOUT = 2 * 60 * 1000;

let newsSortedCache = null;
function getNewsSorted() {
  if (newsSortedCache) return newsSortedCache;
  const items = Array.from(newsMap.values())
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const accepted = [];
  const acceptedKw = [];
  const seenNorm = new Set();
  for (const it of items) {
    const norm = normalizeTitle(it.title);
    if (norm && seenNorm.has(norm)) continue;
    const kw = titleKeywords(it.title);
    let dominated = false;
    for (let j = 0; j < acceptedKw.length; j++) {
      if (areTitlesSimilar(kw, acceptedKw[j])) { dominated = true; break; }
    }
    if (dominated) continue;
    if (norm) seenNorm.add(norm);
    accepted.push(it);
    acceptedKw.push(kw);
  }
  newsSortedCache = accepted;
  return newsSortedCache;
}

function persistNews() {
  try {
    writeJsonSafe(NEWS_FILE, getNewsSorted());
  } catch (e) { console.warn('persistNews failed:', e && e.message); }
}

async function pollNewsFeeds() {
  const now = Date.now();
  if (newsFetchLock && (now - newsFetchLock) < NEWS_FETCH_LOCK_TIMEOUT) return;
  newsFetchLock = now;
  try {
    const NEWS_KW = /tornado.?cash|토네이도.?캐시|torn\b|해킹|해커|hacker|hack(?:ed|ing)/i;

    const googleSources = [
      { name: 'Google News', url: 'https://news.google.com/rss/search?q=Tornado+Cash+OR+TORN&hl=ko&gl=KR&ceid=KR:ko' },
      { name: 'Google News', url: 'https://news.google.com/rss/search?q=%ED%86%A0%EB%84%A4%EC%9D%B4%EB%8F%84%EC%BA%90%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko' },
      { name: 'Google News', url: 'https://news.google.com/rss/search?q=TORN+token&hl=ko&gl=KR&ceid=KR:ko' },
      { name: 'Google News', url: 'https://news.google.com/rss/search?q=%EC%95%94%ED%98%B8%ED%99%94%ED%8F%90+%ED%95%B4%ED%82%B9+OR+%ED%95%B4%EC%BB%A4&hl=ko&gl=KR&ceid=KR:ko' }
    ];
    const koreanSources = [
      { name: '토큰포스트', url: 'https://www.tokenpost.kr/rss' },
      { name: '블록미디어', url: 'https://www.blockmedia.co.kr/feed/' },
      { name: '블록스트리트', url: 'https://www.blockstreet.co.kr/rss' }
    ];

    async function parseFeed(url) {
      const resp = await axios.get(url, { timeout: 10000, maxRedirects: 5, responseType: 'text' });
      return await rssParser.parseString(String(resp.data || ''));
    }

    const freshItems = [];
    const allJobs = [
      ...googleSources.map(s => parseFeed(s.url).then(feed => {
        if (feed && Array.isArray(feed.items)) {
          feed.items.forEach(item => freshItems.push({
            source: s.name, title: item.title || '',
            link: item.link || item.guid || '',
            isoDate: item.isoDate || item.pubDate || null,
            summary: item.contentSnippet || item.summary || item.content || ''
          }));
        }
      }).catch(e => console.error('RSS fail:', s.url.substring(0, 50), e && e.message))),
      ...koreanSources.map(s => parseFeed(s.url).then(feed => {
        if (feed && Array.isArray(feed.items)) {
          feed.items.forEach(item => {
            const text = (item.title || '') + ' ' + (item.contentSnippet || item.summary || '');
            if (!NEWS_KW.test(text)) return;
            freshItems.push({
              source: s.name, title: item.title || '',
              link: item.link || item.guid || '',
              isoDate: item.isoDate || item.pubDate || null,
              summary: item.contentSnippet || item.summary || item.content || ''
            });
          });
        }
      }).catch(e => console.error('RSS fail:', s.name, e && e.message)))
    ];
    await Promise.allSettled(allJobs);

    // ── Merge new items into persistent map (never replace) ──
    const cutoff = Date.now() - NEWS_RETENTION_MS;
    // Build keyword index for fuzzy dedup
    const existingKw = [];
    for (const it of newsMap.values()) {
      existingKw.push(titleKeywords(it.title));
    }
    let added = 0;
    freshItems.forEach(it => {
      const key = (it.link || it.title || '').trim();
      if (!key) return;
      if (newsMap.has(key)) return; // already stored (by link)
      const kw = titleKeywords(it.title);
      for (let j = 0; j < existingKw.length; j++) {
        if (areTitlesSimilar(kw, existingKw[j])) return;
      }
      let ts = 0;
      try { ts = it.isoDate ? Date.parse(it.isoDate) : 0; } catch { ts = 0; }
      if (ts && ts < cutoff) return; // older than 180 days
      newsMap.set(key, Object.assign({ timestamp: ts || Date.now() }, it));
      existingKw.push(kw);
      added++;
    });

    // ── Prune expired articles (>180 days) ──
    let pruned = 0;
    for (const [key, it] of newsMap) {
      if (it.timestamp && it.timestamp < cutoff) { newsMap.delete(key); pruned++; }
    }

    if (added > 0 || pruned > 0) {
      newsSortedCache = null;
      persistNews();
      console.log('News: +' + added + ' new, -' + pruned + ' expired, total ' + newsMap.size);
    }
    newsLastPoll = Date.now();
  } finally {
    newsFetchLock = 0;
  }
}

// API: always return accumulated articles; trigger background poll if stale
app.get('/api/news/latest', async (_req, res) => {
  try {
    // If never polled yet and map is empty, do a blocking first fetch
    if (!newsLastPoll && newsMap.size === 0) {
      try { await pollNewsFeeds(); } catch {}
    } else if (Date.now() - newsLastPoll > NEWS_POLL_INTERVAL_MS) {
      // stale: trigger background refresh, respond immediately
      pollNewsFeeds().catch(() => {});
    }
    const sorted = getNewsSorted();
    const items = sorted.map(({ summary, ...rest }) => rest);
    return res.json({ ok: true, count: items.length, items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'news unavailable' });
  }
});

// Force refresh endpoint
app.post('/api/news/refresh', async (_req, res) => {
  try {
    await pollNewsFeeds();
    const sorted = getNewsSorted();
    const items = sorted.map(({ summary, ...rest }) => rest);
    return res.json({ ok: true, count: items.length, items });
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'refresh failed' });
  }
});

// Periodic background poll (single interval, no duplicates)
setTimeout(() => { pollNewsFeeds().catch(() => {}); }, 2000);
setInterval(() => { pollNewsFeeds().catch(() => {}); }, NEWS_POLL_INTERVAL_MS);



app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err?.message || '서버 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`TornFi portfolio server listening on http://localhost:${PORT}`);
});
