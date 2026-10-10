import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, integer, boolean, timestamp, index, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Subscription Tier Type - 3 tiers for monetization
export type SubscriptionTier = 'free' | 'advanced' | 'pro' | 'admin';

// Session storage table (Required for Replit Auth)
// Reference: blueprint:javascript_log_in_with_replit
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (Local auth with password)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Auth fields
  email: varchar("email").unique().notNull(),
  passwordHash: varchar("password_hash"), // bcrypt hashed password
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  
  // Discord fields (optional - for Discord community integration)
  discordUserId: varchar("discord_user_id"),
  discordUsername: varchar("discord_username"),
  
  // Subscription tier tracking
  subscriptionTier: text("subscription_tier").$type<SubscriptionTier>().notNull().default('free'),
  subscriptionStatus: varchar("subscription_status").default('active'), // 'active', 'canceled', 'past_due'
  
  // Stripe Integration
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  stripePriceId: varchar("stripe_price_id"),
  stripeCurrentPeriodEnd: timestamp("stripe_current_period_end"),
  
  // Beta Access Control
  hasBetaAccess: boolean("has_beta_access").default(false), // True if user has redeemed invite or is grandfathered
  betaInviteId: varchar("beta_invite_id"), // Which invite they used to join

  // Daily Credits System (for waitlist users - non-beta)
  credits: integer("credits").notNull().default(10), // Current credit balance
  lastCreditRefresh: timestamp("last_credit_refresh"), // Last daily refresh timestamp
  loginStreak: integer("login_streak").notNull().default(0), // Consecutive login days
  lastLoginDate: text("last_login_date"), // YYYY-MM-DD format for streak tracking

  // Referral System
  referralCode: varchar("referral_code").unique(), // User's unique referral code
  referredBy: varchar("referred_by"), // Referral code used at signup
  totalCreditsEarned: integer("total_credits_earned").default(0), // Lifetime credits earned

  // Onboarding fields (captured during beta signup)
  occupation: varchar("occupation"),
  tradingExperienceLevel: varchar("trading_experience_level"), // 'beginner' | 'intermediate' | 'advanced' | 'professional'
  knowledgeFocus: text("knowledge_focus").array(), // ['stocks', 'options', 'futures', 'crypto', 'forex']
  investmentGoals: varchar("investment_goals"), // 'income' | 'growth' | 'speculation' | 'hedging'
  riskTolerance: varchar("risk_tolerance"), // 'conservative' | 'moderate' | 'aggressive' | 'very_aggressive'
  referralSource: varchar("referral_source"), // How they heard about us
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect & { isAdmin?: boolean };

// Onboarding form validation schema (for beta signup)
export const betaOnboardingSchema = z.object({
  occupation: z.string().min(1, "Occupation is required"),
  tradingExperienceLevel: z.enum(['beginner', 'intermediate', 'advanced', 'professional']),
  knowledgeFocus: z.array(z.string()).min(1, "Select at least one area"),
  investmentGoals: z.enum(['income', 'growth', 'speculation', 'hedging']),
  riskTolerance: z.enum(['conservative', 'moderate', 'aggressive', 'very_aggressive']),
  referralSource: z.string().min(1, "Please tell us how you heard about us"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export type BetaOnboarding = z.infer<typeof betaOnboardingSchema>;

// Market Session Type
export type MarketSession = 'pre-market' | 'rth' | 'after-hours' | 'closed';

// Asset Types
export type AssetType = 'stock' | 'penny_stock' | 'option' | 'crypto' | 'future' | 'prediction';

// Performance Tracking Outcome Types
export type OutcomeStatus = 'open' | 'hit_target' | 'hit_stop' | 'manual_exit' | 'expired';

// Resolution Reason - How outcome was determined
export type ResolutionReason = 'auto_target_hit' | 'auto_stop_hit' | 'auto_expired' | 'auto_breakeven' | 'missed_entry_window' | 'missed_entry_would_have_won' | 'missed_entry_would_have_lost' | 'missed_entry_no_outcome' | 'manual_user_won' | 'manual_user_lost' | 'manual_user_breakeven';

// Volatility Regime - Market volatility classification at entry time
export type VolatilityRegime = 'low' | 'normal' | 'high' | 'extreme';

// Session Phase - Intraday timing classification
export type SessionPhase = 'opening' | 'mid-day' | 'closing' | 'overnight';

// Research Horizon - Time frame categorization for educational research
export type ResearchHorizon = 'intraday' | 'short_swing' | 'multi_week' | 'thematic_long';

// Risk Profile - Risk categorization for speculative plays
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive' | 'speculative';

// Sector Focus - Thematic sector categorization
export type SectorFocus = 'quantum_computing' | 'nuclear' | 'healthcare' | 'ai_ml' | 'space' | 'clean_energy' | 'crypto' | 'fintech' | 'consumer' | 'gaming' | 'other';

// 🎯 Convergence Analysis - Deep analysis breakdown for trade ideas
export interface ConvergenceSignal {
  source: string; // 'options_flow' | 'breaking_news' | 'technical' | 'sentiment' | 'insider' | 'sector_momentum'
  type: string; // 'SWEEP_DETECTED' | 'RSI_OVERSOLD' | 'BULLISH_MACD' | etc.
  direction: 'bullish' | 'bearish' | 'neutral';
  weight: number; // 1-20 signal strength
  confidence: number; // 0-100
  description: string; // Human-readable explanation
  data?: Record<string, any>; // Raw data (RSI value, volume, etc.)
  timestamp?: string;
}

export interface ConvergenceAnalysis {
  signals: ConvergenceSignal[]; // All signals that contributed
  convergenceScore: number; // 0-100 overall score
  signalCount: number; // Number of independent sources
  primaryThesis: string; // Main reason for the trade
  technicalSummary?: string; // RSI, MACD, support/resistance summary
  flowSummary?: string; // Options flow summary if applicable
  newsSummary?: string; // News catalyst summary if applicable
  sentimentSummary?: string; // Social/market sentiment
  riskFactors?: string[]; // Key risks to watch
  keyLevels?: { type: string; price: number; label: string }[]; // S/R levels
  generatedAt: string; // ISO timestamp
}

// Trade Idea
export const tradeIdeas = pgTable("trade_ideas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // nullable for backward compatibility, will be required for new ideas
  symbol: text("symbol").notNull(),
  assetType: text("asset_type").notNull().$type<AssetType>(),
  direction: text("direction").notNull(), // 'long' | 'short'
  holdingPeriod: text("holding_period").$type<'day' | 'swing' | 'position' | 'week-ending'>().notNull().default('day'), // day (<6hrs), swing (1-5 days), position (5+ days), week-ending (exit by Friday close)
  entryPrice: real("entry_price").notNull(),
  targetPrice: real("target_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  riskRewardRatio: real("risk_reward_ratio").notNull(),
  catalyst: text("catalyst").notNull(),
  catalystSourceUrl: text("catalyst_source_url"), // Clickable link to catalyst source
  analysis: text("analysis").notNull(),
  liquidityWarning: boolean("liquidity_warning").default(false),
  sessionContext: text("session_context").notNull(),
  timestamp: text("timestamp").notNull(),
  isPublic: boolean("is_public").default(false), // For public performance ledger
  visibility: text("visibility").notNull().default('private'), // 'private' | 'public' | 'subscribers_only'
  
  // Time Windows for Day Trading
  entryValidUntil: text("entry_valid_until"), // When entry window closes (e.g., +2 hours)
  exitBy: text("exit_by"), // Max hold time / exit deadline (e.g., market close)
  
  expiryDate: text("expiry_date"), // For options
  strikePrice: real("strike_price"), // For options
  optionType: text("option_type"), // 'call' | 'put' for options
  
  // Futures Fields
  futuresContractCode: text("futures_contract_code"), // e.g., 'NQH25' for NQ March 2025
  futuresRootSymbol: text("futures_root_symbol"), // 'NQ', 'GC'
  futuresMultiplier: real("futures_multiplier"), // $20 for NQ, $100 for GC
  futuresTickSize: real("futures_tick_size"), // 0.25 for NQ, 0.10 for GC
  futuresInitialMargin: real("futures_initial_margin"), // Required margin to open position (from contract)
  futuresMaintenanceMargin: real("futures_maintenance_margin"), // Minimum margin to hold position (from contract)
  
  source: text("source").notNull().$type<IdeaSource>().default('quant'), // 'ai' | 'quant' | 'chart_analysis'
  status: text("status").$type<TradeIdeaStatus>().notNull().default('published'), // 'draft' | 'published' | 'archived'
  chartImageUrl: text("chart_image_url"), // URL/path to uploaded chart image (for chart_analysis source)
  chartAnalysisJson: jsonb("chart_analysis_json"), // Full AI analysis result (for chart_analysis source)
  // ⚠️ H9: confidenceScore is the LEGACY raw scanner confidence (0-100) emitted
  // by the source scanner that produced this idea. The canonical "how good is
  // this trade?" number that the UI displays is `convictionScore` — produced
  // by the 13-layer convictions engine and enriched onto API responses (not
  // stored on this row). Always render with `displayedScore()` from
  // client/src/lib/conviction-display.ts so consumers fall back consistently.
  confidenceScore: real("confidence_score").notNull().default(0), // legacy 0-100 raw scanner confidence
  qualitySignals: text("quality_signals").array(), // Array of signal names that fired
  // Legacy band scale (A+/A/A-/B+/B/B-/C+/C/D). Superseded by `convictionBand`
  // (S/A/B/C) from the convictions engine — see displayedBand() helper.
  probabilityBand: text("probability_band").notNull().default('C'),
  
  // Performance Tracking Fields
  outcomeStatus: text("outcome_status").$type<OutcomeStatus>().default('open'), // Tracks if trade worked
  exitPrice: real("exit_price"), // Actual exit price when closed (STOCK price for the underlying)
  realizedPnL: real("realized_pnl"), // Actual profit/loss in dollars
  // 🎯 Real OPTION contract P&L (premium-based), distinct from the stock-level
  // exitPrice/percentGain above. For option ideas the validator records the
  // actual contract premium at entry and at resolution so the win rate reflects
  // what the CONTRACT did, not just whether the stock hit its target.
  entryPremium: real("entry_premium"), // Option mid premium captured at idea creation
  exitPremium: real("exit_premium"),   // Option mid premium at resolution (target/stop/expiry)
  optionPercentGain: real("option_percent_gain"), // (exitPremium - entryPremium) / entryPremium * 100
  exitDate: text("exit_date"), // When trade was closed
  outcomeNotes: text("outcome_notes"), // Additional notes about outcome
  resolutionReason: text("resolution_reason").$type<ResolutionReason>(), // How outcome was determined
  actualHoldingTimeMinutes: integer("actual_holding_time_minutes"), // How long trade was held
  percentGain: real("percent_gain"), // Actual % gain or loss
  validatedAt: text("validated_at"), // When auto-validation last checked this idea
  
  // Quant Prediction Accuracy Tracking
  predictionAccurate: boolean("prediction_accurate"), // LEGACY: Did price move in predicted direction by meaningful amount?
  predictionAccuracyPercent: real("prediction_accuracy_percent"), // % progress toward target (0-100+)
  predictionValidatedAt: text("prediction_validated_at"), // When prediction accuracy was checked
  highestPriceReached: real("highest_price_reached"), // Peak price during trade (for long positions)
  lowestPriceReached: real("lowest_price_reached"), // Lowest price during trade (for short positions)
  
  // ML Training Eligibility - Flag to exclude legacy/bad trades from model training
  excludeFromTraining: boolean("exclude_from_training").default(false), // If true, ML retraining ignores this trade
  
  // 🔐 MODEL GOVERNANCE & AUDITABILITY (SR 11-7 / OCC 201-12 compliance)
  engineVersion: text("engine_version"), // Quant engine version that generated this idea (e.g., "v2.1.0")
  mlWeightsVersion: text("ml_weights_version"), // ML weights snapshot used (e.g., "weights_v5_20251021")
  generationTimestamp: text("generation_timestamp"), // ISO timestamp when idea was generated (for audit trail)
  
  // Data Quality Tracking
  dataSourceUsed: text("data_source_used"), // 'tradier', 'yahoo', 'coingecko', 'alphavantage', 'estimated'
  
  // Explainability - Technical Indicator Values (for transparency)
  rsiValue: real("rsi_value"), // Actual RSI value (0-100)
  macdLine: real("macd_line"), // MACD line value
  macdSignal: real("macd_signal"), // MACD signal line value
  macdHistogram: real("macd_histogram"), // MACD histogram value
  volumeRatio: real("volume_ratio"), // Current volume / average volume
  priceVs52WeekHigh: real("price_vs_52week_high"), // Distance from 52-week high (%)
  priceVs52WeekLow: real("price_vs_52week_low"), // Distance from 52-week low (%)
  
  // Timing Intelligence - Market Regime & Quantitative Timing Windows
  volatilityRegime: text("volatility_regime").$type<VolatilityRegime>(), // 'low' | 'normal' | 'high' | 'extreme'
  sessionPhase: text("session_phase").$type<SessionPhase>(), // 'opening' | 'mid-day' | 'closing' | 'overnight'
  trendStrength: real("trend_strength"), // 0-100 measure of trend alignment across timeframes
  entryWindowMinutes: integer("entry_window_minutes"), // Quantitatively-derived optimal entry window
  exitWindowMinutes: integer("exit_window_minutes"), // Quantitatively-derived optimal exit window
  timingConfidence: real("timing_confidence"), // 0-100 confidence in timing windows
  targetHitProbability: real("target_hit_probability"), // ML-predicted probability of hitting target within exit window
  
  // News Catalyst Mode - Relaxes R:R validation for breaking news events
  isNewsCatalyst: boolean("is_news_catalyst").default(false), // True for major news events (earnings beat, acquisition, Fed announcements, etc.)
  newsBias: text("news_bias").$type<'bullish' | 'bearish' | 'neutral'>(), // Directional bias from news sentiment
  earningsBeat: boolean("earnings_beat"), // True if earnings beat detected, false if miss, null if no earnings
  
  // Lotto Mode - High-risk far-OTM options ($20-70 entry) with 20x potential
  isLottoPlay: boolean("is_lotto_play").default(false), // True for $20-70 options with delta <0.30 (far OTM)
  archived: boolean("archived").default(false), // Soft delete — hidden from UI but kept for calibration training

  // Trade Type Classification - Clear differentiation for bot execution
  tradeType: text("trade_type").$type<'lotto' | 'swing' | 'mover' | 'scalp'>().default('swing'), // 'lotto' = high risk far OTM, 'swing' = multi-day, 'mover' = momentum/breakout, 'scalp' = quick in-out
  
  // 📊 OPTIONS GREEKS - Critical for options trading risk assessment
  optionDelta: real("option_delta"), // Price sensitivity to underlying (0.0-1.0)
  optionTheta: real("option_theta"), // Time decay per day (negative = losing value daily)
  optionGamma: real("option_gamma"), // Delta acceleration (how fast delta changes)
  optionVega: real("option_vega"), // IV sensitivity (price change per 1% IV move)
  optionIV: real("option_iv"), // Implied volatility at entry (%)
  optionOpenInterest: integer("option_open_interest"), // Contract open interest at selection (liquidity)
  optionVolume: integer("option_volume"), // Contract day volume at selection (liquidity)
  expiryTier: text("expiry_tier").$type<'0DTE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'LEAP'>(), // Horizon tier the expiry was bound to (keeps expiry aligned with holding period)
  optionDte: integer("option_dte"), // Days-to-expiry of the chosen contract at selection

  // 🎓 EDUCATIONAL TRACKING - For missed entries (entry window expired before trade placed)
  // These fields track what WOULD HAVE happened - separate from real performance metrics
  missedEntryTheoreticalOutcome: text("missed_entry_theoretical_outcome").$type<'would_have_won' | 'would_have_lost' | 'inconclusive'>(), // What would have happened if entry was made
  missedEntryTheoreticalGain: real("missed_entry_theoretical_gain"), // Theoretical % gain/loss if trade was entered
  
  // Research Categorization - For educational framing and filtering
  researchHorizon: text("research_horizon").$type<ResearchHorizon>().default('intraday'), // Time frame: intraday, short_swing, multi_week, thematic_long
  riskProfile: text("risk_profile").$type<RiskProfile>().default('moderate'), // Risk level: conservative, moderate, aggressive, speculative
  sectorFocus: text("sector_focus").$type<SectorFocus>(), // Thematic sector: quantum_computing, nuclear, healthcare, ai_ml, consumer, gaming, etc.

  // 🎯 DEEP ANALYSIS - Full signal breakdown for transparency (Trade Desk integration)
  // Stores the complete reasoning behind why this trade was generated
  convergenceSignalsJson: jsonb("convergence_signals_json").$type<ConvergenceAnalysis>(), // Full breakdown of all signals

  // 🧪 SCORING INSTRUMENTATION — the 13-layer convictions breakdown is otherwise
  // computed live at display time and thrown away, so outcomes can never be
  // attributed back to the layers that fired. These persist the breakdown the
  // engine assigned, enabling grade-calibration + evidence-based reweighting.
  // Written once by the convictions engine on first enrichment; null until it
  // has scored the idea. Never overwrite these with a later live re-grade —
  // entry quality and current opportunity quality answer different questions.
  genConvictionScore: real("gen_conviction_score"),
  genConvictionBand: text("gen_conviction_band"),
  genScoringLayers: jsonb("gen_scoring_layers").$type<Array<{ kind: string; points: number; why?: string }>>(),
}, (table) => [
  // CRITICAL PERFORMANCE INDEXES - Speed up queries without affecting timing
  index("idx_trade_ideas_timestamp").on(table.timestamp), // Fast recent trades lookup
  index("idx_trade_ideas_outcome_status").on(table.outcomeStatus), // Fast open trades filter
  index("idx_trade_ideas_expiry_date").on(table.expiryDate), // Fast options expiry check
  index("idx_trade_ideas_source").on(table.source), // Fast engine filtering
  index("idx_trade_ideas_symbol").on(table.symbol), // Fast symbol lookup
  index("idx_trade_ideas_user_id").on(table.userId), // Fast user trades
  index("idx_trade_ideas_entry_valid").on(table.entryValidUntil), // Fast timing window checks
  // Compound index for most common query: recent open trades
  index("idx_trade_ideas_status_timestamp").on(table.outcomeStatus, table.timestamp),
]);

// Ticker Data Types
export type TickerMention = {
  ticker: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
};

export const insertTradeIdeaSchema = createInsertSchema(tradeIdeas).omit({ id: true });
export type InsertTradeIdea = z.infer<typeof insertTradeIdeaSchema>;
export type TradeIdea = typeof tradeIdeas.$inferSelect & {
  currentPrice?: number | null; // Dynamically added by backend with live price data
};

// Data Source Type
export type DataSource = 'seed' | 'live';

// Idea Source Type
export type IdeaSource = 'ai' | 'quant' | 'hybrid' | 'manual' | 'news' | 'flow' | 'lotto' | 'chart_analysis' | 'penny-scanner' | 'tradingview';

// Trade Idea Status Type
export type TradeIdeaStatus = 'draft' | 'published' | 'archived';

// Hidden Gem Discovery Criteria
export interface HiddenGemCriteria {
  stocks: {
    marketCapMin: number;      // $50M minimum
    marketCapMax: number;      // $5B maximum for "hidden" status
    volumeMultiplier: number;  // 3x average volume spike
    priceGapMin: number;       // 5% price gap minimum
    minLiquidity: number;      // Minimum daily volume for safety
  };
  crypto: {
    marketCapMin: number;      // $50M minimum
    marketCapMax: number;      // $2B maximum for emerging assets
    volumeMin: number;         // $5M+ daily volume
    excludeTopN: number;       // Exclude top 20 by market cap
  };
  options: {
    volumeMultiplier: number;  // 5x baseline OI/volume
    minUnderlyingLiquidity: number;
  };
}

// Anomaly Detection Signals
export interface AnomalySignals {
  volumeSpike: boolean;        // Volume >3x average
  priceGap: boolean;          // Price gap >5%
  relativeStrength: boolean;  // Outperforming sector
  unusualFlow: boolean;       // Options: OI/volume spike
  emergingTrend: boolean;     // Multi-timeframe alignment
}

// Default Hidden Gem Criteria
export const DEFAULT_HIDDEN_GEM_CRITERIA: HiddenGemCriteria = {
  stocks: {
    marketCapMin: 50_000_000,      // $50M
    marketCapMax: 5_000_000_000,   // $5B
    volumeMultiplier: 3.0,
    priceGapMin: 5.0,
    minLiquidity: 500_000,         // $500K daily volume
  },
  crypto: {
    marketCapMin: 50_000_000,      // $50M
    marketCapMax: 2_000_000_000,   // $2B
    volumeMin: 5_000_000,          // $5M daily
    excludeTopN: 20,
  },
  options: {
    volumeMultiplier: 5.0,
    minUnderlyingLiquidity: 1_000_000,
  },
};

// Market Data
export const marketData = pgTable("market_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull().unique(),
  assetType: text("asset_type").notNull().$type<AssetType>(),
  currentPrice: real("current_price").notNull(),
  changePercent: real("change_percent").notNull(),
  volume: real("volume").notNull(),
  marketCap: real("market_cap"),
  session: text("session").notNull().$type<MarketSession>(),
  timestamp: text("timestamp").notNull(),
  high24h: real("high_24h"),
  low24h: real("low_24h"),
  high52Week: real("high_52_week"),
  low52Week: real("low_52_week"),
  avgVolume: real("avg_volume"),
  dataSource: text("data_source").notNull().$type<DataSource>().default('seed'),
  lastUpdated: text("last_updated").notNull(),
});

export const insertMarketDataSchema = createInsertSchema(marketData).omit({ id: true });
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type MarketData = typeof marketData.$inferSelect;

// Options Data
export const optionsData = pgTable("options_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  strikePrice: real("strike_price").notNull(),
  expiryDate: text("expiry_date").notNull(),
  optionType: text("option_type").notNull(), // 'call' | 'put'
  impliedVolatility: real("implied_volatility").notNull(),
  openInterest: integer("open_interest").notNull(),
  volume: integer("volume").notNull(),
  bid: real("bid").notNull(),
  ask: real("ask").notNull(),
  lastPrice: real("last_price").notNull(),
  delta: real("delta"),
  gamma: real("gamma"),
  theta: real("theta"),
  vega: real("vega"),
});

export const insertOptionsDataSchema = createInsertSchema(optionsData).omit({ id: true });
export type InsertOptionsData = z.infer<typeof insertOptionsDataSchema>;
export type OptionsData = typeof optionsData.$inferSelect;

// Futures Contracts - CME specifications
export const futuresContracts = pgTable("futures_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rootSymbol: text("root_symbol").notNull(), // 'NQ', 'GC'
  contractCode: text("contract_code").notNull().unique(), // 'NQH25' (NQ March 2025), 'GCJ25' (GC April 2025)
  exchange: text("exchange").notNull(), // 'CME', 'COMEX'
  expirationDate: text("expiration_date").notNull(), // ISO date when contract expires
  
  // Contract Specifications
  multiplier: real("multiplier").notNull(), // NQ=$20/point, GC=$100/oz
  tickSize: real("tick_size").notNull(), // Minimum price increment (NQ=0.25, GC=0.10)
  tickValue: real("tick_value").notNull(), // Dollar value of 1 tick (NQ=$5, GC=$10)
  
  // Margin Requirements
  initialMargin: real("initial_margin").notNull(), // Required margin to open position
  maintenanceMargin: real("maintenance_margin").notNull(), // Minimum margin to hold position
  
  // Contract Status
  isFrontMonth: boolean("is_front_month").default(false), // Is this the active front month contract?
  rollDate: text("roll_date"), // When to roll to next contract
  
  // Metadata
  description: text("description"), // 'E-mini Nasdaq-100 Futures', 'Gold Futures'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertFuturesContractSchema = createInsertSchema(futuresContracts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFuturesContract = z.infer<typeof insertFuturesContractSchema>;
export type FuturesContract = typeof futuresContracts.$inferSelect;

// Futures Research Briefs - AI-generated analysis for futures contracts
export type FuturesBias = 'bullish' | 'bearish' | 'neutral';
export type FuturesBiasStrength = 'strong' | 'moderate' | 'weak';
export type FuturesSession = 'rth' | 'pre' | 'post' | 'overnight' | 'closed';

export const futuresResearchBriefs = pgTable("futures_research_briefs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(), // 'NQ', 'ES', 'GC', 'CL'
  name: text("name").notNull(), // 'E-mini Nasdaq-100', 'Gold'
  
  // Current Market State
  currentPrice: real("current_price").notNull(),
  session: text("session").notNull().$type<FuturesSession>(),
  
  // AI Analysis
  bias: text("bias").notNull().$type<FuturesBias>(),
  biasStrength: text("bias_strength").notNull().$type<FuturesBiasStrength>(),
  technicalSummary: text("technical_summary").notNull(),
  sessionContext: text("session_context").notNull(),
  
  // Key Levels (stored as JSON)
  resistanceLevels: text("resistance_levels").array(), // e.g., ['21500', '21600']
  supportLevels: text("support_levels").array(), // e.g., ['21300', '21200']
  pivotLevel: real("pivot_level"),
  
  // Catalysts & Risks
  catalysts: text("catalysts").array(),
  riskFactors: text("risk_factors").array(),
  
  // Trading Idea (optional)
  tradeDirection: text("trade_direction").$type<'long' | 'short'>(),
  tradeEntry: real("trade_entry"),
  tradeTarget: real("trade_target"),
  tradeStop: real("trade_stop"),
  tradeRationale: text("trade_rationale"),
  
  // Metadata
  generatedAt: timestamp("generated_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // When this brief should be refreshed
  source: text("source").default('ai'), // 'ai' | 'quant' | 'manual'
  isActive: boolean("is_active").default(true),
});

export const insertFuturesResearchBriefSchema = createInsertSchema(futuresResearchBriefs).omit({ id: true, generatedAt: true });
export type InsertFuturesResearchBrief = z.infer<typeof insertFuturesResearchBriefSchema>;
export type FuturesResearchBrief = typeof futuresResearchBriefs.$inferSelect;

// Watchlist Category Types
export type WatchlistCategory = 'active' | 'annual_breakout' | 'options_watch' | 'swing_candidates' | 'archive' | 'weekly';

// Conviction Level for Annual Watchlist
export type ConvictionLevel = 'high' | 'medium' | 'speculative';

// Watchlist
export const watchlist = pgTable("watchlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"), // nullable for backward compatibility
  symbol: text("symbol").notNull(),
  assetType: text("asset_type").notNull().$type<AssetType>(),
  targetPrice: real("target_price"),
  notes: text("notes"),
  addedAt: text("added_at").notNull(),
  
  // Category for organizing watchlist items
  category: text("category").$type<WatchlistCategory>().notNull().default('active'),
  
  // Annual Breakout Tracking Fields
  thesis: text("thesis"), // Investment thesis for long-term holds
  conviction: text("conviction").$type<ConvictionLevel>(), // high, medium, speculative
  sector: text("sector"), // Sector/industry focus
  startOfYearPrice: real("start_of_year_price"), // Price at Jan 1
  yearlyTargetPrice: real("yearly_target_price"), // Target price for the year (e.g., $70+)
  catalystNotes: text("catalyst_notes"), // Expected catalysts for the year
  reviewDate: text("review_date"), // Next scheduled review date
  currentPrice: real("current_price"), // Latest tracked price
  priceUpdatedAt: text("price_updated_at"), // When current_price was last updated
  ytdPerformance: real("ytd_performance"), // Year-to-date % gain/loss
  
  // Platform Grading & Tiering
  gradeScore: real("grade_score"), // 0-100 quantitative score
  gradeLetter: text("grade_letter"), // A+, A, A-, B+, B, etc.
  tier: text("tier").$type<'S' | 'A' | 'B' | 'C' | 'D' | 'F'>(), // Simplified tier (S=top tier)
  lastEvaluatedAt: text("last_evaluated_at"), // When grading was last run
  gradeInputs: text("grade_inputs"), // JSON: { rsi, momentum, volume, volatility, trend, etc. }
  
  // Price Alert Targets
  entryAlertPrice: real("entry_alert_price"), // Alert when price drops to this level (buying opportunity)
  stopAlertPrice: real("stop_alert_price"), // Alert when price hits stop loss
  targetAlertPrice: real("target_alert_price"), // Alert when price hits profit target
  
  // Alert Settings
  alertsEnabled: boolean("alerts_enabled").default(true), // Master toggle for all alerts
  discordAlertsEnabled: boolean("discord_alerts_enabled").default(true), // Send to Discord
  
  // Alert Tracking
  lastAlertSent: text("last_alert_sent"), // Timestamp of last alert to prevent spam
  alertCount: integer("alert_count").default(0), // Track how many alerts sent
  
  // Premium Tracking (for year-round option monitoring)
  trackPremiums: boolean("track_premiums").default(false), // Enable premium tracking for this symbol
  preferredStrike: real("preferred_strike"), // Target strike price to track
  preferredExpiry: text("preferred_expiry"), // Target expiry (e.g., "2026-01" for Jan 2026 LEAPs)
  preferredOptionType: text("preferred_option_type").$type<'call' | 'put'>().default('call'),
  lastPremium: real("last_premium"), // Most recent premium snapshot
  lastPremiumDate: text("last_premium_date"), // When premium was last checked
  premiumAlertThreshold: real("premium_alert_threshold"), // Alert when premium drops below this
  avgPremium: real("avg_premium"), // Rolling average premium for comparison
  premiumPercentile: real("premium_percentile"), // Current premium percentile (lower = cheaper opportunity)
  
  // Year-Long Research Tracking (Elite Setups V2.0)
  initialScore: real("initial_score"), // Score when first added to watchlist
  initialTier: text("initial_tier").$type<'S' | 'A' | 'B' | 'C' | 'D' | 'F'>(), // Tier when first added
  addedReason: text("added_reason"), // Why symbol was added (e.g., "Volume surge", "AI catalyst")
  priceSinceAdded: real("price_since_added"), // % change since added to watchlist
  timesTraded: integer("times_traded").default(0), // Count of trades taken on this symbol
  timesWon: integer("times_won").default(0), // Count of winning trades
  totalPnl: real("total_pnl").default(0), // Cumulative P&L on this symbol
  avgReturn: real("avg_return"), // Average return % per trade
  personalEdgeBoost: real("personal_edge_boost"), // Confidence boost based on personal win rate (+/- points)
  lastTradedAt: text("last_traded_at"), // When user last traded this symbol
  notesCount: integer("notes_count").default(0), // Count of research notes for this symbol
  nextCatalyst: text("next_catalyst"), // Upcoming catalyst (e.g., "Earnings Jan 30")
  nextCatalystDate: text("next_catalyst_date"), // YYYY-MM-DD of next catalyst

  // Weekly Watchlist Fields (category='weekly')
  weekStartDate: text("week_start_date"), // ISO date (Monday) — groups weekly items
  autoSeeded: boolean("auto_seeded").default(false), // True if injected by Monday cron
  weeklyConvictionScore: real("weekly_conviction_score"), // Score snapshot at seed time
  weeklyConvictionBand: text("weekly_conviction_band"), // S/A/B/C snapshot at seed time
  weeklyThesis: text("weekly_thesis"), // Reason for weekly inclusion (auto or manual)
});

