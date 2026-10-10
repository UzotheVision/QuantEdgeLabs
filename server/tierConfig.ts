import { SubscriptionTier } from "@shared/schema";

export interface TierLimits {
  // Usage Limits
  ideasPerDay: number;
  aiChatMessagesPerDay: number;
  chartAnalysisPerDay: number;
  watchlistItems: number;
  aiCreditsPerMonth: number; // Monthly AI chat credits
  
  // Core Engine Access
  canAccessAIEngine: boolean;
  canAccessQuantEngine: boolean;
  canAccessHybridEngine: boolean;
  
  // Scanner Access
  canAccessFlowScanner: boolean;
  canAccessLottoScanner: boolean;
  canAccessPennyScanner: boolean;
  
  // Bot Access
  canAccessAutoLottoBot: boolean;
  canAccessCryptoBot: boolean;
  canAccessFuturesBot: boolean;
  canAccessPropFirmBot: boolean;
  
  // Asset Classes
  canTradeStocks: boolean;
  canTradeCrypto: boolean;
  canTradeOptions: boolean;
  canTradeFutures: boolean;
  
  // Analytics & Performance
  canAccessPerformance: boolean;
  canAccessAdvancedAnalytics: boolean;
  canAccessSymbolLeaderboard: boolean;
  canAccessTimeHeatmap: boolean;
  canAccessEngineTrends: boolean;
  canAccessSignalAnalysis: boolean;
  canAccessDrawdownAnalysis: boolean;
  canAccessLossAnalysis: boolean;
  
  // Chart & Technical Analysis
  canAccessPatternRecognition: boolean;
  canAccessSupportResistance: boolean;
  canAccessMultiFactorAnalysis: boolean;
  
  // Catalyst Intelligence
  canAccessSECFilings: boolean;
  canAccessGovContracts: boolean;
  canAccessCatalystScoring: boolean;
  
  // Data & Exports
  canAccessRealTimeData: boolean;
  canAccessRealTimeAlerts: boolean;
  canExportData: boolean;
  canExportPDF: boolean;
  
  // Premium Features
  canAccessTradingJournal: boolean;
  canAccessDiscordAlerts: boolean;
  canAccessWeeklyPicks: boolean;
  canAccessDailyReports: boolean;
  canAccessAPIAccess: boolean;
  canAccessWebhooks: boolean;
  canAccessBacktesting: boolean;
  
  // Support
  prioritySupport: boolean;
  priorityIdeaGeneration: boolean;
}

