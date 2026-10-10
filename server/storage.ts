import { randomUUID } from "crypto";
import { formatInTimeZone } from "date-fns-tz";

import type {
  MarketData,
  InsertMarketData,
  TradeIdea,
  InsertTradeIdea,
  Catalyst,
  InsertCatalyst,
  WatchlistItem,
  InsertWatchlist,
  OptionsData,
  InsertOptionsData,
  UserPreferences,
  InsertUserPreferences,
  ModelCard,
  InsertModelCard,
  OutcomeStatus,
  User,
  UpsertUser,
  FuturesContract,
  FuturesResearchBrief,
  InsertFuturesResearchBrief,
  DailyUsage,
  InsertDailyUsage,
  ActiveTrade,
  InsertActiveTrade,
  ActiveTradeStatus,
  SubscriptionTier,
  AssetType,
  PaperPortfolio,
  InsertPaperPortfolio,
  PaperPosition,
  InsertPaperPosition,
  PaperEquitySnapshot,
  InsertPaperEquitySnapshot,
  PaperTradeStatus,
  InsertCTSource,
  CTSource,
  InsertCTMention,
  CTMention,
  InsertCTCallPerformance,
  CTCallPerformance,
  TrackedWallet,
  InsertTrackedWallet,
  WalletHolding,
  InsertWalletHolding,
  WalletTransaction,
  InsertWalletTransaction,
  WalletAlert,
  InsertWalletAlert,
  InsertTradeInputSnapshot,
  TradeInputSnapshot,
  InsertEngineDailyMetrics,
  EngineDailyMetrics,
  InsertEngineHealthAlert,
  EngineHealthAlert,
  EngineSource,
  InsertTradePriceSnapshot,
  TradePriceSnapshot,
  BlogPost,
  InsertBlogPost,
  BlogPostStatus,
  AutoLottoPreferences,
  InsertAutoLottoPreferences,
  PlatformReport,
  InsertPlatformReport,
  ReportPeriod,
  UserLoginHistory,
  InsertUserLoginHistory,
  PageView,
  InsertPageView,
  UserActivityEvent,
  InsertUserActivityEvent,
  UserAnalyticsSummary,
  InsertUserAnalyticsSummary,
  UserActivityType,
  BetaWaitlist,
  InsertBetaWaitlist,
  BetaInvite,
  InsertBetaInvite,
  WaitlistStatus,
  InviteStatus,
  TradeDiagnostics,
  InsertTradeDiagnostics,
  BotLearningState,
  InsertBotLearningState,
  PremiumHistoryRecord,
  InsertPremiumHistory,
  PasswordResetToken,
  InsertPasswordResetToken,
  UserPageLayout,
  InsertUserPageLayout,
  LayoutPreset,
  InsertLayoutPreset,
  WatchlistHistoryRecord,
  InsertWatchlistHistory,
  SymbolNote,
  InsertSymbolNote,
  researchHistory,
  ResearchHistoryRecord,
  InsertResearchHistory,
  UserNavigationLayout,
  InsertUserNavigationLayout,
  NavigationLayoutType,
  WhaleFlow,
  InsertWhaleFlow,
  JournalTrade,
  InsertJournalTrade,
  JournalBroker,
  GexSnapshotRecord,
  InsertGexSnapshot,
} from "@shared/schema";
import { db } from "./db";
import { recordPaperExecution } from "@shared/oracle-lifecycle";
import { eq, and, or, gte, lte, desc, isNull, not, sql as drizzleSql } from "drizzle-orm";
import {
  tradeIdeas,
  marketData as marketDataTable,
  catalysts as catalystsTable,
  watchlist as watchlistTable,
  optionsData as optionsDataTable,
  userPreferences as userPreferencesTable,
  modelCards as modelCardsTable,
  users,
  futuresContracts,
  dailyUsage as dailyUsageTable,
  activeTrades as activeTradesTable,
  paperPortfolios as paperPortfoliosTable,
  paperPositions as paperPositionsTable,
  paperEquitySnapshots as paperEquitySnapshotsTable,
  ctSources,
  ctMentions,
  ctCallPerformance,
  trackedWallets,
  walletHoldings,
  walletTransactions,
  walletAlerts,
  tradeInputSnapshots,
  engineDailyMetrics,
  engineHealthAlerts,
  tradePriceSnapshots,
  blogPosts,
  lossAnalysis,
  InsertLossAnalysis,
  LossAnalysis,
  futuresResearchBriefs,
  autoLottoPreferences,
  platformReports,
  userLoginHistory,
  pageViews,
  userActivityEvents,
  userAnalyticsSummary,
  betaWaitlist,
  betaInvites,
  tradeDiagnostics,
  botLearningState,
  premiumHistory,
  passwordResetTokens,
  userPageLayouts,
  layoutPresets,
  watchlistHistory,
  symbolNotes,
  userNavigationLayouts,
  whaleFlows,
  journalTrades,
  gexSnapshots,
} from "@shared/schema";

// ========================================
// 🔧 DATA INTEGRITY: Canonical Trade Filters
// ========================================
// Re-export canonical functions from shared/constants.ts
// This is the SINGLE SOURCE OF TRUTH - both frontend and backend use the same logic
export { 
  CANONICAL_LOSS_THRESHOLD, 
  isRealLoss, 
  isRealLossByResolution, 
  isCurrentGenEngine 
} from "@shared/constants";

// Import for use in this file
import { CANONICAL_LOSS_THRESHOLD, isRealLoss, isRealLossByResolution, isCurrentGenEngine, reportableRate } from "@shared/constants";
import { normalizeIdeaSource } from "@shared/idea-sources";
import { logger } from "./logger";

// ========================================
// 🛡️ SHARED SCANNER VALIDATION GATE
// ========================================
/**
 * Validates a trade idea before it's written to the DB. This is the single
 * choke point all 18+ scanners pass through, so any contradiction caught
 * here is one we won't have to fix downstream in the convictions engine
 * or the UI.
 *
 * Rules:
 *   1. Must have non-empty symbol + direction
 *   2. Direction must be "long" or "short"
 *   3. Entry / target / stop must all be positive finite numbers
 *   4. Target must be on the correct side of entry for the direction
 *      (long: target > entry; short: target < entry)
 *   5. Stop must be on the opposite side of target from entry
 *   6. R:R must be ≥ 0.5 (otherwise it's a fee-eating trap)
 *   7. Catalyst text must not contradict the direction (no "long" with
 *      explicit bearish language and vice versa)
 */
const BEARISH_KEYWORDS = /\b(bearish|breakdown|sell[- ]off|crash|plunge|tumble|collaps|rejected|reversal down|put wall|gamma flip down)\b/i;
const BULLISH_KEYWORDS = /\b(bullish|breakout|squeeze|surge|rally|ramp|pop|moonshot|call wall break|gamma squeeze)\b/i;

export function validateTradeIdeaForCreate(
  idea: InsertTradeIdea,
): { ok: true } | { ok: false; reason: string } {
  const sym = (idea as any).symbol;
  if (!sym || typeof sym !== "string") return { ok: false, reason: "missing symbol" };

  const dir = ((idea as any).direction ?? "").toString().toLowerCase();
  if (dir !== "long" && dir !== "short") return { ok: false, reason: `invalid direction "${dir}"` };

  const entry = Number((idea as any).entryPrice);
  const target = Number((idea as any).targetPrice);
  const stop = Number((idea as any).stopLoss);

  if (!Number.isFinite(entry) || entry <= 0) return { ok: false, reason: `invalid entry ${entry}` };
  if (!Number.isFinite(target) || target <= 0) return { ok: false, reason: `invalid target ${target}` };
  if (!Number.isFinite(stop) || stop <= 0) return { ok: false, reason: `invalid stop ${stop}` };

  if (dir === "long") {
    if (target <= entry) return { ok: false, reason: `long target ${target} ≤ entry ${entry}` };
    if (stop >= entry) return { ok: false, reason: `long stop ${stop} ≥ entry ${entry}` };
  } else {
    if (target >= entry) return { ok: false, reason: `short target ${target} ≥ entry ${entry}` };
    if (stop <= entry) return { ok: false, reason: `short stop ${stop} ≤ entry ${entry}` };
  }

  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return { ok: false, reason: "zero risk distance" };
  const rr = reward / risk;
  if (rr < 0.5) return { ok: false, reason: `R:R ${rr.toFixed(2)} < 0.5 (trap)` };

  // Catalyst sentiment vs direction
  const catalyst = ((idea as any).catalyst ?? "").toString();
  if (catalyst) {
    if (dir === "long" && BEARISH_KEYWORDS.test(catalyst) && !BULLISH_KEYWORDS.test(catalyst)) {
      return { ok: false, reason: `long but catalyst is bearish: "${catalyst.slice(0, 60)}"` };
    }
    if (dir === "short" && BULLISH_KEYWORDS.test(catalyst) && !BEARISH_KEYWORDS.test(catalyst)) {
      return { ok: false, reason: `short but catalyst is bullish: "${catalyst.slice(0, 60)}"` };
    }
  }

  return { ok: true };
}

/**
 * Get canonical "decided" trades - wins + real losses only
 * Excludes expired, breakeven, and legacy engine versions
 */
export function getDecidedTrades(ideas: any[], options: { includeAllVersions?: boolean } = {}): any[] {
  let filtered = ideas;
  
  // Apply engine version filter unless explicitly disabled
  if (!options.includeAllVersions) {
    filtered = filtered.filter(isCurrentGenEngine);
  }
  
  // Filter to decided trades only (wins + real losses)
  return filtered.filter(idea => 
    idea.outcomeStatus === 'hit_target' || isRealLoss(idea)
  );
}

/**
 * Get canonical "decided" trades using resolutionReason
 * For auto-resolved trade endpoints
 */
export function getDecidedTradesByResolution(ideas: any[], options: { includeAllVersions?: boolean } = {}): any[] {
  let filtered = ideas;
  
  // Apply engine version filter unless explicitly disabled
  if (!options.includeAllVersions) {
    filtered = filtered.filter(isCurrentGenEngine);
  }
  
  // Filter to decided trades only (auto-resolved wins + real losses)
  return filtered.filter(idea => 
    idea.resolutionReason === 'auto_target_hit' || isRealLossByResolution(idea)
  );
}

/**
 * 🔧 CANONICAL PERFORMANCE FILTERS
 * Apply the same pre-filters used by /api/performance/stats to ensure
 * consistent trade counts across all performance analytics endpoints.
 * 
 * Filters applied:
 * 1. Exclude options (no proper pricing yet)
 * 2. Exclude flow/lotto sources (unvalidatable options)
 * 3. Optionally exclude buggy/test trades
 * 
 * Use this helper BEFORE calling getDecidedTrades or getDecidedTradesByResolution
 */
export interface CanonicalFilterOptions {
  includeOptions?: boolean;      // Include option trades (default: false)
  includeFlowLotto?: boolean;    // Include flow/lotto sources (default: false)
  includeBuggyTrades?: boolean;  // Include trades with excludeFromTraining=true (default: false)
}

