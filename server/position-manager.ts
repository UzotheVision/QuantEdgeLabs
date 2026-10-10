/**
 * POSITION MANAGER - Trading Intuition & Decision Engine
 *
 * This module provides autonomous trading intelligence for active position management.
 * It combines rule-based logic, quantitative analysis, and LLM-powered market context.
 */

import { getPositions, closePosition, getAccount } from './alpaca-trading';
import { logger } from './logger';
import axios from 'axios';

// ============================================
// TYPES
// ============================================

interface Position {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pl: number;
  unrealized_plpc: number;
  market_value: number;
  cost_basis: number;
  side: 'long' | 'short';
  asset_class: string;
}

interface PositionAnalysis {
  symbol: string;
  action: 'HOLD' | 'CLOSE_FULL' | 'CLOSE_HALF' | 'TIGHTEN_STOP' | 'URGENT_CLOSE';
  reason: string;
  confidence: number;
  profitPct: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  marketContext?: string;
  recommendation?: string;
}

interface MarketContext {
  ticker: string;
  direction: 'down' | 'up' | 'sideways';
  momentum: 'strengthening' | 'weakening' | 'neutral';
  sentiment: 'bullish' | 'bearish' | 'neutral';
  catalysts: string[];
  outlook: string;
  recommendation: 'hold' | 'close' | 'scale_out';
}

// ============================================
// CONFIGURATION
// ============================================

const PROFIT_TARGETS = {
  URGENT_CLOSE: 3.0,    // 300% - close immediately before reversal
  SCALE_OUT: 2.0,       // 200% - take 50% off
  TAKE_PROFIT: 1.5,     // 150% - close 100%
  TARGET: 0.5           // 50% - original target
};

const RISK_THRESHOLDS = {
  STOP_LOSS: -0.10,        // -10%
  TRAILING_ACTIVATION: 0.3, // 30% - activate trailing stop
  TRAILING_DISTANCE: 0.15   // 15% - trail by this amount
};

// ============================================
// LAYER 1: FAST RULE-BASED CHECKS
// ============================================

export function evaluatePositionRules(position: Position): PositionAnalysis {
  const profitPct = position.unrealized_plpc;

  // URGENT: 300%+ profit - close before reversal
  if (profitPct >= PROFIT_TARGETS.URGENT_CLOSE) {
    return {
      symbol: position.symbol,
      action: 'URGENT_CLOSE',
      reason: `🚨 URGENT: At ${(profitPct * 100).toFixed(0)}% profit (6x target). Close before reversal!`,
      confidence: 1.0,
      profitPct,
      riskLevel: 'CRITICAL'
    };
  }

  // SCALE OUT: 200%+ profit - take half off
  if (profitPct >= PROFIT_TARGETS.SCALE_OUT) {
    return {
      symbol: position.symbol,
      action: 'CLOSE_HALF',
      reason: `💰 At ${(profitPct * 100).toFixed(0)}% profit (4x target). Scale out 50% to lock gains.`,
      confidence: 0.9,
      profitPct,
      riskLevel: 'HIGH'
    };
  }

  // TAKE PROFIT: 150%+ profit - close full
  if (profitPct >= PROFIT_TARGETS.TAKE_PROFIT) {
    return {
      symbol: position.symbol,
      action: 'CLOSE_FULL',
      reason: `✅ At ${(profitPct * 100).toFixed(0)}% profit (3x target). Take full profit.`,
      confidence: 0.85,
      profitPct,
      riskLevel: 'MEDIUM'
    };
  }

  // STOP LOSS: -10% loss
  if (profitPct <= RISK_THRESHOLDS.STOP_LOSS) {
    return {
      symbol: position.symbol,
      action: 'URGENT_CLOSE',
      reason: `🛑 Stop loss hit at ${(profitPct * 100).toFixed(0)}%. Exit immediately.`,
      confidence: 1.0,
      profitPct,
      riskLevel: 'CRITICAL'
    };
  }

  // TRAILING STOP: Tighten stop after 30% profit
  if (profitPct >= RISK_THRESHOLDS.TRAILING_ACTIVATION) {
    return {
      symbol: position.symbol,
      action: 'TIGHTEN_STOP',
      reason: `📈 At ${(profitPct * 100).toFixed(0)}% profit. Tighten stop to ${((profitPct - RISK_THRESHOLDS.TRAILING_DISTANCE) * 100).toFixed(0)}%`,
      confidence: 0.7,
      profitPct,
      riskLevel: 'LOW'
    };
  }

  // HOLD: Within normal range
  return {
    symbol: position.symbol,
    action: 'HOLD',
    reason: `Holding at ${(profitPct * 100).toFixed(0)}% P/L`,
    confidence: 0.6,
    profitPct,
    riskLevel: 'LOW'
  };
}

