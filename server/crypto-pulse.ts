import { fetchCryptoPrice, fetchHistoricalPrices } from './market-api';

export type CryptoPulseAsset = {
  symbol: 'BTC' | 'ETH';
  name: string;
  price: number;
  change24h: number;
  high24h: number | null;
  low24h: number | null;
  rsi14d: number | null;
  realizedVol30d: number | null;
  change7d: number | null;
  change30d: number | null;
  closes: Array<{ timestamp: number; close: number }>;
};

export type CryptoPulse = {
  asOf: string;
  assets: CryptoPulseAsset[];
};

let cached: { value: CryptoPulse; at: number } | null = null;
const CACHE_MS = 60_000;

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

function annualizedVol(closes: number[]): number | null {
  if (closes.length < 3) return null;
  const returns = closes.slice(1).map((price, i) => Math.log(price / closes[i]));
  const mean = returns.reduce((total, value) => total + value, 0) / returns.length;
  const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

function percentFrom(closes: number[], daysAgo: number): number | null {
  const current = closes.at(-1);
  const base = closes.at(-(daysAgo + 1));
  if (!current || !base) return null;
  return ((current - base) / base) * 100;
}

async function asset(symbol: 'BTC' | 'ETH', name: string): Promise<CryptoPulseAsset | null> {
  const [quote, history] = await Promise.all([
    fetchCryptoPrice(symbol),
    fetchHistoricalPrices(symbol, 'crypto', 90),
  ]);
  if (!quote) return null;

  const closes = history ?? [];
  const stampedCloses = closes.slice(-60).map((close, index, values) => ({
    // CoinGecko's historical helper only returns prices. A stable spacing preserves
    // the true series order without pretending that it is intraday data.
    timestamp: Date.now() - (values.length - index - 1) * 86_400_000,
    close,
  }));

  return {
    symbol,
    name,
    price: quote.currentPrice,
    // Some crypto quote fallbacks return a real spot with a zeroed change field.
    // A literal 0.00% beside a moving 24/7 asset is worse than missing data, so
    // derive the move from the verified daily history when the quote omits it.
    change24h: quote.changePercent !== 0 ? quote.changePercent : (percentFrom(closes, 1) ?? 0),
    high24h: quote.high24h ?? null,
    low24h: quote.low24h ?? null,
    rsi14d: rsi(closes),
    realizedVol30d: annualizedVol(closes.slice(-31)),
    change7d: percentFrom(closes, 7),
    change30d: percentFrom(closes, 30),
    closes: stampedCloses,
  };
}

/**
 * This is deliberately a market read, not a crypto signal generator. BTC and ETH
 * are fetched from the platform's real crypto quote/history sources; any equity
 * proxy remains a separate, measurable relationship rather than a made-up beta.
 */
export async function getCryptoPulse(): Promise<CryptoPulse> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const assets = (await Promise.all([asset('BTC', 'Bitcoin'), asset('ETH', 'Ethereum')]))
    .filter((value): value is CryptoPulseAsset => value !== null);
  const value = { asOf: new Date().toISOString(), assets };
  cached = { value, at: Date.now() };
  return value;
}