export function applyCanonicalPerformanceFilters(
  ideas: any[], 
  options: CanonicalFilterOptions = {}
): any[] {
  let filtered = ideas;
  
  // Step 1: Exclude buggy/test trades (excludeFromTraining=true)
  if (!options.includeBuggyTrades) {
    filtered = filtered.filter(idea => !idea.excludeFromTraining);
  }
  
  // Step 2: Exclude options (no proper pricing yet)
  // EXCEPTION: When includeFlowLotto is true, keep flow/lotto options (they ARE options)
  if (!options.includeOptions) {
    filtered = filtered.filter(idea => {
      // Keep non-options
      if (idea.assetType !== 'option') return true;
      // If includeFlowLotto is set, keep flow/lotto options
      if (options.includeFlowLotto && (idea.source === 'flow' || idea.source === 'lotto')) return true;
      // Otherwise exclude options
      return false;
    });
  }
  
  // Step 3: Exclude flow/lotto sources (unvalidatable options)
  if (!options.includeFlowLotto) {
    filtered = filtered.filter(idea => idea.source !== 'flow' && idea.source !== 'lotto');
  }
  
  return filtered;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * `winRate` is null when the segment's sample cannot support one — see
 * reportableRate in @shared/constants. It was 0 in that case, which the equities
 * segment published as a red 0% off a single decided trade. The counts are
 * always present, so a suppressed rate still shows its sample.
 */
export interface SegmentedWinRate {
  winRate: number | null;
  wins: number;
  losses: number;
  decided: number;
}

export interface SegmentedWinRates {
  equities: SegmentedWinRate;
  options: SegmentedWinRate;
  overall: SegmentedWinRate;
}

export interface PerformanceStats {
  overall: {
    totalIdeas: number;
    openIdeas: number;
    closedIdeas: number;
    wonIdeas: number;
    lostIdeas: number;
    expiredIdeas: number;
    /**
     * Market win rate: hit_target / (hit_target + hit_stop).
     *
     * NOTE: this is computed over ALL trades (segmentedWinRates.overall), while
     * wonIdeas/lostIdeas/closedIdeas above describe the FILTERED set — options are
     * excluded from those unless includeOptions is set. The two populations are
     * different on purpose, which is why the payload reads `wonIdeas: 0,
     * lostIdeas: 1, winRate: 64.9` and is not self-contradicting once you know
     * that. Render it with winRateDecided beside it, never with closedIdeas.
     *
     * Null when the sample is below MIN_REPORTABLE_SAMPLE.
     */
    winRate: number | null;
    /** Sample behind winRate — a DIFFERENT population from closedIdeas. */
    winRateDecided: number;
    quantAccuracy: number; // Weighted prediction accuracy (confidence-weighted avg progress toward target)
    directionalAccuracy: number; // % of trades that moved at least 25% toward target
    avgPercentGain: number;
    avgHoldingTimeMinutes: number;
    // PROFESSIONAL RISK METRICS (Phase 1)
    sharpeRatio: number; // Risk-adjusted return (target >1.5 for day trading)
    maxDrawdown: number; // Worst peak-to-trough decline (%)
    profitFactor: number; // Gross wins / Gross losses (target >1.3)
    expectancy: number; // Expected value per trade ($ per $1 risked)
    // ENHANCED QUANT METRICS (Phase 2)
    evScore: number; // Expected Value: Avg(Win Size) / |Avg(Loss Size)|
    adjustedWeightedAccuracy: number; // quantAccuracy × √(min(EV Score, 4)) / 2
    oppositeDirectionRate: number; // % of trades moving opposite to prediction
    oppositeDirectionCount: number; // Count of opposite direction trades
    avgWinSize: number; // Average win size (%)
    avgLossSize: number; // Average loss size (%)
  };
  segmentedWinRates: SegmentedWinRates;
  bySource: {
    source: string;
    totalIdeas: number;
    wonIdeas: number;
    lostIdeas: number;
    /** Null when the sample cannot support a rate — see reportableRate. */
    winRate: number | null;
    decided: number;
    avgPercentGain: number;
  }[];
  byAssetType: {
    assetType: string;
    totalIdeas: number;
    wonIdeas: number;
    lostIdeas: number;
    winRate: number;
    avgPercentGain: number;
  }[];
  bySignalType: {
    signal: string;
    totalIdeas: number;
    wonIdeas: number;
    lostIdeas: number;
    winRate: number;
    avgPercentGain: number;
  }[];
}

/** Options for createTradeIdea. */
export interface CreateTradeIdeaOptions {
  /**
   * When set (> 0), the spine checks for an existing idea with the same setup
   * (symbol + assetType + direction + source, plus strike/expiry/type for options)
   * created within this many hours and returns it instead of inserting a duplicate.
   * Opt-in: scanners pass their cooldown here so they no longer need their own
   * dedup maps/DB scans. Manual/user entry leaves this unset and always inserts.
   */
  dedupWindowHours?: number;
}

export interface IStorage {
  // User operations (Required for Replit Auth)
  // Reference: blueprint:javascript_log_in_with_replit
  getUser(id: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  updateUserSubscription(userId: string, subscriptionData: { stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionTier?: string; subscriptionStatus?: string; subscriptionEndsAt?: Date | null }): Promise<User | undefined>;
  
  // Market Data
  getAllMarketData(): Promise<MarketData[]>;
  getMarketDataBySymbol(symbol: string): Promise<MarketData | undefined>;
  createMarketData(data: InsertMarketData): Promise<MarketData>;
  updateMarketData(symbol: string, data: Partial<InsertMarketData>): Promise<MarketData | undefined>;

  // Trade Ideas
  getAllTradeIdeas(): Promise<TradeIdea[]>;
  getRecentTradeIdeas(hoursBack?: number, limit?: number): Promise<TradeIdea[]>;
  getTradeIdeaById(id: string): Promise<TradeIdea | undefined>;
  createTradeIdea(idea: InsertTradeIdea, opts?: CreateTradeIdeaOptions): Promise<TradeIdea>;
  updateTradeIdea(id: string, updates: Partial<TradeIdea>): Promise<TradeIdea | undefined>;
  deleteTradeIdea(id: string): Promise<boolean>;
  cleanupStaleTradeIdeas(): Promise<number>;
  findSimilarTradeIdea(symbol: string, direction: string, entryPrice: number, hoursBack?: number, assetType?: string, optionType?: string, strikePrice?: number): Promise<TradeIdea | undefined>;
  updateTradeIdeaPerformance(id: string, performance: Partial<Pick<TradeIdea, 'outcomeStatus' | 'exitPrice' | 'exitDate' | 'resolutionReason' | 'actualHoldingTimeMinutes' | 'percentGain' | 'realizedPnL' | 'validatedAt' | 'outcomeNotes' | 'predictionAccurate' | 'predictionValidatedAt' | 'highestPriceReached' | 'lowestPriceReached' | 'missedEntryTheoreticalOutcome' | 'missedEntryTheoreticalGain' | 'exitPremium' | 'optionPercentGain'>>): Promise<TradeIdea | undefined>;
  getOpenTradeIdeas(): Promise<TradeIdea[]>;
  getTradeIdeasByFilters(filters: { assetType?: string; outcomeStatus?: string; limit?: number }): Promise<TradeIdea[]>;
  getPerformanceStats(): Promise<PerformanceStats>;

  // Catalysts
  getAllCatalysts(): Promise<Catalyst[]>;
  getCatalystsBySymbol(symbol: string): Promise<Catalyst[]>;
  createCatalyst(catalyst: InsertCatalyst): Promise<Catalyst>;
  getActiveCatalysts(lookbackHours?: number, lookaheadDays?: number): Promise<Catalyst[]>;

  // Watchlist
  getAllWatchlist(): Promise<WatchlistItem[]>;
  getWatchlistItem(id: string): Promise<WatchlistItem | undefined>;
  getWatchlistByUser(userId: string): Promise<WatchlistItem[]>;
  getWatchlistByCategory(category: string): Promise<WatchlistItem[]>;
  addToWatchlist(item: InsertWatchlist): Promise<WatchlistItem>;
  updateWatchlistItem(id: string, data: Partial<WatchlistItem>): Promise<WatchlistItem | undefined>;
  removeFromWatchlist(id: string): Promise<boolean>;
  getWatchlistItemsWithPremiumTracking(): Promise<WatchlistItem[]>;
  updateWatchlistPremium(id: string, data: { lastPremium: number; lastPremiumDate: string; avgPremium: number; premiumPercentile: number }): Promise<WatchlistItem | undefined>;

  // Premium History
  getPremiumHistory(watchlistId: string, days?: number): Promise<PremiumHistoryRecord[]>;
  createPremiumSnapshot(snapshot: InsertPremiumHistory): Promise<PremiumHistoryRecord>;

  // Watchlist History (Year-long tracking)
  getWatchlistHistory(symbol: string, year?: number): Promise<WatchlistHistoryRecord[]>;
  getWatchlistHistoryByWatchlistId(watchlistId: string, days?: number): Promise<WatchlistHistoryRecord[]>;
  createWatchlistSnapshot(snapshot: InsertWatchlistHistory): Promise<WatchlistHistoryRecord>;
  getLatestWatchlistSnapshot(watchlistId: string): Promise<WatchlistHistoryRecord | undefined>;

  // Symbol Notes
  getSymbolNotes(symbol: string, userId: string): Promise<SymbolNote[]>;
  getSymbolNoteById(id: string): Promise<SymbolNote | undefined>;
  createSymbolNote(note: InsertSymbolNote): Promise<SymbolNote>;
  updateSymbolNote(id: string, updates: Partial<SymbolNote>): Promise<SymbolNote | undefined>;
  deleteSymbolNote(id: string): Promise<boolean>;

  // Whale Flows (Institutional options tracking)
  getAllWhaleFlows(days?: number): Promise<WhaleFlow[]>;
  getWhaleFlowById(id: string): Promise<WhaleFlow | undefined>;
  getWhaleFlowsBySymbol(symbol: string, days?: number): Promise<WhaleFlow[]>;
  createWhaleFlow(flow: InsertWhaleFlow): Promise<WhaleFlow>;
  updateWhaleFlowOutcome(id: string, updates: { outcomeStatus: OutcomeStatus; finalPnL?: number }): Promise<WhaleFlow | undefined>;
  getRecentWhaleFlows(limit?: number): Promise<WhaleFlow[]>;
  getMegaWhaleFlows(days?: number): Promise<WhaleFlow[]>;

  // Research History (Year-long learning tracking)
  getResearchHistory(userId: string, filters?: { symbol?: string; year?: number; action?: string; limit?: number }): Promise<ResearchHistoryRecord[]>;
  getResearchHistoryBySignal(userId: string, signalId: string): Promise<ResearchHistoryRecord | undefined>;
  createResearchHistory(record: InsertResearchHistory): Promise<ResearchHistoryRecord>;
  updateResearchHistory(id: string, updates: Partial<ResearchHistoryRecord>): Promise<ResearchHistoryRecord | undefined>;
  getUserResearchStats(userId: string, year?: number): Promise<{ total: number; traded: number; watched: number; ignored: number; winRate: number; avgReturn: number; topPatterns: { pattern: string; winRate: number; count: number }[] }>;
  getSymbolResearchHistory(userId: string, symbol: string): Promise<{ timesWatched: number; timesTraded: number; yourWinRate: number; lessonLearned: string | null; lastOutcome: string | null }>;

  // Options Data
  getOptionsBySymbol(symbol: string): Promise<OptionsData[]>;
  createOptionsData(data: InsertOptionsData): Promise<OptionsData>;

  // User Preferences
  getUserPreferences(): Promise<UserPreferences | undefined>;
  getUserPreferencesByUserId(userId: string): Promise<UserPreferences | undefined>;
  updateUserPreferences(prefs: Partial<InsertUserPreferences>): Promise<UserPreferences>;
  updateUserPreferencesByUserId(userId: string, prefs: Partial<InsertUserPreferences>): Promise<UserPreferences>;
  
  // User Page Layouts
  getUserPageLayout(userId: string, pageId: string): Promise<UserPageLayout | undefined>;
  getUserPageLayouts(userId: string): Promise<UserPageLayout[]>;
  saveUserPageLayout(layout: InsertUserPageLayout): Promise<UserPageLayout>;
  deleteUserPageLayout(userId: string, pageId: string): Promise<boolean>;
  getLayoutPresets(pageId: string): Promise<LayoutPreset[]>;

  // 🔐 Model Cards (Governance & Auditability)
  getAllModelCards(): Promise<ModelCard[]>;
  getModelCardByVersion(engineVersion: string): Promise<ModelCard | undefined>;
  createModelCard(card: InsertModelCard): Promise<ModelCard>;
  updateModelCard(engineVersion: string, updates: Partial<ModelCard>): Promise<ModelCard | undefined>;
  getActiveModelCard(): Promise<ModelCard | undefined>;

  // Futures Contracts
  getFuturesContract(contractCode: string): Promise<FuturesContract | null>;
  getFuturesContractsByRoot(rootSymbol: string): Promise<FuturesContract[]>;
  getActiveFuturesContract(rootSymbol: string): Promise<FuturesContract | null>;
  updateFuturesContract(contractCode: string, updates: Partial<FuturesContract>): Promise<FuturesContract>;

  // Futures Research Briefs
  getAllFuturesResearchBriefs(): Promise<FuturesResearchBrief[]>;
  getActiveFuturesResearchBriefs(): Promise<FuturesResearchBrief[]>;
  getFuturesResearchBriefBySymbol(symbol: string): Promise<FuturesResearchBrief | null>;
  createFuturesResearchBrief(brief: InsertFuturesResearchBrief): Promise<FuturesResearchBrief>;
  updateFuturesResearchBrief(id: string, updates: Partial<FuturesResearchBrief>): Promise<FuturesResearchBrief | null>;
  deactivateFuturesResearchBrief(id: string): Promise<boolean>;
  deactivateOldFuturesResearchBriefs(symbol: string): Promise<void>;

  // Chat Messages
  getChatHistory(): Promise<ChatMessage[]>;
  addChatMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage>;
  clearChatHistory(): Promise<void>;
  
  // Daily Usage Tracking
  getDailyUsage(userId: string, date: string): Promise<DailyUsage | null>;
  incrementDailyUsage(userId: string, field: 'ideasViewed' | 'aiChatMessages' | 'chartAnalyses'): Promise<DailyUsage>;
  
  // User-filtered Trade Ideas
  getTradeIdeasByUser(userId: string): Promise<TradeIdea[]>;
  getTradeIdeasForUser(userId: string): Promise<TradeIdea[]>; // System ideas + user's own
  
  // Active Trades (Live Position Tracking)
  getActiveTrades(userId: string): Promise<ActiveTrade[]>;
  getActiveTradeById(id: string): Promise<ActiveTrade | undefined>;
  createActiveTrade(trade: InsertActiveTrade): Promise<ActiveTrade>;
  updateActiveTrade(id: string, updates: Partial<ActiveTrade>): Promise<ActiveTrade | undefined>;
  closeActiveTrade(id: string, exitPrice: number): Promise<ActiveTrade | undefined>;
  deleteActiveTrade(id: string): Promise<boolean>;

  // Paper Trading - Portfolios
  createPaperPortfolio(portfolio: InsertPaperPortfolio): Promise<PaperPortfolio>;
  getPaperPortfoliosByUser(userId: string): Promise<PaperPortfolio[]>;
  getAllPaperPortfolios(): Promise<PaperPortfolio[]>;
  getPaperPortfolioById(id: string): Promise<PaperPortfolio | undefined>;
  updatePaperPortfolio(id: string, updates: Partial<PaperPortfolio>): Promise<PaperPortfolio | undefined>;
  deletePaperPortfolio(id: string): Promise<boolean>;

  // Paper Trading - Positions
  createPaperPosition(position: InsertPaperPosition): Promise<PaperPosition>;
  getPaperPositionsByPortfolio(portfolioId: string): Promise<PaperPosition[]>;
  getPaperPositionById(id: string): Promise<PaperPosition | undefined>;
  updatePaperPosition(id: string, updates: Partial<PaperPosition>): Promise<PaperPosition | undefined>;
  closePaperPosition(id: string, exitPrice: number, exitReason: string): Promise<PaperPosition | undefined>;

  // Paper Trading - Equity Snapshots
  createPaperEquitySnapshot(snapshot: InsertPaperEquitySnapshot): Promise<PaperEquitySnapshot>;
  getPaperEquitySnapshots(portfolioId: string, startDate?: string, endDate?: string): Promise<PaperEquitySnapshot[]>;
  
  // Paper Trading - Compliance
  getCompletedPaperTradesCount(userId: string): Promise<number>;

  // CT Ingestion
  createCTSource(source: InsertCTSource): Promise<CTSource>;
  getCTSources(): Promise<CTSource[]>;
  getCTSourceById(id: string): Promise<CTSource | undefined>;
  updateCTSource(id: string, updates: Partial<CTSource>): Promise<CTSource>;
  deleteCTSource(id: string): Promise<boolean>;
  createCTMention(mention: InsertCTMention): Promise<CTMention>;
  getCTMentions(hours?: number): Promise<CTMention[]>;
  getCTMentionsByTicker(ticker: string, hours?: number): Promise<CTMention[]>;
  getCTMentionsBySentiment(sentiment: string, hours?: number): Promise<CTMention[]>;
  getCTCallPerformance(mentionId: number): Promise<CTCallPerformance | undefined>;
  getCTCallPerformanceStats(): Promise<{ totalCalls: number; wins: number; losses: number; winRate: number }>;
  updateCTCallPerformance(mentionId: number, updates: Partial<CTCallPerformance>): Promise<CTCallPerformance>;

  // Wallet Tracker
  getTrackedWallets(userId: string): Promise<TrackedWallet[]>;
  getTrackedWalletById(id: string): Promise<TrackedWallet | undefined>;
  createTrackedWallet(wallet: InsertTrackedWallet): Promise<TrackedWallet>;
  deleteTrackedWallet(id: string): Promise<boolean>;
  updateTrackedWallet(id: string, updates: Partial<TrackedWallet>): Promise<TrackedWallet | undefined>;
  
  getWalletHoldings(walletId: string): Promise<WalletHolding[]>;
  createWalletHolding(holding: InsertWalletHolding): Promise<WalletHolding>;
  updateWalletHolding(id: string, updates: Partial<WalletHolding>): Promise<WalletHolding | undefined>;
  deleteWalletHoldings(walletId: string): Promise<boolean>;
  
  getWalletTransactions(walletId: string, limit?: number): Promise<WalletTransaction[]>;
  getWhaleActivity(userId: string, limit?: number): Promise<WalletTransaction[]>;
  createWalletTransaction(tx: InsertWalletTransaction): Promise<WalletTransaction>;
  
  getWalletAlerts(userId: string): Promise<WalletAlert[]>;
  getWalletAlertById(id: string): Promise<WalletAlert | undefined>;
  createWalletAlert(alert: InsertWalletAlert): Promise<WalletAlert>;
  deleteWalletAlert(id: string): Promise<boolean>;

  // Telemetry - Trade Input Snapshots
  saveTradeInputSnapshot(snapshot: InsertTradeInputSnapshot): Promise<TradeInputSnapshot>;
  getTradeInputSnapshot(tradeIdeaId: string): Promise<TradeInputSnapshot | null>;

  // Telemetry - Engine Daily Metrics
  saveEngineDailyMetrics(metrics: InsertEngineDailyMetrics): Promise<EngineDailyMetrics>;
  getEngineDailyMetrics(date: string, engine?: EngineSource): Promise<EngineDailyMetrics[]>;
  getEngineMetricsRange(startDate: string, endDate: string, engine?: EngineSource): Promise<EngineDailyMetrics[]>;

  // Telemetry - Engine Health Alerts
  saveEngineHealthAlert(alert: InsertEngineHealthAlert): Promise<EngineHealthAlert>;
  getActiveHealthAlerts(): Promise<EngineHealthAlert[]>;
  acknowledgeHealthAlert(id: string, userId: string): Promise<void>;

  // Trade Audit Trail - Price Snapshots
  savePriceSnapshot(snapshot: InsertTradePriceSnapshot): Promise<TradePriceSnapshot>;
  getPriceSnapshots(tradeIdeaId: string): Promise<TradePriceSnapshot[]>;
  getTradeAuditTrail(tradeIdeaId: string): Promise<{
    tradeIdea: TradeIdea | null;
    priceSnapshots: TradePriceSnapshot[];
  }>;

  // Blog Posts CMS
  getBlogPosts(status?: BlogPostStatus): Promise<BlogPost[]>;
  getBlogPostBySlug(slug: string): Promise<BlogPost | null>;
  createBlogPost(post: InsertBlogPost): Promise<BlogPost>;
  updateBlogPost(id: string, post: Partial<InsertBlogPost>): Promise<BlogPost | null>;
  deleteBlogPost(id: string): Promise<boolean>;

  // Loss Analysis - Post-Mortem for Failed Trades
  createLossAnalysis(analysis: InsertLossAnalysis): Promise<LossAnalysis>;
  getLossAnalysisByTradeId(tradeIdeaId: string): Promise<LossAnalysis | null>;
  getAllLossAnalyses(): Promise<LossAnalysis[]>;
  getLossPatterns(): Promise<{ pattern: string; count: number; avgLoss: number }[]>;

  // Auto Lotto Preferences
  getAutoLottoPreferences(userId: string): Promise<AutoLottoPreferences | null>;
  upsertAutoLottoPreferences(prefs: InsertAutoLottoPreferences): Promise<AutoLottoPreferences>;

  // Beta Waitlist
  getWaitlistEntry(email: string): Promise<BetaWaitlist | null>;
  getWaitlistEntryById(id: string): Promise<BetaWaitlist | null>;
  createWaitlistEntry(entry: InsertBetaWaitlist): Promise<BetaWaitlist>;
  markWaitlistDiscordNotified(id: string): Promise<void>;
  getWaitlistCount(): Promise<number>;
  getWaitlistPosition(id: string): Promise<number>;
  getAllWaitlistEntries(): Promise<BetaWaitlist[]>;
  updateWaitlistStatus(id: string, status: WaitlistStatus, inviteId?: string): Promise<void>;

  // Beta Invites
  createBetaInvite(invite: InsertBetaInvite): Promise<BetaInvite>;
  getBetaInviteByToken(token: string): Promise<BetaInvite | null>;
  getBetaInviteByEmail(email: string): Promise<BetaInvite | null>;
  getAllBetaInvites(): Promise<BetaInvite[]>;
  updateBetaInviteStatus(id: string, status: InviteStatus): Promise<void>;
  markBetaInviteSent(id: string): Promise<void>;
  redeemBetaInvite(token: string): Promise<BetaInvite | null>;

  // Trade Diagnostics - Loss Analysis
  createTradeDiagnostics(diagnostics: InsertTradeDiagnostics): Promise<TradeDiagnostics>;
  getTradeDiagnosticsByTradeId(tradeId: string): Promise<TradeDiagnostics | null>;
  getTradeDiagnosticsByPatternHash(patternHash: string): Promise<TradeDiagnostics[]>;
  getAllTradeDiagnostics(): Promise<TradeDiagnostics[]>;
  getRecentClosedPositions(limit: number): Promise<PaperPosition[]>;

  // Bot Learning State
  getBotLearningState(id: string): Promise<BotLearningState | null>;
  createBotLearningState(state: InsertBotLearningState): Promise<BotLearningState>;
  updateBotLearningState(id: string, updates: Partial<BotLearningState>): Promise<BotLearningState | null>;

  // Password Reset Tokens
  createPasswordResetToken(userId: string, email: string, token: string): Promise<PasswordResetToken>;
  getPasswordResetToken(token: string): Promise<PasswordResetToken | null>;
  markPasswordResetTokenUsed(id: string): Promise<void>;
  invalidateUserResetTokens(userId: string): Promise<void>;

  // User Navigation Layouts
  getUserNavigationLayout(userId: string): Promise<UserNavigationLayout | null>;
  saveUserNavigationLayout(userId: string, layout: NavigationLayoutType): Promise<UserNavigationLayout>;
  deleteUserNavigationLayout(userId: string): Promise<boolean>;

  // Personal Trade Journal
  createJournalTrade(trade: InsertJournalTrade): Promise<JournalTrade>;
  createJournalTrades(trades: InsertJournalTrade[]): Promise<JournalTrade[]>;
  getJournalTrades(userId: string, filters?: { symbol?: string; broker?: JournalBroker; status?: string; startDate?: string; endDate?: string; limit?: number }): Promise<JournalTrade[]>;
  getJournalTradeById(id: string): Promise<JournalTrade | undefined>;
  updateJournalTrade(id: string, updates: Partial<JournalTrade>): Promise<JournalTrade | undefined>;
  deleteJournalTrade(id: string): Promise<boolean>;
  deleteJournalTradesByBatch(importBatchId: string): Promise<number>;
  getJournalTradeCount(userId: string): Promise<number>;

  // GEX Snapshot History
  createGexSnapshot(snapshot: InsertGexSnapshot): Promise<GexSnapshotRecord>;
  getGexSnapshots(symbol: string, limit?: number): Promise<GexSnapshotRecord[]>;
  getGexSnapshotsByDateRange(symbol: string, startDate: Date, endDate: Date): Promise<GexSnapshotRecord[]>;
  getGexAvailableDates(symbol: string): Promise<string[]>;
  getGexAvailableSymbols(): Promise<string[]>;
}

export class MemStorage implements IStorage {
  private marketData: Map<string, MarketData>;
  private tradeIdeas: Map<string, TradeIdea>;
  private catalysts: Map<string, Catalyst>;
  private watchlist: Map<string, WatchlistItem>;
  private optionsData: Map<string, OptionsData>;
  private userPreferences: UserPreferences | null;
  private chatHistory: Map<string, ChatMessage>;
  private users: Map<string, User>;
  private futuresContracts: Map<string, FuturesContract>;
  private ctSources: Map<number, CTSource>;
  private ctMentions: Map<number, CTMention>;
  private ctCallPerformance: Map<number, CTCallPerformance>;
  private blogPosts: Map<string, BlogPost>;

  constructor() {
    this.marketData = new Map();
    this.tradeIdeas = new Map();
    this.catalysts = new Map();
    this.watchlist = new Map();
    this.optionsData = new Map();
    this.userPreferences = null;
    this.chatHistory = new Map();
    this.users = new Map();
    this.futuresContracts = new Map();
    this.ctSources = new Map();
    this.ctMentions = new Map();
    this.ctCallPerformance = new Map();
    this.blogPosts = new Map();
    this.seedData();
  }

  private seedBlogPosts() {
    const posts: BlogPost[] = [
      {
        id: "1",
        slug: "how-ai-is-revolutionizing-day-trading",
        title: "How AI is Revolutionizing Day Trading",
        excerpt: "Explore how artificial intelligence is transforming the way traders analyze markets, identify opportunities, and manage risk in real-time.",
        content: "Full content here...",
        heroImageUrl: null,
        category: "AI Trading",
        tags: ["AI", "Trading", "Tech"],
        authorName: "Quant Edge Labs Team",
        status: "published",
        publishedAt: new Date("2025-01-15"),
      },
      {
        id: "2",
        slug: "the-power-of-quantitative-trading-strategies",
        title: "The Power of Quantitative Trading Strategies",
        excerpt: "Dive deep into proven quantitative strategies like RSI(2) mean reversion and VWAP institutional flow that consistently outperform the market.",
        content: "Full content here...",
        heroImageUrl: null,
        category: "Quantitative Analysis",
        tags: ["Quant", "Strategies"],
        authorName: "Quant Edge Labs Team",
        status: "published",
        publishedAt: new Date("2025-01-10"),
      },
      {
        id: "3",
        slug: "understanding-risk-reward-ratios",
        title: "Understanding Risk-Reward Ratios",
        excerpt: "Master the fundamentals of risk management with a comprehensive guide to calculating and optimizing your risk-reward ratios.",
        content: "Full content here...",
        heroImageUrl: null,
        category: "risk-management",
        tags: ["Risk", "Basics"],
        authorName: "Quant Edge Labs Team",
        status: "published",
        publishedAt: new Date("2025-01-05"),
      },
      {
        id: "4",
        slug: "market-timing-finding-the-perfect-entry",
        title: "Market Timing: Finding the Perfect Entry",
        excerpt: "Learn how time-of-day analysis and market session patterns can significantly improve your entry timing and overall win rate.",
        content: "Full content here...",
        heroImageUrl: null,
        category: "Trading Psychology",
        tags: ["Timing", "Market"],
        authorName: "Quant Edge Labs Team",
        status: "published",
        publishedAt: new Date("2024-12-28"),
      },
      {
        id: "5",
        slug: "dual-engine-trading-combining-ai-and-quant-signals",
        title: "Dual-Engine Trading: Combining AI and Quant Signals",
        excerpt: "Discover how combining AI contextual analysis with quantitative signals creates high-conviction trading opportunities.",
        content: "Full content here...",
        heroImageUrl: null,
        category: "Platform Features",
        tags: ["AI", "Quant", "Features"],
        authorName: "Quant Edge Labs Team",
        status: "published",
        publishedAt: new Date("2024-12-20"),
      },
      {
        id: "6",
        slug: "options-trading-101",
        title: "Options Trading 101: Calls, Puts, and Delta",
        excerpt: "A beginner-friendly introduction to options trading, covering the basics of calls, puts, and how to interpret delta values.",
        content: "Full content here...",
        heroImageUrl: null,
        category: "Options Trading",
        tags: ["Options", "Beginner"],
        authorName: "Quant Edge Labs Team",
        status: "published",
        publishedAt: new Date("2024-12-15"),
      }
    ];

    posts.forEach(post => this.blogPosts.set(post.id, post));
  }

  private seedData() {
    this.seedBlogPosts();
    this.seedMarketAndTradeData();
  }

  async getBlogPosts(status?: BlogPostStatus): Promise<BlogPost[]> {
    return Array.from(this.blogPosts.values())
      .filter(post => !status || post.status === status)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  async getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
    return Array.from(this.blogPosts.values()).find(post => post.slug === slug) || null;
  }

  async createBlogPost(post: InsertBlogPost): Promise<BlogPost> {
    const id = randomUUID();
    const newPost: BlogPost = {
      ...post,
      id,
      publishedAt: new Date(),
    };
    this.blogPosts.set(id, newPost);
    return newPost;
  }

  async updateBlogPost(id: string, post: Partial<InsertBlogPost>): Promise<BlogPost | null> {
    const existing = this.blogPosts.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...post };
    this.blogPosts.set(id, updated);
    return updated;
  }

  async deleteBlogPost(id: string): Promise<boolean> {
    return this.blogPosts.delete(id);
  }

  private seedMarketAndTradeData() {
    const now = new Date().toISOString();
    
    const seedMarketData: InsertMarketData[] = [
      {
        symbol: "AAPL",
        assetType: "stock",
        currentPrice: 225.40,
        changePercent: 1.82,
        volume: 48230000,
        marketCap: 3500000000000,
        session: "rth",
        timestamp: now,
        high24h: 227.15,
        low24h: 223.80,
        high52Week: 237.50,
        low52Week: 164.08,
        avgVolume: 52000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "TSLA",
        assetType: "stock",
        currentPrice: 258.92,
        changePercent: -0.85,
        volume: 92100000,
        marketCap: 820000000000,
        session: "rth",
        timestamp: now,
        high24h: 262.40,
        low24h: 256.15,
        high52Week: 299.29,
        low52Week: 138.80,
        avgVolume: 88000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "NVDA",
        assetType: "stock",
        currentPrice: 138.75,
        changePercent: 3.24,
        volume: 38900000,
        marketCap: 3400000000000,
        session: "rth",
        timestamp: now,
        high24h: 140.20,
        low24h: 134.50,
        high52Week: 140.76,
        low52Week: 39.23,
        avgVolume: 42000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "SPY",
        assetType: "option",
        currentPrice: 575.30,
        changePercent: 0.45,
        volume: 82100000,
        session: "rth",
        timestamp: now,
        high24h: 576.85,
        low24h: 573.20,
        high52Week: 598.24,
        low52Week: 408.93,
        avgVolume: 78000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "BTC",
        assetType: "crypto",
        currentPrice: 97250.00,
        changePercent: 2.15,
        volume: 32400000000,
        marketCap: 1920000000000,
        session: "rth",
        timestamp: now,
        high24h: 98500.00,
        low24h: 95100.00,
        high52Week: 108135.00,
        low52Week: 38505.00,
        avgVolume: 28000000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "ETH",
        assetType: "crypto",
        currentPrice: 3615.80,
        changePercent: 1.67,
        volume: 18200000000,
        marketCap: 435000000000,
        session: "rth",
        timestamp: now,
        high24h: 3680.00,
        low24h: 3555.00,
        high52Week: 4878.26,
        low52Week: 1523.24,
        avgVolume: 16500000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "SNDL",
        assetType: "stock",
        currentPrice: 1.85,
        changePercent: 8.82,
        volume: 128000000,
        marketCap: 420000000,
        session: "rth",
        timestamp: now,
        high24h: 1.92,
        low24h: 1.68,
        high52Week: 3.96,
        low52Week: 1.82,
        avgVolume: 85000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "GME",
        assetType: "stock",
        currentPrice: 12.35,
        changePercent: -2.29,
        volume: 18500000,
        marketCap: 5200000000,
        session: "rth",
        timestamp: now,
        high24h: 12.80,
        low24h: 12.30,
        high52Week: 48.15,
        low52Week: 12.20,
        avgVolume: 11000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "AMC",
        assetType: "stock",
        currentPrice: 4.82,
        changePercent: 12.45,
        volume: 89500000,
        marketCap: 2100000000,
        session: "rth",
        timestamp: now,
        high24h: 4.95,
        low24h: 4.25,
        high52Week: 28.89,
        low52Week: 2.38,
        avgVolume: 35000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "BBBY",
        assetType: "stock",
        currentPrice: 0.28,
        changePercent: 35.48,
        volume: 145000000,
        marketCap: 25000000,
        session: "rth",
        timestamp: now,
        high24h: 0.32,
        low24h: 0.18,
        high52Week: 4.95,
        low52Week: 0.12,
        avgVolume: 42000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "PEPE",
        assetType: "crypto",
        currentPrice: 0.00002145,
        changePercent: 48.92,
        volume: 892000000,
        marketCap: 9020000000,
        session: "rth",
        timestamp: now,
        high24h: 0.00002389,
        low24h: 0.00001425,
        high52Week: 0.00004285,
        low52Week: 0.00000058,
        avgVolume: 285000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "SHIB",
        assetType: "crypto",
        currentPrice: 0.00003892,
        changePercent: 22.15,
        volume: 1240000000,
        marketCap: 22900000000,
        session: "rth",
        timestamp: now,
        high24h: 0.00004125,
        low24h: 0.00003105,
        high52Week: 0.00008845,
        low52Week: 0.00000558,
        avgVolume: 425000000,
        dataSource: "seed",
        lastUpdated: now,
      },
      {
        symbol: "AVAX",
        assetType: "crypto",
        currentPrice: 48.25,
        changePercent: 8.45,
        volume: 825000000,
        marketCap: 19500000000,
        session: "rth",
        timestamp: now,
        high24h: 49.85,
        low24h: 44.10,
        high52Week: 151.25,
        low52Week: 8.85,
        avgVolume: 485000000,
        dataSource: "seed",
        lastUpdated: now,
      },
    ];

    seedMarketData.forEach((data) => {
      const id = randomUUID();
      this.marketData.set(id, { ...data, id } as MarketData);
    });

    // Seed trade ideas with time windows
    // Time window helpers for seed data
    const getEntryValidUntil = (assetType: string) => {
      const minutesValid = assetType === 'crypto' ? 120 : 90;
      const validUntilDate = new Date(Date.now() + minutesValid * 60 * 1000);
      return formatInTimeZone(validUntilDate, 'America/Chicago', 'h:mm a zzz');
    };
    
    const getExitBy = (assetType: string) => {
      if (assetType === 'crypto') {
        const exitDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        return formatInTimeZone(exitDate, 'America/Chicago', 'MMM d, h:mm a zzz');
      } else {
        // Stocks: Exit by market close
        return formatInTimeZone(new Date(), 'America/Chicago', 'MMM d') + ' 4:00 PM EST';
      }
    };

    const seedTradeIdeas: InsertTradeIdea[] = [
      {
        symbol: "RENDER",
        assetType: "crypto",
        direction: "long",
        entryPrice: 4.85,
        targetPrice: 6.20,
        stopLoss: 4.30,
        riskRewardRatio: 2.45,
        catalyst: "GPU rendering network expansion, AI compute demand surge",
        analysis: "RENDER breaking out from consolidation with AI/GPU narrative gaining traction. Network utilization up 40% month-over-month as AI companies seek decentralized compute. Technical setup shows accumulation pattern with volume spike. Market cap $1.8B positions this in hidden gem range. RSI at 58 with room for upside. Potential gain: +27.8% | Risk: -11.3%",
        liquidityWarning: false,
        sessionContext: "24/7 Trading",
        timestamp: now,
        entryValidUntil: getEntryValidUntil('crypto'),
        exitBy: getExitBy('crypto'),
        source: "quant",
        confidenceScore: 78,
        qualitySignals: ['Strong R:R (2.5:1)', 'Volume Spike (2.8x)', 'Emerging Sector'],
        probabilityBand: 'B',
        outcomeStatus: 'open' as OutcomeStatus,
      },
      {
        symbol: "ONDO",
        assetType: "crypto",
        direction: "long",
        entryPrice: 0.92,
        targetPrice: 1.28,
        stopLoss: 0.82,
        riskRewardRatio: 3.60,
        catalyst: "Real-world asset tokenization trend, institutional partnerships",
        analysis: "ONDO Finance leading RWA tokenization with $500M+ in tokenized treasuries. Recent partnership announcements driving volume 4x above average. Breaking above $0.90 resistance with strong conviction. Market cap $1.3B - undervalued vs. competitors. Technical indicators aligned bullish across timeframes. Potential gain: +39.1% | Risk: -10.9%",
        liquidityWarning: false,
        sessionContext: "24/7 Trading",
        timestamp: now,
        entryValidUntil: getEntryValidUntil('crypto'),
        exitBy: getExitBy('crypto'),
        source: "quant",
        confidenceScore: 82,
        qualitySignals: ['Excellent R:R (3.6:1)', 'Institutional Flow', 'RWA Narrative'],
        probabilityBand: 'A',
        outcomeStatus: 'open' as OutcomeStatus,
      },
      {
        symbol: "JUP",
        assetType: "crypto",
        direction: "long",
        entryPrice: 0.78,
        targetPrice: 1.05,
        stopLoss: 0.68,
        riskRewardRatio: 2.70,
        catalyst: "Solana DEX dominance, Jupiter aggregator volume surge",
        analysis: "Jupiter (JUP) capturing 70%+ of Solana DEX volume as SOL ecosystem expands. Protocol revenue up 3x month-over-month. Hidden gem at $1.1B market cap with strong fundamentals. Volume spike indicating smart money accumulation. RSI bullish divergence forming at support. Multi-timeframe analysis confirms uptrend resumption. Potential gain: +34.6% | Risk: -12.8%",
        liquidityWarning: false,
        sessionContext: "24/7 Trading",
        timestamp: now,
        entryValidUntil: getEntryValidUntil('crypto'),
        exitBy: getExitBy('crypto'),
        source: "quant",
        confidenceScore: 76,
        qualitySignals: ['Strong R:R (2.7:1)', 'Revenue Growth', 'DeFi Leader'],
        probabilityBand: 'B',
        outcomeStatus: 'open' as OutcomeStatus,
      },
      {
        symbol: "PENDLE",
        assetType: "crypto",
        direction: "long",
        entryPrice: 3.42,
        targetPrice: 4.65,
        stopLoss: 3.10,
        riskRewardRatio: 3.84,
        catalyst: "Yield trading protocol innovation, DeFi TVL growth",
        analysis: "PENDLE pioneering yield tokenization with TVL growing 250% quarter-over-quarter. Undervalued at $850M market cap relative to DeFi peers. Breaking out from accumulation zone with institutional buying signals. Volume 3.2x average confirming breakout validity. MACD bullish crossover with RSI at 62. Potential gain: +36.0% | Risk: -9.4%",
        liquidityWarning: false,
        sessionContext: "24/7 Trading",
        timestamp: now,
        entryValidUntil: getEntryValidUntil('crypto'),
        exitBy: getExitBy('crypto'),
        source: "quant",
        confidenceScore: 80,
        qualitySignals: ['Excellent R:R (3.8:1)', 'TVL Expansion', 'Innovation Leader'],
        probabilityBand: 'A',
        outcomeStatus: 'open' as OutcomeStatus,
      },
    ];

    seedTradeIdeas.forEach((idea) => {
      const id = randomUUID();
      this.tradeIdeas.set(id, { ...idea, id } as TradeIdea);
    });

    // Seed catalysts
    const seedCatalysts: InsertCatalyst[] = [
      {
        symbol: "AAPL",
        title: "Apple Q4 Earnings Report Exceeds Expectations",
        description: "Apple reported Q4 revenue of $89.5B, beating analyst estimates of $85.2B. iPhone sales particularly strong in China market, up 15% YoY. Services revenue hit record high.",
        source: "Bloomberg",
        timestamp: now,
        eventType: "earnings",
        impact: "high",
      },
      {
        symbol: "TSLA",
        title: "Tesla Cybertruck Production Delays Announced",
        description: "Company announced 3-month delay in Cybertruck mass production timeline due to supply chain constraints. Management maintains full-year delivery guidance.",
        source: "Reuters",
        timestamp: now,
        eventType: "news",
        impact: "medium",
      },
      {
        symbol: "NVDA",
        title: "Major Cloud Provider Announces $10B AI Infrastructure Deal",
        description: "Leading cloud provider confirmed massive order for NVDA H100 GPUs as part of AI infrastructure expansion. Delivery expected over next 18 months.",
        source: "WSJ",
        timestamp: now,
        eventType: "news",
        impact: "high",
      },
      {
        symbol: "BTC",
        title: "Bitcoin ETF Approval Decision Expected This Week",
        description: "SEC deadline for spot Bitcoin ETF decision approaches. Market speculation building around potential approval of multiple applications.",
        source: "CoinDesk",
        timestamp: now,
        eventType: "news",
        impact: "high",
      },
    ];

    seedCatalysts.forEach((catalyst) => {
      const id = randomUUID();
      this.catalysts.set(id, { ...catalyst, id, sourceUrl: catalyst.sourceUrl ?? null } as Catalyst);
    });

    // Seed watchlist items
    const seedWatchlist: InsertWatchlist[] = [
      {
        symbol: "NVDA",
        assetType: "stock" as const,
        targetPrice: 145.00,
        notes: "Breakout above 140 with strong AI momentum",
        addedAt: now,
      },
      {
        symbol: "BTC",
        assetType: "crypto" as const,
        targetPrice: 100000,
        notes: "Watching for break above 100k psychological level",
        addedAt: now,
      },
      {
        symbol: "AAPL",
        assetType: "stock" as const,
        targetPrice: 235.00,
        notes: "iPhone sales momentum - targeting 235",
        addedAt: now,
      },
    ];

    seedWatchlist.forEach((item) => {
      const id = randomUUID();
      this.watchlist.set(id, { ...item, id } as WatchlistItem);
    });

    // Initialize default user preferences
    this.userPreferences = {
      id: randomUUID(),
      userId: "default_user",
      accountSize: 10000,
      maxRiskPerTrade: 1,
      defaultCapitalPerIdea: 1000,
      defaultOptionsBudget: 250,
      preferredAssets: ["stock", "option", "crypto"],
      holdingHorizon: "intraday",
      theme: "dark",
      timezone: "America/Chicago",
      defaultViewMode: "card",
      compactMode: false,
      discordWebhookUrl: null,
      enableTradeAlerts: true,
      enablePriceAlerts: true,
      enablePerformanceAlerts: false,
      enableWeeklyReport: false,
      defaultAssetFilter: "all",
      defaultConfidenceFilter: "all",
      autoRefreshEnabled: true,
      updatedAt: new Date(),
    };
  }

  // User Management Methods
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return undefined;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const id = userData.id || randomUUID();
    const user: User = {
      id,
      discordUserId: userData.discordUserId || null,
      discordUsername: userData.discordUsername || null,
      email: userData.email ?? `user_${id}@quantedge.local`, // Email required in schema
      passwordHash: userData.passwordHash || null,
      firstName: userData.firstName || null,
      lastName: userData.lastName || null,
      profileImageUrl: userData.profileImageUrl || null,
      subscriptionTier: (userData.subscriptionTier || 'free') as SubscriptionTier,
      subscriptionStatus: userData.subscriptionStatus || 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.users.set(id, updated);
    return updated;
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  async updateUserSubscription(userId: string, subscriptionData: any): Promise<User | undefined> {
    return this.updateUser(userId, subscriptionData);
  }

  // Market Data Methods
  async getAllMarketData(): Promise<MarketData[]> {
    return Array.from(this.marketData.values());
  }

  async getMarketDataBySymbol(symbol: string): Promise<MarketData | undefined> {
    return Array.from(this.marketData.values()).find((d) => d.symbol === symbol);
  }

  async createMarketData(data: InsertMarketData): Promise<MarketData> {
    const id = randomUUID();
    const marketData: MarketData = { ...data, id } as MarketData;
    this.marketData.set(id, marketData);
    return marketData;
  }

  async updateMarketData(symbol: string, data: Partial<InsertMarketData>): Promise<MarketData | undefined> {
    const existing = Array.from(this.marketData.values()).find((d) => d.symbol === symbol);
    if (!existing) return undefined;
    const updated = { ...existing, ...data } as MarketData;
    this.marketData.set(existing.id, updated);
    return updated;
  }

  // Trade Ideas Methods
  async getAllTradeIdeas(): Promise<TradeIdea[]> {
    return Array.from(this.tradeIdeas.values());
  }

  // MEMORY-OPTIMIZED: Get only ACTIVE/RELEVANT trade ideas
  // Filters out expired, exited, and stale trades to keep Trade Desk clean
  async getRecentTradeIdeas(hoursBack: number = 24, limit: number = 1000): Promise<TradeIdea[]> {
    const cutoffTime = Date.now() - (hoursBack * 60 * 60 * 1000);
    const now = Date.now();
    const recent: TradeIdea[] = [];

    for (const idea of this.tradeIdeas.values()) {
      const createdAt = new Date(idea.timestamp).getTime();

      // Skip if too old
      if (createdAt < cutoffTime) continue;

      // Skip if already exited/closed
      if (idea.outcomeStatus === 'won' || idea.outcomeStatus === 'lost' || idea.outcomeStatus === 'closed') {
        continue;
      }

      // Skip if expired (for options)
      if (idea.expiryDate) {
        const expiryTime = new Date(idea.expiryDate).getTime();
        if (expiryTime < now) continue; // Expired
      }

      recent.push(idea);

      // Stop if we hit the limit (prevent loading everything)
      if (recent.length >= limit) break;
    }

    return recent.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // AUTO-CLEANUP: Remove stale trades to free memory AND update database
  async cleanupStaleTradeIdeas(): Promise<number> {
    // RETENTION: archive, never delete.
    //
    // This was 7 days, hard delete. A platform cannot demonstrate an edge while
    // erasing its own outcomes every week — it caps the observable sample at
    // whatever closed in the last seven days, which is why the whole track record
    // began on 2026-08-18 and why no source has enough decided trades to clear a
    // significance bar. Closed trades ARE the product's evidence; they are the
    // cheapest rows in the table and the only ones that answer "does this work".
    //
    // Size was the original concern. That is a read-side problem: exclude
    // archived rows where payload matters, and keep the history.
    const RETENTION_DAYS = 365; // archive after a year; never delete
    const STALE_HOURS = 48; // Expire open trades older than 48 hours (was 72)
    const cutoffClosed = new Date();
    cutoffClosed.setDate(cutoffClosed.getDate() - RETENTION_DAYS);
    const cutoffStale = new Date();
    cutoffStale.setHours(cutoffStale.getHours() - STALE_HOURS);

    let expiredCount = 0;
    let deletedCount = 0;

    // CRITICAL FIX: Update database to mark stale open trades as expired
    try {
      const result = await db
        .update(tradeIdeas)
        .set({ outcomeStatus: 'expired' })
        .where(drizzleSql`${tradeIdeas.outcomeStatus} = 'open' AND ${tradeIdeas.timestamp} < ${cutoffStale.toISOString()}`)
        .returning({ id: tradeIdeas.id });

      expiredCount = result.length;

      // Update in-memory cache to match database
      for (const { id } of result) {
        const cached = this.tradeIdeas.get(id);
        if (cached) {
          cached.outcomeStatus = 'expired';
        }
      }
    } catch (err) {
      logger.error('[CLEANUP] Failed to expire stale trades in database:', err);
    }

    // Delete old closed/won/lost/expired trades from database
    try {
      const result = await db
        .update(tradeIdeas)
        .set({ archived: true })
        .where(drizzleSql`${tradeIdeas.outcomeStatus} IN ('won', 'lost', 'closed', 'expired') AND ${tradeIdeas.timestamp} < ${cutoffClosed.toISOString()} AND ${tradeIdeas.archived} = false`)
        .returning({ id: tradeIdeas.id });

      deletedCount = result.length;

      // Remove from in-memory cache
      for (const { id } of result) {
        this.tradeIdeas.delete(id);
      }
    } catch (err) {
      logger.error('[CLEANUP] Failed to delete old trades from database:', err);
    }

    // Archive rather than delete — see the twin of this block in DatabaseStorage.
    // An expired contract is a COMPLETED trade with a known outcome, which makes
    // it the single most valuable row in the table for measuring whether the
    // platform works. Deleting it on expiry destroys the track record on a
    // rolling basis.
    try {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const result = await db
        .update(tradeIdeas)
        .set({ archived: true })
        .where(drizzleSql`${tradeIdeas.expiryDate} IS NOT NULL AND ${tradeIdeas.expiryDate} < ${oneDayAgo.toISOString()} AND ${tradeIdeas.archived} = false`)
        .returning({ id: tradeIdeas.id });

      for (const { id } of result) {
        const existing = this.tradeIdeas.get(id);
        if (existing) this.tradeIdeas.set(id, { ...existing, archived: true } as any);
      }
      if (result.length > 0) {
        logger.info(`[CLEANUP] Archived ${result.length} expired-contract idea(s) — retained for performance history`);
      }
    } catch (err) {
      logger.error('[CLEANUP] Failed to archive expired options:', err);
    }

    const totalAffected = expiredCount + deletedCount;
    if (totalAffected > 0) {
      logger.info(`[CLEANUP] Expired ${expiredCount} stale trades, deleted ${deletedCount} old trades from database`);
    }

    return totalAffected;
  }

  async getTradeIdeaById(id: string): Promise<TradeIdea | undefined> {
    return this.tradeIdeas.get(id);
  }

  async createTradeIdea(idea: InsertTradeIdea, _opts?: CreateTradeIdeaOptions): Promise<TradeIdea> {
    const id = randomUUID();
    // GLOBAL CAP: No trade idea should have confidence > 94% (reflects market uncertainty)
    const cappedConfidence = idea.confidenceScore
      ? Math.min(94, Math.max(0, idea.confidenceScore))
      : idea.confidenceScore;
    const tradeIdea: TradeIdea = {
      ...idea,
      id,
      confidenceScore: cappedConfidence,
      outcomeStatus: 'open'
    } as TradeIdea;
    this.tradeIdeas.set(id, tradeIdea);
    return tradeIdea;
  }

  async updateTradeIdea(id: string, updates: Partial<TradeIdea>): Promise<TradeIdea | undefined> {
    const existing = this.tradeIdeas.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.tradeIdeas.set(id, updated);
    return updated;
  }

  async deleteTradeIdea(id: string): Promise<boolean> {
    return this.tradeIdeas.delete(id);
  }

  async findSimilarTradeIdea(symbol: string, direction: string, entryPrice: number, hoursBack: number = 24, assetType?: string, optionType?: string, strikePrice?: number): Promise<TradeIdea | undefined> {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
    
    const priceThreshold = 0.02; // 2% price difference threshold
    
    return Array.from(this.tradeIdeas.values()).find(idea => {
      const ideaTime = new Date(idea.timestamp);
      const priceDiff = Math.abs(idea.entryPrice - entryPrice) / entryPrice;
      
      // Base conditions - check ALL ideas regardless of status
      // This prevents duplicate ideas even if earlier ones were marked expired/closed
      let matches = (
        idea.symbol === symbol &&
        idea.direction === direction &&
        priceDiff <= priceThreshold &&
        ideaTime >= cutoffTime
        // REMOVED: outcomeStatus check - prevent ALL duplicates
      );
      
      // Add asset type check if provided
      if (matches && assetType) {
        matches = matches && idea.assetType === assetType;
      }
      
      // Add option type check if provided
      if (matches && optionType) {
        matches = matches && idea.optionType === optionType;
      }
      
      // Add strike price check for options (within $1)
      if (matches && assetType === 'option' && strikePrice !== undefined && strikePrice !== null) {
        matches = matches && 
          idea.strikePrice !== null && 
          idea.strikePrice !== undefined &&
          Math.abs(idea.strikePrice - strikePrice) <= 1;
      }
      
      return matches;
    });
  }

  async updateTradeIdeaPerformance(id: string, performance: Partial<Pick<TradeIdea, 'outcomeStatus' | 'exitPrice' | 'exitDate' | 'resolutionReason' | 'actualHoldingTimeMinutes' | 'percentGain' | 'realizedPnL' | 'validatedAt' | 'outcomeNotes' | 'predictionAccurate' | 'predictionValidatedAt' | 'highestPriceReached' | 'lowestPriceReached' | 'missedEntryTheoreticalOutcome' | 'missedEntryTheoreticalGain' | 'exitPremium' | 'optionPercentGain'>>): Promise<TradeIdea | undefined> {
    const existing = this.tradeIdeas.get(id);
    if (!existing) return undefined;
    
    // Calculate actualHoldingTimeMinutes if not provided or is 0
    let holdingTimeMinutes: number | null = performance.actualHoldingTimeMinutes ?? null;
    if (performance.exitDate && (!holdingTimeMinutes || holdingTimeMinutes === 0)) {
      const createdAt = new Date(existing.timestamp);
      const exitedAt = new Date(performance.exitDate);
      const diffMs = exitedAt.getTime() - createdAt.getTime();
      holdingTimeMinutes = Math.floor(diffMs / (1000 * 60));
    }
    
    const updated = { 
      ...existing, 
      ...performance,
      actualHoldingTimeMinutes: holdingTimeMinutes
    };
    this.tradeIdeas.set(id, updated);
    
    return updated;
  }

  async getOpenTradeIdeas(): Promise<TradeIdea[]> {
    return Array.from(this.tradeIdeas.values()).filter(
      (idea) => idea.outcomeStatus === 'open'
    );
  }

  async getTradeIdeasByFilters(filters: { assetType?: string; outcomeStatus?: string; limit?: number }): Promise<TradeIdea[]> {
    let results = Array.from(this.tradeIdeas.values());

    if (filters.assetType) {
      results = results.filter(idea => idea.assetType === filters.assetType);
    }

    if (filters.outcomeStatus) {
      results = results.filter(idea => idea.outcomeStatus === filters.outcomeStatus);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  async getPerformanceStats(filters?: {
    startDate?: string;
    endDate?: string;
    source?: string;
    includeAllVersions?: boolean;
  }): Promise<PerformanceStats> {
    let allIdeas = Array.from(this.tradeIdeas.values());
    
    // Audit: Ensure only non-excluded trades are used for performance
    allIdeas = allIdeas.filter(idea => !idea.excludeFromTraining);
    
    // Audit: Date filtering logic (Audit for UTC vs Local time consistency)
    if (filters?.startDate || filters?.endDate) {
      allIdeas = allIdeas.filter(idea => {
        const ideaDateStr = idea.timestamp.split('T')[0];
        if (filters.startDate && ideaDateStr < filters.startDate) return false;
        if (filters.endDate && ideaDateStr > filters.endDate) return false;
        return true;
      });
    }

    const closedIdeas = allIdeas.filter((idea) => idea.outcomeStatus !== 'open');
    const wonIdeas = closedIdeas.filter((idea) => idea.outcomeStatus === 'hit_target');
    
    // A touched stop is a loss, full stop. The shared isRealLoss already says
    // so — this local re-implementation kept applying a 3% P&L floor that the
    // barrier layer had already removed, so a 1.2%-stop band's stop-outs
    // vanished from the stats while its wins counted in full.
    const lostIdeas = closedIdeas.filter((idea) => isRealLoss(idea));
    
    const decidedIdeas = wonIdeas.length + lostIdeas.length;
    // Same floor as DatabaseStorage — the in-memory path must not report a rate
    // the real one would suppress, or dev and prod disagree about what is knowable.
    const winRate = reportableRate(wonIdeas.length, decidedIdeas);

    // Enhanced Audit: Average Profit vs Average Loss (Risk/Reward)
    const avgWin = wonIdeas.length > 0 ? wonIdeas.reduce((s, i) => s + (i.percentGain || 0), 0) / wonIdeas.length : 0;
    const avgLoss = lostIdeas.length > 0 ? lostIdeas.reduce((s, i) => s + (i.percentGain || 0), 0) / lostIdeas.length : 0;

    return {
      overall: {
        totalIdeas: allIdeas.length,
        openIdeas: allIdeas.filter(i => i.outcomeStatus === 'open').length,
        closedIdeas: closedIdeas.length,
        wonIdeas: wonIdeas.length,
        lostIdeas: lostIdeas.length,
        expiredIdeas: closedIdeas.filter(i => i.outcomeStatus === 'expired').length,
        winRate,
        winRateDecided: decidedIdeas,
        quantAccuracy: 0,
        directionalAccuracy: 0,
        avgPercentGain: closedIdeas.length > 0 ? closedIdeas.reduce((s, i) => s + (i.percentGain || 0), 0) / closedIdeas.length : 0,
        avgHoldingTimeMinutes: 0, 
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        expectancy: 0,
        evScore: avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0,
        adjustedWeightedAccuracy: 0,
        oppositeDirectionRate: 0,
        oppositeDirectionCount: 0,
        avgWinSize: avgWin,
        avgLossSize: Math.abs(avgLoss),
      },
      segmentedWinRates: {
        equities: { winRate, wins: wonIdeas.length, losses: lostIdeas.length, decided: decidedIdeas },
        options: { winRate: 0, wins: 0, losses: 0, decided: 0 },
        overall: { winRate, wins: wonIdeas.length, losses: lostIdeas.length, decided: decidedIdeas },
      },
      bySource,
      byAssetType,
      bySignalType,
    };
  }


  // Catalyst Methods
  async getAllCatalysts(): Promise<Catalyst[]> {
    return Array.from(this.catalysts.values());
  }

  /** In-memory mirror of the DB accessor — same window, no query. */
  async getActiveCatalysts(lookbackHours = 72, lookaheadDays = 14): Promise<Catalyst[]> {
    const now = Date.now();
    const from = now - lookbackHours * 3600_000;
    const to = now + lookaheadDays * 86_400_000;
    return Array.from(this.catalysts.values())
      .filter((c) => {
        const t = Date.parse(c.timestamp);
        return Number.isFinite(t) && t >= from && t <= to;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async getCatalystsBySymbol(symbol: string): Promise<Catalyst[]> {
    return Array.from(this.catalysts.values()).filter((c) => c.symbol === symbol);
  }

  async createCatalyst(catalyst: InsertCatalyst): Promise<Catalyst> {
    const id = randomUUID();
    const newCatalyst: Catalyst = { ...catalyst, id, sourceUrl: catalyst.sourceUrl ?? null };
    this.catalysts.set(id, newCatalyst);
    return newCatalyst;
  }

  // Watchlist Methods
  async getAllWatchlist(): Promise<WatchlistItem[]> {
    return Array.from(this.watchlist.values());
  }

  async getWatchlistItem(id: string): Promise<WatchlistItem | undefined> {
    return this.watchlist.get(id);
  }

  async getWatchlistByUser(userId: string): Promise<WatchlistItem[]> {
    return Array.from(this.watchlist.values()).filter(item => item.userId === userId);
  }

  async getWatchlistByCategory(category: string): Promise<WatchlistItem[]> {
    return Array.from(this.watchlist.values()).filter(item => item.category === category);
  }

  async addToWatchlist(item: InsertWatchlist): Promise<WatchlistItem> {
    const id = randomUUID();
    const watchlistItem: WatchlistItem = { ...item, id } as WatchlistItem;
    this.watchlist.set(id, watchlistItem);
    return watchlistItem;
  }

  async updateWatchlistItem(id: string, data: Partial<WatchlistItem>): Promise<WatchlistItem | undefined> {
    const existing = this.watchlist.get(id);
    if (!existing) {
      return undefined;
    }
    const updated = { ...existing, ...data, id };
    this.watchlist.set(id, updated);
    return updated;
  }

  async removeFromWatchlist(id: string): Promise<boolean> {
    return this.watchlist.delete(id);
  }

  async getWatchlistItemsWithPremiumTracking(): Promise<WatchlistItem[]> {
    return Array.from(this.watchlist.values()).filter(item => item.trackPremiums);
  }

  async updateWatchlistPremium(id: string, data: { lastPremium: number; lastPremiumDate: string; avgPremium: number; premiumPercentile: number }): Promise<WatchlistItem | undefined> {
    const item = this.watchlist.get(id);
    if (!item) return undefined;
    const updated = { ...item, ...data };
    this.watchlist.set(id, updated);
    return updated;
  }

  // Premium History Methods (in-memory stub)
  private premiumHistoryStore: Map<string, PremiumHistoryRecord[]> = new Map();

  async getPremiumHistory(watchlistId: string, days: number = 90): Promise<PremiumHistoryRecord[]> {
    return this.premiumHistoryStore.get(watchlistId) || [];
  }

  async createPremiumSnapshot(snapshot: InsertPremiumHistory): Promise<PremiumHistoryRecord> {
    const record: PremiumHistoryRecord = { 
      id: randomUUID(),
      watchlistId: snapshot.watchlistId,
      symbol: snapshot.symbol,
      optionType: snapshot.optionType,
      strikePrice: snapshot.strikePrice,
      expirationDate: snapshot.expirationDate,
      premium: snapshot.premium,
      underlyingPrice: snapshot.underlyingPrice ?? null,
      impliedVolatility: snapshot.impliedVolatility ?? null,
      delta: snapshot.delta ?? null,
      snapshotDate: snapshot.snapshotDate,
      snapshotTime: snapshot.snapshotTime ?? null,
      premiumChange: snapshot.premiumChange ?? null,
      premiumChangeDollar: snapshot.premiumChangeDollar ?? null,
      avgPremium30d: snapshot.avgPremium30d ?? null,
      percentileRank: snapshot.percentileRank ?? null,
    };
    const existing = this.premiumHistoryStore.get(snapshot.watchlistId) || [];
    existing.unshift(record);
    this.premiumHistoryStore.set(snapshot.watchlistId, existing.slice(0, 365)); // Keep 1 year
    return record;
  }

  // Watchlist History Methods (in-memory stub for year-long tracking)
  private watchlistHistoryStore: Map<string, WatchlistHistoryRecord[]> = new Map();

  async getWatchlistHistory(symbol: string, year?: number): Promise<WatchlistHistoryRecord[]> {
    const all: WatchlistHistoryRecord[] = [];
    Array.from(this.watchlistHistoryStore.values()).forEach(records => {
      all.push(...records.filter((r: WatchlistHistoryRecord) => r.symbol === symbol && (!year || r.year === year)));
    });
    return all.sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
  }

  async getWatchlistHistoryByWatchlistId(watchlistId: string, days: number = 365): Promise<WatchlistHistoryRecord[]> {
    return this.watchlistHistoryStore.get(watchlistId) || [];
  }

  async createWatchlistSnapshot(snapshot: InsertWatchlistHistory): Promise<WatchlistHistoryRecord> {
    const record: WatchlistHistoryRecord = {
      id: randomUUID(),
      ...snapshot,
      createdAt: new Date(),
    };
    const existing = this.watchlistHistoryStore.get(snapshot.watchlistId) || [];
    existing.unshift(record);
    this.watchlistHistoryStore.set(snapshot.watchlistId, existing.slice(0, 365));
    return record;
  }

  async getLatestWatchlistSnapshot(watchlistId: string): Promise<WatchlistHistoryRecord | undefined> {
    const records = this.watchlistHistoryStore.get(watchlistId) || [];
    return records[0];
  }

  // Symbol Notes Methods (in-memory stub)
  private symbolNotesStore: Map<string, SymbolNote[]> = new Map();

  async getSymbolNotes(symbol: string, userId: string): Promise<SymbolNote[]> {
    const all: SymbolNote[] = [];
    Array.from(this.symbolNotesStore.values()).forEach(notes => {
      all.push(...notes.filter((n: SymbolNote) => n.symbol === symbol && n.userId === userId));
    });
    return all.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getSymbolNoteById(id: string): Promise<SymbolNote | undefined> {
    for (const notes of Array.from(this.symbolNotesStore.values())) {
      const found = notes.find((n: SymbolNote) => n.id === id);
      if (found) return found;
    }
    return undefined;
  }

  async createSymbolNote(note: InsertSymbolNote): Promise<SymbolNote> {
    const record: SymbolNote = {
      id: randomUUID(),
      ...note,
      tags: note.tags || null,
      noteType: note.noteType || 'user',
      isPrivate: note.isPrivate ?? true,
      linkedEventType: note.linkedEventType || null,
      linkedEventId: note.linkedEventId || null,
      watchlistId: note.watchlistId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const key = `${note.userId}-${note.symbol}`;
    const existing = this.symbolNotesStore.get(key) || [];
    existing.unshift(record);
    this.symbolNotesStore.set(key, existing);
    return record;
  }

  async updateSymbolNote(id: string, updates: Partial<SymbolNote>): Promise<SymbolNote | undefined> {
    for (const [key, notes] of Array.from(this.symbolNotesStore.entries())) {
      const index = notes.findIndex((n: SymbolNote) => n.id === id);
      if (index !== -1) {
        notes[index] = { ...notes[index], ...updates, updatedAt: new Date() };
        return notes[index];
      }
    }
    return undefined;
  }

  async deleteSymbolNote(id: string): Promise<boolean> {
    for (const [key, notes] of Array.from(this.symbolNotesStore.entries())) {
      const index = notes.findIndex((n: SymbolNote) => n.id === id);
      if (index !== -1) {
        notes.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  // Research History Methods (MemStorage stub)
  private researchHistoryStore: ResearchHistoryRecord[] = [];

  async getResearchHistory(userId: string, filters?: { symbol?: string; year?: number; action?: string; limit?: number }): Promise<ResearchHistoryRecord[]> {
    let results = this.researchHistoryStore.filter(r => r.userId === userId);
    if (filters?.symbol) results = results.filter(r => r.symbol === filters.symbol);
    if (filters?.action) results = results.filter(r => r.actionTaken === filters.action);
    if (filters?.year) results = results.filter(r => r.viewedAt && new Date(r.viewedAt).getFullYear() === filters.year);
    results.sort((a, b) => (b.viewedAt?.getTime() || 0) - (a.viewedAt?.getTime() || 0));
    if (filters?.limit) results = results.slice(0, filters.limit);
    return results;
  }

  async getResearchHistoryBySignal(userId: string, signalId: string): Promise<ResearchHistoryRecord | undefined> {
    return this.researchHistoryStore.find(r => r.userId === userId && r.signalId === signalId);
  }

  async createResearchHistory(record: InsertResearchHistory): Promise<ResearchHistoryRecord> {
    const newRecord: ResearchHistoryRecord = {
      id: randomUUID(),
      ...record,
      signalId: record.signalId || null,
      signalGrade: record.signalGrade || null,
      signalConfidence: record.signalConfidence || null,
      signalDirection: record.signalDirection || null,
      signalEngine: record.signalEngine || null,
      signalPrice: record.signalPrice || null,
      technicalSnapshot: record.technicalSnapshot || null,
      marketRegime: record.marketRegime || null,
      outcome: record.outcome || null,
      outcomeReturn: record.outcomeReturn || null,
      outcomePnL: record.outcomePnL || null,
      outcomeUpdatedAt: record.outcomeUpdatedAt || null,
      decisionNotes: record.decisionNotes || null,
      lessonLearned: record.lessonLearned || null,
      signalPatterns: record.signalPatterns || null,
      viewedAt: record.viewedAt || new Date(),
      decidedAt: record.decidedAt || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.researchHistoryStore.push(newRecord);
    return newRecord;
  }

  async updateResearchHistory(id: string, updates: Partial<ResearchHistoryRecord>): Promise<ResearchHistoryRecord | undefined> {
    const index = this.researchHistoryStore.findIndex(r => r.id === id);
    if (index !== -1) {
      this.researchHistoryStore[index] = { ...this.researchHistoryStore[index], ...updates, updatedAt: new Date() };
      return this.researchHistoryStore[index];
    }
    return undefined;
  }

  async getUserResearchStats(userId: string, year?: number): Promise<{ total: number; traded: number; watched: number; ignored: number; winRate: number; avgReturn: number; topPatterns: { pattern: string; winRate: number; count: number }[] }> {
    const history = await this.getResearchHistory(userId, { year });
    const traded = history.filter(h => h.actionTaken === 'traded');
    const wins = traded.filter(t => t.outcome === 'hit_target').length;
    const losses = traded.filter(t => t.outcome === 'hit_stop').length;
    return {
      total: history.length,
      traded: traded.length,
      watched: history.filter(h => h.actionTaken === 'watched').length,
      ignored: history.filter(h => h.actionTaken === 'ignored').length,
      winRate: traded.length > 0 ? (wins / (wins + losses)) * 100 : 0,
      avgReturn: traded.length > 0 ? traded.reduce((sum, t) => sum + (t.outcomeReturn || 0), 0) / traded.length : 0,
      topPatterns: [],
    };
  }

  async getSymbolResearchHistory(userId: string, symbol: string): Promise<{ timesWatched: number; timesTraded: number; yourWinRate: number; lessonLearned: string | null; lastOutcome: string | null }> {
    const history = await this.getResearchHistory(userId, { symbol });
    const traded = history.filter(h => h.actionTaken === 'traded');
    const wins = traded.filter(t => t.outcome === 'hit_target').length;
    const losses = traded.filter(t => t.outcome === 'hit_stop').length;
    const lastTrade = traded[0];
    return {
      timesWatched: history.filter(h => h.actionTaken === 'watched').length,
      timesTraded: traded.length,
      yourWinRate: traded.length > 0 ? (wins / (wins + losses)) * 100 : 0,
      lessonLearned: lastTrade?.lessonLearned || null,
      lastOutcome: lastTrade?.outcome || null,
    };
  }

  // Options Data Methods
  async getOptionsBySymbol(symbol: string): Promise<OptionsData[]> {
    return Array.from(this.optionsData.values()).filter((o) => o.symbol === symbol);
  }

  async createOptionsData(data: InsertOptionsData): Promise<OptionsData> {
    const id = randomUUID();
    const optionsData: OptionsData = { ...data, id } as OptionsData;
    this.optionsData.set(id, optionsData);
    return optionsData;
  }

  // User Preferences Methods
  async getUserPreferences(): Promise<UserPreferences | undefined> {
    return this.userPreferences || undefined;
  }

  async updateUserPreferences(prefs: Partial<InsertUserPreferences>): Promise<UserPreferences> {
    if (!this.userPreferences) {
      const id = randomUUID();
      this.userPreferences = {
        id,
        userId: "default_user",
        accountSize: 10000,
        maxRiskPerTrade: 1,
        defaultCapitalPerIdea: 1000,
        defaultOptionsBudget: 250,
        preferredAssets: ["stock", "option", "crypto"],
        holdingHorizon: "intraday",
        theme: "dark",
        timezone: "America/Chicago",
        defaultViewMode: "card",
        compactMode: false,
        discordWebhookUrl: null,
        enableTradeAlerts: true,
        enablePriceAlerts: true,
        enablePerformanceAlerts: false,
        enableWeeklyReport: false,
        defaultAssetFilter: "all",
        defaultConfidenceFilter: "all",
        autoRefreshEnabled: true,
        updatedAt: new Date(),
        ...prefs,
      };
    } else {
      this.userPreferences = { ...this.userPreferences, ...prefs };
    }
    return this.userPreferences;
  }

  async getUserPreferencesByUserId(userId: string): Promise<UserPreferences | undefined> {
    if (this.userPreferences?.userId === userId) {
      return this.userPreferences;
    }
    return undefined;
  }

  async updateUserPreferencesByUserId(userId: string, prefs: Partial<InsertUserPreferences>): Promise<UserPreferences> {
    return this.updateUserPreferences({ ...prefs, userId });
  }

  // User Page Layouts (MemStorage stub)
  private pageLayouts: Map<string, UserPageLayout> = new Map();
  private presets: Map<string, LayoutPreset> = new Map();

  async getUserPageLayout(userId: string, pageId: string): Promise<UserPageLayout | undefined> {
    return this.pageLayouts.get(`${userId}:${pageId}`);
  }

  async getUserPageLayouts(userId: string): Promise<UserPageLayout[]> {
    return Array.from(this.pageLayouts.values()).filter(l => l.userId === userId);
  }

  async saveUserPageLayout(layout: InsertUserPageLayout): Promise<UserPageLayout> {
    const key = `${layout.userId}:${layout.pageId}`;
    const existing = this.pageLayouts.get(key);
    const saved: UserPageLayout = {
      id: existing?.id || randomUUID(),
      ...layout,
      layoutName: layout.layoutName || 'default',
      widgets: layout.widgets || [],
      columns: layout.columns || 12,
      rowHeight: layout.rowHeight || 60,
      panelSizes: layout.panelSizes || null,
      isDefault: layout.isDefault || false,
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    this.pageLayouts.set(key, saved);
    return saved;
  }

  async deleteUserPageLayout(userId: string, pageId: string): Promise<boolean> {
    return this.pageLayouts.delete(`${userId}:${pageId}`);
  }

  async getLayoutPresets(pageId: string): Promise<LayoutPreset[]> {
    return Array.from(this.presets.values()).filter(p => p.pageId === pageId);
  }

  // Chat History Methods
  async getChatHistory(): Promise<ChatMessage[]> {
    return Array.from(this.chatHistory.values()).sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async addChatMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const chatMessage: ChatMessage = { ...message, id, timestamp };
    this.chatHistory.set(id, chatMessage);
    return chatMessage;
  }

  async clearChatHistory(): Promise<void> {
    this.chatHistory.clear();
  }

  // Futures Contracts Methods
  async getFuturesContract(contractCode: string): Promise<FuturesContract | null> {
    return this.futuresContracts.get(contractCode) || null;
  }

  async getFuturesContractsByRoot(rootSymbol: string): Promise<FuturesContract[]> {
    return Array.from(this.futuresContracts.values()).filter(
      contract => contract.rootSymbol === rootSymbol
    );
  }

  async getActiveFuturesContract(rootSymbol: string): Promise<FuturesContract | null> {
    const contracts = await this.getFuturesContractsByRoot(rootSymbol);
    return contracts.find(contract => contract.isFrontMonth) || null;
  }

  async updateFuturesContract(contractCode: string, updates: Partial<FuturesContract>): Promise<FuturesContract> {
    const contract = this.futuresContracts.get(contractCode);
    if (!contract) {
      throw new Error(`Futures contract not found: ${contractCode}`);
    }
    const updated = { ...contract, ...updates };
    this.futuresContracts.set(contractCode, updated);
    return updated;
  }

  // Futures Research Briefs (stub - not persisted in MemStorage)
  async getAllFuturesResearchBriefs(): Promise<FuturesResearchBrief[]> {
    return [];
  }

  async getActiveFuturesResearchBriefs(): Promise<FuturesResearchBrief[]> {
    return [];
  }

  async getFuturesResearchBriefBySymbol(_symbol: string): Promise<FuturesResearchBrief | null> {
    return null;
  }

  async createFuturesResearchBrief(_brief: InsertFuturesResearchBrief): Promise<FuturesResearchBrief> {
    throw new Error("Futures Research Briefs not supported in MemStorage");
  }

  async updateFuturesResearchBrief(_id: string, _updates: Partial<FuturesResearchBrief>): Promise<FuturesResearchBrief | null> {
    return null;
  }

  async deactivateFuturesResearchBrief(_id: string): Promise<boolean> {
    return false;
  }

  async deactivateOldFuturesResearchBriefs(_symbol: string): Promise<void> {
    // No-op in MemStorage
  }

  // 🔐 Model Cards Methods (Stub - not persisted in MemStorage)
  async getAllModelCards(): Promise<ModelCard[]> {
    return [];
  }

  async getModelCardByVersion(_engineVersion: string): Promise<ModelCard | undefined> {
    return undefined;
  }

  async createModelCard(_card: InsertModelCard): Promise<ModelCard> {
    throw new Error("Model Cards not supported in MemStorage");
  }

  async updateModelCard(_engineVersion: string, _updates: Partial<ModelCard>): Promise<ModelCard | undefined> {
    return undefined;
  }

  async getActiveModelCard(): Promise<ModelCard | undefined> {
    return undefined;
  }

  // Daily Usage Tracking (stub - not persisted in MemStorage)
  async getDailyUsage(_userId: string, _date: string): Promise<DailyUsage | null> {
    return null;
  }

  async incrementDailyUsage(_userId: string, _field: 'ideasViewed' | 'aiChatMessages' | 'chartAnalyses'): Promise<DailyUsage> {
    throw new Error("Daily Usage not supported in MemStorage");
  }

  // User-filtered Trade Ideas (stub)
  async getTradeIdeasByUser(_userId: string): Promise<TradeIdea[]> {
    return Array.from(this.tradeIdeas.values());
  }

  async getTradeIdeasForUser(_userId: string): Promise<TradeIdea[]> {
    // In MemStorage, filter to recent and active trades only
    const now = Date.now();
    const cutoffTime = now - (24 * 60 * 60 * 1000); // Last 24 hours

    return Array.from(this.tradeIdeas.values())
      .filter(idea => {
        const createdAt = new Date(idea.timestamp).getTime();

        // Only recent trades
        if (createdAt < cutoffTime) return false;

        // Skip closed trades
        if (idea.outcomeStatus === 'won' || idea.outcomeStatus === 'lost' || idea.outcomeStatus === 'closed') {
          return false;
        }

        // Skip expired options
        if (idea.expiryDate) {
          const expiryTime = new Date(idea.expiryDate).getTime();
          if (expiryTime < now) return false;
        }

        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 1000); // Safety limit
  }

  // Active Trades (stub - not persisted in MemStorage)
  async getActiveTrades(_userId: string): Promise<ActiveTrade[]> {
    return [];
  }

  async getActiveTradeById(_id: string): Promise<ActiveTrade | undefined> {
    return undefined;
  }

  async createActiveTrade(_trade: InsertActiveTrade): Promise<ActiveTrade> {
    throw new Error("Active Trades not supported in MemStorage");
  }

  async updateActiveTrade(_id: string, _updates: Partial<ActiveTrade>): Promise<ActiveTrade | undefined> {
    return undefined;
  }

  async closeActiveTrade(_id: string, _exitPrice: number): Promise<ActiveTrade | undefined> {
    return undefined;
  }

  async deleteActiveTrade(_id: string): Promise<boolean> {
    return false;
  }

  // Paper Trading - Portfolios (stub - not persisted in MemStorage)
  async createPaperPortfolio(_portfolio: InsertPaperPortfolio): Promise<PaperPortfolio> {
    throw new Error("Paper Trading not supported in MemStorage");
  }

  async getPaperPortfoliosByUser(_userId: string): Promise<PaperPortfolio[]> {
    return [];
  }

  async getAllPaperPortfolios(): Promise<PaperPortfolio[]> {
    return [];
  }

  async getPaperPortfolioById(_id: string): Promise<PaperPortfolio | undefined> {
    return undefined;
  }

  async updatePaperPortfolio(_id: string, _updates: Partial<PaperPortfolio>): Promise<PaperPortfolio | undefined> {
    return undefined;
  }

  async deletePaperPortfolio(_id: string): Promise<boolean> {
    return false;
  }

  // Paper Trading - Positions (stub)
  async createPaperPosition(_position: InsertPaperPosition): Promise<PaperPosition> {
    throw new Error("Paper Trading not supported in MemStorage");
  }

  async getPaperPositionsByPortfolio(_portfolioId: string): Promise<PaperPosition[]> {
    return [];
  }

  async getPaperPositionById(_id: string): Promise<PaperPosition | undefined> {
    return undefined;
  }

  async updatePaperPosition(_id: string, _updates: Partial<PaperPosition>): Promise<PaperPosition | undefined> {
    return undefined;
  }

  async closePaperPosition(_id: string, _exitPrice: number, _exitReason: string): Promise<PaperPosition | undefined> {
    return undefined;
  }

  // Paper Trading - Equity Snapshots (stub)
  async createPaperEquitySnapshot(_snapshot: InsertPaperEquitySnapshot): Promise<PaperEquitySnapshot> {
    throw new Error("Paper Trading not supported in MemStorage");
  }

  async getPaperEquitySnapshots(_portfolioId: string, _startDate?: string, _endDate?: string): Promise<PaperEquitySnapshot[]> {
    return [];
  }
  
  // Paper Trading - Compliance (stub returns 0 for MemStorage)
  async getCompletedPaperTradesCount(_userId: string): Promise<number> {
    return 0;
  }

  // Telemetry - Trade Input Snapshots (stub)
  async saveTradeInputSnapshot(_snapshot: InsertTradeInputSnapshot): Promise<TradeInputSnapshot> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  async getTradeInputSnapshot(_tradeIdeaId: string): Promise<TradeInputSnapshot | null> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  // Telemetry - Engine Daily Metrics (stub)
  async saveEngineDailyMetrics(_metrics: InsertEngineDailyMetrics): Promise<EngineDailyMetrics> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  async getEngineDailyMetrics(_date: string, _engine?: EngineSource): Promise<EngineDailyMetrics[]> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  async getEngineMetricsRange(_startDate: string, _endDate: string, _engine?: EngineSource): Promise<EngineDailyMetrics[]> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  // Telemetry - Engine Health Alerts (stub)
  async saveEngineHealthAlert(_alert: InsertEngineHealthAlert): Promise<EngineHealthAlert> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  async getActiveHealthAlerts(): Promise<EngineHealthAlert[]> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  async acknowledgeHealthAlert(_id: string, _userId: string): Promise<void> {
    throw new Error("Telemetry not supported in MemStorage");
  }

  async savePriceSnapshot(_snapshot: InsertTradePriceSnapshot): Promise<TradePriceSnapshot> {
    throw new Error("Audit trail not supported in MemStorage");
  }

  async getPriceSnapshots(_tradeIdeaId: string): Promise<TradePriceSnapshot[]> {
    throw new Error("Audit trail not supported in MemStorage");
  }

  async getTradeAuditTrail(_tradeIdeaId: string): Promise<{
    tradeIdea: TradeIdea | null;
    priceSnapshots: TradePriceSnapshot[];
  }> {
    throw new Error("Audit trail not supported in MemStorage");
  }

  // Loss Analysis (stub)
  async createLossAnalysis(_analysis: InsertLossAnalysis): Promise<LossAnalysis> {
    throw new Error("Loss analysis not supported in MemStorage");
  }

  async getLossAnalysisByTradeId(_tradeIdeaId: string): Promise<LossAnalysis | null> {
    throw new Error("Loss analysis not supported in MemStorage");
  }

  async getAllLossAnalyses(): Promise<LossAnalysis[]> {
    throw new Error("Loss analysis not supported in MemStorage");
  }

  async getLossPatterns(): Promise<{ pattern: string; count: number; avgLoss: number }[]> {
    throw new Error("Loss analysis not supported in MemStorage");
  }

  // Navigation Layouts (stub for MemStorage)
  async getUserNavigationLayout(_userId: string): Promise<UserNavigationLayout | null> {
    return null;
  }

  async saveUserNavigationLayout(_userId: string, _layout: NavigationLayoutType): Promise<UserNavigationLayout> {
    throw new Error("Navigation layouts not supported in MemStorage");
  }

  async deleteUserNavigationLayout(_userId: string): Promise<boolean> {
    return false;
  }

  // Journal Trades (stubs for MemStorage)
  async createJournalTrade(_trade: InsertJournalTrade): Promise<JournalTrade> {
    throw new Error("Journal trades not supported in MemStorage");
  }
  async createJournalTrades(_trades: InsertJournalTrade[]): Promise<JournalTrade[]> {
    throw new Error("Journal trades not supported in MemStorage");
  }
  async getJournalTrades(_userId: string): Promise<JournalTrade[]> {
    return [];
  }
  async getJournalTradeById(_id: string): Promise<JournalTrade | undefined> {
    return undefined;
  }
  async updateJournalTrade(_id: string, _updates: Partial<JournalTrade>): Promise<JournalTrade | undefined> {
    return undefined;
  }
  async deleteJournalTrade(_id: string): Promise<boolean> {
    return false;
  }
  async deleteJournalTradesByBatch(_importBatchId: string): Promise<number> {
    return 0;
  }
  async getJournalTradeCount(_userId: string): Promise<number> {
    return 0;
  }

  // GEX Snapshot History — in-memory stubs
  async createGexSnapshot(_s: InsertGexSnapshot): Promise<GexSnapshotRecord> {
    return { id: 0, ..._s, createdAt: new Date() } as any;
  }
  async getGexSnapshots(_symbol: string, _limit?: number): Promise<GexSnapshotRecord[]> {
    return [];
  }
  async getGexSnapshotsByDateRange(_symbol: string, _start: Date, _end: Date): Promise<GexSnapshotRecord[]> {
    return [];
  }
  async getGexAvailableDates(_symbol: string): Promise<string[]> {
    return [];
  }
  async getGexAvailableSymbols(): Promise<string[]> {
    return [];
  }
}

// Database Storage Implementation (from javascript_database blueprint)
export class DatabaseStorage implements IStorage {
  private chatHistory: Map<string, ChatMessage>; // Keep chat in memory for now

  constructor() {
    this.chatHistory = new Map();
  }

  // User Operations (Required for Replit Auth)
  // Reference: blueprint:javascript_log_in_with_replit
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserSubscription(userId: string, subscriptionData: { stripeCustomerId?: string; stripeSubscriptionId?: string; subscriptionTier?: SubscriptionTier; subscriptionStatus?: string; subscriptionEndsAt?: Date | null }): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        ...subscriptionData,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updated || undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    // Case-insensitive email lookup to prevent duplicate accounts
    const [user] = await db.select().from(users).where(
      drizzleSql`LOWER(${users.email}) = LOWER(${email})`
    );
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteUser(id: string): Promise<boolean> {
    // Delete associated data first
    await db.delete(userPreferencesTable).where(eq(userPreferencesTable.userId, id));
    await db.delete(watchlistTable).where(eq(watchlistTable.userId, id));
    await db.delete(tradeIdeas).where(eq(tradeIdeas.userId, id));
    
    // Delete user
    const result = await db.delete(users).where(eq(users.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Market Data Methods
  async getAllMarketData(): Promise<MarketData[]> {
    return await db.select().from(marketDataTable);
  }

  async getMarketDataBySymbol(symbol: string): Promise<MarketData | undefined> {
    const [data] = await db.select().from(marketDataTable).where(eq(marketDataTable.symbol, symbol));
    return data || undefined;
  }

  async createMarketData(data: InsertMarketData): Promise<MarketData> {
    const [created] = await db.insert(marketDataTable).values(data as any).returning();
    return created;
  }

  async updateMarketData(symbol: string, data: Partial<InsertMarketData>): Promise<MarketData | undefined> {
    const [updated] = await db.update(marketDataTable)
      .set(data as any)
      .where(eq(marketDataTable.symbol, symbol))
      .returning();
    return updated || undefined;
  }

  // Trade Ideas Methods
  async getAllTradeIdeas(): Promise<TradeIdea[]> {
    return await db.select().from(tradeIdeas).orderBy(desc(tradeIdeas.timestamp));
  }

  async getRecentTradeIdeas(hoursBack: number = 24, limit: number = 1000): Promise<TradeIdea[]> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    return await db.select().from(tradeIdeas)
      .where(gte(tradeIdeas.timestamp, cutoffTime))
      .orderBy(desc(tradeIdeas.timestamp))
      .limit(limit);
  }

  async getTradeIdeaById(id: string): Promise<TradeIdea | undefined> {
    const [idea] = await db.select().from(tradeIdeas).where(eq(tradeIdeas.id, id));
    return idea || undefined;
  }

  async createTradeIdea(rawIdea: InsertTradeIdea, opts?: CreateTradeIdeaOptions): Promise<TradeIdea> {
    // Canonicalize the source spelling (flow→options_flow, quant_signal→quant…)
    // so dedup keys and stored provenance stay consistent. Synonyms only —
    // never rewrites the engine identity. See normalizeIdeaSource().
    const idea: InsertTradeIdea = (rawIdea as any).source
      ? ({ ...rawIdea, source: normalizeIdeaSource((rawIdea as any).source) } as InsertTradeIdea)
      : rawIdea;

    // 🛡️ Shared validation gate — blocks malformed scanner output BEFORE
    // it reaches the DB. Catches the entire class of bugs we kept fixing
    // downstream (catalyst contradicts direction, target on wrong side of
    // entry, R:R inverted, etc.) at the single write point. See
    // validateTradeIdeaForCreate() below for the rules.
    const validation = validateTradeIdeaForCreate(idea);
    if (!validation.ok) {
      logger.warn(
        `[SCANNER-GATE] rejected ${(idea as any).source ?? "unknown"} idea ${(idea as any).symbol} ${(idea as any).direction}: ${validation.reason}`,
      );
      throw new Error(`Invalid trade idea: ${validation.reason}`);
    }

    // 🔁 Centralized dedup. Now DEFAULT-ON for automated engine sources — the
    // generators never passed dedupWindowHours, which is how the same setup
    // (e.g. COHU/COHR) landed 4× and inflated the calibration/audit counts.
    // Precedence: explicit opts.dedupWindowHours wins (incl. 0 = force insert);
    // otherwise manual/user/TradingView entries always insert, and every
    // automated source dedups within a 6h window (same symbol+direction+source).
    const ALWAYS_INSERT = new Set(["manual", "user", "tradingview"]);
    const src = String((idea as any).source ?? "").toLowerCase();
    const dedupWindow =
      opts?.dedupWindowHours !== undefined
        ? opts.dedupWindowHours
        : ALWAYS_INSERT.has(src) ? 0 : 6;
    if (dedupWindow > 0) {
      const existing = await this.findRecentDuplicateIdea(idea, dedupWindow);
      if (existing) {
        logger.debug(
          `[SPINE-DEDUP] ${src || "unknown"} ${idea.symbol} ${idea.direction} within ${dedupWindow}h — returning existing ${existing.id}`,
        );
        return existing;
      }
    }

    // GLOBAL CAP: No trade idea should have confidence > 94% (reflects market uncertainty)
    const cappedIdea = {
      ...idea,
      confidenceScore: idea.confidenceScore
        ? Math.min(94, Math.max(0, idea.confidenceScore))
        : idea.confidenceScore
    };
    const [created] = await db.insert(tradeIdeas).values(cappedIdea as any).returning();
    return created;
  }

  /**
   * Finds a recent non-archived idea matching the same setup, for spine dedup.
   * Keys on symbol + assetType + direction + source. A quant scan's contract is
   * selected from a changing option chain, so a different strike/expiry is a
   * contract refresh—not a new thesis. Other option sources retain leg-level
   * matching because an explicitly chosen contract can be the thing being tracked.
   */
  private async findRecentDuplicateIdea(
    idea: InsertTradeIdea,
    windowHours: number,
  ): Promise<TradeIdea | undefined> {
    const cutoffIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
    const conds = [
      eq(tradeIdeas.symbol, idea.symbol),
      eq(tradeIdeas.assetType, idea.assetType as any),
      eq(tradeIdeas.direction, idea.direction),
      gte(tradeIdeas.timestamp, cutoffIso),
      not(eq(tradeIdeas.status, 'archived')),
    ];
    if ((idea as any).source) conds.push(eq(tradeIdeas.source, (idea as any).source));
    const source = String((idea as any).source ?? '').toLowerCase();
    const contractIsPartOfIdentity = idea.assetType === 'option' && source !== 'quant';
    if (contractIsPartOfIdentity) {
      if (idea.optionType) conds.push(eq(tradeIdeas.optionType, idea.optionType));
      if (idea.strikePrice != null) conds.push(eq(tradeIdeas.strikePrice, idea.strikePrice));
      if (idea.expiryDate) conds.push(eq(tradeIdeas.expiryDate, idea.expiryDate));
    }
    const [existing] = await db.select().from(tradeIdeas).where(and(...conds)).limit(1);
    return existing || undefined;
  }

  async updateTradeIdea(id: string, updates: Partial<TradeIdea>): Promise<TradeIdea | undefined> {
    const [updated] = await db.update(tradeIdeas)
      .set(updates)
      .where(eq(tradeIdeas.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteTradeIdea(id: string): Promise<boolean> {
    const result = await db.delete(tradeIdeas).where(eq(tradeIdeas.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // AUTO-CLEANUP: Remove stale trades from database
  async cleanupStaleTradeIdeas(): Promise<number> {
    // RETENTION: archive, never delete.
    //
    // This was 7 days, hard delete. A platform cannot demonstrate an edge while
    // erasing its own outcomes every week — it caps the observable sample at
    // whatever closed in the last seven days, which is why the whole track record
    // began on 2026-08-18 and why no source has enough decided trades to clear a
    // significance bar. Closed trades ARE the product's evidence; they are the
    // cheapest rows in the table and the only ones that answer "does this work".
    //
    // Size was the original concern. That is a read-side problem: exclude
    // archived rows where payload matters, and keep the history.
    const RETENTION_DAYS = 365; // archive after a year; never delete
    const STALE_HOURS = 48;
    const cutoffClosed = new Date();
    cutoffClosed.setDate(cutoffClosed.getDate() - RETENTION_DAYS);
    const cutoffStale = new Date();
    cutoffStale.setHours(cutoffStale.getHours() - STALE_HOURS);

    let expiredCount = 0;
    let deletedCount = 0;

    try {
      const result = await db
        .update(tradeIdeas)
        .set({ outcomeStatus: 'expired' })
        .where(drizzleSql`${tradeIdeas.outcomeStatus} = 'open' AND ${tradeIdeas.timestamp} < ${cutoffStale.toISOString()}`)
        .returning({ id: tradeIdeas.id });
      expiredCount = result.length;
    } catch (err) {
      logger.error('[CLEANUP] Failed to expire stale trades in database:', err);
    }

    try {
      const result = await db
        .update(tradeIdeas)
        .set({ archived: true })
        .where(drizzleSql`${tradeIdeas.outcomeStatus} IN ('won', 'lost', 'closed', 'expired') AND ${tradeIdeas.timestamp} < ${cutoffClosed.toISOString()} AND ${tradeIdeas.archived} = false`)
        .returning({ id: tradeIdeas.id });
      deletedCount = result.length;
    } catch (err) {
      logger.error('[CLEANUP] Failed to delete old trades from database:', err);
    }

    // ARCHIVE, never delete. This pass used to hard-delete every row whose
    // contract expiry had passed, with NO status filter — resolved history
    // included. Measured 2026-08-25: 223 of 312 rows with an expiry were inside
    // a 14-day window and 105 of those were CLOSED ideas, so roughly ten days of
    // this running would have destroyed most of the platform's track record on a
    // rolling basis. An expired contract is exactly the row you most want to keep:
    // it is a completed trade with a known outcome.
    //
    // The intent was payload size, which is a read concern. Solve it by excluding
    // archived rows at the read, not by deleting the evidence.
    try {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const result = await db
        .update(tradeIdeas)
        .set({ archived: true })
        .where(drizzleSql`${tradeIdeas.expiryDate} IS NOT NULL AND ${tradeIdeas.expiryDate} < ${oneDayAgo.toISOString()} AND ${tradeIdeas.archived} = false`)
        .returning({ id: tradeIdeas.id });
      if (result.length > 0) {
        logger.info(`[CLEANUP] Archived ${result.length} expired-contract idea(s) — retained for performance history`);
      }
    } catch (err) {
      logger.error('[CLEANUP] Failed to archive expired options:', err);
    }

    const totalAffected = expiredCount + deletedCount;
    if (totalAffected > 0) {
      logger.info(`[CLEANUP] Expired ${expiredCount} stale trades, deleted ${deletedCount} old trades from database`);
    }
    return totalAffected;
  }

  async findSimilarTradeIdea(symbol: string, direction: string, entryPrice: number, hoursBack: number = 24, assetType?: string, optionType?: string, strikePrice?: number): Promise<TradeIdea | undefined> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    const tolerance = entryPrice * 0.02; // 2% price tolerance

    // Build base query conditions - check ALL ideas regardless of status
    // This prevents duplicate ideas even if earlier ones were marked expired/closed
    const conditions = [
      eq(tradeIdeas.symbol, symbol),
      eq(tradeIdeas.direction, direction),
      gte(tradeIdeas.timestamp, cutoffTime)
      // REMOVED: outcomeStatus check - prevent ALL duplicates not just open ones
    ];

    // Add asset type filter if provided
    if (assetType) {
      conditions.push(eq(tradeIdeas.assetType, assetType as AssetType));
    }

    // Add option-specific filters if provided
    if (optionType) {
      conditions.push(eq(tradeIdeas.optionType, optionType));
    }

    const results = await db.select().from(tradeIdeas)
      .where(and(...conditions));

    // For options, also check strike price match (within $1)
    if (assetType === 'option' && strikePrice !== undefined && strikePrice !== null) {
      return results.find(idea => 
        Math.abs(idea.entryPrice - entryPrice) <= tolerance &&
        idea.strikePrice !== null &&
        idea.strikePrice !== undefined &&
        Math.abs(idea.strikePrice - strikePrice) <= 1
      );
    }

    // For stocks/crypto, just check entry price tolerance
    return results.find(idea => 
      Math.abs(idea.entryPrice - entryPrice) <= tolerance
    );
  }

  async updateTradeIdeaPerformance(id: string, performance: Partial<Pick<TradeIdea, 'outcomeStatus' | 'exitPrice' | 'exitDate' | 'resolutionReason' | 'actualHoldingTimeMinutes' | 'percentGain' | 'realizedPnL' | 'validatedAt' | 'outcomeNotes' | 'predictionAccurate' | 'predictionValidatedAt' | 'highestPriceReached' | 'lowestPriceReached' | 'missedEntryTheoreticalOutcome' | 'missedEntryTheoreticalGain' | 'exitPremium' | 'optionPercentGain'>>): Promise<TradeIdea | undefined> {
    const existing = await this.getTradeIdeaById(id);
    if (!existing) return undefined;
    
    // Calculate actualHoldingTimeMinutes if not provided or is 0
    let holdingTimeMinutes: number | null = performance.actualHoldingTimeMinutes ?? null;
    if (performance.exitDate && (!holdingTimeMinutes || holdingTimeMinutes === 0)) {
      const createdAt = new Date(existing.timestamp);
      const exitedAt = new Date(performance.exitDate);
      const diffMs = exitedAt.getTime() - createdAt.getTime();
      holdingTimeMinutes = Math.floor(diffMs / (1000 * 60));
    }

    const [updated] = await db.update(tradeIdeas)
      .set({ ...performance, actualHoldingTimeMinutes: holdingTimeMinutes })
      .where(eq(tradeIdeas.id, id))
      .returning();
    return updated || undefined;
  }

  async getOpenTradeIdeas(): Promise<TradeIdea[]> {
    return await db.select().from(tradeIdeas).where(eq(tradeIdeas.outcomeStatus, 'open'));
  }

  async getTradeIdeasByFilters(filters: { assetType?: string; outcomeStatus?: string; limit?: number }): Promise<TradeIdea[]> {
    let query = db.select().from(tradeIdeas);

    const conditions = [];
    if (filters.assetType) {
      conditions.push(eq(tradeIdeas.assetType, filters.assetType));
    }
    if (filters.outcomeStatus) {
      conditions.push(eq(tradeIdeas.outcomeStatus, filters.outcomeStatus as any));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    query = query.orderBy(desc(tradeIdeas.timestamp)) as any;

    if (filters.limit) {
      query = query.limit(filters.limit) as any;
    }

    return await query;
  }

  async getPerformanceStats(filters?: {
    startDate?: string; // ISO date string (YYYY-MM-DD)
    endDate?: string;   // ISO date string (YYYY-MM-DD)
    source?: string;    // 'ai', 'quant', 'manual'
    includeAllVersions?: boolean; // When true, includes v2.x trades for ML/admin analysis (default: false = v3.0+ only)
    includeOptions?: boolean; // When true, includes options (default: false until proper option pricing implemented)
  }): Promise<PerformanceStats> {
    let allIdeasRaw = await this.getAllTradeIdeas();
    const originalCount = allIdeasRaw.length;
    
    // Apply date filters if provided (filter by date portion only, avoiding timezone issues)
    if (filters?.startDate || filters?.endDate) {
      allIdeasRaw = allIdeasRaw.filter(idea => {
        // Extract just the date portion (YYYY-MM-DD) from ISO timestamp
        const ideaDateStr = idea.timestamp.split('T')[0];
        
        if (filters.startDate) {
          if (ideaDateStr < filters.startDate) return false;
        }
        if (filters.endDate) {
          if (ideaDateStr > filters.endDate) return false;
        }
        return true;
      });
      console.log(`[PERF-STATS] Date filter applied: ${filters.startDate || 'all'} to ${filters.endDate || 'all'} → ${originalCount} ideas filtered to ${allIdeasRaw.length}`);
    }
    
    // Apply source filter if provided
    if (filters?.source) {
      allIdeasRaw = allIdeasRaw.filter(idea => idea.source === filters.source);
      console.log(`[PERF-STATS] Source filter applied: ${filters.source} → ${allIdeasRaw.length} ideas`);
    }
    
    // PERFORMANCE STATS: Exclude buggy/test trades (exclude_from_training=true)
    // These are legacy trades with known issues (e.g., inverted option directions)
    let allIdeas = allIdeasRaw.filter(idea => !idea.excludeFromTraining);
    console.log(`[PERF-STATS] After excluding buggy trades: ${allIdeas.length} ideas`);
    
    // 🎯 ENGINE VERSION FILTERING - CONSISTENT (Dec 2025)
    // Uses canonical isCurrentGenEngine from shared/constants.ts
    // Excludes legacy v1.x/v2.x engines by default for consistent stats across all endpoints
    // Set includeAllVersions=true to include legacy engines (for admin/ML analysis)
    if (filters?.includeAllVersions !== true) {
      // Default: Exclude legacy engines for consistent stats across endpoints
      const beforeVersionFilter = allIdeas.length;
      allIdeas = allIdeas.filter(idea => isCurrentGenEngine(idea));
      console.log(`[PERF-STATS] Engine filter: Current-gen only → ${beforeVersionFilter} filtered to ${allIdeas.length}`);
    } else {
      // Explicitly requested to include all versions (admin/ML mode)
      console.log(`[PERF-STATS] Engine filter: All versions included (admin mode) → ${allIdeas.length} ideas`);
    }
    
    // 🚨 OPTIONS FILTER: Exclude options by default until proper option pricing is implemented
    // Previous bug: Was comparing STOCK prices ($252) to OPTION premiums ($89), causing false wins
    // Flow Scanner's 99.4% win rate was entirely from false option wins!
    // Fix: Keep options disabled until premium fetching/normalization is fixed
    if (!filters?.includeOptions) {
      const beforeOptionsFilter = allIdeas.length;
      allIdeas = allIdeas.filter(idea => idea.assetType !== 'option');
      const optionsCount = beforeOptionsFilter - allIdeas.length;
      if (optionsCount > 0) {
        console.log(`[PERF-STATS] Options filter: Excluded ${optionsCount} option trades (no proper pricing yet) → ${allIdeas.length} ideas remain`);
      }
      
      // 🚨 ALSO exclude 'flow' and 'lotto' sources - they're almost entirely options
      // Flow Scanner: 965/1127 expired (unvalidatable options), 99.4% "win rate" is fake
      // Lotto Scanner: 341/341 expired (all far-OTM options)
      // These inflate stats artificially - exclude from public display
      const beforeSourceFilter = allIdeas.length;
      allIdeas = allIdeas.filter(idea => idea.source !== 'flow' && idea.source !== 'lotto');
      const flowLottoCount = beforeSourceFilter - allIdeas.length;
      if (flowLottoCount > 0) {
        console.log(`[PERF-STATS] Source filter: Excluded ${flowLottoCount} flow/lotto trades (unvalidatable options) → ${allIdeas.length} ideas remain`);
      }
    } else {
      console.log(`[PERF-STATS] Options included (includeOptions=true) - WARNING: option win rates may be invalid`);
    }
    
    const openIdeas = allIdeas.filter(i => i.outcomeStatus === 'open');
    const closedIdeas = allIdeas.filter(i => i.outcomeStatus !== 'open');
    const wonIdeas = closedIdeas.filter(i => i.outcomeStatus === 'hit_target');
    // A touched stop is a loss — the shared isRealLoss classifier, not a local
    // 3% floor. The floor survived here after being removed from the barrier
    // layer, silently erasing small stop-outs from every reported rate.
    const lostIdeas = closedIdeas.filter(i => isRealLoss(i));
    const expiredIdeas = closedIdeas.filter(i => i.outcomeStatus === 'expired' || i.outcomeStatus === 'manual_exit');

    const calculateAvg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    
    // (the shared isRealLoss from @shared/constants classifies losses here —
    // the local shadow that re-imposed the 3% floor is gone)

    const closedGains = closedIdeas.filter(i => i.percentGain !== null).map(i => i.percentGain!);
    const closedHoldingTimes = closedIdeas.filter(i => i.actualHoldingTimeMinutes !== null).map(i => i.actualHoldingTimeMinutes!);

    // Group by source (ALL ideas, not just closed) - DYNAMICALLY to include all sources (flow, hybrid, ai, quant, manual)
    const sourcesSet = new Set(allIdeas.map(i => i.source || 'unknown'));
    const bySource = Array.from(sourcesSet).map(source => {
      const sourceAllIdeas = allIdeas.filter(i => i.source === source);
      const sourceClosedIdeas = closedIdeas.filter(i => i.source === source);
      const sourceWon = sourceClosedIdeas.filter(i => i.outcomeStatus === 'hit_target');
      const sourceLost = sourceClosedIdeas.filter(i => isRealLoss(i));
      const sourceGains = sourceClosedIdeas.filter(i => i.percentGain !== null).map(i => i.percentGain!);
      // WIN RATE FIX: Only count decided trades (exclude expired and breakeven)
      const sourceDecided = sourceWon.length + sourceLost.length;
      
      return {
        source,
        totalIdeas: sourceAllIdeas.length, // Show ALL ideas (open + closed)
        wonIdeas: sourceWon.length,
        lostIdeas: sourceLost.length,
        // Null, not 0, when the sample cannot carry a rate. `gex_scanner` was
        // shipping `winRate: 0` beside `wonIdeas: 0, lostIdeas: 0` — a scanner
        // that had never resolved a trade, reported as one that never wins.
        // `decided` travels with it so the reader sees the sample, not just a gap.
        winRate: reportableRate(sourceWon.length, sourceDecided),
        decided: sourceDecided,
        avgPercentGain: calculateAvg(sourceGains),
      };
    }).sort((a, b) => b.totalIdeas - a.totalIdeas); // Sort by total trades descending

    // Group by asset type (ALL ideas, not just closed) - DYNAMICALLY to include all asset types
    const assetTypesSet = new Set(allIdeas.map(i => i.assetType || 'unknown'));
    const byAssetType = Array.from(assetTypesSet).map(assetType => {
      const assetAllIdeas = allIdeas.filter(i => i.assetType === assetType);
      const assetClosedIdeas = closedIdeas.filter(i => i.assetType === assetType);
      const assetWon = assetClosedIdeas.filter(i => i.outcomeStatus === 'hit_target');
      const assetLost = assetClosedIdeas.filter(i => isRealLoss(i));
      const assetGains = assetClosedIdeas.filter(i => i.percentGain !== null).map(i => i.percentGain!);
      // WIN RATE FIX: Only count decided trades (exclude expired and breakeven)
      const assetDecided = assetWon.length + assetLost.length;
      
      return {
        assetType,
        totalIdeas: assetAllIdeas.length, // Show ALL ideas (open + closed)
        wonIdeas: assetWon.length,
        lostIdeas: assetLost.length,
        winRate: assetDecided > 0 ? (assetWon.length / assetDecided) * 100 : 0,
        avgPercentGain: calculateAvg(assetGains),
      };
    }).sort((a, b) => b.totalIdeas - a.totalIdeas); // Sort by total trades descending

    // Group by signal type
    const signalMap = new Map<string, TradeIdea[]>();
    closedIdeas.forEach(idea => {
      if (idea.qualitySignals) {
        idea.qualitySignals.forEach(signal => {
          if (!signalMap.has(signal)) signalMap.set(signal, []);
          signalMap.get(signal)!.push(idea);
        });
      }
    });

    const bySignalType = Array.from(signalMap.entries()).map(([signal, ideas]) => {
      const signalWon = ideas.filter(i => i.outcomeStatus === 'hit_target');
      const signalLost = ideas.filter(i => isRealLoss(i));
      const signalGains = ideas.filter(i => i.percentGain !== null).map(i => i.percentGain!);
      // WIN RATE FIX: Only count decided trades (exclude expired and breakeven)
      const signalDecided = signalWon.length + signalLost.length;
      
      return {
        signal,
        totalIdeas: ideas.length,
        wonIdeas: signalWon.length,
        lostIdeas: signalLost.length,
        winRate: signalDecided > 0 ? (signalWon.length / signalDecided) * 100 : 0,
        avgPercentGain: calculateAvg(signalGains),
      };
    });

    // WIN RATE FIX: Exclude expired ideas from denominator - only count actual wins vs losses
    const decidedIdeas = wonIdeas.length + lostIdeas.length;
    const winRate = decidedIdeas > 0 ? (wonIdeas.length / decidedIdeas) * 100 : 0;

    // QUANT ACCURACY: Calculate percentage progress toward target (0-100+%)
    // For ALL trades (open + closed), calculate how far price moved toward target
    const evaluatePredictionAccuracyPercent = (idea: TradeIdea): number | null => {
      // Closed trades: use explicit predictionAccuracyPercent field if available
      if (idea.outcomeStatus !== 'open') {
        return idea.predictionAccuracyPercent ?? null;
      }
      
      // Open trades: calculate percentage progress using highest/lowest price reached
      const expectedMove = idea.targetPrice - idea.entryPrice;
      
      if (idea.direction === 'long') {
        const highestPrice = idea.highestPriceReached;
        if (!highestPrice || highestPrice === idea.entryPrice) return null;
        const actualMove = highestPrice - idea.entryPrice;
        const progressPercent = (actualMove / expectedMove) * 100;
        return Math.max(0, progressPercent);
      } else {
        const lowestPrice = idea.lowestPriceReached;
        if (!lowestPrice || lowestPrice === idea.entryPrice) return null;
        const actualMove = idea.entryPrice - lowestPrice;
        const targetMove = idea.entryPrice - idea.targetPrice;
        const progressPercent = (actualMove / targetMove) * 100;
        return Math.max(0, progressPercent);
      }
    };
    
    // Calculate WEIGHTED prediction accuracy with BOUNDED PENALTIES
    // Methodology: Include all trades, but cap extreme negative values to prevent skew
    // Weighting: 2x for high confidence (>85), 1x baseline, 0.5x for expired/low confidence
    const weightedAccuracyData: Array<{ accuracy: number; weight: number }> = [];
    
    allIdeas.forEach(idea => {
      const accuracyPercent = evaluatePredictionAccuracyPercent(idea);
      
      if (accuracyPercent !== null) {
        // CLAMP extreme negative values to -30% to prevent single bad trades from dominating
        // This maintains honesty while preventing outliers from skewing the metric
        const boundedAccuracy = Math.max(-30, accuracyPercent);
        
        // Determine weight based on confidence and outcome
        let weight = 1.0; // baseline
        
        if (idea.confidenceScore && idea.confidenceScore > 85) {
          weight = 2.0; // High confidence gets 2x weight
        } else if (idea.outcomeStatus === 'expired' || (idea.confidenceScore && idea.confidenceScore < 70)) {
          weight = 0.5; // Expired or low confidence gets 0.5x weight
        }
        
        weightedAccuracyData.push({ accuracy: boundedAccuracy, weight });
      }
    });
    
    const quantAccuracy = weightedAccuracyData.length > 0 
      ? weightedAccuracyData.reduce((sum, item) => sum + (item.accuracy * item.weight), 0) / 
        weightedAccuracyData.reduce((sum, item) => sum + item.weight, 0)
      : 0;
    
    // Calculate Directional Accuracy: % of trades that moved at least 25% toward target
    const directionalSuccessCount = allIdeas.filter(idea => {
      const accuracyPercent = evaluatePredictionAccuracyPercent(idea);
      return accuracyPercent !== null && accuracyPercent >= 25; // At least 25% of target achieved
    }).length;
    
    const directionalAccuracy = allIdeas.length > 0
      ? (directionalSuccessCount / allIdeas.length) * 100
      : 0;

    // ========================================
    // PROFESSIONAL RISK METRICS (Phase 1)
    // ========================================
    
    // 1. SHARPE RATIO: Annualized, risk-free adjusted, duration-aware
    // Formula: (mean(excess) / std(excess)) * sqrt(252 / avg_holding_days)
    // Risk-free: 4.5% annual (T-bill proxy), prorated per avg trade duration
    const calculateStdDev = (arr: number[]): number => {
      if (arr.length < 2) return 0;
      const avg = calculateAvg(arr);
      const squareDiffs = arr.map(val => Math.pow(val - avg, 2));
      const variance = calculateAvg(squareDiffs);
      return Math.sqrt(variance);
    };

    const decidedTrades = [...wonIdeas, ...lostIdeas];
    const decidedGains = decidedTrades
      .filter(i => i.percentGain !== null)
      .map(i => i.percentGain!);

    // Estimate avg holding period from actualHoldingTimeMinutes or timestamp/exitDate
    const holdingDaysList: number[] = [];
    decidedTrades.forEach(t => {
      if (t.actualHoldingTimeMinutes) {
        holdingDaysList.push(t.actualHoldingTimeMinutes / (60 * 6.5)); // 6.5hr trading day
      } else if (t.timestamp && t.exitDate) {
        const diffMs = new Date(t.exitDate).getTime() - new Date(t.timestamp).getTime();
        holdingDaysList.push(Math.max(0.1, diffMs / (1000 * 60 * 60 * 6.5)));
      }
    });
    const avgHoldingDays = holdingDaysList.length > 0
      ? holdingDaysList.reduce((a, b) => a + b, 0) / holdingDaysList.length
      : 1; // default 1 trading day if no duration data

    const ANNUAL_RISK_FREE = 0.045;
    const riskFreePerTrade = (ANNUAL_RISK_FREE * avgHoldingDays) / 252;
    // Convert percent gains to decimal, subtract prorated risk-free cost
    const excessReturns = decidedGains.map(g => (g / 100) - riskFreePerTrade);
    const meanExcess = excessReturns.length > 0
      ? excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length : 0;
    const excessStdDev = calculateStdDev(excessReturns);
    const annualizationFactor = Math.sqrt(252 / Math.max(avgHoldingDays, 0.1));
    const sharpeRatio = excessStdDev > 0 ? (meanExcess / excessStdDev) * annualizationFactor : 0;
    
    // 2. MAX DRAWDOWN: Worst peak-to-trough decline
    // Simulate equity curve from trade sequence
    let peak = 100; // Start with $100
    let equity = 100;
    let maxDrawdown = 0;
    
    decidedIdeas > 0 && [...wonIdeas, ...lostIdeas]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .forEach(idea => {
        if (idea.percentGain !== null) {
          equity = equity * (1 + idea.percentGain / 100);
          if (equity > peak) peak = equity;
          const drawdown = ((peak - equity) / peak) * 100;
          if (drawdown > maxDrawdown) maxDrawdown = drawdown;
        }
      });
    
    // 3. PROFIT FACTOR: Gross Wins / Gross Losses
    const grossWins = wonIdeas
      .filter(i => i.percentGain !== null && i.percentGain > 0)
      .reduce((sum, i) => sum + i.percentGain!, 0);
    
    const grossLosses = Math.abs(lostIdeas
      .filter(i => i.percentGain !== null && i.percentGain < 0)
      .reduce((sum, i) => sum + i.percentGain!, 0));
    
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? 99 : 0);
    
    // 4. EXPECTANCY: Expected value per trade
    // Formula: (Avg Win × Win%) - (Avg Loss × Loss%)
    const avgWin = wonIdeas.filter(i => i.percentGain !== null && i.percentGain > 0).length > 0
      ? calculateAvg(wonIdeas.filter(i => i.percentGain !== null && i.percentGain > 0).map(i => i.percentGain!))
      : 0;
    
    const avgLoss = lostIdeas.filter(i => i.percentGain !== null && i.percentGain < 0).length > 0
      ? Math.abs(calculateAvg(lostIdeas.filter(i => i.percentGain !== null && i.percentGain < 0).map(i => i.percentGain!)))
      : 0;
    
    const winPct = decidedIdeas > 0 ? wonIdeas.length / decidedIdeas : 0;
    const lossPct = decidedIdeas > 0 ? lostIdeas.length / decidedIdeas : 0;
    
    const expectancy = (avgWin * winPct) - (avgLoss * lossPct);

    // ========================================
    // EXPECTED VALUE (EV) SCORE - Quant-Defensible Profitability Metric
    // ========================================
    // Formula: EV Score = Avg(Expected Gain) / |Avg(Expected Loss)|
    // This shows the profitability quality - do wins compensate for losses?
    const evScore = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? 99 : 1);
    
    // Adjusted Weighted Accuracy = quantAccuracy × sqrt(EV Score)
    // Merges accuracy and profitability quality into one interpretive metric
    // Using sqrt to keep the result in 0-100 range while EV Score impact is meaningful
    const adjustedWeightedAccuracy = quantAccuracy * Math.sqrt(Math.min(evScore, 4)) / 2; // Cap at 2x boost
    
    // ========================================
    // OPPOSITE DIRECTION RATE - Critical Blind Spot Detection
    // ========================================
    // Tracks trades that moved AGAINST prediction by at least 10% of expected move
    // This catches model failures where price moved significantly in wrong direction
    const oppositeDirectionCount = allIdeas.filter(idea => {
      const accuracyPercent = evaluatePredictionAccuracyPercent(idea);
      // Moved opposite to prediction by at least 10% of expected move
      return accuracyPercent !== null && accuracyPercent < -10;
    }).length;
    
    const oppositeDirectionRate = allIdeas.length > 0
      ? (oppositeDirectionCount / allIdeas.length) * 100
      : 0;

    // ========================================
    // SEGMENTED WIN RATES - Platform-Wide Consistency
    // ========================================
    // Calculate win rates for: Equities, Options, and Overall (ALL trades)
    // Uses ALL trades from database (before any filtering) for honest overall stats
    
    // Get all trades without options/flow filtering (but keep buggy/version filters)
    const allTradesForSegmented = allIdeasRaw.filter(idea => {
      // Still exclude buggy trades
      if (idea.excludeFromTraining) return false;
      // Still apply version filter if not admin mode
      if (filters?.includeAllVersions !== true && !isCurrentGenEngine(idea)) return false;
      return true;
    });
    
    // Helper for segmented win rate calculation (reuses isRealLoss defined above)
    const calcSegmentedWinRate = (ideas: TradeIdea[]) => {
      const closedIdeas = ideas.filter(i => i.outcomeStatus !== 'open');
      const wins = closedIdeas.filter(i => i.outcomeStatus === 'hit_target').length;
      const losses = closedIdeas.filter(i => isRealLoss(i)).length;
      const decided = wins + losses;
      return {
        winRate: reportableRate(wins, decided),
        wins,
        losses,
        decided
      };
    };
    
    // Equities: stock, crypto, futures (non-options)
    const equityTrades = allTradesForSegmented.filter(i => 
      i.assetType !== 'option' && i.source !== 'flow' && i.source !== 'lotto'
    );
    const equitiesStats = calcSegmentedWinRate(equityTrades);
    
    // Options: option asset type OR flow/lotto sources (which are mostly options)
    const optionTrades = allTradesForSegmented.filter(i => 
      i.assetType === 'option' || i.source === 'flow' || i.source === 'lotto'
    );
    const optionsStats = calcSegmentedWinRate(optionTrades);
    
    // Overall: ALL trades combined
    const overallStats = calcSegmentedWinRate(allTradesForSegmented);
    
    const segmentedWinRates = {
      equities: equitiesStats,
      options: optionsStats,
      overall: overallStats,
    };
    
    console.log(`[PERF-STATS] Segmented Win Rates: Equities ${equitiesStats.winRate}% (${equitiesStats.wins}W/${equitiesStats.losses}L), Options ${optionsStats.winRate}% (${optionsStats.wins}W/${optionsStats.losses}L), Overall ${overallStats.winRate}% (${overallStats.wins}W/${overallStats.losses}L)`);

    return {
      overall: {
        totalIdeas: allIdeas.length,
        openIdeas: openIdeas.length,
        closedIdeas: closedIdeas.length,
        wonIdeas: wonIdeas.length,
        lostIdeas: lostIdeas.length,
        expiredIdeas: expiredIdeas.length,
        winRate: overallStats.winRate, // Use unified segmented methodology
        winRateDecided: overallStats.decided, // the sample this rate is actually over
        quantAccuracy,
        directionalAccuracy,
        avgPercentGain: calculateAvg(closedGains),
        avgHoldingTimeMinutes: calculateAvg(closedHoldingTimes),
        // Professional risk metrics
        sharpeRatio,
        maxDrawdown,
        profitFactor,
        expectancy,
        // Enhanced quant-defensible metrics
        evScore,
        adjustedWeightedAccuracy,
        oppositeDirectionRate,
        oppositeDirectionCount,
        avgWinSize: avgWin,
        avgLossSize: avgLoss,
      },
      segmentedWinRates,
      bySource,
      byAssetType,
      bySignalType,
    };
  }

  // Catalyst Methods
  async getAllCatalysts(): Promise<Catalyst[]> {
    // 🎯 PERFORMANCE FIX: Only return upcoming catalysts (next 14 days)
    // Was sending 5700 catalysts (1.78MB) to frontend, causing browser freeze
    const now = new Date();
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    const allCatalysts = await db.select().from(catalystsTable).orderBy(catalystsTable.timestamp);
    
    // Filter to only upcoming events (today to 14 days out)
    const upcomingCatalysts = allCatalysts.filter(catalyst => {
      const eventDate = new Date(catalyst.timestamp);
      return eventDate >= now && eventDate <= fourteenDaysFromNow;
    });
    
    console.log(`📰 Catalyst Feed: Showing ${upcomingCatalysts.length} upcoming events (next 14 days) out of ${allCatalysts.length} total`);
    return upcomingCatalysts;
  }

  async getCatalystsBySymbol(symbol: string): Promise<Catalyst[]> {
    return await db.select().from(catalystsTable)
      .where(eq(catalystsTable.symbol, symbol))
      .orderBy(desc(catalystsTable.timestamp));
  }

  /**
   * Catalysts an ENGINE should consider — a recent window plus the upcoming one.
   *
   * getAllCatalysts is deliberately forward-only because it backs a UI feed
   * labelled "upcoming events". That is right for a scheduled earnings date and
   * wrong for news: a story published two hours ago is the most actionable
   * catalyst there is, and a forward-only filter makes every news row invisible
   * to the scoring engine the moment it is written.
   *
   * Kept as a separate accessor rather than widening getAllCatalysts, so the
   * "upcoming" feed does not silently start showing yesterday's headlines.
   */
  async getActiveCatalysts(lookbackHours = 72, lookaheadDays = 14): Promise<Catalyst[]> {
    const now = Date.now();
    const from = now - lookbackHours * 60 * 60 * 1000;
    const to = now + lookaheadDays * 24 * 60 * 60 * 1000;

    const all = await db.select().from(catalystsTable).orderBy(desc(catalystsTable.timestamp));
    return all.filter((catalyst) => {
      const t = Date.parse(catalyst.timestamp);
      return Number.isFinite(t) && t >= from && t <= to;
    });
  }

  async createCatalyst(catalyst: InsertCatalyst): Promise<Catalyst> {
    const [created] = await db.insert(catalystsTable).values(catalyst as any).returning();
    return created;
  }

  // Watchlist Methods
  async getAllWatchlist(): Promise<WatchlistItem[]> {
    return await db.select().from(watchlistTable).orderBy(desc(watchlistTable.addedAt));
  }

  async getWatchlistItem(id: string): Promise<WatchlistItem | undefined> {
    const [item] = await db.select().from(watchlistTable).where(eq(watchlistTable.id, id));
    return item || undefined;
  }

  async getWatchlistByUser(userId: string): Promise<WatchlistItem[]> {
    return await db.select().from(watchlistTable)
      .where(eq(watchlistTable.userId, userId))
      .orderBy(desc(watchlistTable.addedAt));
  }

  async getWatchlistByCategory(category: string): Promise<WatchlistItem[]> {
    return await db.select().from(watchlistTable)
      .where(eq(watchlistTable.category, category as any))
      .orderBy(desc(watchlistTable.addedAt));
  }

  async addToWatchlist(item: InsertWatchlist): Promise<WatchlistItem> {
    const [created] = await db.insert(watchlistTable).values(item as any).returning();
    return created;
  }

  async updateWatchlistItem(id: string, data: Partial<WatchlistItem>): Promise<WatchlistItem | undefined> {
    const [updated] = await db
      .update(watchlistTable)
      .set(data)
      .where(eq(watchlistTable.id, id))
      .returning();
    return updated || undefined;
  }

  async removeFromWatchlist(id: string): Promise<boolean> {
    const result = await db.delete(watchlistTable).where(eq(watchlistTable.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getWatchlistItemsWithPremiumTracking(): Promise<WatchlistItem[]> {
    return await db.select().from(watchlistTable).where(eq(watchlistTable.trackPremiums, true));
  }

  async updateWatchlistPremium(id: string, data: { lastPremium: number; lastPremiumDate: string; avgPremium: number; premiumPercentile: number }): Promise<WatchlistItem | undefined> {
    const [updated] = await db.update(watchlistTable)
      .set(data)
      .where(eq(watchlistTable.id, id))
      .returning();
    return updated;
  }

  // Premium History Methods
  async getPremiumHistory(watchlistId: string, days: number = 90): Promise<PremiumHistoryRecord[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    return await db.select()
      .from(premiumHistory)
      .where(and(
        eq(premiumHistory.watchlistId, watchlistId),
        gte(premiumHistory.snapshotDate, cutoffStr)
      ))
      .orderBy(desc(premiumHistory.snapshotDate));
  }

  async createPremiumSnapshot(snapshot: InsertPremiumHistory): Promise<PremiumHistoryRecord> {
    const [created] = await db.insert(premiumHistory).values(snapshot).returning();
    return created;
  }

  // Watchlist History Methods (Year-long tracking with PostgreSQL)
  async getWatchlistHistory(symbol: string, year?: number): Promise<WatchlistHistoryRecord[]> {
    let query = db.select().from(watchlistHistory).where(eq(watchlistHistory.symbol, symbol));
    if (year) {
      query = db.select().from(watchlistHistory).where(and(
        eq(watchlistHistory.symbol, symbol),
        eq(watchlistHistory.year, year)
      ));
    }
    return await query.orderBy(desc(watchlistHistory.snapshotDate));
  }

  async getWatchlistHistoryByWatchlistId(watchlistId: string, days: number = 365): Promise<WatchlistHistoryRecord[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    
    return await db.select()
      .from(watchlistHistory)
      .where(and(
        eq(watchlistHistory.watchlistId, watchlistId),
        gte(watchlistHistory.snapshotDate, cutoffStr)
      ))
      .orderBy(desc(watchlistHistory.snapshotDate));
  }

  async createWatchlistSnapshot(snapshot: InsertWatchlistHistory): Promise<WatchlistHistoryRecord> {
    const [created] = await db.insert(watchlistHistory).values(snapshot).returning();
    return created;
  }

  async getLatestWatchlistSnapshot(watchlistId: string): Promise<WatchlistHistoryRecord | undefined> {
    const [latest] = await db.select()
      .from(watchlistHistory)
      .where(eq(watchlistHistory.watchlistId, watchlistId))
      .orderBy(desc(watchlistHistory.snapshotDate))
      .limit(1);
    return latest;
  }

  // Symbol Notes Methods (PostgreSQL)
  async getSymbolNotes(symbol: string, userId: string): Promise<SymbolNote[]> {
    return await db.select()
      .from(symbolNotes)
      .where(and(
        eq(symbolNotes.symbol, symbol),
        eq(symbolNotes.userId, userId)
      ))
      .orderBy(desc(symbolNotes.createdAt));
  }

  async getSymbolNoteById(id: string): Promise<SymbolNote | undefined> {
    const [note] = await db.select()
      .from(symbolNotes)
      .where(eq(symbolNotes.id, id))
      .limit(1);
    return note;
  }

  async createSymbolNote(note: InsertSymbolNote): Promise<SymbolNote> {
    const [created] = await db.insert(symbolNotes).values(note).returning();
    return created;
  }

  async updateSymbolNote(id: string, updates: Partial<SymbolNote>): Promise<SymbolNote | undefined> {
    const [updated] = await db.update(symbolNotes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(symbolNotes.id, id))
      .returning();
    return updated;
  }

  async deleteSymbolNote(id: string): Promise<boolean> {
    const result = await db.delete(symbolNotes).where(eq(symbolNotes.id, id));
    return true;
  }

  // Whale Flows Methods
  async getAllWhaleFlows(days: number = 30): Promise<WhaleFlow[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString();

    return await db.select().from(whaleFlows)
      .where(gte(whaleFlows.detectedAt, cutoffStr))
      .orderBy(desc(whaleFlows.detectedAt));
  }

  async getWhaleFlowById(id: string): Promise<WhaleFlow | undefined> {
    const [flow] = await db.select().from(whaleFlows)
      .where(eq(whaleFlows.id, id))
      .limit(1);
    return flow;
  }

  async getWhaleFlowsBySymbol(symbol: string, days: number = 30): Promise<WhaleFlow[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString();

    return await db.select().from(whaleFlows)
      .where(and(
        eq(whaleFlows.symbol, symbol.toUpperCase()),
        gte(whaleFlows.detectedAt, cutoffStr)
      ))
      .orderBy(desc(whaleFlows.detectedAt));
  }

  async createWhaleFlow(flow: InsertWhaleFlow): Promise<WhaleFlow> {
    const [created] = await db.insert(whaleFlows).values(flow).returning();
    return created;
  }

  async updateWhaleFlowOutcome(id: string, updates: { outcomeStatus: OutcomeStatus; finalPnL?: number }): Promise<WhaleFlow | undefined> {
    const [updated] = await db.update(whaleFlows)
      .set(updates)
      .where(eq(whaleFlows.id, id))
      .returning();
    return updated;
  }

  async getRecentWhaleFlows(limit: number = 20): Promise<WhaleFlow[]> {
    return await db.select().from(whaleFlows)
      .orderBy(desc(whaleFlows.detectedAt))
      .limit(limit);
  }

  async getMegaWhaleFlows(days: number = 30): Promise<WhaleFlow[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString();

    return await db.select().from(whaleFlows)
      .where(and(
        eq(whaleFlows.isMegaWhale, true),
        gte(whaleFlows.detectedAt, cutoffStr)
      ))
      .orderBy(desc(whaleFlows.detectedAt));
  }

  // Research History Methods
  async getResearchHistory(userId: string, filters?: { symbol?: string; year?: number; action?: string; limit?: number }): Promise<ResearchHistoryRecord[]> {
    const conditions = [eq(researchHistory.userId, userId)];
    if (filters?.symbol) conditions.push(eq(researchHistory.symbol, filters.symbol));
    if (filters?.action) conditions.push(eq(researchHistory.actionTaken, filters.action as any));
    
    let query = db.select().from(researchHistory)
      .where(and(...conditions))
      .orderBy(desc(researchHistory.viewedAt));
    
    if (filters?.limit) {
      return await query.limit(filters.limit);
    }
    return await query;
  }

  async getResearchHistoryBySignal(userId: string, signalId: string): Promise<ResearchHistoryRecord | undefined> {
    const [record] = await db.select().from(researchHistory)
      .where(and(eq(researchHistory.userId, userId), eq(researchHistory.signalId, signalId)))
      .limit(1);
    return record;
  }

  async createResearchHistory(record: InsertResearchHistory): Promise<ResearchHistoryRecord> {
    const [created] = await db.insert(researchHistory).values(record).returning();
    return created;
  }

  async updateResearchHistory(id: string, updates: Partial<ResearchHistoryRecord>): Promise<ResearchHistoryRecord | undefined> {
    const [updated] = await db.update(researchHistory)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(researchHistory.id, id))
      .returning();
    return updated;
  }

  async getUserResearchStats(userId: string, year?: number): Promise<{ total: number; traded: number; watched: number; ignored: number; winRate: number; avgReturn: number; topPatterns: { pattern: string; winRate: number; count: number }[] }> {
    const history = await this.getResearchHistory(userId, { year });
    const traded = history.filter(h => h.actionTaken === 'traded');
    const wins = traded.filter(t => t.outcome === 'hit_target').length;
    const losses = traded.filter(t => t.outcome === 'hit_stop').length;
    
    const patternCounts: Record<string, { wins: number; total: number }> = {};
    traded.forEach(t => {
      (t.signalPatterns || []).forEach(p => {
        if (!patternCounts[p]) patternCounts[p] = { wins: 0, total: 0 };
        patternCounts[p].total++;
        if (t.outcome === 'hit_target') patternCounts[p].wins++;
      });
    });
    
    const topPatterns = Object.entries(patternCounts)
      .map(([pattern, stats]) => ({ pattern, winRate: (stats.wins / stats.total) * 100, count: stats.total }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total: history.length,
      traded: traded.length,
      watched: history.filter(h => h.actionTaken === 'watched').length,
      ignored: history.filter(h => h.actionTaken === 'ignored').length,
      winRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
      avgReturn: traded.length > 0 ? traded.reduce((sum, t) => sum + (t.outcomeReturn || 0), 0) / traded.length : 0,
      topPatterns,
    };
  }

  async getSymbolResearchHistory(userId: string, symbol: string): Promise<{ timesWatched: number; timesTraded: number; yourWinRate: number; lessonLearned: string | null; lastOutcome: string | null }> {
    const history = await this.getResearchHistory(userId, { symbol });
    const traded = history.filter(h => h.actionTaken === 'traded');
    const wins = traded.filter(t => t.outcome === 'hit_target').length;
    const losses = traded.filter(t => t.outcome === 'hit_stop').length;
    const lastTrade = traded[0];
    return {
      timesWatched: history.filter(h => h.actionTaken === 'watched').length,
      timesTraded: traded.length,
      yourWinRate: (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0,
      lessonLearned: lastTrade?.lessonLearned || null,
      lastOutcome: lastTrade?.outcome || null,
    };
  }

  // Options Data Methods
  async getOptionsBySymbol(symbol: string): Promise<OptionsData[]> {
    return await db.select().from(optionsDataTable).where(eq(optionsDataTable.symbol, symbol));
  }

  async createOptionsData(data: InsertOptionsData): Promise<OptionsData> {
    const [created] = await db.insert(optionsDataTable).values(data).returning();
    return created;
  }

  // User Preferences Methods
  async getUserPreferences(): Promise<UserPreferences | undefined> {
    const [prefs] = await db.select().from(userPreferencesTable);
    return prefs || undefined;
  }

  async updateUserPreferences(prefs: Partial<InsertUserPreferences>): Promise<UserPreferences> {
    const existing = await this.getUserPreferences();
    
    if (!existing) {
      // Create default values, then override with provided prefs (excluding undefined userId)
      const { userId: _userId, ...prefsWithoutUserId } = prefs;
      const [created] = await db.insert(userPreferencesTable).values({
        userId: "default_user", // Always set userId for new records
        accountSize: 10000,
        maxRiskPerTrade: 1,
        defaultCapitalPerIdea: 1000,
        defaultOptionsBudget: 250,
        preferredAssets: ["stock", "option", "crypto"],
        holdingHorizon: "intraday",
        theme: "dark",
        timezone: "America/Chicago",
        defaultViewMode: "card",
        compactMode: false,
        discordWebhookUrl: null,
        enableTradeAlerts: true,
        enablePriceAlerts: true,
        enablePerformanceAlerts: false,
        enableWeeklyReport: false,
        defaultAssetFilter: "all",
        defaultConfidenceFilter: "all",
        autoRefreshEnabled: true,
        ...prefsWithoutUserId, // Spread after defaults, but without userId
      }).returning();
      return created;
    } else {
      const [updated] = await db.update(userPreferencesTable)
        .set(prefs)
        .where(eq(userPreferencesTable.id, existing.id))
        .returning();
      return updated;
    }
  }

  async getUserPreferencesByUserId(userId: string): Promise<UserPreferences | undefined> {
    const [prefs] = await db.select().from(userPreferencesTable)
      .where(eq(userPreferencesTable.userId, userId));
    return prefs || undefined;
  }

  async updateUserPreferencesByUserId(userId: string, prefs: Partial<InsertUserPreferences>): Promise<UserPreferences> {
    const existing = await this.getUserPreferencesByUserId(userId);
    
    if (!existing) {
      const [created] = await db.insert(userPreferencesTable).values({
        userId,
        accountSize: 10000,
        maxRiskPerTrade: 1,
        defaultCapitalPerIdea: 1000,
        defaultOptionsBudget: 250,
        preferredAssets: ["stock", "option", "crypto"],
        holdingHorizon: "intraday",
        theme: "dark",
        timezone: "America/Chicago",
        defaultViewMode: "card",
        compactMode: false,
        enableTradeAlerts: true,
        enablePriceAlerts: true,
        enablePerformanceAlerts: false,
        enableWeeklyReport: false,
        defaultAssetFilter: "all",
        defaultConfidenceFilter: "all",
        autoRefreshEnabled: true,
        ...prefs,
      }).returning();
      return created;
    } else {
      const [updated] = await db.update(userPreferencesTable)
        .set({ ...prefs, updatedAt: new Date() })
        .where(eq(userPreferencesTable.userId, userId))
        .returning();
      return updated;
    }
  }

  // User Page Layouts Methods
  async getUserPageLayout(userId: string, pageId: string): Promise<UserPageLayout | undefined> {
    const [layout] = await db.select().from(userPageLayouts)
      .where(and(
        eq(userPageLayouts.userId, userId),
        eq(userPageLayouts.pageId, pageId)
      ));
    return layout || undefined;
  }

  async getUserPageLayouts(userId: string): Promise<UserPageLayout[]> {
    return await db.select().from(userPageLayouts)
      .where(eq(userPageLayouts.userId, userId));
  }

  async saveUserPageLayout(layout: InsertUserPageLayout): Promise<UserPageLayout> {
    const existing = await this.getUserPageLayout(layout.userId, layout.pageId);
    
    if (existing) {
      const [updated] = await db.update(userPageLayouts)
        .set({ ...layout, updatedAt: new Date() })
        .where(eq(userPageLayouts.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(userPageLayouts)
        .values(layout)
        .returning();
      return created;
    }
  }

  async deleteUserPageLayout(userId: string, pageId: string): Promise<boolean> {
    const result = await db.delete(userPageLayouts)
      .where(and(
        eq(userPageLayouts.userId, userId),
        eq(userPageLayouts.pageId, pageId)
      ));
    return true;
  }

  async getLayoutPresets(pageId: string): Promise<LayoutPreset[]> {
    return await db.select().from(layoutPresets)
      .where(eq(layoutPresets.pageId, pageId))
      .orderBy(layoutPresets.sortOrder);
  }

  // Chat History Methods (in-memory for now - not in schema)
  async getChatHistory(): Promise<ChatMessage[]> {
    return Array.from(this.chatHistory.values()).sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async addChatMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>): Promise<ChatMessage> {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const chatMessage: ChatMessage = { ...message, id, timestamp };
    this.chatHistory.set(id, chatMessage);
    return chatMessage;
  }

  async clearChatHistory(): Promise<void> {
    this.chatHistory.clear();
  }

  // Futures Contracts Methods
  async getFuturesContract(contractCode: string): Promise<FuturesContract | null> {
    const [contract] = await db.select()
      .from(futuresContracts)
      .where(eq(futuresContracts.contractCode, contractCode));
    return contract || null;
  }

  async getFuturesContractsByRoot(rootSymbol: string): Promise<FuturesContract[]> {
    return await db.select()
      .from(futuresContracts)
      .where(eq(futuresContracts.rootSymbol, rootSymbol));
  }

  async getActiveFuturesContract(rootSymbol: string): Promise<FuturesContract | null> {
    const [contract] = await db.select()
      .from(futuresContracts)
      .where(
        and(
          eq(futuresContracts.rootSymbol, rootSymbol),
          eq(futuresContracts.isFrontMonth, true)
        )
      );
    return contract || null;
  }

  async updateFuturesContract(contractCode: string, updates: Partial<FuturesContract>): Promise<FuturesContract> {
    const [updated] = await db.update(futuresContracts)
      .set(updates)
      .where(eq(futuresContracts.contractCode, contractCode))
      .returning();
    
    if (!updated) {
      throw new Error(`Futures contract not found: ${contractCode}`);
    }
    
    return updated;
  }

  // Futures Research Briefs Methods
  async getAllFuturesResearchBriefs(): Promise<FuturesResearchBrief[]> {
    return await db.select()
      .from(futuresResearchBriefs)
      .orderBy(desc(futuresResearchBriefs.generatedAt));
  }

  async getActiveFuturesResearchBriefs(): Promise<FuturesResearchBrief[]> {
    return await db.select()
      .from(futuresResearchBriefs)
      .where(eq(futuresResearchBriefs.isActive, true))
      .orderBy(desc(futuresResearchBriefs.generatedAt));
  }

  async getFuturesResearchBriefBySymbol(symbol: string): Promise<FuturesResearchBrief | null> {
    const [brief] = await db.select()
      .from(futuresResearchBriefs)
      .where(and(
        eq(futuresResearchBriefs.symbol, symbol),
        eq(futuresResearchBriefs.isActive, true)
      ))
      .orderBy(desc(futuresResearchBriefs.generatedAt))
      .limit(1);
    return brief || null;
  }

  async createFuturesResearchBrief(brief: InsertFuturesResearchBrief): Promise<FuturesResearchBrief> {
    const [created] = await db.insert(futuresResearchBriefs)
      .values(brief)
      .returning();
    return created;
  }

  async updateFuturesResearchBrief(id: string, updates: Partial<FuturesResearchBrief>): Promise<FuturesResearchBrief | null> {
    const [updated] = await db.update(futuresResearchBriefs)
      .set(updates)
      .where(eq(futuresResearchBriefs.id, id))
      .returning();
    return updated || null;
  }

  async deactivateFuturesResearchBrief(id: string): Promise<boolean> {
    const [updated] = await db.update(futuresResearchBriefs)
      .set({ isActive: false })
      .where(eq(futuresResearchBriefs.id, id))
      .returning();
    return !!updated;
  }

  async deactivateOldFuturesResearchBriefs(symbol: string): Promise<void> {
    await db.update(futuresResearchBriefs)
      .set({ isActive: false })
      .where(eq(futuresResearchBriefs.symbol, symbol));
  }

  // 🔐 Model Cards Methods (Governance & Auditability)
  async getAllModelCards(): Promise<ModelCard[]> {
    return await db.select().from(modelCardsTable).orderBy(desc(modelCardsTable.createdAt));
  }

  async getModelCardByVersion(engineVersion: string): Promise<ModelCard | undefined> {
    const [card] = await db.select().from(modelCardsTable).where(eq(modelCardsTable.engineVersion, engineVersion));
    return card || undefined;
  }

  async createModelCard(card: InsertModelCard): Promise<ModelCard> {
    const [created] = await db.insert(modelCardsTable).values(card).returning();
    return created;
  }

  async updateModelCard(engineVersion: string, updates: Partial<ModelCard>): Promise<ModelCard | undefined> {
    const [updated] = await db.update(modelCardsTable)
      .set(updates)
      .where(eq(modelCardsTable.engineVersion, engineVersion))
      .returning();
    return updated || undefined;
  }

  async getActiveModelCard(): Promise<ModelCard | undefined> {
    const [card] = await db.select().from(modelCardsTable)
      .where(eq(modelCardsTable.status, 'active'))
      .orderBy(desc(modelCardsTable.createdAt))
      .limit(1);
    return card || undefined;
  }

  // Daily Usage Tracking Methods
  async getDailyUsage(userId: string, date: string): Promise<DailyUsage | null> {
    const [usage] = await db.select().from(dailyUsageTable)
      .where(and(
        eq(dailyUsageTable.userId, userId),
        eq(dailyUsageTable.date, date)
      ));
    return usage || null;
  }

  async incrementDailyUsage(userId: string, field: 'ideasViewed' | 'aiChatMessages' | 'chartAnalyses'): Promise<DailyUsage> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Try to get existing record
    let existing = await this.getDailyUsage(userId, today);
    
    if (!existing) {
      // Create new record for today
      const [created] = await db.insert(dailyUsageTable).values({
        userId,
        date: today,
        ideasViewed: field === 'ideasViewed' ? 1 : 0,
        aiChatMessages: field === 'aiChatMessages' ? 1 : 0,
        chartAnalyses: field === 'chartAnalyses' ? 1 : 0,
      }).returning();
      return created;
    }
    
    // Increment the specified field
    const increment = { [field]: (existing[field] || 0) + 1 };
    const [updated] = await db.update(dailyUsageTable)
      .set(increment)
      .where(eq(dailyUsageTable.id, existing.id))
      .returning();
    return updated;
  }

  // User-filtered Trade Ideas
  async getTradeIdeasByUser(userId: string): Promise<TradeIdea[]> {
    return await db.select().from(tradeIdeas)
      .where(eq(tradeIdeas.userId, userId))
      .orderBy(desc(tradeIdeas.timestamp));
  }

  // Get system-generated ideas (userId is NULL) plus user's own ideas
  // Filter out expired and closed trades to show only relevant active positions
  async getTradeIdeasForUser(userId: string): Promise<TradeIdea[]> {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // Last 24 hours

    return await db.select().from(tradeIdeas)
      .where(and(
        or(
          isNull(tradeIdeas.userId),  // System-generated ideas
          eq(tradeIdeas.userId, userId)  // User's own ideas
        ),
        // Filter out closed trades
        not(or(
          eq(tradeIdeas.outcomeStatus, 'won'),
          eq(tradeIdeas.outcomeStatus, 'lost'),
          eq(tradeIdeas.outcomeStatus, 'closed')
        )),
        // Filter out expired options (expiryDate < now)
        or(
          isNull(tradeIdeas.expiryDate),  // Not an option, or no expiry set
          gte(tradeIdeas.expiryDate, now.toISOString())  // Not yet expired
        ),
        // Only recent trades (last 24 hours)
        gte(tradeIdeas.timestamp, cutoffTime.toISOString())
      ))
      .orderBy(desc(tradeIdeas.timestamp))
      .limit(1000); // Safety limit
  }

  // Active Trades (Live Position Tracking)
  async getActiveTrades(userId: string): Promise<ActiveTrade[]> {
    return await db.select().from(activeTradesTable)
      .where(eq(activeTradesTable.userId, userId))
      .orderBy(desc(activeTradesTable.createdAt));
  }

  async getActiveTradeById(id: string): Promise<ActiveTrade | undefined> {
    const [trade] = await db.select().from(activeTradesTable)
      .where(eq(activeTradesTable.id, id));
    return trade || undefined;
  }

  async createActiveTrade(trade: InsertActiveTrade): Promise<ActiveTrade> {
    const [created] = await db.insert(activeTradesTable).values(trade as any).returning();
    return created;
  }

  async updateActiveTrade(id: string, updates: Partial<ActiveTrade>): Promise<ActiveTrade | undefined> {
    const [updated] = await db.update(activeTradesTable)
      .set(updates)
      .where(eq(activeTradesTable.id, id))
      .returning();
    return updated || undefined;
  }

  async closeActiveTrade(id: string, exitPrice: number): Promise<ActiveTrade | undefined> {
    const trade = await this.getActiveTradeById(id);
    if (!trade) return undefined;

    const now = new Date().toISOString();
    const realizedPnL = (exitPrice - trade.entryPrice) * trade.quantity * (trade.direction === 'short' ? -1 : 1) * 100; // Options are 100x
    const realizedPnLPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.direction === 'short' ? -1 : 1);

    const [updated] = await db.update(activeTradesTable)
      .set({
        status: 'closed' as ActiveTradeStatus,
        exitPrice,
        exitTime: now,
        realizedPnL,
        realizedPnLPercent,
      })
      .where(eq(activeTradesTable.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteActiveTrade(id: string): Promise<boolean> {
    const result = await db.delete(activeTradesTable)
      .where(eq(activeTradesTable.id, id));
    return true;
  }

  // ==========================================
  // PAPER TRADING - Portfolio Operations
  // ==========================================

  async createPaperPortfolio(portfolio: InsertPaperPortfolio): Promise<PaperPortfolio> {
    const [created] = await db.insert(paperPortfoliosTable).values(portfolio).returning();
    return created;
  }

  async getPaperPortfoliosByUser(userId: string): Promise<PaperPortfolio[]> {
    return await db.select().from(paperPortfoliosTable)
      .where(eq(paperPortfoliosTable.userId, userId))
      .orderBy(desc(paperPortfoliosTable.createdAt));
  }

  async getAllPaperPortfolios(): Promise<PaperPortfolio[]> {
    return await db.select().from(paperPortfoliosTable)
      .orderBy(desc(paperPortfoliosTable.createdAt));
  }

  async getPaperPortfolioById(id: string): Promise<PaperPortfolio | undefined> {
    const [portfolio] = await db.select().from(paperPortfoliosTable)
      .where(eq(paperPortfoliosTable.id, id));
    return portfolio || undefined;
  }

  async updatePaperPortfolio(id: string, updates: Partial<PaperPortfolio>): Promise<PaperPortfolio | undefined> {
    // DEFENSIVE CHECK: Prevent negative cash balance updates
    // This ensures bots can't accidentally overdraw accounts
    if (updates.cashBalance !== undefined && updates.cashBalance < 0) {
      console.warn(`[STORAGE] ⚠️ Attempted to set negative cash balance: $${updates.cashBalance.toFixed(2)} for portfolio ${id}`);
      console.warn(`[STORAGE] ⚠️ This indicates a bug in position sizing or P&L calculation. Clamping to $0.`);
      // Clamp to 0 - this prevents cascading errors but indicates a bug that needs fixing
      updates.cashBalance = 0;
    }
    
    const [updated] = await db.update(paperPortfoliosTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(paperPortfoliosTable.id, id))
      .returning();
    return updated || undefined;
  }
  
  // Helper to validate cash before opening a position
  async validateCashForTrade(portfolioId: string, requiredCash: number): Promise<{ valid: boolean; available: number; error?: string }> {
    const portfolio = await this.getPaperPortfolioById(portfolioId);
    if (!portfolio) {
      return { valid: false, available: 0, error: 'Portfolio not found' };
    }
    if (portfolio.cashBalance < requiredCash) {
      return { 
        valid: false, 
        available: portfolio.cashBalance, 
        error: `Insufficient cash: need $${requiredCash.toFixed(2)}, have $${portfolio.cashBalance.toFixed(2)}` 
      };
    }
    return { valid: true, available: portfolio.cashBalance };
  }

  async deletePaperPortfolio(id: string): Promise<boolean> {
    await db.delete(paperPositionsTable).where(eq(paperPositionsTable.portfolioId, id));
    await db.delete(paperEquitySnapshotsTable).where(eq(paperEquitySnapshotsTable.portfolioId, id));
    await db.delete(paperPortfoliosTable).where(eq(paperPortfoliosTable.id, id));
    return true;
  }

  // ==========================================
  // PAPER TRADING - Position Operations
  // ==========================================

  async createPaperPosition(position: InsertPaperPosition): Promise<PaperPosition> {
    const insertData = {
      portfolioId: position.portfolioId,
      symbol: position.symbol,
      assetType: position.assetType as AssetType,
      direction: position.direction,
      entryPrice: position.entryPrice,
      quantity: position.quantity,
      entryTime: position.entryTime || new Date().toISOString(),
      tradeIdeaId: position.tradeIdeaId ?? undefined,
      optionType: position.optionType ?? undefined,
      strikePrice: position.strikePrice ?? undefined,
      expiryDate: position.expiryDate ?? undefined,
      targetPrice: position.targetPrice ?? undefined,
      stopLoss: position.stopLoss ?? undefined,
      currentPrice: position.currentPrice ?? undefined,
      lastPriceUpdate: position.lastPriceUpdate ?? undefined,
      unrealizedPnL: position.unrealizedPnL ?? undefined,
      unrealizedPnLPercent: position.unrealizedPnLPercent ?? undefined,
      status: (position.status ?? 'open') as PaperTradeStatus,
    };
    const [created] = await db.insert(paperPositionsTable).values(insertData).returning();

    // Paper positions are the execution ledger. Mark the linked Oracle idea
    // here, at the single shared persistence boundary, so every bot/manual
    // path has the same proof-of-entry semantics.
    if (created.tradeIdeaId) {
      const [idea] = await db.select().from(tradeIdeas).where(eq(tradeIdeas.id, created.tradeIdeaId)).limit(1);
      if (idea) {
        await db.update(tradeIdeas)
          .set({
            convergenceSignalsJson: recordPaperExecution(idea.convergenceSignalsJson, {
              price: created.entryPrice,
              at: created.entryTime,
              paperPositionId: created.id,
            }) as any,
          })
          .where(eq(tradeIdeas.id, idea.id));
      }
    }
    return created;
  }

  async getPaperPositionsByPortfolio(portfolioId: string): Promise<PaperPosition[]> {
    return await db.select().from(paperPositionsTable)
      .where(eq(paperPositionsTable.portfolioId, portfolioId))
      .orderBy(desc(paperPositionsTable.createdAt));
  }

  async getPaperPositionById(id: string): Promise<PaperPosition | undefined> {
    const [position] = await db.select().from(paperPositionsTable)
      .where(eq(paperPositionsTable.id, id));
    return position || undefined;
  }

  async updatePaperPosition(id: string, updates: Partial<PaperPosition>): Promise<PaperPosition | undefined> {
    const [updated] = await db.update(paperPositionsTable)
      .set(updates)
      .where(eq(paperPositionsTable.id, id))
      .returning();
    return updated || undefined;
  }

  async closePaperPosition(id: string, exitPrice: number, exitReason: string): Promise<PaperPosition | undefined> {
    const position = await this.getPaperPositionById(id);
    if (!position) return undefined;

    const now = new Date().toISOString();
    
    // Calculate proper multiplier based on asset type
    let multiplier = 1;
    if (position.assetType === 'option') {
      multiplier = 100; // Options: 100 shares per contract
    } else if (position.assetType === 'future') {
      // Futures use point-based P&L calculation
      const symbol = position.symbol || '';
      if (symbol.startsWith('NQ') || symbol === 'NQ') {
        multiplier = 20; // NQ: $20 per point
      } else if (symbol.startsWith('GC') || symbol === 'GC') {
        multiplier = 100; // GC: $100 per point (10 per tick, 10 ticks per point)
      } else {
        multiplier = 20; // Default to NQ
      }
    }
    
    // A BOUGHT option is a LONG position in the contract regardless of whether it
    // is a call or a put. You pay the premium and profit if the premium rises; the
    // bearish view is already expressed by owning the put, and inverting the P&L on
    // top of that double-counts it.
    //
    // `direction` on these rows records the thesis about the UNDERLYING, not the
    // side of the instrument, so feeding it in as a sign flipped every put: an IWM
    // $296P bought at 0.49 and expiring worthless was stored as +$147 instead of
    // −$147, and the bot reported a 100% win rate on a total loss.
    //
    // Stocks and futures keep the flip — there `direction` really is the side.
    const isBoughtOption = position.assetType === 'option';
    const directionMultiplier = isBoughtOption ? 1 : (position.direction === 'long' ? 1 : -1);
    const priceDiff = exitPrice - position.entryPrice;
    
    // For futures: P&L = price difference * multiplier * contracts
    // For options: P&L = price difference * 100 * contracts  
    // For stocks/crypto: P&L = price difference * quantity
    const realizedPnL = priceDiff * position.quantity * multiplier * directionMultiplier;
    const realizedPnLPercent = position.entryPrice > 0 
      ? (priceDiff / position.entryPrice) * 100 * directionMultiplier 
      : 0;

    const [updated] = await db.update(paperPositionsTable)
      .set({
        status: 'closed' as PaperTradeStatus,
        exitPrice,
        exitTime: now,
        exitReason,
        realizedPnL,
        realizedPnLPercent,
      })
      .where(eq(paperPositionsTable.id, id))
      .returning();

    if (updated) {
      const portfolio = await this.getPaperPortfolioById(position.portfolioId);
      if (portfolio) {
        // For futures, we return margin + P&L
        // For options/stocks, we return notional cost + P&L
        let positionCost: number;
        if (position.assetType === 'future') {
          // Futures use margin-based position sizing
          // Since futures use margin and the P&L is the full gain/loss, just return the margin
          positionCost = 100; // Standard margin per contract for paper trading
        } else {
          positionCost = position.entryPrice * position.quantity * multiplier;
        }
        
        await this.updatePaperPortfolio(portfolio.id, {
          cashBalance: portfolio.cashBalance + positionCost + realizedPnL,
          totalPnL: portfolio.totalPnL + realizedPnL,
          winCount: realizedPnL > 0 ? portfolio.winCount + 1 : portfolio.winCount,
          lossCount: realizedPnL <= 0 ? portfolio.lossCount + 1 : portfolio.lossCount,
        });
      }
    }

    return updated || undefined;
  }

  // ==========================================
  // PAPER TRADING - Equity Snapshot Operations
  // ==========================================

  async createPaperEquitySnapshot(snapshot: InsertPaperEquitySnapshot): Promise<PaperEquitySnapshot> {
    const [created] = await db.insert(paperEquitySnapshotsTable).values(snapshot).returning();
    return created;
  }

  async getPaperEquitySnapshots(portfolioId: string, startDate?: string, endDate?: string): Promise<PaperEquitySnapshot[]> {
    let conditions = [eq(paperEquitySnapshotsTable.portfolioId, portfolioId)];
    
    if (startDate) {
      conditions.push(gte(paperEquitySnapshotsTable.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(paperEquitySnapshotsTable.date, endDate));
    }

    return await db.select().from(paperEquitySnapshotsTable)
      .where(and(...conditions))
      .orderBy(desc(paperEquitySnapshotsTable.date));
  }

  // 🛡️ COMPLIANCE: Count completed (closed) paper trades for a user
  // Required for paper trading enforcement before live trading access
  async getCompletedPaperTradesCount(userId: string): Promise<number> {
    // Get all portfolios for this user
    const portfolios = await this.getPaperPortfoliosByUser(userId);
    if (portfolios.length === 0) return 0;
    
    // Count closed positions across all portfolios
    let totalClosedTrades = 0;
    for (const portfolio of portfolios) {
      const positions = await db.select().from(paperPositionsTable)
        .where(and(
          eq(paperPositionsTable.portfolioId, portfolio.id),
          eq(paperPositionsTable.status, 'closed')
        ));
      totalClosedTrades += positions.length;
    }
    
    return totalClosedTrades;
  }

  // CT Ingestion
  async createCTSource(source: InsertCTSource): Promise<CTSource> {
    const [created] = await db.insert(ctSources).values(source as any).returning();
    return created;
  }

  async getCTSources(): Promise<CTSource[]> {
    return await db.select().from(ctSources);
  }

  async createCTMention(mention: InsertCTMention): Promise<CTMention> {
    const [created] = await db.insert(ctMentions).values(mention as any).returning();
    return created;
  }

  async getCTMentions(hours?: number): Promise<CTMention[]> {
    if (hours) {
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
      return await db.select().from(ctMentions)
        .where(gte(ctMentions.timestamp, cutoff))
        .orderBy(desc(ctMentions.timestamp));
    }
    return await db.select().from(ctMentions).orderBy(desc(ctMentions.timestamp));
  }

  async getCTCallPerformance(mentionId: number): Promise<CTCallPerformance | undefined> {
    const [performance] = await db.select().from(ctCallPerformance)
      .where(eq(ctCallPerformance.mentionId, mentionId));
    return performance || undefined;
  }

  async updateCTCallPerformance(mentionId: number, updates: Partial<CTCallPerformance>): Promise<CTCallPerformance> {
    const performance = await this.getCTCallPerformance(mentionId);
    if (performance) {
      const [updated] = await db.update(ctCallPerformance)
        .set({ ...updates, lastCheckedAt: new Date() })
        .where(eq(ctCallPerformance.id, performance.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(ctCallPerformance).values({
      mentionId,
      entryPrice: updates.entryPrice || 0,
      currentPrice: updates.currentPrice || null,
      maxPriceReached: updates.maxPriceReached || null,
      percentChange: updates.percentChange || null,
      status: updates.status || 'active',
      lastCheckedAt: new Date(),
    } as any).returning();
    return created;
  }

  async getCTSourceById(id: string): Promise<CTSource | undefined> {
    const [source] = await db.select().from(ctSources).where(eq(ctSources.id, id));
    return source || undefined;
  }

  async updateCTSource(id: string, updates: Partial<CTSource>): Promise<CTSource> {
    const [updated] = await db.update(ctSources)
      .set(updates as any)
      .where(eq(ctSources.id, id))
      .returning();
    return updated;
  }

  async deleteCTSource(id: string): Promise<boolean> {
    await db.delete(ctMentions).where(eq(ctMentions.sourceId, id));
    await db.delete(ctSources).where(eq(ctSources.id, id));
    return true;
  }

  async getCTMentionsByTicker(ticker: string, hours?: number): Promise<CTMention[]> {
    const normalizedTicker = ticker.startsWith('$') ? ticker : `$${ticker}`;
    const allMentions = await this.getCTMentions(hours);
    return allMentions.filter(m => m.tickers?.includes(normalizedTicker));
  }

  async getCTMentionsBySentiment(sentiment: string, hours?: number): Promise<CTMention[]> {
    const allMentions = await this.getCTMentions(hours);
    return allMentions.filter(m => m.sentiment === sentiment);
  }

  async getCTCallPerformanceStats(): Promise<{ totalCalls: number; wins: number; losses: number; winRate: number }> {
    const allPerformance = await db.select().from(ctCallPerformance);
    const wins = allPerformance.filter(p => p.status === 'win').length;
    const losses = allPerformance.filter(p => p.status === 'loss').length;
    const totalCalls = allPerformance.length;
    const winRate = totalCalls > 0 ? (wins / (wins + losses)) * 100 : 0;
    return { totalCalls, wins, losses, winRate };
  }

  // ==========================================
  // WALLET TRACKER OPERATIONS
  // ==========================================

  async getTrackedWallets(userId: string): Promise<TrackedWallet[]> {
    return await db.select().from(trackedWallets)
      .where(eq(trackedWallets.userId, userId))
      .orderBy(desc(trackedWallets.createdAt));
  }

  async getTrackedWalletById(id: string): Promise<TrackedWallet | undefined> {
    const [wallet] = await db.select().from(trackedWallets).where(eq(trackedWallets.id, id));
    return wallet || undefined;
  }

  async createTrackedWallet(wallet: InsertTrackedWallet): Promise<TrackedWallet> {
    const [created] = await db.insert(trackedWallets).values(wallet as any).returning();
    return created;
  }

  async deleteTrackedWallet(id: string): Promise<boolean> {
    await db.delete(walletHoldings).where(eq(walletHoldings.walletId, id));
    await db.delete(walletTransactions).where(eq(walletTransactions.walletId, id));
    await db.delete(walletAlerts).where(eq(walletAlerts.walletId, id));
    await db.delete(trackedWallets).where(eq(trackedWallets.id, id));
    return true;
  }

  async updateTrackedWallet(id: string, updates: Partial<TrackedWallet>): Promise<TrackedWallet | undefined> {
    const [updated] = await db.update(trackedWallets)
      .set(updates)
      .where(eq(trackedWallets.id, id))
      .returning();
    return updated || undefined;
  }

  async getWalletHoldings(walletId: string): Promise<WalletHolding[]> {
    return await db.select().from(walletHoldings)
      .where(eq(walletHoldings.walletId, walletId));
  }

  async createWalletHolding(holding: InsertWalletHolding): Promise<WalletHolding> {
    const [created] = await db.insert(walletHoldings).values(holding as any).returning();
    return created;
  }

  async updateWalletHolding(id: string, updates: Partial<WalletHolding>): Promise<WalletHolding | undefined> {
    const [updated] = await db.update(walletHoldings)
      .set(updates)
      .where(eq(walletHoldings.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteWalletHoldings(walletId: string): Promise<boolean> {
    await db.delete(walletHoldings).where(eq(walletHoldings.walletId, walletId));
    return true;
  }

  async getWalletTransactions(walletId: string, limit?: number): Promise<WalletTransaction[]> {
    const query = db.select().from(walletTransactions)
      .where(eq(walletTransactions.walletId, walletId))
      .orderBy(desc(walletTransactions.createdAt));
    
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getWhaleActivity(userId: string, limit: number = 50): Promise<WalletTransaction[]> {
    const userWallets = await this.getTrackedWallets(userId);
    const walletIds = userWallets.map(w => w.id);
    
    if (walletIds.length === 0) {
      return [];
    }

    const transactions = await db.select().from(walletTransactions)
      .where(eq(walletTransactions.isLargeTransaction, true))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(limit);
    
    return transactions.filter(tx => walletIds.includes(tx.walletId));
  }

  async createWalletTransaction(tx: InsertWalletTransaction): Promise<WalletTransaction> {
    const [created] = await db.insert(walletTransactions).values(tx as any).returning();
    return created;
  }

  async getWalletAlerts(userId: string): Promise<WalletAlert[]> {
    return await db.select().from(walletAlerts)
      .where(eq(walletAlerts.userId, userId))
      .orderBy(desc(walletAlerts.createdAt));
  }

  async getWalletAlertById(id: string): Promise<WalletAlert | undefined> {
    const [alert] = await db.select().from(walletAlerts).where(eq(walletAlerts.id, id));
    return alert || undefined;
  }

  async createWalletAlert(alert: InsertWalletAlert): Promise<WalletAlert> {
    const [created] = await db.insert(walletAlerts).values(alert as any).returning();
    return created;
  }

  async deleteWalletAlert(id: string): Promise<boolean> {
    await db.delete(walletAlerts).where(eq(walletAlerts.id, id));
    return true;
  }

  // ==========================================
  // TELEMETRY OPERATIONS
  // ==========================================

  // Trade Input Snapshots
  async saveTradeInputSnapshot(snapshot: InsertTradeInputSnapshot): Promise<TradeInputSnapshot> {
    const [created] = await db.insert(tradeInputSnapshots).values(snapshot as any).returning();
    return created;
  }

  async getTradeInputSnapshot(tradeIdeaId: string): Promise<TradeInputSnapshot | null> {
    const [snapshot] = await db.select().from(tradeInputSnapshots)
      .where(eq(tradeInputSnapshots.tradeIdeaId, tradeIdeaId));
    return snapshot || null;
  }

  // Engine Daily Metrics
  async saveEngineDailyMetrics(metrics: InsertEngineDailyMetrics): Promise<EngineDailyMetrics> {
    const [created] = await db.insert(engineDailyMetrics).values(metrics as any).returning();
    return created;
  }

  async getEngineDailyMetrics(date: string, engine?: EngineSource): Promise<EngineDailyMetrics[]> {
    if (engine) {
      return await db.select().from(engineDailyMetrics)
        .where(and(
          eq(engineDailyMetrics.date, date),
          eq(engineDailyMetrics.engine, engine)
        ));
    }
    return await db.select().from(engineDailyMetrics)
      .where(eq(engineDailyMetrics.date, date));
  }

  async getEngineMetricsRange(startDate: string, endDate: string, engine?: EngineSource): Promise<EngineDailyMetrics[]> {
    if (engine) {
      return await db.select().from(engineDailyMetrics)
        .where(and(
          gte(engineDailyMetrics.date, startDate),
          lte(engineDailyMetrics.date, endDate),
          eq(engineDailyMetrics.engine, engine)
        ))
        .orderBy(desc(engineDailyMetrics.date));
    }
    return await db.select().from(engineDailyMetrics)
      .where(and(
        gte(engineDailyMetrics.date, startDate),
        lte(engineDailyMetrics.date, endDate)
      ))
      .orderBy(desc(engineDailyMetrics.date));
  }

  // Engine Health Alerts
  async saveEngineHealthAlert(alert: InsertEngineHealthAlert): Promise<EngineHealthAlert> {
    const [created] = await db.insert(engineHealthAlerts).values(alert as any).returning();
    return created;
  }

  async getActiveHealthAlerts(): Promise<EngineHealthAlert[]> {
    return await db.select().from(engineHealthAlerts)
      .where(eq(engineHealthAlerts.acknowledged, false))
      .orderBy(desc(engineHealthAlerts.createdAt));
  }

  async acknowledgeHealthAlert(id: string, userId: string): Promise<void> {
    await db.update(engineHealthAlerts)
      .set({
        acknowledged: true,
        acknowledgedBy: userId,
        acknowledgedAt: new Date().toISOString(),
      })
      .where(eq(engineHealthAlerts.id, id));
  }

  // Trade Audit Trail - Price Snapshots
  async savePriceSnapshot(snapshot: InsertTradePriceSnapshot): Promise<TradePriceSnapshot> {
    const [created] = await db.insert(tradePriceSnapshots).values(snapshot as any).returning();
    return created;
  }

  async getPriceSnapshots(tradeIdeaId: string): Promise<TradePriceSnapshot[]> {
    return await db.select().from(tradePriceSnapshots)
      .where(eq(tradePriceSnapshots.tradeIdeaId, tradeIdeaId))
      .orderBy(desc(tradePriceSnapshots.createdAt));
  }

  async getTradeAuditTrail(tradeIdeaId: string): Promise<{
    tradeIdea: TradeIdea | null;
    priceSnapshots: TradePriceSnapshot[];
  }> {
    const [tradeIdea, priceSnapshots] = await Promise.all([
      this.getTradeIdeaById(tradeIdeaId),
      this.getPriceSnapshots(tradeIdeaId),
    ]);
    return { tradeIdea: tradeIdea ?? null, priceSnapshots };
  }

  // ==========================================
  // BLOG POSTS CMS
  // ==========================================

  async getBlogPosts(status?: BlogPostStatus): Promise<BlogPost[]> {
    if (status) {
      return await db.select().from(blogPosts)
        .where(eq(blogPosts.status, status))
        .orderBy(desc(blogPosts.publishedAt));
    }
    return await db.select().from(blogPosts)
      .orderBy(desc(blogPosts.publishedAt));
  }

  async getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
    const [post] = await db.select().from(blogPosts)
      .where(eq(blogPosts.slug, slug));
    return post || null;
  }

  async createBlogPost(post: InsertBlogPost): Promise<BlogPost> {
    const [created] = await db.insert(blogPosts).values({
      ...post,
      publishedAt: post.status === 'published' ? new Date() : null,
    } as any).returning();
    return created;
  }

  async updateBlogPost(id: string, updates: Partial<InsertBlogPost>): Promise<BlogPost | null> {
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    
    if (updates.status === 'published') {
      const [existing] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
      if (existing && !existing.publishedAt) {
        updateData.publishedAt = new Date();
      }
    }
    
    const [updated] = await db.update(blogPosts)
      .set(updateData)
      .where(eq(blogPosts.id, id))
      .returning();
    return updated || null;
  }

  async deleteBlogPost(id: string): Promise<boolean> {
    await db.delete(blogPosts).where(eq(blogPosts.id, id));
    return true;
  }

  // Loss Analysis - Post-Mortem for Failed Trades
  async createLossAnalysis(analysis: InsertLossAnalysis): Promise<LossAnalysis> {
    const [created] = await db.insert(lossAnalysis).values(analysis as any).returning();
    return created;
  }

  async getLossAnalysisByTradeId(tradeIdeaId: string): Promise<LossAnalysis | null> {
    const [result] = await db.select().from(lossAnalysis)
      .where(eq(lossAnalysis.tradeIdeaId, tradeIdeaId));
    return result || null;
  }

  async getAllLossAnalyses(): Promise<LossAnalysis[]> {
    return await db.select().from(lossAnalysis)
      .orderBy(desc(lossAnalysis.createdAt));
  }

  async getLossPatterns(): Promise<{ pattern: string; count: number; avgLoss: number }[]> {
    const results = await db.select({
      pattern: lossAnalysis.lossReason,
      count: drizzleSql<number>`count(*)::int`,
      avgLoss: drizzleSql<number>`avg(${lossAnalysis.percentLoss})::float`,
    })
    .from(lossAnalysis)
    .groupBy(lossAnalysis.lossReason)
    .orderBy(desc(drizzleSql`count(*)`));
    
    return results.map(r => ({
      pattern: r.pattern || 'unknown',
      count: r.count,
      avgLoss: r.avgLoss || 0,
    }));
  }

  // Auto Lotto Preferences
  async getAutoLottoPreferences(userId: string): Promise<AutoLottoPreferences | null> {
    const [result] = await db.select().from(autoLottoPreferences)
      .where(eq(autoLottoPreferences.userId, userId));
    return result || null;
  }

  async upsertAutoLottoPreferences(prefs: InsertAutoLottoPreferences): Promise<AutoLottoPreferences> {
    const existing = await this.getAutoLottoPreferences(prefs.userId);
    
    if (existing) {
      const [updated] = await db.update(autoLottoPreferences)
        .set({
          ...prefs as any,
          updatedAt: new Date(),
        })
        .where(eq(autoLottoPreferences.userId, prefs.userId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(autoLottoPreferences)
        .values(prefs as any)
        .returning();
      return created;
    }
  }

  // ==========================================
  // PLATFORM REPORTS - Daily/Weekly/Monthly Analytics
  // ==========================================

  async getPlatformReports(period?: ReportPeriod, limit: number = 50): Promise<PlatformReport[]> {
    if (period) {
      return await db.select().from(platformReports)
        .where(eq(platformReports.period, period))
        .orderBy(desc(platformReports.generatedAt))
        .limit(limit);
    }
    return await db.select().from(platformReports)
      .orderBy(desc(platformReports.generatedAt))
      .limit(limit);
  }

  async getPlatformReportById(id: string): Promise<PlatformReport | null> {
    const [report] = await db.select().from(platformReports)
      .where(eq(platformReports.id, id));
    return report || null;
  }

  async getLatestReportByPeriod(period: ReportPeriod): Promise<PlatformReport | null> {
    const [report] = await db.select().from(platformReports)
      .where(eq(platformReports.period, period))
      .orderBy(desc(platformReports.generatedAt))
      .limit(1);
    return report || null;
  }

  async createPlatformReport(report: InsertPlatformReport): Promise<PlatformReport> {
    const [created] = await db.insert(platformReports).values(report as any).returning();
    return created;
  }

  async updatePlatformReport(id: string, updates: Partial<InsertPlatformReport>): Promise<PlatformReport | null> {
    const [updated] = await db.update(platformReports)
      .set(updates as any)
      .where(eq(platformReports.id, id))
      .returning();
    return updated || null;
  }

  async deletePlatformReport(id: string): Promise<boolean> {
    await db.delete(platformReports).where(eq(platformReports.id, id));
    return true;
  }

  // ==========================================
  // USER ANALYTICS & TRACKING
  // ==========================================

  // Login History
  async createLoginRecord(record: InsertUserLoginHistory): Promise<UserLoginHistory> {
    const [created] = await db.insert(userLoginHistory).values(record as any).returning();
    return created;
  }

  async getLoginHistory(userId?: string, limit: number = 100): Promise<UserLoginHistory[]> {
    if (userId) {
      return await db.select().from(userLoginHistory)
        .where(eq(userLoginHistory.userId, userId))
        .orderBy(desc(userLoginHistory.loginAt))
        .limit(limit);
    }
    return await db.select().from(userLoginHistory)
      .orderBy(desc(userLoginHistory.loginAt))
      .limit(limit);
  }

  async getRecentLogins(hours: number = 24): Promise<UserLoginHistory[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return await db.select().from(userLoginHistory)
      .where(gte(userLoginHistory.loginAt, since))
      .orderBy(desc(userLoginHistory.loginAt));
  }

  async updateLogoutTime(sessionId: string): Promise<void> {
    await db.update(userLoginHistory)
      .set({ logoutAt: new Date() })
      .where(eq(userLoginHistory.sessionId, sessionId));
  }

  // Page Views
  async createPageView(pageView: InsertPageView): Promise<PageView> {
    const [created] = await db.insert(pageViews).values(pageView as any).returning();
    return created;
  }

  async updatePageViewDuration(id: string, timeOnPage: number): Promise<void> {
    await db.update(pageViews)
      .set({ timeOnPage })
      .where(eq(pageViews.id, id));
  }

  async getPageViews(userId?: string, limit: number = 100): Promise<PageView[]> {
    if (userId) {
      return await db.select().from(pageViews)
        .where(eq(pageViews.userId, userId))
        .orderBy(desc(pageViews.viewedAt))
        .limit(limit);
    }
    return await db.select().from(pageViews)
      .orderBy(desc(pageViews.viewedAt))
      .limit(limit);
  }

  async getPageViewStats(hours: number = 24): Promise<{ path: string; count: number }[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db.select({
      path: pageViews.path,
      count: drizzleSql<number>`count(*)::int`,
    })
      .from(pageViews)
      .where(gte(pageViews.viewedAt, since))
      .groupBy(pageViews.path)
      .orderBy(drizzleSql`count(*) DESC`)
      .limit(20);
    return result;
  }

  // Activity Events
  async createActivityEvent(event: InsertUserActivityEvent): Promise<UserActivityEvent> {
    const [created] = await db.insert(userActivityEvents).values(event as any).returning();
    return created;
  }

  async getActivityEvents(userId?: string, limit: number = 100): Promise<UserActivityEvent[]> {
    if (userId) {
      return await db.select().from(userActivityEvents)
        .where(eq(userActivityEvents.userId, userId))
        .orderBy(desc(userActivityEvents.occurredAt))
        .limit(limit);
    }
    return await db.select().from(userActivityEvents)
      .orderBy(desc(userActivityEvents.occurredAt))
      .limit(limit);
  }

  async getActivityEventsByType(activityType: UserActivityType, limit: number = 100): Promise<UserActivityEvent[]> {
    return await db.select().from(userActivityEvents)
      .where(eq(userActivityEvents.activityType, activityType))
      .orderBy(desc(userActivityEvents.occurredAt))
      .limit(limit);
  }

  async getActivityStats(hours: number = 24): Promise<{ activityType: string; count: number }[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db.select({
      activityType: userActivityEvents.activityType,
      count: drizzleSql<number>`count(*)::int`,
    })
      .from(userActivityEvents)
      .where(gte(userActivityEvents.occurredAt, since))
      .groupBy(userActivityEvents.activityType)
      .orderBy(drizzleSql`count(*) DESC`);
    return result;
  }

  // Analytics Summary
  async getOrCreateDailySummary(userId: string, date: string): Promise<UserAnalyticsSummary> {
    const [existing] = await db.select().from(userAnalyticsSummary)
      .where(and(
        eq(userAnalyticsSummary.userId, userId),
        eq(userAnalyticsSummary.date, date)
      ));
    
    if (existing) return existing;
    
    const [created] = await db.insert(userAnalyticsSummary)
      .values({ userId, date } as any)
      .returning();
    return created;
  }

  async updateDailySummary(id: string, updates: Partial<InsertUserAnalyticsSummary>): Promise<UserAnalyticsSummary | null> {
    const [updated] = await db.update(userAnalyticsSummary)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(userAnalyticsSummary.id, id))
      .returning();
    return updated || null;
  }

  async incrementDailySummary(userId: string, date: string, field: keyof InsertUserAnalyticsSummary, increment: number = 1): Promise<void> {
    const summary = await this.getOrCreateDailySummary(userId, date);
    const currentValue = (summary[field as keyof UserAnalyticsSummary] as number) || 0;
    await db.update(userAnalyticsSummary)
      .set({ [field]: currentValue + increment, updatedAt: new Date() } as any)
      .where(eq(userAnalyticsSummary.id, summary.id));
  }

  async getUserAnalyticsSummaries(userId: string, days: number = 30): Promise<UserAnalyticsSummary[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceDate = since.toISOString().split('T')[0];
    
    return await db.select().from(userAnalyticsSummary)
      .where(and(
        eq(userAnalyticsSummary.userId, userId),
        gte(userAnalyticsSummary.date, sinceDate)
      ))
      .orderBy(desc(userAnalyticsSummary.date));
  }

  async getTopUsersByActivity(limit: number = 20): Promise<{ userId: string; totalPageViews: number; totalActivities: number }[]> {
    const result = await db.select({
      userId: userAnalyticsSummary.userId,
      totalPageViews: drizzleSql<number>`sum(${userAnalyticsSummary.pageViews})::int`,
      totalActivities: drizzleSql<number>`sum(${userAnalyticsSummary.ideasViewed} + ${userAnalyticsSummary.ideasGenerated} + ${userAnalyticsSummary.chartsViewed})::int`,
    })
      .from(userAnalyticsSummary)
      .groupBy(userAnalyticsSummary.userId)
      .orderBy(drizzleSql`sum(${userAnalyticsSummary.pageViews}) DESC`)
      .limit(limit);
    return result;
  }

  // Platform-wide analytics
  async getAnalyticsDashboard(): Promise<{
    totalUsers: number;
    activeUsers24h: number;
    totalPageViews24h: number;
    topPages: { path: string; count: number }[];
    topActivities: { activityType: string; count: number }[];
    recentLogins: UserLoginHistory[];
  }> {
    const [allUsers, pageStats, activityStats, recentLogins] = await Promise.all([
      this.getAllUsers(),
      this.getPageViewStats(24),
      this.getActivityStats(24),
      this.getRecentLogins(24),
    ]);

    const uniqueUsers24h = new Set(recentLogins.map(l => l.userId)).size;
    const totalPageViews24h = pageStats.reduce((sum, p) => sum + p.count, 0);

    return {
      totalUsers: allUsers.length,
      activeUsers24h: uniqueUsers24h,
      totalPageViews24h,
      topPages: pageStats,
      topActivities: activityStats,
      recentLogins: recentLogins.slice(0, 10),
    };
  }

  // ========== BETA WAITLIST ==========
  async getWaitlistEntry(email: string): Promise<BetaWaitlist | null> {
    const result = await db.select().from(betaWaitlist).where(eq(betaWaitlist.email, email));
    return result[0] || null;
  }

  async getWaitlistEntryById(id: string): Promise<BetaWaitlist | null> {
    const result = await db.select().from(betaWaitlist).where(eq(betaWaitlist.id, id));
    return result[0] || null;
  }

  async createWaitlistEntry(entry: InsertBetaWaitlist): Promise<BetaWaitlist> {
    const [created] = await db.insert(betaWaitlist).values(entry).returning();
    return created;
  }

  async markWaitlistDiscordNotified(id: string): Promise<void> {
    await db.update(betaWaitlist).set({ notifiedDiscord: true }).where(eq(betaWaitlist.id, id));
  }

  async getWaitlistCount(): Promise<number> {
    const result = await db.select({ count: drizzleSql<number>`count(*)::int` }).from(betaWaitlist);
    return result[0]?.count || 0;
  }

  async getWaitlistPosition(id: string): Promise<number> {
    const entry = await db.select().from(betaWaitlist).where(eq(betaWaitlist.id, id));
    if (!entry[0]) return 0;
    const earlier = await db.select({ count: drizzleSql<number>`count(*)::int` })
      .from(betaWaitlist)
      .where(lte(betaWaitlist.createdAt, entry[0].createdAt!));
    return earlier[0]?.count || 0;
  }

  async getAllWaitlistEntries(): Promise<BetaWaitlist[]> {
    return await db.select().from(betaWaitlist).orderBy(desc(betaWaitlist.createdAt));
  }

  async updateWaitlistStatus(id: string, status: WaitlistStatus, inviteId?: string): Promise<void> {
    const updates: Partial<BetaWaitlist> = { status };
    if (inviteId) updates.inviteId = inviteId;
    if (status === 'invited') {
      updates.inviteSent = true;
      updates.lastContactedAt = new Date();
    }
    if (status === 'joined') {
      updates.convertedToUser = true;
    }
    await db.update(betaWaitlist).set(updates).where(eq(betaWaitlist.id, id));
  }

  // ========== BETA INVITES ==========
  async createBetaInvite(invite: InsertBetaInvite): Promise<BetaInvite> {
    const [created] = await db.insert(betaInvites).values(invite).returning();
    return created;
  }

  async getBetaInviteByToken(token: string): Promise<BetaInvite | null> {
    const result = await db.select().from(betaInvites).where(eq(betaInvites.token, token));
    return result[0] || null;
  }

  async getBetaInviteByEmail(email: string): Promise<BetaInvite | null> {
    // Return the most recent ACTIVE invite (pending or sent) for this email
    // This ensures duplicate invite prevention works correctly
    const result = await db.select().from(betaInvites)
      .where(and(
        eq(betaInvites.email, email.toLowerCase().trim()),
        or(
          eq(betaInvites.status, 'pending'),
          eq(betaInvites.status, 'sent')
        )
      ))
      .orderBy(desc(betaInvites.createdAt));
    return result[0] || null;
  }

  async getAllBetaInvites(): Promise<BetaInvite[]> {
    return await db.select().from(betaInvites).orderBy(desc(betaInvites.createdAt));
  }

  async updateBetaInviteStatus(id: string, status: InviteStatus): Promise<void> {
    await db.update(betaInvites).set({ status }).where(eq(betaInvites.id, id));
  }

  async markBetaInviteSent(id: string): Promise<void> {
    await db.update(betaInvites).set({ 
      status: 'sent' as InviteStatus, 
      sentAt: new Date() 
    }).where(eq(betaInvites.id, id));
  }

  async redeemBetaInvite(token: string): Promise<BetaInvite | null> {
    const invite = await this.getBetaInviteByToken(token);
    if (!invite) return null;
    if (invite.status === 'redeemed') return null;
    if (invite.status === 'revoked') return null;
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      await this.updateBetaInviteStatus(invite.id, 'expired');
      return null;
    }
    await db.update(betaInvites).set({ 
      status: 'redeemed' as InviteStatus, 
      redeemedAt: new Date() 
    }).where(eq(betaInvites.id, invite.id));
    return invite;
  }

  // ========== TRADE DIAGNOSTICS - Loss Analysis ==========
  async createTradeDiagnostics(diagnostics: InsertTradeDiagnostics): Promise<TradeDiagnostics> {
    const [created] = await db.insert(tradeDiagnostics).values(diagnostics).returning();
    return created;
  }

  async getTradeDiagnosticsByTradeId(tradeId: string): Promise<TradeDiagnostics | null> {
    const result = await db.select().from(tradeDiagnostics)
      .where(eq(tradeDiagnostics.tradeId, tradeId));
    return result[0] || null;
  }

  async getTradeDiagnosticsByPatternHash(patternHash: string): Promise<TradeDiagnostics[]> {
    return await db.select().from(tradeDiagnostics)
      .where(eq(tradeDiagnostics.patternHash, patternHash))
      .orderBy(desc(tradeDiagnostics.createdAt));
  }

  async getAllTradeDiagnostics(): Promise<TradeDiagnostics[]> {
    return await db.select().from(tradeDiagnostics)
      .orderBy(desc(tradeDiagnostics.createdAt));
  }

  async getRecentClosedPositions(limit: number): Promise<PaperPosition[]> {
    return await db.select().from(paperPositionsTable)
      .where(eq(paperPositionsTable.status, 'closed'))
      .orderBy(desc(paperPositionsTable.exitTime))
      .limit(limit);
  }

  // ========== BOT LEARNING STATE ==========
  async getBotLearningState(id: string): Promise<BotLearningState | null> {
    const result = await db.select().from(botLearningState)
      .where(eq(botLearningState.id, id));
    return result[0] || null;
  }

  async createBotLearningState(state: InsertBotLearningState): Promise<BotLearningState> {
    const [created] = await db.insert(botLearningState).values(state).returning();
    return created;
  }

  async updateBotLearningState(id: string, updates: Partial<BotLearningState>): Promise<BotLearningState | null> {
    const updateData = { ...updates, lastUpdated: new Date() };
    const [updated] = await db.update(botLearningState)
      .set(updateData)
      .where(eq(botLearningState.id, id))
      .returning();
    return updated || null;
  }

  // ========== PASSWORD RESET TOKENS ==========
  async createPasswordResetToken(userId: string, email: string, token: string): Promise<PasswordResetToken> {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour expiry
    const [created] = await db.insert(passwordResetTokens).values({
      userId,
      email,
      token,
      expiresAt,
    }).returning();
    return created;
  }

  async getPasswordResetToken(token: string): Promise<PasswordResetToken | null> {
    const result = await db.select().from(passwordResetTokens)
      .where(and(
        eq(passwordResetTokens.token, token),
        eq(passwordResetTokens.used, false),
        gte(passwordResetTokens.expiresAt, new Date())
      ));
    return result[0] || null;
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.id, id));
  }

  async invalidateUserResetTokens(userId: string): Promise<void> {
    await db.update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.userId, userId));
  }

  // ========== USER NAVIGATION LAYOUTS ==========
  async getUserNavigationLayout(userId: string): Promise<UserNavigationLayout | null> {
    const result = await db.select().from(userNavigationLayouts)
      .where(eq(userNavigationLayouts.userId, userId));
    return result[0] || null;
  }

  async saveUserNavigationLayout(userId: string, layout: NavigationLayoutType): Promise<UserNavigationLayout> {
    const [saved] = await db.insert(userNavigationLayouts)
      .values({ userId, layout, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userNavigationLayouts.userId,
        set: { layout, updatedAt: new Date() },
      })
      .returning();
    return saved;
  }

  async deleteUserNavigationLayout(userId: string): Promise<boolean> {
    const result = await db.delete(userNavigationLayouts)
      .where(eq(userNavigationLayouts.userId, userId));
    return (result.rowCount ?? 0) > 0;
  }

  // ========== PERSONAL TRADE JOURNAL ==========

  async createJournalTrade(trade: InsertJournalTrade): Promise<JournalTrade> {
    const [created] = await db.insert(journalTrades).values(trade as any).returning();
    return created;
  }

  async createJournalTrades(trades: InsertJournalTrade[]): Promise<JournalTrade[]> {
    if (trades.length === 0) return [];
    const created = await db.insert(journalTrades).values(trades as any[]).returning();
    return created;
  }

  async getJournalTrades(
    userId: string,
    filters?: { symbol?: string; broker?: JournalBroker; status?: string; startDate?: string; endDate?: string; limit?: number }
  ): Promise<JournalTrade[]> {
    const conditions = [eq(journalTrades.userId, userId)];

    if (filters?.symbol) {
      conditions.push(eq(journalTrades.symbol, filters.symbol));
    }
    if (filters?.broker) {
      conditions.push(eq(journalTrades.broker, filters.broker));
    }
    if (filters?.status) {
      conditions.push(eq(journalTrades.status, filters.status as any));
    }
    if (filters?.startDate) {
      conditions.push(gte(journalTrades.entryTime, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(journalTrades.entryTime, filters.endDate));
    }

    const query = db.select().from(journalTrades)
      .where(and(...conditions))
      .orderBy(desc(journalTrades.entryTime));

    if (filters?.limit) {
      return await query.limit(filters.limit);
    }
    return await query;
  }

  async getJournalTradeById(id: string): Promise<JournalTrade | undefined> {
    const [trade] = await db.select().from(journalTrades).where(eq(journalTrades.id, id));
    return trade || undefined;
  }

  async updateJournalTrade(id: string, updates: Partial<JournalTrade>): Promise<JournalTrade | undefined> {
    const [updated] = await db.update(journalTrades)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(journalTrades.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteJournalTrade(id: string): Promise<boolean> {
    const result = await db.delete(journalTrades).where(eq(journalTrades.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async deleteJournalTradesByBatch(importBatchId: string): Promise<number> {
    const result = await db.delete(journalTrades)
      .where(eq(journalTrades.importBatchId, importBatchId));
    return result.rowCount ?? 0;
  }

  async getJournalTradeCount(userId: string): Promise<number> {
    const result = await db.select({ count: drizzleSql<number>`count(*)::int` })
      .from(journalTrades)
      .where(eq(journalTrades.userId, userId));
    return result[0]?.count ?? 0;
  }

  // ═══════════════════════════════════════════════════════
  // GEX Snapshot History
  // ═══════════════════════════════════════════════════════

  async createGexSnapshot(snap: InsertGexSnapshot): Promise<GexSnapshotRecord> {
    const [row] = await db.insert(gexSnapshots).values(snap).returning();
    return row;
  }

  async getGexSnapshots(symbol: string, limit = 500): Promise<GexSnapshotRecord[]> {
    return db.select()
      .from(gexSnapshots)
      .where(eq(gexSnapshots.symbol, symbol.toUpperCase()))
      .orderBy(desc(gexSnapshots.snapshotAt))
      .limit(limit);
  }

  async getGexSnapshotsByDateRange(symbol: string, startDate: Date, endDate: Date): Promise<GexSnapshotRecord[]> {
    return db.select()
      .from(gexSnapshots)
      .where(
        and(
          eq(gexSnapshots.symbol, symbol.toUpperCase()),
          gte(gexSnapshots.snapshotAt, startDate),
          lte(gexSnapshots.snapshotAt, endDate),
        )
      )
      .orderBy(desc(gexSnapshots.snapshotAt));
  }

  async getGexAvailableDates(symbol: string): Promise<string[]> {
    const rows = await db.select({
      date: drizzleSql<string>`DATE(snapshot_at)::text`,
    })
      .from(gexSnapshots)
      .where(eq(gexSnapshots.symbol, symbol.toUpperCase()))
      .groupBy(drizzleSql`DATE(snapshot_at)`)
      .orderBy(drizzleSql`DATE(snapshot_at) DESC`)
      .limit(365);
    return rows.map(r => r.date);
  }

  async getGexAvailableSymbols(): Promise<string[]> {
    const rows = await db.select({
      symbol: gexSnapshots.symbol,
    })
      .from(gexSnapshots)
      .groupBy(gexSnapshots.symbol)
      .orderBy(gexSnapshots.symbol);
    return rows.map(r => r.symbol);
  }
}

export const storage = new DatabaseStorage();