export const TIER_CONFIG: Record<SubscriptionTier, TierLimits> = {
  free: {
    // Usage Limits
    ideasPerDay: 5,
    aiChatMessagesPerDay: 3,
    chartAnalysisPerDay: 1,
    watchlistItems: 3,
    aiCreditsPerMonth: 30, // Free tier: ~1 chat/day
    
    // Core Engine Access
    canAccessAIEngine: true,
    canAccessQuantEngine: true,
    canAccessHybridEngine: false,
    
    // Scanner Access
    canAccessFlowScanner: false,
    canAccessLottoScanner: false,
    canAccessPennyScanner: false,
    
    // Bot Access
    canAccessAutoLottoBot: false,
    canAccessCryptoBot: false,
    canAccessFuturesBot: false,
    canAccessPropFirmBot: false,
    
    // Asset Classes
    canTradeStocks: true,
    canTradeCrypto: true,
    canTradeOptions: false,
    canTradeFutures: false,
    
    // Analytics & Performance
    canAccessPerformance: false,
    canAccessAdvancedAnalytics: false,
    canAccessSymbolLeaderboard: false,
    canAccessTimeHeatmap: false,
    canAccessEngineTrends: false,
    canAccessSignalAnalysis: false,
    canAccessDrawdownAnalysis: false,
    canAccessLossAnalysis: false,
    
    // Chart & Technical Analysis
    canAccessPatternRecognition: true,
    canAccessSupportResistance: false,
    canAccessMultiFactorAnalysis: false,
    
    // Catalyst Intelligence
    canAccessSECFilings: false,
    canAccessGovContracts: false,
    canAccessCatalystScoring: false,
    
    // Data & Exports
    canAccessRealTimeData: false,
    canAccessRealTimeAlerts: false,
    canExportData: false,
    canExportPDF: false,
    
    // Premium Features
    canAccessTradingJournal: true,
    canAccessDiscordAlerts: false,
    canAccessWeeklyPicks: false,
    canAccessDailyReports: false,
    canAccessAPIAccess: false,
    canAccessWebhooks: false,
    canAccessBacktesting: false,
    
    // Support
    prioritySupport: false,
    priorityIdeaGeneration: false,
  },
  
  advanced: {
    // Usage Limits
    ideasPerDay: Infinity,
    aiChatMessagesPerDay: Infinity,
    chartAnalysisPerDay: Infinity,
    watchlistItems: Infinity,
    aiCreditsPerMonth: 600, // Advanced: ~20 chats/day
    
    // Core Engine Access
    canAccessAIEngine: true,
    canAccessQuantEngine: true,
    canAccessHybridEngine: true,
    
    // Scanner Access
    canAccessFlowScanner: true,
    canAccessLottoScanner: true,
    canAccessPennyScanner: true,
    
    // Bot Access
    canAccessAutoLottoBot: true,
    canAccessCryptoBot: true,
    canAccessFuturesBot: false,
    canAccessPropFirmBot: false,
    
    // Asset Classes
    canTradeStocks: true,
    canTradeCrypto: true,
    canTradeOptions: true,
    canTradeFutures: false,
    
    // Analytics & Performance
    canAccessPerformance: true,
    canAccessAdvancedAnalytics: true,
    canAccessSymbolLeaderboard: true,
    canAccessTimeHeatmap: true,
    canAccessEngineTrends: true,
    canAccessSignalAnalysis: true,
    canAccessDrawdownAnalysis: true,
    canAccessLossAnalysis: true,
    
    // Chart & Technical Analysis
    canAccessPatternRecognition: true,
    canAccessSupportResistance: true,
    canAccessMultiFactorAnalysis: true,
    
    // Catalyst Intelligence
    canAccessSECFilings: true,
    canAccessGovContracts: true,
    canAccessCatalystScoring: true,
    
    // Data & Exports
    canAccessRealTimeData: true,
    canAccessRealTimeAlerts: true,
    canExportData: true,
    canExportPDF: true,
    
    // Premium Features
    canAccessTradingJournal: true,
    canAccessDiscordAlerts: true,
    canAccessWeeklyPicks: true,
    canAccessDailyReports: true,
    canAccessAPIAccess: false,
    canAccessWebhooks: false,
    canAccessBacktesting: false,
    
    // Support
    prioritySupport: true,
    priorityIdeaGeneration: false,
  },
  
  pro: {
    // Usage Limits
    ideasPerDay: Infinity,
    aiChatMessagesPerDay: Infinity,
    chartAnalysisPerDay: Infinity,
    watchlistItems: Infinity,
    aiCreditsPerMonth: 1500, // Pro: ~50 chats/day
    
    // Core Engine Access
    canAccessAIEngine: true,
    canAccessQuantEngine: true,
    canAccessHybridEngine: true,
    
    // Scanner Access
    canAccessFlowScanner: true,
    canAccessLottoScanner: true,
    canAccessPennyScanner: true,
    
    // Bot Access
    canAccessAutoLottoBot: true,
    canAccessCryptoBot: true,
    canAccessFuturesBot: true,
    canAccessPropFirmBot: true,
    
    // Asset Classes
    canTradeStocks: true,
    canTradeCrypto: true,
    canTradeOptions: true,
    canTradeFutures: true,
    
    // Analytics & Performance
    canAccessPerformance: true,
    canAccessAdvancedAnalytics: true,
    canAccessSymbolLeaderboard: true,
    canAccessTimeHeatmap: true,
    canAccessEngineTrends: true,
    canAccessSignalAnalysis: true,
    canAccessDrawdownAnalysis: true,
    canAccessLossAnalysis: true,
    
    // Chart & Technical Analysis
    canAccessPatternRecognition: true,
    canAccessSupportResistance: true,
    canAccessMultiFactorAnalysis: true,
    
    // Catalyst Intelligence
    canAccessSECFilings: true,
    canAccessGovContracts: true,
    canAccessCatalystScoring: true,
    
    // Data & Exports
    canAccessRealTimeData: true,
    canAccessRealTimeAlerts: true,
    canExportData: true,
    canExportPDF: true,
    
    // Premium Features
    canAccessTradingJournal: true,
    canAccessDiscordAlerts: true,
    canAccessWeeklyPicks: true,
    canAccessDailyReports: true,
    canAccessAPIAccess: true,
    canAccessWebhooks: true,
    canAccessBacktesting: true,
    
    // Support
    prioritySupport: true,
    priorityIdeaGeneration: true,
  },
  
  admin: {
    // Usage Limits
    ideasPerDay: Infinity,
    aiChatMessagesPerDay: Infinity,
    chartAnalysisPerDay: Infinity,
    watchlistItems: Infinity,
    aiCreditsPerMonth: 999999, // Unlimited for admins
    
    // Core Engine Access
    canAccessAIEngine: true,
    canAccessQuantEngine: true,
    canAccessHybridEngine: true,
    
    // Scanner Access
    canAccessFlowScanner: true,
    canAccessLottoScanner: true,
    canAccessPennyScanner: true,
    
    // Bot Access
    canAccessAutoLottoBot: true,
    canAccessCryptoBot: true,
    canAccessFuturesBot: true,
    canAccessPropFirmBot: true,
    
    // Asset Classes
    canTradeStocks: true,
    canTradeCrypto: true,
    canTradeOptions: true,
    canTradeFutures: true,
    
    // Analytics & Performance
    canAccessPerformance: true,
    canAccessAdvancedAnalytics: true,
    canAccessSymbolLeaderboard: true,
    canAccessTimeHeatmap: true,
    canAccessEngineTrends: true,
    canAccessSignalAnalysis: true,
    canAccessDrawdownAnalysis: true,
    canAccessLossAnalysis: true,
    
    // Chart & Technical Analysis
    canAccessPatternRecognition: true,
    canAccessSupportResistance: true,
    canAccessMultiFactorAnalysis: true,
    
    // Catalyst Intelligence
    canAccessSECFilings: true,
    canAccessGovContracts: true,
    canAccessCatalystScoring: true,
    
    // Data & Exports
    canAccessRealTimeData: true,
    canAccessRealTimeAlerts: true,
    canExportData: true,
    canExportPDF: true,
    
    // Premium Features
    canAccessTradingJournal: true,
    canAccessDiscordAlerts: true,
    canAccessWeeklyPicks: true,
    canAccessDailyReports: true,
    canAccessAPIAccess: true,
    canAccessWebhooks: true,
    canAccessBacktesting: true,
    
    // Support
    prioritySupport: true,
    priorityIdeaGeneration: true,
  },
};

