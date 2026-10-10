/**
 * LLM TECHNICAL ANALYSIS VALIDATOR
 *
 * Uses all FREE LLMs to validate and enhance technical analysis:
 * - Cross-validates technical signals from our engine
 * - Generates AI-powered summaries (replaces templates)
 * - Provides consensus voting on trade direction
 * - Adds risk warnings and market context
 *
 * FREE PROVIDERS: Groq, Gemini, Together, Mistral (NO paid APIs!)
 */

import { logger } from './logger';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { SymbolAnalysisResult, EngineResult } from './symbol-analyzer';

// Lazy-loaded clients
let geminiClient: GoogleGenAI | null = null;
let groqClient: OpenAI | null = null;
let togetherClient: OpenAI | null = null;
let mistralClient: OpenAI | null = null;
let cerebrasClient: OpenAI | null = null;
let openrouterClient: OpenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

function getGroqClient(): OpenAI | null {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1'
    });
  }
  return groqClient;
}

function getTogetherClient(): OpenAI | null {
  if (!togetherClient && process.env.TOGETHER_API_KEY) {
    togetherClient = new OpenAI({
      apiKey: process.env.TOGETHER_API_KEY,
      baseURL: 'https://api.together.xyz/v1'
    });
  }
  return togetherClient;
}

function getMistralClient(): OpenAI | null {
  if (!mistralClient && process.env.MISTRAL_API_KEY) {
    mistralClient = new OpenAI({
      apiKey: process.env.MISTRAL_API_KEY,
      baseURL: 'https://api.mistral.ai/v1'
    });
  }
  return mistralClient;
}

function getCerebrasClient(): OpenAI | null {
  if (!cerebrasClient && process.env.CEREBRAS_API_KEY) {
    cerebrasClient = new OpenAI({
      apiKey: process.env.CEREBRAS_API_KEY,
      baseURL: 'https://api.cerebras.ai/v1'
    });
  }
  return cerebrasClient;
}

function getOpenRouterClient(): OpenAI | null {
  if (!openrouterClient && process.env.OPENROUTER_API_KEY) {
    openrouterClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    });
  }
  return openrouterClient;
}

export interface LLMValidationResult {
  provider: string;
  agreesWithDirection: boolean;
  confidenceAdjustment: number; // -20 to +20
  riskWarnings: string[];
  enhancedInsight: string;
  responseTime: number;
}

export interface AnalysisValidationResult {
  // Consensus
  consensusDirection: 'bullish' | 'bearish' | 'neutral';
  consensusConfidence: number;
  providersAgreed: number;
  totalProviders: number;

  // Enhanced output
  aiSummary: string;
  riskWarnings: string[];
  keyInsights: string[];

  // Adjustments
  adjustedConfidence: number;
  confidenceBoost: number;

  // Individual results
  individualResults: LLMValidationResult[];

  // Meta
  validationTimestamp: string;
  processingTime: number;
}

/**
 * Create prompt for technical analysis validation
 */
function createAnalysisValidationPrompt(analysis: SymbolAnalysisResult): string {
  const engineSummary = Object.entries(analysis.engines)
    .map(([name, engine]) => `- ${name}: ${engine.signal.toUpperCase()} (${engine.confidence}%) - ${engine.signals.slice(0, 2).join(', ')}`)
    .join('\n');

  return `You are a senior quantitative analyst. Validate this technical analysis and provide your assessment.

SYMBOL: ${analysis.symbol}
PRICE: $${analysis.currentPrice} (${analysis.priceChangePercent >= 0 ? '+' : ''}${analysis.priceChangePercent.toFixed(2)}%)

ENGINE ANALYSIS (6 engines):
${engineSummary}

OVERALL RESULT:
- Direction: ${analysis.overallDirection.toUpperCase()}
- Confidence: ${analysis.overallConfidence}%
- Grade: ${analysis.overallGrade}
- Holding Period: ${analysis.holdingPeriod.period} (${analysis.holdingPeriod.reasoning})

TRADE IDEA:
- Entry: $${analysis.tradeIdea.entry}
- Target: $${analysis.tradeIdea.target}
- Stop Loss: $${analysis.tradeIdea.stopLoss}
- Risk/Reward: ${analysis.tradeIdea.riskReward}

INSTRUCTIONS:
1. Do you agree with the ${analysis.overallDirection.toUpperCase()} direction? Consider:
   - Technical indicator readings
   - Risk/reward setup quality
   - Holding period appropriateness

2. What risk factors should the trader be aware of?

3. Provide a 2-3 sentence trading insight.

Respond in JSON format ONLY:
{
  "agreesWithDirection": true/false,
  "confidenceAdjustment": -20 to +20,
  "riskWarnings": ["warning1", "warning2"],
  "enhancedInsight": "2-3 sentence insight about this trade setup"
}`;
}

