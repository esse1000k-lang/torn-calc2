#!/usr/bin/env node
// Fast kimchi premium calculator (Upbit KRW -> USD, Binance USDT)
const DEFAULT_TIMEOUT = 2500;

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with exponential backoff retry
 * @param {string} url - Request URL
 * @param {number} timeoutMs - Timeout per request
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 */
async function fetchWithRetry(url, timeoutMs = DEFAULT_TIMEOUT, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        // Exponential backoff: 100ms → 200ms → 400ms
        const delay = Math.pow(2, attempt) * 100;
        await sleep(delay);
      }
    }
  }
  throw lastError || new Error('Max retries exceeded');
}

async function getKimchiPremium({ usdtUrl = 'https://api.upbit.com/v1/ticker?markets=KRW-USDT', timeoutMs = DEFAULT_TIMEOUT } = {}) {
  try {
    const [upbitRes, binanceRes, usdtRes] = await Promise.allSettled([
      fetchWithRetry('https://api.upbit.com/v1/ticker?markets=KRW-BTC', timeoutMs),
      fetchWithRetry('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', timeoutMs),
      fetchWithRetry(usdtUrl, timeoutMs),
    ]);

    const upbitOk = upbitRes.status === 'fulfilled' && Array.isArray(upbitRes.value) && upbitRes.value[0] && upbitRes.value[0].trade_price;
    const binanceOk = binanceRes.status === 'fulfilled' && binanceRes.value && (binanceRes.value.price || binanceRes.value.price === '0');
    const usdtOk = usdtRes.status === 'fulfilled' && Array.isArray(usdtRes.value) && usdtRes.value[0] && typeof usdtRes.value[0].trade_price === 'number';

    const upbitKrw = upbitOk ? Number(upbitRes.value[0].trade_price) : null;
    const binanceUsdt = binanceOk ? Number(binanceRes.value.price) : null; // Binance returns string
    const usdToKrw = usdtOk ? Number(usdtRes.value[0].trade_price) : null;

    if (!upbitKrw) throw new Error('Upbit BTC price unavailable');
    if (!binanceUsdt) throw new Error('Binance BTC price unavailable');
    if (!usdToKrw) throw new Error('USDT/KRW rate unavailable (Upbit)');

    const upbitUsd = upbitKrw / usdToKrw;

    const premiumPercent = ((upbitUsd / binanceUsdt) - 1) * 100; // ((Upbit_USD / Binance_USDT) - 1) * 100

    const round2 = (v) => Math.round(v * 100) / 100;

    return {
      ok: true,
      upbitKrw: round2(upbitKrw),
      binanceUsdt: round2(binanceUsdt),
      usdToKrw: round2(usdToKrw),
      upbitUsd: round2(upbitUsd),
      premiumPercent: round2(premiumPercent),
      timestamp: Date.now(),
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

module.exports = { getKimchiPremium };

if (require.main === module) {
  (async () => {
    const res = await getKimchiPremium();
    console.log(JSON.stringify(res, null, 2));
  })();
}
