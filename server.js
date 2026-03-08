require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const { Contract, Interface, JsonRpcProvider } = require('ethers');
const db = require('./lib/db');
const chatDB = require('./db-sqlite');

const app = express();
const server = http.createServer(app);

// SQLite 데이터베이스 초기화 및 정리 스케줄러
(async () => {
    try {
        await chatDB.connect();
        console.log('채팅 데이터베이스 초기화 완료');
        
        // 6시간마다 오래된 메시지 정리
        setInterval(async () => {
            try {
                const deletedCount = await chatDB.cleanupOldMessages(180);
                if (deletedCount > 0) {
                    console.log(`자동 정리: ${deletedCount}개의 오래된 메시지 삭제`);
                }
            } catch (cleanupError) {
                console.error('자동 정리 오류:', cleanupError);
            }
        }, 6 * 60 * 60 * 1000); // 6시간 간격
        
        // 서버 시작 시 한번 정리 실행
        const initialCleanup = await chatDB.cleanupOldMessages(180);
        if (initialCleanup > 0) {
            console.log(`초기 정리: ${initialCleanup}개의 오래된 메시지 삭제`);
        }
        
    } catch (dbError) {
        console.error('데이터베이스 초기화 오류:', dbError);
    }
})();

/** * Socket.IO 초고속 엔진 설정 */
const io = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket'] 
});
const PORT = Number(process.env.PORT || 3000);
const CHAT_MIN_INTERVAL_MS = 1500;
const CALC_PRICE_CACHE_TTL_MS = 12 * 1000;
const CALC_PREMIUM_CACHE_TTL_MS = 3 * 1000;
const CALC_TOTAL_STAKED_CACHE_TTL_MS = 60 * 1000;
let calcPriceCache = null;
let calcPremiumCache = null;
let calcTotalStakedCache = null;

const chatLastSentAt = new Map();

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

const uploadDir = path.join(__dirname, 'public', 'uploads', 'chat');
ensureDir(uploadDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const uploadChatImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype || '');
    cb(ok ? null : new Error('이미지는 JPG, PNG, GIF, WEBP만 가능합니다.'), ok);
  },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeAnonName(name) {
  let decoded = String(name || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {}
  const raw = decoded.trim().replace(/\s+/g, ' ');
  if (!raw) return '익명';
  return raw.slice(0, 12);
}

function getAnon(req) {
  const id = String(req.headers['x-anon-id'] || '').trim().slice(0, 64);
  const displayName = normalizeAnonName(req.headers['x-anon-name']);
  if (!id) return null;
  return { id, displayName };
}

function requireAnon(req, res, next) {
  const anon = getAnon(req);
  if (!anon) return res.status(400).json({ ok: false, message: '익명 사용자 정보가 없습니다. 새로고침 후 다시 시도해 주세요.' });
  req.anon = anon;
  next();
}

function checkSpam(req, res, next) {
  const anon = req.anon;
  const now = Date.now();
  const last = chatLastSentAt.get(anon.id);
  if (last && now - last < CHAT_MIN_INTERVAL_MS) {
    return res.status(429).json({ ok: false, message: '메시지는 잠시 후 다시 보낼 수 있습니다.' });
  }
  chatLastSentAt.set(anon.id, now);
  next();
}

function validateAndNormalizeEthAddress(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return null;
  return trimmed;
}

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calculator.html'));
});

app.get('/api/chat', async (req, res) => {
  const messages = await db.readChatMessages();
  const anon = getAnon(req);
  res.json({
    ok: true,
    me: anon ? { id: anon.id, displayName: anon.displayName } : null,
    messages,
  });
});

app.post('/api/chat', requireAnon, checkSpam, uploadChatImage.single('image'), async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
  const hasImage = !!(req.file && req.file.filename);
  if (!text && !hasImage) return res.status(400).json({ ok: false, message: '메시지 또는 사진을 입력해 주세요.' });
  const message = await db.appendChatMessage({
    userId: req.anon.id,
    displayName: req.anon.displayName,
    text,
    imageUrl: hasImage ? `/uploads/chat/${req.file.filename}` : undefined,
    replyToMessageId: typeof req.body?.replyToMessageId === 'string' ? req.body.replyToMessageId.trim() : undefined,
    replyToText: typeof req.body?.replyToText === 'string' ? req.body.replyToText.trim().slice(0, 100) : undefined,
  });
  res.json({ ok: true, message });
});