/**
 * Validate with Groq (FREE - FASTEST)
 */
async function validateWithGroq(analysis: SymbolAnalysisResult): Promise<LLMValidationResult> {
  const startTime = Date.now();
  const client = getGroqClient();

  if (!client) {
    return {
      provider: 'groq',
      agreesWithDirection: true,
      confidenceAdjustment: 0,
      riskWarnings: [],
      enhancedInsight: 'Groq not configured',
      responseTime: 0
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: createAnalysisValidationPrompt(analysis)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      // Fix common LLM JSON issues: +5 instead of 5, trailing commas
      const fixedJson = jsonMatch[0]
        .replace(/:\s*\+(\d+)/g, ': $1')  // +5 -> 5
        .replace(/,\s*}/g, '}')           // trailing commas
        .replace(/,\s*]/g, ']');          // trailing commas in arrays
      const parsed = JSON.parse(fixedJson);
      return {
        provider: 'groq',
        agreesWithDirection: parsed.agreesWithDirection ?? true,
        confidenceAdjustment: Math.max(-20, Math.min(20, parsed.confidenceAdjustment ?? 0)),
        riskWarnings: parsed.riskWarnings ?? [],
        enhancedInsight: parsed.enhancedInsight ?? '',
        responseTime: Date.now() - startTime
      };
    }
  } catch (error: any) {
    logger.warn(`[LLM-VALIDATOR] Groq error: ${error.message}`);
  }

  return {
    provider: 'groq',
    agreesWithDirection: true,
    confidenceAdjustment: 0,
    riskWarnings: [],
    enhancedInsight: 'Groq validation failed',
    responseTime: Date.now() - startTime
  };
}

/**
 * Validate with Gemini (FREE)
 */
async function validateWithGemini(analysis: SymbolAnalysisResult): Promise<LLMValidationResult> {
  const startTime = Date.now();
  const client = getGeminiClient();

  if (!client) {
    return {
      provider: 'gemini',
      agreesWithDirection: true,
      confidenceAdjustment: 0,
      riskWarnings: [],
      enhancedInsight: 'Gemini not configured',
      responseTime: 0
    };
  }

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: createAnalysisValidationPrompt(analysis)
    });

    const text = response.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const fixedJson = jsonMatch[0]
        .replace(/:\s*\+(\d+)/g, ': $1')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      const parsed = JSON.parse(fixedJson);
      return {
        provider: 'gemini',
        agreesWithDirection: parsed.agreesWithDirection ?? true,
        confidenceAdjustment: Math.max(-20, Math.min(20, parsed.confidenceAdjustment ?? 0)),
        riskWarnings: parsed.riskWarnings ?? [],
        enhancedInsight: parsed.enhancedInsight ?? '',
        responseTime: Date.now() - startTime
      };
    }
  } catch (error: any) {
    logger.warn(`[LLM-VALIDATOR] Gemini error: ${error.message}`);
  }

  return {
    provider: 'gemini',
    agreesWithDirection: true,
    confidenceAdjustment: 0,
    riskWarnings: [],
    enhancedInsight: 'Gemini validation failed',
    responseTime: Date.now() - startTime
  };
}

/**
 * Validate with Together AI (FREE)
 */
