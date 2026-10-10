import Anthropic from '@anthropic-ai/sdk';
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { logger } from './logger';
import { fetchFuturesQuote, fetchFuturesHistory } from './market-api';
import type { FuturesQuote } from './market-api';

interface FuturesHistoryPoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;
let gemini: GoogleGenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function getGemini(): GoogleGenAI {
  if (!gemini) {
    gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  }
  return gemini;
}

export interface FuturesResearchBrief {
  symbol: string;
  name: string;
  currentPrice: number;
  session: string;
  generatedAt: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  biasStrength: 'strong' | 'moderate' | 'weak';
  keyLevels: {
    resistance: number[];
    support: number[];
    pivot: number;
  };
  technicalSummary: string;
  sessionContext: string;
  catalysts: string[];
  riskFactors: string[];
  tradingIdea?: {
    direction: 'long' | 'short';
    entry: number;
    target: number;
    stop: number;
    rationale: string;
  };
}

const researchCache = new Map<string, { brief: FuturesResearchBrief; timestamp: number }>();
const RESEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

function getSessionName(session: string): string {
  const names: Record<string, string> = {
    'rth': 'Regular Trading Hours (9:30 AM - 4:00 PM ET)',
    'pre': 'Pre-Market (6:00 AM - 9:30 AM ET)',
    'post': 'Post-Market (4:00 PM - 5:00 PM ET)',
    'overnight': 'Overnight Session (5:00 PM - 6:00 AM ET)',
    'closed': 'Market Closed',
  };
  return names[session] || session;
}

function calculateKeyLevels(history: FuturesHistoryPoint[], currentPrice: number): { resistance: number[]; support: number[]; pivot: number } {
  if (!history.length) {
    return { resistance: [currentPrice * 1.01, currentPrice * 1.02], support: [currentPrice * 0.99, currentPrice * 0.98], pivot: currentPrice };
  }

  const highs = history.map(h => h.high).sort((a, b) => b - a);
  const lows = history.map(h => h.low).sort((a, b) => a - b);
  const recentHigh = Math.max(...history.slice(-10).map(h => h.high));
  const recentLow = Math.min(...history.slice(-10).map(h => h.low));
  const pivot = (recentHigh + recentLow + currentPrice) / 3;

  const resistance = [
    Math.round(recentHigh * 100) / 100,
    Math.round((highs[0] || recentHigh * 1.01) * 100) / 100,
  ].filter((v, i, a) => a.indexOf(v) === i);

  const support = [
    Math.round(recentLow * 100) / 100,
    Math.round((lows[0] || recentLow * 0.99) * 100) / 100,
  ].filter((v, i, a) => a.indexOf(v) === i);

  return { resistance, support, pivot: Math.round(pivot * 100) / 100 };
}

