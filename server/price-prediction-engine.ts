import { logger } from './logger';
import { formatInTimeZone } from 'date-fns-tz';

interface PricePrediction {
  symbol: string;
  currentPrice: number;
  predictions: Array<{
    date: string;
    daysOut: number;
    predictedPrice: number;
    confidence: number;
    range: { low: number; high: number };
    direction: 'bullish' | 'bearish' | 'neutral';
    methodology: string[];
  }>;
  leapsRecommendation?: {
    strikePrice: number;
    expiryDate: string;
    optionType: 'call' | 'put';
    estimatedPremium: number;
    breakeven: number;
    maxProfit: string;
    riskLevel: 'low' | 'medium' | 'high';
  };
  analysis: string;
  generatedAt: string;
}

interface TechnicalFactors {
  rsi: number;
  trend: 'up' | 'down' | 'sideways';
  support: number;
  resistance: number;
  volatility: number;
  momentum: number;
}

async function getTechnicalFactors(symbol: string): Promise<TechnicalFactors | null> {
  try {
    const yahooFinance = (await import('yahoo-finance2')).default;
    
    // Fetch quote and historical data using period1 as a date 3 months ago
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const [quote, chartResult] = await Promise.allSettled([
      yahooFinance.quote(symbol),
      yahooFinance.chart(symbol, { period1: threeMonthsAgo })
    ]);
    
    const quoteData = quote.status === 'fulfilled' ? quote.value : null;
    const chartData = chartResult.status === 'fulfilled' ? chartResult.value : null;
    const history = chartData?.quotes || [];
    
    logger.info(`[PRICE-PREDICTION] ${symbol} quote: ${quoteData ? 'OK' : 'FAIL'}, chart: ${chartData ? history.length + ' bars' : 'FAIL'}`);
    
    if (!quoteData || history.length < 20) {
      if (chartResult.status === 'rejected') {
        logger.warn(`[PRICE-PREDICTION] Chart error for ${symbol}: ${chartResult.reason}`);
      }
      return null;
    }
    
    const prices = history.map((h: any) => h.close).filter((p: number) => p > 0);
    const currentPrice = quoteData.regularMarketPrice || prices[prices.length - 1];
    
    const gains: number[] = [];
    const losses: number[] = [];
    for (let i = 1; i < Math.min(15, prices.length); i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains.push(change);
      else losses.push(Math.abs(change));
    }
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / 14 : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / 14 : 0.01;
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    const sma20 = prices.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
    const sma50 = prices.length >= 50 ? prices.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50 : sma20;
    
    let trend: 'up' | 'down' | 'sideways' = 'sideways';
    if (currentPrice > sma20 && sma20 > sma50) trend = 'up';
    else if (currentPrice < sma20 && sma20 < sma50) trend = 'down';
    
    const recentLows = prices.slice(-20).sort((a: number, b: number) => a - b);
    const recentHighs = prices.slice(-20).sort((a: number, b: number) => b - a);
    const support = recentLows[1] || recentLows[0];
    const resistance = recentHighs[1] || recentHighs[0];
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    const volatility = Math.sqrt(returns.map(r => r * r).reduce((a, b) => a + b, 0) / returns.length) * Math.sqrt(252) * 100;
    
    const momentum = ((currentPrice - prices[prices.length - 10]) / prices[prices.length - 10]) * 100;
    
    return { rsi, trend, support, resistance, volatility, momentum };
  } catch (error) {
    logger.warn(`[PRICE-PREDICTION] Failed to get technical factors for ${symbol}:`, error);
    return null;
  }
}

