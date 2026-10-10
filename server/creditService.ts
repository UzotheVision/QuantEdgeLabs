import { db } from "./db";
import { aiCreditBalances, aiUsageLedger, AI_CREDIT_ALLOCATIONS, SubscriptionTier } from "@shared/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { logger } from "./logger";

export interface CreditCheckResult {
  hasCredits: boolean;
  creditsRemaining: number;
  creditsUsed: number;
  creditsAllocated: number;
  cycleEnd: Date;
  tier: SubscriptionTier;
}

export interface DeductCreditResult {
  success: boolean;
  creditsRemaining: number;
  error?: string;
}

export class CreditService {
  
  async getOrCreateBalance(userId: string, tier: SubscriptionTier): Promise<CreditCheckResult> {
    const now = new Date();
    
    const existingBalance = await db
      .select()
      .from(aiCreditBalances)
      .where(
        and(
          eq(aiCreditBalances.userId, userId),
          lte(aiCreditBalances.cycleStart, now),
          gte(aiCreditBalances.cycleEnd, now)
        )
      )
      .limit(1);
    
    if (existingBalance.length > 0) {
      const balance = existingBalance[0];
      return {
        hasCredits: balance.creditsRemaining > 0,
        creditsRemaining: balance.creditsRemaining,
        creditsUsed: balance.creditsUsed,
        creditsAllocated: balance.creditsAllocated,
        cycleEnd: balance.cycleEnd,
        tier: balance.tierSnapshot as SubscriptionTier,
      };
    }
    
    const newBalance = await this.allocateCredits(userId, tier);
    return {
      hasCredits: newBalance.creditsRemaining > 0,
      creditsRemaining: newBalance.creditsRemaining,
      creditsUsed: newBalance.creditsUsed,
      creditsAllocated: newBalance.creditsAllocated,
      cycleEnd: newBalance.cycleEnd,
      tier: newBalance.tierSnapshot as SubscriptionTier,
    };
  }
  
  async allocateCredits(userId: string, tier: SubscriptionTier) {
    const now = new Date();
    const cycleEnd = new Date(now);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);
    
    const allocation = AI_CREDIT_ALLOCATIONS[tier] || AI_CREDIT_ALLOCATIONS.free;
    
    const [newBalance] = await db
      .insert(aiCreditBalances)
      .values({
        userId,
        tierSnapshot: tier,
        creditsAllocated: allocation,
        creditsUsed: 0,
        creditsRemaining: allocation,
        cycleStart: now,
        cycleEnd: cycleEnd,
      })
      .returning();
    
    logger.info(`[CREDITS] Allocated ${allocation} credits to user ${userId} (tier: ${tier})`);
    
