/**
 * Feature Credit Service
 * Manages daily credits for waitlist users (non-beta)
 *
 * Credit System:
 * - Waitlist users get 10 credits daily (refreshed on login)
 * - Beta users have unlimited access (credits don't apply)
 * - Credits can be earned through various actions
 * - Credits are spent on premium features
 */

import { db } from "./db";
import { users, creditTransactions, CreditTransactionType } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

// Credit earning amounts
const CREDIT_REWARDS: Record<string, number> = {
  daily_login: 2,        // +2 for login
  streak_bonus: 10,      // +10 for 7-day streak
  referral_signup: 20,   // +20 for referral
  lesson_complete: 3,    // +3 for lesson
  twitter_share: 5,      // +5 for sharing
};

// Maximum credit balance for waitlist users
const MAX_CREDITS = 50;

// Daily refresh amount
const DAILY_CREDITS = 10;

export class FeatureCreditService {
  /**
   * Process daily login - reset credits and award bonuses
   * Called when user logs in or accesses /api/credits/balance
   */
  async processDailyLogin(userId: string): Promise<{
    newBalance: number;
    newStreak: number;
    bonusAwarded: number;
  }> {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user.length) {
      throw new Error("User not found");
    }

    const userData = user[0];
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Already refreshed today
    if (userData.lastLoginDate === today) {
      return {
        newBalance: userData.credits,
        newStreak: userData.loginStreak,
        bonusAwarded: 0,
      };
    }

    // Calculate streak
    let newStreak = userData.lastLoginDate === yesterday ? userData.loginStreak + 1 : 1;
    let bonusAwarded = CREDIT_REWARDS.daily_login; // Login bonus

    // 7-day streak bonus
    if (newStreak >= 7) {
      bonusAwarded += CREDIT_REWARDS.streak_bonus;
      newStreak = 0; // Reset streak after bonus
    }

    // Calculate new balance (refresh to 10 + bonuses, cap at MAX)
    const newBalance = Math.min(DAILY_CREDITS + bonusAwarded, MAX_CREDITS);

    // Update user
    await db
      .update(users)
      .set({
        credits: newBalance,
        loginStreak: newStreak,
        lastLoginDate: today,
        lastCreditRefresh: new Date(),
      })
      .where(eq(users.id, userId));

    // Log transactions
    await this.logTransaction(
      userId,
      "daily_refresh",
      DAILY_CREDITS,
      newBalance,
      "Daily credit refresh"
    );

    if (CREDIT_REWARDS.daily_login > 0) {
      await this.logTransaction(
        userId,
        "daily_login",
        CREDIT_REWARDS.daily_login,
        newBalance,
        "Login bonus"
      );
    }

    if (bonusAwarded > CREDIT_REWARDS.daily_login) {
      await this.logTransaction(
        userId,
        "streak_bonus",
        CREDIT_REWARDS.streak_bonus,
        newBalance,
        "7-day streak bonus!"
      );
    }

