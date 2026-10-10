import { storage } from './storage';
import { logger } from './logger';
import type { TradeIdea, Catalyst } from '@shared/schema';

export interface WatchReason {
  type: 'earnings' | 'news' | 'flow' | 'technical' | 'ai_pick' | 'quant_signal' | 'momentum' | 'volatility' | 'hybrid' | 'lotto';
  label: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  timestamp?: string;
  count?: number;
}

export interface WatchSuggestion {
  symbol: string;
  assetType: 'stock' | 'crypto' | 'option';
  currentPrice?: number;
  priceChange?: number;
  reasons: WatchReason[];
  reasonCount: number;
  priority: 'hot' | 'warm' | 'watch';
  direction?: 'bullish' | 'bearish' | 'neutral';
  generatedAt: string;
}

interface ReasonAggregator {
  [type: string]: {
    count: number;
    bestConfidence: number;
    latestTimestamp: string;
    source: string;
  };
}

export async function generateWatchSuggestions(): Promise<WatchSuggestion[]> {
  const now = new Date();
  const symbolData = new Map<string, {
    assetType: string;
    reasonTypes: ReasonAggregator;
    direction?: 'bullish' | 'bearish';
    currentPrice?: number;
  }>();
  
  try {
    const [tradeIdeas, catalysts] = await Promise.all([
      storage.getAllTradeIdeas(),
      storage.getAllCatalysts(),
    ]);
    
    const recentIdeas = tradeIdeas.filter((idea: TradeIdea) => {
      const ideaTime = new Date(idea.timestamp || '');
      const hoursSinceCreated = (now.getTime() - ideaTime.getTime()) / (1000 * 60 * 60);
      return hoursSinceCreated < 72;
    });
    
    for (const idea of recentIdeas) {
      if (!idea.symbol) continue;
      
      const data = symbolData.get(idea.symbol) || {
        assetType: idea.assetType,
        reasonTypes: {},
        direction: undefined,
        currentPrice: undefined,
      };
      
      const confidence = idea.confidenceScore || 0;
      let reasonType: string | null = null;
      
      if (idea.source === 'ai' && confidence >= 70) {
        reasonType = 'ai_pick';
      } else if (idea.source === 'quant' && confidence >= 65) {
        reasonType = 'quant_signal';
      } else if (idea.source === 'hybrid' && confidence >= 65) {
        reasonType = 'hybrid';
      } else if (idea.source === 'flow') {
        reasonType = 'flow';
      } else if (idea.source === 'lotto') {
        reasonType = 'lotto';
      } else if (idea.source === 'news') {
        reasonType = 'news';
      }
      
      if (reasonType) {
        const existing = data.reasonTypes[reasonType];
        if (!existing || confidence > existing.bestConfidence) {
          data.reasonTypes[reasonType] = {
            count: (existing?.count || 0) + 1,
            bestConfidence: Math.max(confidence, existing?.bestConfidence || 0),
            latestTimestamp: idea.timestamp,
            source: idea.source,
          };
        } else {
          data.reasonTypes[reasonType].count++;
        }
      }
      
      if (idea.direction) {
        data.direction = idea.direction === 'long' ? 'bullish' : 'bearish';
      }
      data.currentPrice = idea.entryPrice || data.currentPrice;
      symbolData.set(idea.symbol, data);
    }
    
    const recentCatalysts = catalysts.filter((cat: Catalyst) => {
      const catTime = new Date(cat.timestamp);
      const hoursSinceCatalyst = (now.getTime() - catTime.getTime()) / (1000 * 60 * 60);
      return hoursSinceCatalyst < 168;
    });
    
    for (const catalyst of recentCatalysts) {
      if (!catalyst.symbol) continue;
      
      const data = symbolData.get(catalyst.symbol) || {
        assetType: 'stock',
        reasonTypes: {},
        direction: undefined,
        currentPrice: undefined,
      };
      
      const reasonType = catalyst.eventType === 'earnings' ? 'earnings' : 'news';
      const existing = data.reasonTypes[reasonType];
      
      data.reasonTypes[reasonType] = {
        count: (existing?.count || 0) + 1,
        bestConfidence: 0,
        latestTimestamp: catalyst.timestamp,
        source: catalyst.eventType,
      };
      
      symbolData.set(catalyst.symbol, data);
    }
    
    const suggestions: WatchSuggestion[] = [];
    
    symbolData.forEach((data, symbol) => {
      const reasons: WatchReason[] = [];
      
      for (const [type, info] of Object.entries(data.reasonTypes)) {
        const reason = buildReason(type, info as { count: number; bestConfidence: number; latestTimestamp: string; source: string });
        if (reason) reasons.push(reason);
      }
      
      if (reasons.length >= 2) {
        suggestions.push({
          symbol,
          assetType: data.assetType as 'stock' | 'crypto' | 'option',
          currentPrice: data.currentPrice,
          reasons,
          reasonCount: reasons.length,
          priority: calculatePriority(reasons),
          direction: data.direction,
          generatedAt: now.toISOString(),
        });
      }
    });
    
    suggestions.sort((a, b) => {
      const priorityOrder = { hot: 0, warm: 1, watch: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return b.reasonCount - a.reasonCount;
    });
    
    const result = suggestions.slice(0, 15);
    logger.info(`📡 [WATCH] Generated ${result.length} watch suggestions from ${symbolData.size} symbols`);
    return result;
    
  } catch (error) {
    logger.error('📡 [WATCH] Error generating watch suggestions:', error);
    return [];
  }
}

function buildReason(type: string, info: { count: number; bestConfidence: number; latestTimestamp: string; source: string }): WatchReason | null {
  const conf = Math.round(info.bestConfidence);
  
  switch (type) {
    case 'ai_pick':
      return {
        type: 'ai_pick',
        label: 'AI Pick',
        description: `AI engine (${conf}% conf)`,
        impact: info.bestConfidence >= 85 ? 'high' : 'medium',
        timestamp: info.latestTimestamp,
      };
    case 'quant_signal':
      return {
        type: 'quant_signal',
        label: 'Quant Signal',
        description: `Quant engine (${conf}% conf)`,
        impact: info.bestConfidence >= 80 ? 'high' : 'medium',
        timestamp: info.latestTimestamp,
      };
    case 'hybrid':
      return {
        type: 'hybrid',
        label: 'Hybrid',
        description: `AI+Quant combo (${conf}% conf)`,
        impact: 'high',
        timestamp: info.latestTimestamp,
      };
    case 'flow':
      return {
        type: 'flow',
        label: info.count > 1 ? `Flow (${info.count}x)` : 'Flow',
        description: 'Unusual options activity',
        impact: info.count >= 3 ? 'high' : 'medium',
        timestamp: info.latestTimestamp,
        count: info.count,
      };
    case 'lotto':
      return {
        type: 'lotto',
        label: 'Lotto',
        description: 'Cheap far-OTM options',
        impact: 'low',
        timestamp: info.latestTimestamp,
      };
    case 'news':
      return {
        type: 'news',
        label: 'News',
        description: 'Breaking catalyst',
        impact: 'high',
        timestamp: info.latestTimestamp,
      };
    case 'earnings':
      return {
        type: 'earnings',
        label: 'Earnings',
        description: 'Upcoming/recent earnings',
        impact: 'high',
        timestamp: info.latestTimestamp,
      };
    default:
      return null;
  }
}

function calculatePriority(reasons: WatchReason[]): 'hot' | 'warm' | 'watch' {
  const highImpactCount = reasons.filter(r => r.impact === 'high').length;
  const uniqueTypes = new Set(reasons.map(r => r.type)).size;
  
  if (highImpactCount >= 2 || (reasons.length >= 3 && uniqueTypes >= 3)) {
    return 'hot';
  }
  if (highImpactCount >= 1 || reasons.length >= 2) {
    return 'warm';
  }
  return 'watch';
}