app.patch('/api/chat/:messageId', requireAnon, async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
  if (!text) return res.status(400).json({ ok: false, message: '내용을 입력해 주세요.' });
  const updated = await db.updateChatMessage(req.params.messageId, req.anon.id, { text });
  if (!updated) return res.status(403).json({ ok: false, message: '본인 메시지만 수정할 수 있습니다.' });
  res.json({ ok: true, message: updated });
});

app.delete('/api/chat/:messageId', requireAnon, async (req, res) => {
  const deleted = await db.deleteChatMessage(req.params.messageId, req.anon.id);
  if (!deleted) return res.status(403).json({ ok: false, message: '본인 메시지만 삭제할 수 있습니다.' });
  res.json({ ok: true, message: '삭제되었습니다.' });
});

app.post('/api/chat/:messageId/send-heart', requireAnon, async (req, res) => {
  const result = await db.incrementMessageHearts(req.params.messageId, req.anon.id);
  if (!result.ok) {
    if (result.reason === 'self') return res.status(400).json({ ok: false, message: '내 메시지에는 좋아요를 누를 수 없습니다.' });
    if (result.reason === 'duplicate') return res.status(400).json({ ok: false, message: '이미 좋아요를 눌렀습니다.' });
    return res.status(404).json({ ok: false, message: '메시지를 찾을 수 없습니다.' });
  }
  res.json({ ok: true, heartsReceived: result.heartsReceived, message: '좋아요를 눌렀습니다.' });
});

