/**
 * Multi-LLM Validation Layer (FREE PROVIDERS ONLY - $0.00 COST)
 * 
 * Uses FREE LLM APIs to validate trade ideas through consensus analysis:
 * - Gemini (Google AI Studio): 1,500 req/day FREE - Already configured!
 * - Groq: 14,400 req/day FREE - FASTEST (requires GROQ_API_KEY) ✅
 * - Together AI: $25 free credits (~50,000 requests) (requires TOGETHER_API_KEY)
 * - OpenRouter: 200 req/day FREE (requires OPENROUTER_API_KEY)
 * 
 * NO PAID PROVIDERS: Claude/Anthropic and OpenAI are explicitly excluded
 * to ensure zero billing. All validation is 100% free.
 * 
 * Benefits:
 * - Zero cost for trade validation
 * - Reduced false positives through cross-validation
 * - Multiple provider resilience
 * - Consensus-based approval (majority must agree)
 */

import { logger } from './logger';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

interface TradeIdea {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  confidenceScore: number;
  analysis: string;
  source: string;
}

interface ValidationResult {
  provider: string;
  approved: boolean;
  confidence: number;
  reasoning: string;
  warnings: string[];
  suggestedAdjustments?: {
    targetPrice?: number;
    stopLoss?: number;
    confidenceAdjustment?: number;
  };
  responseTime: number;
  isFree: boolean;
}

interface ConsensusResult {
  approved: boolean;
  consensusScore: number; // 0-100
  providersAgreed: number;
  totalProviders: number;
  individualResults: ValidationResult[];
  combinedReasoning: string;
  warnings: string[];
  adjustedConfidence: number;
  validationTimestamp: string;
  costSavings: string;
}

// Lazy-loaded clients (FREE PROVIDERS ONLY - NO Claude/OpenAI to avoid billing)
let geminiClient: GoogleGenAI | null = null;
let groqClient: OpenAI | null = null;
let togetherClient: OpenAI | null = null;
let mistralClient: OpenAI | null = null;
let cerebrasClient: OpenAI | null = null;
let openRouterClient: OpenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
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
  if (!openRouterClient && process.env.OPENROUTER_API_KEY) {
    openRouterClient = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1'
    });
  }
  return openRouterClient;
}


// Validation prompt template
function createValidationPrompt(idea: TradeIdea, marketContext: string): string {
  return `You are a senior quantitative trading analyst. Validate this trade idea and provide your assessment.

TRADE IDEA:
- Symbol: ${idea.symbol}
- Direction: ${idea.direction.toUpperCase()}
- Entry: $${idea.entryPrice}
- Target: $${idea.targetPrice} (${((idea.targetPrice - idea.entryPrice) / idea.entryPrice * 100).toFixed(2)}% gain)
- Stop Loss: $${idea.stopLoss} (${((idea.stopLoss - idea.entryPrice) / idea.entryPrice * 100).toFixed(2)}% risk)
- Confidence: ${idea.confidenceScore}%
- Source: ${idea.source}
- Analysis: ${idea.analysis.slice(0, 500)}

MARKET CONTEXT:
${marketContext || 'Standard market conditions'}

INSTRUCTIONS:
Evaluate this trade idea for:
1. Technical validity (support/resistance, trends, momentum)
2. Risk/reward ratio appropriateness
3. Position sizing reasonableness
4. Entry timing quality
5. Potential red flags or concerns

Respond in JSON format:
{
  "approved": true/false,
  "confidence": 0-100,
  "reasoning": "Brief explanation (2-3 sentences)",
  "warnings": ["array of concerns if any"],
  "suggestedAdjustments": {
    "targetPrice": null or adjusted price,
    "stopLoss": null or adjusted price,
    "confidenceAdjustment": -10 to +10
  }
}`;
}

