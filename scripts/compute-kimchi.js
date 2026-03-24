#!/usr/bin/env node
// Fast kimchi premium calculator (Binance USDT -> KRW, Upbit KRW)
const DEFAULT_TIMEOUT = 2500;

async function getKimchiPremium({ fxUrl = 'https://api.exchangerate.host/latest?base=USD&symbols=KRW', timeoutMs = DEFAULT_TIMEOUT, fxFallbackUrl = 'https://open.er-api.com/v6/latest/USD' } = {}) {
  const tf = (u) => fetch(u, { signal: AbortSignal.timeout(timeoutMs) }).then(r => r.json());
  try {
    const [upbitRes, binanceRes, exrRes] = await Promise.allSettled([
      tf('https://api.upbit.com/v1/ticker?markets=KRW-BTC'),
      tf('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
      tf(fxUrl),
    ]);

    const upbitOk = upbitRes.status === 'fulfilled' && Array.isArray(upbitRes.value) && upbitRes.value[0] && upbitRes.value[0].trade_price;
    const binanceOk = binanceRes.status === 'fulfilled' && binanceRes.value && (binanceRes.value.price || binanceRes.value.price === '0');
    const exrOk = exrRes.status === 'fulfilled' && exrRes.value && exrRes.value.rates && typeof exrRes.value.rates.KRW === 'number';

    const upbitKrw = upbitOk ? Number(upbitRes.value[0].trade_price) : null;
    const binanceUsdt = binanceOk ? Number(binanceRes.value.price) : null; // Binance returns string
    let usdToKrw = exrOk ? Number(exrRes.value.rates.KRW) : null;
    // try fallback source if primary fx is unavailable
    if (!usdToKrw) {
      try {
        const alt = await fetch(fxFallbackUrl, { signal: AbortSignal.timeout(timeoutMs) }).then(r => r.json()).catch(() => null);
        if (alt && alt.rates && typeof alt.rates.KRW === 'number') usdToKrw = Number(alt.rates.KRW);
      } catch {}
    }

    if (!upbitKrw) throw new Error('Upbit price unavailable');
    if (!binanceUsdt) throw new Error('Binance price unavailable');
    if (!usdToKrw) throw new Error('FX rate unavailable');

    const foreignKrw = binanceUsdt * usdToKrw;

    const premiumPercent = ((upbitKrw / foreignKrw) - 1) * 100; // ((Upbit / Foreign) - 1) * 100

    const round2 = (v) => Math.round(v * 100) / 100;

    return {
      ok: true,
      upbitKrw: round2(upbitKrw),
      binanceUsdt: round2(binanceUsdt),
      usdToKrw: round2(usdToKrw),
      foreignKrw: round2(foreignKrw),
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
