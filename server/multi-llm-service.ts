/**
 * MULTI-LLM CONSENSUS SERVICE
 *
 * Smart AI system that:
 * 1. Uses all available LLMs to generate best answers
 * 2. Automatically falls back if one fails
 * 3. Compares responses for quality
 * 4. Optimizes for cost (uses free/cheap models first)
 */

import OpenAI from "openai"; // Used for Grok (OpenAI-compatible API)
import { GoogleGenAI } from "@google/genai";
import { logger } from './logger';
// NOTE: Anthropic import removed - we only use FREE LLMs (Gemini + Grok)

// LLM Priority Order (FREE ONLY - no paid APIs!)
const LLM_PRIORITY = {
  CHEAP_FAST: ['groq', 'gemini', 'mistral', 'grok', 'together'], // Groq fastest, all FREE!
  BEST_QUALITY: ['together', 'gemini', 'groq', 'mistral', 'grok'], // Together has best models
  CONSENSUS: ['gemini', 'groq', 'mistral', 'together', 'grok'], // Use all for comparison
};

interface LLMResponse {
  provider: string;
  model: string;
  response: string;
  latency: number;
  cost: number;
  error?: string;
}

interface LLMConfig {
  name: string;
  enabled: boolean;
  cost_per_1k_tokens: number;
  free_tier: boolean;
  client?: any;
}

class MultiLLMService {
  private llms: Map<string, LLMConfig> = new Map();

  constructor() {
    this.initializeLLMs();
  }

  private initializeLLMs() {
    // ============================================
    // FREE LLMs ONLY - No paid APIs!
    // ============================================

    // Gemini - 100% FREE (15 requests/min, 1500/day)
    if (process.env.GEMINI_API_KEY) {
      this.llms.set('gemini', {
        name: 'Google Gemini 2.5 Flash',
        enabled: true,
        cost_per_1k_tokens: 0, // FREE!
        free_tier: true,
        client: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
      });
      logger.info('✅ Gemini initialized (FREE - 1500 req/day)');
    }

    // Grok - FREE tier ($25/month free credits)
    if (process.env.GROK_API_KEY) {
      this.llms.set('grok', {
        name: 'xAI Grok',
        enabled: true,
        cost_per_1k_tokens: 0, // FREE with credits!
        free_tier: true,
        client: new OpenAI({
          apiKey: process.env.GROK_API_KEY,
          baseURL: 'https://api.x.ai/v1',
        }),
      });
      logger.info('✅ Grok initialized (FREE - $25/month credits)');
    }

    // ============================================
    // ADDITIONAL FREE LLMs (All OpenAI-compatible!)
    // ============================================

    // Groq - 100% FREE, FASTEST inference (custom LPU hardware)
    // 14,400 requests/day, 70K tokens/min for Llama 3.3 70B
    if (process.env.GROQ_API_KEY) {
      this.llms.set('groq', {
        name: 'Groq (Llama 3.3 70B)',
        enabled: true,
        cost_per_1k_tokens: 0, // 100% FREE!
        free_tier: true,
        client: new OpenAI({
          apiKey: process.env.GROQ_API_KEY,
          baseURL: 'https://api.groq.com/openai/v1',
        }),
      });
      logger.info('✅ Groq initialized (FREE - 14,400 req/day, FASTEST)');
    }

    // Together AI - $100 FREE credits, best open-source models
    // Has Llama 3.1 405B, DeepSeek R1, and more
    if (process.env.TOGETHER_API_KEY) {
      this.llms.set('together', {
        name: 'Together AI (Llama 3.1 70B)',
        enabled: true,
        cost_per_1k_tokens: 0, // FREE with $100 credits!
        free_tier: true,
        client: new OpenAI({
          apiKey: process.env.TOGETHER_API_KEY,
          baseURL: 'https://api.together.xyz/v1',
        }),
      });
      logger.info('✅ Together AI initialized (FREE - $100 credits)');
    }

    // Mistral - 100% FREE, extremely generous limits
    // 1 billion tokens/month, Open-Mixtral-8x7B
    if (process.env.MISTRAL_API_KEY) {
      this.llms.set('mistral', {
        name: 'Mistral (Mixtral 8x7B)',
        enabled: true,
        cost_per_1k_tokens: 0, // 100% FREE!
        free_tier: true,
        client: new OpenAI({
          apiKey: process.env.MISTRAL_API_KEY,
          baseURL: 'https://api.mistral.ai/v1',
        }),
      });
      logger.info('✅ Mistral initialized (FREE - 1B tokens/month)');
    }

    // NOTE: OpenAI and Anthropic are PAID - not loaded to save costs

    const providers = Array.from(this.llms.keys());
    logger.info(`🆓 Multi-LLM initialized with ${this.llms.size} FREE providers: ${providers.join(', ')}`);
  }

