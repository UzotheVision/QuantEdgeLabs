// Blueprint integrations: javascript_openai, javascript_anthropic, javascript_gemini
import OpenAI from "openai";
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from "@google/genai";
import type { TradeIdea, InsertTradeIdea } from "@shared/schema";
import { logger } from './logger';
import { logAPIError, logAPISuccess } from './monitoring-service';
import { validateAndLog } from './trade-validation';
import { enrichOptionIdea } from './options-enricher';
import { multiLLM, generateAI } from './multi-llm-service';

// The newest Anthropic model is "claude-sonnet-4-20250514"
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

// Lazy-loaded AI clients (only created when needed)
let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;
let gemini: GoogleGenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropic;
}

function getGemini(): GoogleGenAI {
  if (!gemini) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    gemini = new GoogleGenAI({ apiKey });
  }
  return gemini;
}

function hasGeminiKey(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export interface AITradeIdea {
  symbol: string;
  assetType: 'stock' | 'option' | 'crypto';
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  catalyst: string;
  analysis: string;
  sessionContext: string;
  expiryDate?: string;
  isNewsCatalyst?: boolean; // Flag for major news events (relaxes R:R validation)
}

interface RiskValidationResult {
  isValid: boolean;
  reason?: string;
  metrics?: {
    maxLossPercent: number;
    riskRewardRatio: number;
    potentialGainPercent: number;
  };
}

// 🛡️ RISK VALIDATION: Enforce strict guardrails to prevent catastrophic losses
export function validateTradeRisk(idea: AITradeIdea, isNewsCatalyst: boolean = false): RiskValidationResult {
  const { entryPrice, targetPrice, stopLoss, direction, assetType } = idea;
  
  // Validate price relationships first
  // OPTIONS: Always "buy premium" model - target > entry > stop for ALL options (calls AND puts)
  // STOCKS/CRYPTO: Traditional model - LONG: target > entry > stop, SHORT: stop > entry > target
  if (assetType === 'option') {
    // For options, we always BUY the option (call or put), so premium increasing = profit
    // direction='long' means bullish (call), direction='short' means bearish (put)
    // In BOTH cases, we want premium to increase: target > entry > stop
    if (!(targetPrice > entryPrice && entryPrice > stopLoss)) {
      return {
        isValid: false,
        reason: `Invalid OPTION price relationship: target=${targetPrice}, entry=${entryPrice}, stop=${stopLoss}. Must be: target > entry > stop (premium increase model)`
      };
    }
  } else if (direction === 'long') {
    if (!(targetPrice > entryPrice && entryPrice > stopLoss)) {
      return {
        isValid: false,
        reason: `Invalid LONG price relationship: target=${targetPrice}, entry=${entryPrice}, stop=${stopLoss}. Must be: target > entry > stop`
      };
    }
  } else if (direction === 'short') {
    if (!(stopLoss > entryPrice && entryPrice > targetPrice)) {
      return {
        isValid: false,
        reason: `Invalid SHORT price relationship: stop=${stopLoss}, entry=${entryPrice}, target=${targetPrice}. Must be: stop > entry > target`
      };
    }
  }
  
  // Calculate risk metrics
  // OPTIONS: Always "buy premium" - risk is entry-stop, reward is target-entry
  // STOCKS/CRYPTO: Traditional direction-based calculation
  const maxLoss = (assetType === 'option' || direction === 'long')
    ? (entryPrice - stopLoss) 
    : (stopLoss - entryPrice);
  
  const potentialGain = (assetType === 'option' || direction === 'long')
    ? (targetPrice - entryPrice)
    : (entryPrice - targetPrice);
  
  const maxLossPercent = (maxLoss / entryPrice) * 100;
  const potentialGainPercent = (potentialGain / entryPrice) * 100;
  const riskRewardRatio = potentialGain / maxLoss;
  
  // 🚨 GUARDRAIL #1: Asset-specific maximum loss caps
  // TIGHTENED: Options max loss reduced from 35% to 25% to prevent expiration wipeouts
  // Stocks and crypto use 5-7% stops (user-specified max of 7%)
  const MAX_LOSS_PERCENT = assetType === 'option' ? 25.0 : 7.0;  // 25% for options (was 35%), 7% for stocks/crypto
  
  if (maxLossPercent > MAX_LOSS_PERCENT) {
    return {
      isValid: false,
      reason: `Max loss ${maxLossPercent.toFixed(2)}% exceeds ${MAX_LOSS_PERCENT}% cap for ${assetType} (stop too wide). Entry=$${entryPrice}, Stop=$${stopLoss}`,
      metrics: { maxLossPercent, riskRewardRatio, potentialGainPercent }
    };
  }
  
  // 🚨 GUARDRAIL #2: Minimum Risk/Reward ratio
  // Default 0.1:1 for auto-generated trades (relaxed for testing)
  // 0.1:1 for news catalysts and user-driven chart analysis (isNewsCatalyst=true)
  const MIN_RR_RATIO = 0.1;
  if (riskRewardRatio < MIN_RR_RATIO) {
    return {
      isValid: false,
      reason: `R:R ratio ${riskRewardRatio.toFixed(2)}:1 below minimum ${MIN_RR_RATIO}:1${isNewsCatalyst ? ' (Relaxed Mode)' : ''} (risk=${maxLossPercent.toFixed(2)}%, reward=${potentialGainPercent.toFixed(2)}%)`,
      metrics: { maxLossPercent, riskRewardRatio, potentialGainPercent }
    };
  }
  
  // 🚨 GUARDRAIL #3: Sanity checks for unrealistic prices
  if (entryPrice <= 0 || targetPrice <= 0 || stopLoss <= 0) {
    return {
      isValid: false,
      reason: `Invalid prices: entry=$${entryPrice}, target=$${targetPrice}, stop=$${stopLoss} (must be > 0)`
    };
  }
  
  // 🚨 GUARDRAIL #4: Prevent extreme volatility trades (>50% potential gain suggests unrealistic)
  if (assetType !== 'option' && potentialGainPercent > 50) {
    return {
      isValid: false,
      reason: `Potential gain ${potentialGainPercent.toFixed(2)}% exceeds 50% (unrealistic for ${assetType}). Entry=$${entryPrice}, Target=$${targetPrice}`,
      metrics: { maxLossPercent, riskRewardRatio, potentialGainPercent }
    };
  }
  
  // ✅ Trade passes all risk guardrails
  return {
    isValid: true,
    metrics: { maxLossPercent, riskRewardRatio, potentialGainPercent }
  };
}

// Parse trade ideas from conversational text with multi-provider fallback
export async function parseTradeIdeasFromText(text: string): Promise<AITradeIdea[]> {
  const systemPrompt = `You are a trade idea extraction specialist. Parse the given text and extract any trade ideas mentioned.

For each trade idea found, extract:
- symbol: Stock ticker or crypto symbol
- assetType: "stock", "option", or "crypto" 
- direction: "long" or "short" (or "buy"/"sell")
- entryPrice: Suggested entry price (extract from text or estimate based on context)
- targetPrice: Price target
- stopLoss: Stop loss price (if not mentioned, calculate 2-3% below entry for long, above for short)
- catalyst: Why this trade (from the text)
- analysis: The reasoning provided
- sessionContext: Brief market context
- expiryDate: (only for options, format: "YYYY-MM-DD")

Return valid JSON object with structure: {"ideas": [array of trade ideas]}
If no clear trade ideas are found, return empty array.`;

  const userPrompt = `Extract trade ideas from this text:\n\n${text}`;

  // Try OpenAI first (fastest with JSON mode)
  try {
    const openaiResponse = await getOpenAI().chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    });

    const content = openaiResponse.choices[0].message.content || '{"ideas":[]}';
    const parsed = JSON.parse(content);
    
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (parsed.ideas && Array.isArray(parsed.ideas)) {
      return parsed.ideas;
    }
    return [];
  } catch (openaiError) {
    logger.info("OpenAI parsing failed, trying Anthropic...", openaiError);
    
    // Fallback to Anthropic
    try {
      const anthropicResponse = await getAnthropic().messages.create({
        model: DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `${systemPrompt}\n\n${userPrompt}`
          }
        ],
      });

      const content = anthropicResponse.content[0].type === 'text' 
        ? anthropicResponse.content[0].text 
        : '{"ideas":[]}';
      
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
      
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed.ideas && Array.isArray(parsed.ideas)) {
        return parsed.ideas;
      }
      return [];
    } catch (anthropicError) {
      logger.info("Anthropic parsing failed, trying Gemini...", anthropicError);

      // Fallback to Gemini — skip if no key
      if (!hasGeminiKey()) {
        logger.error("All AI providers failed to parse trade ideas (Gemini skipped - no key)");
        return [];
      }
      try {
        const geminiResponse = await getGemini().models.generateContent({
          model: "gemini-2.5-flash",
          contents: `${systemPrompt}\n\n${userPrompt}`,
          config: {
            responseMimeType: "application/json"
          }
        });

        const content = geminiResponse.text || '{"ideas":[]}';
        const parsed = JSON.parse(content);

        if (Array.isArray(parsed)) {
          return parsed;
        } else if (parsed.ideas && Array.isArray(parsed.ideas)) {
          return parsed.ideas;
        }
        return [];
      } catch (geminiError) {
        logger.error("All AI providers failed to parse trade ideas:", geminiError);
        return [];
      }
    }
  }
}