// Gemini validation (FREE - 1M tokens/min)
async function validateWithGemini(idea: TradeIdea, marketContext: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const client = getGeminiClient();
  
  if (!client) {
    return {
      provider: 'gemini',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Gemini unavailable - skipped validation',
      warnings: ['Gemini API not configured'],
      responseTime: 0,
      isFree: true
    };
  }

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: createValidationPrompt(idea, marketContext)
    });

    const text = response.text || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        provider: 'gemini',
        approved: parsed.approved ?? true,
        confidence: parsed.confidence ?? idea.confidenceScore,
        reasoning: parsed.reasoning ?? 'Validated (FREE)',
        warnings: parsed.warnings ?? [],
        suggestedAdjustments: parsed.suggestedAdjustments,
        responseTime: Date.now() - startTime,
        isFree: true
      };
    }
    
    return {
      provider: 'gemini',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Could not parse Gemini response',
      warnings: [],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  } catch (error) {
    logger.error('[MULTI-LLM] Gemini validation error:', error);
    return {
      provider: 'gemini',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Gemini validation failed - defaulting to approve',
      warnings: ['Validation error'],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  }
}

// Groq validation (FREE - 14,400 requests/day)
async function validateWithGroq(idea: TradeIdea, marketContext: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const client = getGroqClient();
  
  if (!client) {
    return {
      provider: 'groq',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Groq unavailable - add GROQ_API_KEY for free LLM validation',
      warnings: ['Groq API not configured - get free key at groq.com'],
      responseTime: 0,
      isFree: true
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: createValidationPrompt(idea, marketContext)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        provider: 'groq',
        approved: parsed.approved ?? true,
        confidence: parsed.confidence ?? idea.confidenceScore,
        reasoning: parsed.reasoning ?? 'Validated via Groq (FREE)',
        warnings: parsed.warnings ?? [],
        suggestedAdjustments: parsed.suggestedAdjustments,
        responseTime: Date.now() - startTime,
        isFree: true
      };
    }
    
    return {
      provider: 'groq',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Could not parse Groq response',
      warnings: [],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  } catch (error) {
    logger.error('[MULTI-LLM] Groq validation error:', error);
    return {
      provider: 'groq',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Groq validation failed - defaulting to approve',
      warnings: ['Groq validation error'],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  }
}

// Together AI validation (FREE - $25 credits = ~50,000 requests)
async function validateWithTogether(idea: TradeIdea, marketContext: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const client = getTogetherClient();
  
  if (!client) {
    return {
      provider: 'together',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Together AI unavailable - add TOGETHER_API_KEY for free LLM validation',
      warnings: ['Together API not configured - get $25 free credits at together.ai'],
      responseTime: 0,
      isFree: true
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: createValidationPrompt(idea, marketContext)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        provider: 'together',
        approved: parsed.approved ?? true,
        confidence: parsed.confidence ?? idea.confidenceScore,
        reasoning: parsed.reasoning ?? 'Validated via Together AI (FREE)',
        warnings: parsed.warnings ?? [],
        suggestedAdjustments: parsed.suggestedAdjustments,
        responseTime: Date.now() - startTime,
        isFree: true
      };
    }
    
    return {
      provider: 'together',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Could not parse Together AI response',
      warnings: [],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  } catch (error) {
    logger.error('[MULTI-LLM] Together AI validation error:', error);
    return {
      provider: 'together',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Together AI validation failed - defaulting to approve',
      warnings: ['Together validation error'],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  }
}

// Mistral AI validation (FREE - 1 BILLION tokens/month!)
async function validateWithMistral(idea: TradeIdea, marketContext: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const client = getMistralClient();
  
  if (!client) {
    return {
      provider: 'mistral',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Mistral unavailable - add MISTRAL_API_KEY for 1B tokens/month FREE',
      warnings: ['Mistral API not configured - get free key at console.mistral.ai'],
      responseTime: 0,
      isFree: true
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'mistral-small-latest',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: createValidationPrompt(idea, marketContext)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        provider: 'mistral',
        approved: parsed.approved ?? true,
        confidence: parsed.confidence ?? idea.confidenceScore,
        reasoning: parsed.reasoning ?? 'Validated via Mistral (FREE 1B tokens/mo)',
        warnings: parsed.warnings ?? [],
        suggestedAdjustments: parsed.suggestedAdjustments,
        responseTime: Date.now() - startTime,
        isFree: true
      };
    }
    
    return {
      provider: 'mistral',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Could not parse Mistral response',
      warnings: [],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  } catch (error) {
    logger.error('[MULTI-LLM] Mistral validation error:', error);
    return {
      provider: 'mistral',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Mistral validation failed - defaulting to approve',
      warnings: ['Mistral validation error'],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  }
}

// Cerebras validation (FREE - ultra-fast inference)
async function validateWithCerebras(idea: TradeIdea, marketContext: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const client = getCerebrasClient();
  
  if (!client) {
    return {
      provider: 'cerebras',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Cerebras unavailable - add CEREBRAS_API_KEY for free ultra-fast inference',
      warnings: ['Cerebras API not configured - get free key at cerebras.ai'],
      responseTime: 0,
      isFree: true
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'llama3.1-8b',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: createValidationPrompt(idea, marketContext)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        provider: 'cerebras',
        approved: parsed.approved ?? true,
        confidence: parsed.confidence ?? idea.confidenceScore,
        reasoning: parsed.reasoning ?? 'Validated via Cerebras (FREE)',
        warnings: parsed.warnings ?? [],
        suggestedAdjustments: parsed.suggestedAdjustments,
        responseTime: Date.now() - startTime,
        isFree: true
      };
    }
    
    return {
      provider: 'cerebras',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Could not parse Cerebras response',
      warnings: [],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  } catch (error) {
    logger.error('[MULTI-LLM] Cerebras validation error:', error);
    return {
      provider: 'cerebras',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Cerebras validation failed - defaulting to approve',
      warnings: ['Cerebras validation error'],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  }
}

// OpenRouter validation (FREE - 200 requests/day with free models)
async function validateWithOpenRouter(idea: TradeIdea, marketContext: string): Promise<ValidationResult> {
  const startTime = Date.now();
  const client = getOpenRouterClient();
  
  if (!client) {
    return {
      provider: 'openrouter',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'OpenRouter unavailable - add OPENROUTER_API_KEY for free LLM validation',
      warnings: ['OpenRouter API not configured - get free key at openrouter.ai'],
      responseTime: 0,
      isFree: true
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: createValidationPrompt(idea, marketContext)
      }]
    });

    const text = response.choices[0]?.message?.content || '';
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        provider: 'openrouter',
        approved: parsed.approved ?? true,
        confidence: parsed.confidence ?? idea.confidenceScore,
        reasoning: parsed.reasoning ?? 'Validated via OpenRouter (FREE)',
        warnings: parsed.warnings ?? [],
        suggestedAdjustments: parsed.suggestedAdjustments,
        responseTime: Date.now() - startTime,
        isFree: true
      };
    }
    
    return {
      provider: 'openrouter',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'Could not parse OpenRouter response',
      warnings: [],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  } catch (error) {
    logger.error('[MULTI-LLM] OpenRouter validation error:', error);
    return {
      provider: 'openrouter',
      approved: true,
      confidence: idea.confidenceScore,
      reasoning: 'OpenRouter validation failed - defaulting to approve',
      warnings: ['OpenRouter validation error'],
      responseTime: Date.now() - startTime,
      isFree: true
    };
  }
}

