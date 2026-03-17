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
// News cache
let newsCache = null; // { at: ms, data: [...] }
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

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
const multicallContract = new Contract(MULTICALL3, ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)'], sharedProvider);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression({ level: 9, threshold: 512 }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: false
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

const DATA_DIR = process.env.DATA_DIR && typeof process.env.DATA_DIR === 'string'
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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

    // Also fetch CoinGecko KRW as a safe btcKrw reference to avoid breaking other consumers.
    let coingeckoBtcKrw = null;
    try {
      const cg = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=krw', { signal: AbortSignal.timeout(1200) }).then(r => r.json()).catch(() => null);
      coingeckoBtcKrw = cg?.bitcoin?.krw || null;
    } catch {}

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
      // Maintain previous `btcKrw` field for backwards compatibility: prefer CoinGecko KRW, else Upbit KRW, else computed foreign KRW
      btcKrw: coingeckoBtcKrw || (kim.upbitKrw ?? kim.foreignKrw ?? null),
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
        const balanceIface = new Interface(['function balanceOf(address account) view returns (uint256)']);
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
        const balanceIface = new Interface(['function balanceOf(address account) view returns (uint256)']);
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
    const stakingContract = new Contract(STAKING_CONTRACT_ADDRESS, ['function lockedBalance(address account) view returns (uint256)'], sharedProvider);
    const rewardContract = new Contract(REWARD_CONTRACT_ADDRESS, ['function checkReward(address account) view returns (uint256 rewards)'], sharedProvider);
    const tornToken = new Contract(TORN_TOKEN, ['function balanceOf(address account) view returns (uint256)'], sharedProvider);
    const [stakedWei, rewardWei, balanceWei, ethBalanceWei] = await Promise.all([
      stakingContract.lockedBalance(walletAddress),
      rewardContract.checkReward(walletAddress).catch(() => 0n),
      tornToken.balanceOf(walletAddress).catch(() => 0n),
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

// News endpoint: gather Korean RSS feeds, dedupe and cache results
let newsFetchInProgress = 0; // timestamp of last fetch start (0 = idle)
const NEWS_FETCH_STALE_MS = 2 * 60 * 1000; // reset stuck guard after 2 min
async function fetchAndCacheNews() {
  const now = Date.now();
  if (newsFetchInProgress && (now - newsFetchInProgress) < NEWS_FETCH_STALE_MS) return;
  newsFetchInProgress = now;
  try {
    // Google News RSS queries — results are pre-filtered by Google's relevance
    const sources = [
      { name: 'Google News', url: 'https://news.google.com/rss/search?q=Tornado+Cash+OR+TORN&hl=ko&gl=KR&ceid=KR:ko' },
      { name: 'Google News', url: 'https://news.google.com/rss/search?q=%ED%86%A0%EB%84%A4%EC%9D%B4%EB%8F%84%EC%BA%90%EC%8B%9C&hl=ko&gl=KR&ceid=KR:ko' },
      { name: 'Google News', url: 'https://news.google.com/rss/search?q=TORN+token&hl=ko&gl=KR&ceid=KR:ko' }
    ];
    const results = [];

    for (const s of sources) {
      try {
        let feed;
        try {
          feed = await rssParser.parseURL(s.url);
        } catch {
          const resp = await axios.get(s.url, { timeout: 10000 });
          feed = await rssParser.parseString(String(resp.data || ''));
        }
        if (feed && Array.isArray(feed.items)) {
          feed.items.forEach(item => results.push({
            source: s.name,
            title: item.title || '',
            link: item.link || item.guid || '',
            isoDate: item.isoDate || item.pubDate || null,
            summary: item.contentSnippet || item.summary || item.content || ''
          }));
        }
      } catch (e) {
        console.error('News RSS fetch failed:', s.url.substring(0, 60), e && e.message);
      }
    }

    // Dedupe by link, apply 180-day retention
    const cutoff = Date.now() - (180 * 24 * 60 * 60 * 1000);
    const map = new Map();
    results.forEach(it => {
      const title = String(it.title || '');
      const key = (it.link || title).trim();
      if (!key || map.has(key)) return;
      let ts = 0;
      try { ts = it.isoDate ? Date.parse(it.isoDate) : 0; } catch { ts = 0; }
      if (ts && ts < cutoff) return;
      map.set(key, Object.assign({ timestamp: ts || Date.now() }, it));
    });

    const items = Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 50);

    newsCache = { at: Date.now(), data: items };
    try { ensureDataDir(); writeJsonSafe(path.join(DATA_DIR, 'news_raw.json'), items); } catch (e) { console.warn('failed to write news_raw.json', e && e.message); }
    console.log('News fetched:', items.length, 'items');
    return items;
  } finally {
    newsFetchInProgress = 0;
  }
}

// API: return cache-only; trigger background fetch when appropriate
app.get('/api/news/latest', async (req, res) => {
  try {
    const now = Date.now();
    if (newsCache && (now - newsCache.at) < NEWS_CACHE_TTL_MS) return res.json({ ok: true, source: 'cache', items: newsCache.data });
    if (newsCache) {
      // return stale but trigger background refresh
      fetchAndCacheNews().catch(() => {});
      return res.json({ ok: true, source: 'stale', items: newsCache.data });
    }
    // no cache: start background fetch and return empty immediately
    fetchAndCacheNews().catch(() => {});
    return res.json({ ok: true, source: 'pending', items: [] });
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'news unavailable' });
  }
});

// Force refresh endpoint (admin/manual)
app.post('/api/news/refresh', async (req, res) => {
  try {
    await fetchAndCacheNews();
    return res.json({ ok: true, items: newsCache ? newsCache.data : [] });
  } catch (e) {
    return res.status(500).json({ ok: false, message: 'refresh failed' });
  }
});

// Schedule periodic background fetch (startup + interval)
setTimeout(() => { fetchAndCacheNews().catch(()=>{}); }, 1000);
setInterval(() => { fetchAndCacheNews().catch(()=>{}); }, NEWS_CACHE_TTL_MS);



app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err?.message || '서버 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`TornFi portfolio server listening on http://localhost:${PORT}`);
});
