require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const { Contract, Interface, JsonRpcProvider } = require('ethers');
const axios = require('axios');
const RSSParser = require('rss-parser');
const rssParser = new RSSParser();

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
app.use(express.static(path.join(__dirname, 'public')));

function validateAndNormalizeEthAddress(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed;
}

const INFLOW_REWARD_ADDR = REWARD_CONTRACT_ADDRESS;
const TORN_TOKEN_ADDR = TORN_TOKEN;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || process.env.CALC_ETHERSCAN_API_KEY || '';
let inflowDailySeries = { items: [], lastBuiltUtc: 0, building: false };

const DATA_DIR = path.join(__dirname, 'data');
const INFLOW_DAILY_FILE = path.join(DATA_DIR, 'inflow-daily.json');
const INFLOW_SEED_URL = process.env.INFLOW_SEED_URL || '';
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch { return fallback; }
}
function writeJsonSafe(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj));
  } catch {}
}




async function buildInflowRangeDaysTZ(days, tz) {
  if (!ETHERSCAN_KEY) return { ok: false, items: [] };
  const timeoutFetch = (url, ms = 15000) => fetch(url, { signal: AbortSignal.timeout(ms) });
  const mode = String(tz || 'utc').toLowerCase();
  const KST_MS = 9 * 60 * 60 * 1000;
  const now = new Date();
  let startTs = 0;
  let endTs = 0;
  if (mode === 'kst') {
    const nowKst = new Date(now.getTime() + KST_MS);
    const startKst = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() - Math.max(1, days), 0, 0, 0, 0));
    const endKst = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() - 1, 23, 59, 59, 999));
    startTs = Math.floor((startKst.getTime() - KST_MS) / 1000);
    endTs = Math.floor((endKst.getTime() - KST_MS) / 1000);
  } else {
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - Math.max(1, days), 0, 0, 0, 0));
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 23, 59, 59, 999));
    startTs = Math.floor(startDate.getTime() / 1000);
    endTs = Math.floor(endDate.getTime() / 1000);
  }
  const startBlockUrl = `https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblocknobytime&timestamp=${startTs}&closest=before&apikey=${ETHERSCAN_KEY}`;
  const endBlockUrl = `https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblocknobytime&timestamp=${endTs}&closest=before&apikey=${ETHERSCAN_KEY}`;
  const [startInfo, endInfo] = await Promise.all([
    timeoutFetch(startBlockUrl).then(r=>r.json()).catch(()=>null),
    timeoutFetch(endBlockUrl).then(r=>r.json()).catch(()=>null),
  ]);
  const startBlock = (startInfo && startInfo.status === '1') ? parseInt(startInfo.result, 10) : 0;
  const endBlock = (endInfo && endInfo.status === '1') ? parseInt(endInfo.result, 10) : startBlock;
  if (!startBlock || !endBlock) return { ok: false, items: [] };
  const OFFSET = 1000;
  let page = 1;
  const map = new Map();
  while (true) {
    const url =
      `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx` +
      `&contractaddress=${TORN_TOKEN_ADDR}` +
      `&address=${INFLOW_REWARD_ADDR}` +
      `&startblock=${startBlock}` +
      `&endblock=${endBlock}` +
      `&page=${page}&offset=${OFFSET}&sort=asc` +
      `&apikey=${ETHERSCAN_KEY}`;
    const data = await timeoutFetch(url).then(r=>r.json()).catch(()=>null);
    const list = (data && data.status === '1' && Array.isArray(data.result)) ? data.result : [];
    if (!list.length) break;
    for (const tx of list) {
      const ts = parseInt(tx.timeStamp || '0', 10);
      if (ts >= startTs && ts <= endTs) {
        const d = mode === 'kst' ? new Date((ts * 1000) + KST_MS) : new Date(ts * 1000);
        const key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0,10);
        const prev = map.get(key) || 0;
        const val = Number(tx.value || '0') / 1e18;
        if (isFinite(val) && val > 0) map.set(key, prev + val);
      }
    }
    if (list.length < OFFSET) break;
    page += 1;
  }
  const items = Array.from(map.entries()).sort((a,b)=> a[0] < b[0] ? -1 : 1).map(([k,v]) => ({ dateUtc: k, tornInflow: v }));
  return { ok: true, items };
}

