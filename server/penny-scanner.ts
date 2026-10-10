// Penny Stock Moonshot Scanner
// Scans for penny stocks across multiple tiers:
// - Ultra-Low: $0.0001-$0.10 (true sub-penny OTC)
// - Low: $0.10-$0.50 (penny territory)
// - Standard: $0.50-$10 (higher liquidity plays)
// Runs at 4:00 AM CT (premarket), 9:30 AM CT (market open), 8:00 PM CT (afterhours)

import type { InsertTradeIdea } from "@shared/schema";
import { getTradierQuote, getTradierHistoryOHLC } from './tradier-api';
import { logger } from './logger';
import { storage } from './storage';
import { formatInTimeZone } from 'date-fns-tz';
import { postDiscordWebhook } from './discord-service';

// TRUE SUB-PENNY STOCKS ($0.0001 - $0.20 range)
// These are OTC/Pink Sheets with extreme volatility potential
const SUB_PENNY_TICKERS = [
  // Sub-Penny Mining/Resources (often $0.001-$0.05)
  'HYSR', 'DPLS', 'OZSC', 'MINE', 'SHMP', 'ILUS', 'ABML', 'CLSK', 'CBDD',
  // Sub-Penny Cannabis (often $0.01-$0.10)
  'MCOA', 'PLIN', 'GRCU', 'MJNE', 'HEMP', 'GWSO', 'ACBFF',
  // Sub-Penny Tech/AI (often $0.001-$0.20)
  'MMEX', 'PAOG', 'BIEI', 'IMHC', 'DSCR', 'GTCH', 'AITX', 'WDLF',
  // Sub-Penny Biotech (volatile healthcare)
  'ASTI', 'BRTX', 'NSPR', 'NEPT', 'HPNN', 'CBBT',
  // Sub-Penny Crypto/Blockchain ($0.001-$0.10)
  'HIVE', 'BFCH', 'BTCS', 'WKEY', 'DMGGF', 'HUTMF', 'SDIG',
  // Sub-Penny EV/Clean Energy
  'PUGE', 'EVIO', 'SNPW', 'EEENF', 'MDCN', 'ALPP',
  // Sub-Penny Retail/Consumer
  'TSNP', 'MAXD', 'PRMO', 'AIAD', 'HCMC', 'SING',
  // Sub-Penny Speculative (HIGH RISK)
  'SEGI', 'VBHI', 'GEGI', 'ICOA', 'FERN', 'ENZC', 'EEENF', 'XSPA'
];

// STANDARD PENNY STOCKS ($0.50-$10 range)
const PENNY_SCAN_TICKERS = [
  // Quantum Computing ($1-10 range)
  'RGTI', 'QUBT', 'QBTS', 'ARQQ', 'QMCO', 'IONQ',
  // Nuclear ($1-10 range)
  'DNN', 'URG', 'LTBR', 'NNE', 'OKLO', 'SMR', 'UEC', 'UUUU',
  // AI Penny Stocks
  'BBAI', 'SOUN', 'GFAI',
  // Crypto Miners
  'MARA', 'RIOT', 'WULF', 'CLSK', 'APLD', 'BTBT', 'HUT', 'BITF', 'CIFR', 'IREN',
  // Biotech/Healthcare Penny Plays
  'NVAX', 'SRNE', 'BNGO', 'EDIT', 'INO', 'VXRT', 'NKTR', 'ADVM', 'FATE', 'GRTS',
  // Clean Energy
  'PLUG', 'FCEL', 'QS', 'STEM', 'CLNE', 'BLDP', 'ENVX',
  // EV & Autonomous
  'LCID', 'NIO', 'CHPT', 'BLNK', 'EVGO', 'NKLA',
  // Space & Drones
  'SPCE', 'BKSY', 'RDW', 'LUNR', 'RCAT', 'JOBY', 'ACHR', 'UAVS',
  // Cannabis
  'TLRY', 'CGC', 'SNDL',
  // Other High-Volatility Penny Stocks
  'SOFI', 'HOOD', 'PATH', 'OPEN', 'WISH', 'CLOV'
];

