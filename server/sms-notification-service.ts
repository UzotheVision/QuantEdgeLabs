/**
 * SMS Notification Service
 *
 * Send trade alerts directly to your phone via Twilio SMS
 * Supports:
 * - Instant alerts for high-urgency signals
 * - Batched digests for lower priority
 * - Smart throttling to prevent spam
 */

import { logger } from './logger';
import type { SPXSignal } from './spx-session-scanner';
import type { ORBBreakout } from './spx-orb-scanner';

// ============================================
// TYPES
// ============================================

export interface SMSConfig {
  enabled: boolean;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  userPhoneNumber: string;
  minConfidence: number;       // Min confidence to send alert (default: 65)
  urgencyFilter: ('HIGH' | 'MEDIUM' | 'LOW')[]; // Which urgencies to alert
  quietHoursStart?: number;    // Hour to stop alerts (e.g., 20 = 8pm)
  quietHoursEnd?: number;      // Hour to resume alerts (e.g., 8 = 8am)
  maxAlertsPerHour: number;    // Throttle limit
  batchLowPriority: boolean;   // Batch low priority alerts
}

interface SentAlert {
  signalId: string;
  sentAt: Date;
  symbol: string;
  strategy: string;
}

// ============================================
// STATE
// ============================================

const defaultConfig: SMSConfig = {
  enabled: false,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  userPhoneNumber: process.env.USER_PHONE_NUMBER || '',
  minConfidence: 65,
  urgencyFilter: ['HIGH', 'MEDIUM'],
  quietHoursStart: 21, // 9pm ET
  quietHoursEnd: 8,    // 8am ET
  maxAlertsPerHour: 10,
  batchLowPriority: true,
};

let config: SMSConfig = { ...defaultConfig };
const sentAlerts: SentAlert[] = [];
const pendingBatch: (SPXSignal | ORBBreakout)[] = [];
let batchTimeout: NodeJS.Timeout | null = null;

// ============================================
// HELPERS
// ============================================