app.get('/api/inflow/daily-series', async (_req, res) => {
  if (!inflowDailySeries.items.length) {
    ensureDataDir();
    const cached = readJsonSafe(INFLOW_DAILY_FILE, { items: [], lastBuiltUtc: 0 });
    if (Array.isArray(cached.items) && cached.items.length) {
      inflowDailySeries = cached;
      return res.json({ ok: true, lastBuiltUtc: inflowDailySeries.lastBuiltUtc, items: inflowDailySeries.items });
    }
    try {
      const q = parseInt(String(_req.query.days || '30'), 10);
      const days = isNaN(q) || q < 1 ? 30 : Math.min(5000, q);
      const r = await buildInflowRangeDaysTZ(days, 'kst');
      if (r.ok) {
        const payload = { items: r.items, lastBuiltUtc: Date.now() };
        ensureDataDir();
        writeJsonSafe(INFLOW_DAILY_FILE, payload);
        inflowDailySeries = { ...payload, building: false };
        return res.json({ ok: true, lastBuiltUtc: inflowDailySeries.lastBuiltUtc, items: inflowDailySeries.items });
      }
      return res.json({ ok: false, lastBuiltUtc: 0, items: [] });
    } catch {
      return res.json({ ok: true, lastBuiltUtc: 0, items: [] });
    }
  }
  // on-demand quick refresh for recent N days
  if (_req.query.days) {
    try {
      const q = parseInt(String(_req.query.days), 10);
      const days = isNaN(q) || q < 1 ? 30 : Math.min(5000, q);
      const r = await buildInflowRangeDaysTZ(days, 'kst');
      if (r.ok) {
        const payload = { items: r.items, lastBuiltUtc: Date.now() };
        ensureDataDir();
        writeJsonSafe(INFLOW_DAILY_FILE, payload);
        inflowDailySeries = { ...payload, building: false };
        return res.json({ ok: true, lastBuiltUtc: inflowDailySeries.lastBuiltUtc, items: inflowDailySeries.items });
      }
    } catch {}
  }
  res.json({ ok: true, lastBuiltUtc: inflowDailySeries.lastBuiltUtc, items: inflowDailySeries.items });
});

// 최신(어제) 일자 한 항목을 빠르게 반환
app.get('/api/inflow/latest', async (_req, res) => {
  try {
    ensureDataDir();
    const r = await buildInflowRangeDaysTZ(1, 'kst');
    const item = (r && r.ok && Array.isArray(r.items) && r.items.length) ? r.items.slice().sort((a,b)=> a.dateUtc < b.dateUtc ? 1 : -1)[0] : null;
    return res.json({ ok: true, item });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'latest failed' });
  }
});

app.get('/api/inflow/personal-latest', async (req, res) => {
  try {
    const addr = String(req.query.walletAddress || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return res.status(400).json({ ok: false, message: '유효한 주소가 아닙니다' });
    const tz = 'kst';
    const KST_MS = 9 * 60 * 60 * 1000;
    const now = new Date();
    // pick yesterday end by tz
    let endTs;
    const nowKst = new Date(now.getTime() + KST_MS);
    const endKst = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() - 1, 23, 59, 59, 999));
    endTs = Math.floor((endKst.getTime() - KST_MS) / 1000);
    const timeoutFetch = (url, ms = 12000) => fetch(url, { signal: AbortSignal.timeout(ms) });
    const endBlockUrl = `https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblocknobytime&timestamp=${endTs}&closest=before&apikey=${ETHERSCAN_KEY}`;
    const endInfo = await timeoutFetch(endBlockUrl).then(r=>r.json()).catch(()=>null);
    const endBlock = (endInfo && endInfo.status === '1') ? parseInt(endInfo.result, 10) : 0;
    const provider = sharedProvider;
    const stakingContract = new Contract(STAKING_CONTRACT_ADDRESS, ['function lockedBalance(address account) view returns (uint256)'], provider);
    const tornToken = new Contract(TORN_TOKEN_ADDR, ['function balanceOf(address account) view returns (uint256)'], provider);
    const overrides = endBlock ? { blockTag: endBlock } : {};
    const [lockedWei, totalWei] = await Promise.all([
      stakingContract.lockedBalance(addr, overrides).catch(()=>0n),
      tornToken.balanceOf(GOVERNANCE, overrides).catch(()=>0n),
    ]);
    const locked = Number(lockedWei) / 1e18;
    const total = Number(totalWei) / 1e18;
    const share = (locked > 0 && total > 0) ? (locked / total) : 0;
    const inflowR = await buildInflowRangeDaysTZ(1, 'kst');
    const item = (inflowR && inflowR.ok && Array.isArray(inflowR.items) && inflowR.items.length) ? inflowR.items.slice().sort((a,b)=> a.dateUtc < b.dateUtc ? 1 : -1)[0] : null;
    const tornInflow = item ? Number(item.tornInflow || 0) : 0;
    const myTorn = (share > 0 && tornInflow > 0) ? (tornInflow * share) : 0;
    return res.json({ ok: true, share, tornInflow, myTorn, item });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'personal failed' });
  }
});