// Price tier configuration
const PRICE_TIERS = {
  ultraLow: { min: 0.0001, max: 0.10, label: 'Ultra-Low ($0.0001-$0.10)' },
  low: { min: 0.10, max: 0.50, label: 'Low ($0.10-$0.50)' },
  standard: { min: 0.50, max: 10.00, label: 'Standard ($0.50-$10)' }
};

interface PennyMoonshotCandidate {
  symbol: string;
  currentPrice: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  gapPercent: number;
  high52Week: number;
  low52Week: number;
  distanceFrom52Low: number;
  moonshotPotential: number;
  catalyst: string;
  signals: string[];
}

// Helper to format ultra-low prices with proper precision
export function formatPennyPrice(price: number): string {
  if (price < 0.0001) return price.toExponential(2);
  if (price < 0.001) return price.toFixed(6);
  if (price < 0.01) return price.toFixed(5);
  if (price < 0.1) return price.toFixed(4);
  if (price < 1) return price.toFixed(3);
  return price.toFixed(2);
}

// Scan sub-penny stocks ($0.0001 - $0.20 range)
export async function scanSubPennyMoonshots(): Promise<PennyMoonshotCandidate[]> {
  logger.info('💎 [SUB-PENNY-SCAN] Scanning for ultra-low penny stocks ($0.0001-$0.20)...');
  
  const candidates: PennyMoonshotCandidate[] = [];
  const batchSize = 8;
  
  const { checkAndMarkScanned } = await import('./scan-deduper');
  for (let i = 0; i < SUB_PENNY_TICKERS.length; i += batchSize) {
    const batch = SUB_PENNY_TICKERS.slice(i, i + batchSize).filter(symbol => {
      const scanCheck = checkAndMarkScanned(symbol, 'penny-sub');
      return !scanCheck.shouldSkip;
    });
    if (batch.length === 0) continue;
    
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const quote = await getTradierQuote(symbol);
          if (!quote) return null;
          
          const price = quote.last || quote.close;
          if (!price || price <= 0 || price > 0.20) return null;
          
          const volume = quote.volume || 0;
          const avgVolume = quote.average_volume || 1;
          const volumeRatio = avgVolume > 0 ? volume / avgVolume : 0;
          const changePercent = quote.change_percentage || 0;
          
          const gapPercent = quote.prevclose && quote.prevclose > 0 
            ? ((quote.open - quote.prevclose) / quote.prevclose) * 100 
            : 0;
          
          const high52Week = quote.week_52_high || price;
          const low52Week = quote.week_52_low || price;
          const distanceFrom52Low = low52Week > 0 ? ((price - low52Week) / low52Week) * 100 : 0;
          
          const signals: string[] = [];
          let moonshotScore = 0;
          
          if (price < 0.01) {
            signals.push(`💎 Sub-penny: $${formatPennyPrice(price)}`);
            moonshotScore += 30;
          } else if (price < 0.05) {
            signals.push(`💰 Micro-penny: $${formatPennyPrice(price)}`);
            moonshotScore += 20;
          }
          
          if (Math.abs(changePercent) > 10) {
            signals.push(`${changePercent > 0 ? '🚀' : '💥'} ${Math.abs(changePercent).toFixed(0)}% move`);
            moonshotScore += 25;
          }
          
          if (volumeRatio >= 1.5) {
            signals.push(`🔥 ${volumeRatio.toFixed(1)}x vol`);
            moonshotScore += 20;
          }
          
          if (high52Week > 0 && price < high52Week * 0.2) {
            const recoveryPotential = ((high52Week - price) / price * 100).toFixed(0);
            signals.push(`🎯 ${recoveryPotential}%+ potential`);
            moonshotScore += 25;
          }
          
          const hasActivity = volume >= 50000 || volumeRatio >= 1.5 || Math.abs(changePercent) > 5;
          if (!hasActivity) return null;
          
          const moonshotPotential = high52Week > 0 && price < high52Week 
            ? ((high52Week - price) / price * 100)
            : 200;
          
          let catalyst = 'Sub-penny momentum detected';
          if (volumeRatio >= 3) catalyst = 'MAJOR volume spike - possible accumulation';
          else if (Math.abs(changePercent) > 20) catalyst = 'Explosive move - potential runner';
          else if (price < 0.01) catalyst = 'Sub-cent play - extreme risk/reward';
          
          return {
            symbol,
            currentPrice: price,
            changePercent,
            volume,
            avgVolume,
            volumeRatio,
            gapPercent,
            high52Week,
            low52Week,
            distanceFrom52Low,
            moonshotPotential,
            catalyst,
            signals
          };
        } catch (error) {
          logger.debug(`💎 [SUB-PENNY-SCAN] ${symbol} not available:`, error);
          return null;
        }
      })
    );
    
    candidates.push(...batchResults.filter((c): c is PennyMoonshotCandidate => c !== null));
    
    if (i + batchSize < SUB_PENNY_TICKERS.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  candidates.sort((a, b) => {
    const scoreA = (Math.abs(a.changePercent) * 3) + (a.volumeRatio * 15) + (a.moonshotPotential * 0.1);
    const scoreB = (Math.abs(b.changePercent) * 3) + (b.volumeRatio * 15) + (b.moonshotPotential * 0.1);
    return scoreB - scoreA;
  });
  
  logger.info(`💎 [SUB-PENNY-SCAN] Found ${candidates.length} sub-penny opportunities`);
  return candidates.slice(0, 10);
}