function calculatePredictedPrice(
  currentPrice: number,
  technicals: TechnicalFactors,
  daysOut: number
): { price: number; confidence: number; low: number; high: number; methodology: string[] } {
  const methodology: string[] = [];
  let baseReturn = 0;
  let confidence = 50;
  
  if (technicals.trend === 'up') {
    baseReturn += 0.02 * (daysOut / 30);
    methodology.push('Uptrend momentum');
    confidence += 10;
  } else if (technicals.trend === 'down') {
    baseReturn -= 0.015 * (daysOut / 30);
    methodology.push('Downtrend pressure');
    confidence += 5;
  }
  
  if (technicals.rsi < 30) {
    baseReturn += 0.03;
    methodology.push('Oversold bounce');
    confidence += 10;
  } else if (technicals.rsi > 70) {
    baseReturn -= 0.02;
    methodology.push('Overbought pullback');
    confidence += 5;
  }
  
  if (technicals.momentum > 5) {
    baseReturn += 0.01 * (daysOut / 30);
    methodology.push('Strong momentum');
    confidence += 5;
  }
  
  const meanReversion = (technicals.resistance + technicals.support) / 2;
  const distanceToMean = (currentPrice - meanReversion) / meanReversion;
  if (Math.abs(distanceToMean) > 0.05) {
    baseReturn -= distanceToMean * 0.3;
    methodology.push('Mean reversion');
  }
  
  const timeDecay = Math.max(0.5, 1 - (daysOut / 365) * 0.3);
  confidence *= timeDecay;
  
  const predictedPrice = currentPrice * (1 + baseReturn);
  
  const volatilityFactor = technicals.volatility / 100;
  const timeFactor = Math.sqrt(daysOut / 252);
  const rangePercent = volatilityFactor * timeFactor * 1.5;
  
  return {
    price: predictedPrice,
    confidence: Math.min(85, Math.max(30, confidence)),
    low: predictedPrice * (1 - rangePercent),
    high: predictedPrice * (1 + rangePercent),
    methodology
  };
}

export async function predictPrice(symbol: string, targetDates?: Date[]): Promise<PricePrediction | null> {
  logger.info(`[PRICE-PREDICTION] Generating predictions for ${symbol}...`);
  
  try {
    const yahooFinance = (await import('yahoo-finance2')).default;
    const quote = await yahooFinance.quote(symbol);
    
    if (!quote || !quote.regularMarketPrice) {
      logger.warn(`[PRICE-PREDICTION] No quote data for ${symbol}`);
      return null;
    }
    
    const currentPrice = quote.regularMarketPrice;
    const technicals = await getTechnicalFactors(symbol);
    
    if (!technicals) {
      logger.warn(`[PRICE-PREDICTION] Insufficient technical data for ${symbol}`);
      return null;
    }
    
    const now = new Date();
    const defaultDates = targetDates || [
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
      new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    ];
    
    const predictions = defaultDates.map(targetDate => {
      const daysOut = Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const prediction = calculatePredictedPrice(currentPrice, technicals, daysOut);
      
      let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
      const priceChange = (prediction.price - currentPrice) / currentPrice;
      if (priceChange > 0.05) direction = 'bullish';
      else if (priceChange < -0.05) direction = 'bearish';
      
      return {
        date: formatInTimeZone(targetDate, 'America/Chicago', 'yyyy-MM-dd'),
        daysOut,
        predictedPrice: Math.round(prediction.price * 100) / 100,
        confidence: Math.round(prediction.confidence),
        range: {
          low: Math.round(prediction.low * 100) / 100,
          high: Math.round(prediction.high * 100) / 100
        },
        direction,
        methodology: prediction.methodology
      };
    });
    
    const sixMonthPrediction = predictions.find(p => p.daysOut >= 150 && p.daysOut <= 200);
    let leapsRecommendation;
    
    if (sixMonthPrediction && sixMonthPrediction.direction !== 'neutral') {
      const isBullish = sixMonthPrediction.direction === 'bullish';
      const strikePrice = isBullish 
        ? Math.round(currentPrice * 1.1)
        : Math.round(currentPrice * 0.9);
      
      const expiryDate = formatInTimeZone(
        new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000),
        'America/Chicago',
        'yyyy-MM-dd'
      );
      
      const estimatedPremium = currentPrice * (technicals.volatility / 100) * 0.3;
      const breakeven = isBullish 
        ? strikePrice + estimatedPremium 
        : strikePrice - estimatedPremium;
      
      leapsRecommendation = {
        strikePrice,
        expiryDate,
        optionType: isBullish ? 'call' as const : 'put' as const,
        estimatedPremium: Math.round(estimatedPremium * 100) / 100,
        breakeven: Math.round(breakeven * 100) / 100,
        maxProfit: isBullish ? 'Unlimited' : `$${strikePrice}`,
        riskLevel: sixMonthPrediction.confidence > 60 ? 'medium' as const : 'high' as const
      };
    }
    
    const bullishPredictions = predictions.filter(p => p.direction === 'bullish').length;
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;
    
    let analysis = `**${symbol} Price Prediction Analysis**\n\n`;
    analysis += `Current: $${currentPrice.toFixed(2)} | RSI: ${technicals.rsi.toFixed(0)} | Trend: ${technicals.trend}\n`;
    analysis += `Support: $${technicals.support.toFixed(2)} | Resistance: $${technicals.resistance.toFixed(2)}\n\n`;
    
    if (bullishPredictions >= 3) {
      analysis += `📈 **BULLISH OUTLOOK**: Models favor upside with ${avgConfidence.toFixed(0)}% avg confidence.\n`;
    } else if (bullishPredictions <= 1) {
      analysis += `📉 **BEARISH OUTLOOK**: Models suggest downside risk. Consider puts or waiting.\n`;
    } else {
      analysis += `⚖️ **NEUTRAL OUTLOOK**: Mixed signals. Range-bound trading expected.\n`;
    }
    
    if (leapsRecommendation) {
      analysis += `\n**LEAPS Recommendation**: ${leapsRecommendation.optionType.toUpperCase()} $${leapsRecommendation.strikePrice} exp ${leapsRecommendation.expiryDate}`;
    }
    
    return {
      symbol,
      currentPrice,
      predictions,
      leapsRecommendation,
      analysis,
      generatedAt: new Date().toISOString()
    };
    
  } catch (error) {
    logger.error(`[PRICE-PREDICTION] Failed for ${symbol}:`, error);
    return null;
  }
}