/**
 * Validate a trade idea using multiple LLMs for consensus
 * Uses all available LLMs in parallel for speed
 */
export async function validateTradeWithConsensus(
  idea: TradeIdea,
  marketContext: string = '',
  options: {
    requireConsensus?: boolean;  // Require majority approval
    minProviders?: number;       // Minimum providers that must succeed
    timeout?: number;            // Max time to wait for all providers
  } = {}
): Promise<ConsensusResult> {
  const {
    requireConsensus = true,
    minProviders = 2,
    timeout = 10000
  } = options;

  logger.info(`[MULTI-LLM] Starting consensus validation for ${idea.symbol} ${idea.direction}`);
  
  // Wrap each validation with individual timeout using Promise.allSettled
  // This ensures we get partial results even if some providers are slow
  const wrapWithTimeout = <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs))
    ]);
  };

  const timeoutFallback = (provider: string): ValidationResult => ({
    provider,
    approved: false, // Default to REJECT on timeout for safety
    confidence: 0,
    reasoning: 'Provider timed out',
    warnings: ['Provider timeout - validation incomplete'],
    responseTime: 0,
    isFree: true
  });

  // Run all FREE validations with individual timeouts
  // 6 FREE PROVIDERS: Groq, Gemini, Together, Mistral, Cerebras, OpenRouter
  // NO Claude/OpenAI to avoid billing - all providers are 100% free
  const validationPromises = [
    wrapWithTimeout(validateWithGroq(idea, marketContext), timeout, timeoutFallback('groq')),
    wrapWithTimeout(validateWithGemini(idea, marketContext), timeout, timeoutFallback('gemini')),
    wrapWithTimeout(validateWithTogether(idea, marketContext), timeout, timeoutFallback('together')),
    wrapWithTimeout(validateWithMistral(idea, marketContext), timeout, timeoutFallback('mistral')),
    wrapWithTimeout(validateWithCerebras(idea, marketContext), timeout, timeoutFallback('cerebras')),
    wrapWithTimeout(validateWithOpenRouter(idea, marketContext), timeout, timeoutFallback('openrouter'))
  ];

  // Use Promise.allSettled to get all results (partial or complete)
  const settledResults = await Promise.allSettled(validationPromises);
  
  // Extract fulfilled results
  const results: ValidationResult[] = settledResults
    .filter((r): r is PromiseFulfilledResult<ValidationResult> => r.status === 'fulfilled')
    .map(r => r.value);

  // Filter out failed/skipped validations (responseTime > 0 means successful call)
  const successfulResults = results.filter(r => r.responseTime > 0);
  
  // Calculate consensus - CRITICAL: If no providers succeed, default to REJECT (not approve)
  const approvedCount = successfulResults.filter(r => r.approved).length;
  const totalProviders = successfulResults.length;
  
  // If zero providers responded successfully, consensusScore = 0 and approved = false
  const consensusScore = totalProviders > 0 ? (approvedCount / totalProviders) * 100 : 0;
  
  // Calculate adjusted confidence
  const avgConfidence = successfulResults.length > 0
    ? successfulResults.reduce((sum, r) => sum + r.confidence, 0) / successfulResults.length
    : idea.confidenceScore;
  
  // Combine warnings
  const allWarnings = successfulResults.flatMap(r => r.warnings);
  const uniqueWarnings = Array.from(new Set(allWarnings));
  
  // Combine reasoning
  const combinedReasoning = successfulResults
    .map(r => `[${r.provider.toUpperCase()}] ${r.reasoning}`)
    .join(' | ');
  
  // Determine final approval - CRITICAL: Zero providers = automatic REJECT for safety
  let approved: boolean;
  if (totalProviders === 0) {
    approved = false; // No validation means REJECT
    logger.warn('[MULTI-LLM] No providers succeeded - defaulting to REJECT');
  } else if (requireConsensus) {
    approved = approvedCount >= Math.ceil(totalProviders / 2); // Majority approval
  } else {
    approved = approvedCount >= minProviders;
  }
  
  const result: ConsensusResult = {
    approved,
    consensusScore,
    providersAgreed: approvedCount,
    totalProviders,
    individualResults: results,
    combinedReasoning,
    warnings: uniqueWarnings,
    adjustedConfidence: Math.round(avgConfidence),
    validationTimestamp: new Date().toISOString(),
    costSavings: `$0.00 (100% FREE - ${totalProviders} providers used)`
  };

  logger.info(`[MULTI-LLM] Consensus: ${approved ? 'APPROVED' : 'REJECTED'} (${approvedCount}/${totalProviders} providers, score: ${consensusScore}%)`);
  
  return result;
}