export async function scanPennyMoonshots(): Promise<PennyMoonshotCandidate[]> {
  logger.info('🚀 [PENNY-SCAN] Scanning for moonshot opportunities...');
  
  const candidates: PennyMoonshotCandidate[] = [];
  const batchSize = 10;
  
  for (let i = 0; i < PENNY_SCAN_TICKERS.length; i += batchSize) {
    const batch = PENNY_SCAN_TICKERS.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        try {
          const quote = await getTradierQuote(symbol);
          if (!quote) return null;
          
          const price = quote.last || quote.close;
          if (!price || price < 0.50 || price > 10) return null;
          
          const volume = quote.volume || 0;
          const avgVolume = quote.average_volume || 1;
          const volumeRatio = avgVolume > 0 ? volume / avgVolume : 0;
          const changePercent = quote.change_percentage || 0;
          
          const gapPercent = quote.prevclose && quote.prevclose > 0 
            ? ((quote.open - quote.prevclose) / quote.prevclose) * 100 
            : 0;
          
          const high52Week = quote.week_52_high || price;
          const low52Week = quote.week_52_low || price;
          const distanceFrom52Low = low52Week > 0 ? ((price - low52Week) / low52Week) * 100 : 0;
          
          const signals: string[] = [];
          let moonshotScore = 0;
          
          if (Math.abs(changePercent) > 5) {
            signals.push(`${changePercent > 0 ? '📈' : '📉'} ${Math.abs(changePercent).toFixed(1)}% move`);
            moonshotScore += 20;
          }
          
          if (volumeRatio >= 2) {
            signals.push(`🔥 ${volumeRatio.toFixed(1)}x volume spike`);
            moonshotScore += 25;
          }
          
          if (Math.abs(gapPercent) > 3) {
            signals.push(`⚡ ${gapPercent > 0 ? '+' : ''}${gapPercent.toFixed(1)}% gap`);
            moonshotScore += 20;
          }
          
          if (price < 3) {
            signals.push('💰 Sub-$3 penny play');
            moonshotScore += 15;
          }
          
          if (high52Week > 0 && price < high52Week * 0.3) {
            const recoveryPotential = ((high52Week - price) / price * 100).toFixed(0);
            signals.push(`🎯 ${recoveryPotential}% to 52w high`);
            moonshotScore += 20;
          }
          
          if (volume >= 1000000) {
            signals.push('📊 1M+ volume');
            moonshotScore += 10;
          }
          
          const hasStrongSignals = (
            (Math.abs(changePercent) > 5 || volumeRatio >= 2 || Math.abs(gapPercent) > 3) &&
            volume >= 500000
          );
          
          if (!hasStrongSignals) return null;
          
          const moonshotPotential = high52Week > 0 && price < high52Week 
            ? ((high52Week - price) / price * 100)
            : 50;
          
          let catalyst = 'Unusual momentum detected';
          if (volumeRatio >= 3) catalyst = 'Major volume spike - institutional interest possible';
          else if (Math.abs(gapPercent) > 5) catalyst = 'Significant gap - news or catalyst likely';
          else if (Math.abs(changePercent) > 10) catalyst = 'Strong price momentum - breakout potential';
          else if (price < low52Week * 1.1) catalyst = 'Near 52-week lows - reversal potential';
          
          return {
            symbol,
            currentPrice: price,
            changePercent,
            volume,
            avgVolume,
            volumeRatio,
            gapPercent,
            high52Week,
            low52Week,
            distanceFrom52Low,
            moonshotPotential,
            catalyst,
            signals
          };
        } catch (error) {
          logger.error(`🚀 [PENNY-SCAN] Error scanning ${symbol}:`, error);
          return null;
        }
      })
    );
    
    candidates.push(...batchResults.filter((c): c is PennyMoonshotCandidate => c !== null));
    
    if (i + batchSize < PENNY_SCAN_TICKERS.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  candidates.sort((a, b) => {
    const scoreA = (Math.abs(a.changePercent) * 2) + (a.volumeRatio * 10) + (Math.abs(a.gapPercent) * 3);
    const scoreB = (Math.abs(b.changePercent) * 2) + (b.volumeRatio * 10) + (Math.abs(b.gapPercent) * 3);
    return scoreB - scoreA;
  });
  
  logger.info(`🚀 [PENNY-SCAN] Found ${candidates.length} moonshot candidates`);
  return candidates.slice(0, 10);
}