// ============================================
// LAYER 2: DECISION ENGINE
// ============================================

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private trailingStops: Map<string, number> = new Map();

  async analyzeAllPositions(): Promise<PositionAnalysis[]> {
    try {
      logger.info('[POSITION-MANAGER] 🧠 Analyzing all positions...');

      const positions = await this.fetchPositions();
      const analyses: PositionAnalysis[] = [];

      for (const position of positions) {
        // Layer 1: Fast rules
        const ruleAnalysis = evaluatePositionRules(position);

        // Layer 2: Enhanced decision logic
        const enhancedAnalysis = await this.enhanceAnalysis(position, ruleAnalysis);

        analyses.push(enhancedAnalysis);

        // Log critical decisions
        if (enhancedAnalysis.action !== 'HOLD') {
          logger.warn(`[POSITION-MANAGER] ${enhancedAnalysis.symbol}: ${enhancedAnalysis.action} - ${enhancedAnalysis.reason}`);
        }
      }

      return analyses;
    } catch (error) {
      logger.error(`[POSITION-MANAGER] Error analyzing positions: ${error}`);
      return [];
    }
  }

  private async fetchPositions(): Promise<Position[]> {
    try {
      const positions = await getPositions();
      return positions as any[];
    } catch (error) {
      logger.error(`[POSITION-MANAGER] Error fetching positions: ${error}`);
      return [];
    }
  }

  private async enhanceAnalysis(position: Position, ruleAnalysis: PositionAnalysis): Promise<PositionAnalysis> {
    // Add time-based logic for options
    if (position.asset_class === 'us_option') {
      const daysToExpiry = this.getDaysToExpiry(position.symbol);

      // Options: Close high-profit positions near expiration
      if (daysToExpiry <= 7 && position.unrealized_plpc > 1.0) {
        return {
          ...ruleAnalysis,
          action: 'CLOSE_FULL',
          reason: `⏰ Option expires in ${daysToExpiry} days with ${(position.unrealized_plpc * 100).toFixed(0)}% profit. Lock it in!`,
          confidence: 0.95,
          riskLevel: 'HIGH'
        };
      }

      // Options: Theta decay risk
      if (daysToExpiry <= 3 && position.unrealized_plpc < 0.2) {
        return {
          ...ruleAnalysis,
          action: 'CLOSE_FULL',
          reason: `⚠️ Theta decay: ${daysToExpiry} days left, only ${(position.unrealized_plpc * 100).toFixed(0)}% profit. Cut it.`,
          confidence: 0.8,
          riskLevel: 'MEDIUM'
        };
      }
    }

    // Update trailing stops
    if (ruleAnalysis.action === 'TIGHTEN_STOP') {
      const trailLevel = position.unrealized_plpc - RISK_THRESHOLDS.TRAILING_DISTANCE;
      this.trailingStops.set(position.symbol, trailLevel);
      logger.info(`[POSITION-MANAGER] ${position.symbol} trailing stop updated to ${(trailLevel * 100).toFixed(0)}%`);
    }

    return ruleAnalysis;
  }

  private getDaysToExpiry(optionSymbol: string): number {
    // Parse OCC format: TICKER260220P00021000
    // Date format: YYMMDD
    const dateMatch = optionSymbol.match(/(\d{6})[CP]/);
    if (!dateMatch) return 999;

    const dateStr = dateMatch[1];
    const year = 2000 + parseInt(dateStr.substring(0, 2));
    const month = parseInt(dateStr.substring(2, 4)) - 1;
    const day = parseInt(dateStr.substring(4, 6));

    const expiryDate = new Date(year, month, day);
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }

  async executeDecisions(analyses: PositionAnalysis[]): Promise<void> {
    for (const analysis of analyses) {
      if (analysis.action === 'HOLD') continue;

      try {
        await this.executeAction(analysis);
      } catch (error) {
        logger.error(`[POSITION-MANAGER] Failed to execute ${analysis.action} for ${analysis.symbol}: ${error}`);
      }
    }
  }

  private async executeAction(analysis: PositionAnalysis): Promise<void> {
    logger.info(`[POSITION-MANAGER] 🎯 Executing ${analysis.action} for ${analysis.symbol}`);

    switch (analysis.action) {
      case 'URGENT_CLOSE':
      case 'CLOSE_FULL':
        await this.closePositionInternal(analysis.symbol, 1.0);
        break;

      case 'CLOSE_HALF':
        await this.closePositionInternal(analysis.symbol, 0.5);
        break;

      case 'TIGHTEN_STOP':
        // Stop is already tracked in trailingStops map
        logger.info(`[POSITION-MANAGER] ${analysis.symbol} stop tightened (tracked internally)`);
        break;
    }
  }

  private async closePositionInternal(symbol: string, percentage: number): Promise<void> {
    try {
      if (percentage >= 1.0) {
        // Close full position
        await closePosition(symbol);
        logger.info(`[POSITION-MANAGER] ✅ Closed full position: ${symbol}`);
      } else {
        // Partial close - need to use submitOrder from alpaca-trading
        const { submitOrder } = await import('./alpaca-trading');
        const positions = await getPositions();
        const position = positions.find(p => p.symbol === symbol);

        if (!position) {
          logger.error(`[POSITION-MANAGER] Position ${symbol} not found`);
          return;
        }

        const qtyToClose = Math.floor(parseInt(position.qty) * percentage);

        await submitOrder({
          symbol,
          qty: qtyToClose,
          side: 'sell',
          type: 'market',
          timeInForce: 'day'
        });

        logger.info(`[POSITION-MANAGER] ✅ Closed ${percentage * 100}% of ${symbol} (${qtyToClose} contracts)`);
      }
    } catch (error) {
      logger.error(`[POSITION-MANAGER] Error closing ${symbol}: ${error}`);
      throw error;
    }
  }
}

