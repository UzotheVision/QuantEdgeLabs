import { storage } from "./storage";
import { PerformanceValidator } from "./performance-validator";
import { fetchStockPrice, fetchCryptoPrice } from "./market-api";
import { fetchCboeChain, findContractMid, type CboeChain } from "./contract-analyzer/cboe-chain";
import { analyzeLoss } from "./loss-analyzer";
import { backfillContractlessIdeas } from "./universal-idea-generator";
import type { TradeIdea, InsertTradePriceSnapshot, PriceSnapshotEventType } from "@shared/schema";

/**
 * Automated Performance Validation Service
 * Runs periodically to validate open trade ideas and update outcomes
 */
class PerformanceValidationService {
  private intervalId: NodeJS.Timeout | null = null;
  private isValidating = false;
  private validationIntervalMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Start the automated validation service
   */
  start() {
    if (this.intervalId) {
      console.log('⚠️  Performance validation service already running');
      return;
    }

    console.log(`🎯 Starting Performance Validation Service (interval: ${this.validationIntervalMs / 1000 / 60} minutes)`);

    // Monday morning catchup: validate all open ideas even if market isn't
    // fully open yet. This closes out Friday ideas that hit target/stop
    // over the weekend (which were skipped because isMarketOpen() returns false
    // on Saturday/Sunday).
    if (this.needsWeekendCatchup()) {
      console.log('📅 Monday morning catchup — validating open ideas from weekend gap');
      this.validateAllOpenTrades(true).catch(err =>
        console.error('❌ Weekend catchup validation failed:', err)
      );
    } else {
      // Run immediately on startup
      this.validateAllOpenTrades().catch(err =>
        console.error('❌ Initial performance validation failed:', err)
      );
    }

    // Retry contract attachment for any option-intent ideas that saved as stock
    // (CBOE chain unavailable at creation). Runs on startup + each cycle so the
    // "save-as-stock, retry later" fallback actually self-heals into real contracts.
    backfillContractlessIdeas().catch(err =>
      console.error('❌ Initial contract backfill failed:', err)
    );

    // Then run periodically
    this.intervalId = setInterval(() => {
      this.validateAllOpenTrades().catch(err =>
        console.error('❌ Performance validation failed:', err)
      );
      backfillContractlessIdeas().catch(err =>
        console.error('❌ Contract backfill failed:', err)
      );
    }, this.validationIntervalMs);

    console.log('✅ Performance validation service started');
  }

  /**
   * Stop the validation service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 Performance validation service stopped');
    }
  }

  /**
   * Check if stock market is open (weekday during market hours ET)
   * Returns false on weekends to prevent false validations with stale prices
   */
  private isMarketOpen(): boolean {
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = etTime.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();

    // Weekend check - markets closed
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }

    // Extended validation window: 8:00 AM - 5:00 PM ET (includes pre/post market)
    const timeInMinutes = hour * 60 + minute;
    const marketOpen = 8 * 60; // 8:00 AM ET
    const marketClose = 17 * 60; // 5:00 PM ET

