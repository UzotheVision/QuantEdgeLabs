import { useQuery } from "@tanstack/react-query";

interface BackendTierLimits {
  ideasPerDay: number;
  aiChatMessagesPerDay: number;
  chartAnalysisPerDay: number;
  watchlistItems: number;
  canAccessAIEngine: boolean;
  canAccessQuantEngine: boolean;
  canAccessHybridEngine: boolean;
  canAccessFlowScanner: boolean;
  canAccessLottoScanner: boolean;
  canAccessPennyScanner: boolean;
  canAccessAutoLottoBot: boolean;
  canAccessCryptoBot: boolean;
  canAccessFuturesBot: boolean;
  canAccessPropFirmBot: boolean;
  canTradeStocks: boolean;
  canTradeCrypto: boolean;
  canTradeOptions: boolean;
  canTradeFutures: boolean;
  canAccessPerformance: boolean;
  canAccessAdvancedAnalytics: boolean;
  canAccessSymbolLeaderboard: boolean;
  canAccessTimeHeatmap: boolean;
  canAccessEngineTrends: boolean;
  canAccessSignalAnalysis: boolean;
  canAccessDrawdownAnalysis: boolean;
  canAccessLossAnalysis: boolean;
  canAccessPatternRecognition: boolean;
  canAccessSupportResistance: boolean;
  canAccessMultiFactorAnalysis: boolean;
  canAccessSECFilings: boolean;
  canAccessGovContracts: boolean;
  canAccessCatalystScoring: boolean;
  canAccessRealTimeData: boolean;
  canAccessRealTimeAlerts: boolean;
  canExportData: boolean;
  canExportPDF: boolean;
  canAccessTradingJournal: boolean;
  canAccessDiscordAlerts: boolean;
  canAccessWeeklyPicks: boolean;
  canAccessDailyReports: boolean;
  canAccessAPIAccess: boolean;
  canAccessWebhooks: boolean;
  canAccessBacktesting: boolean;
  prioritySupport: boolean;
  priorityIdeaGeneration: boolean;
}

interface BackendTierInfo {
  tier: 'free' | 'advanced' | 'pro';
  limits: BackendTierLimits;
  usage: {
    tradeIdeas: number;
    chartAnalysis: number;
  };
  isAdmin?: boolean;
}

export interface TierLimits {
  tradeIdeasPerDay: number;
  chartAnalysisPerDay: number;
  aiChatMessagesPerDay: number;
  watchlistItems: number;
  canAccessAIEngine: boolean;
  canAccessQuantEngine: boolean;
  canAccessHybridEngine: boolean;
  canAccessFlowScanner: boolean;
  canAccessLottoScanner: boolean;
  canAccessPennyScanner: boolean;
  canAccessAutoLottoBot: boolean;
  canAccessCryptoBot: boolean;
  canAccessFuturesBot: boolean;
  canAccessPropFirmBot: boolean;
  canTradeStocks: boolean;
  canTradeCrypto: boolean;
  canTradeOptions: boolean;
  canTradeFutures: boolean;
  canAccessPerformance: boolean;
  canAccessAdvancedAnalytics: boolean;
  canAccessSymbolLeaderboard: boolean;
  canAccessTimeHeatmap: boolean;
  canAccessEngineTrends: boolean;
  canAccessSignalAnalysis: boolean;
  canAccessDrawdownAnalysis: boolean;
  canAccessLossAnalysis: boolean;
  canAccessPatternRecognition: boolean;
  canAccessSupportResistance: boolean;
  canAccessMultiFactorAnalysis: boolean;
  canAccessSECFilings: boolean;
  canAccessGovContracts: boolean;
  canAccessCatalystScoring: boolean;
  canAccessRealTimeData: boolean;
  canAccessRealTimeAlerts: boolean;
  canExportData: boolean;
  canExportPDF: boolean;
  canAccessTradingJournal: boolean;
  canAccessDiscordAlerts: boolean;
  canAccessWeeklyPicks: boolean;
  canAccessDailyReports: boolean;
  canAccessAPIAccess: boolean;
  canAccessWebhooks: boolean;
  canAccessBacktesting: boolean;
  prioritySupport: boolean;
  priorityIdeaGeneration: boolean;
}

export interface TierInfo {
  tier: 'free' | 'advanced' | 'pro';
  limits: TierLimits;
  usage: {
    tradeIdeas: number;
    chartAnalysis: number;
  };
  isAdmin?: boolean;
}

