import { logger } from "./logger";
import { getLetterGrade } from "./grading";
import { fetchAlphaVantageNews, type NewsArticle } from "./news-service";
import { getTradierQuote, getTradierHistoryOHLC, getTradierHistory } from "./tradier-api";
import { fetchCompanyProfile } from "./market-api";
import { RSI, SMA, EMA, MACD, BollingerBands, ADX } from "technicalindicators";

export interface CompanyContext {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  description: string;
  marketCap?: number;
  recentNews: NewsArticle[];
  catalysts: string[];
}

export interface MarketRegime {
  overall: 'bullish' | 'bearish' | 'neutral';
  volatility: 'low' | 'normal' | 'high' | 'extreme';
  sectorStrength: 'strong' | 'neutral' | 'weak';
  trend: 'trending' | 'ranging' | 'reversal';
  description: string;
}

export interface TechnicalAnalysis {
  rsi: { value: number; signal: 'oversold' | 'neutral' | 'overbought' };
  macd: { value: number; histogram: number; signal: 'bullish' | 'bearish' | 'neutral' };
  movingAverages: {
    sma20: number;
    sma50: number;
    sma200: number;
    priceVsSMA20: 'above' | 'below';
    priceVsSMA50: 'above' | 'below';
    priceVsSMA200: 'above' | 'below';
    goldenCross: boolean;
    deathCross: boolean;
  };
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    squeeze: boolean;
  };
  adx: { value: number; trending: boolean };
  volume: {
    current: number;
    average: number;
    ratio: number;
    unusual: boolean;
  };
  support: number;
  resistance: number;
  priceAction: { trend: string; strength: string };
}

export interface MultiFactorScore {
  fundamentals: number;
  technicals: number;
  momentum: number;
  sentiment: number;
  marketContext: number;
  total: number;
  grade: string;
  convictionLevel: 'INSIDER' | 'PRIORITY' | 'WATCH' | 'AVOID';
  tier: 'INSIDER' | 'PRIORITY' | 'WATCH' | 'AVOID'; // Alias for UI compatibility
}

export interface ComprehensiveAnalysis {
  symbol: string;
  timestamp: string;
  company: CompanyContext;
  regime: MarketRegime;
  technicals: TechnicalAnalysis;
  score: MultiFactorScore;
  thesis: {
    direction: 'bullish' | 'bearish' | 'neutral';
    headline: string;
    summary: string;
    entryZone: { low: number; high: number };
    targetPrice: number;
    stopLoss: number;
    riskReward: number;
    holdingPeriod: 'day' | 'swing' | 'position';
    keyRisks: string[];
    catalysts: string[];
    signals: string[];
  };
}

const SECTOR_MAP: Record<string, { name: string; etf: string }> = {
  'Technology': { name: 'Technology', etf: 'XLK' },
  'Healthcare': { name: 'Healthcare', etf: 'XLV' },
  'Financials': { name: 'Financials', etf: 'XLF' },
  'Consumer Discretionary': { name: 'Consumer Discretionary', etf: 'XLY' },
  'Communication Services': { name: 'Communication', etf: 'XLC' },
  'Industrials': { name: 'Industrials', etf: 'XLI' },
  'Consumer Staples': { name: 'Consumer Staples', etf: 'XLP' },
  'Energy': { name: 'Energy', etf: 'XLE' },
  'Utilities': { name: 'Utilities', etf: 'XLU' },
  'Real Estate': { name: 'Real Estate', etf: 'XLRE' },
  'Materials': { name: 'Materials', etf: 'XLB' },
};