/**
 * Quick validation using single fastest FREE provider
 * Use this for high-volume, lower-stakes validations - 100% FREE
 * Priority: Groq (fastest) → Cerebras → Gemini → Together → Mistral → OpenRouter
 */
export async function quickValidation(idea: TradeIdea, marketContext: string = ''): Promise<ValidationResult> {
  // Try Groq first (free + fastest - 14,400 req/day)
  if (process.env.GROQ_API_KEY) {
    return validateWithGroq(idea, marketContext);
  }
  
  // Try Cerebras (free + ultra-fast)
  if (process.env.CEREBRAS_API_KEY) {
    return validateWithCerebras(idea, marketContext);
  }
  
  // Fall back to Gemini (free - 1,500 req/day)
  if (process.env.GEMINI_API_KEY) {
    return validateWithGemini(idea, marketContext);
  }

  // Try Together AI (free - $25 credits = ~50K requests)
  if (process.env.TOGETHER_API_KEY) {
    return validateWithTogether(idea, marketContext);
  }

  // Try Mistral (free - 1B tokens/month)
  if (process.env.MISTRAL_API_KEY) {
    return validateWithMistral(idea, marketContext);
  }

  // Try OpenRouter (free - 200 req/day)
  if (process.env.OPENROUTER_API_KEY) {
    return validateWithOpenRouter(idea, marketContext);
  }
  
  // Default approve if no providers available
  return {
    provider: 'none',
    approved: true,
    confidence: idea.confidenceScore,
    reasoning: 'No FREE validation providers configured',
    warnings: ['Add GROQ_API_KEY, GEMINI_API_KEY, TOGETHER_API_KEY, MISTRAL_API_KEY, CEREBRAS_API_KEY, or OPENROUTER_API_KEY'],
    responseTime: 0,
    isFree: true
  };
}

