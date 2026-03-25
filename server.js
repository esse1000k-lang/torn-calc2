require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');
const { Contract, Interface, JsonRpcProvider } = require('ethers');
const { getKimchiPremium } = require('./scripts/compute-kimchi');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CALC_PRICE_CACHE_TTL_MS = 30 * 1000;      // 가격 캐시: 30 초 (불필요한 외부 API 호출 감소)
const CALC_PREMIUM_CACHE_TTL_MS = 15 * 1000;     // 김치프리미엄: 15 초
const CALC_TOTAL_STAKED_CACHE_TTL_MS = 120 * 1000; // 총 스테이킹량: 2 분
let calcPriceCache = null;
let calcPremiumCache = null;
let calcTotalStakedCache = null;

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
  if (!raw) return 'https://rpc.ankr.com/eth';
  if (/^https?:\/\//i.test(raw)) return raw;
  return 'https://mainnet.infura.io/v3/' + raw;
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

// JSON parser with stricter limits (security)
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));
// Compression middleware - maximum compression for bandwidth savings
app.use(compression({ 
  level: 9,           // 최대 압축률
  threshold: 1024,    // 1KB 이상 응답만 압축
  filter: () => true  // 모든 MIME 타입 허용
}));
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

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calculator.html'));
});

app.get('/api/calculator/premium', async (_req, res) => {
  const now = Date.now();
  // Return cached data if still valid
  if (calcPremiumCache && now - calcPremiumCache.at < CALC_PREMIUM_CACHE_TTL_MS) {
    return res.json(calcPremiumCache.data);
  }

  try {
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
  // Return cached data if still valid
  if (calcPriceCache && now - calcPriceCache.at < CALC_PRICE_CACHE_TTL_MS) {
    return res.json(calcPriceCache.data);
  }

  const timeoutFetch = (url, ms = 8000) => fetch(url, { signal: AbortSignal.timeout(ms) });

  // Check cache for totalStaked to avoid unnecessary multicall
  const totalStakedFromCache = (calcTotalStakedCache && now - calcTotalStakedCache.at < CALC_TOTAL_STAKED_CACHE_TTL_MS)
    ? calcTotalStakedCache.data : null;

  // Batch Uniswap + totalStaked via Multicall3 for efficiency
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

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ ok: false, message: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`TornFi portfolio server listening on http://localhost:${PORT}`);
});