const COMPANY_INFO: Record<string, { name: string; sector: string; industry: string; description: string }> = {
  'AAPL': { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', description: 'Apple designs, manufactures, and sells consumer electronics (iPhone, Mac, iPad), software (iOS, macOS), and services (App Store, iCloud, Apple Music).' },
  'MSFT': { name: 'Microsoft Corporation', sector: 'Technology', industry: 'Software', description: 'Microsoft develops software (Windows, Office 365), cloud services (Azure), gaming (Xbox), and enterprise solutions. Leader in AI with Copilot integration.' },
  'GOOGL': { name: 'Alphabet Inc.', sector: 'Communication Services', industry: 'Internet Services', description: 'Alphabet operates Google Search, YouTube, Android, Google Cloud, and Waymo autonomous vehicles. Dominant in digital advertising and AI/ML.' },
  'AMZN': { name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', industry: 'E-commerce', description: 'Amazon operates e-commerce marketplace, AWS cloud computing (market leader), Prime Video streaming, and logistics/fulfillment network.' },
  'META': { name: 'Meta Platforms Inc.', sector: 'Communication Services', industry: 'Social Media', description: 'Meta owns Facebook, Instagram, WhatsApp, and Messenger. Investing heavily in VR/AR (Quest headsets) and AI-powered content.' },
  'NVDA': { name: 'NVIDIA Corporation', sector: 'Technology', industry: 'Semiconductors', description: 'NVIDIA designs GPUs for gaming, AI/ML training (H100, A100), data centers, and automotive. Dominant in AI chip market.' },
  'TSLA': { name: 'Tesla Inc.', sector: 'Consumer Discretionary', industry: 'Electric Vehicles', description: 'Tesla manufactures EVs (Model S/3/X/Y, Cybertruck), energy storage, solar products, and develops autonomous driving technology.' },
  'AMD': { name: 'Advanced Micro Devices', sector: 'Technology', industry: 'Semiconductors', description: 'AMD designs CPUs (Ryzen, EPYC) and GPUs (Radeon) for gaming, data centers, and AI. Key competitor to Intel and NVIDIA.' },
  'ASTS': { name: 'AST SpaceMobile Inc.', sector: 'Communication Services', industry: 'Satellite Communications', description: 'AST SpaceMobile is building a space-based cellular broadband network to provide connectivity directly to standard mobile phones via satellites.' },
  'PLTR': { name: 'Palantir Technologies', sector: 'Technology', industry: 'Data Analytics', description: 'Palantir builds data integration and analytics platforms (Foundry, Gotham) for government intelligence and enterprise customers.' },
  'COIN': { name: 'Coinbase Global Inc.', sector: 'Financials', industry: 'Cryptocurrency Exchange', description: 'Coinbase operates a cryptocurrency exchange platform for trading Bitcoin, Ethereum, and other digital assets. Also offers custody and staking.' },
  'SNOW': { name: 'Snowflake Inc.', sector: 'Technology', industry: 'Cloud Data', description: 'Snowflake provides cloud-based data warehousing, analytics, and data sharing platform. Operates across AWS, Azure, and GCP.' },
  'CRWD': { name: 'CrowdStrike Holdings', sector: 'Technology', industry: 'Cybersecurity', description: 'CrowdStrike provides cloud-native endpoint security, threat intelligence, and incident response services via its Falcon platform.' },
  'SQ': { name: 'Block Inc.', sector: 'Financials', industry: 'Fintech', description: 'Block (formerly Square) offers payment processing, Cash App, Bitcoin services, and business tools for small-to-medium businesses.' },
  'SHOP': { name: 'Shopify Inc.', sector: 'Technology', industry: 'E-commerce Platform', description: 'Shopify provides e-commerce platform for merchants to build online stores, manage payments, shipping, and inventory.' },
  'NET': { name: 'Cloudflare Inc.', sector: 'Technology', industry: 'Cloud Infrastructure', description: 'Cloudflare provides CDN, DDoS protection, DNS, and edge computing services. Growing in zero-trust security and AI inference.' },
  'DDOG': { name: 'Datadog Inc.', sector: 'Technology', industry: 'Cloud Monitoring', description: 'Datadog offers cloud-scale monitoring, security, and analytics platform for infrastructure, applications, and logs.' },
  'ZS': { name: 'Zscaler Inc.', sector: 'Technology', industry: 'Cybersecurity', description: 'Zscaler provides cloud-based zero-trust security platform for secure access to applications and internet.' },
  'PANW': { name: 'Palo Alto Networks', sector: 'Technology', industry: 'Cybersecurity', description: 'Palo Alto Networks offers next-gen firewalls, cloud security, and AI-powered threat detection for enterprises.' },
  'ABNB': { name: 'Airbnb Inc.', sector: 'Consumer Discretionary', industry: 'Travel/Lodging', description: 'Airbnb operates online marketplace for short-term lodging, vacation rentals, and travel experiences worldwide.' },
  'UBER': { name: 'Uber Technologies', sector: 'Technology', industry: 'Ride-sharing', description: 'Uber operates ride-sharing, food delivery (Uber Eats), freight logistics, and autonomous vehicle development.' },
  'RIVN': { name: 'Rivian Automotive', sector: 'Consumer Discretionary', industry: 'Electric Vehicles', description: 'Rivian designs and manufactures electric adventure vehicles (R1T truck, R1S SUV) and commercial delivery vans for Amazon.' },
  'LCID': { name: 'Lucid Group Inc.', sector: 'Consumer Discretionary', industry: 'Electric Vehicles', description: 'Lucid designs luxury electric vehicles (Lucid Air) with industry-leading range and performance specifications.' },
  'NIO': { name: 'NIO Inc.', sector: 'Consumer Discretionary', industry: 'Electric Vehicles', description: 'NIO is a Chinese EV manufacturer known for battery swapping technology and premium electric SUVs and sedans.' },
  'SOFI': { name: 'SoFi Technologies', sector: 'Financials', industry: 'Fintech', description: 'SoFi provides digital banking, lending, investing, and financial planning services through its mobile-first platform.' },
  'HOOD': { name: 'Robinhood Markets', sector: 'Financials', industry: 'Brokerage', description: 'Robinhood offers commission-free trading of stocks, options, and crypto through its mobile app, targeting retail investors.' },
  'SMCI': { name: 'Super Micro Computer', sector: 'Technology', industry: 'Server Hardware', description: 'Supermicro designs high-performance server solutions optimized for AI, cloud, and enterprise data center workloads.' },
  'ARM': { name: 'Arm Holdings', sector: 'Technology', industry: 'Semiconductors', description: 'ARM designs and licenses CPU architectures used in virtually all smartphones, IoT devices, and increasingly in servers and AI chips.' },
  'MSTR': { name: 'MicroStrategy Inc.', sector: 'Technology', industry: 'Business Intelligence', description: 'MicroStrategy provides enterprise analytics software and is known for holding significant Bitcoin on its balance sheet.' },
  'IONQ': { name: 'IonQ Inc.', sector: 'Technology', industry: 'Quantum Computing', description: 'IonQ develops trapped-ion quantum computers accessible via major cloud providers for research and enterprise applications.' },
  'RGTI': { name: 'Rigetti Computing', sector: 'Technology', industry: 'Quantum Computing', description: 'Rigetti builds superconducting quantum computers and provides quantum-classical hybrid computing solutions.' },
  'QBTS': { name: 'D-Wave Quantum', sector: 'Technology', industry: 'Quantum Computing', description: 'D-Wave develops quantum annealing computers optimized for optimization problems in logistics, AI, and materials science.' },
  'SPY': { name: 'SPDR S&P 500 ETF', sector: 'Index', industry: 'ETF', description: 'SPY tracks the S&P 500 index, providing exposure to 500 largest US companies. Most liquid ETF for market-wide exposure.' },
  'QQQ': { name: 'Invesco QQQ Trust', sector: 'Index', industry: 'ETF', description: 'QQQ tracks the Nasdaq-100 index, heavily weighted toward technology and growth stocks.' },
  'IWM': { name: 'iShares Russell 2000', sector: 'Index', industry: 'ETF', description: 'IWM tracks small-cap US stocks via the Russell 2000 index, useful for gauging risk appetite.' },
};

export async function getCompanyContext(symbol: string): Promise<CompanyContext> {
  const upperSymbol = symbol.toUpperCase();
  const cachedInfo = COMPANY_INFO[upperSymbol];
  
  // Fetch news in parallel with company profile
  const [news, dynamicProfile] = await Promise.all([
    fetchAlphaVantageNews(upperSymbol, undefined, undefined, 10).catch((error) => {
      logger.warn(`[MFA] Failed to fetch news for ${symbol}:`, error);
      return [] as NewsArticle[];
    }),
    // Only fetch dynamic profile if not in hardcoded list or missing description
    !cachedInfo ? fetchCompanyProfile(upperSymbol).catch((error) => {
      logger.warn(`[MFA] Failed to fetch profile for ${symbol}:`, error);
      return null;
    }) : Promise.resolve(null),
  ]);
  
  // Extract catalysts from news (high sentiment articles = potential movers)
  const newsCatalysts: string[] = [];
  for (const article of news.slice(0, 5)) {
    if (article.overallSentimentScore > 0.2 || article.overallSentimentScore < -0.2) {
      newsCatalysts.push(article.title.substring(0, 100));
    }
  }
  
  // Merge hardcoded info with dynamic profile
  const info = cachedInfo || {
    name: dynamicProfile?.name || upperSymbol,
    sector: dynamicProfile?.sector || 'Unknown',
    industry: dynamicProfile?.industry || 'Unknown',
    description: dynamicProfile?.description || `${upperSymbol} is a publicly traded company.`,
  };
  
  // Combine news-derived catalysts with sector-based catalysts
  const allCatalysts = [
    ...newsCatalysts.slice(0, 2),
    ...(dynamicProfile?.catalysts || []).slice(0, 2),
  ].slice(0, 4);
  
  return {
    symbol: upperSymbol,
    name: info.name,
    sector: info.sector,
    industry: info.industry,
    description: info.description,
    marketCap: dynamicProfile?.marketCap,
    recentNews: news.slice(0, 5),
    catalysts: allCatalysts.length > 0 ? allCatalysts : ['Earnings reports', 'Industry trends'],
  };
}

export async function assessMarketRegime(): Promise<MarketRegime> {
  try {
    const spyQuote = await getTradierQuote('SPY');
    const vixQuote = await getTradierQuote('VIX');
    
    const spyChange = spyQuote?.change_percentage || 0;
    const vixLevel = vixQuote?.last || 20;
    
    let overall: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (spyChange > 0.5) overall = 'bullish';
    else if (spyChange < -0.5) overall = 'bearish';
    
    let volatility: 'low' | 'normal' | 'high' | 'extreme' = 'normal';
    if (vixLevel < 15) volatility = 'low';
    else if (vixLevel > 25 && vixLevel <= 35) volatility = 'high';
    else if (vixLevel > 35) volatility = 'extreme';
    
    const trend: 'trending' | 'ranging' | 'reversal' = 
      Math.abs(spyChange) > 1 ? 'trending' : 
      Math.abs(spyChange) < 0.3 ? 'ranging' : 'reversal';
    
    let description = '';
    if (overall === 'bullish' && volatility === 'low') {
      description = 'Risk-on environment with low volatility. Favor momentum plays.';
    } else if (overall === 'bearish' && volatility === 'high') {
      description = 'Risk-off environment with elevated fear. Consider defensive positions or hedges.';
    } else if (volatility === 'extreme') {
      description = 'Extreme volatility - reduce position sizes, use wider stops.';
    } else {
      description = `Market is ${overall} with ${volatility} volatility. ${trend === 'ranging' ? 'Mean-reversion setups favored.' : 'Trend-following setups favored.'}`;
    }
    
    return {
      overall,
      volatility,
      sectorStrength: 'neutral',
      trend,
      description,
    };
  } catch (error) {
    logger.error('[MFA] Failed to assess market regime:', error);
    return {
      overall: 'neutral',
      volatility: 'normal',
      sectorStrength: 'neutral',
      trend: 'ranging',
      description: 'Unable to assess market conditions.',
    };
  }
}

export async function runTechnicalAnalysis(symbol: string, currentPrice: number): Promise<TechnicalAnalysis | null> {
  try {
    const ohlcData = await getTradierHistoryOHLC(symbol, 365);
    if (!ohlcData || ohlcData.closes.length < 50) {
      logger.warn(`[MFA] Insufficient historical data for ${symbol}`);
      return null;
    }
    
    const closes = ohlcData.closes;
    const highs = ohlcData.highs;
    const lows = ohlcData.lows;
    const volumes: number[] = new Array(closes.length).fill(1000000);
    
    const rsiValues = RSI.calculate({ period: 14, values: closes });
    const rsiValue = rsiValues[rsiValues.length - 1] || 50;
    const rsiSignal: 'oversold' | 'neutral' | 'overbought' = 
      rsiValue < 30 ? 'oversold' : rsiValue > 70 ? 'overbought' : 'neutral';
    
    const macdResult = MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    const macdLatest = macdResult[macdResult.length - 1];
    const macdValue = macdLatest?.MACD || 0;
    const macdHistogram = macdLatest?.histogram || 0;
    const macdSignal: 'bullish' | 'bearish' | 'neutral' = 
      macdHistogram > 0.5 ? 'bullish' : macdHistogram < -0.5 ? 'bearish' : 'neutral';
    
    const sma20Values = SMA.calculate({ period: 20, values: closes });
    const sma50Values = SMA.calculate({ period: 50, values: closes });
    const sma200Values = SMA.calculate({ period: 200, values: closes });
    
    const sma20 = sma20Values[sma20Values.length - 1] || currentPrice;
    const sma50 = sma50Values[sma50Values.length - 1] || currentPrice;
    const sma200 = sma200Values[sma200Values.length - 1] || currentPrice;
    
    const prevSma50 = sma50Values[sma50Values.length - 5] || sma50;
    const prevSma200 = sma200Values[sma200Values.length - 5] || sma200;
    const goldenCross = prevSma50 < prevSma200 && sma50 > sma200;
    const deathCross = prevSma50 > prevSma200 && sma50 < sma200;
    
    const bbResult = BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2,
    });
    const bbLatest = bbResult[bbResult.length - 1];
    const bbWidth = bbLatest ? (bbLatest.upper - bbLatest.lower) / bbLatest.middle : 0;
    const percentB = bbLatest ? (currentPrice - bbLatest.lower) / (bbLatest.upper - bbLatest.lower) : 0.5;
    
    const adxResult = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });
    const adxValue = adxResult[adxResult.length - 1]?.adx || 20;
    
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volumes[volumes.length - 1] || avgVolume;
    const volumeRatio = currentVolume / avgVolume;
    
    const recentLows = lows.slice(-20);
    const recentHighs = highs.slice(-20);
    const support = Math.min(...recentLows);
    const resistance = Math.max(...recentHighs);
    
    let priceAction: { trend: string; strength: string };
    if (currentPrice > sma20 && sma20 > sma50) {
      priceAction = { trend: 'uptrend', strength: 'strong' };
    } else if (currentPrice < sma20 && sma20 < sma50) {
      priceAction = { trend: 'downtrend', strength: 'moderate' };
    } else if (Math.abs(currentPrice - sma20) / sma20 < 0.02) {
      priceAction = { trend: 'consolidation', strength: 'weak' };
    } else {
      priceAction = { trend: 'mixed', strength: 'neutral' };
    }
    
    return {
      rsi: { value: rsiValue, signal: rsiSignal },
      macd: { value: macdValue, histogram: macdHistogram, signal: macdSignal },
      movingAverages: {
        sma20,
        sma50,
        sma200,
        priceVsSMA20: currentPrice > sma20 ? 'above' : 'below',
        priceVsSMA50: currentPrice > sma50 ? 'above' : 'below',
        priceVsSMA200: currentPrice > sma200 ? 'above' : 'below',
        goldenCross,
        deathCross,
      },
      bollingerBands: {
        upper: bbLatest?.upper || currentPrice * 1.05,
        middle: bbLatest?.middle || currentPrice,
        lower: bbLatest?.lower || currentPrice * 0.95,
        percentB,
        squeeze: bbWidth < 0.1,
      },
      adx: { value: adxValue, trending: adxValue > 25 },
      volume: {
        current: currentVolume,
        average: avgVolume,
        ratio: volumeRatio,
        unusual: volumeRatio > 1.5,
      },
      support,
      resistance,
      priceAction,
    };
  } catch (error) {
    logger.error(`[MFA] Technical analysis failed for ${symbol}:`, error);
    return null;
  }
}