app.delete('/api/chat', requireAnon, async (req, res) => {
  await db.clearChatMessages();
  res.json({ ok: true, message: '채팅이 비워졌습니다.' });
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

  const TORN_TOKEN = '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C';
  const GOVERNANCE = '0x2F50508a8a3D323B91336FA3eA6ae50E55f32185';
  const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
  const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
  const DEFILLAMA_COINS = 'ethereum:0x77777FeDdddFfC19Ff86DB637967013e6C6A116C,ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2,ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
  const RPC_URL = process.env.CALC_RPC_URL || process.env.INFURA_URL || 'https://mainnet.infura.io/v3/fa141c0488f14212b912c04114f23f84';
  const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || process.env.CALC_ETHERSCAN_API_KEY || 'DSPENWH1HPF4H8P3WZNM6HCFT3G4238JM6';
  const timeoutFetch = (url, ms = 8000) => fetch(url, { signal: AbortSignal.timeout(ms) });
  const totalStakedPromise = (calcTotalStakedCache && now - calcTotalStakedCache.at < CALC_TOTAL_STAKED_CACHE_TTL_MS)
    ? Promise.resolve(calcTotalStakedCache.data)
    : timeoutFetch(`https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokenbalance&contractaddress=${TORN_TOKEN}&address=${GOVERNANCE}&tag=latest&apikey=${ETHERSCAN_KEY}`).then((r) => r.json());
  const provider = new JsonRpcProvider(RPC_URL);

  const [llamaRes, coingeckoRes, mexcRes, etherscanRes, uniswapResult, gasFeeDataResult, latestBlockResult, upbitRes] = await Promise.allSettled([
    timeoutFetch('https://coins.llama.fi/prices/current/' + DEFILLAMA_COINS).then((r) => r.json()),
    timeoutFetch('https://api.coingecko.com/api/v3/simple/price?ids=tornado-cash,bitcoin,ethereum&vs_currencies=krw').then((r) => r.json()),
    timeoutFetch('https://api.mexc.com/api/v3/ticker/price?symbol=TORNUSDT').then((r) => r.json()),
    totalStakedPromise,
    (async () => {
      try {
        const factory = new Contract(UNISWAP_V2_FACTORY, ['function getPair(address,address) view returns (address)'], provider);
        const pairAddr = await factory.getPair(TORN_TOKEN, WETH);
        if (!pairAddr || pairAddr === '0x0000000000000000000000000000000000000000') return null;
        const pairAbi = ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'];
        const pairIface = new Interface(pairAbi);
        const multicall = new Contract(MULTICALL3, ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)'], provider);
        const results = await multicall.aggregate3([
          { target: pairAddr, allowFailure: false, callData: pairIface.encodeFunctionData('getReserves', []) },
          { target: pairAddr, allowFailure: false, callData: pairIface.encodeFunctionData('token0', []) },
        ]);
        if (!results?.[0]?.returnData || !results?.[1]?.returnData) return null;
        const [reserve0, reserve1] = pairIface.decodeFunctionResult('getReserves', results[0].returnData);
        const token0Addr = pairIface.decodeFunctionResult('token0', results[1].returnData)[0];
        const isTorn0 = String(token0Addr).toLowerCase() === TORN_TOKEN.toLowerCase();
        const reserveTorn = isTorn0 ? reserve0 : reserve1;
        const reserveWeth = isTorn0 ? reserve1 : reserve0;
        if (reserveTorn === 0n) return null;
        return Number(reserveWeth) / Number(reserveTorn);
      } catch {
        return null;
      }
    })(),
    provider.getFeeData().catch(() => null),
    provider.getBlock('latest').catch(() => null),
    timeoutFetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC').then((r) => r.json()),
  ]);

  const llama = llamaRes.status === 'fulfilled' ? llamaRes.value : null;
  const coingecko = coingeckoRes.status === 'fulfilled' ? coingeckoRes.value : null;
  const mexc = mexcRes.status === 'fulfilled' ? mexcRes.value : null;
  const etherscan = etherscanRes.status === 'fulfilled' ? etherscanRes.value : null;
  const tornPriceInEth = uniswapResult.status === 'fulfilled' ? uniswapResult.value : null;
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

  let totalStaked = 0;
  if (etherscan?.status === '1' && etherscan?.message === 'OK' && etherscan?.result) {
    const raw = String(etherscan.result);
    if (raw && raw !== '0') {
      const decimals = 18;
      const len = raw.length;
      totalStaked = len <= decimals ? parseFloat('0.' + raw.padStart(decimals, '0')) : parseFloat(raw.slice(0, len - decimals) + '.' + raw.slice(-decimals));
    }
  }
  if (totalStaked > 0) calcTotalStakedCache = { at: now, data: { status: '1', message: 'OK', result: etherscan.result } };
  else if (calcTotalStakedCache?.data?.status === '1' && calcTotalStakedCache?.data?.message === 'OK' && calcTotalStakedCache?.data?.result) {
    const raw = String(calcTotalStakedCache.data.result);
    const decimals = 18;
    const len = raw.length;
    totalStaked = len <= decimals ? parseFloat('0.' + raw.padStart(decimals, '0')) : parseFloat(raw.slice(0, len - decimals) + '.' + raw.slice(-decimals));
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

  const TORN_TOKEN_ADDRESS = '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C';
  const STAKING_CONTRACT_ADDRESS = '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce';
  const REWARD_CONTRACT_ADDRESS = '0x5B3f656C80E8ddb9ec01Dd9018815576E9238c29';
  const STAKING_RPC_URL = process.env.CALC_RPC_URL || process.env.INFURA_URL || 'https://mainnet.infura.io/v3/fa141c0488f14212b912c04114f23f84';

  try {
    const provider = new JsonRpcProvider(STAKING_RPC_URL);
    const stakingContract = new Contract(STAKING_CONTRACT_ADDRESS, ['function lockedBalance(address account) view returns (uint256)'], provider);
    const rewardContract = new Contract(REWARD_CONTRACT_ADDRESS, ['function checkReward(address account) view returns (uint256 rewards)'], provider);
    const tornToken = new Contract(TORN_TOKEN_ADDRESS, ['function balanceOf(address account) view returns (uint256)'], provider);
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

app.get('/api/calculator/yesterday-pool-inflow', async (_req, res) => {
  const REWARD_CONTRACT_ADDRESS = '0x5B3f656C80E8ddb9ec01Dd9018815576E9238c29';
  const TORN_TOKEN_ADDRESS = '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C';
  const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || process.env.CALC_ETHERSCAN_API_KEY || 'DSPENWH1HPF4H8P3WZNM6HCFT3G4238JM6';
  const timeoutFetch = (url, ms = 12000) => fetch(url, { signal: AbortSignal.timeout(ms) });
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowUtcMs = Date.now();
  const nowKst = new Date(nowUtcMs + KST_OFFSET_MS);
  const yStartKst = new Date(nowKst);
  yStartKst.setDate(yStartKst.getDate() - 1);
  yStartKst.setHours(0, 0, 0, 0);
  const yEndKst = new Date(nowKst);
  yEndKst.setDate(yEndKst.getDate() - 1);
  yEndKst.setHours(23, 59, 59, 999);
  const startTs = Math.floor((yStartKst.getTime() - KST_OFFSET_MS) / 1000);
  const endTs = Math.floor((yEndKst.getTime() - KST_OFFSET_MS) / 1000);
  try {
    const startBlockUrl = `https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblocknobytime&timestamp=${startTs}&closest=before&apikey=${ETHERSCAN_KEY}`;
    const endBlockUrl = `https://api.etherscan.io/v2/api?chainid=1&module=block&action=getblocknobytime&timestamp=${endTs}&closest=before&apikey=${ETHERSCAN_KEY}`;
    const [startInfo, endInfo] = await Promise.all([
      timeoutFetch(startBlockUrl).then((r) => r.json()),
      timeoutFetch(endBlockUrl).then((r) => r.json()),
    ]);
    const startBlock = (startInfo && startInfo.status === '1') ? parseInt(startInfo.result, 10) : 0;
    const endBlock = (endInfo && endInfo.status === '1') ? parseInt(endInfo.result, 10) : startBlock;
    if (!startBlock || !endBlock) throw new Error('블록 경계 조회 실패');
    const OFFSET = 100;
    let page = 1;
    let totalTorn = 0;
    while (true) {
      const url =
        `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx` +
        `&contractaddress=${TORN_TOKEN_ADDRESS}` +
        `&address=${REWARD_CONTRACT_ADDRESS}` +
        `&startblock=${startBlock}` +
        `&endblock=${endBlock}` +
        `&page=${page}&offset=${OFFSET}&sort=asc` +
        `&apikey=${ETHERSCAN_KEY}`;
      const data = await timeoutFetch(url).then((r) => r.json()).catch(() => null);
      const list = (data && data.status === '1' && Array.isArray(data.result)) ? data.result : [];
      if (list.length === 0) break;
      for (const tx of list) {
        if (!tx || !tx.to) continue;
        const toAddr = String(tx.to).toLowerCase();
        if (toAddr !== REWARD_CONTRACT_ADDRESS.toLowerCase()) continue;
        const ts = parseInt(tx.timeStamp || '0', 10);
        if (ts < startTs || ts > endTs) continue;
        const val = Number(tx.value || '0') / 1e18;
        if (isFinite(val) && val > 0) totalTorn += val;
      }
      if (list.length < OFFSET) break;
      page += 1;
    }
    res.json({
      ok: true,
      dateKst: yStartKst.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }),
      startTs,
      endTs,
      startBlock,
      endBlock,
      yesterdayPoolInflowTorn: totalTorn,
    });
  } catch (error) {
    res.status(502).json({ ok: false, message: error?.message || '어제 유입 조회에 실패했습니다.' });
  }
});

/**
 * DOGE 채팅방 라우트
 */
app.get('/doge-chat', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>TornFi | DOGE-ROOM</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        /* 앱 같은 터치감과 부드러운 애니메이션 */
        .message-fade { animation: fadeIn 0.2s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        body { -webkit-tap-highlight-color: transparent; overscroll-behavior-y: contain; }
        #messages::-webkit-scrollbar { width: 4px; }
        #messages::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 10px; }
    </style>
</head>
<body class="bg-black text-white font-sans antialiased">
    <div id="app" class="flex flex-col h-screen max-w-md mx-auto border-x border-gray-800 shadow-2xl overflow-hidden">
        
        <header class="p-4 bg-gray-900/80 backdrop-blur-md border-b border-gray-800 flex justify-between items-center sticky top-0 z-10">
            <div>
                <h1 class="text-lg font-black tracking-tighter text-red-500">DOGE-ROOM</h1>
                <p class="text-[10px] text-gray-500 font-mono">CONNECTED TO M4_SERVER</p>
            </div>
            <div class="flex items-center gap-2">
                <span class="relative flex h-2 w-2">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span class="text-xs font-bold text-green-500">LIVE</span>
            </div>
        </header>

        <main id="messages" class="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth bg-gradient-to-b from-gray-900 to-black">
            <div class="text-center py-10 text-gray-600 text-xs">
                <p>9년 생존자의 통찰이 시작되는 곳</p>
                <p class="mt-1 opacity-50">무가입 익명 채팅방에 오신 것을 환영합니다.</p>
            </div>
        </main>

        <footer class="p-4 bg-gray-900 border-t border-gray-800">
            <form id="chat-form" class="flex items-end gap-2">
                <div class="flex-1 bg-gray-800 rounded-2xl px-4 py-2 border border-gray-700 focus-within:border-red-500 transition-colors">
                    <textarea id="input" rows="1" class="w-full bg-transparent border-none focus:outline-none text-sm py-1 resize-none" placeholder="광기를 쏟아내세요..."></textarea>
                </div>
                <button type="submit" class="bg-red-600 hover:bg-red-500 active:scale-90 h-10 w-10 flex items-center justify-center rounded-full transition-all duration-100 shadow-lg shadow-red-900/20">
                    <svg viewBox="0 0 24 24" class="w-5 h-5 fill-white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </form>
        </footer>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io({ transports: ['websocket'] });
        const messages = document.getElementById('messages');
        const form = document.getElementById('chat-form');
        const input = document.getElementById('input');

        // 접속 즉시 방 참여
        socket.emit('join', 'torn-room');

        // 메시지 수신 처리
        socket.on('chat', (data) => {
            const div = document.createElement('div');
            div.className = "message-fade flex flex-col items-start";
            div.innerHTML = \`
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-[10px] font-bold text-gray-500 uppercase">\${data.user}</span>
                    <span class="text-[9px] text-gray-700 font-mono">\${data.time}</span>
                </div>
                <div class="bg-gray-800 rounded-2xl rounded-tl-none px-4 py-2 text-sm border border-gray-700/50 shadow-sm max-w-[90%] break-all">
                    \${data.text}
                </div>
            \`;
            messages.appendChild(div);
            // 즉시 하단 스크롤 (앱 감성)
            messages.scrollTop = messages.scrollHeight;
        });

        // 엔터키 전송 (모바일 고려)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                form.dispatchEvent(new Event('submit'));
            }
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (text) {
                socket.emit('message', { room: 'torn-room', text: text });
                input.value = '';
                input.style.height = 'auto';
            }
        });

        // 자동 높이 조절
        input.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    </script>
</body>
</html>
    `);
});

/**
 * Socket.IO DOGE 채팅방 로직
 */
io.on('connection', (socket) => {
    const shortId = socket.id.substring(0, 4).toUpperCase();
    
    socket.on('join', async (room) => {
        socket.join(room);
        console.log(`[TORN-CHAT JOIN] ${shortId} -> ${room}`);
        
        // 접속 시 최근 메시지 100개 로드
        try {
            const messages = await chatDB.getMessages(room, 100);
            messages.forEach(msg => {
                socket.emit('chat', {
                    user: msg.nickname,
                    text: msg.message,
                    time: new Date(msg.created_at).toLocaleTimeString('ko-KR', { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        second: '2-digit' 
                    })
                });
            });
            console.log(`[TORN-CHAT HISTORY] ${shortId}에게 ${messages.length}개 메시지 전송`);
        } catch (error) {
            console.error('메시지 히스토리 로드 오류:', error);
        }
    });

    socket.on('message', async (data) => {
        const messageData = {
            user: "ㅇㅇ(" + shortId + ")",
            text: data.text,
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        };
        
        // 1. 먼저 실시간으로 모든 유저에게 메시지 전송 (속도 우선)
        io.to(data.room).emit('chat', messageData);
        
        // 2. 비동기로 데이터베이스에 저장 (속도 영향 없음)
        setTimeout(async () => {
            try {
                await chatDB.saveMessage(messageData.user, data.text, data.room);
                console.log(`[TORN-CHAT SAVED] ${shortId} -> ${data.room}`);
            } catch (saveError) {
                console.error('메시지 저장 오류:', saveError);
            }
        }, 0);
    });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err?.message || '서버 오류가 발생했습니다.' });
});

(async () => {
  await db.connect();
  server.listen(PORT, () => {
    console.log(`TornFi portfolio server listening on http://localhost:${PORT}`);
    console.log('🚀 DOGE 채팅방: http://localhost:3000/doge-chat');
  });
})();