// 강제 재빌드: 최근 N일을 이더스캔 로그로 재집계하여 캐시 반영
app.post('/api/inflow/rebuild', async (req, res) => {
  try {
    const r = await buildInflowRangeDaysTZ(30, 'kst');
    if (r && r.ok) {
      const payload = { items: r.items, lastBuiltUtc: Date.now() };
      ensureDataDir();
      writeJsonSafe(INFLOW_DAILY_FILE, payload);
      inflowDailySeries = { ...payload, building: false };
      return res.json({ ok: true, lastBuiltUtc: inflowDailySeries.lastBuiltUtc, items: inflowDailySeries.items });
    }
    res.status(400).json({ ok: false, message: 'rebuild failed' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'error' });
  }
});

// 캐시 삭제: 파일 및 메모리 캐시 초기화
app.post('/api/inflow/clear-cache', async (_req, res) => {
  try {
    ensureDataDir();
    if (fs.existsSync(INFLOW_DAILY_FILE)) fs.unlinkSync(INFLOW_DAILY_FILE);
    inflowDailySeries = { items: [], lastBuiltUtc: 0, building: false };
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

setTimeout(async () => {
  ensureDataDir();
  const cached = readJsonSafe(INFLOW_DAILY_FILE, { items: [], lastBuiltUtc: 0 });
  if (Array.isArray(cached.items) && cached.items.length) {
    inflowDailySeries = cached;
  } else if (INFLOW_SEED_URL) {
    try {
      const seed = await fetch(INFLOW_SEED_URL, { signal: AbortSignal.timeout(12000) }).then(r => r.json());
      if (seed && Array.isArray(seed.items) && seed.items.length) {
        const payload = { items: seed.items, lastBuiltUtc: Date.now() };
        writeJsonSafe(INFLOW_DAILY_FILE, payload);
        inflowDailySeries = { ...payload, building: false };
        return;
      }
    } catch {}
  } else {
    const r = await buildInflowRangeDaysTZ(30, 'kst');
    if (r && r.ok) {
      const payload = { items: r.items, lastBuiltUtc: Date.now() };
      writeJsonSafe(INFLOW_DAILY_FILE, payload);
      inflowDailySeries = { ...payload, building: false };
    }
  }
}, 1000);
// 매일 어제값만 보강
setInterval(async () => {
  try {
    const r = await buildInflowRangeDaysTZ(1, 'kst');
    if (r && r.ok) {
      ensureDataDir();
      const cached = readJsonSafe(INFLOW_DAILY_FILE, { items: [], lastBuiltUtc: 0 });
      const map = new Map();
      for (const it of Array.isArray(cached.items) ? cached.items : []) map.set(it.dateUtc, Number(it.tornInflow || 0));
      for (const it of r.items) map.set(it.dateUtc, Number(it.tornInflow || 0));
      const merged = Array.from(map.entries()).sort((a,b)=> a[0] < b[0] ? -1 : 1).map(([k,v]) => ({ dateUtc: k, tornInflow: v }));
      const payload = { items: merged, lastBuiltUtc: Date.now() };
      writeJsonSafe(INFLOW_DAILY_FILE, payload);
      inflowDailySeries = { ...payload, building: false };
    }
  } catch {}
}, 24 * 60 * 60 * 1000);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calculator.html'));
});

app.get('/api/calculator/premium', async (_req, res) => {
  const now = Date.now();
  if (calcPremiumCache && now - calcPremiumCache.at < CALC_PREMIUM_CACHE_TTL_MS) {
    return res.json(calcPremiumCache.data);
  }

  const timeoutFetch = (url, ms = 2500) => fetch(url, { signal: AbortSignal.timeout(ms) });
  const [coingeckoRes, upbitRes] = await Promise.allSettled([
    timeoutFetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=krw').then((r) => r.json()),
    timeoutFetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC').then((r) => r.json()),
  ]);

  const coingecko = coingeckoRes.status === 'fulfilled' ? coingeckoRes.value : null;
  const upbit = upbitRes.status === 'fulfilled' ? upbitRes.value : null;
  const btcKrw = coingecko?.bitcoin?.krw || calcPremiumCache?.data?.btcKrw || null;
  let premium = null;
  if (btcKrw && upbit && Array.isArray(upbit) && upbit[0]?.trade_price) {
    premium = Math.round(((upbit[0].trade_price - btcKrw) / btcKrw) * 10000) / 100;
  } else if (calcPremiumCache?.data?.premium != null) {
    premium = calcPremiumCache.data.premium;
  }

  const payload = {
    ok: true,
    premium,
    btcKrw,
  };

  calcPremiumCache = { at: now, data: payload };
  res.json(payload);
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
    const [stakedWei, rewardWei, balanceWei] = await Promise.all([
      stakingContract.lockedBalance(walletAddress),
      rewardContract.checkReward(walletAddress).catch(() => 0n),
      tornToken.balanceOf(walletAddress).catch(() => 0n),
    ]);
    const toNumber = (value) => Number(value) / Math.pow(10, 18);
    res.json({
      ok: true,
      walletAddress,
      staked: toNumber(stakedWei),
      reward: toNumber(rewardWei),
      walletBalance: toNumber(balanceWei),
    });
  } catch (error) {
    res.status(502).json({ ok: false, message: error?.message || '지갑 조회에 실패했습니다.' });
  }
});