function calculateMultiFactorScore(
  company: CompanyContext,
  regime: MarketRegime,
  technicals: TechnicalAnalysis | null,
  currentPrice: number
): MultiFactorScore {
  let fundamentals = 50;
  let technicalsScore = 50;
  let momentum = 50;
  let sentiment = 50;
  let marketContext = 50;
  
  if (company.catalysts.length > 0) fundamentals += 10;
  if (company.recentNews.length > 3) fundamentals += 5;
  const avgSentiment = company.recentNews.reduce((sum, n) => sum + (n.overallSentimentScore || 0), 0) / (company.recentNews.length || 1);
  if (avgSentiment > 0.2) sentiment += 15;
  else if (avgSentiment < -0.2) sentiment -= 15;
  
  if (regime.overall === 'bullish') marketContext += 10;
  else if (regime.overall === 'bearish') marketContext -= 10;
  
  if (regime.volatility === 'low') marketContext += 5;
  else if (regime.volatility === 'extreme') marketContext -= 15;
  
  if (technicals) {
    if (technicals.rsi.signal === 'oversold') technicalsScore += 15;
    else if (technicals.rsi.signal === 'overbought') technicalsScore -= 10;
    
    if (technicals.macd.signal === 'bullish') technicalsScore += 10;
    else if (technicals.macd.signal === 'bearish') technicalsScore -= 10;
    
    if (technicals.movingAverages.goldenCross) technicalsScore += 15;
    if (technicals.movingAverages.deathCross) technicalsScore -= 15;
    
    if (technicals.movingAverages.priceVsSMA200 === 'above') technicalsScore += 10;
    else technicalsScore -= 5;
    
    if (technicals.adx.trending) momentum += 10;
    
    if (technicals.volume.unusual) momentum += 10;
    
    if (technicals.bollingerBands.squeeze) momentum += 5;
  }
  
  fundamentals = Math.min(100, Math.max(0, fundamentals));
  technicalsScore = Math.min(100, Math.max(0, technicalsScore));
  momentum = Math.min(100, Math.max(0, momentum));
  sentiment = Math.min(100, Math.max(0, sentiment));
  marketContext = Math.min(100, Math.max(0, marketContext));
  
  const total = Math.round(
    (fundamentals * 0.15) +
    (technicalsScore * 0.30) +
    (momentum * 0.25) +
    (sentiment * 0.15) +
    (marketContext * 0.15)
  );
  
  const grade = getLetterGrade(total);

  let convictionLevel: 'INSIDER' | 'PRIORITY' | 'WATCH' | 'AVOID' = 'WATCH';
  if (total >= 75) convictionLevel = 'INSIDER';
  else if (total >= 60) convictionLevel = 'PRIORITY';
  else if (total >= 45) convictionLevel = 'WATCH';
  else convictionLevel = 'AVOID';
  
  return {
    fundamentals,
    technicals: technicalsScore,
    momentum,
    sentiment,
    marketContext,
    total,
    grade,
    convictionLevel,
    tier: convictionLevel, // Alias for UI compatibility
  };
}