    return newBalance;
  }
  
  async deductCredit(
    userId: string,
    tier: SubscriptionTier,
    provider: string,
    model: string,
    inputTokens?: number,
    outputTokens?: number,
    questionPreview?: string,
    responseTimeMs?: number
  ): Promise<DeductCreditResult> {
    try {
      const balance = await this.getOrCreateBalance(userId, tier);
      
      if (!balance.hasCredits) {
        return {
          success: false,
          creditsRemaining: 0,
          error: 'No credits remaining. Please upgrade your plan for more AI access.',
        };
      }
      
      const estimatedCost = this.calculateCost(provider, inputTokens || 0, outputTokens || 0);
      
      await db
        .insert(aiUsageLedger)
        .values({
          userId,
          provider,
          model,
          inputTokens: inputTokens || null,
          outputTokens: outputTokens || null,
          creditsDebited: 1,
          estimatedCostCents: estimatedCost,
          requestType: 'research_assistant',
          questionPreview: questionPreview?.slice(0, 100),
          responseTimeMs: responseTimeMs || null,
          wasSuccessful: true,
        });
      
      const now = new Date();
      await db
        .update(aiCreditBalances)
        .set({
          creditsUsed: balance.creditsUsed + 1,
          creditsRemaining: balance.creditsRemaining - 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(aiCreditBalances.userId, userId),
            lte(aiCreditBalances.cycleStart, now),
            gte(aiCreditBalances.cycleEnd, now)
          )
        );
      
      logger.info(`[CREDITS] Deducted 1 credit from user ${userId}. Remaining: ${balance.creditsRemaining - 1}`);
      
      return {
        success: true,
        creditsRemaining: balance.creditsRemaining - 1,
      };
    } catch (error: any) {
      logger.error(`[CREDITS] Error deducting credit for user ${userId}:`, error);
      return {
        success: false,
        creditsRemaining: 0,
        error: 'Failed to process credit deduction.',
      };
    }
  }
  
  calculateCost(provider: string, inputTokens: number, outputTokens: number): number {
    const pricing: Record<string, { input: number; output: number }> = {
      gemini: { input: 0.000125, output: 0.0005 },
      anthropic: { input: 0.003, output: 0.015 },
      openai: { input: 0.0025, output: 0.01 },
    };
    
    const rates = pricing[provider] || pricing.gemini;
    const costDollars = (inputTokens * rates.input / 1000) + (outputTokens * rates.output / 1000);
    return Math.round(costDollars * 100 * 100) / 100;
  }
  
  async getUsageHistory(userId: string, limit: number = 50) {
    return db
      .select()
      .from(aiUsageLedger)
      .where(eq(aiUsageLedger.userId, userId))
      .orderBy(aiUsageLedger.createdAt)
      .limit(limit);
  }
  
  async getAllBalances(limit: number = 100) {
    return db
      .select()
      .from(aiCreditBalances)
      .orderBy(aiCreditBalances.updatedAt)
      .limit(limit);
  }
  
  async getTotalUsageStats() {
    const allUsage = await db.select().from(aiUsageLedger);
    
    const stats = {
      totalQueries: allUsage.length,
      totalCreditsUsed: allUsage.reduce((sum, u) => sum + (u.creditsDebited || 0), 0),
      totalCostCents: allUsage.reduce((sum, u) => sum + (u.estimatedCostCents || 0), 0),
      byProvider: {} as Record<string, number>,
    };
    
    for (const usage of allUsage) {
      stats.byProvider[usage.provider] = (stats.byProvider[usage.provider] || 0) + 1;
    }
    
    return stats;
  }
  
  async getTierAnalytics(tier: SubscriptionTier, userId: string) {
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysIntoMonth = Math.max(1, Math.floor((now.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24)));
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    
    // Ensure user has a current-cycle balance (handles expired cycles)
    const currentUserBalance = await this.getOrCreateBalance(userId, tier);
    
    // Get all active balances for this tier (current cycle only)
    const tierBalances = await db
      .select()
      .from(aiCreditBalances)
      .where(
        and(
          eq(aiCreditBalances.tierSnapshot, tier),
          gte(aiCreditBalances.cycleEnd, now) // Only current cycle balances
        )
      );
    
    // Use the user's current balance from getOrCreateBalance
    const userUsed = currentUserBalance.creditsUsed;
    const userAllocated = currentUserBalance.creditsAllocated;
    
    // Calculate tier averages from current cycle only
    const tierUsages = tierBalances.map(b => b.creditsUsed);
    const avgUsage = tierUsages.length > 0 
      ? Math.round(tierUsages.reduce((a, b) => a + b, 0) / tierUsages.length)
      : 0;
    
    // Calculate user's rank (what percentile they're in)
    const usersWithLessUsage = tierUsages.filter(u => u < userUsed).length;
    const percentile = tierUsages.length > 0 
      ? Math.round((usersWithLessUsage / tierUsages.length) * 100)
      : 50;
    
    // Calculate daily average
    const dailyAverage = daysIntoMonth > 0 ? Math.round((userUsed / daysIntoMonth) * 10) / 10 : 0;
    const projectedMonthly = Math.round(dailyAverage * daysInMonth);
    
    // Clamp daysRemaining to >= 0
    const daysRemaining = Math.max(0, daysInMonth - daysIntoMonth);
    
    return {
      userUsed,
      userAllocated,
      usagePercentage: userAllocated > 0 ? Math.round((userUsed / userAllocated) * 100) : 0,
      dailyAverage,
      projectedMonthly,
      tierAverageUsage: avgUsage,
      tierUserCount: tierBalances.length,
      userPercentile: percentile,
      daysIntoMonth,
      daysRemaining,
    };
  }
  
  async resetUserCredits(userId: string, tier: SubscriptionTier) {
    const now = new Date();
    
    await db
      .update(aiCreditBalances)
      .set({
        cycleEnd: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiCreditBalances.userId, userId),
          gte(aiCreditBalances.cycleEnd, now)
        )
      );
    
    return this.allocateCredits(userId, tier);
  }
}

export const creditService = new CreditService();