async function validateWithTogether(analysis: SymbolAnalysisResult): Promise<LLMValidationResult> {
  const startTime = Date.now();
  const client = getTogetherClient();

  if (!client) {
    return {
      provider: 'together',
      agreesWithDirection: true,
      confidenceAdjustment: 0,
      riskWarnings: [],
      enhancedInsight: 'Together AI not configured',
      responseTime: 0
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      max_tokens: 500,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: createAnalysisValidationPrompt(analysis)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const fixedJson = jsonMatch[0]
        .replace(/:\s*\+(\d+)/g, ': $1')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      const parsed = JSON.parse(fixedJson);
      return {
        provider: 'together',
        agreesWithDirection: parsed.agreesWithDirection ?? true,
        confidenceAdjustment: Math.max(-20, Math.min(20, parsed.confidenceAdjustment ?? 0)),
        riskWarnings: parsed.riskWarnings ?? [],
        enhancedInsight: parsed.enhancedInsight ?? '',
        responseTime: Date.now() - startTime
      };
    }
  } catch (error: any) {
    logger.warn(`[LLM-VALIDATOR] Together error: ${error.message}`);
  }

  return {
    provider: 'together',
    agreesWithDirection: true,
    confidenceAdjustment: 0,
    riskWarnings: [],
    enhancedInsight: 'Together validation failed',
    responseTime: Date.now() - startTime
  };
}

/**
 * Validate with Mistral (FREE - 1B tokens/month)
 */
async function validateWithMistral(analysis: SymbolAnalysisResult): Promise<LLMValidationResult> {
  const startTime = Date.now();
  const client = getMistralClient();

  if (!client) {
    return {
      provider: 'mistral',
      agreesWithDirection: true,
      confidenceAdjustment: 0,
      riskWarnings: [],
      enhancedInsight: 'Mistral not configured',
      responseTime: 0
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'mistral-small-latest',
      max_tokens: 500,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: createAnalysisValidationPrompt(analysis)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const fixedJson = jsonMatch[0]
        .replace(/:\s*\+(\d+)/g, ': $1')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      const parsed = JSON.parse(fixedJson);
      return {
        provider: 'mistral',
        agreesWithDirection: parsed.agreesWithDirection ?? true,
        confidenceAdjustment: Math.max(-20, Math.min(20, parsed.confidenceAdjustment ?? 0)),
        riskWarnings: parsed.riskWarnings ?? [],
        enhancedInsight: parsed.enhancedInsight ?? '',
        responseTime: Date.now() - startTime
      };
    }
  } catch (error: any) {
    logger.warn(`[LLM-VALIDATOR] Mistral error: ${error.message}`);
  }

  return {
    provider: 'mistral',
    agreesWithDirection: true,
    confidenceAdjustment: 0,
    riskWarnings: [],
    enhancedInsight: 'Mistral validation failed',
    responseTime: Date.now() - startTime
  };
}

/**
 * Validate with Cerebras (FREE - FAST inference)
 */
async function validateWithCerebras(analysis: SymbolAnalysisResult): Promise<LLMValidationResult> {
  const startTime = Date.now();
  const client = getCerebrasClient();

  if (!client) {
    return {
      provider: 'cerebras',
      agreesWithDirection: true,
      confidenceAdjustment: 0,
      riskWarnings: [],
      enhancedInsight: 'Cerebras not configured',
      responseTime: 0
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b',
      max_tokens: 500,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: createAnalysisValidationPrompt(analysis)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const fixedJson = jsonMatch[0]
        .replace(/:\s*\+(\d+)/g, ': $1')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      const parsed = JSON.parse(fixedJson);
      return {
        provider: 'cerebras',
        agreesWithDirection: parsed.agreesWithDirection ?? true,
        confidenceAdjustment: Math.max(-20, Math.min(20, parsed.confidenceAdjustment ?? 0)),
        riskWarnings: parsed.riskWarnings ?? [],
        enhancedInsight: parsed.enhancedInsight ?? '',
        responseTime: Date.now() - startTime
      };
    }
  } catch (error: any) {
    logger.warn(`[LLM-VALIDATOR] Cerebras error: ${error.message}`);
  }

  return {
    provider: 'cerebras',
    agreesWithDirection: true,
    confidenceAdjustment: 0,
    riskWarnings: [],
    enhancedInsight: 'Cerebras validation failed',
    responseTime: Date.now() - startTime
  };
}

/**
 * Validate with OpenRouter (FREE models available)
 */