const DEFAULT_FREE_LIMITS: TierLimits = {
  tradeIdeasPerDay: 5,
  chartAnalysisPerDay: 1,
  aiChatMessagesPerDay: 3,
  watchlistItems: 3,
  canAccessAIEngine: true,
  canAccessQuantEngine: true,
  canAccessHybridEngine: false,
  canAccessFlowScanner: false,
  canAccessLottoScanner: false,
  canAccessPennyScanner: false,
  canAccessAutoLottoBot: false,
  canAccessCryptoBot: false,
  canAccessFuturesBot: false,
  canAccessPropFirmBot: false,
  canTradeStocks: true,
  canTradeCrypto: true,
  canTradeOptions: false,
  canTradeFutures: false,
  canAccessPerformance: false,
  canAccessAdvancedAnalytics: false,
  canAccessSymbolLeaderboard: false,
  canAccessTimeHeatmap: false,
  canAccessEngineTrends: false,
  canAccessSignalAnalysis: false,
  canAccessDrawdownAnalysis: false,
  canAccessLossAnalysis: false,
  canAccessPatternRecognition: true,
  canAccessSupportResistance: false,
  canAccessMultiFactorAnalysis: false,
  canAccessSECFilings: false,
  canAccessGovContracts: false,
  canAccessCatalystScoring: false,
  canAccessRealTimeData: false,
  canAccessRealTimeAlerts: false,
  canExportData: false,
  canExportPDF: false,
  canAccessTradingJournal: true,
  canAccessDiscordAlerts: false,
  canAccessWeeklyPicks: false,
  canAccessDailyReports: false,
  canAccessAPIAccess: false,
  canAccessWebhooks: false,
  canAccessBacktesting: false,
  prioritySupport: false,
  priorityIdeaGeneration: false,
};

function transformLimits(backendLimits: BackendTierLimits): TierLimits {
  return {
    tradeIdeasPerDay: backendLimits.ideasPerDay === Infinity ? -1 : backendLimits.ideasPerDay,
    chartAnalysisPerDay: backendLimits.chartAnalysisPerDay === Infinity ? -1 : backendLimits.chartAnalysisPerDay,
    aiChatMessagesPerDay: backendLimits.aiChatMessagesPerDay === Infinity ? -1 : backendLimits.aiChatMessagesPerDay,
    watchlistItems: backendLimits.watchlistItems === Infinity ? -1 : backendLimits.watchlistItems,
    canAccessAIEngine: backendLimits.canAccessAIEngine,
    canAccessQuantEngine: backendLimits.canAccessQuantEngine,
    canAccessHybridEngine: backendLimits.canAccessHybridEngine,
    canAccessFlowScanner: backendLimits.canAccessFlowScanner,
    canAccessLottoScanner: backendLimits.canAccessLottoScanner,
    canAccessPennyScanner: backendLimits.canAccessPennyScanner,
    canAccessAutoLottoBot: backendLimits.canAccessAutoLottoBot,
    canAccessCryptoBot: backendLimits.canAccessCryptoBot,
    canAccessFuturesBot: backendLimits.canAccessFuturesBot,
    canAccessPropFirmBot: backendLimits.canAccessPropFirmBot,
    canTradeStocks: backendLimits.canTradeStocks,
    canTradeCrypto: backendLimits.canTradeCrypto,
    canTradeOptions: backendLimits.canTradeOptions,
    canTradeFutures: backendLimits.canTradeFutures,
    canAccessPerformance: backendLimits.canAccessPerformance,
    canAccessAdvancedAnalytics: backendLimits.canAccessAdvancedAnalytics,
    canAccessSymbolLeaderboard: backendLimits.canAccessSymbolLeaderboard,
    canAccessTimeHeatmap: backendLimits.canAccessTimeHeatmap,
    canAccessEngineTrends: backendLimits.canAccessEngineTrends,
    canAccessSignalAnalysis: backendLimits.canAccessSignalAnalysis,
    canAccessDrawdownAnalysis: backendLimits.canAccessDrawdownAnalysis,
    canAccessLossAnalysis: backendLimits.canAccessLossAnalysis,
    canAccessPatternRecognition: backendLimits.canAccessPatternRecognition,
    canAccessSupportResistance: backendLimits.canAccessSupportResistance,
    canAccessMultiFactorAnalysis: backendLimits.canAccessMultiFactorAnalysis,
    canAccessSECFilings: backendLimits.canAccessSECFilings,
    canAccessGovContracts: backendLimits.canAccessGovContracts,
    canAccessCatalystScoring: backendLimits.canAccessCatalystScoring,
    canAccessRealTimeData: backendLimits.canAccessRealTimeData,
    canAccessRealTimeAlerts: backendLimits.canAccessRealTimeAlerts,
    canExportData: backendLimits.canExportData,
    canExportPDF: backendLimits.canExportPDF,
    canAccessTradingJournal: backendLimits.canAccessTradingJournal,
    canAccessDiscordAlerts: backendLimits.canAccessDiscordAlerts,
    canAccessWeeklyPicks: backendLimits.canAccessWeeklyPicks,
    canAccessDailyReports: backendLimits.canAccessDailyReports,
    canAccessAPIAccess: backendLimits.canAccessAPIAccess,
    canAccessWebhooks: backendLimits.canAccessWebhooks,
    canAccessBacktesting: backendLimits.canAccessBacktesting,
    prioritySupport: backendLimits.prioritySupport,
    priorityIdeaGeneration: backendLimits.priorityIdeaGeneration,
  };
}