  /**
   * Call single LLM with error handling
   */
  private async callLLM(
    provider: string,
    prompt: string,
    systemPrompt?: string,
    temperature: number = 0.7
  ): Promise<LLMResponse> {
    const llm = this.llms.get(provider);
    if (!llm || !llm.enabled) {
      throw new Error(`LLM provider ${provider} not available`);
    }

    const startTime = Date.now();

    try {
      let response: string;
      let tokens = 0;

      switch (provider) {
        case 'gemini':
          const geminiResult = await llm.client.models.generateContent({
            model: "gemini-2.5-flash",
            config: {
              systemInstruction: systemPrompt || 'You are a helpful trading assistant.',
              temperature,
            },
            contents: prompt,
          });
          response = geminiResult.text || '';
          tokens = 500; // Estimate since new API doesn't expose token count
          break;

        case 'grok':
          const grokResponse = await llm.client.chat.completions.create({
            model: 'grok-beta',
            messages: [
              { role: 'system', content: systemPrompt || 'You are a helpful trading assistant.' },
              { role: 'user', content: prompt },
            ],
            temperature,
          });
          response = grokResponse.choices[0].message.content || '';
          tokens = grokResponse.usage?.total_tokens || 0;
          break;

        case 'groq':
          // Groq - FASTEST inference, uses Llama 3.3 70B
          const groqResponse = await llm.client.chat.completions.create({
            model: 'llama-3.3-70b-versatile', // Also: mixtral-8x7b-32768, llama-3.1-8b-instant
            messages: [
              { role: 'system', content: systemPrompt || 'You are a helpful trading assistant.' },
              { role: 'user', content: prompt },
            ],
            temperature,
          });
          response = groqResponse.choices[0].message.content || '';
          tokens = groqResponse.usage?.total_tokens || 0;
          break;

        case 'together':
          // Together AI - Best quality open models
          const togetherResponse = await llm.client.chat.completions.create({
            model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', // Very capable
            messages: [
              { role: 'system', content: systemPrompt || 'You are a helpful trading assistant.' },
              { role: 'user', content: prompt },
            ],
            temperature,
          });
          response = togetherResponse.choices[0].message.content || '';
          tokens = togetherResponse.usage?.total_tokens || 0;
          break;

        case 'mistral':
          // Mistral - Great performance, huge free limits
          const mistralResponse = await llm.client.chat.completions.create({
            model: 'open-mixtral-8x7b', // Also: open-mistral-7b, mistral-small-latest
            messages: [
              { role: 'system', content: systemPrompt || 'You are a helpful trading assistant.' },
              { role: 'user', content: prompt },
            ],
            temperature,
          });
          response = mistralResponse.choices[0].message.content || '';
          tokens = mistralResponse.usage?.total_tokens || 0;
          break;

        default:
          throw new Error(`Unknown provider: ${provider}`);
      }

      const latency = Date.now() - startTime;
      const cost = (tokens / 1000) * llm.cost_per_1k_tokens;

      logger.info(`✅ ${llm.name} responded in ${latency}ms (${tokens} tokens, $${cost.toFixed(4)})`);

      return {
        provider,
        model: llm.name,
        response,
        latency,
        cost,
      };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      logger.warn(`❌ ${llm.name} failed after ${latency}ms:`, error.message);

      return {
        provider,
        model: llm.name,
        response: '',
        latency,
        cost: 0,
        error: error.message,
      };
    }
  }