async function validateWithOpenRouter(analysis: SymbolAnalysisResult): Promise<LLMValidationResult> {
  const startTime = Date.now();
  const client = getOpenRouterClient();

  if (!client) {
    return {
      provider: 'openrouter',
      agreesWithDirection: true,
      confidenceAdjustment: 0,
      riskWarnings: [],
      enhancedInsight: 'OpenRouter not configured',
      responseTime: 0
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'meta-llama/llama-3.2-3b-instruct', // Fast model on OpenRouter
      max_tokens: 500,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: createAnalysisValidationPrompt(analysis)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const fixedJson = jsonMatch[0]
        .replace(/:\s*\+(\d+)/g, ': $1')
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      const parsed = JSON.parse(fixedJson);
      return {
        provider: 'openrouter',
        agreesWithDirection: parsed.agreesWithDirection ?? true,
        confidenceAdjustment: Math.max(-20, Math.min(20, parsed.confidenceAdjustment ?? 0)),
        riskWarnings: parsed.riskWarnings ?? [],
        enhancedInsight: parsed.enhancedInsight ?? '',
        responseTime: Date.now() - startTime
      };
    }
  } catch (error: any) {
    logger.warn(`[LLM-VALIDATOR] OpenRouter error: ${error.message}`);
  }

  return {
    provider: 'openrouter',
    agreesWithDirection: true,
    confidenceAdjustment: 0,
    riskWarnings: [],
    enhancedInsight: 'OpenRouter validation failed',
    responseTime: Date.now() - startTime
  };
}

/**
 * MAIN: Validate technical analysis with multi-LLM consensus
 */
export async function validateAnalysisWithLLMs(
  analysis: SymbolAnalysisResult,
  options: {
    timeout?: number;
    minProviders?: number;
  } = {}
): Promise<AnalysisValidationResult> {
  const startTime = Date.now();
  const { timeout = 8000, minProviders = 2 } = options;

  logger.info(`[LLM-VALIDATOR] Starting multi-LLM validation for ${analysis.symbol}`);

  // Wrap with timeout
  const wrapWithTimeout = <T>(promise: Promise<T>, fallback: T): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeout))
    ]);
  };

  const timeoutFallback = (provider: string): LLMValidationResult => ({
    provider,
    agreesWithDirection: true, // Default agree on timeout
    confidenceAdjustment: 0,
    riskWarnings: ['Provider timed out'],
    enhancedInsight: '',
    responseTime: 0
  });

  // Run all 6 FREE LLMs in parallel for maximum consensus
  const validationPromises = [
    wrapWithTimeout(validateWithGroq(analysis), timeoutFallback('groq')),
    wrapWithTimeout(validateWithGemini(analysis), timeoutFallback('gemini')),
    wrapWithTimeout(validateWithTogether(analysis), timeoutFallback('together')),
    wrapWithTimeout(validateWithMistral(analysis), timeoutFallback('mistral')),
    wrapWithTimeout(validateWithCerebras(analysis), timeoutFallback('cerebras')),
    wrapWithTimeout(validateWithOpenRouter(analysis), timeoutFallback('openrouter'))
  ];

  const results = await Promise.all(validationPromises);

  // Filter successful results (responseTime > 0)
  const successfulResults = results.filter(r => r.responseTime > 0);

  // Calculate consensus
  const agreedCount = successfulResults.filter(r => r.agreesWithDirection).length;
  const totalProviders = successfulResults.length;

  // Determine consensus direction
  let consensusDirection = analysis.overallDirection;
  if (totalProviders >= minProviders && agreedCount < totalProviders / 2) {
    // Majority disagrees - flip direction
    consensusDirection = analysis.overallDirection === 'bullish' ? 'bearish' :
                         analysis.overallDirection === 'bearish' ? 'bullish' : 'neutral';
  }

  // Calculate adjusted confidence
  const avgAdjustment = successfulResults.length > 0
    ? successfulResults.reduce((sum, r) => sum + r.confidenceAdjustment, 0) / successfulResults.length
    : 0;

  // Consensus boost: If all LLMs agree, boost confidence
  const consensusBoost = agreedCount === totalProviders && totalProviders >= 2 ? 10 :
                         agreedCount >= totalProviders * 0.75 ? 5 : 0;

  const adjustedConfidence = Math.max(10, Math.min(95,
    analysis.overallConfidence + avgAdjustment + consensusBoost
  ));

  // Collect all risk warnings
  const allWarnings = successfulResults.flatMap(r => r.riskWarnings);
  const uniqueWarnings = Array.from(new Set(allWarnings)).slice(0, 5);

  // Pick best insight (longest, most detailed)
  const insights = successfulResults
    .map(r => r.enhancedInsight)
    .filter(i => i && i.length > 10)
    .sort((a, b) => b.length - a.length);

  // Generate AI summary from LLM insights
  const aiSummary = generateAISummary(analysis, successfulResults, agreedCount, totalProviders);

  const result: AnalysisValidationResult = {
    consensusDirection,
    consensusConfidence: totalProviders > 0 ? (agreedCount / totalProviders) * 100 : 50,
    providersAgreed: agreedCount,
    totalProviders,
    aiSummary,
    riskWarnings: uniqueWarnings,
    keyInsights: insights.slice(0, 3),
    adjustedConfidence: Math.round(adjustedConfidence),
    confidenceBoost: Math.round(avgAdjustment + consensusBoost),
    individualResults: results,
    validationTimestamp: new Date().toISOString(),
    processingTime: Date.now() - startTime
  };

  logger.info(`[LLM-VALIDATOR] Consensus: ${agreedCount}/${totalProviders} agree on ${consensusDirection.toUpperCase()} ` +
              `(confidence: ${analysis.overallConfidence}% → ${result.adjustedConfidence}%) in ${result.processingTime}ms`);

  return result;
}