// News endpoint: gather only Korean RSS feeds, dedupe and cache results
let newsFetchInProgress = false;
async function fetchAndCacheNews() {
  if (newsFetchInProgress) return;
  newsFetchInProgress = true;
  try {
    // Use Google News (KR) only to avoid low-match duplicates from other feeds
    const sources = [
      { name: 'Google News (KR)', url: 'https://news.google.com/rss/search?q=Tornado+Cash+OR+TORN&hl=ko&gl=KR&ceid=KR:ko' }
    ];
    const results = [];

    // keywords: expanded set to catch variants
    const NEWS_KEYWORDS = [
      '토네이도 캐시', '토네이도', '토네이도캐시',
      'tornadocash', 'tornado cash', 'tornado',
      'torn', 'torn.'
    ];

    // helper: try parsing RSS; if it fails, fetch the page and look for an RSS link or parse returned XML
    async function parseFeedWithFallback(url) {
      try {
        return await rssParser.parseURL(url);
      } catch (err) {
        try {
          const resp = await axios.get(url, { timeout: 10000 });
          const html = String(resp.data || '');
          // look for <link type="application/rss+xml" href="...">
          let m = html.match(/<link[^>]+type=["']application\/rss\+xml["'][^>]*href=["']([^"']+)["']/i);
          if (!m) m = html.match(/href=["']([^"']+\.(?:xml|rss|atom))["']/i);
          if (m && m[1]) {
            try {
              const feedUrl = new URL(m[1], url).toString();
              return await rssParser.parseURL(feedUrl);
            } catch (e2) {
              // fallthrough to parseString
            }
          }
          // as a last resort, try to parse the fetched body as XML
          return await rssParser.parseString(html);
        } catch (e) {
          throw err;
        }
      }
    }

    for (const s of sources) {
      try {
        const feed = await parseFeedWithFallback(s.url);
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
        console.error(`${s.name} RSS fetch failed:`, e && e.message);
      }
    }

    // dedupe and filter recent (last 30 days)
      const retentionDays = 180;
      const cutoff = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const map = new Map();
    results.forEach(it => {
      const title = String(it.title || '');
      const key = (it.link || title).trim();
      if (!key) return;
      if (map.has(key)) return;
      let ts = 0;
      try { ts = it.isoDate ? Date.parse(it.isoDate) : 0; } catch(e) { ts = 0; }
      const tLower = title.toLowerCase();
      if (!NEWS_KEYWORDS.some(kw => tLower.includes(kw))) return;
        if (ts && ts < cutoff) return;
      map.set(key, Object.assign({ timestamp: ts || Date.now() }, it));
    });

    const items = Array.from(map.values()).sort((a,b)=> (b.timestamp||0)-(a.timestamp||0)).slice(0,50);

    // Using Korean RSS sources; no translation step required here.

    newsCache = { at: Date.now(), data: items };
    try { ensureDataDir(); writeJsonSafe(path.join(DATA_DIR, 'news_raw.json'), items); } catch (e) { console.warn('failed to write news_raw.json', e && e.message); }
    return items;
  } finally {
    newsFetchInProgress = false;
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