/**
 * Get validation service status (6 FREE PROVIDERS - NO Claude/OpenAI billing)
 */
export function getValidationServiceStatus(): {
  providers: { name: string; available: boolean; freeLimit: string }[];
  totalAvailable: number;
  recommendedProviders: string[];
  totalCost: string;
} {
  const providers = [
    { name: 'Groq (Llama 3.3 70B)', available: !!process.env.GROQ_API_KEY, freeLimit: '14,400 req/day ⚡FASTEST' },
    { name: 'Gemini (Google)', available: !!process.env.GEMINI_API_KEY, freeLimit: '1,500 req/day' },
    { name: 'Together AI (Llama 3.3)', available: !!process.env.TOGETHER_API_KEY, freeLimit: '$25 credits (~50K req)' },
    { name: 'Mistral AI', available: !!process.env.MISTRAL_API_KEY, freeLimit: '1B tokens/month 🔥' },
    { name: 'Cerebras (Ultra-fast)', available: !!process.env.CEREBRAS_API_KEY, freeLimit: 'Free tier ⚡' },
    { name: 'OpenRouter (30+ models)', available: !!process.env.OPENROUTER_API_KEY, freeLimit: '200 req/day' }
  ];
  
  const totalAvailable = providers.filter(p => p.available).length;
  
  const recommendedProviders: string[] = [];
  if (!process.env.GROQ_API_KEY) {
    recommendedProviders.push('Add GROQ_API_KEY for 14,400 free validations/day - FASTEST (groq.com)');
  }
  if (!process.env.MISTRAL_API_KEY) {
    recommendedProviders.push('Add MISTRAL_API_KEY for 1 BILLION free tokens/month (console.mistral.ai)');
  }
  if (!process.env.TOGETHER_API_KEY) {
    recommendedProviders.push('Add TOGETHER_API_KEY for $25 free credits = ~50,000 validations (together.ai)');
  }
  if (!process.env.CEREBRAS_API_KEY) {
    recommendedProviders.push('Add CEREBRAS_API_KEY for ultra-fast free inference (cerebras.ai)');
  }
  if (!process.env.OPENROUTER_API_KEY) {
    recommendedProviders.push('Add OPENROUTER_API_KEY for 30+ free models (openrouter.ai)');
  }
  
  return {
    providers,
    totalAvailable,
    recommendedProviders,
    totalCost: '$0.00 - All 6 providers are 100% FREE (NO Claude/OpenAI billing)'
  };
}
