/**
 * THESIS RADAR — Discord Webhook
 * ================================
 * Pushes structured Radar alerts to Discord (or any webhook-shaped endpoint).
 *
 * Mirrors the RiskyBisksy "Setup Forming" alert format:
 *   📡 SETUP FORMING: ASML 🟢 LONG
 *   $1447.30 — Coiling before a potential move.
 *   📊 BB Width  9.8%
 *   📉 Vol Dry-Up  2d declining
 *   ⚡ Energy  72/100
 *   📈 ADX  22 (pre-breakout)
 *   🏗 Structure  RANGE
 *   📌 ATR Ratio  0.94
 *   🔍 Reason  BB squeeze | Vol dry-up
 *   ⏳ Trigger  Volume spike + close above BB upper
 *   ⚠ Status  CONFIRMED ENTRY fires when flow aligns
 *
 * Two firing modes:
 *   - FORMING  → "watching" — coil detected, no entry yet
 *   - CONFIRMED → "fire" — trigger hit, push to Trade Desk + alert
 *
 * Webhook URL is read from env (RADAR_WEBHOOK_URL or ERROR_WEBHOOK_URL fallback).
 * If neither set, alerts log to console only — no crash.
 *
 * The payload uses Discord embed format. For Slack-compat, set
 * RADAR_WEBHOOK_FORMAT=slack and we'll translate.
 */

import { logger } from '../logger';
import type { DiscordRadarAlert, RadarPick } from '@shared/thesis-radar-types';

// ─── Env config ─────────────────────────────────────────────────────

function getWebhookUrl(): string | null {
  return (
    process.env.RADAR_WEBHOOK_URL ??
    process.env.ERROR_WEBHOOK_URL ??
    null
  );
}

function getFormat(): 'discord' | 'slack' {
  return process.env.RADAR_WEBHOOK_FORMAT === 'slack' ? 'slack' : 'discord';
}

// ─── Color codes per alert type ────────────────────────────────────

const TYPE_COLORS: Record<DiscordRadarAlert['type'], number> = {
  forming: 0xfbbf24,      // amber — watch
  confirmed: 0x10b981,    // green — fire
  invalidated: 0xef4444,  // red — stopped
};

const TYPE_EMOJI: Record<DiscordRadarAlert['type'], string> = {
  forming: '📡',
  confirmed: '✅',
  invalidated: '❌',
};

// ─── Discord embed builder ─────────────────────────────────────────

function buildDiscordEmbed(alert: DiscordRadarAlert): unknown {
  const fields = alert.signalBlock.map(b => ({
    name: `${b.emoji ?? ''} ${b.label}`.trim(),
    value: '`' + b.value + '`',
    inline: true,
  }));

  // Pad to a multiple of 3 for clean Discord layout
  while (fields.length % 3 !== 0) {
    fields.push({ name: '​', value: '​', inline: true });
  }

  const stateLine = `**Status:** ${alert.status}`;
  const triggerLine = alert.trigger ? `**Trigger:** ${alert.trigger}` : '';
  const reasonLine = `**Reason:** ${alert.reason}`;
  const description = [
    `**$${alert.spot.toFixed(2)}** — ${alert.pattern}`,
    '',
    reasonLine,
    triggerLine,
    stateLine,
    alert.disclaimer ? `\n_${alert.disclaimer}_` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    username: 'QuantEdge Radar',
    embeds: [
      {
        title: `${TYPE_EMOJI[alert.type]} ${alert.type.toUpperCase()}: ${alert.symbol}`,
        description,
        color: TYPE_COLORS[alert.type],
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Thesis Radar · QuantEdge' },
      },
    ],
  };
}

// ─── Slack-compat builder ──────────────────────────────────────────

function buildSlackBlocks(alert: DiscordRadarAlert): unknown {
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${TYPE_EMOJI[alert.type]} ${alert.type.toUpperCase()}: ${alert.symbol}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*$${alert.spot.toFixed(2)}* — ${alert.pattern}\n_${alert.reason}_` },
    },
  ];

  // Signal block as fields (Slack limit 10 fields per section)
  for (let i = 0; i < alert.signalBlock.length; i += 10) {
    blocks.push({
      type: 'section',
      fields: alert.signalBlock.slice(i, i + 10).map(b => ({
        type: 'mrkdwn',
        text: `*${b.emoji ?? ''} ${b.label}*\n\`${b.value}\``,
      })),
    });
  }

  if (alert.trigger) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Trigger:* ${alert.trigger}` } });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Thesis Radar · ${alert.status}` }] });

  return { blocks };
}

// ─── Push ──────────────────────────────────────────────────────────

export async function pushAlert(alert: DiscordRadarAlert): Promise<{ ok: boolean; reason?: string }> {
  const url = getWebhookUrl();
  if (!url) {
    logger.info(
      `[RADAR-WEBHOOK] No webhook configured (RADAR_WEBHOOK_URL / ERROR_WEBHOOK_URL). Alert: ${alert.type} ${alert.symbol}`,
    );
    return { ok: false, reason: 'no_webhook_configured' };
  }

  const payload = getFormat() === 'slack' ? buildSlackBlocks(alert) : buildDiscordEmbed(alert);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(`[RADAR-WEBHOOK] Push failed ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, reason: `http_${res.status}` };
    }
    logger.info(`[RADAR-WEBHOOK] ✅ ${alert.type} alert pushed for ${alert.symbol}`);
    return { ok: true };
  } catch (e) {
    logger.warn(`[RADAR-WEBHOOK] Network error: ${(e as Error).message}`);
    return { ok: false, reason: 'network_error' };
  }
}

// ─── Convenience: build alert from a RadarPick ─────────────────────

export function alertFromPick(pick: RadarPick, type: DiscordRadarAlert['type'] = 'forming'): DiscordRadarAlert {
  const signalBlock = pick.signals.slice(0, 9).map(s => ({
    label: s.source.replace(/_/g, ' ').toUpperCase(),
    value: `${s.grade} (${s.score})`,
    emoji: signalEmoji(s.source),
  }));

  return {
    type,
    symbol: pick.symbol,
    pattern: pick.synthesis,
    spot: pick.spotAtFire,
    signalBlock,
    reason: pick.signals
      .filter(s => s.score >= 70)
      .slice(0, 3)
      .map(s => s.label)
      .join(' · ') || pick.synthesis,
    trigger: pick.trigger,
    status: type === 'forming'
      ? 'CONFIRMED ENTRY fires when trigger hits'
      : type === 'confirmed'
      ? 'Entry triggered — Trade Desk idea created'
      : 'Setup invalidated',
    disclaimer:
      type === 'forming'
        ? 'NOT a trade signal — await CONFIRMED ENTRY before risking capital.'
        : undefined,
  };
}

function signalEmoji(source: string): string {
  const map: Record<string, string> = {
    options_flow: '📊',
    unusual_activity: '🚨',
    price_action: '📈',
    news_nlp: '📰',
    iv_skew: '🌡',
    analyst_ratings: '🎯',
    institutional_flow: '🏦',
    sector_rotation: '🔄',
    gex_positioning: '⚡',
    earnings_history: '📅',
    insider_filings: '🧑‍💼',
    macd: '〽️',
    rsi: '📐',
    sma_ema: '➿',
    volume_profile: '📊',
    social_sentiment: '💬',
    aggregate: '🧮',
  };
  return map[source] ?? '•';
}