export async function generateComprehensiveAnalysis(symbol: string): Promise<ComprehensiveAnalysis | null> {
  const startTime = Date.now();
  logger.info(`[MFA] Starting comprehensive analysis for ${symbol}`);
  
  try {
    const quote = await getTradierQuote(symbol);
    if (!quote || !quote.last) {
      logger.warn(`[MFA] No quote available for ${symbol}`);
      return null;
    }
    
    const currentPrice = quote.last;
    
    const [company, regime, technicals] = await Promise.all([
      getCompanyContext(symbol),
      assessMarketRegime(),
      runTechnicalAnalysis(symbol, currentPrice),
    ]);
    
    const score = calculateMultiFactorScore(company, regime, technicals, currentPrice);
    
    const direction: 'bullish' | 'bearish' | 'neutral' = 
      score.total >= 60 ? 'bullish' : 
      score.total <= 40 ? 'bearish' : 'neutral';
    
    const holdingPeriod: 'day' | 'swing' | 'position' = 
      technicals?.adx.trending && technicals.volume.unusual ? 'swing' :
      score.total >= 70 ? 'position' : 'day';
    
    const targetMultiplier = holdingPeriod === 'day' ? 1.03 : holdingPeriod === 'swing' ? 1.08 : 1.12;
    const stopMultiplier = holdingPeriod === 'day' ? 0.97 : holdingPeriod === 'swing' ? 0.95 : 0.92;
    
    const targetPrice = direction === 'bullish' 
      ? currentPrice * targetMultiplier 
      : currentPrice * (2 - targetMultiplier);
    
    const stopLoss = direction === 'bullish'
      ? Math.max(technicals?.support || currentPrice * stopMultiplier, currentPrice * stopMultiplier)
      : Math.min(technicals?.resistance || currentPrice * (2 - stopMultiplier), currentPrice * (2 - stopMultiplier));
    
    const entryBuffer = currentPrice * 0.01;
    const entryZone = {
      low: direction === 'bullish' ? currentPrice - entryBuffer : currentPrice,
      high: direction === 'bullish' ? currentPrice : currentPrice + entryBuffer,
    };
    
    const reward = Math.abs(targetPrice - currentPrice);
    const risk = Math.abs(currentPrice - stopLoss);
    const riskReward = risk > 0 ? reward / risk : 0;
    
    const signals: string[] = [];
    if (technicals?.rsi.signal === 'oversold') signals.push('RSI Oversold');
    if (technicals?.rsi.signal === 'overbought') signals.push('RSI Overbought');
    if (technicals?.macd.signal === 'bullish') signals.push('MACD Bullish');
    if (technicals?.macd.signal === 'bearish') signals.push('MACD Bearish');
    if (technicals?.movingAverages.goldenCross) signals.push('Golden Cross');
    if (technicals?.movingAverages.deathCross) signals.push('Death Cross');
    if (technicals?.movingAverages.priceVsSMA200 === 'above') signals.push('Above 200 SMA');
    if (technicals?.volume.unusual) signals.push('Unusual Volume');
    if (technicals?.bollingerBands.squeeze) signals.push('BB Squeeze');
    if (technicals?.adx.trending) signals.push('Strong Trend (ADX)');
    
    const keyRisks: string[] = [];
    if (regime.volatility === 'high' || regime.volatility === 'extreme') {
      keyRisks.push(`Elevated market volatility (VIX high)`);
    }
    if (regime.overall === 'bearish' && direction === 'bullish') {
      keyRisks.push('Trading against overall market trend');
    }
    if (technicals?.volume.ratio && technicals.volume.ratio < 0.7) {
      keyRisks.push('Below-average volume may limit moves');
    }
    if (score.total < 50) {
      keyRisks.push('Weak technical setup');
    }
    
    const headline = `${score.convictionLevel}: ${company.name} - ${direction.toUpperCase()} ${holdingPeriod.toUpperCase()} TRADE`;
    
    const priceActionDesc = technicals?.priceAction 
      ? `${technicals.priceAction.strength} ${technicals.priceAction.trend}` 
      : 'mixed signals';
    const summary = `${company.name} (${symbol}) in the ${company.sector} sector. ` +
      `${company.description.substring(0, 150)}... ` +
      `Technical setup shows ${priceActionDesc}. ` +
      `${signals.length > 0 ? `Key signals: ${signals.slice(0, 3).join(', ')}.` : ''} ` +
      `Market regime: ${regime.description} ` +
      `Multi-factor score: ${score.total}% (${score.grade}).`;
    
    const analysis: ComprehensiveAnalysis = {
      symbol,
      timestamp: new Date().toISOString(),
      company,
      regime,
      technicals: technicals || {} as TechnicalAnalysis,
      score,
      thesis: {
        direction,
        headline,
        summary,
        entryZone,
        targetPrice,
        stopLoss,
        riskReward,
        holdingPeriod,
        keyRisks,
        catalysts: company.catalysts,
        signals,
      },
    };
    
    logger.info(`[MFA] Completed analysis for ${symbol} in ${Date.now() - startTime}ms: ${score.total}% (${score.convictionLevel})`);
    
    return analysis;
  } catch (error) {
    logger.error(`[MFA] Failed to generate analysis for ${symbol}:`, error);
    return null;
  }
}