export async function sendPennyScanToDiscord(candidates: PennyMoonshotCandidate[]): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.warn('🚀 [PENNY-SCAN] Discord webhook URL not configured - skipping');
    return;
  }

  if (candidates.length === 0) {
    logger.info('🚀 [PENNY-SCAN] No moonshot candidates to send');
    return;
  }

  // DEDUPLICATION: Check if we can send notification (global + per-symbol cooldown)
  const { canSendPennyScannerNotification, markPennyScannerNotificationSent } = await import('./discord-service');
  const symbols = candidates.map(c => c.symbol);
  const dedupCheck = canSendPennyScannerNotification('standard', symbols);

  if (!dedupCheck.canSend) {
    logger.info(`🚀 [PENNY-SCAN] Discord notification BLOCKED: ${dedupCheck.reason}`);
    return;
  }

  // Filter candidates to only those that passed symbol dedup
  const filteredCandidates = candidates.filter(c => dedupCheck.filteredSymbols.includes(c.symbol));
  if (filteredCandidates.length === 0) {
    logger.info('🚀 [PENNY-SCAN] All candidates were recently notified - skipping Discord');
    return;
  }

  try {
    const nowCT = formatInTimeZone(new Date(), 'America/Chicago', 'h:mm a');
    const dateStr = formatInTimeZone(new Date(), 'America/Chicago', 'MMM d');

    // Use filtered candidates that passed deduplication
    // Filter to $1-$8 range (the moonshot sweet spot) and sort by potential
    let moonshotCandidates = filteredCandidates
      .filter(c => c.currentPrice >= 1 && c.currentPrice <= 8)
      .sort((a, b) => {
        const scoreA = (Math.abs(a.changePercent) * 2) + (a.volumeRatio * 10) + (a.moonshotPotential * 0.5);
        const scoreB = (Math.abs(b.changePercent) * 2) + (b.volumeRatio * 10) + (b.moonshotPotential * 0.5);
        return scoreB - scoreA;
      })
      .slice(0, 5);

    // Fallback to top momentum plays if no $1-$8 candidates
    if (moonshotCandidates.length === 0) {
      logger.info('🚀 [PENNY-SCAN] No $1-$8 candidates, falling back to top momentum');
      const fallbackCandidates = filteredCandidates
        .sort((a, b) => (Math.abs(b.changePercent) + b.volumeRatio * 5) - (Math.abs(a.changePercent) + a.volumeRatio * 5))
        .slice(0, 3);

      if (fallbackCandidates.length === 0) {
        logger.info('🚀 [PENNY-SCAN] No candidates found at all');
        return;
      }

      // Use fallback candidates for the rest of the function
      moonshotCandidates.push(...fallbackCandidates);
    }
    
    // Calculate moonshot targets based on price range
    const getTargets = (price: number, high52: number) => {
      if (price < 2) return { t1: 4, t2: 8, t3: 15 };
      if (price < 4) return { t1: 8, t2: 15, t3: 25 };
      if (price < 6) return { t1: 12, t2: 20, t3: 35 };
      return { t1: 15, t2: 25, t3: Math.min(45, high52 || 45) };
    };
    
    // Build cohesive embed description
    let description = '';
    
    for (const candidate of moonshotCandidates) {
      const targets = getTargets(candidate.currentPrice, candidate.high52Week);
      const volumeDisplay = candidate.volume >= 1000000 
        ? `${(candidate.volume / 1000000).toFixed(1)}M` 
        : `${(candidate.volume / 1000).toFixed(0)}K`;
      
      const changeSign = candidate.changePercent > 0 ? '+' : '';
      const changeEmoji = candidate.changePercent > 5 ? '🟢' : candidate.changePercent < -5 ? '🔴' : '⚪';
      
      // Confidence grade based on signals
      const confidence = Math.min(95, 50 + (candidate.volumeRatio * 8) + (Math.abs(candidate.changePercent) * 1.5));
      const grade = confidence >= 80 ? 'A' : confidence >= 70 ? 'B+' : confidence >= 60 ? 'B' : 'C+';
      const gradeEmoji = confidence >= 80 ? '🔥' : confidence >= 70 ? '⭐' : confidence >= 60 ? '✨' : '📊';
      
      description += `${changeEmoji} **$${candidate.symbol}** @ $${candidate.currentPrice.toFixed(2)} (${changeSign}${candidate.changePercent.toFixed(1)}%)\n`;
      description += `┌ 🎯 Targets: **$${targets.t1}** → **$${targets.t2}** → **$${targets.t3}**\n`;
      description += `├ 🛡️ Stop: $${(candidate.currentPrice * 0.85).toFixed(2)} | ${gradeEmoji} Grade: **${grade}** (${confidence.toFixed(0)}%)\n`;
      description += `├ 📊 Vol: ${volumeDisplay} (${candidate.volumeRatio.toFixed(1)}x avg)\n`;
      description += `└ ⚡ ${candidate.catalyst}\n\n`;
    }
    
    // Stats
    const avgConf = Math.round(moonshotCandidates.reduce((s, c) => 
      s + Math.min(95, 50 + (c.volumeRatio * 8) + (Math.abs(c.changePercent) * 1.5)), 0) / moonshotCandidates.length);
    const avgVol = (moonshotCandidates.reduce((s, c) => s + c.volumeRatio, 0) / moonshotCandidates.length).toFixed(1);
    const bullish = moonshotCandidates.filter(c => c.changePercent > 0).length;
    
    const embed = {
      title: `🚀 PENNY MOONSHOT SCANNER - ${dateStr}`,
      description: description.trim(),
      color: 0x6BCB77,
      fields: [
        { name: '📊 Summary', value: `${moonshotCandidates.length} picks | ${bullish}/${moonshotCandidates.length} bullish`, inline: true },
        { name: '⭐ Avg Grade', value: `${avgConf}% confidence`, inline: true },
        { name: '📈 Avg Volume', value: `${avgVol}x normal`, inline: true }
      ],
      footer: { text: `⚠️ High risk $1-$8 moonshots - position size small | Quant Edge Labs | ${nowCT} CT` },
      timestamp: new Date().toISOString()
    };
    
    const message = {
      content: `🚀 **PENNY MOONSHOTS** → ${moonshotCandidates.length} stocks ($1-$8) with $15-$45+ potential`,
      embeds: [embed]
    };
    
    const response = await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    
    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }

    // Mark notification as sent to prevent spam
    markPennyScannerNotificationSent('standard', moonshotCandidates.map(c => c.symbol));
    logger.info(`🚀 [PENNY-SCAN] Discord alert sent for ${moonshotCandidates.length} moonshot candidates (deduped)`);
  } catch (error) {
    logger.error('🚀 [PENNY-SCAN] Failed to send Discord alert:', error);
  }
}