// Helper to fetch current market prices for AI prompt context
async function fetchCurrentPricesForPrompt(): Promise<string> {
  const { fetchStockPrice, fetchCryptoPrice } = await import('./market-api');
  
  const pricePromises = [
    fetchStockPrice('SPY').then(d => d ? `SPY: $${d.currentPrice.toFixed(2)}` : null),
    fetchStockPrice('NVDA').then(d => d ? `NVDA: $${d.currentPrice.toFixed(2)}` : null),
    fetchStockPrice('AAPL').then(d => d ? `AAPL: $${d.currentPrice.toFixed(2)}` : null),
    fetchStockPrice('TSLA').then(d => d ? `TSLA: $${d.currentPrice.toFixed(2)}` : null),
    fetchCryptoPrice('BTC').then(d => d ? `BTC: $${d.currentPrice.toFixed(0)}` : null),
    fetchCryptoPrice('ETH').then(d => d ? `ETH: $${d.currentPrice.toFixed(0)}` : null),
    fetchCryptoPrice('SOL').then(d => d ? `SOL: $${d.currentPrice.toFixed(2)}` : null),
  ];
  
  const results = await Promise.all(pricePromises);
  const validPrices = results.filter(Boolean);
  
  if (validPrices.length === 0) {
    logger.warn('⚠️ Could not fetch any live prices for AI prompt');
    return 'Live prices unavailable - use your best estimate based on recent market knowledge';
  }
  
  return validPrices.join(', ');
}