function getETTime(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isQuietHours(): boolean {
  if (!config.quietHoursStart || !config.quietHoursEnd) return false;

  const et = getETTime();
  const hour = et.getHours();

  // Handle overnight quiet hours (e.g., 9pm to 8am)
  if (config.quietHoursStart > config.quietHoursEnd) {
    return hour >= config.quietHoursStart || hour < config.quietHoursEnd;
  }

  return hour >= config.quietHoursStart && hour < config.quietHoursEnd;
}

function getAlertsLastHour(): number {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return sentAlerts.filter(a => a.sentAt > oneHourAgo).length;
}

function isAlreadySent(signalId: string): boolean {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  return sentAlerts.some(a => a.signalId === signalId && a.sentAt > tenMinutesAgo);
}

function cleanOldAlerts(): void {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const index = sentAlerts.findIndex(a => a.sentAt > twoHoursAgo);
  if (index > 0) {
    sentAlerts.splice(0, index);
  }
}

// ============================================
// SMS FORMATTING
// ============================================

function formatSPXSignal(signal: SPXSignal): string {
  const emoji = signal.direction === 'LONG' ? '📈' : '📉';
  const optionEmoji = signal.optionType === 'call' ? '🟢' : '🔴';

  return `${emoji} ${signal.symbol} ${signal.strategy}

${signal.direction} @ $${signal.currentPrice.toFixed(2)}

${optionEmoji} ${signal.optionType.toUpperCase()} $${signal.suggestedStrike} (${signal.suggestedExpiry})

Entry: $${signal.entry.toFixed(2)}
Stop: $${signal.stop.toFixed(2)}
T1: $${signal.target1.toFixed(2)}
T2: $${signal.target2.toFixed(2)}

Confidence: ${signal.confidence}%
VIX: ${signal.vix.toFixed(1)}
${signal.timeRemaining} to close

${signal.thesis.substring(0, 100)}${signal.thesis.length > 100 ? '...' : ''}`;
}

function formatORBBreakout(breakout: ORBBreakout): string {
  const emoji = breakout.direction === 'LONG' ? '📈' : '📉';
  const optionEmoji = breakout.optionType === 'call' ? '🟢' : '🔴';

  return `${emoji} ORB BREAKOUT: ${breakout.symbol}

${breakout.direction} ${breakout.timeframe} Range Break

${optionEmoji} ${breakout.optionType.toUpperCase()} $${breakout.suggestedStrike} (${breakout.suggestedExpiry})

Range: $${breakout.rangeLow.toFixed(2)} - $${breakout.rangeHigh.toFixed(2)}
Entry: $${breakout.entry.toFixed(2)}
Stop: $${breakout.stop.toFixed(2)}
T1: $${breakout.target1.toFixed(2)}
R:R ${breakout.riskReward}

Confidence: ${breakout.confidence}%
VOL: ${breakout.volumeScore} | FLOW: ${breakout.flowScore}

${breakout.thesis.substring(0, 100)}${breakout.thesis.length > 100 ? '...' : ''}`;
}

function formatBatchDigest(signals: (SPXSignal | ORBBreakout)[]): string {
  const et = getETTime();

  let message = `📊 SPX Alert Digest (${et.toLocaleTimeString()})\n\n`;
  message += `${signals.length} signals:\n\n`;

  for (const signal of signals.slice(0, 5)) { // Max 5 in digest
    if ('strategy' in signal) {
      // SPXSignal
      message += `• ${signal.symbol} ${signal.direction} (${signal.strategy}) - ${signal.confidence}%\n`;
    } else {
      // ORBBreakout
      message += `• ${signal.symbol} ORB ${signal.direction} - ${signal.confidence}%\n`;
    }
  }

  if (signals.length > 5) {
    message += `\n... and ${signals.length - 5} more`;
  }

  return message;
}

// ============================================
// TWILIO INTEGRATION
// ============================================

async function sendTwilioSMS(message: string): Promise<boolean> {
  if (!config.enabled) {
    logger.debug('[SMS] Service disabled - not sending');
    return false;
  }

  if (!config.twilioAccountSid || !config.twilioAuthToken || !config.twilioFromNumber || !config.userPhoneNumber) {
    logger.warn('[SMS] Missing Twilio credentials - cannot send');
    return false;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;

    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');

    const body = new URLSearchParams({
      To: config.userPhoneNumber,
      From: config.twilioFromNumber,
      Body: message,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[SMS] Twilio error: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();
    logger.info(`[SMS] ✅ Message sent: ${result.sid}`);
    return true;
  } catch (error) {
    logger.error('[SMS] Failed to send:', error);
    return false;
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Configure SMS notifications
 */
export function configureSMS(newConfig: Partial<SMSConfig>): void {
  config = { ...config, ...newConfig };
  logger.info(`[SMS] Configuration updated. Enabled: ${config.enabled}, Phone: ${config.userPhoneNumber ? '****' + config.userPhoneNumber.slice(-4) : 'not set'}`);
}

/**
 * Get current SMS configuration (masked)
 */
export function getSMSConfig(): Omit<SMSConfig, 'twilioAuthToken'> & { twilioAuthToken: string } {
  return {
    ...config,
    twilioAccountSid: config.twilioAccountSid ? '****' + config.twilioAccountSid.slice(-4) : '',
    twilioAuthToken: config.twilioAuthToken ? '********' : '',
    userPhoneNumber: config.userPhoneNumber ? '****' + config.userPhoneNumber.slice(-4) : '',
  };
}

/**
 * Send alert for SPX Session signal
 */
export async function sendSPXAlert(signal: SPXSignal): Promise<boolean> {
  cleanOldAlerts();

  // Check if should send
  if (!config.enabled) return false;
  if (isQuietHours()) {
    logger.debug(`[SMS] Quiet hours - skipping alert for ${signal.symbol}`);
    return false;
  }
  if (signal.confidence < config.minConfidence) {
    logger.debug(`[SMS] Confidence ${signal.confidence}% below threshold ${config.minConfidence}% - skipping`);
    return false;
  }
  if (isAlreadySent(signal.id)) {
    logger.debug(`[SMS] Signal ${signal.id} already sent - skipping`);
    return false;
  }
  if (getAlertsLastHour() >= config.maxAlertsPerHour) {
    logger.warn(`[SMS] Throttle limit reached (${config.maxAlertsPerHour}/hour) - skipping`);
    return false;
  }

  // Check urgency filter
  if (!config.urgencyFilter.includes(signal.urgency)) {
    // Low priority - batch if enabled
    if (config.batchLowPriority && signal.urgency === 'LOW') {
      pendingBatch.push(signal);
      scheduleBatchSend();
      return false;
    }
    return false;
  }

  // Format and send
  const message = formatSPXSignal(signal);
  const sent = await sendTwilioSMS(message);

  if (sent) {
    sentAlerts.push({
      signalId: signal.id,
      sentAt: new Date(),
      symbol: signal.symbol,
      strategy: signal.strategy,
    });
  }

  return sent;
}

/**
 * Send alert for ORB Breakout
 */
export async function sendORBAlert(breakout: ORBBreakout): Promise<boolean> {
  cleanOldAlerts();

  if (!config.enabled) return false;
  if (isQuietHours()) return false;
  if (breakout.confidence < config.minConfidence) return false;
  if (isAlreadySent(breakout.id)) return false;
  if (getAlertsLastHour() >= config.maxAlertsPerHour) return false;

  const message = formatORBBreakout(breakout);
  const sent = await sendTwilioSMS(message);

  if (sent) {
    sentAlerts.push({
      signalId: breakout.id,
      sentAt: new Date(),
      symbol: breakout.symbol,
      strategy: 'ORB_BREAKOUT',
    });
  }

  return sent;
}

/**
 * Send batch digest of low-priority alerts
 */
function scheduleBatchSend(): void {
  if (batchTimeout) return; // Already scheduled

  // Send batch after 5 minutes
  batchTimeout = setTimeout(async () => {
    if (pendingBatch.length > 0) {
      const message = formatBatchDigest(pendingBatch);
      await sendTwilioSMS(message);
      pendingBatch.length = 0;
    }
    batchTimeout = null;
  }, 5 * 60 * 1000);
}

/**
 * Send custom alert message
 */
export async function sendCustomAlert(message: string): Promise<boolean> {
  if (!config.enabled) return false;
  if (isQuietHours()) return false;
  if (getAlertsLastHour() >= config.maxAlertsPerHour) return false;

  return sendTwilioSMS(message);
}

/**
 * Test SMS configuration
 */
export async function testSMS(): Promise<{ success: boolean; error?: string }> {
  const testMessage = `🧪 QuantEdge SMS Test

Your phone alerts are working!

Time: ${new Date().toLocaleTimeString()}
Config: ✅ Verified`;

  try {
    const sent = await sendTwilioSMS(testMessage);
    return { success: sent };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get alert statistics
 */
export function getAlertStats(): {
  alertsLastHour: number;
  alertsToday: number;
  pendingBatch: number;
  isQuietHours: boolean;
  enabled: boolean;
} {
  const today = new Date().toISOString().split('T')[0];
  const alertsToday = sentAlerts.filter(a =>
    a.sentAt.toISOString().split('T')[0] === today
  ).length;

  return {
    alertsLastHour: getAlertsLastHour(),
    alertsToday,
    pendingBatch: pendingBatch.length,
    isQuietHours: isQuietHours(),
    enabled: config.enabled,
  };
}

/**
 * Initialize SMS service from environment
 */
export function initSMSService(): void {
  const envConfig: Partial<SMSConfig> = {
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER,
    userPhoneNumber: process.env.USER_PHONE_NUMBER,
    enabled: process.env.SMS_ALERTS_ENABLED === 'true',
  };

  configureSMS(envConfig);

  if (config.enabled) {
    logger.info('[SMS] ✅ SMS notification service initialized');
  } else {
    logger.info('[SMS] SMS notifications disabled (set SMS_ALERTS_ENABLED=true to enable)');
  }
}

// ============================================
// POSITION ALERTS (Stop Loss / Take Profit)
// ============================================

export interface PositionAlertData {
  type: 'stop_loss' | 'profit_target' | 'bag_hold' | 'expiry_warning';
  symbol: string;
  underlying: string;
  plPercent: number;
  currentPrice: number;
  avgCost: number;
  quantity: number;
  message: string;
}

/**
 * Send alert for position events (stop loss, take profit, bag hold)
 */
export async function sendPositionAlert(data: PositionAlertData): Promise<boolean> {
  if (!config.enabled) return false;

  // Position alerts bypass quiet hours for stop loss and bag hold
  const isCritical = data.type === 'stop_loss' || data.type === 'bag_hold';
  if (!isCritical && isQuietHours()) return false;

  // Format message with emoji based on type
  let emoji = '';
  switch (data.type) {
    case 'stop_loss': emoji = '🚨'; break;
    case 'profit_target': emoji = '💰'; break;
    case 'bag_hold': emoji = '💀'; break;
    case 'expiry_warning': emoji = '⏰'; break;
  }

  const fullMessage = `${emoji} POSITION ALERT

${data.message}

Symbol: ${data.underlying}
P/L: ${data.plPercent >= 0 ? '+' : ''}${data.plPercent.toFixed(1)}%
Current: $${data.currentPrice.toFixed(2)}
Avg Cost: $${data.avgCost.toFixed(2)}
Qty: ${data.quantity}

${data.type === 'stop_loss' ? '⚠️ CUT THE LOSS NOW' : ''}
${data.type === 'profit_target' ? '✅ Consider taking profits' : ''}`;

  logger.info(`[SMS] Sending ${data.type} alert for ${data.symbol}`);
  return sendTwilioSMS(fullMessage);
}

export default {
  configureSMS,
  getSMSConfig,
  sendSPXAlert,
  sendORBAlert,
  sendCustomAlert,
  sendPositionAlert,
  testSMS,
  getAlertStats,
  initSMSService,
};