async function generateAIAnalysis(
  symbol: string,
  quote: FuturesQuote,
  history: FuturesHistoryPoint[],
  keyLevels: { resistance: number[]; support: number[]; pivot: number }
): Promise<{
  bias: 'bullish' | 'bearish' | 'neutral';
  biasStrength: 'strong' | 'moderate' | 'weak';
  technicalSummary: string;
  catalysts: string[];
  riskFactors: string[];
  tradingIdea?: FuturesResearchBrief['tradingIdea'];
}> {
  const prompt = `You are a professional futures trading analyst. Analyze this ${symbol} futures contract data and provide a research brief.

CURRENT MARKET DATA:
- Symbol: ${symbol} (${quote.name})
- Current Price: $${quote.price.toFixed(2)}
- Day Change: ${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)
- Day Range: $${quote.low.toFixed(2)} - $${quote.high.toFixed(2)}
- Previous Close: $${quote.previousClose.toFixed(2)}
- Volume: ${quote.volume.toLocaleString()}
- Session: ${getSessionName(quote.session)}

KEY LEVELS:
- Resistance: ${keyLevels.resistance.map(r => '$' + r.toFixed(2)).join(', ')}
- Support: ${keyLevels.support.map(s => '$' + s.toFixed(2)).join(', ')}
- Pivot: $${keyLevels.pivot.toFixed(2)}

RECENT PRICE ACTION (last ${history.length} candles):
${history.slice(-5).map(h => `  ${new Date(h.timestamp).toLocaleTimeString()}: O:$${h.open.toFixed(2)} H:$${h.high.toFixed(2)} L:$${h.low.toFixed(2)} C:$${h.close.toFixed(2)}`).join('\n')}

Provide your analysis in this JSON format:
{
  "bias": "bullish" | "bearish" | "neutral",
  "biasStrength": "strong" | "moderate" | "weak",
  "technicalSummary": "2-3 sentences summarizing price action, trend, and momentum",
  "catalysts": ["catalyst1", "catalyst2"] (max 3, current market drivers),
  "riskFactors": ["risk1", "risk2"] (max 3, key risks to watch),
  "tradingIdea": {
    "direction": "long" | "short",
    "entry": <price>,
    "target": <price>,
    "stop": <price>,
    "rationale": "1-2 sentences explaining the trade setup"
  }
}

Only include tradingIdea if there's a clear, actionable setup with at least 2:1 risk/reward.
Respond ONLY with valid JSON, no markdown or extra text.`;

  const providers = [
    { name: 'anthropic', fn: async () => {
      const response = await getAnthropic().messages.create({
        model: DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });
      const content = response.content[0];
      return content.type === 'text' ? content.text : '';
    }},
    { name: 'openai', fn: async () => {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1024,
      });
      return response.choices[0]?.message?.content || '';
    }},
    { name: 'gemini', fn: async () => {
      const response = await getGemini().models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text || '';
    }},
  ];

  for (const provider of providers) {
    try {
      const responseText = await provider.fn();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      
      const parsed = JSON.parse(jsonMatch[0]);
      logger.info(`[FUTURES-RESEARCH] ${symbol} analysis generated via ${provider.name}`);
      return {
        bias: parsed.bias || 'neutral',
        biasStrength: parsed.biasStrength || 'weak',
        technicalSummary: parsed.technicalSummary || 'No analysis available.',
        catalysts: parsed.catalysts || [],
        riskFactors: parsed.riskFactors || [],
        tradingIdea: parsed.tradingIdea,
      };
    } catch (error) {
      logger.warn(`[FUTURES-RESEARCH] ${provider.name} failed for ${symbol}:`, error);
    }
  }

  return {
    bias: quote.changePercent > 0.5 ? 'bullish' : quote.changePercent < -0.5 ? 'bearish' : 'neutral',
    biasStrength: 'weak',
    technicalSummary: `${symbol} is trading at $${quote.price.toFixed(2)}, ${quote.changePercent >= 0 ? 'up' : 'down'} ${Math.abs(quote.changePercent).toFixed(2)}% from previous close.`,
    catalysts: ['Price momentum', 'Volume activity'],
    riskFactors: ['Market volatility', 'Session liquidity'],
  };
}

export async function generateFuturesResearch(symbol: string): Promise<FuturesResearchBrief | null> {
  const upperSymbol = symbol.toUpperCase();
  
  const cached = researchCache.get(upperSymbol);
  if (cached && Date.now() - cached.timestamp < RESEARCH_CACHE_TTL) {
    logger.info(`[FUTURES-RESEARCH] Returning cached brief for ${upperSymbol}`);
    return cached.brief;
  }

  try {
    logger.info(`[FUTURES-RESEARCH] Generating research brief for ${upperSymbol}...`);
    
    const quote = await fetchFuturesQuote(upperSymbol);
    if (!quote) {
      logger.warn(`[FUTURES-RESEARCH] No quote available for ${upperSymbol}`);
      return null;
    }

    const history = await fetchFuturesHistory(upperSymbol, '15m', '1d');
    const keyLevels = calculateKeyLevels(history, quote.price);
    const aiAnalysis = await generateAIAnalysis(upperSymbol, quote, history, keyLevels);

    const brief: FuturesResearchBrief = {
      symbol: upperSymbol,
      name: quote.name,
      currentPrice: quote.price,
      session: quote.session,
      generatedAt: new Date().toISOString(),
      bias: aiAnalysis.bias,
      biasStrength: aiAnalysis.biasStrength,
      keyLevels,
      technicalSummary: aiAnalysis.technicalSummary,
      sessionContext: getSessionName(quote.session),
      catalysts: aiAnalysis.catalysts,
      riskFactors: aiAnalysis.riskFactors,
      tradingIdea: aiAnalysis.tradingIdea,
    };

    researchCache.set(upperSymbol, { brief, timestamp: Date.now() });
    logger.info(`[FUTURES-RESEARCH] Generated brief for ${upperSymbol}: ${aiAnalysis.bias} (${aiAnalysis.biasStrength})`);
    
    return brief;
  } catch (error) {
    logger.error(`[FUTURES-RESEARCH] Error generating brief for ${upperSymbol}:`, error);
    return null;
  }
}

export async function generateAllFuturesResearch(): Promise<FuturesResearchBrief[]> {
  const symbols = ['ES', 'NQ', 'YM', 'RTY', 'GC', 'CL'];
  const briefs: FuturesResearchBrief[] = [];
  
  for (const symbol of symbols) {
    const brief = await generateFuturesResearch(symbol);
    if (brief) briefs.push(brief);
  }
  
  return briefs;
}
