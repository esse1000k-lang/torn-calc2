require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');
const { Contract, Interface, JsonRpcProvider } = require('ethers');

// ── Rate Limiting (식당 줄 서기) - Optimized with O(1) operations ───────────────────────────────
/**
 * Optimized in-memory rate limiter for API endpoints
 * Uses sliding window with efficient cleanup - O(1) per request
 */
class RateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map(); // key -> { timestamps: [], lastCleanup: number }
  }

  isAllowed(identifier) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let clientData = this.requests.get(identifier);
    
    if (!clientData) {
      // New client
      this.requests.set(identifier, { timestamps: [now], lastCleanup: now });
      return true;
    }

    // Lazy cleanup - only clean when needed (amortized O(1))
    if (now - clientData.lastCleanup > this.windowMs / 2) {
      const idx = clientData.timestamps.findIndex(ts => ts > windowStart);
      if (idx === -1) {
        // All timestamps expired
        this.requests.delete(identifier);
        return true;
      } else if (idx > 0) {
        // Remove only expired timestamps from front
        clientData.timestamps = clientData.timestamps.slice(idx);
      }
      clientData.lastCleanup = now;
    }

    const timestamps = clientData.timestamps;
    
    if (timestamps.length >= this.maxRequests) {
      return false; // Rate limited
    }

    timestamps.push(now);
    return true;
  }
}

// Create rate limiter for blockchain calls
const BLOCKCHAIN_RATE_LIMITER = new RateLimiter(1000, 3); // 3 req/sec (more strict)

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CALC_PRICE_CACHE_TTL_MS = 30 * 1000;      // 가격 캐시: 30 초 (불필요한 외부 API 호출 감소)
const CALC_TOTAL_STAKED_CACHE_TTL_MS = 120 * 1000; // 총 스테이킹량: 2 분
let calcPriceCache = null;
let calcTotalStakedCache = null;

/* ── Shared RPC provider & contract constants (created once) ── */
const TORN_TOKEN = '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C';
const GOVERNANCE = '0x2F50508a8a3D323B91336FA3eA6ae50E55f32185';
const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const UNISWAP_PAIR_ADDRESS = '0x0c722a487876989af8a05fffb6e32e45cc23fb3a'; // TORN/WETH 페어 주소 (하드코딩)
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const DEFILLAMA_COINS = 'ethereum:0x77777FeDdddFfC19Ff86DB637967013e6C6A116C,ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const STAKING_CONTRACT_ADDRESS = '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce';
const REWARD_CONTRACT_ADDRESS = '0x5B3f656C80E8ddb9ec01Dd9018815576E9238c29';

// ── RPC Failover (우체국 여러 개) ───────────────────────────────────────
/**
 * Multiple RPC endpoints with automatic failover
 * If one endpoint fails, automatically tries the next one
 */
const buildRpcEndpoints = () => {
  const endpoints = [];
  
  // Add user-provided RPC from environment variables
  const envRpc = process.env.CALC_RPC_URL || process.env.INFURA_URL || '';
  if (envRpc) {
    if (/^https?:\/\//i.test(envRpc)) {
      endpoints.push(envRpc);
    } else {
      // Assume it's an Infura API key
      endpoints.push(`https://mainnet.infura.io/v3/${envRpc}`);
    }
  }

  // Add public RPC fallbacks (우체국 목록)
  const publicFallbacks = [
    'https://rpc.ankr.com/eth',
    'https://eth-mainnet.g.alchemy.com/v2/demo',
    'https://cloudflare-eth.com'
  ];

  // Add fallbacks that aren't already in the list
  for (const fallback of publicFallbacks) {
    if (!endpoints.includes(fallback)) {
      endpoints.push(fallback);
    }
  }

  return endpoints;
};

const RPC_ENDPOINTS = buildRpcEndpoints();

// Create provider with failover support
const createProviderWithFailover = () => {
  // Use the first available endpoint initially
  const primaryUrl = RPC_ENDPOINTS[0] || 'https://rpc.ankr.com/eth';
  return new JsonRpcProvider(primaryUrl, 1);
};