    return timeInMinutes >= marketOpen && timeInMinutes <= marketClose;
  }

  /**
   * Check if this is Monday before market open (catchup window for weekend gaps).
   * Runs once per boot to close out Friday ideas that hit target/stop over the weekend.
   */
  private needsWeekendCatchup(): boolean {
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = etTime.getDay();
    const hour = etTime.getHours();
    // Monday before 10 AM ET — catchup window
    return dayOfWeek === 1 && hour < 10;
  }

  /**
   * Validate all open trade ideas
   * Fetches current prices and checks if any hit target/stop/expired
   */
  async validateAllOpenTrades(forceRun = false): Promise<{
    validated: number;
    winners: number;
    losers: number;
    expired: number;
  }> {
    // Prevent concurrent validations
    if (this.isValidating) {
      console.log('⏭️  Skipping validation - already in progress');
      return { validated: 0, winners: 0, losers: 0, expired: 0 };
    }

    // Skip validation on weekends and outside market hours
    // (unless forceRun is true — used by Monday morning catchup)
    if (!forceRun && !this.isMarketOpen()) {
      const now = new Date();
      const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][etTime.getDay()];
      console.log(`📊 Skipping validation - market closed (${dayName} ${etTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ET)`);
      return { validated: 0, winners: 0, losers: 0, expired: 0 };
    }

    this.isValidating = true;
    this.lastRunTime = new Date();
    let validated = 0;
    let winners = 0;
    let losers = 0;
    let expired = 0;

    try {
      const openIdeas = await storage.getOpenTradeIdeas();
      
      if (openIdeas.length === 0) {
        console.log('📊 No open trade ideas to validate');
        this.lastRunSuccess = true; // Clean run with no work to do
        return { validated: 0, winners: 0, losers: 0, expired: 0 };
      }

      console.log(`📊 Validating ${openIdeas.length} open trade ideas...`);

      // Fetch current prices for all symbols
      const priceMap = await this.fetchCurrentPrices(openIdeas);
      
      // 🔧 BUG FIX: Fetch futures contracts to avoid circular dependency in validator
      // Collect unique contract codes from futures ideas
      const futuresContractCodes = new Set(
        openIdeas
          .filter(i => i.assetType === 'future' && i.futuresContractCode)
          .map(i => i.futuresContractCode!)
      );
      
      // Fetch all needed contracts in parallel
      const contractsMap = new Map();
      if (futuresContractCodes.size > 0) {
        console.log(`  📊 Fetching ${futuresContractCodes.size} futures contracts...`);
        const contractPromises = Array.from(futuresContractCodes).map(async code => {
          try {
            const contract = await storage.getFuturesContract(code);
            return { code, contract };
          } catch (error) {
            console.warn(`  ⚠️  Failed to fetch contract ${code}:`, error);
            return { code, contract: null };
          }
        });
        
        const contractResults = await Promise.all(contractPromises);
        for (const { code, contract } of contractResults) {
          if (contract) {
            contractsMap.set(code, contract);
          }
        }
        console.log(`  ✓ Fetched ${contractsMap.size}/${futuresContractCodes.size} contracts successfully`);
      }
      
      // Enrich extremes from REAL daily bars before judging barriers. The
      // tracked highest/lowestPriceReached only advanced at 5-minute polls, so
      // a spike that touched a barrier BETWEEN polls (or during a dev restart)
      // never existed as far as resolution was concerned — wins and losses
      // both undercounted, silently. Today's bar high/low from the candle
      // feed captures the full session regardless of poll timing.
      try {
        const { fetchCandlesBatch } = await import('./historical-candles');
        const symbols = Array.from(new Set(openIdeas.map(i => i.symbol.toUpperCase())));
        const candles = await fetchCandlesBatch(symbols, '5d', '1d', 8);
        const today = new Date().toISOString().slice(0, 10);
        let enriched = 0;
        // An idea published TODAY must not be judged by the part of the session
        // before it existed. The whole-day bar did exactly that: a 14:00 idea was
        // "stopped" by a 10:00 low. 5-minute replay of every resolved idea
        // (research/path-replay.ts, 2026-09-24) found 50 recorded stops that
        // price never touched after publication. Same-day ideas use 5m bars from
        // the publish minute; older ideas keep the full daily bar.
        const { fetchCandles } = await import('./historical-candles');
        for (const idea of openIdeas) {
          const createdSec = new Date(idea.timestamp).getTime() / 1000;
          if (new Date(idea.timestamp).toISOString().slice(0, 10) === today) {
            // Regular session only, matching the daily bar used on later days.
            const etMin = (t: number) => { const [h, m] = new Date(t * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' }).split(':').map(Number); return (h % 24) * 60 + m; };
            const intraday = (await fetchCandles(idea.symbol.toUpperCase(), '5d', '5m'))
              .filter((b) => b.time >= createdSec && etMin(b.time) >= 570 && etMin(b.time) < 960);
            if (intraday.length) {
              idea.highestPriceReached = Math.max(idea.highestPriceReached ?? -Infinity, ...intraday.map((b) => b.high));
              idea.lowestPriceReached = Math.min(idea.lowestPriceReached ?? Infinity, ...intraday.map((b) => b.low));
              enriched++;
            }
            continue;
          }
          const bars = candles.get(idea.symbol.toUpperCase()) ?? [];
          const todayBar = bars[bars.length - 1];
          if (!todayBar) continue;
          const barDay = new Date(todayBar.time * 1000).toISOString().slice(0, 10);
          if (barDay !== today) continue;
          if (Number.isFinite(todayBar.high) && todayBar.high > 0) {
            idea.highestPriceReached = Math.max(idea.highestPriceReached ?? -Infinity, todayBar.high);
            enriched++;
          }
          if (Number.isFinite(todayBar.low) && todayBar.low > 0) {
            idea.lowestPriceReached = Math.min(idea.lowestPriceReached ?? Infinity, todayBar.low);
          }
        }
        if (enriched > 0) console.log(`  📏 Extremes enriched from daily bars for ${enriched} idea(s)`);
      } catch (err: any) {
        console.warn('  ⚠️ Bar-extreme enrichment failed (continuing with poll extremes):', err?.message);
      }

      // Validate each idea with contract metadata
      const validationResults = PerformanceValidator.validateBatch(openIdeas, priceMap, contractsMap);

      // Update database for ideas that need updating
      for (const [ideaId, result] of Array.from(validationResults.entries())) {
        if (result.shouldUpdate) {
          const ideaForResult = openIdeas.find(i => i.id === ideaId);

          // 💵 REAL OPTION P&L: when an option idea resolves, capture the exit
          // premium (current contract mid) and compute the actual contract
          // return off the entry premium. This is what the trader's contract
          // really did — independent of the stock-level percentGain above.
          // Never fabricate: only set these when we have BOTH premiums.
          let exitPremium: number | null = null;
          let optionPercentGain: number | null = null;
          if (
            ideaForResult?.assetType === 'option' &&
            result.outcomeStatus && result.outcomeStatus !== 'open' &&
            typeof ideaForResult.entryPremium === 'number' && ideaForResult.entryPremium > 0
          ) {
            const livePremium = priceMap.get(`option_${ideaId}`);
            if (typeof livePremium === 'number' && livePremium >= 0) {
              /**
               * Floor the exit premium at intrinsic value.
               *
               * An option cannot be worth less than what it is worth if
               * exercised right now. When the quoted premium is below intrinsic,
               * the quote is stale — not a bargain.
               *
               * This is not hypothetical. AFRM's $77 09/04 call was entered at
               * $4.55, hit its target with the underlying at $88.92 (intrinsic
               * $11.92, a 162% contract return), and was recorded as +14.95%.
               * The validator had priced the exit at $5.22, which was the
               * PRE-EARNINGS close from the previous session's chain: equity
               * options stop trading at 16:15 ET, so an overnight gap leaves
               * every quote in the chain stale while the underlying has moved.
               *
               * Reporting 15% on a 162% trade is worse than reporting nothing —
               * it makes a working signal look mediocre and poisons every
               * win-rate and expectancy number computed downstream.
               */
              const strike = Number((ideaForResult as any).strikePrice);
              const isCall = String((ideaForResult as any).optionType ?? '').toLowerCase().startsWith('c');
              const underlyingExit = Number(result.exitPrice);

              let effective = livePremium;
              if (Number.isFinite(strike) && strike > 0 && Number.isFinite(underlyingExit) && underlyingExit > 0) {
                const intrinsic = isCall
                  ? Math.max(0, underlyingExit - strike)
                  : Math.max(0, strike - underlyingExit);
                if (intrinsic > livePremium) {
                  console.log(
                    `  ⚠️  ${ideaForResult.symbol} quoted exit premium $${livePremium.toFixed(2)} is below ` +
                    `intrinsic $${intrinsic.toFixed(2)} (underlying ${underlyingExit}, strike ${strike}) — ` +
                    `stale chain, using intrinsic`,
                  );
                  effective = intrinsic;
                }
              }

              exitPremium = Math.round(effective * 100) / 100;
              const rawPct = ((exitPremium - ideaForResult.entryPremium) / ideaForResult.entryPremium) * 100;
              // Calls and puts are bought. `direction` describes the underlying
              // thesis, not the side of the option contract.
              optionPercentGain = Math.round(rawPct * 100) / 100;
              console.log(`  💵 ${ideaForResult.symbol} option P&L: entry $${ideaForResult.entryPremium} → exit $${exitPremium} = ${optionPercentGain >= 0 ? '+' : ''}${optionPercentGain}%`);
            }
          }

          await storage.updateTradeIdeaPerformance(ideaId, {
            outcomeStatus: result.outcomeStatus,
            exitPrice: result.exitPrice,
            percentGain: result.percentGain,
            resolutionReason: result.resolutionReason,
            exitDate: result.exitDate,
            actualHoldingTimeMinutes: result.actualHoldingTimeMinutes,
            predictionAccurate: result.predictionAccurate,
            predictionValidatedAt: result.predictionValidatedAt,
            highestPriceReached: result.highestPriceReached,
            lowestPriceReached: result.lowestPriceReached,
            // 🎓 EDUCATIONAL: Track what would have happened for missed entries
            missedEntryTheoreticalOutcome: result.missedEntryTheoreticalOutcome,
            missedEntryTheoreticalGain: result.missedEntryTheoreticalGain,
            // 💵 Real option contract P&L (option ideas only)
            exitPremium: exitPremium ?? undefined,
            optionPercentGain: optionPercentGain ?? undefined,
          });

          validated++;
          const idea = openIdeas.find(i => i.id === ideaId);
          
          if (result.outcomeStatus === 'hit_target') {
            winners++;
            // 🚫 DISABLED: Do NOT send theoretical gains to Discord
            // These are from trade_ideas (research signals), NOT actual bot trades
            // Real bot gains come from paper_positions exits via sendBotTradeExitToDiscord
            // Sending theoretical gains as "WINNERS" is misleading to users
            console.log(`  📊 ${idea?.symbol}: THEORETICAL target hit (not posted to Discord)`);
          }
          else if (result.outcomeStatus === 'hit_stop') {
            losers++;
            // 📉 Automatic loss analysis - understand why this trade failed
            if (idea) {
              try {
                const updatedIdea = { ...idea, outcomeStatus: result.outcomeStatus as any, percentGain: result.percentGain ?? null, exitPrice: result.exitPrice ?? null, actualHoldingTimeMinutes: result.actualHoldingTimeMinutes ?? null };
                const lossAnalysis = await analyzeLoss(updatedIdea);
                if (lossAnalysis) {
                  await storage.createLossAnalysis(lossAnalysis);
                  console.log(`  📉 Loss analyzed: ${idea.symbol} - ${lossAnalysis.lossReason}`);
                }
              } catch (err) {
                console.warn(`  ⚠️  Failed to analyze loss for ${idea?.symbol}:`, err);
              }
            }
          }
          else if (result.outcomeStatus === 'expired') expired++;
          if (idea) {
            console.log(`  ✓ ${idea.symbol}: ${result.outcomeStatus} at $${result.exitPrice?.toFixed(2)} (${result.percentGain?.toFixed(1)}%)`);
            
            // 📸 Save price snapshot for audit trail
            const currentPrice = priceMap.get(idea.symbol) || result.exitPrice;
            if (currentPrice) {
              const eventType: PriceSnapshotEventType = 
                result.outcomeStatus === 'hit_target' ? 'target_hit' :
                result.outcomeStatus === 'hit_stop' ? 'stop_hit' :
                result.outcomeStatus === 'expired' ? 'expired' : 'validation_check';
              
              const snapshot: InsertTradePriceSnapshot = {
                tradeIdeaId: ideaId,
                eventType,
                eventTimestamp: new Date().toISOString(),
                currentPrice: currentPrice,
                bidPrice: null, // Full bid/ask available from Tradier for options
                askPrice: null,
                lastPrice: currentPrice,
                distanceToTargetPercent: result.percentGain ? Math.abs(result.percentGain) : null,
                distanceToStopPercent: null,
                pnlAtSnapshot: result.percentGain ?? null,
                validatorVersion: 'v1.0',
                dataSource: 'validation',
              };
              
              try {
                await storage.savePriceSnapshot(snapshot);
              } catch (err) {
                console.warn(`  ⚠️  Failed to save price snapshot for ${idea.symbol}:`, err);
              }
            }
          }
        }
      }

      if (validated > 0) {
        console.log(`✅ Validated ${validated} trades: ${winners} winners, ${losers} losers, ${expired} expired`);
      } else {
        console.log('📊 All open trades still in progress');
      }

      this.lastRunSuccess = true;
      return { validated, winners, losers, expired };

    } catch (error) {
      console.error('❌ Performance validation error:', error);
      this.lastRunSuccess = false;
      throw error;
    } finally {
      this.isValidating = false;
    }
  }

  /**
   * Fetch current prices for all symbols including OPTIONS
   * OPTIMIZED: Deduplicates symbols, batches requests, includes retry logic
   * 
   * ✅ FIXED: Now fetches option premiums from Tradier API for proper validation
   */
  private async fetchCurrentPrices(ideas: TradeIdea[]): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();
    
    // OPTIMIZATION: Deduplicate symbols first (avoid redundant API calls)
    const uniqueStockSymbols = new Set(
      ideas
        .filter(i => i.assetType === 'stock' || i.assetType === 'penny_stock')
        .map(i => i.symbol)
    );
    
    const uniqueCryptoSymbols = new Set(
      ideas
        .filter(i => i.assetType === 'crypto')
        .map(i => i.symbol)
    );
    
    // Collect unique options (need full option details, not just symbol)
    const optionIdeas = ideas.filter(i => 
      i.assetType === 'option' && i.strikePrice && i.expiryDate && i.optionType
    );

    const totalUnique = uniqueStockSymbols.size + uniqueCryptoSymbols.size + optionIdeas.length;
    console.log(`  📊 Fetching prices for ${totalUnique} unique symbols (${uniqueStockSymbols.size} stocks, ${uniqueCryptoSymbols.size} crypto, ${optionIdeas.length} options)`);

    // OPTIMIZATION: Fetch all prices in parallel using Promise.all
    const stockPromises = Array.from(uniqueStockSymbols).map(async (symbol) => ({
      symbol,
      type: 'stock' as const,
      price: await this.fetchWithRetry(symbol, 'stock'),
    }));

    const cryptoPromises = Array.from(uniqueCryptoSymbols).map(async (symbol) => ({
      symbol,
      type: 'crypto' as const,
      price: await this.fetchWithRetry(symbol, 'crypto'),
    }));
    
    // OPTIONS — single source of truth: fetch the CBOE chain ONCE per unique
    // underlying. One call gives us BOTH the underlying spot (for resolving the
    // stock-level target/stop) AND the contract mid premium (for real option
    // P&L). This replaces the dead Tradier path.
    const optionUnderlyings = Array.from(
      new Set(optionIdeas.map(i => i.symbol.toUpperCase()))
    );
    const chainPromises = optionUnderlyings.map(async (sym) => {
      const chain = await fetchCboeChain(sym).catch(() => null);
      return { sym, chain };
    });

    // Execute all price fetches concurrently
    const [stockResults, cryptoResults, chainResults] = await Promise.all([
      Promise.all(stockPromises),
      Promise.all(cryptoPromises),
      Promise.all(chainPromises),
    ]);

    // Index fetched chains by underlying so we can derive spot + premium per idea
    const chainBySymbol = new Map<string, CboeChain>();
    for (const { sym, chain } of chainResults) {
      if (chain) chainBySymbol.set(sym, chain);
    }

    // Derive per-idea results: spot keyed by symbol (for stock-level
    // target/stop resolution) + premium keyed by option_<id> (for P&L).
    const optionResults = optionIdeas.map((idea) => {
      const chain = chainBySymbol.get(idea.symbol.toUpperCase());
      if (!chain) {
        return { symbol: idea.symbol, ideaId: idea.id, spot: null, premium: null };
      }
      const premium = findContractMid(
        chain,
        idea.optionType as 'call' | 'put',
        idea.strikePrice!,
        idea.expiryDate!,
      );
      return { symbol: idea.symbol, ideaId: idea.id, spot: chain.spot, premium };
    });

    // Collect results and track success/failure
    let stockSuccess = 0;
    let stockFailed = 0;
    let cryptoSuccess = 0;
    let cryptoFailed = 0;
    let optionSuccess = 0;
    let optionFailed = 0;

    for (const result of stockResults) {
      if (result.price !== null) {
        priceMap.set(result.symbol, result.price);
        stockSuccess++;
      } else {
        stockFailed++;
      }
    }
    
    for (const result of cryptoResults) {
      if (result.price !== null) {
        priceMap.set(result.symbol, result.price);
        cryptoSuccess++;
      } else {
        cryptoFailed++;
      }
    }
    
    // Options: store the underlying SPOT under the symbol key (used to resolve
    // the stock-level target/stop), and the contract PREMIUM under option_<id>
    // (used to compute real option P&L). An idea counts as "fetched" only when
    // we got its premium — that's what the P&L tracker needs.
    for (const result of optionResults) {
      if (result.spot !== null && !priceMap.has(result.symbol)) {
        priceMap.set(result.symbol, result.spot);
      }
      if (result.premium !== null && result.ideaId) {
        priceMap.set(`option_${result.ideaId}`, result.premium);
        optionSuccess++;
      } else {
        optionFailed++;
      }
    }

    const totalSuccess = stockSuccess + cryptoSuccess + optionSuccess;
    const totalFailed = stockFailed + cryptoFailed + optionFailed;
    
    console.log(`  ✓ Fetched ${totalSuccess}/${totalUnique} prices successfully (${stockSuccess} stocks, ${cryptoSuccess} crypto, ${optionSuccess} options)`);
    if (totalFailed > 0) {
      console.warn(`  ⚠️  Failed to fetch ${totalFailed} prices total - those trades will be validated next cycle`);
    }
    
    return priceMap;
  }

  /**
   * Fetch price with exponential backoff retry logic
   */
  private async fetchWithRetry(
    symbol: string, 
    type: 'stock' | 'crypto', 
    maxRetries = 2
  ): Promise<number | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const data = type === 'stock' 
          ? await fetchStockPrice(symbol)
          : await fetchCryptoPrice(symbol);
          
        if (data && data.currentPrice) {
          return data.currentPrice;
        }
      } catch (error: any) {
        // Only retry on network/5xx errors, not 4xx
        const shouldRetry = attempt < maxRetries && 
          (error.statusCode >= 500 || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET');
        
        if (shouldRetry) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // 1s, 2s, max 5s
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    
    return null; // All retries failed
  }

  /**
   * Get validation service status
   */
  getStatus() {
    return {
      running: this.intervalId !== null,
      isValidating: this.isValidating,
      intervalMinutes: this.validationIntervalMs / 1000 / 60,
      lastRun: this.lastRunTime,
      lastRunSuccess: this.lastRunSuccess,
    };
  }

  private lastRunTime: Date | null = null;
  private lastRunSuccess: boolean = false;
}

// Singleton instance
export const performanceValidationService = new PerformanceValidationService();