export async function predictPriceWithAI(symbol: string): Promise<PricePrediction | null> {
  const basePrediction = await predictPrice(symbol);
  if (!basePrediction) return null;
  
  try {
    const providers = [
      { name: 'groq', envKey: 'GROQ_API_KEY' },
      { name: 'gemini', envKey: 'GEMINI_API_KEY' },
      { name: 'mistral', envKey: 'MISTRAL_API_KEY' }
    ];
    
    let aiEnhanced = false;
    
    for (const provider of providers) {
      const apiKey = process.env[provider.envKey];
      if (!apiKey) continue;
      
      try {
        if (provider.name === 'groq') {
          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [{
                role: 'user',
                content: `Analyze this price prediction for ${symbol} (current: $${basePrediction.currentPrice}):
                
Technical factors: RSI signals, trend analysis, support/resistance levels.

Provide a brief 2-3 sentence market outlook for the next 6 months. Focus on key catalysts, sector trends, and risk factors. Be specific and actionable.`
              }],
              max_tokens: 200,
              temperature: 0.3
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            const aiAnalysis = data.choices?.[0]?.message?.content || '';
            if (aiAnalysis) {
              basePrediction.analysis += `\n\n**AI Market Intelligence (${provider.name})**:\n${aiAnalysis}`;
              aiEnhanced = true;
              break;
            }
          }
        }
      } catch (e) {
        logger.debug(`[PRICE-PREDICTION] ${provider.name} enhancement failed`);
      }
    }
    
    if (!aiEnhanced) {
      basePrediction.analysis += '\n\n*AI enhancement unavailable - using quantitative analysis only*';
    }
    
    return basePrediction;
    
  } catch (error) {
    logger.warn('[PRICE-PREDICTION] AI enhancement failed, returning base prediction');
    return basePrediction;
  }
}