  /**
   * Generate with automatic fallback
   * Tries providers in order until one succeeds
   */
  async generateWithFallback(
    prompt: string,
    systemPrompt?: string,
    strategy: 'cheap' | 'quality' = 'cheap'
  ): Promise<string> {
    const priority = strategy === 'cheap' ? LLM_PRIORITY.CHEAP_FAST : LLM_PRIORITY.BEST_QUALITY;

    for (const provider of priority) {
      if (!this.llms.has(provider)) continue;

      try {
        const result = await this.callLLM(provider, prompt, systemPrompt);
        if (result.response && !result.error) {
          logger.info(`✅ Successfully used ${result.model} (${strategy} strategy)`);
          return result.response;
        }
      } catch (error) {
        logger.warn(`${provider} failed, trying next provider...`);
        continue;
      }
    }

    throw new Error('All LLM providers failed');
  }

  /**
   * Generate with consensus (uses multiple LLMs and picks best)
   * Uses 3 models, compares responses, picks longest/most detailed
   */
  async generateWithConsensus(
    prompt: string,
    systemPrompt?: string
  ): Promise<{ response: string; providers: string[]; totalCost: number }> {
    const providers = LLM_PRIORITY.CONSENSUS.filter(p => this.llms.has(p));

    if (providers.length < 2) {
      // Not enough providers for consensus, fall back to single
      const response = await this.generateWithFallback(prompt, systemPrompt, 'quality');
      return { response, providers: ['fallback'], totalCost: 0 };
    }

    logger.info(`🎯 Running consensus mode with ${providers.length} LLMs...`);

    // Call all providers in parallel
    const results = await Promise.allSettled(
      providers.map(p => this.callLLM(p, prompt, systemPrompt))
    );

    const successfulResults = results
      .filter((r): r is PromiseFulfilledResult<LLMResponse> =>
        r.status === 'fulfilled' && !r.value.error
      )
      .map(r => r.value);

    if (successfulResults.length === 0) {
      throw new Error('All LLMs failed in consensus mode');
    }

    // Pick best response (longest, most detailed)
    const bestResponse = successfulResults.reduce((best, current) =>
      current.response.length > best.response.length ? current : best
    );

    const totalCost = successfulResults.reduce((sum, r) => sum + r.cost, 0);
    const usedProviders = successfulResults.map(r => r.provider);

    logger.info(`✅ Consensus complete: ${usedProviders.length}/${providers.length} succeeded, ` +
                `best from ${bestResponse.provider} (${bestResponse.response.length} chars), ` +
                `total cost: $${totalCost.toFixed(4)}`);

    return {
      response: bestResponse.response,
      providers: usedProviders,
      totalCost,
    };
  }

  /**
   * Generate with quality comparison
   * Runs multiple models and lets you compare
   */
  async generateWithComparison(
    prompt: string,
    systemPrompt?: string
  ): Promise<LLMResponse[]> {
    const providers = Array.from(this.llms.keys()).slice(0, 3); // Use first 3

    logger.info(`📊 Running comparison mode with ${providers.length} LLMs...`);

    const results = await Promise.allSettled(
      providers.map(p => this.callLLM(p, prompt, systemPrompt))
    );

    const responses = results
      .filter((r): r is PromiseFulfilledResult<LLMResponse> => r.status === 'fulfilled')
      .map(r => r.value);

    logger.info(`✅ Comparison complete: ${responses.length} responses generated`);

    return responses;
  }

  /**
   * Get available providers status
   */
  getAvailableProviders(): { name: string; free: boolean; enabled: boolean }[] {
    return Array.from(this.llms.entries()).map(([key, config]) => ({
      name: config.name,
      free: config.free_tier,
      enabled: config.enabled,
    }));
  }
}

// Singleton instance
export const multiLLM = new MultiLLMService();

// Convenience functions
export async function generateAI(
  prompt: string,
  options?: {
    system?: string;
    mode?: 'fallback' | 'consensus' | 'comparison';
    strategy?: 'cheap' | 'quality';
  }
): Promise<string> {
  const mode = options?.mode || 'fallback';

  switch (mode) {
    case 'consensus':
      const consensus = await multiLLM.generateWithConsensus(prompt, options?.system);
      return consensus.response;

    case 'comparison':
      const comparisons = await multiLLM.generateWithComparison(prompt, options?.system);
      return comparisons[0]?.response || '';

    case 'fallback':
    default:
      return await multiLLM.generateWithFallback(
        prompt,
        options?.system,
        options?.strategy || 'cheap'
      );
  }
}
