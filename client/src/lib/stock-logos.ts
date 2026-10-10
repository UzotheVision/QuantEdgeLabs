/**
 * Stock Logo Utilities
 *
 * Uses multiple sources to fetch company logos:
 * 1. Clearbit Logo API (free, no key required)
 * 2. Yahoo Finance (as fallback)
 * 3. Fallback to symbol initials
 */

// Map of stock symbols to their company domains for Clearbit
const SYMBOL_TO_DOMAIN: Record<string, string> = {
  // Major Tech
  AAPL: 'apple.com',
  MSFT: 'microsoft.com',
  GOOGL: 'google.com',
  GOOG: 'google.com',
  AMZN: 'amazon.com',
  META: 'meta.com',
  NVDA: 'nvidia.com',
  TSLA: 'tesla.com',
  AMD: 'amd.com',
  INTC: 'intel.com',
  CRM: 'salesforce.com',
  ORCL: 'oracle.com',
  ADBE: 'adobe.com',
  NFLX: 'netflix.com',
  CSCO: 'cisco.com',
  IBM: 'ibm.com',
  PYPL: 'paypal.com',
  SHOP: 'shopify.com',
  SQ: 'squareup.com',
  UBER: 'uber.com',
  LYFT: 'lyft.com',
  SNAP: 'snap.com',
  TWTR: 'twitter.com',
  X: 'x.com',
  PINS: 'pinterest.com',
  SPOT: 'spotify.com',
  ZM: 'zoom.us',
  DOCU: 'docusign.com',
  PLTR: 'palantir.com',
  SNOW: 'snowflake.com',
  DDOG: 'datadoghq.com',
  NET: 'cloudflare.com',
  CRWD: 'crowdstrike.com',
  PANW: 'paloaltonetworks.com',
  OKTA: 'okta.com',
  MDB: 'mongodb.com',
  TEAM: 'atlassian.com',
  NOW: 'servicenow.com',
  WDAY: 'workday.com',
  COIN: 'coinbase.com',
  HOOD: 'robinhood.com',

  // Financials
  JPM: 'jpmorganchase.com',
  BAC: 'bankofamerica.com',
  WFC: 'wellsfargo.com',
  GS: 'goldmansachs.com',
  MS: 'morganstanley.com',
  C: 'citi.com',
  V: 'visa.com',
  MA: 'mastercard.com',
  AXP: 'americanexpress.com',
  BLK: 'blackrock.com',
  SCHW: 'schwab.com',

  // Consumer
  WMT: 'walmart.com',
  TGT: 'target.com',
  COST: 'costco.com',
  HD: 'homedepot.com',
  LOW: 'lowes.com',
  NKE: 'nike.com',
  SBUX: 'starbucks.com',
  MCD: 'mcdonalds.com',
  KO: 'coca-cola.com',
  PEP: 'pepsico.com',
  DIS: 'disney.com',
  CMCSA: 'comcast.com',

  // Healthcare
  JNJ: 'jnj.com',
  PFE: 'pfizer.com',
  UNH: 'unitedhealthgroup.com',
  MRK: 'merck.com',
  ABBV: 'abbvie.com',
  LLY: 'lilly.com',
  BMY: 'bms.com',
  AMGN: 'amgen.com',
  GILD: 'gilead.com',
  MRNA: 'modernatx.com',

  // Industrials
  BA: 'boeing.com',
  CAT: 'caterpillar.com',
  GE: 'ge.com',
  MMM: '3m.com',
  UPS: 'ups.com',
  FDX: 'fedex.com',
  HON: 'honeywell.com',
  LMT: 'lockheedmartin.com',
  RTX: 'rtx.com',
  DE: 'deere.com',

  // Energy
  XOM: 'exxonmobil.com',
  CVX: 'chevron.com',
  COP: 'conocophillips.com',
  SLB: 'slb.com',
  EOG: 'eogresources.com',

  // Telecom
  T: 'att.com',
  VZ: 'verizon.com',
  TMUS: 't-mobile.com',

  // ETFs (use provider logos)
  SPY: 'ssga.com',
  QQQ: 'invesco.com',
  IWM: 'ishares.com',
  DIA: 'ssga.com',
  VTI: 'vanguard.com',
  VOO: 'vanguard.com',
  VXX: 'barclays.com',
  XLK: 'ssga.com',
  XLF: 'ssga.com',
  XLE: 'ssga.com',
  XLV: 'ssga.com',
  XLI: 'ssga.com',
  XLY: 'ssga.com',
  XLP: 'ssga.com',
  XLU: 'ssga.com',
  XLB: 'ssga.com',
  XLRE: 'ssga.com',
  XLC: 'ssga.com',
  GLD: 'ssga.com',
  SLV: 'ishares.com',
  USO: 'uscfinvestments.com',

  // Crypto-related
  MSTR: 'microstrategy.com',
  MARA: 'mara.com',
  RIOT: 'riotplatforms.com',
  CLSK: 'cleanspark.com',
};

/** Crypto symbols that have a dedicated CoinGecko logo. */
const CRYPTO_LOGO: Record<string, string> = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
};

/** Resolve the best-guess company domain for a ticker. */
function resolveDomain(upperSymbol: string): string {
  return SYMBOL_TO_DOMAIN[upperSymbol] ?? `${upperSymbol.toLowerCase()}.com`;
}

/**
 * Ordered list of logo URLs to try for a symbol.
 *
 * Clearbit's free Logo API (logo.clearbit.com) was sunset. We now lead with
 * Financial Modeling Prep's **ticker-keyed** logo CDN — these are real, crisp
 * company marks indexed by the exact ticker, so there's no domain-guessing
 * (NVDA always returns NVIDIA, never a wrong site) and the PNGs are higher-res
 * than a favicon. Favicon providers (Google 256px, DuckDuckGo) are the backstop;
 * components walk the list on <img> error before falling back to initials.
 */
export function getLogoSources(symbol: string): string[] {
  const upperSymbol = symbol.toUpperCase();

  // Crypto: CoinGecko first, then a favicon backstop.
  for (const key of Object.keys(CRYPTO_LOGO)) {
    if (upperSymbol === key || upperSymbol.includes(key)) {
      const domain = key === 'BTC' ? 'bitcoin.org' : key === 'ETH' ? 'ethereum.org' : 'solana.com';
      return [CRYPTO_LOGO[key], `https://icons.duckduckgo.com/ip3/${domain}.ico`];
    }
  }

  const domain = resolveDomain(upperSymbol);
  return [
    // ticker-keyed, correct + higher-res
    `https://financialmodelingprep.com/image-stock/${upperSymbol}.png`,
    // domain-based favicon fallbacks (256px first for sharpness)
    `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=256`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
}

/**
 * Get the primary logo URL for a stock symbol (first working source).
 */
export function getStockLogoUrl(symbol: string): string {
  return getLogoSources(symbol)[0];
}

/**
 * Get initials for a symbol as fallback
 */
export function getSymbolInitials(symbol: string): string {
  return symbol.substring(0, 2).toUpperCase();
}

/**
 * Check if a logo URL is valid (can be used with onError handler)
 */
export function handleLogoError(event: React.SyntheticEvent<HTMLImageElement, Event>, symbol: string): void {
  const img = event.target as HTMLImageElement;
  // Hide the broken image
  img.style.display = 'none';
  // Could also set a placeholder SVG or use initials
}

/**
 * Component-friendly logo with fallback
 */
export interface StockLogoProps {
  symbol: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}