// ============================================
// LAYER 3: LLM MARKET CONTEXT ANALYST
// ============================================

export class MarketContextAnalyst {
  private readonly TRADIER_API_KEY = process.env.TRADIER_API_KEY || '';
  private readonly ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || '';

  async analyzeMarketContext(ticker: string, position: Position): Promise<MarketContext> {
    try {
      logger.info(`[MARKET-CONTEXT] 🔍 Analyzing ${ticker}...`);

      // Get real-time data
      const [priceData, newsData] = await Promise.all([
        this.getPriceMovement(ticker),
        this.getNews(ticker)
      ]);

      // Analyze with LLM
      const context = await this.getLLMAnalysis(ticker, position, priceData, newsData);

      return context;
    } catch (error) {
      logger.error(`[MARKET-CONTEXT] Error analyzing ${ticker}: ${error}`);
      return {
        ticker,
        direction: 'sideways',
        momentum: 'neutral',
        sentiment: 'neutral',
        catalysts: [],
        outlook: 'Insufficient data',
        recommendation: 'hold'
      };
    }
  }

  private async getPriceMovement(ticker: string): Promise<any> {
    try {
      // Remove option suffix for stock quotes
      const stockTicker = ticker.replace(/\d{6}[CP]\d+$/, '');

      const response = await axios.get(
        `https://api.tradier.com/v1/markets/quotes`,
        {
          headers: { 'Authorization': `Bearer ${this.TRADIER_API_KEY}`, 'Accept': 'application/json' },
          params: { symbols: stockTicker }
        }
      );

      return response.data.quotes?.quote || {};
    } catch (error) {
      logger.error(`[MARKET-CONTEXT] Error fetching price for ${ticker}: ${error}`);
      return {};
    }
  }