export async function storePennyIdeas(candidates: PennyMoonshotCandidate[]): Promise<number> {
  let storedCount = 0;
  
  for (const candidate of candidates.slice(0, 5)) {
    try {
      const existingIdeas = await storage.getAllTradeIdeas();
      const hasDuplicate = existingIdeas.some((idea: any) => 
        idea.symbol === candidate.symbol && 
        idea.source === 'penny-scanner' &&
        idea.outcomeStatus === 'open' &&
        new Date(idea.timestamp).getTime() > Date.now() - 24 * 60 * 60 * 1000
      );
      
      if (hasDuplicate) {
        logger.info(`🚀 [PENNY-SCAN] Skipping duplicate: ${candidate.symbol}`);
        continue;
      }
      
      const targetMultiplier = candidate.moonshotPotential > 100 ? 1.50 : 1.30;
      const stopMultiplier = 0.85;
      
      const entryPrice = candidate.currentPrice;
      const targetPrice = entryPrice * targetMultiplier;
      const stopLoss = entryPrice * stopMultiplier;
      
      const potentialGain = ((targetPrice - entryPrice) / entryPrice) * 100;
      const potentialLoss = ((entryPrice - stopLoss) / entryPrice) * 100;
      const riskRewardRatio = potentialGain / potentialLoss;
      
      const nowCT = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd\'T\'HH:mm:ss');
      
      const idea: InsertTradeIdea = {
        symbol: candidate.symbol,
        assetType: 'penny_stock',
        direction: candidate.changePercent > 0 ? 'long' : 'short',
        holdingPeriod: 'swing',
        entryPrice,
        targetPrice,
        stopLoss,
        riskRewardRatio: Math.round(riskRewardRatio * 10) / 10,
        catalyst: candidate.catalyst,
        analysis: `🚀 PENNY MOONSHOT SCANNER\n\n` +
          `Signals: ${candidate.signals.join(', ')}\n` +
          `Volume: ${(candidate.volume / 1000000).toFixed(2)}M (${candidate.volumeRatio.toFixed(1)}x avg)\n` +
          `Gap: ${candidate.gapPercent > 0 ? '+' : ''}${candidate.gapPercent.toFixed(1)}%\n` +
          `52W Range: $${candidate.low52Week.toFixed(2)} - $${candidate.high52Week.toFixed(2)}\n` +
          `Moonshot Potential: ${candidate.moonshotPotential.toFixed(0)}%\n\n` +
          `⚠️ HIGH RISK PENNY PLAY - TRADE SMALL POSITION SIZE ONLY!\n` +
          `This is a speculative trade based on momentum signals. Use strict stop losses.`,
        sessionContext: `Penny Moonshot - ${candidate.signals[0] || 'Momentum'}`,
        timestamp: nowCT,
        source: 'penny-scanner' as any,
        status: 'published',
        confidenceScore: Math.min(75, 40 + (candidate.volumeRatio * 5) + (Math.abs(candidate.changePercent))),
        probabilityBand: candidate.volumeRatio >= 3 ? 'B' : 'C+',
        qualitySignals: candidate.signals,
        riskProfile: 'speculative',
        dataSourceUsed: 'tradier',
        volumeRatio: candidate.volumeRatio,
        outcomeStatus: 'open',
      };
      
      await storage.createTradeIdea(idea);
      storedCount++;
      logger.info(`🚀 [PENNY-SCAN] Stored trade idea: ${candidate.symbol}`);
    } catch (error) {
      logger.error(`🚀 [PENNY-SCAN] Failed to store idea for ${candidate.symbol}:`, error);
    }
  }
  
  return storedCount;
}

