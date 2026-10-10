import { db } from "./db";
import { signalPerformance } from "@shared/schema";
import { logger } from "./logger";
import { gte, desc } from "drizzle-orm";

export interface SignalWeight {
  signalName: string;
  baseWeight: number;
  dynamicWeight: number;
  winRate: number;
  totalTrades: number;
  confidence: 'high' | 'medium' | 'low' | 'untested';
  isOverridden: boolean;
  overrideWeight?: number;
}

export interface WeightingConfig {
  minWeight: number;
  maxWeight: number;
  baselineWinRate: number;
  enableDynamicWeights: boolean;
}

const CONFIG: WeightingConfig = {
  minWeight: 0.25,
  maxWeight: 2.5,
  baselineWinRate: 50,
  enableDynamicWeights: true,
};

const manualOverrides: Map<string, number> = new Map();

let cachedWeights: Map<string, SignalWeight> = new Map();
let lastCacheTime: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function calculateDynamicWeight(
  winRate: number,
  totalTrades: number
): { weight: number; confidence: 'high' | 'medium' | 'low' | 'untested' } {
  let confidence: 'high' | 'medium' | 'low' | 'untested';
  if (totalTrades >= 50) confidence = 'high';
  else if (totalTrades >= 20) confidence = 'medium';
  else if (totalTrades >= 5) confidence = 'low';
  else confidence = 'untested';

  if (!CONFIG.enableDynamicWeights) {
    return { weight: 1.0, confidence };
  }

  let rawWeight = winRate / CONFIG.baselineWinRate;
  
  if (confidence === 'untested') {
    rawWeight = Math.max(rawWeight, 0.8);
  } else if (confidence === 'low') {
    rawWeight = 0.5 + (rawWeight * 0.5);
  }

  const clampedWeight = Math.max(
    CONFIG.minWeight,
    Math.min(CONFIG.maxWeight, rawWeight)
  );

  return { weight: clampedWeight, confidence };
}

function applyOverridesToCache(): void {
  for (const [signalName, overrideWeight] of Array.from(manualOverrides.entries())) {
    const existing = cachedWeights.get(signalName);
    if (existing) {
      cachedWeights.set(signalName, {
        ...existing,
        dynamicWeight: overrideWeight,
        isOverridden: true,
        overrideWeight,
      });
    } else {
      cachedWeights.set(signalName, {
        signalName,
        baseWeight: 1.0,
        dynamicWeight: overrideWeight,
        winRate: 0,
        totalTrades: 0,
        confidence: 'untested',
        isOverridden: true,
        overrideWeight,
      });
    }
  }
}

export async function refreshSignalWeights(): Promise<Map<string, SignalWeight>> {
  logger.info("🔄 [DYNAMIC-WEIGHTS] Refreshing signal weights from attribution data...");

  try {
    const signals = await db.select()
      .from(signalPerformance)
      .where(gte(signalPerformance.totalTrades, 1))
      .orderBy(desc(signalPerformance.totalTrades));

    const newWeights = new Map<string, SignalWeight>();

    for (const signal of signals) {
      const { weight, confidence } = calculateDynamicWeight(
        signal.winRate,
        signal.totalTrades
      );

      const isOverridden = manualOverrides.has(signal.signalName);
      const finalWeight = isOverridden 
        ? manualOverrides.get(signal.signalName)! 
        : weight;

      newWeights.set(signal.signalName, {
        signalName: signal.signalName,
        baseWeight: 1.0,
        dynamicWeight: finalWeight,
        winRate: signal.winRate,
        totalTrades: signal.totalTrades,
        confidence,
        isOverridden,
        overrideWeight: isOverridden ? manualOverrides.get(signal.signalName) : undefined,
      });
    }

    cachedWeights = newWeights;
    applyOverridesToCache();
    lastCacheTime = Date.now();

    logger.info(`✅ [DYNAMIC-WEIGHTS] Loaded ${newWeights.size} signal weights (${manualOverrides.size} overrides)`);
    
    const topBoosted = Array.from(newWeights.values())
      .filter(w => w.dynamicWeight > 1.5)
      .sort((a, b) => b.dynamicWeight - a.dynamicWeight)
      .slice(0, 5);
    
    if (topBoosted.length > 0) {
      logger.info(`📈 [DYNAMIC-WEIGHTS] Top boosted signals: ${topBoosted.map(w => `${w.signalName}(${w.dynamicWeight.toFixed(2)}x)`).join(', ')}`);
    }

    const reduced = Array.from(newWeights.values())
      .filter(w => w.dynamicWeight < 0.5)
      .sort((a, b) => a.dynamicWeight - b.dynamicWeight)
      .slice(0, 5);
    
    if (reduced.length > 0) {
      logger.info(`📉 [DYNAMIC-WEIGHTS] Reduced influence signals: ${reduced.map(w => `${w.signalName}(${w.dynamicWeight.toFixed(2)}x)`).join(', ')}`);
    }

    return cachedWeights;

  } catch (error) {
    logger.error(`❌ [DYNAMIC-WEIGHTS] Failed to refresh weights: ${error}`);
    return cachedWeights;
  }
}