  private async getNews(ticker: string): Promise<any[]> {
    try {
      const stockTicker = ticker.replace(/\d{6}[CP]\d+$/, '');

      const response = await axios.get(
        `https://www.alphavantage.co/query`,
        {
          params: {
            function: 'NEWS_SENTIMENT',
            tickers: stockTicker,
            apikey: this.ALPHA_VANTAGE_API_KEY,
            limit: 5
          }
        }
      );

      return response.data.feed || [];
    } catch (error) {
      logger.error(`[MARKET-CONTEXT] Error fetching news for ${ticker}: ${error}`);
      return [];
    }
  }

  private async getLLMAnalysis(ticker: string, position: Position, priceData: any, newsData: any[]): Promise<MarketContext> {
    // Use the multi-LLM system (Gemini/Groq) for analysis
    const prompt = this.buildAnalysisPrompt(ticker, position, priceData, newsData);

    try {
      // TODO: Integrate with existing multi-LLM system
      // For now, return basic analysis based on price action

      const direction = this.analyzePriceDirection(priceData);
      const momentum = this.analyzeMomentum(priceData);
      const sentiment = this.analyzeSentiment(newsData);
      const catalysts = this.extractCatalysts(newsData);

      return {
        ticker,
        direction,
        momentum,
        sentiment,
        catalysts,
        outlook: this.generateOutlook(direction, momentum, sentiment, position),
        recommendation: this.generateRecommendation(direction, momentum, sentiment, position)
      };
    } catch (error) {
      logger.error(`[MARKET-CONTEXT] LLM analysis failed: ${error}`);
      return {
        ticker,
        direction: 'sideways',
        momentum: 'neutral',
        sentiment: 'neutral',
        catalysts: [],
        outlook: 'Analysis unavailable',
        recommendation: 'hold'
      };
    }
  }

  private buildAnalysisPrompt(ticker: string, position: Position, priceData: any, newsData: any[]): string {
    return `
Analyze this trading position:

Ticker: ${ticker}
Current P/L: ${(position.unrealized_plpc * 100).toFixed(2)}%
Entry: $${position.avg_entry_price}
Current: $${position.current_price}

Price Data:
- Change Today: ${priceData.change_percentage || 'N/A'}%
- Volume: ${priceData.volume || 'N/A'}
- 52w High/Low: ${priceData.high || 'N/A'} / ${priceData.low || 'N/A'}

Recent News:
${newsData.slice(0, 3).map(n => `- ${n.title}`).join('\n')}

Questions:
1. Why is this stock moving in this direction?
2. What are the key catalysts?
3. Will momentum continue or reverse?
4. Should I hold, close, or scale out this position?

Provide: Direction (up/down/sideways), Momentum (strengthening/weakening), Sentiment (bullish/bearish), Recommendation (hold/close/scale_out)
`;
  }

  private analyzePriceDirection(priceData: any): 'up' | 'down' | 'sideways' {
    const changePercent = parseFloat(priceData.change_percentage || 0);
    if (changePercent > 2) return 'up';
    if (changePercent < -2) return 'down';
    return 'sideways';
  }

  private analyzeMomentum(priceData: any): 'strengthening' | 'weakening' | 'neutral' {
    // Simple momentum based on volume and price change
    const volume = parseInt(priceData.volume || 0);
    const avgVolume = parseInt(priceData.average_volume || 0);
    const changePercent = Math.abs(parseFloat(priceData.change_percentage || 0));

    if (volume > avgVolume * 1.5 && changePercent > 3) return 'strengthening';
    if (volume < avgVolume * 0.5 || changePercent < 1) return 'weakening';
    return 'neutral';
  }