export async function runPennyScan(): Promise<{ candidates: PennyMoonshotCandidate[]; storedCount: number; subPennyCandidates?: PennyMoonshotCandidate[] }> {
  logger.info('🚀 [PENNY-SCAN] Starting comprehensive penny scan (all tiers)...');
  
  try {
    const [standardCandidates, subPennyCandidates] = await Promise.all([
      scanPennyMoonshots(),
      scanSubPennyMoonshots()
    ]);
    
    const allCandidates = [...standardCandidates, ...subPennyCandidates];
    let storedCount = 0;
    
    if (standardCandidates.length > 0) {
      await sendPennyScanToDiscord(standardCandidates);
      storedCount += await storePennyIdeas(standardCandidates);
    }
    
    if (subPennyCandidates.length > 0) {
      await sendSubPennyScanToDiscord(subPennyCandidates);
      storedCount += await storePennyIdeas(subPennyCandidates);
    }
    
    logger.info(`🚀 [PENNY-SCAN] Scan complete: ${standardCandidates.length} standard + ${subPennyCandidates.length} sub-penny, ${storedCount} stored`);
    return { candidates: standardCandidates, subPennyCandidates, storedCount };
  } catch (error) {
    logger.error('🚀 [PENNY-SCAN] Scan failed:', error);
    return { candidates: [], storedCount: 0 };
  }
}

