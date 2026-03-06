require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const express = require('express');
const multer = require('multer');
const { Contract, Interface, JsonRpcProvider } = require('ethers');
const db = require('./lib/db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const CHAT_MIN_INTERVAL_MS = 1500;
const CALC_PRICE_CACHE_TTL_MS = 18 * 1000;
let calcPriceCache = null;

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

  const [llamaRes, coingeckoRes, upbitRes, mexcRes, etherscanRes, uniswapResult] = await Promise.allSettled([
    timeoutFetch('https://coins.llama.fi/prices/current/' + DEFILLAMA_COINS).then((r) => r.json()),
    timeoutFetch('https://api.coingecko.com/api/v3/simple/price?ids=tornado-cash,bitcoin&vs_currencies=krw').then((r) => r.json()),
    timeoutFetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC').then((r) => r.json()),
    timeoutFetch('https://api.mexc.com/api/v3/ticker/price?symbol=TORNUSDT').then((r) => r.json()),
    timeoutFetch(`https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokenbalance&contractaddress=${TORN_TOKEN}&address=${GOVERNANCE}&tag=latest&apikey=${ETHERSCAN_KEY}`).then((r) => r.json()),
    (async () => {
      try {
        const provider = new JsonRpcProvider(RPC_URL);
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
  ]);

  const llama = llamaRes.status === 'fulfilled' ? llamaRes.value : null;
  const coingecko = coingeckoRes.status === 'fulfilled' ? coingeckoRes.value : null;
  const upbit = upbitRes.status === 'fulfilled' ? upbitRes.value : null;
  const mexc = mexcRes.status === 'fulfilled' ? mexcRes.value : null;
  const etherscan = etherscanRes.status === 'fulfilled' ? etherscanRes.value : null;
  const tornPriceInEth = uniswapResult.status === 'fulfilled' ? uniswapResult.value : null;

  const coins = (llama && llama.coins) || {};
  const ethPriceUsd = coins['ethereum:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2']?.price || 0;
  const btcPriceUsd = coins['ethereum:0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599']?.price || 0;
  const defiLlamaTorn = coins['ethereum:0x77777FeDdddFfC19Ff86DB637967013e6C6A116C']?.price || 0;
  const tornPriceUsdDex = tornPriceInEth && ethPriceUsd ? tornPriceInEth * ethPriceUsd : 0;
  const mexcObj = Array.isArray(mexc) ? mexc[0] : mexc;
  const tornPriceUsdCex = mexcObj?.price ? Number(mexcObj.price) || 0 : 0;
  const tornPriceUsdCenter = defiLlamaTorn > 0 ? defiLlamaTorn : 0;
  const tornPriceUsd = tornPriceUsdDex || tornPriceUsdCenter || tornPriceUsdCex;
  const btcKrw = coingecko?.bitcoin?.krw || null;
  let premium = null;
  if (btcKrw && upbit && Array.isArray(upbit) && upbit[0]?.trade_price) {
    premium = Math.round(((upbit[0].trade_price - btcKrw) / btcKrw) * 10000) / 100;
  }

  let totalStaked = 0;
  if (etherscan?.status === '1' && etherscan?.message === 'OK' && etherscan?.result) {
    const raw = String(etherscan.result);
    if (raw && raw !== '0') {
      const decimals = 18;
      const len = raw.length;
      totalStaked = len <= decimals ? parseFloat('0.' + raw.padStart(decimals, '0')) : parseFloat(raw.slice(0, len - decimals) + '.' + raw.slice(-decimals));
    }
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
    premium,
    totalStaked,
    tornPriceKrw: coingecko?.['tornado-cash']?.krw || 0,
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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: err?.message || '서버 오류가 발생했습니다.' });
});

(async () => {
  await db.connect();
  app.listen(PORT, () => {
    console.log(`TornFi portfolio server listening on http://localhost:${PORT}`);
  });
})();