// Generate trade ideas using FREE Gemini tier (25 requests/day)
export async function generateTradeIdeas(marketContext: string): Promise<AITradeIdea[]> {
  // Fetch LIVE prices to include in prompt (prevents outdated hardcoded prices)
  const livePrices = await fetchCurrentPricesForPrompt();
  logger.info(`📊 [AI-GEN] Fetched live prices for prompt: ${livePrices}`);
  
  const systemPrompt = `You are a quantitative trading analyst. Generate 3-4 high-quality trade ideas based on current market conditions.

CRYPTO UNIVERSE (pick 1-2 from different sectors):
- Large Cap: BTC, ETH, BNB, SOL, ADA
- DeFi: AAVE, UNI, LINK, MKR
- L1s: SOL, AVAX, NEAR, FTM
- Meme/Speculative: DOGE, SHIB, PEPE

ASSET MIX REQUIREMENTS:
- Generate 3-4 ideas total
- Include AT LEAST 1 crypto trade (40% crypto allocation target)
- Diversify across sectors (if crypto: mix large-cap + DeFi/L1/meme)
- Balance between stocks and crypto
- **DIRECTION BALANCE**: Do not only provide "long" ideas. If market conditions warrant (e.g., overbought RSI, bearish catalysts, or trend exhaustion), provide "short" ideas.
- **OPTIONS DIRECTION**: For option ideas, "short" direction means buying a PUT option. "long" direction means buying a CALL option. Always specify the correct direction.

CRYPTO TRADE SETUPS:
- Breakouts above key resistance (Long)
- Support bounces after pullbacks (Long)
- Oversold RSI rebounds (Long)
- Bearish rejections at resistance (Short)
- Overbought RSI reversals (Short)
- Correlation plays (BTC moves, alts follow)

For each trade idea, provide:
- symbol: Stock ticker or crypto symbol
- assetType: "stock", "option", or "crypto"
- direction: "long" or "short"
- entryPrice: MUST use current market prices provided below
- targetPrice: Price target (MUST follow direction rules)
- stopLoss: Stop loss price (MUST follow direction rules below)
- catalyst: Key catalyst driving this trade (1-2 sentences)
- analysis: Technical/fundamental analysis (2-3 sentences)
- sessionContext: Market session context
- expiryDate: (only for options, format: "YYYY-MM-DD")

**LIVE MARKET PRICES (use these as entry prices):**
${livePrices}

CRITICAL PRICE RULES:
- For LONG trades: targetPrice > entryPrice > stopLoss
- For SHORT trades: stopLoss > entryPrice > targetPrice
- Entry prices MUST match the live prices above (or be very close)
- Target: 1-3% from entry for day trades, 3-8% for swing trades
- Stop: 1-3.5% from entry

Return valid JSON object with structure: {"ideas": [array of trade ideas]}
Focus on actionable, research-grade opportunities with sector diversification.`;

  const userPrompt = `Generate trade ideas for: ${marketContext}`;

  // Parse response helper - handles JSON extraction from various provider formats
  const parseIdeas = (content: string, providerName: string = 'unknown'): AITradeIdea[] => {
    try {
      // Try direct JSON parse first
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        logger.info(`✅ Parsed ${parsed.length} ideas from ${providerName} (direct JSON)`);
        return parsed;
      } else if (parsed.ideas && Array.isArray(parsed.ideas)) {
        logger.info(`✅ Parsed ${parsed.ideas.length} ideas from ${providerName} (ideas array)`);
        return parsed.ideas;
      }
      logger.warn(`⚠️  ${providerName} returned valid JSON but no ideas array`);
      return [];
    } catch {
      // Anthropic/Claude often wraps JSON in code fences or prose - extract it
      logger.info(`🔧 ${providerName} response not direct JSON, attempting extraction...`);
      
      // Try to extract JSON from code fences (```json ... ``` or ``` ... ```)
      const codeFenceMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```/);
      if (codeFenceMatch) {
        try {
          const extracted = JSON.parse(codeFenceMatch[1]);
          if (Array.isArray(extracted)) {
            logger.info(`✅ Extracted ${extracted.length} ideas from ${providerName} code fence`);
            return extracted;
          } else if (extracted.ideas && Array.isArray(extracted.ideas)) {
            logger.info(`✅ Extracted ${extracted.ideas.length} ideas from ${providerName} code fence`);
            return extracted.ideas;
          }
        } catch (e) {
          logger.warn(`⚠️  ${providerName} code fence contained invalid JSON`);
        }
      }
      
      // Try to find first JSON object/array in the text
      const jsonObjectMatch = content.match(/\{[\s\S]*"ideas"[\s\S]*\[[\s\S]*?\]\s*\}/);
      const jsonArrayMatch = content.match(/\[[\s\S]*?\]/);
      
      if (jsonObjectMatch) {
        try {
          const extracted = JSON.parse(jsonObjectMatch[0]);
          if (extracted.ideas && Array.isArray(extracted.ideas)) {
            logger.info(`✅ Extracted ${extracted.ideas.length} ideas from ${providerName} text search`);
            return extracted.ideas;
          }
        } catch (e) {
          logger.warn(`⚠️  ${providerName} text search found invalid JSON object`);
        }
      }
      
      if (jsonArrayMatch) {
        try {
          const extracted = JSON.parse(jsonArrayMatch[0]);
          if (Array.isArray(extracted)) {
            logger.info(`✅ Extracted ${extracted.length} ideas from ${providerName} text search`);
            return extracted;
          }
        } catch (e) {
          logger.warn(`⚠️  ${providerName} text search found invalid JSON array`);
        }
      }
      
      logger.error(`❌ ${providerName} response could not be parsed as JSON`);
      return [];
    }
  };

  // Try Gemini first (FREE tier - 25 requests/day) — skip if no key configured
  let geminiError: any = null;
  if (hasGeminiKey()) {
    try {
      const startTime = Date.now();
      logger.info("🆓 Trying Gemini (FREE tier - 25 requests/day)...");

      const geminiResponse = await getGemini().models.generateContent({
        model: "gemini-2.5-flash",
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
        },
        contents: userPrompt,
      });

      logAPISuccess('Gemini (Free)', 'generateContent', Date.now() - startTime);

      const geminiText = geminiResponse.text || '';
      const geminiIdeas = parseIdeas(geminiText, 'Gemini');

      if (geminiIdeas.length === 0) {
        throw new Error('Gemini returned zero ideas');
      }

      logger.info(`✅ Generated ${geminiIdeas.length} ideas using Gemini`);
      return geminiIdeas.slice(0, 10);
    } catch (err: any) {
      geminiError = err;
      logger.warn(`Gemini failed (${err?.status || 'unknown'}), trying Anthropic...`);
    }
  } else {
    geminiError = new Error('No Gemini API key configured');
    logger.info("⏭️  Skipping Gemini (no API key), trying Anthropic...");
  }
  {
    
    // Try Anthropic as fallback
    try {
      const startTime = Date.now();
      logger.info("💎 Trying Anthropic Claude Sonnet 4...");
      
      const anthropicResponse = await getAnthropic().messages.create({
        model: DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: userPrompt
        }]
      });

      logAPISuccess('Anthropic', 'messages.create', Date.now() - startTime);

      const anthropicText = anthropicResponse.content[0].type === 'text' 
        ? anthropicResponse.content[0].text 
        : '{"ideas":[]}';
      const anthropicIdeas = parseIdeas(anthropicText, 'Anthropic');

      if (anthropicIdeas.length === 0) {
        throw new Error('Anthropic returned zero ideas');
      }

      logger.info(`✅ Generated ${anthropicIdeas.length} ideas using Anthropic`);
      return anthropicIdeas.slice(0, 10);
    } catch (anthropicError: any) {
      logger.warn(`Anthropic failed (${anthropicError?.status || 'unknown'}), trying OpenAI...`);
      
      // Try OpenAI as final fallback
      try {
        const startTime = Date.now();
        logger.info("🤖 Trying OpenAI GPT-5...");
        
        const openaiResponse = await getOpenAI().chat.completions.create({
          model: "gpt-5",
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: "json_object" }
        });

        logAPISuccess('OpenAI', 'chat.completions.create', Date.now() - startTime);

        const openaiText = openaiResponse.choices[0].message.content || '{"ideas":[]}';
        const openaiIdeas = parseIdeas(openaiText, 'OpenAI');

        if (openaiIdeas.length === 0) {
          throw new Error('OpenAI returned zero ideas');
        }

        logger.info(`✅ Generated ${openaiIdeas.length} ideas using OpenAI`);
        return openaiIdeas.slice(0, 10);
      } catch (openaiError: any) {
        logger.error("All AI providers failed:", {
          gemini: geminiError?.message,
          anthropic: anthropicError?.message,
          openai: openaiError?.message
        });
        
        throw new Error("All AI providers failed. Please try again later.");
      }
    }
  }
}

// Chat with QuantAI Bot (using multi-LLM service with automatic fallback)
export async function chatWithQuantAI(userMessage: string, conversationHistory: Array<{role: string, content: string}>): Promise<string> {
  const systemPrompt = `You are QuantAI Bot, an expert quantitative trading assistant for Quant Edge Labs platform.

Your role:
- Provide educational market analysis and trading insights
- Answer questions about stocks, options, crypto, and trading strategies
- Explain risk management and position sizing
- Discuss technical indicators, chart patterns, and market catalysts
- Always emphasize that this is educational content, not financial advice

Be concise, professional, and data-driven. Use plain language while maintaining technical accuracy.`;

  // Build conversation context
  const conversationText = conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  const fullPrompt = conversationText ? `${conversationText}\nuser: ${userMessage}` : userMessage;

  try {
    // Use multi-LLM service with automatic fallback (cheap/fast strategy)
    logger.info("🤖 Using Multi-LLM service for chat (all 4 LLMs with fallback)");
    const response = await generateAI(fullPrompt, {
      system: systemPrompt,
      mode: 'fallback',
      strategy: 'cheap', // Uses free models first: Gemini → Grok → OpenAI → Anthropic
    });

    return response || "I couldn't process that request";
  } catch (error: any) {
    logger.error("All LLM providers failed for chat:", error);

    if (error?.message?.includes('rate limit') || error?.message?.includes('429')) {
      throw new Error("AI rate limit reached. Please try again in a few minutes.");
    }

    if (error?.message?.includes('401') || error?.message?.includes('credentials')) {
      throw new Error("AI service unavailable: Invalid API credentials");
    }

    throw new Error("AI chat temporarily unavailable. The quant engines are still generating trade ideas automatically.");
  }
}

// Quick market analysis using Gemini (fast model)
export async function quickMarketAnalysis(symbols: string[]): Promise<string> {
  const prompt = `Provide a brief market analysis for these symbols: ${symbols.join(', ')}. 
  
Include:
- Current market sentiment
- Key catalysts to watch
- Risk factors
- 2-3 sentence summary

Keep it concise and actionable.`;

  try {
    const response = await getGemini().models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    return response.text || "Unable to generate analysis";
  } catch (error) {
    logger.error("Quick analysis failed:", error);
    return "Market analysis currently unavailable";
  }
}

// Generate AI-powered text analysis for a symbol (no chart image needed)
export async function generateAIAnalysis(prompt: string, preferredProvider: 'claude' | 'gemini' | 'gpt' = 'claude'): Promise<string | null> {
  const systemPrompt = `You are a professional trading analyst. Provide concise, actionable analysis.
Be direct and specific. Cover both OPTIONS (lottos, LEAPS) and SHARES (swing trades).
For options: suggest strike prices near the money with 0-5 DTE for lottos.
For shares: suggest entry, target, and stop loss levels.
Keep responses under 150 words. Never provide financial advice - educational research only.`;

  try {
    if (preferredProvider === 'claude') {
      const response = await getAnthropic().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });
      const textBlock = response.content.find((block: { type: string }) => block.type === 'text');
      if (textBlock && 'text' in textBlock) {
        return textBlock.text;
      }
      return null;
    } else if (preferredProvider === 'gemini') {
      const response = await getGemini().models.generateContent({
        model: "gemini-2.5-flash",
        contents: `${systemPrompt}\n\n${prompt}`,
      });
      return response.text || null;
    } else {
      // GPT fallback
      const response = await getOpenAI().chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 300,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
      });
      return response.choices[0]?.message?.content || null;
    }
  } catch (error: any) {
    logger.error(`[AI-ANALYSIS] ${preferredProvider} failed: ${error?.message}`);
    throw error;
  }
}

/**
 * 📰 Generate trade idea from breaking news article
 * Uses News Catalyst Mode (1.5:1 R:R minimum instead of 2:1)
 * 
 * @param newsArticle Breaking news article with sentiment and tickers
 * @returns AITradeIdea with isNewsCatalyst flag set
 */
export async function generateTradeIdeasFromNews(newsArticle: {
  title: string;
  summary: string;
  url: string;
  timePublished: string;
  primaryTicker: string;
  tradingDirection: 'long' | 'short';
  overallSentimentScore: number;
  overallSentimentLabel: string;
  breakingReason: string;
}): Promise<AITradeIdea | null> {
  const { title, summary, url, primaryTicker, tradingDirection, overallSentimentScore, overallSentimentLabel } = newsArticle;
  
  logger.info(`📰 [NEWS-AI] Generating trade idea for ${primaryTicker} from news: "${title}"`);
  
  // 🎲 10% probability to suggest options for news-driven trades with high volatility
  const shouldMakeOption = Math.random() < 0.10;
  const assetTypeInstruction = shouldMakeOption 
    ? `"option" (use options for high-impact news events - these will be enriched with real Tradier data)`
    : `"stock" (news-driven trades typically focus on stocks)`;
  
  const systemPrompt = `You are a news-driven quantitative trading analyst. Generate a trade idea based on breaking financial news.

For this trade idea, provide:
- symbol: The ticker symbol (use the provided primaryTicker)
- assetType: ${assetTypeInstruction}
- direction: "${tradingDirection}" (determined by news sentiment)
- entryPrice: Current realistic market price for ${primaryTicker} (estimate based on typical price range)
- targetPrice: Price target based on news impact (MUST follow direction rules below)
- stopLoss: Stop loss price (MUST follow direction rules below)
- catalyst: The news headline/summary (1-2 sentences)
- analysis: Trading rationale based on news event (2-3 sentences explaining why this news justifies the trade)
- sessionContext: Market conditions and timing${shouldMakeOption ? '\n- expiryDate: Expiry date for the option in YYYY-MM-DD format (typically 1-7 days for news-driven options)' : ''}

CRITICAL PRICE RULES:
- For LONG trades: targetPrice > entryPrice > stopLoss (e.g., Entry $100, Target $105, Stop $97)
- For SHORT trades: stopLoss > entryPrice > targetPrice (e.g., Entry $100, Target $95, Stop $103)
- News Catalyst Mode: Minimum 1.5:1 Risk/Reward ratio (relaxed from standard 2:1)
- Maximum 5% stop loss from entry price
- Target based on typical news-driven moves (5-15% for major events, 2-8% for moderate news)

NEWS CONTEXT:
Title: ${title}
Summary: ${summary}
Sentiment: ${overallSentimentLabel} (${overallSentimentScore.toFixed(2)})
Direction: ${tradingDirection.toUpperCase()}

Return valid JSON object with structure: {"idea": {trade idea object}}`;

  const userPrompt = `Generate a ${tradingDirection} trade idea for ${primaryTicker} based on this breaking news. Ensure the trade has realistic prices and follows News Catalyst Mode validation (1.5:1 R:R minimum).`;

  try {
    const startTime = Date.now();
    logger.info(`📰 [NEWS-AI] Using Gemini to analyze news for ${primaryTicker}`);
    
    const geminiResponse = await getGemini().models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
      contents: userPrompt,
    });

    logAPISuccess('Gemini News AI', 'generateContent', Date.now() - startTime);

    const geminiText = geminiResponse.text || '{}';
    const parsed = JSON.parse(geminiText);
    
    // Extract trade idea from response
    const idea: AITradeIdea = parsed.idea || parsed;
    
    if (!idea.symbol || !idea.entryPrice || !idea.targetPrice || !idea.stopLoss) {
      logger.warn(`📰 [NEWS-AI] Invalid trade idea generated for ${primaryTicker} - missing required fields`);
      return null;
    }
    
    // Mark as news catalyst
    idea.isNewsCatalyst = true;
    
    // Validate the trade with News Catalyst Mode (1.5:1 R:R)
    const validation = validateTradeRisk(idea, true); // true = isNewsCatalyst
    
    if (!validation.isValid) {
      logger.warn(`📰 [NEWS-AI] Generated trade failed validation: ${validation.reason}`);
      return null;
    }
    
    logger.info(`📰 [NEWS-AI] ✅ Valid news-driven trade: ${idea.symbol} ${idea.direction.toUpperCase()} - Entry: $${idea.entryPrice}, Target: $${idea.targetPrice}, Stop: $${idea.stopLoss}`);
    logger.info(`   → R:R: ${validation.metrics?.riskRewardRatio.toFixed(2)}:1, Risk: ${validation.metrics?.maxLossPercent.toFixed(2)}%, Reward: ${validation.metrics?.potentialGainPercent.toFixed(2)}%`);
    
    // 📊 OPTIONS ENRICHMENT: If option trade, fetch real Tradier premium data and check Lotto status
    if (idea.assetType === 'option') {
      logger.info(`📊 [NEWS-OPTIONS] Enriching ${idea.symbol} option with Tradier data...`);
      
      const enrichedOption = await enrichOptionIdea(idea);
      
      if (enrichedOption) {
        // Replace AI-estimated prices with real option premium prices
        idea.entryPrice = enrichedOption.entryPrice;
        idea.targetPrice = enrichedOption.targetPrice;
        idea.stopLoss = enrichedOption.stopLoss;
        
        // Add option-specific fields and Lotto detection
        (idea as any).strikePrice = enrichedOption.strikePrice;
        (idea as any).optionType = enrichedOption.optionType;
        (idea as any).riskRewardRatio = enrichedOption.riskRewardRatio;
        (idea as any).isLottoPlay = enrichedOption.isLottoPlay;
        
        // Update expiry date with actual option expiry
        idea.expiryDate = enrichedOption.expiryDate;
        
        // Enhance analysis with option details
        idea.analysis = enrichedOption.analysis;
        
        logger.info(`✅ [NEWS-OPTIONS] Enriched ${idea.symbol} option${enrichedOption.isLottoPlay ? ' (LOTTO PLAY)' : ''} - Premium: $${enrichedOption.entryPrice.toFixed(2)}, Strike: $${enrichedOption.strikePrice}, Type: ${enrichedOption.optionType}`);
      } else {
        logger.warn(`🚫 [NEWS-OPTIONS] Failed to enrich ${idea.symbol} option - returning stock trade instead`);
        // Fallback to stock if option enrichment fails
        idea.assetType = 'stock';
      }
    }
    
    return idea;
  } catch (error: any) {
    logger.error(`📰 [NEWS-AI] Failed to generate trade from news:`, error);
    
    if (error?.status === 429) {
      logger.warn("📰 [NEWS-AI] Gemini API limit reached");
    }
    
    return null;
  }
}

// Test a specific AI provider (admin tool)
export async function testAIProvider(provider: string, prompt: string): Promise<AITradeIdea[]> {
  const systemPrompt = `You are a quantitative trading analyst. Generate 1-2 high-quality trade ideas based on the user's request.

For each trade idea, provide:
- symbol: Stock ticker or crypto symbol
- assetType: "stock", "option", or "crypto"
- direction: "long" or "short"
- entryPrice: Suggested entry price
- targetPrice: Price target
- stopLoss: Stop loss price
- catalyst: Why this trade
- analysis: Brief reasoning
- sessionContext: Current market conditions
- expiryDate: (only for options, format: "YYYY-MM-DD")

Return valid JSON object with structure: {"ideas": [array of trade ideas]}`;

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await getOpenAI().chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1024,
    });

    const content = response.choices[0].message.content || '{"ideas":[]}';
    const parsed = JSON.parse(content);
    return parsed.ideas || [];

  } else if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key not configured');
    }

    const response = await getAnthropic().messages.create({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${systemPrompt}\n\n${prompt}`
        }
      ],
    });

    const content = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '{"ideas":[]}';
    
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
    const parsed = JSON.parse(jsonStr);
    return parsed.ideas || [];

  } else if (provider === 'gemini') {
    if (!hasGeminiKey()) {
      throw new Error('Gemini API key not configured');
    }

    const response = await getGemini().models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${systemPrompt}\n\n${prompt}\n\nPlease respond with valid JSON only.`,
    });

    const content = response.text || '{"ideas":[]}';
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
    const parsed = JSON.parse(jsonStr);
    return parsed.ideas || [];

  } else {
    throw new Error(`Invalid provider: ${provider}`);
  }
}

// 🎯 AI + Quant HYBRID: Combine proven quant signals with FREE AI market intelligence
export async function generateHybridIdeas(marketContext: string = "Current market conditions"): Promise<AITradeIdea[]> {
  logger.info("🔬 Starting AI + Quant HYBRID generation");
  
  try {
    // Import quant generator and storage
    const { generateQuantIdeas } = await import('./quant-ideas-generator');
    const { storage } = await import('./storage');
    
    // Step 1: Generate quant ideas using v3.0.0 proven signals (RSI2+200MA, VWAP, Volume)
    const marketData = await storage.getAllMarketData();
    const catalysts = await storage.getAllCatalysts();
    const quantIdeas = await generateQuantIdeas(marketData, catalysts, 4, storage);
    
    if (quantIdeas.length === 0) {
      logger.info("No quant signals found, falling back to pure AI");
      return await generateTradeIdeas(marketContext);
    }
    
    logger.info(`✅ Generated ${quantIdeas.length} quant ideas, enhancing with AI...`);
    
    // Step 2: Use FREE Gemini to enhance each quant idea with market intelligence
    const enhancedIdeas: AITradeIdea[] = [];
    
    for (const quantIdea of quantIdeas.slice(0, 3)) { // Enhance top 3 to stay within free tier
      try {
        const aiPrompt = `You are a market analyst. A quantitative signal detected this opportunity:

Symbol: ${quantIdea.symbol}
Type: ${quantIdea.assetType}
Direction: ${quantIdea.direction}
Entry: $${quantIdea.entryPrice}
Target: $${quantIdea.targetPrice}
Stop Loss: $${quantIdea.stopLoss}
Quant Signal: ${quantIdea.source || 'v3.0 proven signal'}

Provide:
1. Fundamental context (earnings, news, sector strength)
2. Institutional sentiment
3. Risk factors specific to this symbol
4. Enhanced catalyst analysis (2-3 sentences)

Keep response concise (3-4 sentences total).`;

        const geminiResponse = await getGemini().models.generateContent({
          model: "gemini-2.5-flash",
          contents: aiPrompt,
        });
        
        const aiContext = geminiResponse.text || quantIdea.analysis;
        
        // Combine quant data with AI intelligence
        // Preserve option fields and isLottoPlay from enriched quant ideas
        // IMPORTANT: For OPTIONS, we always BUY (direction='long')
        // The bullish/bearish sentiment is expressed via optionType (call=bullish, put=bearish)
        const isOption = quantIdea.assetType === 'option';
        const enhancedIdea: any = {
          symbol: quantIdea.symbol,
          assetType: quantIdea.assetType as 'stock' | 'option' | 'crypto',
          direction: isOption ? 'long' : (quantIdea.direction as 'long' | 'short'), // Options are ALWAYS long (we buy them)
          entryPrice: quantIdea.entryPrice,
          targetPrice: quantIdea.targetPrice,
          stopLoss: quantIdea.stopLoss,
          catalyst: quantIdea.catalyst || `${quantIdea.source || 'v3.0'} signal detected`,
          analysis: `🔬 HYBRID: ${aiContext}`,
          sessionContext: quantIdea.sessionContext || marketContext,
          expiryDate: quantIdea.expiryDate || undefined,
        };
        
        // Preserve option-specific fields from quant enrichment
        if (isOption) {
          enhancedIdea.strikePrice = quantIdea.strikePrice;
          enhancedIdea.optionType = quantIdea.optionType;
          enhancedIdea.isLottoPlay = quantIdea.isLottoPlay || false;
        }
        
        enhancedIdeas.push(enhancedIdea);
        
      } catch (aiError) {
        logger.warn(`AI enhancement failed for ${quantIdea.symbol}, using quant-only data`);
        // Fallback to quant-only idea
        // IMPORTANT: For OPTIONS, we always BUY (direction='long')
        const isOptionFallback = quantIdea.assetType === 'option';
        const fallbackIdea: any = {
          symbol: quantIdea.symbol,
          assetType: quantIdea.assetType as 'stock' | 'option' | 'crypto',
          direction: isOptionFallback ? 'long' : (quantIdea.direction as 'long' | 'short'), // Options are ALWAYS long
          entryPrice: quantIdea.entryPrice,
          targetPrice: quantIdea.targetPrice,
          stopLoss: quantIdea.stopLoss,
          catalyst: quantIdea.catalyst || `${quantIdea.source || 'v3.0'} signal`,
          analysis: quantIdea.analysis || `Quantitative signal: ${quantIdea.source || 'v3.0'}`,
          sessionContext: quantIdea.sessionContext || marketContext,
          expiryDate: quantIdea.expiryDate || undefined,
        };
        
        // Preserve option-specific fields from quant enrichment
        if (isOptionFallback) {
          fallbackIdea.strikePrice = quantIdea.strikePrice;
          fallbackIdea.optionType = quantIdea.optionType;
          fallbackIdea.isLottoPlay = quantIdea.isLottoPlay || false;
        }
        
        enhancedIdeas.push(fallbackIdea);
      }
    }
    
    logger.info(`🎯 HYBRID complete: ${enhancedIdeas.length} ideas (quant signals + AI intelligence)`);
    return enhancedIdeas;
    
  } catch (error: any) {
    logger.error("Hybrid generation failed:", error);
    throw new Error("Failed to generate hybrid AI + Quant ideas");
  }
}

export interface ChartAnalysisResult {
  patterns: string[];
  supportLevels: number[];
  resistanceLevels: number[];
  entryPoint: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio: number;
  sentiment: "bullish" | "bearish" | "neutral";
  analysis: string;
  confidence: number;
  timeframe: string;
}

// Validation helper for chart analysis results - ensures stops, targets, and R:R are reasonable
function validateChartAnalysisResult(parsed: ChartAnalysisResult): ChartAnalysisResult {
  // Calculate distances as percentages
  const stopDistance = Math.abs(parsed.entryPoint - parsed.stopLoss) / parsed.entryPoint * 100;
  const targetDistance = Math.abs(parsed.targetPrice - parsed.entryPoint) / parsed.entryPoint * 100;
  
  // Recalculate R:R to ensure accuracy
  const actualRR = targetDistance / stopDistance;
  if (Math.abs(actualRR - parsed.riskRewardRatio) > 0.3) {
    parsed.riskRewardRatio = Math.round(actualRR * 10) / 10;
  }
  
  let validationWarnings: string[] = [];
  
  // VALIDATION 1: Stop loss too tight (less than 0.5% is almost certainly noise)
  if (stopDistance < 0.5) {
    validationWarnings.push(
      `⚠️ STOP LOSS WARNING: Stop distance of ${stopDistance.toFixed(2)}% is extremely tight and will likely trigger on normal price volatility. For intraday trades, use at least 0.8-1.5% stops. For swing trades, use 1.5-3% stops.`
    );
  } else if (stopDistance < 1.0) {
    validationWarnings.push(
      `⚠️ TIGHT STOP NOTICE: Stop distance of ${stopDistance.toFixed(2)}% is on the tighter side. This may work for scalping but consider a wider stop (1-2%) for day trades to avoid being stopped out on noise.`
    );
  }
  
  // VALIDATION 2: R:R ratio below minimum
  if (parsed.riskRewardRatio < 1.5) {
    validationWarnings.push(
      `⚠️ R:R WARNING: Risk/Reward ratio of ${parsed.riskRewardRatio.toFixed(1)}:1 is below the recommended 2:1 minimum. Consider a tighter stop or more conservative target for better risk management.`
    );
  }
  
  // VALIDATION 3: Timeframe-based target validation
  const tf = parsed.timeframe?.toLowerCase() || '';
  let expectedMinTarget = 0;
  let expectedMaxTarget = 100;
  let timeframeLabel = '';
  
  if (tf.includes('1m') || tf.includes('5m') || tf === 'scalp' || tf === 'scalping') {
    expectedMinTarget = 0.1;
    expectedMaxTarget = 0.5;
    timeframeLabel = '1m-5m (scalping)';
  } else if (tf.includes('15m') || tf.includes('30m')) {
    expectedMinTarget = 0.3;
    expectedMaxTarget = 1.0;
    timeframeLabel = '15m-30m (intraday)';
  } else if (tf.includes('1h') || tf.includes('60m') || tf.includes('hourly')) {
    expectedMinTarget = 0.5;
    expectedMaxTarget = 2.0;
    timeframeLabel = '1H (day trade)';
  } else if (tf.includes('4h')) {
    expectedMinTarget = 1.0;
    expectedMaxTarget = 4.0;
    timeframeLabel = '4H (swing)';
  } else if (tf.includes('daily') || tf.includes('1d') || tf === 'd') {
    expectedMinTarget = 2.0;
    expectedMaxTarget = 8.0;
    timeframeLabel = 'Daily (position)';
  } else if (tf.includes('weekly') || tf.includes('1w') || tf === 'w') {
    expectedMinTarget = 5.0;
    expectedMaxTarget = 20.0;
    timeframeLabel = 'Weekly (longer-term)';
  }
  
  if (timeframeLabel && targetDistance > expectedMaxTarget * 1.5) {
    validationWarnings.push(
      `⚠️ TARGET WARNING: Target of ${targetDistance.toFixed(1)}% may be too aggressive for ${timeframeLabel} timeframe. Expected range: ${expectedMinTarget}-${expectedMaxTarget}%. Consider a more conservative target near visible resistance.`
    );
  }
  
  // VALIDATION 4: Confidence vs pattern count sanity check
  if (parsed.confidence >= 80 && parsed.patterns.length < 2) {
    validationWarnings.push(
      `⚠️ CONFIDENCE NOTICE: High confidence (${parsed.confidence}%) with only ${parsed.patterns.length} pattern(s) detected. Typically 80%+ confidence requires 3+ confirming signals.`
    );
  }
  
  // VALIDATION 5: Price relationship sanity (long vs short direction)
  const isLongSetup = parsed.targetPrice > parsed.entryPoint;
  const stopBelowEntry = parsed.stopLoss < parsed.entryPoint;
  
  if (isLongSetup && !stopBelowEntry) {
    validationWarnings.push(
      `⚠️ SETUP ERROR: Long setup detected (target > entry) but stop loss ($${parsed.stopLoss.toFixed(2)}) is above entry ($${parsed.entryPoint.toFixed(2)}). Stop should be below entry for long trades.`
    );
  } else if (!isLongSetup && stopBelowEntry) {
    validationWarnings.push(
      `⚠️ SETUP ERROR: Short setup detected (target < entry) but stop loss ($${parsed.stopLoss.toFixed(2)}) is below entry ($${parsed.entryPoint.toFixed(2)}). Stop should be above entry for short trades.`
    );
  }
  
  // VALIDATION 6: Ensure sentiment matches trade structure (CRITICAL FIX)
  // This prevents the inconsistency where target < entry but sentiment is neutral/bullish
  // Use tight threshold (0.1%) to catch all meaningful price differences, including scalping setups
  const targetDelta = (parsed.targetPrice - parsed.entryPoint) / parsed.entryPoint * 100;
  const derivedSentiment: 'bullish' | 'bearish' | 'neutral' = 
    targetDelta > 0.1 ? 'bullish' : 
    targetDelta < -0.1 ? 'bearish' : 
    'neutral';
  
  if (parsed.sentiment !== derivedSentiment) {
    // Only override if there's a significant mismatch
    if ((derivedSentiment === 'bullish' && parsed.sentiment === 'bearish') ||
        (derivedSentiment === 'bearish' && parsed.sentiment === 'bullish') ||
        (derivedSentiment !== 'neutral' && parsed.sentiment === 'neutral')) {
      logger.info(`📊 [SENTIMENT-FIX] Correcting sentiment from "${parsed.sentiment}" to "${derivedSentiment}" based on trade structure (target ${targetDelta > 0 ? '>' : '<'} entry)`);
      validationWarnings.push(
        `📊 SENTIMENT CORRECTED: AI reported "${parsed.sentiment}" but trade structure shows ${derivedSentiment.toUpperCase()} setup (target ${targetDelta > 0 ? 'above' : 'below'} entry by ${Math.abs(targetDelta).toFixed(1)}%). Using ${derivedSentiment.toUpperCase()} for consistency.`
      );
      parsed.sentiment = derivedSentiment;
    }
  }
  
  // Append all warnings to analysis
  if (validationWarnings.length > 0) {
    parsed.analysis += '\n\n---\n**VALIDATION ALERTS:**\n' + validationWarnings.join('\n\n');
  }
  
  logger.info(`📊 Chart analysis validation: stopDist=${stopDistance.toFixed(2)}%, targetDist=${targetDistance.toFixed(2)}%, R:R=${parsed.riskRewardRatio.toFixed(1)}, warnings=${validationWarnings.length}`);
  
  return parsed;
}

export async function analyzeChartImage(
  imageBuffer: Buffer,
  symbol?: string,
  timeframe?: string,
  additionalContext?: string,
  currentPrice?: number | null,
  optionDetails?: {
    assetType?: 'stock' | 'option';
    optionType?: 'call' | 'put';
    strikePrice?: string;
    expiryDate?: string;
  }
): Promise<ChartAnalysisResult> {
  logger.info(`📊 Analyzing chart image${symbol ? ` for ${symbol}` : ''}${currentPrice ? ` (current price: $${currentPrice})` : ''}${optionDetails?.assetType === 'option' ? ` (evaluating ${optionDetails.optionType?.toUpperCase()} $${optionDetails.strikePrice} exp ${optionDetails.expiryDate})` : ''}`);
  
  const base64Image = imageBuffer.toString('base64');
  const contextInfo = additionalContext ? `\n\nAdditional context: ${additionalContext}` : '';
  const priceContext = currentPrice ? `\n\n**CRITICAL - CURRENT MARKET PRICE**: The current live price of ${symbol || 'this asset'} is $${currentPrice.toFixed(2)}. Your entry, target, and stop levels MUST be within a reasonable range of this price (typically within 20%). If the chart shows very different price levels, the chart may be zoomed out or showing historical data - in that case, base your trade levels on the CURRENT price of $${currentPrice.toFixed(2)}, not old prices visible in the chart.` : '';
  
  // Build option evaluation context if user provided specific option details
  let optionContext = '';
  if (optionDetails?.assetType === 'option' && optionDetails.optionType && optionDetails.strikePrice) {
    const optionTypeLabel = optionDetails.optionType.toUpperCase();
    const strike = optionDetails.strikePrice;
    const expiry = optionDetails.expiryDate || 'not specified';
    optionContext = `\n\n**OPTION PLAY EVALUATION**: The user is considering a specific ${optionTypeLabel} option:
- Strike Price: $${strike}
- Expiry Date: ${expiry}
- Current Price: $${currentPrice?.toFixed(2) || 'unknown'}

Please evaluate this specific option play in your analysis:
1. Is the strike price ($${strike}) appropriate given the chart pattern and expected move?
2. Is the ${optionTypeLabel} direction aligned with the chart's sentiment?
3. Does the expiry date (${expiry}) provide enough time for the setup to play out?
4. Provide a clear RECOMMENDATION: "TAKE THE TRADE" or "AVOID THIS TRADE" with reasoning.`;
  }
  
  const systemPrompt = `You are an expert technical analyst specializing in chart pattern recognition and trade setup identification. Your goal is to provide INSTITUTIONAL-GRADE analysis with 99% accuracy.

**CRITICAL FIRST STEP**: Before analyzing patterns, you MUST:
1. Look at the Y-axis (price axis) on the chart to understand the ACTUAL price scale
2. Identify where the CURRENT/LATEST price bar is on the chart
3. Read the actual dollar values from the chart's price axis

Analyze the provided trading chart image and provide a comprehensive technical analysis including:

1. **Price Scale Reading**: First, identify the price range visible on the Y-axis (e.g., "$8.50 to $12.00")
2. **Chart Patterns**: Identify any visible patterns (head and shoulders, triangles, flags, double tops/bottoms, wedges, channels, etc.)
3. **Support & Resistance**: Identify key support and resistance levels BY READING THE ACTUAL PRICE AXIS
4. **Trade Setup**: Provide precise entry point, target price, and stop loss levels - these MUST match the price scale visible on the chart
5. **Sentiment**: Overall market sentiment (bullish, bearish, or neutral)
6. **Risk/Reward**: Calculate the risk-reward ratio
7. **Confidence**: Your confidence level in this analysis (0-100)
8. **Analysis**: Detailed explanation of your findings and reasoning${priceContext}

---
**PATTERN DETECTION REQUIREMENTS (MANDATORY)**:
Each pattern you identify MUST have 3+ confirmation points. Do NOT identify patterns without validation:

- **Trend Patterns**: Require 3+ touches of trendline, not just 2 points
- **Head & Shoulders**: Must have clear left shoulder, head, right shoulder with neckline visible
- **Double Top/Bottom**: Peaks/troughs must be within 3% of each other with clear middle pullback
- **Triangles**: Need at least 4 touch points (2 on each boundary line)
- **Flags/Pennants**: Must follow a strong pole move (5%+ in stocks, 3%+ in crypto)

**CANDLESTICK PATTERN DETECTION**:
Look for these at key support/resistance levels:
- **Doji**: Open and close within 0.1% of each other, indicates indecision
- **Hammer/Inverted Hammer**: Small body at top/bottom, long wick 2x+ body size
- **Engulfing**: Current candle body completely engulfs previous candle body
- **Shooting Star**: Small body at bottom with long upper wick (bearish at resistance)
- **Morning/Evening Star**: 3-candle reversal pattern at key levels

**VOLUME CONFIRMATION** (if volume bars visible):
- Breakouts should have volume 50%+ above average
- Pullbacks should show declining volume
- Volume spikes at support/resistance increase pattern reliability

---
**STOP LOSS VALIDATION (CRITICAL)**:
Your stop loss MUST be at least 1.0 ATR (Average True Range) away from entry. Stops tighter than 1 ATR will trigger on normal price noise.
- For DAY TRADES: Stop should be 0.8-1.5% from entry minimum
- For SWING TRADES: Stop should be 1.5-3% from entry (1.5-2x ATR)
- **WARNING**: If your calculated stop is less than 0.5% from entry, this is ALMOST CERTAINLY too tight and will get stopped out on noise. You MUST warn about this in your analysis.

---
**MULTI-TIMEFRAME TARGET VALIDATION**:
ALWAYS validate that your targets match the timeframe being analyzed:
- 1m-5m charts: Target 0.1-0.3% moves (scalping)
- 15m-30m charts: Target 0.3-0.8% moves (intraday)
- 1H charts: Target 0.5-1.5% moves (day trade)
- 4H charts: Target 1-3% moves (swing trade)
- Daily charts: Target 2-5% moves (position trade)
- Weekly/Monthly: Target 5-15% moves (longer-term)

If you identify a 15m chart but set a 5% target, that is INCORRECT. ALWAYS validate timeframe matches expected move size.

---
**CONFIDENCE CALIBRATION (STRICT SCORING)**:
- **80-100%**: Requires 3+ confirming patterns, price at key level, volume confirmation visible, clear trend direction
- **60-79%**: Requires 2 patterns aligning with price action, at least 1 confirmation signal
- **40-59%**: Conflicting signals present - use NEUTRAL sentiment, warn about mixed signals
- **Below 40%**: Chart is unclear or no valid setup - recommend NO TRADE

---
**REQUIRED ANALYSIS STRUCTURE**:
Your "analysis" field MUST include ALL of the following:
1. **Primary Pattern**: Named pattern with specific price points where it forms (e.g., "Double bottom at $45.20 and $45.35")
2. **Volume Analysis**: If volume visible, describe what it shows. If not visible, state "Volume data not visible on chart"
3. **Key Levels**: Exact support ($X.XX) and resistance ($X.XX) levels with justification
4. **Candlestick Patterns**: Any significant candlestick patterns at key levels
5. **Risk Assessment**: Clear statement of what could invalidate this setup and warning if R:R is poor

---
Return your analysis in this EXACT JSON format:
{
  "patterns": ["pattern1", "pattern2"],
  "supportLevels": [price1, price2],
  "resistanceLevels": [price1, price2],
  "entryPoint": number,
  "targetPrice": number,
  "stopLoss": number,
  "riskRewardRatio": number,
  "sentiment": "bullish" | "bearish" | "neutral",
  "analysis": "detailed analysis text following the required structure above",
  "confidence": number (0-100),
  "timeframe": "detected timeframe or ${timeframe || 'unknown'}"
}

**IMPORTANT**: All price levels (entry, target, stop, support, resistance) must be realistic values that you can actually SEE on the chart's Y-axis. Do not guess or hallucinate prices.

Base your target on the NEAREST visible resistance level, not aspirational prices. Conservative targets with good R:R (2:1 minimum preferred) are better than aggressive targets that rarely hit.

**ANALYSIS LENGTH**: Provide a COMPLETE and THOROUGH analysis in the "analysis" field. Write at least 3-4 full paragraphs explaining all visible patterns, price action, volume (if visible), and your reasoning for the trade setup. Do NOT cut off mid-sentence.${optionContext}${contextInfo}`;

  const userPrompt = symbol 
    ? `Analyze this trading chart for ${symbol}${timeframe ? ` on ${timeframe} timeframe` : ''}. Provide precise technical analysis with entry/exit points.`
    : `Analyze this trading chart and provide precise technical analysis with entry/exit points.`;

  // Try Gemini first (supports vision and has free tier)
  try {
    logger.info("📊 Using Gemini for chart analysis");
    
    const geminiResponse = await getGemini().models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 8192, // Increased to prevent truncation
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: userPrompt },
            { 
              inlineData: {
                mimeType: "image/png",
                data: base64Image
              }
            }
          ]
        }
      ]
    });

    const content = geminiResponse.text || '{}';
    // More robust JSON extraction - handle various markdown formats
    let jsonStr = content;
    
    // Try multiple extraction strategies
    // Strategy 1: Extract from ```json ... ``` blocks (with or without closing)
    const markdownMatch = content.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/);
    if (markdownMatch && markdownMatch[1].includes('{')) {
      jsonStr = markdownMatch[1].trim();
    }
    
    // Strategy 2: Find first complete JSON object if still has backticks
    if (jsonStr.includes('`')) {
      const jsonObjectMatch = content.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        jsonStr = jsonObjectMatch[0];
      }
    }
    
    // Strategy 3: Clean any remaining markdown artifacts
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim();
    
    // Final cleanup - remove any leading/trailing backticks
    jsonStr = jsonStr.replace(/^`+/, '').replace(/`+$/, '').trim();
    
    // Strategy 4: Repair truncated JSON (common with long analysis text)
    // Try to detect and fix incomplete JSON
    let parsed: ChartAnalysisResult;
    try {
      parsed = JSON.parse(jsonStr) as ChartAnalysisResult;
    } catch (parseError) {
      // Try to repair truncated JSON
      logger.info("Attempting to repair truncated JSON response...");
      
      // Count braces to see if we need to close them
      const openBraces = (jsonStr.match(/\{/g) || []).length;
      const closeBraces = (jsonStr.match(/\}/g) || []).length;
      const openBrackets = (jsonStr.match(/\[/g) || []).length;
      const closeBrackets = (jsonStr.match(/\]/g) || []).length;
      
      let repairedJson = jsonStr;
      
      // If truncated mid-string, close the string
      const lastQuote = repairedJson.lastIndexOf('"');
      const colonAfterQuote = repairedJson.indexOf(':', lastQuote);
      if (colonAfterQuote === -1 && lastQuote > 0) {
        // We're in the middle of a value string, close it
        repairedJson = repairedJson + '"';
      }
      
      // Add missing closing brackets
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        repairedJson += ']';
      }
      
      // Add missing closing braces
      for (let i = 0; i < openBraces - closeBraces; i++) {
        repairedJson += '}';
      }
      
      try {
        parsed = JSON.parse(repairedJson) as ChartAnalysisResult;
        logger.info("✅ Successfully repaired truncated JSON");
      } catch (repairError) {
        // Last resort: extract key fields using regex
        logger.info("Regex extraction fallback for critical fields...");
        const patternMatch = content.match(/"pattern"\s*:\s*"([^"]+)"/);
        const directionMatch = content.match(/"direction"\s*:\s*"([^"]+)"/);
        const entryMatch = content.match(/"entry(?:Price)?"\s*:\s*([\d.]+)/);
        const targetMatch = content.match(/"target(?:Price)?"\s*:\s*([\d.]+)/);
        const stopMatch = content.match(/"stop(?:Loss)?"\s*:\s*([\d.]+)/);
        const confidenceMatch = content.match(/"confidence"\s*:\s*(\d+)/);
        const sentimentMatch = content.match(/"sentiment"\s*:\s*"([^"]+)"/);
        
        if (patternMatch && entryMatch) {
          const entryPrice = parseFloat(entryMatch[1]);
          const targetPrice = targetMatch ? parseFloat(targetMatch[1]) : entryPrice * 1.02;
          const stopPrice = stopMatch ? parseFloat(stopMatch[1]) : entryPrice * 0.98;
          const riskReward = Math.abs(targetPrice - entryPrice) / Math.abs(entryPrice - stopPrice);
          
          parsed = {
            patterns: [patternMatch[1]],
            supportLevels: [stopPrice],
            resistanceLevels: [targetPrice],
            entryPoint: entryPrice,
            targetPrice: targetPrice,
            stopLoss: stopPrice,
            riskRewardRatio: Math.round(riskReward * 10) / 10,
            confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 60,
            sentiment: (sentimentMatch?.[1] as 'bullish' | 'bearish' | 'neutral') || 'neutral',
            analysis: "Analysis was truncated. Key pattern detected: " + patternMatch[1],
            timeframe: 'unknown'
          };
          logger.info("✅ Extracted key fields via regex fallback");
        } else {
          throw parseError; // Re-throw original error
        }
      }
    }
    
    logger.info("✅ Gemini chart analysis complete");
    return validateChartAnalysisResult(parsed);
    
  } catch (geminiError: any) {
    logger.info("Gemini chart analysis failed, trying OpenAI...", geminiError);
    
    // Fallback to OpenAI (GPT-4o or GPT-5 with vision)
    try {
      const openaiResponse = await getOpenAI().chat.completions.create({
        model: "gpt-4o", // GPT-4o has vision capabilities
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 4096,
      });

      const content = openaiResponse.choices[0].message.content || '{}';
      const parsed = JSON.parse(content) as ChartAnalysisResult;
      
      logger.info("✅ OpenAI chart analysis complete");
      return validateChartAnalysisResult(parsed);
      
    } catch (openaiError: any) {
      logger.info("OpenAI chart analysis failed, trying Claude...", openaiError);
      
      // Fallback to Claude/Anthropic (claude-sonnet with vision)
      try {
        const claudeResponse = await getAnthropic().messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: base64Image
                  }
                }
              ]
            }
          ]
        });

        const claudeContent = claudeResponse.content[0];
        const claudeText = claudeContent.type === 'text' ? claudeContent.text : '{}';
        
        // Parse JSON from Claude response (same robust extraction)
        let claudeJsonStr = claudeText;
        const claudeMarkdownMatch = claudeText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (claudeMarkdownMatch) {
          claudeJsonStr = claudeMarkdownMatch[1].trim();
        } else {
          const claudeJsonObjectMatch = claudeText.match(/\{[\s\S]*\}/);
          if (claudeJsonObjectMatch) {
            claudeJsonStr = claudeJsonObjectMatch[0];
          }
        }
        claudeJsonStr = claudeJsonStr.trim();
        const claudeParsed = JSON.parse(claudeJsonStr) as ChartAnalysisResult;
        
        logger.info("✅ Claude chart analysis complete");
        return validateChartAnalysisResult(claudeParsed);
        
      } catch (claudeError: any) {
        // Try Grok/xAI as final fallback (uses OpenAI-compatible API)
        const grokApiKey = process.env.GROK_API_KEY;
        if (grokApiKey) {
          try {
            logger.info("Claude chart analysis failed, trying Grok/xAI...", claudeError);
            
            const grokResponse = await fetch("https://api.x.ai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${grokApiKey}`
              },
              body: JSON.stringify({
                model: "grok-2-vision-1212",
                messages: [
                  { role: "system", content: systemPrompt },
                  {
                    role: "user",
                    content: [
                      { type: "text", text: userPrompt },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:image/png;base64,${base64Image}`
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 4096,
                temperature: 0.3
              })
            });

            if (!grokResponse.ok) {
              const errorText = await grokResponse.text();
              throw new Error(`Grok API error: ${grokResponse.status} - ${errorText}`);
            }

            const grokData = await grokResponse.json();
            const grokContent = grokData.choices?.[0]?.message?.content || '{}';
            
            // Parse JSON from Grok response
            let grokJsonStr = grokContent;
            const grokMarkdownMatch = grokContent.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (grokMarkdownMatch) {
              grokJsonStr = grokMarkdownMatch[1].trim();
            } else {
              const grokJsonObjectMatch = grokContent.match(/\{[\s\S]*\}/);
              if (grokJsonObjectMatch) {
                grokJsonStr = grokJsonObjectMatch[0];
              }
            }
            grokJsonStr = grokJsonStr.trim();
            const grokParsed = JSON.parse(grokJsonStr) as ChartAnalysisResult;
            
            logger.info("✅ Grok chart analysis complete");
            return validateChartAnalysisResult(grokParsed);
            
          } catch (grokError: any) {
            logger.error("All AI providers failed for chart analysis:", {
              gemini: geminiError?.message,
              openai: openaiError?.message,
              claude: claudeError?.message,
              grok: grokError?.message
            });
            
            // Provide more helpful error messages based on error types
            const isQuotaError = [geminiError, openaiError, claudeError, grokError].some(
              e => e?.message?.toLowerCase().includes('quota') || 
                   e?.message?.toLowerCase().includes('rate limit') ||
                   e?.message?.toLowerCase().includes('429') ||
                   e?.message?.toLowerCase().includes('billing') ||
                   e?.message?.toLowerCase().includes('credit')
            );
            
            if (isQuotaError) {
              throw new Error("AI analysis temporarily unavailable - rate limits reached. Please try again in a few minutes, or use the Quant Engine signals on the Trade Desk.");
            }
            throw new Error("Chart analysis failed. Please try again later.");
          }
        } else {
          logger.error("All AI providers failed for chart analysis:", {
            gemini: geminiError?.message,
            openai: openaiError?.message,
            claude: claudeError?.message
          });
          
          // Provide more helpful error messages based on error types
          const isQuotaError = [geminiError, openaiError, claudeError].some(
            e => e?.message?.toLowerCase().includes('quota') || 
                 e?.message?.toLowerCase().includes('rate limit') ||
                 e?.message?.toLowerCase().includes('429') ||
                 e?.message?.toLowerCase().includes('billing') ||
                 e?.message?.toLowerCase().includes('credit')
          );
          
          if (isQuotaError) {
            throw new Error("AI analysis temporarily unavailable - rate limits reached. Please try again in a few minutes, or use the Quant Engine signals on the Trade Desk.");
          }
          throw new Error("Chart analysis failed. Please try again later.");
        }
      }
    }
  }
}