export const PRICING = {
  free: { monthly: 0, yearly: 0 },
  advanced: { monthly: 39, yearly: 349 },
  pro: { monthly: 79, yearly: 699 },
} as const;

// Feature descriptions for pricing page display
export const TIER_FEATURES = {
  free: {
    name: "Free",
    description: "Get started with basic research tools",
    highlights: [
      "5 research briefs per day",
      "3 AI chat messages per day",
      "1 chart analysis per day",
      "3 watchlist items",
      "Stocks & crypto access",
      "Basic pattern recognition",
      "Trading journal",
      "7-day performance history",
    ],
  },
  advanced: {
    name: "Advanced",
    description: "Full access to scanners and analytics",
    highlights: [
      "Unlimited research briefs",
      "Unlimited AI chat",
      "Unlimited chart analysis",
      "Unlimited watchlist",
      "All scanners (Flow, Lotto, Penny)",
      "Options trading signals",
      "Auto-Lotto & Crypto bots",
      "Full performance analytics",
      "Symbol leaderboard & heatmaps",
      "Catalyst intelligence (SEC, Gov contracts)",
      "Real-time data & alerts",
      "Discord notifications",
      "Weekly premium picks",
      "PDF exports",
      "Priority support",
    ],
  },
  pro: {
    name: "Pro",
    description: "Complete institutional-grade toolkit",
    highlights: [
      "Everything in Advanced",
      "Futures trading (NQ, ES, GC)",
      "Futures Bot & Prop Firm Bot",
      "REST API access",
      "Custom webhooks",
      "Pattern Scanner modules",
      "Priority idea generation",
      "White-label reports",
    ],
  },
};

export const PRICING_PLANS = [
  {
    id: "free",
    name: TIER_FEATURES.free.name,
    description: TIER_FEATURES.free.description,
    price: { monthly: 0, yearly: 0 },
    features: TIER_FEATURES.free.highlights,
    popular: false,
  },
  {
    id: "advanced",
    name: TIER_FEATURES.advanced.name,
    description: TIER_FEATURES.advanced.description,
    price: { monthly: 39, yearly: 349 },
    features: TIER_FEATURES.advanced.highlights,
    popular: true,
    stripePriceId: {
      monthly: process.env.STRIPE_ADVANCED_MONTHLY_PRICE_ID || "",
      yearly: process.env.STRIPE_ADVANCED_YEARLY_PRICE_ID || "",
    },
  },
  {
    id: "pro",
    name: TIER_FEATURES.pro.name,
    description: TIER_FEATURES.pro.description,
    price: { monthly: 79, yearly: 699 },
    features: TIER_FEATURES.pro.highlights,
    popular: false,
    stripePriceId: {
      monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || "",
      yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "",
    },
  },
];

export function getTierLimits(tier: SubscriptionTier): TierLimits {
  return TIER_CONFIG[tier] || TIER_CONFIG.free;
}

export function canAccessFeature(tier: SubscriptionTier, feature: keyof TierLimits): boolean {
  const limits = getTierLimits(tier);
  const value = limits[feature];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  return false;
}

export function getFeatureLimit(tier: SubscriptionTier, feature: keyof TierLimits): number {
  const limits = getTierLimits(tier);
  const value = limits[feature];
  if (typeof value === 'number') return value;
  return 0;
}