export async function getSignalWeights(): Promise<Map<string, SignalWeight>> {
  const now = Date.now();
  
  if (cachedWeights.size === 0 || (now - lastCacheTime) > CACHE_TTL_MS) {
    return refreshSignalWeights();
  }

  return cachedWeights;
}

export async function getWeightForSignal(signalName: string): Promise<number> {
  if (manualOverrides.has(signalName)) {
    return manualOverrides.get(signalName)!;
  }
  
  const weights = await getSignalWeights();
  const signalWeight = weights.get(signalName);
  
  if (!signalWeight) {
    return 1.0;
  }

  return signalWeight.dynamicWeight;
}

export async function calculateWeightedConfidence(
  signals: string[],
  baseConfidence: number
): Promise<{
  adjustedConfidence: number;
  signalContributions: Array<{ signal: string; weight: number; contribution: number }>;
  totalWeightMultiplier: number;
}> {
  const weights = await getSignalWeights();
  
  if (signals.length === 0) {
    return {
      adjustedConfidence: baseConfidence,
      signalContributions: [],
      totalWeightMultiplier: 1.0,
    };
  }

  let totalWeight = 0;
  const contributions: Array<{ signal: string; weight: number; contribution: number }> = [];

  for (const signal of signals) {
    const override = manualOverrides.get(signal);
    const weight = override ?? weights.get(signal)?.dynamicWeight ?? 1.0;
    totalWeight += weight;
    contributions.push({
      signal,
      weight,
      contribution: weight / signals.length,
    });
  }

  const avgWeight = totalWeight / signals.length;
  
  const dampedMultiplier = 1 + ((avgWeight - 1) * 0.5);
  
  let adjustedConfidence = baseConfidence * dampedMultiplier;
  adjustedConfidence = Math.max(10, Math.min(99, adjustedConfidence));

  return {
    adjustedConfidence: Math.round(adjustedConfidence * 10) / 10,
    signalContributions: contributions,
    totalWeightMultiplier: Math.round(avgWeight * 100) / 100,
  };
}

export function setManualOverride(signalName: string, weight: number): number {
  const clampedWeight = Math.max(0.1, Math.min(3.0, weight));
  
  const previousWeight = manualOverrides.get(signalName) ?? 
    cachedWeights.get(signalName)?.dynamicWeight ?? 1.0;
  
  manualOverrides.set(signalName, clampedWeight);
  
  const existing = cachedWeights.get(signalName);
  if (existing) {
    cachedWeights.set(signalName, {
      ...existing,
      dynamicWeight: clampedWeight,
      isOverridden: true,
      overrideWeight: clampedWeight,
    });
  } else {
    cachedWeights.set(signalName, {
      signalName,
      baseWeight: 1.0,
      dynamicWeight: clampedWeight,
      winRate: 0,
      totalTrades: 0,
      confidence: 'untested',
      isOverridden: true,
      overrideWeight: clampedWeight,
    });
  }
  
  logger.info(`🔧 [DYNAMIC-WEIGHTS] Manual override set: ${signalName} = ${clampedWeight}x (was ${previousWeight.toFixed(2)}x)`);
  
  return previousWeight;
}

export function removeManualOverride(signalName: string): boolean {
  const existed = manualOverrides.has(signalName);
  manualOverrides.delete(signalName);
  
  const existing = cachedWeights.get(signalName);
  if (existing && existing.isOverridden) {
    const { weight } = calculateDynamicWeight(existing.winRate, existing.totalTrades);
    cachedWeights.set(signalName, {
      ...existing,
      dynamicWeight: weight,
      isOverridden: false,
      overrideWeight: undefined,
    });
  }
  
  logger.info(`🔧 [DYNAMIC-WEIGHTS] Manual override removed: ${signalName}`);
  
  return existed;
}

export function getManualOverrides(): Map<string, number> {
  return new Map(manualOverrides);
}

export async function getWeightsSummary(): Promise<{
  enabled: boolean;
  totalSignals: number;
  boostedCount: number;
  reducedCount: number;
  neutralCount: number;
  overriddenCount: number;
  topBoosted: SignalWeight[];
  topReduced: SignalWeight[];
}> {
  const weights = await getSignalWeights();
  const weightArray = Array.from(weights.values());

  const boosted = weightArray.filter(w => w.dynamicWeight > 1.2);
  const reduced = weightArray.filter(w => w.dynamicWeight < 0.8);
  const neutral = weightArray.filter(w => w.dynamicWeight >= 0.8 && w.dynamicWeight <= 1.2);
  const overridden = weightArray.filter(w => w.isOverridden);

  return {
    enabled: CONFIG.enableDynamicWeights,
    totalSignals: weightArray.length,
    boostedCount: boosted.length,
    reducedCount: reduced.length,
    neutralCount: neutral.length,
    overriddenCount: overridden.length,
    topBoosted: boosted
      .sort((a, b) => b.dynamicWeight - a.dynamicWeight)
      .slice(0, 10),
    topReduced: reduced
      .sort((a, b) => a.dynamicWeight - b.dynamicWeight)
      .slice(0, 10),
  };
}