export function useTier() {
  const { data, isLoading, error } = useQuery<BackendTierInfo>({
    queryKey: ['/api/user/tier'],
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const defaultTier: TierInfo = {
    tier: 'free',
    limits: DEFAULT_FREE_LIMITS,
    usage: { tradeIdeas: 0, chartAnalysis: 0 },
  };

  const tierInfo: TierInfo = data ? {
    tier: data.tier,
    limits: transformLimits(data.limits),
    usage: data.usage,
    isAdmin: data.isAdmin,
  } : defaultTier;

  const canGenerateTradeIdea = (): boolean => {
    if (tierInfo.isAdmin) return true;
    if (tierInfo.limits.tradeIdeasPerDay === -1) return true;
    return tierInfo.usage.tradeIdeas < tierInfo.limits.tradeIdeasPerDay;
  };

  const canUseChartAnalysis = (): boolean => {
    if (tierInfo.isAdmin) return true;
    if (tierInfo.limits.chartAnalysisPerDay === -1) return true;
    return tierInfo.usage.chartAnalysis < tierInfo.limits.chartAnalysisPerDay;
  };

  const getRemainingIdeas = (): number | 'unlimited' => {
    if (tierInfo.isAdmin) return 'unlimited';
    if (tierInfo.limits.tradeIdeasPerDay === -1) return 'unlimited';
    return Math.max(0, tierInfo.limits.tradeIdeasPerDay - tierInfo.usage.tradeIdeas);
  };

  const getRemainingChartAnalysis = (): number | 'unlimited' => {
    if (tierInfo.isAdmin) return 'unlimited';
    if (tierInfo.limits.chartAnalysisPerDay === -1) return 'unlimited';
    return Math.max(0, tierInfo.limits.chartAnalysisPerDay - tierInfo.usage.chartAnalysis);
  };

  const canAccessFeature = (feature: keyof TierLimits): boolean => {
    if (tierInfo.isAdmin) return true;
    const value = tierInfo.limits[feature];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0 || value === -1;
    return false;
  };

  const getRequiredTierForFeature = (feature: keyof TierLimits): 'Free' | 'Advanced' | 'Pro' => {
    const proFeatures: (keyof TierLimits)[] = [
      'canAccessFuturesBot', 'canAccessPropFirmBot', 'canTradeFutures',
      'canAccessAPIAccess', 'canAccessWebhooks', 'canAccessBacktesting',
      'priorityIdeaGeneration'
    ];
    
    const advancedFeatures: (keyof TierLimits)[] = [
      'canAccessHybridEngine', 'canAccessFlowScanner', 'canAccessLottoScanner', 
      'canAccessPennyScanner', 'canAccessAutoLottoBot', 'canAccessCryptoBot',
      'canTradeOptions', 'canAccessPerformance', 'canAccessAdvancedAnalytics',
      'canAccessSymbolLeaderboard', 'canAccessTimeHeatmap', 'canAccessEngineTrends',
      'canAccessSignalAnalysis', 'canAccessDrawdownAnalysis', 'canAccessLossAnalysis',
      'canAccessSupportResistance', 'canAccessMultiFactorAnalysis',
      'canAccessSECFilings', 'canAccessGovContracts', 'canAccessCatalystScoring',
      'canAccessRealTimeData', 'canAccessRealTimeAlerts', 'canExportData', 'canExportPDF',
      'canAccessDiscordAlerts', 'canAccessWeeklyPicks', 'canAccessDailyReports'
    ];
    
    if (proFeatures.includes(feature)) return 'Pro';
    if (advancedFeatures.includes(feature)) return 'Advanced';
    return 'Free';
  };

  return {
    ...tierInfo,
    isLoading,
    error,
    canGenerateTradeIdea,
    canUseChartAnalysis,
    getRemainingIdeas,
    getRemainingChartAnalysis,
    canAccessFeature,
    getRequiredTierForFeature,
    isPro: tierInfo.tier === 'pro' || tierInfo.isAdmin,
    isAdvanced: tierInfo.tier === 'advanced' || tierInfo.tier === 'pro' || tierInfo.isAdmin,
    isFree: tierInfo.tier === 'free' && !tierInfo.isAdmin,
  };
}