    return { newBalance, newStreak, bonusAwarded };
  }

  /**
   * Get current credit balance (processes daily login if needed)
   */
  async getBalance(userId: string): Promise<{
    balance: number;
    streak: number;
    referralCode: string | null;
    dailyEarned: number;
  }> {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user.length) {
      throw new Error("User not found");
    }

    const userData = user[0];
    const today = new Date().toISOString().split("T")[0];

    // Process daily login if not done today
    if (userData.lastLoginDate !== today) {
      const result = await this.processDailyLogin(userId);
      return {
        balance: result.newBalance,
        streak: result.newStreak,
        referralCode: userData.referralCode,
        dailyEarned: result.bonusAwarded + DAILY_CREDITS,
      };
    }

    // Get today's earnings
    const todayStart = new Date(today);
    const dailyTransactions = await db
      .select()
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          gte(creditTransactions.createdAt, todayStart)
        )
      );

    const dailyEarned = dailyTransactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      balance: userData.credits,
      streak: userData.loginStreak,
      referralCode: userData.referralCode,
      dailyEarned,
    };
  }

  /**
   * Deduct credits for a feature use
   */
  async deductCredits(
    userId: string,
    amount: number,
    featureId: string
  ): Promise<{ success: boolean; newBalance: number; error?: string }> {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user.length) {
      return { success: false, newBalance: 0, error: "User not found" };
    }

    const userData = user[0];

    // Beta users don't need credits
    if (userData.hasBetaAccess) {
      return { success: true, newBalance: Infinity };
    }

    // Check sufficient balance
    if (userData.credits < amount) {
      return {
        success: false,
        newBalance: userData.credits,
        error: "Insufficient credits",
      };
    }

    const newBalance = userData.credits - amount;

    // Update balance
    await db.update(users).set({ credits: newBalance }).where(eq(users.id, userId));

    // Log transaction
    await this.logTransaction(
      userId,
      "feature_spend",
      -amount,
      newBalance,
      `Used ${featureId}`,
      { featureId }
    );

    return { success: true, newBalance };
  }

  /**
   * Award credits for an action
   */
  async awardCredits(
    userId: string,
    action: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; newBalance: number; amount: number; error?: string }> {
    const amount = CREDIT_REWARDS[action];
    if (!amount) {
      return { success: false, newBalance: 0, amount: 0, error: "Invalid action" };
    }

    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user.length) {
      return { success: false, newBalance: 0, amount: 0, error: "User not found" };
    }

    const userData = user[0];
    const newBalance = Math.min(userData.credits + amount, MAX_CREDITS);
    const actualAmount = newBalance - userData.credits; // May be less if capped

    // Update balance and total earned
    await db
      .update(users)
      .set({
        credits: newBalance,
        totalCreditsEarned: sql`${users.totalCreditsEarned} + ${actualAmount}`,
      })
      .where(eq(users.id, userId));

    // Log transaction
    await this.logTransaction(
      userId,
      action as CreditTransactionType,
      actualAmount,
      newBalance,
      `Earned via ${action}`,
      metadata
    );

    return { success: true, newBalance, amount: actualAmount };
  }

  /**
   * Award referral bonus when someone signs up with a referral code
   */
  async processReferralBonus(
    referrerCode: string,
    newUserId: string
  ): Promise<{ success: boolean; referrerId?: string }> {
    // Find referrer by code
    const referrer = await db
      .select()
      .from(users)
      .where(eq(users.referralCode, referrerCode))
      .limit(1);

    if (!referrer.length) {
      return { success: false };
    }

    const referrerId = referrer[0].id;

    // Award credits to referrer
    await this.awardCredits(referrerId, "referral_signup", {
      newUserId,
    });

    return { success: true, referrerId };
  }

  /**
   * Generate unique referral code for a user
   */
  async generateReferralCode(userId: string): Promise<string> {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user.length) {
      throw new Error("User not found");
    }

    // If user already has a code, return it
    if (user[0].referralCode) {
      return user[0].referralCode;
    }

    // Generate a unique code
    const code = this.generateCode();

    await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));

    return code;
  }

  /**
   * Get transaction history for a user
   */
  async getTransactionHistory(
    userId: string,
    limit: number = 50
  ): Promise<typeof creditTransactions.$inferSelect[]> {
    return db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit);
  }

  /**
   * Admin: Grant credits to a user
   */
  async adminGrantCredits(
    userId: string,
    amount: number,
    reason: string
  ): Promise<{ success: boolean; newBalance: number }> {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user.length) {
      return { success: false, newBalance: 0 };
    }

    const userData = user[0];
    const newBalance = Math.min(userData.credits + amount, MAX_CREDITS);

    await db.update(users).set({ credits: newBalance }).where(eq(users.id, userId));

    await this.logTransaction(
      userId,
      "admin_grant",
      amount,
      newBalance,
      reason,
      { adminAction: true }
    );

    return { success: true, newBalance };
  }

  /**
   * Log a credit transaction
   */
  private async logTransaction(
    userId: string,
    type: CreditTransactionType,
    amount: number,
    balanceAfter: number,
    description: string,
    metadata?: Record<string, unknown>,
    featureId?: string
  ): Promise<void> {
    await db.insert(creditTransactions).values({
      userId,
      type,
      amount,
      balanceAfter,
      description,
      metadata: metadata || null,
      featureId: featureId || null,
    });
  }

  /**
   * Generate a random referral code
   */
  private generateCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "QE-";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}

// Singleton instance
export const featureCreditService = new FeatureCreditService();