async function sendSubPennyScanToDiscord(candidates: PennyMoonshotCandidate[]): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.warn('💎 [SUB-PENNY-SCAN] Discord webhook URL not configured');
    return;
  }

  if (candidates.length === 0) return;

  // DEDUPLICATION: Check if we can send notification (global + per-symbol cooldown)
  const { canSendPennyScannerNotification, markPennyScannerNotificationSent } = await import('./discord-service');
  const symbols = candidates.map(c => c.symbol);
  const dedupCheck = canSendPennyScannerNotification('subpenny', symbols);

  if (!dedupCheck.canSend) {
    logger.info(`💎 [SUB-PENNY-SCAN] Discord notification BLOCKED: ${dedupCheck.reason}`);
    return;
  }

  // Filter candidates to only those that passed symbol dedup
  const filteredCandidates = candidates.filter(c => dedupCheck.filteredSymbols.includes(c.symbol));
  if (filteredCandidates.length === 0) {
    logger.info('💎 [SUB-PENNY-SCAN] All candidates were recently notified - skipping Discord');
    return;
  }

  try {
    const nowCT = formatInTimeZone(new Date(), 'America/Chicago', 'h:mm a');

    let message = '💎 **SUB-PENNY SCANNER** ($0.0001-$0.20)\n';
    message += '━━━━━━━━━━━━━━━━━━━━━━━\n\n';

    for (const candidate of filteredCandidates.slice(0, 5)) {
      const volumeDisplay = candidate.volume >= 1000000 
        ? `${(candidate.volume / 1000000).toFixed(1)}M` 
        : `${(candidate.volume / 1000).toFixed(0)}K`;
      
      const changeEmoji = candidate.changePercent > 0 ? '🟢' : '🔴';
      const changeSign = candidate.changePercent > 0 ? '+' : '';
      
      message += `**$${candidate.symbol}** - $${formatPennyPrice(candidate.currentPrice)} (${changeSign}${candidate.changePercent.toFixed(1)}%) ${changeEmoji}\n`;
      message += `📊 Volume: ${volumeDisplay} (${candidate.volumeRatio.toFixed(1)}x avg)\n`;
      message += `💡 ${candidate.catalyst}\n`;
      message += `🎯 Potential: ${candidate.moonshotPotential.toFixed(0)}%+\n`;
      if (candidate.signals.length > 0) {
        message += `📡 ${candidate.signals.join(' | ')}\n`;
      }
      message += '\n';
    }
    
    message += '⚠️ **EXTREME RISK - OTC/Pink Sheets - Trade MICRO positions only!**\n';
    message += `_Scanned at ${nowCT} CT_`;
    
    const response = await postDiscordWebhook(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    
    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }

    // Mark notification as sent to prevent spam
    markPennyScannerNotificationSent('subpenny', filteredCandidates.map(c => c.symbol));
    logger.info(`💎 [SUB-PENNY-SCAN] Discord alert sent for ${filteredCandidates.length} sub-penny picks (deduped)`);
  } catch (error) {
    logger.error('💎 [SUB-PENNY-SCAN] Failed to send Discord alert:', error);
  }
}

