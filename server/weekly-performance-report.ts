/**
 * Weekly Performance Report Automation
 * 
 * Generates comprehensive weekly performance summaries
 * and sends them to Discord and/or email.
 */

import { logger } from './logger';
import { storage } from './storage';
import { format, subDays, startOfWeek, endOfWeek } from 'date-fns';
import { postDiscordWebhook } from './discord-service';

interface WeeklyReport {
  period: {
    start: string;
    end: string;
  };
  summary: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnL: number;
    avgPnLPerTrade: number;
  };
  byStrategy: {
    strategy: string;
    trades: number;
    winRate: number;
    pnl: number;
  }[];
  byTicker: {
    symbol: string;
    trades: number;
    winRate: number;
    pnl: number;
  }[];
  bestTrades: {
    symbol: string;
    direction: string;
    pnlPercent: number;
    date: string;
  }[];
  worstTrades: {
    symbol: string;
    direction: string;
    pnlPercent: number;
    date: string;
  }[];
  insights: string[];
  recommendations: string[];
}

interface ReportSettings {
  isEnabled: boolean;
  discordWebhook: string | null;
  emailRecipients: string[];
  sendOnDay: 'sunday' | 'monday';
  sendAtHour: number; // 0-23
  includeRecommendations: boolean;
}

let reportSettings: ReportSettings = {
  isEnabled: true,
  discordWebhook: process.env.DISCORD_WEBHOOK_URL || null,
  emailRecipients: [],
  sendOnDay: 'sunday',
  sendAtHour: 20, // 8 PM
  includeRecommendations: true,
};

/**
 * Generate weekly performance report
 */