  private analyzeSentiment(newsData: any[]): 'bullish' | 'bearish' | 'neutral' {
    if (!newsData.length) return 'neutral';

    // Analyze news sentiment scores
    const avgSentiment = newsData.reduce((sum, n) => {
      const score = parseFloat(n.overall_sentiment_score || 0);
      return sum + score;
    }, 0) / newsData.length;

    if (avgSentiment > 0.2) return 'bullish';
    if (avgSentiment < -0.2) return 'bearish';
    return 'neutral';
  }

  private extractCatalysts(newsData: any[]): string[] {
    return newsData
      .slice(0, 3)
      .map(n => n.title)
      .filter(Boolean);
  }

  private generateOutlook(
    direction: string,
    momentum: string,
    sentiment: string,
    position: Position
  ): string {
    const profitPct = (position.unrealized_plpc * 100).toFixed(0);

    if (position.unrealized_plpc > 2.0) {
      return `🚨 Up ${profitPct}%! ${direction.toUpperCase()} trend, ${momentum} momentum. Consider taking profits before reversal.`;
    }

    if (position.unrealized_plpc < -0.05) {
      return `⚠️ Down ${profitPct}%. ${direction.toUpperCase()} trend, ${momentum} momentum, ${sentiment} sentiment. Watch for further decline.`;
    }

    return `${direction.toUpperCase()} trend, ${momentum} momentum, ${sentiment} sentiment. Position at ${profitPct}%.`;
  }

  private generateRecommendation(
    direction: string,
    momentum: string,
    sentiment: string,
    position: Position
  ): 'hold' | 'close' | 'scale_out' {
    // High profit + weakening momentum = close
    if (position.unrealized_plpc > 2.0 && momentum === 'weakening') {
      return 'close';
    }

    // Very high profit = scale out
    if (position.unrealized_plpc > 1.5) {
      return 'scale_out';
    }

    // Loss + bearish sentiment = close
    if (position.unrealized_plpc < -0.05 && sentiment === 'bearish') {
      return 'close';
    }

    return 'hold';
  }
}

// ============================================
// MAIN LOOP INTEGRATION
// ============================================

let positionManagerInterval: NodeJS.Timeout | null = null;
let contextAnalystInterval: NodeJS.Timeout | null = null;

const positionManager = new PositionManager();
const contextAnalyst = new MarketContextAnalyst();

export async function startIntelligentMonitoring(): Promise<void> {
  logger.info('[POSITION-MANAGER] 🧠 Starting intelligent position monitoring...');

  // Layer 1 + 2: Fast rules + Decision engine (every 60s)
  positionManagerInterval = setInterval(async () => {
    try {
      const analyses = await positionManager.analyzeAllPositions();
      await positionManager.executeDecisions(analyses);
    } catch (error) {
      logger.error(`[POSITION-MANAGER] Monitoring error: ${error}`);
    }
  }, 60 * 1000);

  // Layer 3: Market context analysis (every 5min)
  contextAnalystInterval = setInterval(async () => {
    try {
      const positions = await getPositions();

      for (const position of positions) {
        const context = await contextAnalyst.analyzeMarketContext(position.symbol, position);
        logger.info(`[MARKET-CONTEXT] ${position.symbol}: ${context.outlook}`);

        if (context.recommendation === 'close' || context.recommendation === 'scale_out') {
          logger.warn(`[MARKET-CONTEXT] 💡 ${position.symbol} recommendation: ${context.recommendation.toUpperCase()}`);
        }
      }
    } catch (error) {
      logger.error(`[MARKET-CONTEXT] Analysis error: ${error}`);
    }
  }, 5 * 60 * 1000);

  logger.info('[POSITION-MANAGER] ✅ Intelligent monitoring started');
}

export function stopIntelligentMonitoring(): void {
  if (positionManagerInterval) {
    clearInterval(positionManagerInterval);
    positionManagerInterval = null;
  }
  if (contextAnalystInterval) {
    clearInterval(contextAnalystInterval);
    contextAnalystInterval = null;
  }
  logger.info('[POSITION-MANAGER] 🛑 Intelligent monitoring stopped');
}