class PennyScanner {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunTime: Date | null = null;

  start() {
    if (this.intervalId) {
      logger.info('🚀 [PENNY-SCAN] Scanner already running');
      return;
    }

    logger.info('🚀 [PENNY-SCAN] Starting Penny Moonshot Scanner');
    logger.info('🚀 [PENNY-SCAN] Schedule: 4:00 AM CT (premarket), 9:30 AM CT (open), 8:00 PM CT (afterhours)');
    
    this.checkAndRun().catch(err => 
      logger.error('🚀 [PENNY-SCAN] Initial check failed:', err)
    );

    this.intervalId = setInterval(() => {
      this.checkAndRun().catch(err => 
        logger.error('🚀 [PENNY-SCAN] Check failed:', err)
      );
    }, 5 * 60 * 1000);

    logger.info('🚀 [PENNY-SCAN] Scanner started (checking every 5 minutes)');
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('🚀 [PENNY-SCAN] Scanner stopped');
    }
  }

  private async checkAndRun(): Promise<void> {
    if (this.isRunning) return;

    const now = new Date();
    const nowCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const hour = nowCT.getHours();
    const minute = nowCT.getMinutes();
    const dayOfWeek = nowCT.getDay();

    if (dayOfWeek === 0 || dayOfWeek === 6) return;

    const scanWindows = [
      { hour: 4, minStart: 0, minEnd: 5, label: '4:00 AM Premarket' },
      { hour: 9, minStart: 30, minEnd: 35, label: '9:30 AM Market Open' },
      { hour: 20, minStart: 0, minEnd: 5, label: '8:00 PM Afterhours' },
    ];
    
    const currentWindow = scanWindows.find(
      window => hour === window.hour && minute >= window.minStart && minute < window.minEnd
    );
    
    if (!currentWindow) return;

    // Prevent duplicate scans - require 3 hours between runs (was 2)
    if (this.lastRunTime) {
      const hoursSinceLastRun = (now.getTime() - this.lastRunTime.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastRun < 3) {
        logger.info(`🚀 [PENNY-SCAN] Skipping - only ${hoursSinceLastRun.toFixed(1)}h since last run`);
        return;
      }
    }

    this.isRunning = true;
    this.lastRunTime = now;

    try {
      logger.info(`🚀 [PENNY-SCAN] Running ${currentWindow.label} scan...`);
      await runPennyScan();
    } finally {
      this.isRunning = false;
    }
  }

  async forceRun(): Promise<{ candidates: PennyMoonshotCandidate[]; storedCount: number }> {
    logger.info('🚀 [PENNY-SCAN] Force running penny scan...');
    return await runPennyScan();
  }
}

export const pennyScanner = new PennyScanner();