export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true, addedAt: true });
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type WatchlistItem = typeof watchlist.$inferSelect;

// Premium History - Track option premiums over time for watchlist symbols
export const premiumHistory = pgTable("premium_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  watchlistId: varchar("watchlist_id").notNull(), // Link to watchlist item
  symbol: text("symbol").notNull(),
  
  // Option details
  optionType: text("option_type").$type<'call' | 'put'>().notNull(),
  strikePrice: real("strike_price").notNull(),
  expirationDate: text("expiration_date").notNull(), // YYYY-MM-DD
  
  // Premium snapshot
  premium: real("premium").notNull(), // Option price at snapshot time
  underlyingPrice: real("underlying_price"), // Stock price at time of snapshot
  impliedVolatility: real("implied_volatility"), // IV at snapshot
  delta: real("delta"), // Greeks snapshot
  
  // Tracking metadata
  snapshotDate: text("snapshot_date").notNull(), // YYYY-MM-DD
  snapshotTime: text("snapshot_time"), // HH:MM CT
  
  // Analytics
  premiumChange: real("premium_change"), // % change from previous snapshot
  premiumChangeDollar: real("premium_change_dollar"), // $ change from previous
  avgPremium30d: real("avg_premium_30d"), // 30-day average for comparison
  percentileRank: real("percentile_rank"), // Where current premium sits vs history (0-100, lower = cheaper)
});

export const insertPremiumHistorySchema = createInsertSchema(premiumHistory).omit({ id: true });
export type InsertPremiumHistory = z.infer<typeof insertPremiumHistorySchema>;
export type PremiumHistoryRecord = typeof premiumHistory.$inferSelect;

// Options Flow History - Track unusual options activity on watchlist symbols
// Strategy categories for flow classification
export type FlowStrategyCategory = 'lotto' | 'swing' | 'monthly' | 'institutional' | 'scalp';
export type FlowDteCategory = '0DTE' | '1-2DTE' | '3-7DTE' | 'swing' | 'monthly' | 'leaps';

export const optionsFlowHistory = pgTable("options_flow_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  
  optionType: text("option_type").$type<'call' | 'put'>().notNull(),
  strikePrice: real("strike_price").notNull(),
  expirationDate: text("expiration_date").notNull(),
  
  volume: integer("volume").notNull(),
  openInterest: integer("open_interest"),
  volumeOIRatio: real("volume_oi_ratio"),
  premium: real("premium").notNull(),
  totalPremium: real("total_premium"),
  impliedVolatility: real("implied_volatility"),
  delta: real("delta"),
  
  underlyingPrice: real("underlying_price"),
  // 'unknown' is a real, expected value — a chain snapshot cannot distinguish a
  // buyer from a seller, and contract type alone gets the sign wrong on both
  // selling cases. Stored as text, so widening the union needs no migration.
  sentiment: text("sentiment").$type<'bullish' | 'bearish' | 'neutral' | 'unknown'>().notNull(),
  flowType: text("flow_type").$type<'block' | 'sweep' | 'unusual_volume' | 'dark_pool' | 'normal'>().notNull(),
  unusualScore: real("unusual_score").notNull(),
  
  // Strategy classification for filtering whale plays
  strategyCategory: text("strategy_category").$type<FlowStrategyCategory>().default('institutional'),
  dteCategory: text("dte_category").$type<FlowDteCategory>().default('swing'),
  isLotto: boolean("is_lotto").default(false), // Far OTM cheap premiums (lotto plays)
  
  isWatchlistSymbol: boolean("is_watchlist_symbol").default(false),
  detectedAt: timestamp("detected_at").defaultNow(),
  detectedDate: text("detected_date").notNull(),
});

export const insertOptionsFlowHistorySchema = createInsertSchema(optionsFlowHistory).omit({ id: true, detectedAt: true });
export type InsertOptionsFlowHistory = z.infer<typeof insertOptionsFlowHistorySchema>;
export type OptionsFlowHistoryRecord = typeof optionsFlowHistory.$inferSelect;