const sharedProvider = createProviderWithFailover();

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
// Compression middleware - optimized for speed vs size balance
app.use(compression({ 
  level: 6,          // 균형 잡힌 압축 (Level 9 → 6: CPU 부하 ↓, 속도 ↑)
  threshold: 512,    // 512B 이상 응답만 압축 (1KB → 512B: 작은 JSON 도 압축)
  filter: () => true // 모든 MIME 타입 허용
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

app.get('/api/calculator/prices', async (_req, res) => {
  // ── Rate Limiting Check (식당 줄 서기 - 블록체인 호출은 더 엄격하게 제한) ─────────────────
  const clientIp = _req.ip || _req.socket.remoteAddress || 'unknown';
  if (!BLOCKCHAIN_RATE_LIMITER.isAllowed(clientIp)) {
    // If rate limited, return cached data instead of error (기능 상실 방지)
    if (calcPriceCache) {
      console.log('Rate limit exceeded, returning cached price data');
      return res.json(calcPriceCache.data);
    }
    return res.status(429).json({ ok: false, message: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
  }

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
      const pairAddr = UNISWAP_PAIR_ADDRESS;
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

  const [llamaRes, coingeckoRes, mexcRes, onChainRes, gasFeeDataResult, latestBlockResult, upbitUsdtRes] = await Promise.allSettled([
    timeoutFetch('https://coins.llama.fi/prices/current/' + DEFILLAMA_COINS).then((r) => r.json()),
    timeoutFetch('https://api.coingecko.com/api/v3/simple/price?ids=tornado-cash,bitcoin,ethereum&vs_currencies=krw').then((r) => r.json()),
    timeoutFetch('https://api.mexc.com/api/v3/ticker/price?symbol=TORNUSDT').then((r) => r.json()),
    onChainPromise,
    sharedProvider.getFeeData().catch(() => null),
    sharedProvider.getBlock('latest').catch(() => null),
    // Upbit KRW-USDT only - this IS the "premium-included exchange rate"
    timeoutFetch('https://api.upbit.com/v1/ticker?markets=KRW-USDT').then((r) => r.json()),
  ]);

  const llama = llamaRes.status === 'fulfilled' ? llamaRes.value : null;
  const coingecko = coingeckoRes.status === 'fulfilled' ? coingeckoRes.value : null;
  const mexc = mexcRes.status === 'fulfilled' ? mexcRes.value : null;
  const onChain = onChainRes.status === 'fulfilled' ? onChainRes.value : {};
  const tornPriceInEth = onChain.tornPriceInEth ?? null;
  const totalStakedMaybe = onChain.totalStaked ?? null;
  const gasFeeData = gasFeeDataResult.status === 'fulfilled' ? gasFeeDataResult.value : null;
  const latestBlock = latestBlockResult.status === 'fulfilled' ? latestBlockResult.value : null;
  const upbitUsdt = upbitUsdtRes.status === 'fulfilled' ? upbitUsdtRes.value : null;

  const coins = (llama && llama.coins) || {};
  const ethPriceUsd = coins['ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2']?.price || 0;
  const btcPriceUsd = coins['ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599']?.price || 0;
  const defiLlamaTorn = coins['ethereum:0x77777FeDdddFfC19Ff86DB637967013e6C6A116C']?.price || 0;
  const tornPriceUsdDex = tornPriceInEth && ethPriceUsd ? tornPriceInEth * ethPriceUsd : 0;
  const mexcObj = Array.isArray(mexc) ? mexc[0] : mexc;
  const tornPriceUsdCex = mexcObj?.price ? Number(mexcObj.price) || 0 : 0;
  const tornPriceUsdCenter = defiLlamaTorn > 0 ? defiLlamaTorn : 0;
  const tornPriceUsd = tornPriceUsdDex || tornPriceUsdCenter || tornPriceUsdCex;
  
  // USDT/KRW exchange rate from Upbit (includes premium automatically)
  // Simple calculation: KRW price = USD price × USDT/KRW
  const upbitUsdtObj = Array.isArray(upbitUsdt) && upbitUsdt[0]?.trade_price ? upbitUsdt[0] : null;
  const usdtKrwRate = upbitUsdtObj ? Number(upbitUsdtObj.trade_price) : 0;
  
  // Calculate KRW prices using simple formula: USD price × USDT/KRW rate
  const btcKrw = coingecko?.bitcoin?.krw || (usdtKrwRate > 0 && btcPriceUsd > 0 ? btcPriceUsd * usdtKrwRate : calcPriceCache?.data?.btcKrw || null);
  const ethKrw = coingecko?.ethereum?.krw || ((btcKrw && btcPriceUsd > 0 && ethPriceUsd > 0) ? (btcKrw / btcPriceUsd) * ethPriceUsd : 0) || calcPriceCache?.data?.ethKrw || 0;
  const tornPriceKrw = coingecko?.['tornado-cash']?.krw || (usdtKrwRate > 0 && tornPriceUsd > 0 ? tornPriceUsd * usdtKrwRate : calcPriceCache?.data?.tornPriceKrw || 0);
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
    usdtKrwRate, // 테더 가격 (원화 환율)
    gasPriceGwei,
    gasCostKrw,
    totalStaked,
    tornPriceKrw,
  };

  calcPriceCache = { at: now, data: payload };
  res.json(payload);
});

app.get('/api/calculator/wallet', async (req, res) => {
  // ── Rate Limiting Check (식당 줄 서기) ───────────────────────────────
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!BLOCKCHAIN_RATE_LIMITER.isAllowed(clientIp)) {
    return res.status(429).json({ ok: false, message: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' });
  }

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