export function formatAnalysisForDisplay(analysis: ComprehensiveAnalysis): string {
  const { thesis, score, company, regime, technicals } = analysis;
  
  const tierEmoji = score.convictionLevel === 'INSIDER' ? '🔥' : 
                    score.convictionLevel === 'PRIORITY' ? '⭐' :
                    score.convictionLevel === 'WATCH' ? '👁️' : '⚠️';
  
  let output = `${tierEmoji} **${thesis.headline}**\n\n`;
  
  output += `📊 **CONVICTION SCORE: ${score.total}% (${score.grade})**\n`;
  output += `├─ Technicals: ${score.technicals}%\n`;
  output += `├─ Momentum: ${score.momentum}%\n`;
  output += `├─ Sentiment: ${score.sentiment}%\n`;
  output += `├─ Fundamentals: ${score.fundamentals}%\n`;
  output += `└─ Market Context: ${score.marketContext}%\n\n`;
  
  output += `🏢 **COMPANY**\n`;
  output += `${company.description}\n`;
  output += `Sector: ${company.sector} | Industry: ${company.industry}\n\n`;
  
  output += `📈 **TECHNICAL SETUP**\n`;
  if (technicals && Object.keys(technicals).length > 0) {
    output += `RSI: ${technicals.rsi?.value?.toFixed(1) || 'N/A'} (${technicals.rsi?.signal || 'N/A'})\n`;
    output += `MACD: ${technicals.macd?.signal || 'N/A'}\n`;
    output += `Trend: ${technicals.adx?.trending ? 'Strong' : 'Weak'} (ADX: ${technicals.adx?.value?.toFixed(1) || 'N/A'})\n`;
    output += `Volume: ${technicals.volume?.unusual ? '🔥 UNUSUAL' : 'Normal'} (${technicals.volume?.ratio?.toFixed(1) || 'N/A'}x avg)\n\n`;
  }
  
  output += `🎯 **TRADE THESIS**\n`;
  output += `Direction: ${thesis.direction.toUpperCase()}\n`;
  output += `Entry Zone: $${thesis.entryZone.low.toFixed(2)} - $${thesis.entryZone.high.toFixed(2)}\n`;
  output += `Target: $${thesis.targetPrice.toFixed(2)}\n`;
  output += `Stop Loss: $${thesis.stopLoss.toFixed(2)}\n`;
  output += `Risk/Reward: ${thesis.riskReward.toFixed(2)}:1\n`;
  output += `Holding Period: ${thesis.holdingPeriod.toUpperCase()}\n\n`;
  
  if (thesis.signals.length > 0) {
    output += `✅ **SIGNALS**\n${thesis.signals.map(s => `• ${s}`).join('\n')}\n\n`;
  }
  
  if (thesis.catalysts.length > 0) {
    output += `🚀 **CATALYSTS**\n${thesis.catalysts.map(c => `• ${c}`).join('\n')}\n\n`;
  }
  
  if (thesis.keyRisks.length > 0) {
    output += `⚠️ **RISKS**\n${thesis.keyRisks.map(r => `• ${r}`).join('\n')}\n\n`;
  }
  
  output += `🌍 **MARKET CONTEXT**\n${regime.description}\n`;
  
  return output;
}