// Watchlist History - Daily snapshots for year-long grade/price tracking
export const watchlistHistory = pgTable("watchlist_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  watchlistId: varchar("watchlist_id").notNull(), // Link to watchlist item
  symbol: text("symbol").notNull(),
  
  // Snapshot date
  snapshotDate: text("snapshot_date").notNull(), // YYYY-MM-DD
  year: integer("year").notNull(), // For year-over-year queries
  
  // Grade snapshot
  gradeScore: real("grade_score"), // 0-100 quantitative score
  gradeLetter: text("grade_letter"), // A+, A, A-, B+, B, etc.
  tier: text("tier").$type<'S' | 'A' | 'B' | 'C' | 'D' | 'F'>(),
  confidenceScore: real("confidence_score"), // Confluence confidence 0-100
  
  // Price snapshot
  price: real("price").notNull(),
  priceChange: real("price_change"), // % change from previous day
  volume: real("volume"), // Daily volume
  
  // Technical indicators snapshot (for analysis)
  technicalSnapshot: text("technical_snapshot"), // JSON: { rsi, adx, macd, atr, etc. }
  
  // Event markers
  hasEarnings: boolean("has_earnings").default(false),
  hasNews: boolean("has_news").default(false),
  hasTrade: boolean("has_trade").default(false), // Did user trade this symbol on this day?
  hasNote: boolean("has_note").default(false), // Does user have a note for this date?
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWatchlistHistorySchema = createInsertSchema(watchlistHistory).omit({ id: true, createdAt: true });
export type InsertWatchlistHistory = z.infer<typeof insertWatchlistHistorySchema>;
export type WatchlistHistoryRecord = typeof watchlistHistory.$inferSelect;

// Symbol Notes - Personal annotations and research notes
export const symbolNotes = pgTable("symbol_notes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  watchlistId: varchar("watchlist_id"), // Optional link to specific watchlist entry
  
  // Note content
  content: text("content").notNull(),
  tags: text("tags").array(), // ["breakout", "catalyst", "earnings"]
  
  // Note type
  noteType: text("note_type").$type<'user' | 'ai_generated' | 'system'>().default('user'),
  
  // Privacy
  isPrivate: boolean("is_private").default(true),
  
  // Linked events
  linkedEventType: text("linked_event_type"), // 'trade', 'catalyst', 'grade_change', 'price_alert'
  linkedEventId: varchar("linked_event_id"), // ID of linked trade, catalyst, etc.
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSymbolNoteSchema = createInsertSchema(symbolNotes).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSymbolNote = z.infer<typeof insertSymbolNoteSchema>;
export type SymbolNote = typeof symbolNotes.$inferSelect;

// Research History - Track user interactions with signals for personalized learning
export type ResearchAction = 'traded' | 'watched' | 'ignored' | 'saved';
export type ResearchOutcome = 'hit_target' | 'hit_stop' | 'breakeven' | 'expired' | 'pending' | null;

export const researchHistory = pgTable("research_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  signalId: varchar("signal_id"), // Optional link to trade_ideas table
  
  // User action on this signal
  actionTaken: text("action_taken").$type<ResearchAction>().notNull(), // traded, watched, ignored, saved
  
  // Signal context at time of view
  signalGrade: text("signal_grade"), // A+, A, A-, B+, etc. at time of viewing
  signalConfidence: real("signal_confidence"), // 0-100 at time of viewing
  signalDirection: text("signal_direction"), // 'long' | 'short'
  signalEngine: text("signal_engine"), // 'AI' | 'QUANT' | 'HYBRID'
  signalPrice: real("signal_price"), // Entry price at signal time
  
  // Technical context
  technicalSnapshot: text("technical_snapshot"), // JSON: { rsi, adx, atr, volume, etc. }
  marketRegime: text("market_regime"), // 'trending' | 'ranging' | 'volatile'
  
  // Outcome tracking (filled in later)
  outcome: text("outcome").$type<ResearchOutcome>(), // hit_target, hit_stop, etc.
  outcomeReturn: real("outcome_return"), // % return if traded
  outcomePnL: real("outcome_pnl"), // $ P&L if traded
  outcomeUpdatedAt: timestamp("outcome_updated_at"),
  
  // User notes and learning
  decisionNotes: text("decision_notes"), // Why user made this decision
  lessonLearned: text("lesson_learned"), // Post-hoc learning from outcome
  
  // Pattern matching (for similar pattern discovery)
  signalPatterns: text("signal_patterns").array(), // ['volume_surge', 'rsi_oversold', 'call_flow']
  
  // Timestamps
  viewedAt: timestamp("viewed_at").defaultNow(), // When user first saw the signal
  decidedAt: timestamp("decided_at"), // When user made decision (traded/ignored)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertResearchHistorySchema = createInsertSchema(researchHistory).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertResearchHistory = z.infer<typeof insertResearchHistorySchema>;
export type ResearchHistoryRecord = typeof researchHistory.$inferSelect;

// Catalyst/News
export const catalysts = pgTable("catalysts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url"), // Clickable link to external source
  timestamp: text("timestamp").notNull(),
  eventType: text("event_type").notNull(), // 'earnings', 'fda', 'guidance', 'news', etc.
  impact: text("impact").notNull(), // 'high' | 'medium' | 'low'
});

export const insertCatalystSchema = createInsertSchema(catalysts).omit({ id: true });
export type InsertCatalyst = z.infer<typeof insertCatalystSchema>;
export type Catalyst = typeof catalysts.$inferSelect;

// User Preferences
export type LayoutDensityOld = 'compact' | 'comfortable' | 'spacious';
export type RiskTier = 'conservative' | 'moderate' | 'aggressive' | 'custom';

// Risk Profile configuration - nested JSON structure
export interface RiskProfileConfig {
  tier: RiskTier;
  maxPositionSizePercent: number;     // 2% default
  maxDailyLossPercent: number;        // 5% default
  maxCorrelatedPositions: number;     // 3 default
  requireConfirmation: boolean;       // true = manual approve all trades
}

// Technical Threshold configuration for each indicator
export interface TechnicalThresholdConfig {
  rsi: {
    oversold: number;        // Default: 30
    overbought: number;      // Default: 70
    weightAdjustment: number; // ±10 points to signal weight
    enabled: boolean;
  };
  adx: {
    trendingMinimum: number;   // Default: 25
    strongTrend: number;       // Default: 40
    weightAdjustment: number;
    enabled: boolean;
  };
  volume: {
    surgeRatio: number;        // Default: 2.0x
    weightAdjustment: number;
    enabled: boolean;
  };
  macd: {
    crossoverThreshold: number; // Default: 0.5 histogram
    weightAdjustment: number;
    enabled: boolean;
  };
  vwap: {
    deviationPercent: number;   // Default: 1% from VWAP
    weightAdjustment: number;
    enabled: boolean;
  };
  bollinger: {
    period: number;            // Default: 20
    stdDev: number;            // Default: 2
    weightAdjustment: number;
    enabled: boolean;
  };
}

// Fundamental Filter configuration
export interface FundamentalFilterConfig {
  minMarketCap: number | null;      // Default: 1B (null = disabled)
  maxPeRatio: number | null;        // Default: null (disabled)
  requireEarningsBeat: boolean;     // false
  insiderBuyingWeight: number;      // +15 default, user can ±10
  sectorRotationBias: string[];     // ['tech', 'healthcare']
  excludePennyStocks: boolean;      // true
  minAverageVolume: number | null;  // Minimum daily volume
}

// Default Risk Profile
export const DEFAULT_RISK_PROFILE: RiskProfileConfig = {
  tier: 'moderate',
  maxPositionSizePercent: 2,
  maxDailyLossPercent: 5,
  maxCorrelatedPositions: 3,
  requireConfirmation: true,
};

// Default Technical Thresholds
export const DEFAULT_TECHNICAL_THRESHOLDS: TechnicalThresholdConfig = {
  rsi: { oversold: 30, overbought: 70, weightAdjustment: 0, enabled: true },
  adx: { trendingMinimum: 25, strongTrend: 40, weightAdjustment: 0, enabled: true },
  volume: { surgeRatio: 2.0, weightAdjustment: 0, enabled: true },
  macd: { crossoverThreshold: 0.5, weightAdjustment: 0, enabled: true },
  vwap: { deviationPercent: 1.0, weightAdjustment: 0, enabled: true },
  bollinger: { period: 20, stdDev: 2, weightAdjustment: 0, enabled: true },
};

// Default Fundamental Filters
export const DEFAULT_FUNDAMENTAL_FILTERS: FundamentalFilterConfig = {
  minMarketCap: 1000000000, // 1B
  maxPeRatio: null,
  requireEarningsBeat: false,
  insiderBuyingWeight: 15,
  sectorRotationBias: [],
  excludePennyStocks: true,
  minAverageVolume: null,
};

export const userPreferences = pgTable("user_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(), // One preferences record per user
  
  // Trading Preferences
  accountSize: real("account_size").notNull().default(10000),
  maxRiskPerTrade: real("max_risk_per_trade").notNull().default(1), // percentage
  defaultCapitalPerIdea: real("default_capital_per_idea").notNull().default(1000),
  defaultOptionsBudget: real("default_options_budget").notNull().default(250),
  preferredAssets: text("preferred_assets").array().notNull().default(['stock', 'option', 'crypto']),
  holdingHorizon: text("holding_horizon").notNull().default('intraday'),
  
  // Risk Profile (JSONB - nested structure)
  riskProfile: jsonb("risk_profile").$type<RiskProfileConfig>().default(DEFAULT_RISK_PROFILE),
  
  // Technical Thresholds (JSONB - nested structure for all indicators)
  technicalThresholds: jsonb("technical_thresholds").$type<TechnicalThresholdConfig>().default(DEFAULT_TECHNICAL_THRESHOLDS),
  
  // Fundamental Filters (JSONB - nested structure)
  fundamentalFilters: jsonb("fundamental_filters").$type<FundamentalFilterConfig>().default(DEFAULT_FUNDAMENTAL_FILTERS),
  
  // Display Preferences
  theme: text("theme").notNull().default('dark'), // 'light' | 'dark' | 'auto'
  timezone: text("timezone").notNull().default('America/Chicago'),
  defaultViewMode: text("default_view_mode").notNull().default('card'), // 'card' | 'table'
  compactMode: boolean("compact_mode").notNull().default(false),
  
  // UI Personalization (NEW)
  layoutDensity: text("layout_density").$type<LayoutDensityOld>().default('comfortable'),
  sidebarCollapsed: boolean("sidebar_collapsed").default(false),
  animationsEnabled: boolean("animations_enabled").default(true),
  dashboardPreset: varchar("dashboard_preset").default('default'), // 'default', 'trading', 'analytics', 'minimal'
  favoritePages: text("favorite_pages").array().default(sql`'{}'::text[]`),
  
  // Notification Preferences
  discordWebhookUrl: text("discord_webhook_url"),
  enableTradeAlerts: boolean("enable_trade_alerts").notNull().default(true),
  enablePriceAlerts: boolean("enable_price_alerts").notNull().default(true),
  enablePerformanceAlerts: boolean("enable_performance_alerts").notNull().default(false),
  enableWeeklyReport: boolean("enable_weekly_report").notNull().default(false),
  
  // Default Filters
  defaultAssetFilter: text("default_asset_filter").notNull().default('all'), // 'all' | 'stock' | 'option' | 'crypto'
  defaultConfidenceFilter: text("default_confidence_filter").notNull().default('all'), // 'all' | 'A' | 'B' | 'C'
  autoRefreshEnabled: boolean("auto_refresh_enabled").notNull().default(true),
  
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserPreferencesSchema = createInsertSchema(userPreferences).omit({ id: true });
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;

// Navigation Item Type for custom layouts
export type NavigationItemType = {
  id: string;
  title: string;
  icon: string;
  href: string;
  badge?: string;
  adminOnly?: boolean;
};

// Navigation Group Type
export type NavigationGroupType = {
  id: string;
  title: string;
  items: NavigationItemType[];
  collapsed?: boolean;
};

// Full Navigation Layout Type
export type NavigationLayoutType = {
  groups: NavigationGroupType[];
  version: number;
};

// User Navigation Layouts - Per-user sidebar customization
export const userNavigationLayouts = pgTable("user_navigation_layouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  
  layout: jsonb("layout").$type<NavigationLayoutType>().notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserNavigationLayoutSchema = createInsertSchema(userNavigationLayouts).omit({ id: true, createdAt: true });
export type InsertUserNavigationLayout = z.infer<typeof insertUserNavigationLayoutSchema>;
export type UserNavigationLayout = typeof userNavigationLayouts.$inferSelect;

// 🔐 MODEL CARDS - ML Ops governance & auditability (SR 11-7 / OCC 201-12 compliance)
// Documents each quant engine version and ML weights snapshot for model risk management
export const modelCards = pgTable("model_cards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  engineVersion: text("engine_version").notNull().unique(), // e.g., "v2.1.0"
  mlWeightsVersion: text("ml_weights_version"), // e.g., "weights_v5_20251021" (null for pure quant)
  
  // Model Metadata
  modelType: text("model_type").notNull(), // 'quant' | 'ml_hybrid' | 'ai'
  description: text("description").notNull(), // What changed in this version
  createdAt: text("created_at").notNull(), // When this version was deployed
  createdBy: text("created_by"), // Who deployed it (for audit trail)
  
  // Model Assumptions & Data Limits
  assumptions: text("assumptions"), // JSON: Key assumptions (e.g., "Assumes mean-reverting markets")
  dataLimitations: text("data_limitations"), // JSON: Data quality issues (e.g., "Limited options chain data")
  signalWeights: text("signal_weights"), // JSON: Signal importance scores
  
  // Performance Benchmarks
  backtestStartDate: text("backtest_start_date"),
  backtestEndDate: text("backtest_end_date"),
  backtestWinRate: real("backtest_win_rate"), // % (e.g., 67.5)
  backtestSharpeRatio: real("backtest_sharpe_ratio"),
  backtestMaxDrawdown: real("backtest_max_drawdown"), // % (e.g., -12.3)
  
  // Live Performance Tracking
  liveTradesGenerated: integer("live_trades_generated").default(0),
  liveWinRate: real("live_win_rate"), // Real-world performance
  liveAccuracyRate: real("live_accuracy_rate"), // % progress toward target
  
  // Model Status
  status: text("status").notNull().default('active'), // 'active' | 'deprecated' | 'archived'
  deprecatedAt: text("deprecated_at"),
  deprecationReason: text("deprecation_reason"),
});

export const insertModelCardSchema = createInsertSchema(modelCards).omit({ id: true });
export type InsertModelCard = z.infer<typeof insertModelCardSchema>;
export type ModelCard = typeof modelCards.$inferSelect;

// Daily usage tracking for tier limits
export const dailyUsage = pgTable("daily_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD format
  ideasViewed: integer("ideas_viewed").notNull().default(0),
  aiChatMessages: integer("ai_chat_messages").notNull().default(0),
  chartAnalyses: integer("chart_analyses").notNull().default(0),
});

export const insertDailyUsageSchema = createInsertSchema(dailyUsage).omit({ id: true });
export type InsertDailyUsage = z.infer<typeof insertDailyUsageSchema>;
export type DailyUsage = typeof dailyUsage.$inferSelect;

// Active Trade Position Status
export type ActiveTradeStatus = 'open' | 'closed' | 'expired';

// Active Trades - Live position tracking for real-time P&L monitoring
export const activeTrades = pgTable("active_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  
  // Position Details
  symbol: text("symbol").notNull(),
  assetType: text("asset_type").notNull().$type<AssetType>(),
  direction: text("direction").notNull(), // 'long' | 'short'
  
  // Option-specific fields
  optionType: text("option_type"), // 'call' | 'put'
  strikePrice: real("strike_price"),
  expiryDate: text("expiry_date"), // YYYY-MM-DD
  
  // Entry Details
  entryPrice: real("entry_price").notNull(), // Price paid for option/stock
  quantity: doublePrecision("quantity").notNull().default(1), // Number of contracts/shares (decimal for crypto)
  entryTime: text("entry_time").notNull(), // ISO timestamp
  
  // Targets & Stops
  targetPrice: real("target_price"),
  stopLoss: real("stop_loss"),
  
  // Live Tracking
  currentPrice: real("current_price"), // Last fetched price
  lastPriceUpdate: text("last_price_update"), // When price was last updated
  unrealizedPnL: real("unrealized_pnl"), // Current P&L in dollars
  unrealizedPnLPercent: real("unrealized_pnl_percent"), // Current P&L as %
  
  // Exit Details
  status: text("status").$type<ActiveTradeStatus>().notNull().default('open'),
  exitPrice: real("exit_price"),
  exitTime: text("exit_time"),
  realizedPnL: real("realized_pnl"),
  realizedPnLPercent: real("realized_pnl_percent"),
  
  // Notes
  notes: text("notes"),
  linkedTradeIdeaId: varchar("linked_trade_idea_id"), // Optional link to a trade idea
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertActiveTradeSchema = createInsertSchema(activeTrades).omit({ id: true, createdAt: true });
export type InsertActiveTrade = z.infer<typeof insertActiveTradeSchema>;
export type ActiveTrade = typeof activeTrades.$inferSelect;

// ==========================================
// TRADE DIAGNOSTICS - Loss Analysis & Learning System
// ==========================================

// Loss classification categories
export type LossCategory = 
  | 'direction_wrong'      // Called bullish but went down (or vice versa)
  | 'timing_late'          // Entered too late, missed the move
  | 'timing_early'         // Entered too early, got stopped out before move
  | 'theta_decay'          // Lost to time decay on options
  | 'iv_crush'             // Implied volatility collapsed after entry
  | 'regime_shift'         // Market regime changed against position
  | 'stop_too_tight'       // Stop loss triggered too easily
  | 'stop_too_loose'       // Let loss run too long
  | 'liquidity_issue'      // Poor fills, wide spreads
  | 'catalyst_failed'      // Expected catalyst didn't materialize
  | 'oversized_position'   // Position too large for account
  | 'chasing_entry'        // Entered after move already happened
  | 'unknown';             // Couldn't determine cause

// Trade diagnostics for learning from losses
export const tradeDiagnostics = pgTable("trade_diagnostics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Link to the trade
  tradeId: varchar("trade_id").notNull(), // Links to trade_ideas.id or paper_positions.id
  tradeSource: text("trade_source").notNull(), // 'bot' | 'manual' | 'quant' | 'ai'
  symbol: text("symbol").notNull(),
  
  // Trade outcome
  outcome: text("outcome").notNull(), // 'win' | 'loss' | 'breakeven'
  pnlPercent: real("pnl_percent").notNull(),
  pnlDollars: real("pnl_dollars"),
  
  // Entry snapshot (what conditions existed when we entered)
  entrySnapshot: jsonb("entry_snapshot").$type<{
    marketRegime: string;        // trending_up, trending_down, ranging, volatile
    spyChange: number;           // SPY % change that day
    volumeRatio: number;         // Volume vs average
    ivRank?: number;             // IV rank for options
    daysToExpiry?: number;       // DTE at entry for options
    confidenceScore: number;     // Bot's confidence at entry
    signalCount: number;         // Number of confirming signals
    entryReason: string;         // Why bot entered
  }>(),
  
  // Exit snapshot (what conditions existed when we exited)
  exitSnapshot: jsonb("exit_snapshot").$type<{
    marketRegime: string;
    spyChange: number;
    exitReason: string;          // Why bot exited
    exitTrigger: string;         // stop_loss, target, trailing_stop, manual, expiry
    daysHeld: number;
    maxProfitReached: number;    // Highest profit % during trade
    drawdownFromPeak: number;    // How much we gave back from peak
  }>(),
  
  // Loss classification
  lossCategories: text("loss_categories").array(), // Multiple categories possible
  primaryCause: text("primary_cause").$type<LossCategory>(),
  
  // Analysis
  analysisNotes: text("analysis_notes"), // AI/rule-based analysis of what went wrong
  
  // Remediation - what adjustments to make
  remediationActions: jsonb("remediation_actions").$type<{
    adjustStopMultiplier?: number;    // Tighten/loosen stops by this factor
    adjustConfidenceThreshold?: number; // Require higher confidence next time
    avoidSymbol?: boolean;            // Temporarily avoid this symbol
    avoidPattern?: string;            // Pattern to avoid (e.g., "earnings_play")
    reducePositionSize?: number;      // Reduce position size by this factor
  }>(),
  
  // Learning metrics
  patternHash: text("pattern_hash"), // Hash of conditions for pattern matching
  similarLossCount: integer("similar_loss_count").default(0), // How many similar losses
  
  // Status
  reviewStatus: text("review_status").default('pending'), // 'pending' | 'reviewed' | 'actioned'
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTradeDiagnosticsSchema = createInsertSchema(tradeDiagnostics).omit({ id: true, createdAt: true });
export type InsertTradeDiagnostics = z.infer<typeof insertTradeDiagnosticsSchema>;
export type TradeDiagnostics = typeof tradeDiagnostics.$inferSelect;

// Bot learning state - stores adaptive parameters
export const botLearningState = pgTable("bot_learning_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Current adaptive parameters
  confidenceThreshold: real("confidence_threshold").default(65), // Min confidence to enter
  stopLossMultiplier: real("stop_loss_multiplier").default(1.0), // Adjust default stops
  positionSizeMultiplier: real("position_size_multiplier").default(1.0), // Adjust sizing
  
  // Symbol-specific adjustments
  symbolAdjustments: jsonb("symbol_adjustments").$type<{
    [symbol: string]: {
      confidenceBoost: number;    // +/- adjustment to confidence
      avoidUntil?: string;        // ISO date to avoid until
      lossStreak: number;         // Consecutive losses on this symbol
      winRate: number;            // Historical win rate on this symbol
      recentLossMagnitudes?: number[];  // Last 5 loss percentages for dynamic cooldown
    };
  }>().default({}),
  
  // Pattern-specific adjustments
  patternAdjustments: jsonb("pattern_adjustments").$type<{
    [pattern: string]: {
      enabled: boolean;
      successRate: number;
      sampleSize: number;
    };
  }>().default({}),
  
  // Performance tracking
  totalAnalyzed: integer("total_analyzed").default(0),
  totalWins: integer("total_wins").default(0),
  totalLosses: integer("total_losses").default(0),
  adaptationsApplied: integer("adaptations_applied").default(0),
  
  // Last update
  lastUpdated: timestamp("last_updated").defaultNow(),
});

export const insertBotLearningStateSchema = createInsertSchema(botLearningState).omit({ id: true, lastUpdated: true });
export type InsertBotLearningState = z.infer<typeof insertBotLearningStateSchema>;
export type BotLearningState = typeof botLearningState.$inferSelect;

// Position Calculation Interface (not stored, just for calculations)
export interface PositionCalculation {
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  capitalAllocated: number;
  shares: number;
  riskAmount: number;
  riskPercent: number;
  potentialProfit: number;
  riskRewardRatio: number;
  stopLossPercent: number;
  targetPercent: number;
}

// Screener Filters
export interface ScreenerFilters {
  assetType?: AssetType[];
  priceRange?: { min?: number; max?: number };
  volumeThreshold?: number;
  changePercentRange?: { min?: number; max?: number };
  marketCapRange?: { min?: number; max?: number };
  pennyStocksOnly?: boolean; // <$5
  highIVOnly?: boolean; // IV > 50%
  unusualVolume?: boolean; // volume > 2x avg
}

// ==========================================
// PAPER TRADING - Simulation Portfolio System
// ==========================================

export type PaperTradeStatus = 'open' | 'closed';

// Paper Trading Portfolio - Virtual portfolio for simulation
export const paperPortfolios = pgTable("paper_portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull().default('My Paper Portfolio'),
  
  // Capital
  startingCapital: real("starting_capital").notNull().default(100000), // Default $100K
  cashBalance: real("cash_balance").notNull().default(100000), // Available cash
  
  // Performance Metrics (calculated)
  totalValue: real("total_value").notNull().default(100000), // Cash + positions value
  totalPnL: real("total_pnl").notNull().default(0),
  totalPnLPercent: real("total_pnl_percent").notNull().default(0),
  winCount: integer("win_count").notNull().default(0),
  lossCount: integer("loss_count").notNull().default(0),
  
  // Settings
  autoExecute: boolean("auto_execute").default(false), // Auto-execute Quant Edge Labs signals
  maxPositionSize: real("max_position_size").default(5000), // Max per position
  riskPerTrade: real("risk_per_trade").default(0.02), // 2% default risk
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPaperPortfolioSchema = createInsertSchema(paperPortfolios).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaperPortfolio = z.infer<typeof insertPaperPortfolioSchema>;
export type PaperPortfolio = typeof paperPortfolios.$inferSelect;

// Paper Positions - Open simulated positions
export const paperPositions = pgTable("paper_positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").notNull(),
  tradeIdeaId: varchar("trade_idea_id"), // Link to original signal
  
  // Position Details
  symbol: text("symbol").notNull(),
  assetType: text("asset_type").notNull().$type<AssetType>(),
  direction: text("direction").notNull(), // 'long' | 'short'
  
  // Option-specific
  optionType: text("option_type"), // 'call' | 'put'
  strikePrice: real("strike_price"),
  expiryDate: text("expiry_date"),
  
  // Entry
  entryPrice: real("entry_price").notNull(),
  quantity: doublePrecision("quantity").notNull(), // Decimal for crypto fractional units
  entryTime: text("entry_time").notNull(),
  entryReason: text("entry_reason"), // Why the bot entered this trade
  entrySignals: text("entry_signals"), // JSON array of signals that triggered entry
  
  // Targets
  targetPrice: real("target_price"),
  stopLoss: real("stop_loss"),
  
  // Trailing Stop System - let winners run
  highWaterMark: real("high_water_mark"), // Highest price seen during trade
  trailingStopPercent: real("trailing_stop_percent").default(25), // Dynamic trailing stop %
  trailingStopPrice: real("trailing_stop_price"), // Calculated trailing stop level
  useTrailingStop: boolean("use_trailing_stop").default(true), // Enable trailing stops
  
  // Current State
  currentPrice: real("current_price"),
  lastPriceUpdate: text("last_price_update"),
  unrealizedPnL: real("unrealized_pnl").default(0),
  unrealizedPnLPercent: real("unrealized_pnl_percent").default(0),
  
  // Status
  status: text("status").$type<PaperTradeStatus>().notNull().default('open'),
  exitPrice: real("exit_price"),
  exitTime: text("exit_time"),
  exitReason: text("exit_reason"), // 'target_hit' | 'stop_hit' | 'manual' | 'expired'
  realizedPnL: real("realized_pnl"),
  realizedPnLPercent: real("realized_pnl_percent"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaperPositionSchema = createInsertSchema(paperPositions).omit({ id: true, createdAt: true });
export type InsertPaperPosition = z.infer<typeof insertPaperPositionSchema>;
export type PaperPosition = typeof paperPositions.$inferSelect;

// Paper Equity Snapshots - Daily equity curve
export const paperEquitySnapshots = pgTable("paper_equity_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  totalValue: real("total_value").notNull(),
  cashBalance: real("cash_balance").notNull(),
  positionsValue: real("positions_value").notNull(),
  dailyPnL: real("daily_pnl").notNull().default(0),
  dailyPnLPercent: real("daily_pnl_percent").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaperEquitySnapshotSchema = createInsertSchema(paperEquitySnapshots).omit({ id: true, createdAt: true });
export type InsertPaperEquitySnapshot = z.infer<typeof insertPaperEquitySnapshotSchema>;
export type PaperEquitySnapshot = typeof paperEquitySnapshots.$inferSelect;

// ==========================================
// WALLET TRACKER - Whale Wallet Monitoring
// ==========================================

export type BlockchainNetwork = 'ethereum' | 'solana' | 'bitcoin';
export type WalletAlertType = 'large_transfer' | 'token_accumulation' | 'token_dump' | 'new_token';

// Tracked Wallets - Whale wallets to monitor
export const trackedWallets = pgTable("tracked_wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(), // Who added this wallet
  
  address: text("address").notNull(),
  network: text("network").$type<BlockchainNetwork>().notNull(),
  label: text("label"), // e.g., "Vitalik", "Jump Trading", "Alameda"
  category: text("category"), // 'whale' | 'institution' | 'dex' | 'cex' | 'personal'
  
  // Tracking Status
  isActive: boolean("is_active").default(true),
  lastSyncAt: text("last_sync_at"),
  syncErrorCount: integer("sync_error_count").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTrackedWalletSchema = createInsertSchema(trackedWallets).omit({ id: true, createdAt: true });
export type InsertTrackedWallet = z.infer<typeof insertTrackedWalletSchema>;
export type TrackedWallet = typeof trackedWallets.$inferSelect;

// Wallet Holdings - Token balances for tracked wallets
export const walletHoldings = pgTable("wallet_holdings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletId: varchar("wallet_id").notNull(),
  
  tokenAddress: text("token_address"), // null for native (ETH/SOL)
  tokenSymbol: text("token_symbol").notNull(),
  tokenName: text("token_name"),
  
  balance: real("balance").notNull(),
  balanceUsd: real("balance_usd"),
  
  // Change tracking
  previousBalance: real("previous_balance"),
  changePercent: real("change_percent"),
  
  lastUpdatedAt: text("last_updated_at").notNull(),
});

export const insertWalletHoldingSchema = createInsertSchema(walletHoldings).omit({ id: true });
export type InsertWalletHolding = z.infer<typeof insertWalletHoldingSchema>;
export type WalletHolding = typeof walletHoldings.$inferSelect;

// Wallet Transactions - Transfer history
export const walletTransactions = pgTable("wallet_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletId: varchar("wallet_id").notNull(),
  
  txHash: text("tx_hash").notNull(),
  network: text("network").$type<BlockchainNetwork>().notNull(),
  
  // Transaction details
  type: text("type").notNull(), // 'send' | 'receive' | 'swap' | 'stake' | 'unstake'
  tokenSymbol: text("token_symbol").notNull(),
  tokenAddress: text("token_address"),
  amount: real("amount").notNull(),
  amountUsd: real("amount_usd"),
  
  // Counterparty
  fromAddress: text("from_address"),
  toAddress: text("to_address"),
  
  // Metadata
  blockNumber: integer("block_number"),
  timestamp: text("timestamp").notNull(),
  isLargeTransaction: boolean("is_large_transaction").default(false), // >$100K
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWalletTransactionSchema = createInsertSchema(walletTransactions).omit({ id: true, createdAt: true });
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type WalletTransaction = typeof walletTransactions.$inferSelect;

// Wallet Alerts - Notifications for significant activity
export const walletAlerts = pgTable("wallet_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  walletId: varchar("wallet_id").notNull(),
  transactionId: varchar("transaction_id"),
  
  alertType: text("alert_type").$type<WalletAlertType>().notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  
  tokenSymbol: text("token_symbol"),
  amountUsd: real("amount_usd"),
  
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWalletAlertSchema = createInsertSchema(walletAlerts).omit({ id: true, createdAt: true });
export type InsertWalletAlert = z.infer<typeof insertWalletAlertSchema>;
export type WalletAlert = typeof walletAlerts.$inferSelect;

// ==========================================
// CT TRACKER - Crypto Twitter / Social Intelligence
// ==========================================

export type CTSourceType = 'twitter' | 'bluesky' | 'reddit' | 'discord' | 'rss' | 'telegram';
export type CTSentiment = 'bullish' | 'bearish' | 'neutral';
export type CTCallOutcome = 'pending' | 'win' | 'loss' | 'expired';

// CT Sources - Influencer accounts to track
export const ctSources = pgTable("ct_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  platform: text("platform").$type<CTSourceType>().notNull(),
  handle: text("handle").notNull(), // @username or feed URL
  displayName: text("display_name"),
  profileImageUrl: text("profile_image_url"),
  
  // Metrics
  followersCount: integer("followers_count"),
  historicalAccuracy: real("historical_accuracy"), // Win rate of past calls
  
  // Status
  isActive: boolean("is_active").default(true),
  lastFetchAt: text("last_fetch_at"),
  fetchErrorCount: integer("fetch_error_count").default(0),
  
  // Admin control
  isVerified: boolean("is_verified").default(false), // Admin-verified influencer
  category: text("category"), // 'analyst' | 'whale' | 'news' | 'degen'
  
  // Auto-follow settings
  autoFollowTrades: boolean("auto_follow_trades").default(false), // Auto-paper-trade their calls
  maxAutoTradeSize: real("max_auto_trade_size").default(100), // Max position size for auto-trades
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCTSourceSchema = createInsertSchema(ctSources).omit({ id: true, createdAt: true });
export type InsertCTSource = z.infer<typeof insertCTSourceSchema>;
export type CTSource = typeof ctSources.$inferSelect;

// CT Mentions - Parsed ticker mentions from social
export const ctMentions = pgTable("ct_mentions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").notNull(),
  
  // Content
  postUrl: text("post_url"),
  postText: text("post_text").notNull(),
  
  // Parsed Data
  tickers: text("tickers").array(), // ['$BTC', '$ETH', '$SOL']
  sentiment: text("sentiment").$type<CTSentiment>().notNull().default('neutral'),
  sentimentScore: real("sentiment_score"), // -1 to 1
  
  // Call details (if trading call detected)
  isCall: boolean("is_call").default(false), // Is this a specific trading call?
  callDirection: text("call_direction"), // 'long' | 'short'
  callTargetPrice: real("call_target_price"),
  callStopLoss: real("call_stop_loss"),
  
  // Engagement
  likesCount: integer("likes_count"),
  retweetsCount: integer("retweets_count"),
  repliesCount: integer("replies_count"),
  
  // Timestamps
  postedAt: text("posted_at").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCTMentionSchema = createInsertSchema(ctMentions).omit({ id: true, createdAt: true });
export type InsertCTMention = z.infer<typeof insertCTMentionSchema>;
export type CTMention = typeof ctMentions.$inferSelect;

// CT Call Performance - Track accuracy of influencer calls
export const ctCallPerformance = pgTable("ct_call_performance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  mentionId: varchar("mention_id").notNull(),
  sourceId: varchar("source_id").notNull(),
  
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // 'long' | 'short'
  
  // Entry/Exit
  callPrice: real("call_price").notNull(), // Price when call was made
  targetPrice: real("target_price"),
  stopLoss: real("stop_loss"),
  
  // Outcome
  outcome: text("outcome").$type<CTCallOutcome>().notNull().default('pending'),
  exitPrice: real("exit_price"),
  pnlPercent: real("pnl_percent"),
  resolvedAt: text("resolved_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCTCallPerformanceSchema = createInsertSchema(ctCallPerformance).omit({ id: true, createdAt: true });
export type InsertCTCallPerformance = z.infer<typeof insertCTCallPerformanceSchema>;
export type CTCallPerformance = typeof ctCallPerformance.$inferSelect;

// ============================================================================
// TELEMETRY & CONTINUOUS IMPROVEMENT TABLES
// ============================================================================

// Engine Source Type for telemetry
export type EngineSource = 'flow' | 'lotto' | 'quant' | 'ai' | 'hybrid' | 'manual';

// Trade Input Snapshots - Store signal inputs at generation time for ML feedback loops
export const tradeInputSnapshots = pgTable("trade_input_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeIdeaId: varchar("trade_idea_id").notNull(), // Link to trade_ideas.id
  engine: text("engine").$type<EngineSource>().notNull(),
  
  // Signal Inputs at Generation Time
  signalInputs: jsonb("signal_inputs"), // Full snapshot of inputs (RSI, volume, IV, etc.)
  
  // Key metrics that were used in decision
  volumeAtEntry: real("volume_at_entry"),
  rsiAtEntry: real("rsi_at_entry"),
  ivAtEntry: real("iv_at_entry"),
  premiumAtEntry: real("premium_at_entry"),
  skewRatioAtEntry: real("skew_ratio_at_entry"),
  
  // Confidence breakdown
  confidenceTotal: real("confidence_total"),
  confidenceBreakdown: jsonb("confidence_breakdown"), // {volume: 65, premium: 40, iv: 55, ...}
  qualityBand: text("quality_band"), // 'A', 'B+', 'B', 'C+', 'C'
  
  // Market context
  marketSessionAtEntry: text("market_session_at_entry"), // 'pre-market', 'rth', 'after-hours'
  vixAtEntry: real("vix_at_entry"),
  spyChangeAtEntry: real("spy_change_at_entry"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTradeInputSnapshotSchema = createInsertSchema(tradeInputSnapshots).omit({ id: true, createdAt: true });
export type InsertTradeInputSnapshot = z.infer<typeof insertTradeInputSnapshotSchema>;
export type TradeInputSnapshot = typeof tradeInputSnapshots.$inferSelect;

// Engine Daily Metrics - Aggregated daily performance per engine
export const engineDailyMetrics = pgTable("engine_daily_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(), // YYYY-MM-DD
  engine: text("engine").$type<EngineSource>().notNull(),
  
  // Idea Generation Stats
  ideasGenerated: integer("ideas_generated").notNull().default(0),
  ideasPublished: integer("ideas_published").notNull().default(0),
  
  // Outcome Stats
  tradesResolved: integer("trades_resolved").notNull().default(0),
  tradesWon: integer("trades_won").notNull().default(0),
  tradesLost: integer("trades_lost").notNull().default(0),
  tradesExpired: integer("trades_expired").notNull().default(0),
  
  // Performance Metrics
  winRate: real("win_rate"), // % (0-100)
  avgGainPercent: real("avg_gain_percent"), // Average % gain on winners
  avgLossPercent: real("avg_loss_percent"), // Average % loss on losers
  expectancy: real("expectancy"), // (winRate * avgGain) - ((1-winRate) * avgLoss)
  
  // Timing Metrics
  avgHoldingTimeMinutes: real("avg_holding_time_minutes"),
  avgTimeToTarget: real("avg_time_to_target"), // How fast winners hit target
  avgTimeToStop: real("avg_time_to_stop"), // How fast losers hit stop
  
  // Confidence Calibration
  avgConfidenceScore: real("avg_confidence_score"),
  confidenceByBand: jsonb("confidence_by_band"), // { A: {count, winRate}, B+: {...}, ... }
  
  // Risk Metrics
  maxDrawdownPercent: real("max_drawdown_percent"),
  sharpeRatio: real("sharpe_ratio"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertEngineDailyMetricsSchema = createInsertSchema(engineDailyMetrics).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEngineDailyMetrics = z.infer<typeof insertEngineDailyMetricsSchema>;
export type EngineDailyMetrics = typeof engineDailyMetrics.$inferSelect;

// Engine Health Alerts - Track when engines underperform
export const engineHealthAlerts = pgTable("engine_health_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  engine: text("engine").$type<EngineSource>().notNull(),
  alertType: text("alert_type").notNull(), // 'win_rate_drop', 'confidence_miscalibration', 'no_ideas', 'high_drawdown'
  severity: text("severity").notNull(), // 'info', 'warning', 'critical'
  
  message: text("message").notNull(),
  details: jsonb("details"), // Additional context
  
  // Resolution tracking
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedBy: varchar("acknowledged_by"),
  acknowledgedAt: text("acknowledged_at"),
  resolved: boolean("resolved").default(false),
  resolvedAt: text("resolved_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEngineHealthAlertSchema = createInsertSchema(engineHealthAlerts).omit({ id: true, createdAt: true });
export type InsertEngineHealthAlert = z.infer<typeof insertEngineHealthAlertSchema>;
export type EngineHealthAlert = typeof engineHealthAlerts.$inferSelect;

// ============================================================================
// TRADE AUDIT TRAIL - Price Evidence & Outcome Verification
// ============================================================================

// Price Snapshot Event Type
export type PriceSnapshotEventType = 
  | 'idea_published'      // When trade idea was created
  | 'entry_window_open'   // Entry window started
  | 'entry_window_closed' // Entry window ended
  | 'validation_check'    // Periodic validation check
  | 'target_hit'          // Price reached target
  | 'stop_hit'            // Price hit stop loss
  | 'expired'             // Trade expired without hitting target/stop
  | 'manual_close';       // User manually closed

// Trade Price Snapshots - Capture market evidence at key moments
export const tradePriceSnapshots = pgTable("trade_price_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeIdeaId: varchar("trade_idea_id").notNull(), // Link to trade_ideas.id
  
  // Event info
  eventType: text("event_type").$type<PriceSnapshotEventType>().notNull(),
  eventTimestamp: text("event_timestamp").notNull(), // ISO timestamp
  
  // Price data captured at this moment
  currentPrice: real("current_price").notNull(), // Underlying or option price
  bidPrice: real("bid_price"), // For options
  askPrice: real("ask_price"), // For options
  lastPrice: real("last_price"), // Last traded price
  
  // Distance from targets
  distanceToTargetPercent: real("distance_to_target_percent"), // How far from target
  distanceToStopPercent: real("distance_to_stop_percent"), // How far from stop
  pnlAtSnapshot: real("pnl_at_snapshot"), // Unrealized P&L at this point
  
  // For options - track greeks if available
  deltaAtSnapshot: real("delta_at_snapshot"),
  ivAtSnapshot: real("iv_at_snapshot"),
  
  // Data source info
  dataSource: text("data_source"), // 'tradier', 'yahoo', 'coingecko'
  validatorVersion: text("validator_version"), // Version of validation code
  
  // Raw quote data for audit purposes
  rawQuoteData: jsonb("raw_quote_data"), // Full quote response
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTradePriceSnapshotSchema = createInsertSchema(tradePriceSnapshots).omit({ id: true, createdAt: true });
export type InsertTradePriceSnapshot = z.infer<typeof insertTradePriceSnapshotSchema>;
export type TradePriceSnapshot = typeof tradePriceSnapshots.$inferSelect;

// ============================================================================
// BLOG CMS - Content Marketing & SEO
// ============================================================================

export type BlogPostStatus = 'draft' | 'published' | 'archived';
export type BlogCategory = 'market-commentary' | 'platform-updates' | 'education' | 'risk-management' | 'strategy' | 'news';

export const blogPosts = pgTable("blog_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: varchar("slug").unique().notNull(), // URL-friendly slug
  title: varchar("title").notNull(),
  excerpt: text("excerpt"), // Short description for SEO/previews
  content: text("content").notNull(), // Markdown content
  heroImageUrl: varchar("hero_image_url"),
  category: text("category").$type<BlogCategory>().notNull().default('market-commentary'),
  tags: text("tags").array(), // Array of tags
  authorId: varchar("author_id"), // Link to users table
  authorName: varchar("author_name").notNull().default('Trading Education Team'),
  status: text("status").$type<BlogPostStatus>().notNull().default('draft'),
  metaDescription: text("meta_description"), // SEO meta description
  metaKeywords: text("meta_keywords"), // SEO keywords
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBlogPostSchema = createInsertSchema(blogPosts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;
export type BlogPost = typeof blogPosts.$inferSelect;

// ============================================================================
// TESTIMONIALS - Social Proof
// ============================================================================

export const testimonials = pgTable("testimonials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  title: varchar("title"), // Job title/role
  company: varchar("company"),
  avatarUrl: varchar("avatar_url"),
  quote: text("quote").notNull(),
  rating: integer("rating").default(5), // 1-5 stars
  featured: boolean("featured").default(false),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTestimonialSchema = createInsertSchema(testimonials).omit({ id: true, createdAt: true });
export type InsertTestimonial = z.infer<typeof insertTestimonialSchema>;
export type Testimonial = typeof testimonials.$inferSelect;

// ============================================================================
// LOSS ANALYSIS - Post-Mortem Analysis of Failed Trades
// ============================================================================

// Loss Reason Categories
export type LossReasonCategory = 
  | 'market_reversal'      // Broad market turned against position
  | 'sector_weakness'      // Sector-specific headwind
  | 'bad_timing'           // Entry at wrong time (extended, exhaustion)
  | 'news_catalyst_failed' // Expected catalyst didn't materialize
  | 'stop_too_tight'       // Stop loss was too close to entry
  | 'overconfident_signal' // Engine gave high confidence but was wrong
  | 'low_volume_trap'      // Got trapped in illiquid name
  | 'gap_down_open'        // Overnight gap destroyed position
  | 'trend_exhaustion'     // Trend was already extended
  | 'fundamental_miss'     // Missed fundamental red flag
  | 'technical_breakdown'  // Key support/resistance failed
  | 'options_decay'        // Theta decay killed options position
  | 'volatility_crush'     // IV crush after event
  | 'correlation_blindspot'// Didn't account for correlated assets
  | 'unknown';             // Unable to determine cause

// Loss Severity
export type LossSeverity = 'minor' | 'moderate' | 'significant' | 'severe';

export const lossAnalysis = pgTable("loss_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeIdeaId: varchar("trade_idea_id").notNull(), // Reference to the failed trade
  
  // Trade Context at Time of Loss
  symbol: text("symbol").notNull(),
  engine: text("engine").notNull(), // ai, quant, flow, hybrid
  assetType: text("asset_type").notNull(), // stock, option, crypto
  direction: text("direction").notNull(), // long, short
  confidenceScore: real("confidence_score"), // What confidence was given
  probabilityBand: text("probability_band"), // A, B, C, D band
  
  // Loss Details
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price").notNull(),
  percentLoss: real("percent_loss").notNull(), // Negative number
  dollarLoss: real("dollar_loss"), // If position size known
  holdingTimeMinutes: integer("holding_time_minutes"),
  
  // Analysis Fields
  lossReason: text("loss_reason").$type<LossReasonCategory>().notNull().default('unknown'),
  severity: text("severity").$type<LossSeverity>().notNull().default('moderate'),
  
  // Context Factors
  marketConditionAtEntry: text("market_condition_at_entry"), // bullish, bearish, choppy
  vixLevelAtEntry: real("vix_level_at_entry"),
  sectorPerformance: text("sector_performance"), // sector was up/down
  timeOfDay: text("time_of_day"), // opening, mid-day, closing
  dayOfWeek: text("day_of_week"),
  
  // What Went Wrong
  whatWentWrong: text("what_went_wrong").notNull(), // Detailed explanation
  lessonsLearned: text("lessons_learned"), // What to do differently
  preventionStrategy: text("prevention_strategy"), // How to avoid in future
  
  // Pattern Detection
  isPatternMatch: boolean("is_pattern_match").default(false), // Matches a known failure pattern
  patternType: text("pattern_type"), // e.g., "extended_entry", "news_fade"
  similarLosses: text("similar_losses").array(), // IDs of similar past losses
  
  // AI Analysis (if available)
  aiAnalysis: text("ai_analysis"), // Claude's detailed post-mortem
  aiRecommendations: text("ai_recommendations").array(), // List of AI suggestions
  
  // Metadata
  analyzedAt: timestamp("analyzed_at").defaultNow(),
  analyzedBy: text("analyzed_by").default('system'), // 'system' or 'manual'
  reviewedByUser: boolean("reviewed_by_user").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLossAnalysisSchema = createInsertSchema(lossAnalysis).omit({ id: true, createdAt: true, analyzedAt: true });
export type InsertLossAnalysis = z.infer<typeof insertLossAnalysisSchema>;
export type LossAnalysis = typeof lossAnalysis.$inferSelect;

// Signal Attribution Analytics - Tracks win/loss rates per indicator
export const signalPerformance = pgTable("signal_performance", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  signalName: text("signal_name").notNull().unique(), // e.g., "RSI2_MEAN_REVERSION", "MACD_GOLDEN_CROSS"
  
  // Win/Loss Statistics
  totalTrades: integer("total_trades").notNull().default(0),
  winCount: integer("win_count").notNull().default(0),
  lossCount: integer("loss_count").notNull().default(0),
  openCount: integer("open_count").notNull().default(0),
  
  // Performance Metrics
  winRate: real("win_rate").notNull().default(0), // 0-100 percentage
  avgWinPercent: real("avg_win_percent").notNull().default(0), // Average % gain on wins
  avgLossPercent: real("avg_loss_percent").notNull().default(0), // Average % loss on losses
  profitFactor: real("profit_factor").notNull().default(0), // Total wins / Total losses
  expectancy: real("expectancy").notNull().default(0), // Expected value per trade
  
  // By Asset Type
  stockWinRate: real("stock_win_rate").default(0),
  optionWinRate: real("option_win_rate").default(0),
  cryptoWinRate: real("crypto_win_rate").default(0),
  
  // Trend Data (last 30 trades)
  recentWinRate: real("recent_win_rate").default(0), // Win rate of most recent 30 trades
  trendDirection: text("trend_direction").$type<'improving' | 'declining' | 'stable'>().default('stable'),
  
  // Confidence Score (calculated)
  reliabilityScore: real("reliability_score").default(0), // 0-100, higher = more reliable signal
  sampleSizeGrade: text("sample_size_grade").$type<'A' | 'B' | 'C' | 'D' | 'F'>().default('F'), // Based on # of trades
  
  // Metadata
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSignalPerformanceSchema = createInsertSchema(signalPerformance).omit({ id: true, createdAt: true, lastCalculatedAt: true });
export type InsertSignalPerformance = z.infer<typeof insertSignalPerformanceSchema>;
export type SignalPerformance = typeof signalPerformance.$inferSelect;

// Signal Performance by Time Period - For trend analysis
export interface SignalTrendData {
  signalName: string;
  period: 'day' | 'week' | 'month' | 'all_time';
  winRate: number;
  totalTrades: number;
  profitFactor: number;
}

// Auto Lotto Bot Preferences - Personalized trading strategy settings
export const autoLottoPreferences = pgTable("auto_lotto_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  
  // Risk Profile Settings
  riskTolerance: text("risk_tolerance").$type<'conservative' | 'moderate' | 'aggressive'>().notNull().default('moderate'),
  maxPositionSize: real("max_position_size").notNull().default(100), // Max $ per trade
  maxConcurrentTrades: integer("max_concurrent_trades").notNull().default(5),
  dailyLossLimit: real("daily_loss_limit").default(200), // Stop trading after this daily loss
  
  // Capital Allocation
  optionsAllocation: real("options_allocation").notNull().default(40), // % of capital for options
  futuresAllocation: real("futures_allocation").notNull().default(30), // % for futures
  cryptoAllocation: real("crypto_allocation").notNull().default(30), // % for crypto
  
  // Asset Type Preferences
  enableOptions: boolean("enable_options").notNull().default(true),
  enableFutures: boolean("enable_futures").notNull().default(true),
  enableCrypto: boolean("enable_crypto").notNull().default(true),
  enablePropFirm: boolean("enable_prop_firm").notNull().default(false),
  
  // Options Strategy Preferences
  optionsPreferredDte: integer("options_preferred_dte").notNull().default(7), // Days to expiration
  optionsMaxDte: integer("options_max_dte").notNull().default(14),
  optionsMinDelta: real("options_min_delta").notNull().default(0.20),
  optionsMaxDelta: real("options_max_delta").notNull().default(0.40),
  optionsPreferCalls: boolean("options_prefer_calls").notNull().default(true),
  optionsPreferPuts: boolean("options_prefer_puts").notNull().default(true),
  optionsPreferredSymbols: text("options_preferred_symbols").array(), // Specific tickers to watch
  
  // Futures Strategy Preferences
  futuresPreferredContracts: text("futures_preferred_contracts").array().default(sql`ARRAY['NQ', 'ES', 'GC']::text[]`),
  futuresMaxContracts: integer("futures_max_contracts").notNull().default(2),
  futuresStopPoints: integer("futures_stop_points").notNull().default(15), // Stop loss in points
  futuresTargetPoints: integer("futures_target_points").notNull().default(30), // Profit target in points
  
  // Crypto Strategy Preferences
  cryptoPreferredCoins: text("crypto_preferred_coins").array().default(sql`ARRAY['BTC', 'ETH', 'SOL']::text[]`),
  cryptoEnableMemeCoins: boolean("crypto_enable_meme_coins").notNull().default(false), // PEPE, BONK, DOGE
  cryptoMaxLeverageMultiplier: real("crypto_max_leverage_multiplier").notNull().default(1.0), // 1.0 = no leverage
  
  // Entry/Exit Rules
  minConfidenceScore: integer("min_confidence_score").notNull().default(70), // 0-100, minimum score to enter
  preferredHoldingPeriod: text("preferred_holding_period").$type<'day' | 'swing' | 'position'>().notNull().default('day'),
  minRiskRewardRatio: real("min_risk_reward_ratio").notNull().default(2.0), // Minimum R:R to take trade
  useDynamicExits: boolean("use_dynamic_exits").notNull().default(true), // Use trailing stops
  
  // Trading Session Preferences
  tradePreMarket: boolean("trade_pre_market").notNull().default(false),
  tradeRegularHours: boolean("trade_regular_hours").notNull().default(true),
  tradeAfterHours: boolean("trade_after_hours").notNull().default(false),
  preferredEntryWindows: text("preferred_entry_windows").array().default(sql`ARRAY['09:30-11:00', '14:00-15:30']::text[]`), // CT times
  
  // Notifications & Alerts
  enableDiscordAlerts: boolean("enable_discord_alerts").notNull().default(true),
  enableEmailAlerts: boolean("enable_email_alerts").notNull().default(false),
  alertOnEntry: boolean("alert_on_entry").notNull().default(true),
  alertOnExit: boolean("alert_on_exit").notNull().default(true),
  alertOnDailyLimit: boolean("alert_on_daily_limit").notNull().default(true),
  
  // Automation Level
  automationMode: text("automation_mode").$type<'full_auto' | 'signals_only' | 'paper_only'>().notNull().default('paper_only'),
  requireConfirmation: boolean("require_confirmation").notNull().default(true), // Require user confirmation before entry
  
  // Metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAutoLottoPreferencesSchema = createInsertSchema(autoLottoPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAutoLottoPreferences = z.infer<typeof insertAutoLottoPreferencesSchema>;
export type AutoLottoPreferences = typeof autoLottoPreferences.$inferSelect;

// Zod schema for frontend form validation with extended rules
export const autoLottoPreferencesFormSchema = insertAutoLottoPreferencesSchema.extend({
  maxPositionSize: z.coerce.number().min(10).max(1000),
  maxConcurrentTrades: z.coerce.number().min(1).max(20),
  dailyLossLimit: z.coerce.number().min(50).max(5000).optional(),
  optionsAllocation: z.coerce.number().min(0).max(100),
  futuresAllocation: z.coerce.number().min(0).max(100),
  cryptoAllocation: z.coerce.number().min(0).max(100),
  minConfidenceScore: z.coerce.number().min(50).max(95),
  minRiskRewardRatio: z.coerce.number().min(1.0).max(10.0),
  optionsMinDelta: z.coerce.number().min(0.05).max(0.50),
  optionsMaxDelta: z.coerce.number().min(0.10).max(0.60),
});

// ============================================================================
// PLATFORM REPORTS - Daily/Weekly/Monthly Analytics Reports
// ============================================================================

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';
export type ReportStatus = 'generating' | 'completed' | 'failed';

export const platformReports = pgTable("platform_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  period: text("period").$type<ReportPeriod>().notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").$type<ReportStatus>().notNull().default('generating'),
  
  // Trade Idea Stats
  totalIdeasGenerated: integer("total_ideas_generated").default(0),
  aiIdeasGenerated: integer("ai_ideas_generated").default(0),
  quantIdeasGenerated: integer("quant_ideas_generated").default(0),
  hybridIdeasGenerated: integer("hybrid_ideas_generated").default(0),
  
  // Performance Metrics
  totalTradesResolved: integer("total_trades_resolved").default(0),
  totalWins: integer("total_wins").default(0),
  totalLosses: integer("total_losses").default(0),
  overallWinRate: real("overall_win_rate"),
  avgGainPercent: real("avg_gain_percent"),
  avgLossPercent: real("avg_loss_percent"),
  totalPnlPercent: real("total_pnl_percent"),
  
  // Engine-Specific Performance
  aiWinRate: real("ai_win_rate"),
  quantWinRate: real("quant_win_rate"),
  hybridWinRate: real("hybrid_win_rate"),
  bestPerformingEngine: text("best_performing_engine"),
  
  // Bot Activity Stats
  autoLottoTrades: integer("auto_lotto_trades").default(0),
  autoLottoPnl: real("auto_lotto_pnl").default(0),
  futuresBotTrades: integer("futures_bot_trades").default(0),
  futuresBotPnl: real("futures_bot_pnl").default(0),
  cryptoBotTrades: integer("crypto_bot_trades").default(0),
  cryptoBotPnl: real("crypto_bot_pnl").default(0),
  propFirmTrades: integer("prop_firm_trades").default(0),
  propFirmPnl: real("prop_firm_pnl").default(0),
  
  // Scanner Activity
  optionsFlowAlerts: integer("options_flow_alerts").default(0),
  marketScannerSymbolsTracked: integer("market_scanner_symbols_tracked").default(0),
  ctTrackerMentions: integer("ct_tracker_mentions").default(0),
  ctTrackerAutoTrades: integer("ct_tracker_auto_trades").default(0),
  
  // Asset Type Breakdown
  stockTradeCount: integer("stock_trade_count").default(0),
  optionsTradeCount: integer("options_trade_count").default(0),
  cryptoTradeCount: integer("crypto_trade_count").default(0),
  futuresTradeCount: integer("futures_trade_count").default(0),
  
  // Top Performers
  topWinningSymbols: jsonb("top_winning_symbols"),
  topLosingSymbols: jsonb("top_losing_symbols"),
  
  // User Engagement (optional)
  activeUsers: integer("active_users").default(0),
  newUsers: integer("new_users").default(0),
  
  // Full report data as JSON for detailed breakdown
  reportData: jsonb("report_data"),
  
  generatedBy: varchar("generated_by"),
  generatedAt: timestamp("generated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPlatformReportSchema = createInsertSchema(platformReports).omit({ id: true, createdAt: true, generatedAt: true });
export type InsertPlatformReport = z.infer<typeof insertPlatformReportSchema>;
export type PlatformReport = typeof platformReports.$inferSelect;

// ==========================================
// SEC FILINGS & GOVERNMENT CONTRACTS
// Catalyst Intelligence System
// ==========================================

// SEC Filing Types
export type SECFilingType = '8-K' | '10-K' | '10-Q' | '13F' | 'Form4' | 'S-1' | 'DEF14A' | 'other';
export type FilingSentiment = 'bullish' | 'bearish' | 'neutral' | 'mixed';
export type CatalystEventType = 'sec_filing' | 'gov_contract' | 'earnings' | 'insider_trade' | 'acquisition' | 'product_launch';

// SEC Filings - Track SEC EDGAR filings
export const secFilings = pgTable("sec_filings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Filing Identification
  accessionNumber: varchar("accession_number").unique().notNull(), // SEC unique ID
  cik: varchar("cik").notNull(), // Company CIK number
  ticker: varchar("ticker"), // Stock ticker if mapped
  companyName: text("company_name").notNull(),
  
  // Filing Details
  filingType: text("filing_type").$type<SECFilingType>().notNull(),
  filingDate: text("filing_date").notNull(), // When filed with SEC
  acceptanceDate: text("acceptance_date"), // When SEC accepted
  
  // Content
  filingUrl: text("filing_url").notNull(), // Link to SEC EDGAR
  documentCount: integer("document_count").default(1),
  
  // Parsed Analysis
  extractedSummary: text("extracted_summary"), // AI-extracted key points
  sentiment: text("sentiment").$type<FilingSentiment>().default('neutral'),
  sentimentScore: real("sentiment_score").default(0), // -100 to +100
  catalystTags: text("catalyst_tags").array(), // ['acquisition', 'revenue_growth', 'executive_change']
  
  // Key Data Points (extracted)
  revenueChange: real("revenue_change"), // % change if financial filing
  epsChange: real("eps_change"),
  guidanceDirection: text("guidance_direction"), // 'raised', 'lowered', 'maintained', 'withdrawn'
  insiderShares: integer("insider_shares"), // For Form 4
  insiderValue: real("insider_value"), // Dollar value of insider transaction
  insiderDirection: text("insider_direction"), // 'buy', 'sell', 'gift'
  
  // Processing Status
  parsedAt: timestamp("parsed_at"),
  isProcessed: boolean("is_processed").default(false),
  processingError: text("processing_error"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSecFilingSchema = createInsertSchema(secFilings).omit({ id: true, createdAt: true });
export type InsertSecFiling = z.infer<typeof insertSecFilingSchema>;
export type SecFiling = typeof secFilings.$inferSelect;

// SEC Filing Signals - Individual signals extracted from filings
export const secFilingSignals = pgTable("sec_filing_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filingId: varchar("filing_id").notNull(), // References secFilings.id
  
  signalType: text("signal_type").notNull(), // 'insider_buy_large', 'revenue_beat', 'acquisition_announced', etc.
  polarity: text("polarity").notNull().$type<'bullish' | 'bearish' | 'neutral'>(),
  confidence: real("confidence").notNull().default(0.5), // 0-1
  weight: real("weight").notNull().default(1), // Scoring weight
  
  rawContext: text("raw_context"), // The text snippet that triggered this signal
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSecFilingSignalSchema = createInsertSchema(secFilingSignals).omit({ id: true, createdAt: true });
export type InsertSecFilingSignal = z.infer<typeof insertSecFilingSignalSchema>;
export type SecFilingSignal = typeof secFilingSignals.$inferSelect;

// Government Contracts - Track USASpending.gov contract awards
export const governmentContracts = pgTable("government_contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Contract Identification
  awardId: varchar("award_id").unique().notNull(), // USASpending unique ID
  piid: varchar("piid"), // Procurement Instrument ID
  
  // Recipient
  recipientName: text("recipient_name").notNull(),
  recipientTicker: varchar("recipient_ticker"), // Stock ticker if public company
  recipientDuns: varchar("recipient_duns"), // DUNS number
  
  // Agency
  awardingAgencyName: text("awarding_agency_name").notNull(),
  awardingAgencyCode: varchar("awarding_agency_code"),
  fundingAgencyName: text("funding_agency_name"),
  
  // Contract Details
  description: text("description"),
  contractType: text("contract_type"), // 'fixed_price', 'cost_plus', 'time_materials'
  naicsCode: varchar("naics_code"), // Industry classification
  naicsDescription: text("naics_description"),
  
  // Financial
  obligationAmount: real("obligation_amount").notNull(), // Current obligation
  totalOutlayAmount: real("total_outlay_amount"), // Total spent
  baseAndExercisedOptionsValue: real("base_exercised_value"), // Potential value
  
  // Dates
  awardDate: text("award_date").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  
  // Classification
  isDefense: boolean("is_defense").default(false),
  isHealthcare: boolean("is_healthcare").default(false),
  isTechnology: boolean("is_technology").default(false),
  
  // Scoring
  significanceScore: real("significance_score").default(0), // 0-100 based on size/company
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGovernmentContractSchema = createInsertSchema(governmentContracts).omit({ id: true, createdAt: true });
export type InsertGovernmentContract = z.infer<typeof insertGovernmentContractSchema>;
export type GovernmentContract = typeof governmentContracts.$inferSelect;

// Catalyst Events - Unified view of all catalysts for trading signals
export const catalystEvents = pgTable("catalyst_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Symbol mapping
  ticker: varchar("ticker").notNull(),
  companyName: text("company_name"),
  
  // Event Type
  eventType: text("event_type").$type<CatalystEventType>().notNull(),
  sourceId: varchar("source_id"), // References secFilings.id or governmentContracts.id
  sourceTable: text("source_table"), // 'sec_filings' | 'government_contracts'
  
  // Event Details
  title: text("title").notNull(),
  summary: text("summary"),
  eventDate: text("event_date").notNull(),
  
  // Scoring for Multi-Factor Analysis
  signalStrength: real("signal_strength").notNull().default(0), // 0-100
  polarity: text("polarity").notNull().$type<'bullish' | 'bearish' | 'neutral'>(),
  confidence: real("confidence").notNull().default(0.5), // 0-1
  
  // Relevance Decay
  expiresAt: text("expires_at"), // When this catalyst becomes stale
  isActive: boolean("is_active").default(true),
  
  // Trade Integration
  wasUsedInTrade: boolean("was_used_in_trade").default(false),
  tradeIdeaId: varchar("trade_idea_id"), // If this catalyst triggered a trade
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCatalystEventSchema = createInsertSchema(catalystEvents).omit({ id: true, createdAt: true });
export type InsertCatalystEvent = z.infer<typeof insertCatalystEventSchema>;
export type CatalystEvent = typeof catalystEvents.$inferSelect;

// Symbol Catalyst Snapshots - Cached catalyst summary per symbol for fast lookups
export const symbolCatalystSnapshots = pgTable("symbol_catalyst_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  ticker: varchar("ticker").unique().notNull(),
  
  // Aggregate Scores
  bullishCatalystCount: integer("bullish_catalyst_count").default(0),
  bearishCatalystCount: integer("bearish_catalyst_count").default(0),
  neutralCatalystCount: integer("neutral_catalyst_count").default(0),
  
  aggregateCatalystScore: real("aggregate_catalyst_score").default(0), // Net score -100 to +100
  
  // Recent Events Summary
  recentCatalysts: jsonb("recent_catalysts"), // Array of recent catalyst summaries
  
  // Last SEC Filing
  lastSecFilingDate: text("last_sec_filing_date"),
  lastSecFilingType: text("last_sec_filing_type"),
  
  // Last Government Contract
  lastGovContractDate: text("last_gov_contract_date"),
  lastGovContractValue: real("last_gov_contract_value"),
  
  // Cache Management
  lastUpdated: timestamp("last_updated").defaultNow(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSymbolCatalystSnapshotSchema = createInsertSchema(symbolCatalystSnapshots).omit({ id: true, createdAt: true, lastUpdated: true });
export type InsertSymbolCatalystSnapshot = z.infer<typeof insertSymbolCatalystSnapshotSchema>;
export type SymbolCatalystSnapshot = typeof symbolCatalystSnapshots.$inferSelect;

// ============================================================================
// USER ANALYTICS & TRACKING
// ============================================================================

// User Login History - Track login events
export const userLoginHistory = pgTable("user_login_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  
  // Login details
  loginAt: timestamp("login_at").defaultNow(),
  ipAddress: varchar("ip_address"),
  userAgent: text("user_agent"),
  
  // Parsed user agent info
  browser: varchar("browser"),
  os: varchar("os"),
  device: varchar("device"), // 'desktop', 'mobile', 'tablet'
  
  // Session info
  sessionId: varchar("session_id"),
  logoutAt: timestamp("logout_at"),
  
  // Auth method
  authMethod: varchar("auth_method"), // 'password', 'google', 'replit'
  
  // Location (if available from IP)
  country: varchar("country"),
  city: varchar("city"),
});

export const insertUserLoginHistorySchema = createInsertSchema(userLoginHistory).omit({ id: true, loginAt: true });
export type InsertUserLoginHistory = z.infer<typeof insertUserLoginHistorySchema>;
export type UserLoginHistory = typeof userLoginHistory.$inferSelect;

// Page Views - Track page visits
export const pageViews = pgTable("page_views", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // User info (nullable for anonymous)
  userId: varchar("user_id"),
  sessionId: varchar("session_id"),
  
  // Page info
  path: varchar("path").notNull(),
  referrer: text("referrer"),
  
  // Timing
  viewedAt: timestamp("viewed_at").defaultNow(),
  timeOnPage: integer("time_on_page"), // seconds spent on page
  
  // Device info
  userAgent: text("user_agent"),
  device: varchar("device"),
  browser: varchar("browser"),
  
  // UTM tracking
  utmSource: varchar("utm_source"),
  utmMedium: varchar("utm_medium"),
  utmCampaign: varchar("utm_campaign"),
});

export const insertPageViewSchema = createInsertSchema(pageViews).omit({ id: true, viewedAt: true });
export type InsertPageView = z.infer<typeof insertPageViewSchema>;
export type PageView = typeof pageViews.$inferSelect;

// User Activity Events - Track feature usage
export type UserActivityType = 
  | 'view_trade_idea' 
  | 'generate_idea' 
  | 'view_chart' 
  | 'export_pdf' 
  | 'add_to_watchlist' 
  | 'journal_entry' 
  | 'run_scanner'
  | 'view_performance'
  | 'settings_change'
  | 'subscription_action';

export const userActivityEvents = pgTable("user_activity_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  userId: varchar("user_id").notNull(),
  sessionId: varchar("session_id"),
  
  // Activity details
  activityType: varchar("activity_type").notNull().$type<UserActivityType>(),
  description: text("description"),
  
  // Context data (flexible JSON for different activity types)
  metadata: jsonb("metadata"), // { symbol: 'AAPL', ideaId: '123', etc. }
  
  // Timing
  occurredAt: timestamp("occurred_at").defaultNow(),
  
  // Device info
  device: varchar("device"),
});

export const insertUserActivityEventSchema = createInsertSchema(userActivityEvents).omit({ id: true, occurredAt: true });
export type InsertUserActivityEvent = z.infer<typeof insertUserActivityEventSchema>;
export type UserActivityEvent = typeof userActivityEvents.$inferSelect;

// User Analytics Summary - Aggregated daily stats per user
export const userAnalyticsSummary = pgTable("user_analytics_summary", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  userId: varchar("user_id").notNull(),
  date: varchar("date").notNull(), // YYYY-MM-DD format
  
  // Session stats
  totalSessions: integer("total_sessions").default(0),
  totalTimeSeconds: integer("total_time_seconds").default(0),
  
  // Page stats
  pageViews: integer("page_views").default(0),
  uniquePages: integer("unique_pages").default(0),
  
  // Feature usage
  ideasViewed: integer("ideas_viewed").default(0),
  ideasGenerated: integer("ideas_generated").default(0),
  chartsViewed: integer("charts_viewed").default(0),
  pdfsExported: integer("pdfs_exported").default(0),
  journalEntries: integer("journal_entries").default(0),
  scannersRun: integer("scanners_run").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserAnalyticsSummarySchema = createInsertSchema(userAnalyticsSummary).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserAnalyticsSummary = z.infer<typeof insertUserAnalyticsSummarySchema>;
export type UserAnalyticsSummary = typeof userAnalyticsSummary.$inferSelect;

// ============================================================================
// AI CREDITS SYSTEM - Query-based credit tracking per tier
// ============================================================================

// AI Credit Balances - Monthly credit allocation per user
export const aiCreditBalances = pgTable("ai_credit_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  
  // Tier snapshot at time of allocation
  tierSnapshot: varchar("tier_snapshot").notNull().$type<SubscriptionTier>(),
  
  // Credit amounts
  creditsAllocated: integer("credits_allocated").notNull().default(30), // Monthly allocation based on tier
  creditsUsed: integer("credits_used").notNull().default(0),
  creditsRemaining: integer("credits_remaining").notNull().default(30),
  
  // Billing cycle (resets with subscription or monthly for free)
  cycleStart: timestamp("cycle_start").notNull().defaultNow(),
  cycleEnd: timestamp("cycle_end").notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAiCreditBalanceSchema = createInsertSchema(aiCreditBalances).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiCreditBalance = z.infer<typeof insertAiCreditBalanceSchema>;
export type AiCreditBalance = typeof aiCreditBalances.$inferSelect;

// AI Usage Ledger - Individual usage records for audit and analytics
export const aiUsageLedger = pgTable("ai_usage_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  
  // Provider info
  provider: varchar("provider").notNull(), // 'gemini', 'anthropic', 'openai'
  model: varchar("model").notNull(), // 'gemini-2.5-flash', 'claude-sonnet-4', etc.
  
  // Token usage (for analytics, not billing)
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  
  // Credit deduction (1 credit per query)
  creditsDebited: integer("credits_debited").notNull().default(1),
  
  // Estimated cost in cents (for admin visibility)
  estimatedCostCents: real("estimated_cost_cents"),
  
  // Request context
  requestType: varchar("request_type").notNull().default('research_assistant'), // 'research_assistant', 'chart_analysis', etc.
  questionPreview: text("question_preview"), // First 100 chars of question
  
  // Metadata
  responseTimeMs: integer("response_time_ms"),
  wasSuccessful: boolean("was_successful").notNull().default(true),
  errorMessage: text("error_message"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAiUsageLedgerSchema = createInsertSchema(aiUsageLedger).omit({ id: true, createdAt: true });
export type InsertAiUsageLedger = z.infer<typeof insertAiUsageLedgerSchema>;
export type AiUsageLedger = typeof aiUsageLedger.$inferSelect;

// Credit tier allocations - for reference
export const AI_CREDIT_ALLOCATIONS: Record<SubscriptionTier, number> = {
  free: 30,       // ~1 chat/day
  advanced: 600,  // ~20 chats/day
  pro: 1500,      // ~50 chats/day
  admin: 999999,  // Unlimited for admins
};

// ============================================================================
// FEATURE CREDIT TRANSACTIONS - Track daily credits for waitlist users
// ============================================================================

export type CreditTransactionType =
  | 'daily_refresh'      // Daily 10 credits reset
  | 'daily_login'        // +2 for login
  | 'streak_bonus'       // +10 for 7-day streak
  | 'referral_signup'    // +20 for referral
  | 'lesson_complete'    // +3 for lesson
  | 'twitter_share'      // +5 for sharing
  | 'feature_spend'      // Negative - spent on feature
  | 'admin_grant'        // Admin-granted credits
  | 'promo_code';        // Promotional credits

export const creditTransactions = pgTable("credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),

  // Transaction details
  type: varchar("type").$type<CreditTransactionType>().notNull(),
  amount: integer("amount").notNull(), // Positive for earn, negative for spend
  balanceAfter: integer("balance_after").notNull(),

  // Context
  featureId: varchar("feature_id"), // Which feature was used (for spends)
  description: text("description"), // Human-readable description
  metadata: jsonb("metadata"), // Extra context (referral user ID, lesson ID, etc.)

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_credit_transactions_user_id").on(table.userId),
  index("idx_credit_transactions_created_at").on(table.createdAt),
]);

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({ id: true, createdAt: true });
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

// ============================================================================
// BETA WAITLIST - Email collection for early access
// ============================================================================

export type WaitlistStatus = 'pending' | 'approved' | 'invited' | 'joined' | 'rejected';

export const betaWaitlist = pgTable("beta_waitlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  source: varchar("source").default('landing'), // 'landing', 'discord', 'referral'
  referralCode: varchar("referral_code"),
  status: varchar("status").$type<WaitlistStatus>().default('pending'),
  notifiedDiscord: boolean("notified_discord").default(false),
  inviteSent: boolean("invite_sent").default(false),
  convertedToUser: boolean("converted_to_user").default(false),
  inviteId: varchar("invite_id"), // FK to betaInvites when invite is sent
  lastContactedAt: timestamp("last_contacted_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBetaWaitlistSchema = createInsertSchema(betaWaitlist).omit({ id: true, createdAt: true, notifiedDiscord: true, inviteSent: true, convertedToUser: true, status: true, inviteId: true, lastContactedAt: true });
export type InsertBetaWaitlist = z.infer<typeof insertBetaWaitlistSchema>;
export type BetaWaitlist = typeof betaWaitlist.$inferSelect;

// ============================================================================
// BETA INVITES - Unique invite codes for beta access
// ============================================================================

export type InviteStatus = 'pending' | 'sent' | 'redeemed' | 'expired' | 'revoked';

export const betaInvites = pgTable("beta_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull(),
  token: varchar("token").unique().notNull(), // Unique invite token
  status: varchar("status").$type<InviteStatus>().default('pending'),
  tierOverride: varchar("tier_override").$type<SubscriptionTier>(), // Optional tier upgrade with invite
  notes: text("notes"), // Admin notes
  sentAt: timestamp("sent_at"),
  redeemedAt: timestamp("redeemed_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBetaInviteSchema = createInsertSchema(betaInvites).omit({ id: true, createdAt: true, sentAt: true, redeemedAt: true, status: true });
export type InsertBetaInvite = z.infer<typeof insertBetaInviteSchema>;
export type BetaInvite = typeof betaInvites.$inferSelect;

// ============================================================================
// PASSWORD RESET TOKENS - Secure password recovery
// ============================================================================

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  email: varchar("email").notNull(),
  token: varchar("token").unique().notNull(),
  used: boolean("used").default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true, createdAt: true, used: true });
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ============================================================================
// HISTORICAL TRADE INTELLIGENCE - Learning from 3,000+ trade ideas
// ============================================================================

// Catalyst categories for tracking response patterns
export type CatalystCategory = 'earnings' | 'fda_approval' | 'government_contract' | 'merger_acquisition' | 'product_launch' | 'analyst_upgrade' | 'analyst_downgrade' | 'insider_buying' | 'insider_selling' | 'technical_breakout' | 'momentum_surge' | 'sector_rotation' | 'macro_event' | 'ai_news' | 'quantum_news' | 'crypto_news' | 'other';

// Symbol Behavior Profiles - Track how each ticker responds to catalysts
export const symbolBehaviorProfiles = pgTable("symbol_behavior_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol").notNull().unique(),
  
  // Overall Statistics
  totalIdeas: integer("total_ideas").notNull().default(0),
  closedIdeas: integer("closed_ideas").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  breakevens: integer("breakevens").notNull().default(0),
  
  // Win Rate Metrics
  overallWinRate: real("overall_win_rate").default(0), // 0-100%
  longWinRate: real("long_win_rate").default(0), // Win rate for long positions
  shortWinRate: real("short_win_rate").default(0), // Win rate for short positions
  optionsWinRate: real("options_win_rate").default(0), // Win rate for options trades
  
  // Profit Metrics
  totalPnL: real("total_pnl").default(0), // Total realized P&L
  avgWinAmount: real("avg_win_amount").default(0), // Average $ win
  avgLossAmount: real("avg_loss_amount").default(0), // Average $ loss
  avgWinPercent: real("avg_win_percent").default(0), // Average % gain on wins
  avgLossPercent: real("avg_loss_percent").default(0), // Average % loss on losses
  profitFactor: real("profit_factor").default(0), // Total wins / Total losses
  
  // Confidence Calibration
  avgConfidenceScore: real("avg_confidence_score").default(0), // Average predicted confidence
  actualWinRateVsPredicted: real("actual_win_rate_vs_predicted").default(0), // Calibration (100 = perfect)
  
  // Best Catalyst Performance
  bestCatalystType: varchar("best_catalyst_type").$type<CatalystCategory>(),
  bestCatalystWinRate: real("best_catalyst_win_rate").default(0),
  worstCatalystType: varchar("worst_catalyst_type").$type<CatalystCategory>(),
  worstCatalystWinRate: real("worst_catalyst_win_rate").default(0),
  
  // Session/Timing Performance
  bestSessionPhase: varchar("best_session_phase").$type<SessionPhase>(),
  bestSessionWinRate: real("best_session_win_rate").default(0),
  
  // Volatility Performance
  bestVolatilityRegime: varchar("best_volatility_regime").$type<VolatilityRegime>(),
  bestVolatilityWinRate: real("best_volatility_win_rate").default(0),
  
  // Sector & Classification
  sector: varchar("sector"),
  industry: varchar("industry"),
  avgVolume: real("avg_volume"),
  marketCap: varchar("market_cap"), // 'mega', 'large', 'mid', 'small', 'micro', 'nano'
  
  // Timestamps
  lastTradeDate: timestamp("last_trade_date"),
  profileUpdatedAt: timestamp("profile_updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSymbolBehaviorProfileSchema = createInsertSchema(symbolBehaviorProfiles).omit({ id: true, createdAt: true, profileUpdatedAt: true });
export type InsertSymbolBehaviorProfile = z.infer<typeof insertSymbolBehaviorProfileSchema>;
export type SymbolBehaviorProfile = typeof symbolBehaviorProfiles.$inferSelect;

// Symbol Catalyst Responses - Track individual catalyst events and outcomes
export const symbolCatalystResponses = pgTable("symbol_catalyst_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol").notNull(),
  tradeIdeaId: varchar("trade_idea_id").notNull(), // Link to original trade idea
  
  // Catalyst Details
  catalystCategory: varchar("catalyst_category").$type<CatalystCategory>().notNull(),
  catalystText: text("catalyst_text"), // Original catalyst description
  catalystDate: timestamp("catalyst_date").notNull(),
  
  // Trade Details
  direction: varchar("direction").notNull(), // 'long' | 'short'
  assetType: varchar("asset_type").$type<AssetType>().notNull(),
  entryPrice: real("entry_price").notNull(),
  targetPrice: real("target_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  confidenceScore: real("confidence_score"),
  
  // Outcome
  outcomeStatus: varchar("outcome_status").$type<OutcomeStatus>(),
  exitPrice: real("exit_price"),
  pnlPercent: real("pnl_percent"),
  pnlDollars: real("pnl_dollars"),
  holdingTimeMinutes: integer("holding_time_minutes"),
  
  // Context at Entry
  volatilityRegime: varchar("volatility_regime").$type<VolatilityRegime>(),
  sessionPhase: varchar("session_phase").$type<SessionPhase>(),
  marketCondition: varchar("market_condition"), // 'bullish', 'bearish', 'neutral'
  
  // Price Movement Analysis
  maxFavorableMove: real("max_favorable_move"), // Highest % move in our direction
  maxAdverseMove: real("max_adverse_move"), // Worst % move against us
  timeToMaxFavorable: integer("time_to_max_favorable"), // Minutes to peak
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSymbolCatalystResponseSchema = createInsertSchema(symbolCatalystResponses).omit({ id: true, createdAt: true });
export type InsertSymbolCatalystResponse = z.infer<typeof insertSymbolCatalystResponseSchema>;
export type SymbolCatalystResponse = typeof symbolCatalystResponses.$inferSelect;

// Confidence Calibration - Track predicted vs actual outcomes by confidence band
export const confidenceCalibration = pgTable("confidence_calibration", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Confidence Band
  confidenceBandMin: real("confidence_band_min").notNull(), // e.g., 80
  confidenceBandMax: real("confidence_band_max").notNull(), // e.g., 85
  bandLabel: varchar("band_label").notNull(), // e.g., "80-85"
  
  // Predictions at this confidence level
  totalPredictions: integer("total_predictions").notNull().default(0),
  closedPredictions: integer("closed_predictions").notNull().default(0),
  correctPredictions: integer("correct_predictions").notNull().default(0),
  
  // Accuracy Metrics
  actualWinRate: real("actual_win_rate").default(0), // What actually happened
  expectedWinRate: real("expected_win_rate").default(0), // What confidence predicted
  calibrationError: real("calibration_error").default(0), // Difference (negative = overconfident)
  
  // Profit at this level
  avgPnLPercent: real("avg_pnl_percent").default(0),
  avgPnLDollars: real("avg_pnl_dollars").default(0),
  
  // Breakdown by source
  aiPredictions: integer("ai_predictions").default(0),
  aiWinRate: real("ai_win_rate").default(0),
  quantPredictions: integer("quant_predictions").default(0),
  quantWinRate: real("quant_win_rate").default(0),
  
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertConfidenceCalibrationSchema = createInsertSchema(confidenceCalibration).omit({ id: true, createdAt: true, lastUpdated: true });
export type InsertConfidenceCalibration = z.infer<typeof insertConfidenceCalibrationSchema>;
export type ConfidenceCalibration = typeof confidenceCalibration.$inferSelect;

// Historical Intelligence Summary - Aggregate stats for quick access
export const historicalIntelligenceSummary = pgTable("historical_intelligence_summary", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Overall Stats
  totalIdeasGenerated: integer("total_ideas_generated").notNull().default(0),
  totalIdeasClosed: integer("total_ideas_closed").notNull().default(0),
  overallWinRate: real("overall_win_rate").default(0),
  overallProfitFactor: real("overall_profit_factor").default(0),
  totalRealizedPnL: real("total_realized_pnl").default(0),
  
  // By Source
  aiIdeas: integer("ai_ideas").default(0),
  aiWinRate: real("ai_win_rate").default(0),
  quantIdeas: integer("quant_ideas").default(0),
  quantWinRate: real("quant_win_rate").default(0),
  flowIdeas: integer("flow_ideas").default(0),
  flowWinRate: real("flow_win_rate").default(0),
  
  // By Asset Type
  stockWinRate: real("stock_win_rate").default(0),
  optionsWinRate: real("options_win_rate").default(0),
  cryptoWinRate: real("crypto_win_rate").default(0),
  futuresWinRate: real("futures_win_rate").default(0),
  
  // By Direction
  longWinRate: real("long_win_rate").default(0),
  shortWinRate: real("short_win_rate").default(0),
  
  // Top Performers
  topSymbolsByWinRate: jsonb("top_symbols_by_win_rate").$type<{symbol: string, winRate: number, trades: number}[]>(),
  topCatalystsByWinRate: jsonb("top_catalysts_by_win_rate").$type<{catalyst: string, winRate: number, trades: number}[]>(),
  bestTimeOfDay: varchar("best_time_of_day"), // 'morning', 'midday', 'afternoon', 'overnight'
  
  // Confidence Calibration Summary
  confidenceCalibrationScore: real("confidence_calibration_score").default(0), // 0-100, 100 = perfect
  avgOverconfidence: real("avg_overconfidence").default(0), // Positive = overconfident
  
  // ML Model Performance
  mlModelVersion: varchar("ml_model_version"),
  mlModelAccuracy: real("ml_model_accuracy").default(0),
  lastMlTrainingDate: timestamp("last_ml_training_date"),
  
  // Metadata
  dataRangeStart: timestamp("data_range_start"),
  dataRangeEnd: timestamp("data_range_end"),
  lastUpdated: timestamp("last_updated").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHistoricalIntelligenceSummarySchema = createInsertSchema(historicalIntelligenceSummary).omit({ id: true, createdAt: true, lastUpdated: true });
export type InsertHistoricalIntelligenceSummary = z.infer<typeof insertHistoricalIntelligenceSummarySchema>;
export type HistoricalIntelligenceSummary = typeof historicalIntelligenceSummary.$inferSelect;

// ==========================================
// USER PERSONALIZATION SYSTEM
// ==========================================

export type LayoutDensity = 'compact' | 'comfortable' | 'spacious';
export type WidgetSize = 'small' | 'medium' | 'large' | 'full';

// User Page Layouts - Per-page widget configurations
export const userPageLayouts = pgTable("user_page_layouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  pageId: varchar("page_id").notNull(), // 'dashboard', 'automations', 'tradedesk', 'scanner', etc.
  layoutName: varchar("layout_name").default('default'),
  
  // Widget positions and sizes (JSON for flexibility)
  widgets: jsonb("widgets").$type<{
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    config?: Record<string, unknown>;
  }[]>().default([]),
  
  // Layout grid settings
  columns: integer("columns").default(12),
  rowHeight: integer("row_height").default(60),
  
  // Panel sizes for resizable panels (as percentages)
  panelSizes: jsonb("panel_sizes").$type<Record<string, number>>(),
  
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserPageLayoutSchema = createInsertSchema(userPageLayouts).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserPageLayout = z.infer<typeof insertUserPageLayoutSchema>;
export type UserPageLayout = typeof userPageLayouts.$inferSelect;

// Layout Presets - Admin-defined preset layouts users can choose from
export const layoutPresets = pgTable("layout_presets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull(), // 'dashboard', 'automations', etc.
  name: varchar("name").notNull(),
  description: text("description"),
  thumbnail: text("thumbnail"), // Preview image URL
  
  // Widget configuration (same structure as userPageLayouts)
  widgets: jsonb("widgets").$type<{
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
    config?: Record<string, unknown>;
  }[]>().default([]),
  
  columns: integer("columns").default(12),
  rowHeight: integer("row_height").default(60),
  panelSizes: jsonb("panel_sizes").$type<Record<string, number>>(),
  
  // Metadata
  isSystemPreset: boolean("is_system_preset").default(true), // Built-in vs user-created
  category: varchar("category").default('default'), // 'default', 'trading', 'analytics', 'minimal'
  sortOrder: integer("sort_order").default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertLayoutPresetSchema = createInsertSchema(layoutPresets).omit({ id: true, createdAt: true });
export type InsertLayoutPreset = z.infer<typeof insertLayoutPresetSchema>;
export type LayoutPreset = typeof layoutPresets.$inferSelect;

// ==========================================
// BULLISH TREND TRACKER
// ==========================================

export type TrendStrength = 'weak' | 'moderate' | 'strong' | 'explosive';
export type TrendPhase = 'accumulation' | 'breakout' | 'momentum' | 'distribution';
export type TrendCategory = 'growth' | 'turnaround' | 'momentum' | 'speculative' | 'sector_rotation';

// Bullish Trends - Tracked momentum stocks with technical indicators
export const bullishTrends = pgTable("bullish_trends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol").notNull(),
  name: varchar("name"),
  sector: varchar("sector"),
  category: text("category").$type<TrendCategory>().default('momentum'),
  
  // Current Price Data
  currentPrice: real("current_price"),
  previousClose: real("previous_close"),
  dayChange: real("day_change"),
  dayChangePercent: real("day_change_percent"),
  weekChangePercent: real("week_change_percent"),
  monthChangePercent: real("month_change_percent"),
  
  // Technical Indicators
  rsi14: real("rsi_14"),
  rsi2: real("rsi_2"),
  macdSignal: varchar("macd_signal"), // 'bullish_cross', 'bearish_cross', 'bullish', 'bearish'
  
  // Moving Averages
  sma20: real("sma_20"),
  sma50: real("sma_50"),
  sma200: real("sma_200"),
  priceVsSma20: real("price_vs_sma_20"), // Percent above/below
  priceVsSma50: real("price_vs_sma_50"),
  priceVsSma200: real("price_vs_sma_200"),
  
  // Volume Analysis
  currentVolume: real("current_volume"),
  avgVolume: real("avg_volume"),
  volumeRatio: real("volume_ratio"), // Current vs Avg
  
  // Momentum Metrics
  trendStrength: text("trend_strength").$type<TrendStrength>().default('moderate'),
  trendPhase: text("trend_phase").$type<TrendPhase>().default('momentum'),
  momentumScore: integer("momentum_score"), // 0-100 composite score
  
  // Key Levels
  week52High: real("week_52_high"),
  week52Low: real("week_52_low"),
  percentFrom52High: real("percent_from_52_high"),
  percentFrom52Low: real("percent_from_52_low"),
  resistanceLevel: real("resistance_level"),
  supportLevel: real("support_level"),
  
  // Classification
  isBreakout: boolean("is_breakout").default(false), // Breaking out of resistance
  isHighVolume: boolean("is_high_volume").default(false), // Volume > 2x average
  isAboveMAs: boolean("is_above_mas").default(false), // Above all major MAs
  isNewHigh: boolean("is_new_high").default(false), // Near 52-week high
  
  // User Management
  addedManually: boolean("added_manually").default(false),
  addedBy: varchar("added_by"), // User ID if manually added
  notes: text("notes"),
  
  // Alerts
  alertSent: boolean("alert_sent").default(false),
  lastAlertDate: timestamp("last_alert_date"),
  
  // Status
  isActive: boolean("is_active").default(true),
  discoveredAt: timestamp("discovered_at").defaultNow(),
  lastScannedAt: timestamp("last_scanned_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBullishTrendSchema = createInsertSchema(bullishTrends).omit({ id: true, createdAt: true, updatedAt: true, discoveredAt: true });
export type InsertBullishTrend = z.infer<typeof insertBullishTrendSchema>;
export type BullishTrend = typeof bullishTrends.$inferSelect;

// ==========================================
// SYMBOL ATTENTION TRACKER
// Tracks how many times each symbol is flagged across all scanners
// Convergence of multiple systems = strong signal
// ==========================================

export type AttentionSource = 
  | 'pre_market_surge'
  | 'bullish_trend'
  | 'market_scanner'
  | 'trade_idea'
  | 'watchlist_grade'
  | 'best_setup'
  | 'mover_discovery'
  | 'catalyst_alert'
  | 'ml_signal'
  | 'manual';

export type AttentionEventType = 'alert' | 'scan' | 'grade' | 'idea' | 'discovery';

// Attention Events - Raw touch events from all systems
export const attentionEvents = pgTable("attention_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol").notNull(),
  source: text("source").$type<AttentionSource>().notNull(),
  eventType: text("event_type").$type<AttentionEventType>().notNull(),
  
  // Event Details
  eventData: jsonb("event_data").$type<{
    price?: number;
    changePercent?: number;
    direction?: 'bullish' | 'bearish';
    confidence?: number;
    grade?: string;
    message?: string;
  }>(),
  
  // Score contribution (varies by source importance)
  scoreWeight: real("score_weight").default(1.0),
  
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
}, (table) => [
  index("idx_attention_symbol").on(table.symbol),
  index("idx_attention_occurred").on(table.occurredAt),
  index("idx_attention_source").on(table.source),
]);

export const insertAttentionEventSchema = createInsertSchema(attentionEvents).omit({ id: true, occurredAt: true });
export type InsertAttentionEvent = z.infer<typeof insertAttentionEventSchema>;
export type AttentionEvent = typeof attentionEvents.$inferSelect;

// Symbol Heat Scores - Aggregated attention metrics (updated periodically)
export const symbolHeatScores = pgTable("symbol_heat_scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol").notNull().unique(),
  
  // Heat Metrics
  heatScore: real("heat_score").default(0), // Decay-weighted score
  rawTouchCount: integer("raw_touch_count").default(0), // Total touches in window
  distinctSources: integer("distinct_sources").default(0), // Unique systems that flagged it
  recentTouches1h: integer("recent_touches_1h").default(0), // Touches in last hour
  recentTouches24h: integer("recent_touches_24h").default(0), // Touches in last 24h
  
  // Source Breakdown
  sourceBreakdown: jsonb("source_breakdown").$type<Record<AttentionSource, number>>(),
  
  // Latest Event
  lastSource: text("last_source").$type<AttentionSource>(),
  lastEventType: text("last_event_type").$type<AttentionEventType>(),
  lastPrice: real("last_price"),
  lastDirection: varchar("last_direction"), // 'bullish' or 'bearish'
  
  // Convergence Detection
  isConverging: boolean("is_converging").default(false), // 3+ distinct sources in 30min
  convergenceLevel: integer("convergence_level").default(0), // 0-5 scale
  
  // Timing
  firstTouchAt: timestamp("first_touch_at"),
  lastTouchAt: timestamp("last_touch_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_heat_symbol").on(table.symbol),
  index("idx_heat_score").on(table.heatScore),
]);

export const insertSymbolHeatScoreSchema = createInsertSchema(symbolHeatScores).omit({ id: true, updatedAt: true });
export type InsertSymbolHeatScore = z.infer<typeof insertSymbolHeatScoreSchema>;
export type SymbolHeatScore = typeof symbolHeatScores.$inferSelect;

// ==========================================
// PATTERN SIGNALS - Breakout & Chart Pattern Tracking
// ==========================================

export type PatternType = 
  | 'bull_flag'
  | 'bear_flag'
  | 'ascending_triangle'
  | 'descending_triangle'
  | 'symmetrical_triangle'
  | 'cup_and_handle'
  | 'inverse_head_shoulders'
  | 'double_bottom'
  | 'falling_wedge'
  | 'channel_breakout'
  | 'vcp' // Volatility Contraction Pattern
  | 'parabolic_move'
  | 'base_breakout'
  | 'momentum_surge';

export type PatternStatus = 'forming' | 'confirmed' | 'failed' | 'completed';
export type PatternTimeframe = 'intraday' | 'daily' | 'weekly';

export const patternSignals = pgTable("pattern_signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol").notNull(),
  patternType: text("pattern_type").$type<PatternType>().notNull(),
  patternStatus: text("pattern_status").$type<PatternStatus>().notNull().default('forming'),
  timeframe: text("timeframe").$type<PatternTimeframe>().notNull().default('daily'),
  
  // Pattern Detection Details
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
  detectionPrice: real("detection_price").notNull(),
  currentPrice: real("current_price"),
  
  // Key Price Levels
  resistanceLevel: real("resistance_level"),
  supportLevel: real("support_level"),
  breakoutLevel: real("breakout_level"),
  targetPrice: real("target_price"),
  stopLoss: real("stop_loss"),
  
  // Pattern Metrics
  patternScore: integer("pattern_score").notNull().default(50), // 0-100
  volumeConfirmation: boolean("volume_confirmation").default(false),
  priceConfirmation: boolean("price_confirmation").default(false),
  
  // Pattern Geometry
  patternHeight: real("pattern_height"), // Pattern range in dollars
  patternDuration: integer("pattern_duration"), // Days the pattern has been forming
  consolidationTightness: real("consolidation_tightness"), // For VCP/flags - how tight the range is
  
  // Confluence Signals
  rsiValue: real("rsi_value"),
  macdSignal: varchar("macd_signal"), // 'bullish', 'bearish', 'neutral'
  volumeRatio: real("volume_ratio"),
  priceVsSma20: real("price_vs_sma_20"),
  priceVsSma50: real("price_vs_sma_50"),
  
  // Risk/Reward
  riskRewardRatio: real("risk_reward_ratio"),
  distanceToBreakout: real("distance_to_breakout"), // Percent to breakout level
  
  // Time-to-Breakout Estimate
  estimatedBreakoutDate: timestamp("estimated_breakout_date"),
  urgency: varchar("urgency"), // 'imminent' (< 1 day), 'soon' (1-3 days), 'developing' (3+ days)
  
  // Trade Idea Link
  tradeIdeaId: varchar("trade_idea_id"), // Link to generated trade idea if any
  
  // Metadata
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_pattern_symbol").on(table.symbol),
  index("idx_pattern_type").on(table.patternType),
  index("idx_pattern_status").on(table.patternStatus),
  index("idx_pattern_score").on(table.patternScore),
  index("idx_pattern_active").on(table.isActive),
]);

export const insertPatternSignalSchema = createInsertSchema(patternSignals).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true, 
  detectedAt: true 
});
export type InsertPatternSignal = z.infer<typeof insertPatternSignalSchema>;
export type PatternSignal = typeof patternSignals.$inferSelect;

// ==========================================
// 🧠 ML TRAINING DATA LAKE - Self-Improving Models
// ==========================================

// ML Training Sample - Individual prediction with outcome for training
export const mlTrainingSamples = pgTable("ml_training_samples", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Link to source
  tradeIdeaId: varchar("trade_idea_id"),
  symbol: varchar("symbol").notNull(),
  assetType: text("asset_type").$type<AssetType>(),
  
  // Prediction at time of generation
  predictedDirection: text("predicted_direction").notNull(), // 'bullish' | 'bearish' | 'neutral'
  predictedConfidence: real("predicted_confidence").notNull(), // 0-100
  predictionEngine: text("prediction_engine").notNull(), // 'ml' | 'ai' | 'quant' | 'flow' | 'sentiment' | 'technical'
  modelVersion: text("model_version"),
  
  // Feature vector at prediction time
  features: jsonb("features").$type<{
    rsi: number;
    macd: number;
    momentum: number;
    volatility: number;
    volumeRatio: number;
    priceChange24h: number;
    trendStrength: number;
    vwapDistance?: number;
    ivPercentile?: number;
    putCallRatio?: number;
    marketRegime?: string;
  }>(),
  
  // Signal weights used
  signalWeights: jsonb("signal_weights").$type<Record<string, number>>(),
  
  // Price context at prediction
  priceAtPrediction: real("price_at_prediction").notNull(),
  targetPrice: real("target_price"),
  stopLoss: real("stop_loss"),
  
  // Market context
  marketRegime: text("market_regime"), // 'trending_bull' | 'trending_bear' | 'ranging' | 'high_volatility'
  sectorPerformance: real("sector_performance"),
  
  // ACTUAL OUTCOME (filled after trade closes)
  outcomeStatus: text("outcome_status").$type<'pending' | 'win' | 'loss' | 'breakeven' | 'expired'>().default('pending'),
  actualDirection: text("actual_direction"), // What actually happened
  actualPriceChange: real("actual_price_change"), // Percentage
  exitPrice: real("exit_price"),
  realizedPnL: real("realized_pnl"),
  daysToOutcome: integer("days_to_outcome"),
  
  // Outcome resolution
  closedAt: timestamp("closed_at"),
  closureReason: text("closure_reason"), // 'target_hit' | 'stop_hit' | 'time_exit' | 'manual'
  
  // Learning flags
  isUsableForTraining: boolean("is_usable_for_training").default(false), // Only true after outcome resolved
  errorCategory: text("error_category"), // If prediction was wrong, why?
  
  // Timestamps
  predictedAt: timestamp("predicted_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ml_training_symbol").on(table.symbol),
  index("idx_ml_training_engine").on(table.predictionEngine),
  index("idx_ml_training_outcome").on(table.outcomeStatus),
  index("idx_ml_training_usable").on(table.isUsableForTraining),
  index("idx_ml_training_predicted_at").on(table.predictedAt),
]);

export const insertMlTrainingSampleSchema = createInsertSchema(mlTrainingSamples).omit({ 
  id: true, 
  createdAt: true,
  predictedAt: true 
});
export type InsertMlTrainingSample = z.infer<typeof insertMlTrainingSampleSchema>;
export type MlTrainingSample = typeof mlTrainingSamples.$inferSelect;

// ML Model Version Registry - Track trained models
export const mlModelRegistry = pgTable("ml_model_registry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Model identification
  modelName: text("model_name").notNull(), // 'price_direction' | 'sentiment' | 'pattern' | 'position_sizing' | 'regime'
  version: text("version").notNull(), // Semantic version e.g., "v1.2.3"
  
  // Training details
  trainedAt: timestamp("trained_at").defaultNow().notNull(),
  trainingDataStart: timestamp("training_data_start"),
  trainingDataEnd: timestamp("training_data_end"),
  samplesUsed: integer("samples_used").default(0),
  
  // Model configuration
  hyperparameters: jsonb("hyperparameters").$type<Record<string, number | string>>(),
  featureSet: jsonb("feature_set").$type<string[]>(),
  signalWeights: jsonb("signal_weights").$type<Record<string, number>>(), // Learned weights
  
  // Performance metrics from validation
  backtestAccuracy: real("backtest_accuracy"), // 0-100%
  backtestPrecision: real("backtest_precision"),
  backtestRecall: real("backtest_recall"),
  backtestF1: real("backtest_f1"),
  backtestSharpe: real("backtest_sharpe"),
  backtestMaxDrawdown: real("backtest_max_drawdown"),
  
  // Live performance (updated as trades close)
  liveAccuracy: real("live_accuracy"),
  livePredictions: integer("live_predictions").default(0),
  liveWins: integer("live_wins").default(0),
  liveLosses: integer("live_losses").default(0),
  liveWinRate: real("live_win_rate"),
  liveProfitFactor: real("live_profit_factor"),
  
  // Status
  status: text("status").$type<'training' | 'validating' | 'active' | 'champion' | 'deprecated' | 'failed'>().default('training'),
  isChampion: boolean("is_champion").default(false), // Currently deployed production model
  deployedAt: timestamp("deployed_at"),
  deprecatedAt: timestamp("deprecated_at"),
  deprecationReason: text("deprecation_reason"),
  
  // Notes
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ml_registry_name").on(table.modelName),
  index("idx_ml_registry_status").on(table.status),
  index("idx_ml_registry_champion").on(table.isChampion),
]);

export const insertMlModelRegistrySchema = createInsertSchema(mlModelRegistry).omit({ 
  id: true, 
  createdAt: true,
  trainedAt: true 
});
export type InsertMlModelRegistry = z.infer<typeof insertMlModelRegistrySchema>;
export type MlModelRegistry = typeof mlModelRegistry.$inferSelect;

// ML Retraining Jobs - Track retraining runs
export const mlRetrainingJobs = pgTable("ml_retraining_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Job identification
  modelName: text("model_name").notNull(),
  jobType: text("job_type").$type<'scheduled' | 'manual' | 'performance_triggered'>().default('scheduled'),
  
  // Job status
  status: text("status").$type<'queued' | 'running' | 'completed' | 'failed' | 'cancelled'>().default('queued'),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  
  // Training data scope
  samplesAvailable: integer("samples_available").default(0),
  samplesUsed: integer("samples_used").default(0),
  dataRangeStart: timestamp("data_range_start"),
  dataRangeEnd: timestamp("data_range_end"),
  
  // Results
  previousModelVersion: text("previous_model_version"),
  newModelVersion: text("new_model_version"),
  accuracyImprovement: real("accuracy_improvement"), // Percentage points improvement
  performanceGate: boolean("performance_gate"), // Did it pass the gate?
  gateReason: text("gate_reason"),
  
  // Deployment decision
  autoDeployed: boolean("auto_deployed").default(false),
  deploymentNotes: text("deployment_notes"),
  
  // Error handling
  errorMessage: text("error_message"),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_ml_jobs_model").on(table.modelName),
  index("idx_ml_jobs_status").on(table.status),
]);

export const insertMlRetrainingJobSchema = createInsertSchema(mlRetrainingJobs).omit({ 
  id: true, 
  createdAt: true 
});
export type InsertMlRetrainingJob = z.infer<typeof insertMlRetrainingJobSchema>;
export type MlRetrainingJob = typeof mlRetrainingJobs.$inferSelect;

// Dynamic Signal Weights - Automatically adjusted based on performance
export const dynamicSignalWeights = pgTable("dynamic_signal_weights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  
  // Signal identification
  signalName: text("signal_name").notNull().unique(), // 'rsi' | 'macd' | 'volume' | 'vwap' | etc.
  
  // Current weight
  currentWeight: real("current_weight").notNull().default(1.0), // Multiplier 0-2
  baseWeight: real("base_weight").notNull().default(1.0), // Original weight
  
  // Performance tracking
  correctPredictions: integer("correct_predictions").default(0),
  incorrectPredictions: integer("incorrect_predictions").default(0),
  accuracy: real("accuracy").default(50), // 0-100%
  
  // Weight adjustment history
  lastAdjusted: timestamp("last_adjusted"),
  adjustmentHistory: jsonb("adjustment_history").$type<Array<{
    timestamp: string;
    oldWeight: number;
    newWeight: number;
    reason: string;
  }>>(),
  
  // Constraints
  minWeight: real("min_weight").default(0.2),
  maxWeight: real("max_weight").default(2.0),
  
  // Context-specific adjustments
  regimeAdjustments: jsonb("regime_adjustments").$type<Record<string, number>>(), // Different weights for different regimes
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_signal_weights_name").on(table.signalName),
]);

export const insertDynamicSignalWeightSchema = createInsertSchema(dynamicSignalWeights).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});
export type InsertDynamicSignalWeight = z.infer<typeof insertDynamicSignalWeightSchema>;
export type DynamicSignalWeight = typeof dynamicSignalWeights.$inferSelect;

// ============================================
// WHALE FLOWS - Institutional options tracking
// Tracks high-premium options activity ($10k+) for lotto plays
// ============================================
export const whaleFlows = pgTable("whale_flows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  // Symbol & option details
  symbol: varchar("symbol", { length: 20 }).notNull(),
  optionType: text("option_type").$type<'call' | 'put'>().notNull(),
  strikePrice: real("strike_price").notNull(),
  expiryDate: varchar("expiry_date").notNull(), // ISO date string

  // Pricing & flow details
  entryPrice: real("entry_price").notNull(),
  targetPrice: real("target_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  premiumPerContract: real("premium_per_contract").notNull(), // Total premium for this contract

  // Whale classification
  isMegaWhale: boolean("is_mega_whale").default(false), // $50k+ vs $10k+
  flowSize: varchar("flow_size"), // 'whale' | 'mega_whale'

  // Analysis
  grade: varchar("grade", { length: 10 }), // A+, A, B, etc.
  confidenceScore: integer("confidence_score"),
  direction: text("direction").$type<'long' | 'short'>().notNull(),

  // Tracking
  detectedAt: timestamp("detected_at").defaultNow(),
  outcomeStatus: text("outcome_status").$type<OutcomeStatus>().default('open'),
  finalPnL: real("final_pnl"), // If we tracked outcome

  // Discord notification
  discordNotified: boolean("discord_notified").default(false),

  // Link to trade idea if created
  tradeIdeaId: varchar("trade_idea_id"),
}, (table) => [
  index("idx_whale_flows_symbol").on(table.symbol),
  index("idx_whale_flows_detected_at").on(table.detectedAt),
  index("idx_whale_flows_is_mega").on(table.isMegaWhale),
  index("idx_whale_flows_status").on(table.outcomeStatus),
]);

export const insertWhaleFlowSchema = createInsertSchema(whaleFlows).omit({
  id: true,
  detectedAt: true
});
export type InsertWhaleFlow = z.infer<typeof insertWhaleFlowSchema>;

// ============================================
// ANALYSIS AUDIT LOG - Universal Engine audit trail
// Logs every analysis for reproducibility and verification
// ============================================
export const analysisAuditLog = pgTable("analysis_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),

  // Audit identification
  auditId: varchar("audit_id", { length: 100 }).notNull().unique(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timestamp: timestamp("timestamp").defaultNow(),

  // Engine metadata
  engineVersion: varchar("engine_version").default('UniversalEngine_v1.0'),

  // Input parameters
  params: jsonb("params"), // AnalysisParams object

  // Analysis result
  result: jsonb("result"), // UnifiedAnalysisResponse object

  // Performance tracking
  duration: integer("duration"), // milliseconds

  // Consumer tracking
  consumedBy: varchar("consumed_by"), // Which page/component used this analysis

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_analysis_audit_symbol").on(table.symbol),
  index("idx_analysis_audit_timestamp").on(table.timestamp),
  index("idx_analysis_audit_consumer").on(table.consumedBy),
]);

export const insertAnalysisAuditSchema = createInsertSchema(analysisAuditLog).omit({
  id: true,
  createdAt: true
});
export type InsertAnalysisAudit = z.infer<typeof insertAnalysisAuditSchema>;
export type WhaleFlow = typeof whaleFlows.$inferSelect;

// ============================================
// IV SNAPSHOTS — Daily ATM IV storage for real IV Rank
// ============================================
export const ivSnapshots = pgTable("iv_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),         // YYYY-MM-DD
  atmIv: doublePrecision("atm_iv").notNull(),               // ATM IV as percentage
  rv20: doublePrecision("rv20"),                             // 20-day realized volatility
  rv10: doublePrecision("rv10"),                             // 10-day realized volatility
  spotPrice: doublePrecision("spot_price"),                  // SPY price at snapshot
  pcr: doublePrecision("pcr"),                               // Put/call ratio at close
  vix: doublePrecision("vix"),                               // VIX level at close
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_iv_snapshots_symbol_date").on(table.symbol, table.date),
]);

export const insertIvSnapshotSchema = createInsertSchema(ivSnapshots).omit({
  id: true,
  createdAt: true,
});
export type InsertIvSnapshot = z.infer<typeof insertIvSnapshotSchema>;
export type IvSnapshot = typeof ivSnapshots.$inferSelect;

// ==========================================
// TRADE JOURNAL — Personal trade imports from brokers
// ==========================================

export type JournalBroker = 'webull' | 'robinhood' | 'schwab' | 'tda' | 'ibkr' | 'etrade' | 'fidelity' | 'tastytrade' | 'manual' | 'csv';

export const journalTrades = pgTable("journal_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),

  // ── Trade identity ──
  symbol: text("symbol").notNull(),
  assetType: text("asset_type").notNull().$type<'stock' | 'option' | 'future' | 'crypto'>(),
  direction: text("direction").notNull().$type<'long' | 'short'>(),

  // ── Option fields ──
  optionType: text("option_type").$type<'call' | 'put'>(),
  strikePrice: real("strike_price"),
  expiryDate: text("expiry_date"),

  // ── Position sizing ──
  quantity: doublePrecision("quantity").notNull().default(1),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  fees: real("fees").default(0),

  // ── Timing ──
  entryTime: text("entry_time").notNull(),
  exitTime: text("exit_time"),
  holdingMinutes: integer("holding_minutes"),

  // ── P&L ──
  realizedPnL: real("realized_pnl"),
  realizedPnLPercent: real("realized_pnl_percent"),
  grossPnL: real("gross_pnl"),

  // ── Outcome ──
  status: text("status").$type<'open' | 'closed' | 'partial'>().notNull().default('closed'),
  outcome: text("outcome").$type<'win' | 'loss' | 'breakeven' | 'open'>().default('open'),

  // ── Journal / self-reflection ──
  notes: text("notes"),
  emotion: text("emotion").$type<'confident' | 'fearful' | 'greedy' | 'fomo' | 'revenge' | 'disciplined' | 'neutral'>(),
  setupType: text("setup_type"),      // user-defined tag (e.g. "GEX flip", "breakout", "earnings")
  mistakeTag: text("mistake_tag"),    // "chased", "oversized", "no stop", "held too long", etc.
  rating: integer("rating"),          // 1-5 self-grade on execution quality
  screenshot: text("screenshot"),     // URL to chart screenshot

  // ── Import metadata ──
  broker: text("broker").$type<JournalBroker>().notNull().default('manual'),
  brokerOrderId: text("broker_order_id"),     // original order ID from broker
  importBatchId: text("import_batch_id"),     // groups trades from same CSV upload
  rawCsvRow: jsonb("raw_csv_row"),            // original row for debugging

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_journal_trades_user").on(table.userId),
  index("idx_journal_trades_user_symbol").on(table.userId, table.symbol),
  index("idx_journal_trades_user_time").on(table.userId, table.entryTime),
  index("idx_journal_trades_import").on(table.importBatchId),
]);

export const insertJournalTradeSchema = createInsertSchema(journalTrades).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJournalTrade = z.infer<typeof insertJournalTradeSchema>;
export type JournalTrade = typeof journalTrades.$inferSelect;

// ═══════════════════════════════════════════════════════════
// GEX SNAPSHOT HISTORY — Historical gamma exposure archive
// ═══════════════════════════════════════════════════════════
// Saves hourly GEX snapshots during market hours so users can
// browse "what did TSLA's GEX look like on March 10?" — the
// feature that was completely missing from the platform.

export const gexSnapshots = pgTable("gex_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull(),

  // Core GEX levels
  spotPrice: doublePrecision("spot_price").notNull(),
  flipPoint: doublePrecision("flip_point"),
  callWall: doublePrecision("call_wall"),
  putWall: doublePrecision("put_wall"),
  flipDistancePct: doublePrecision("flip_distance_pct"),

  // Regime
  regime: varchar("regime", { length: 30 }),  // positive_gamma | negative_gamma | neutral | transitioning
  vexRegime: varchar("vex_regime", { length: 30 }), // vol_tailwind | vol_headwind | vol_neutral
  netGexSign: varchar("net_gex_sign", { length: 10 }), // positive | negative | neutral

  // Extended data
  totalGex: doublePrecision("total_gex"),  // raw net gamma number
  maxGammaStrike: doublePrecision("max_gamma_strike"),
  topLevels: jsonb("top_levels"),  // top 15 levels by |gex| — [{strike, gex, gammaPct, role}]
  heatmapData: jsonb("heatmap_data"), // condensed heatmap [{strike, intensity, gex, side}]
  strikeExpiryMatrix: jsonb("strike_expiry_matrix"), // DTE × strike matrix for full replay

  // Metadata
  snapshotAt: timestamp("snapshot_at").notNull(), // when the GEX was computed
  marketSession: varchar("market_session", { length: 20 }), // 'premarket' | 'regular' | 'afterhours' | 'closed'
  dataGrade: varchar("data_grade", { length: 5 }), // A-F quality grade

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_gex_snapshots_symbol_time").on(table.symbol, table.snapshotAt),
  index("idx_gex_snapshots_symbol").on(table.symbol),
  index("idx_gex_snapshots_time").on(table.snapshotAt),
]);

export const insertGexSnapshotSchema = createInsertSchema(gexSnapshots).omit({ id: true, createdAt: true });
export type InsertGexSnapshot = z.infer<typeof insertGexSnapshotSchema>;
export type GexSnapshotRecord = typeof gexSnapshots.$inferSelect;