/**
 * Generate AI summary from LLM consensus
 */
function generateAISummary(
  analysis: SymbolAnalysisResult,
  results: LLMValidationResult[],
  agreedCount: number,
  totalProviders: number
): string {
  const symbol = analysis.symbol;
  const direction = analysis.overallDirection;
  const confidence = analysis.overallConfidence;
  const consensusPercent = totalProviders > 0 ? Math.round((agreedCount / totalProviders) * 100) : 0;

  // Get the best insight from LLMs
  const bestInsight = results
    .map(r => r.enhancedInsight)
    .filter(i => i && i.length > 20)
    .sort((a, b) => b.length - a.length)[0];

  if (bestInsight) {
    return bestInsight;
  }

  // Fallback to generated summary if no good LLM insight
  const directionText = direction === 'bullish' ? 'upward momentum' :
                        direction === 'bearish' ? 'downward pressure' : 'sideways movement';

  const consensusText = consensusPercent >= 75
    ? `Strong AI consensus (${consensusPercent}%)`
    : consensusPercent >= 50
      ? `Moderate AI agreement (${consensusPercent}%)`
      : `Mixed AI signals (${consensusPercent}% agreement)`;

  const riskReward = analysis.tradeIdea.riskReward;
  const holdingPeriod = analysis.holdingPeriod.period;

  return `${symbol} shows ${directionText} with ${confidence}pts signal strength. ${consensusText} supports the ${direction} thesis. ` +
         `Risk/reward of ${riskReward} suggests a ${holdingPeriod} trade setup with entry at $${analysis.tradeIdea.entry}.`;
}

/**
 * Get validator service status
 */
export function getValidatorStatus(): {
  providers: { name: string; available: boolean }[];
  totalAvailable: number;
} {
  const providers = [
    { name: 'Groq (Llama 3.3 70B)', available: !!process.env.GROQ_API_KEY },
    { name: 'Gemini (Google)', available: !!process.env.GEMINI_API_KEY },
    { name: 'Together AI', available: !!process.env.TOGETHER_API_KEY },
    { name: 'Mistral AI', available: !!process.env.MISTRAL_API_KEY },
    { name: 'Cerebras (Llama 3.1 70B)', available: !!process.env.CEREBRAS_API_KEY },
    { name: 'OpenRouter (Free Models)', available: !!process.env.OPENROUTER_API_KEY }
  ];

  return {
    providers,
    totalAvailable: providers.filter(p => p.available).length
  };
}