export async function generateWeeklyReport(): Promise<WeeklyReport> {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  
  // Fetch all trade ideas from the past week
  const allIdeas = await storage.getAllTradeIdeas();
  const weeklyIdeas = allIdeas.filter(idea => {
    const ideaDate = new Date(idea.timestamp);
    return ideaDate >= weekStart && ideaDate <= weekEnd;
  });
  
  // Calculate closed trades
  const closedTrades = weeklyIdeas.filter(
    t => t.outcomeStatus === 'hit_target' || t.outcomeStatus === 'stopped_out'
  );
  
  const wins = closedTrades.filter(t => t.outcomeStatus === 'hit_target');
  const losses = closedTrades.filter(t => t.outcomeStatus === 'stopped_out');
  
  // Calculate P&L
  let totalPnL = 0;
  for (const trade of wins) {
    const pnl = ((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100;
    totalPnL += pnl;
  }
  for (const trade of losses) {
    const pnl = ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100;
    totalPnL += pnl;
  }
  
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const avgPnL = closedTrades.length > 0 ? totalPnL / closedTrades.length : 0;
  
  // Group by strategy (source)
  const strategyMap = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const trade of closedTrades) {
    const strategy = trade.source || 'unknown';
    const current = strategyMap.get(strategy) || { trades: 0, wins: 0, pnl: 0 };
    current.trades++;
    if (trade.outcomeStatus === 'hit_target') {
      current.wins++;
      current.pnl += ((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100;
    } else {
      current.pnl += ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100;
    }
    strategyMap.set(strategy, current);
  }
  
  const byStrategy = Array.from(strategyMap.entries()).map(([strategy, data]) => ({
    strategy,
    trades: data.trades,
    winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
    pnl: data.pnl,
  }));
  
  // Group by ticker
  const tickerMap = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const trade of closedTrades) {
    const current = tickerMap.get(trade.symbol) || { trades: 0, wins: 0, pnl: 0 };
    current.trades++;
    if (trade.outcomeStatus === 'hit_target') {
      current.wins++;
      current.pnl += ((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100;
    } else {
      current.pnl += ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100;
    }
    tickerMap.set(trade.symbol, current);
  }
  
  const byTicker = Array.from(tickerMap.entries())
    .map(([symbol, data]) => ({
      symbol,
      trades: data.trades,
      winRate: data.trades > 0 ? (data.wins / data.trades) * 100 : 0,
      pnl: data.pnl,
    }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 10);
  
  // Best and worst trades
  const tradesWithPnL = closedTrades.map(trade => {
    const pnl = trade.outcomeStatus === 'hit_target'
      ? ((trade.targetPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100;
    return {
      symbol: trade.symbol,
      direction: trade.direction,
      pnlPercent: pnl,
      date: trade.timestamp,
    };
  }).sort((a, b) => b.pnlPercent - a.pnlPercent);
  
  const bestTrades = tradesWithPnL.slice(0, 5);
  const worstTrades = tradesWithPnL.slice(-5).reverse();
  
  // Generate insights
  const insights: string[] = [];
  
  if (winRate >= 50) {
    insights.push(`✅ Strong week with ${winRate.toFixed(1)}% win rate`);
  } else if (winRate >= 40) {
    insights.push(`⚡ Moderate performance at ${winRate.toFixed(1)}% win rate`);
  } else {
    insights.push(`⚠️ Below-average week with ${winRate.toFixed(1)}% win rate`);
  }
  
  if (byStrategy.length > 0) {
    const bestStrategy = byStrategy.sort((a, b) => b.winRate - a.winRate)[0];
    insights.push(`📊 Best strategy: ${bestStrategy.strategy} (${bestStrategy.winRate.toFixed(1)}% win rate)`);
  }
  
  if (byTicker.length > 0) {
    const bestTicker = byTicker[0];
    insights.push(`🎯 Top performer: ${bestTicker.symbol} (+${bestTicker.pnl.toFixed(1)}%)`);
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (winRate < 45) {
    recommendations.push('Consider tightening entry criteria or reducing position sizes');
  }
  
  const lottoStrategy = byStrategy.find(s => s.strategy === 'lotto');
  if (lottoStrategy && lottoStrategy.winRate < 40) {
    recommendations.push('Lotto strategy underperforming - focus on liquid 0 DTE plays only');
  }
  
  const quantStrategy = byStrategy.find(s => s.strategy === 'quant');
  if (quantStrategy && quantStrategy.winRate > 55) {
    recommendations.push('Quant RSI(2) showing strong edge - consider increasing allocation');
  }
  
  if (byTicker.length > 0) {
    const worstTicker = byTicker[byTicker.length - 1];
    if (worstTicker.pnl < -10) {
      recommendations.push(`Avoid ${worstTicker.symbol} - consistent underperformer`);
    }
  }
  
  return {
    period: {
      start: format(weekStart, 'MMM dd, yyyy'),
      end: format(weekEnd, 'MMM dd, yyyy'),
    },
    summary: {
      totalTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnL,
      avgPnLPerTrade: avgPnL,
    },
    byStrategy,
    byTicker,
    bestTrades,
    worstTrades,
    insights,
    recommendations,
  };
}

/**
 * Format report for Discord
 */
function formatForDiscord(report: WeeklyReport): string {
  const lines: string[] = [
    `# 📊 Weekly Performance Report`,
    `**${report.period.start} - ${report.period.end}**`,
    '',
    '## Summary',
    `- **Total Trades:** ${report.summary.totalTrades}`,
    `- **Win Rate:** ${report.summary.winRate.toFixed(1)}%`,
    `- **W/L:** ${report.summary.wins}/${report.summary.losses}`,
    `- **Total P&L:** ${report.summary.totalPnL >= 0 ? '+' : ''}${report.summary.totalPnL.toFixed(1)}%`,
    `- **Avg P&L/Trade:** ${report.summary.avgPnLPerTrade >= 0 ? '+' : ''}${report.summary.avgPnLPerTrade.toFixed(2)}%`,
    '',
  ];
  
  if (report.byStrategy.length > 0) {
    lines.push('## By Strategy');
    for (const strategy of report.byStrategy) {
      lines.push(`- **${strategy.strategy}:** ${strategy.trades} trades, ${strategy.winRate.toFixed(1)}% WR, ${strategy.pnl >= 0 ? '+' : ''}${strategy.pnl.toFixed(1)}%`);
    }
    lines.push('');
  }
  
  if (report.bestTrades.length > 0) {
    lines.push('## 🏆 Top Winners');
    for (const trade of report.bestTrades.slice(0, 3)) {
      lines.push(`- ${trade.symbol} ${trade.direction.toUpperCase()}: +${trade.pnlPercent.toFixed(1)}%`);
    }
    lines.push('');
  }
  
  if (report.insights.length > 0) {
    lines.push('## Insights');
    for (const insight of report.insights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }
  
  if (reportSettings.includeRecommendations && report.recommendations.length > 0) {
    lines.push('## Recommendations');
    for (const rec of report.recommendations) {
      lines.push(`- 💡 ${rec}`);
    }
  }
  
  return lines.join('\n');
}

/**
 * Send report to Discord
 */
async function sendToDiscord(report: WeeklyReport): Promise<boolean> {
  const webhook = reportSettings.discordWebhook;
  if (!webhook) {
    logger.warn('[WEEKLY-REPORT] No Discord webhook configured');
    return false;
  }
  
  try {
    const content = formatForDiscord(report);
    
    const response = await postDiscordWebhook(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        username: 'Quant Edge Labs Performance Bot',
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }
    
    logger.info('[WEEKLY-REPORT] Sent to Discord successfully');
    return true;
  } catch (error) {
    logger.error('[WEEKLY-REPORT] Discord send failed:', error);
    return false;
  }
}

/**
 * Run weekly report generation and distribution
 */
export async function runWeeklyReport(): Promise<WeeklyReport | null> {
  if (!reportSettings.isEnabled) {
    logger.info('[WEEKLY-REPORT] Report generation is disabled');
    return null;
  }
  
  logger.info('[WEEKLY-REPORT] Generating weekly performance report...');
  
  try {
    const report = await generateWeeklyReport();
    
    // Send to Discord
    await sendToDiscord(report);
    
    logger.info(`[WEEKLY-REPORT] Report generated: ${report.summary.totalTrades} trades, ${report.summary.winRate.toFixed(1)}% WR`);
    
    return report;
  } catch (error) {
    logger.error('[WEEKLY-REPORT] Error generating report:', error);
    return null;
  }
}

/**
 * Get current report settings
 */
export function getReportSettings(): ReportSettings {
  return { ...reportSettings };
}

/**
 * Update report settings
 */
export function updateReportSettings(settings: Partial<ReportSettings>): void {
  reportSettings = { ...reportSettings, ...settings };
  logger.info('[WEEKLY-REPORT] Settings updated');
}

/**
 * Check if it's time to send the weekly report
 */
export function shouldSendReport(): boolean {
  const now = new Date();
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const currentHour = now.getHours();
  
  return (
    reportSettings.isEnabled &&
    dayOfWeek === reportSettings.sendOnDay &&
    currentHour === reportSettings.sendAtHour
  );
}
