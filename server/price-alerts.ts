/**
 * Level-cross alerts — "tell me when X trades through P".
 *
 * File-backed like the discipline ledger (survives restarts, no DB quota).
 * A checker sweeps armed alerts against real quotes every few minutes during
 * market hours; a cross fires one Discord line through the existing alert
 * sender and the alert converts to triggered — it never fires twice.
 * Direction is inferred at creation from the live price ('above' when armed
 * below the level, 'below' otherwise) so the alert means "crossed", not
 * "is beyond" — an alert created already-beyond would fire instantly and
 * mean nothing.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger';

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  direction: 'above' | 'below';
  createdAt: string;
  triggeredAt?: string;
  triggeredPrice?: number;
}

const DIR = path.join(process.cwd(), 'server', 'data');
const FILE = path.join(DIR, 'price-alerts.jsonl');
let loaded = false;
let alerts: PriceAlert[] = [];

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { alerts.push(JSON.parse(line)); } catch { /* skip corrupt */ }
    }
  } catch { /* none yet */ }
}

async function persistAll() {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(FILE, alerts.map((a) => JSON.stringify(a)).join('\n') + (alerts.length ? '\n' : ''), 'utf8');
}

export async function addAlert(symbol: string, price: number, currentPrice: number | null): Promise<PriceAlert> {
  await load();
  const direction: 'above' | 'below' =
    currentPrice != null && Number.isFinite(currentPrice) ? (currentPrice < price ? 'above' : 'below') : 'above';
  const alert: PriceAlert = {
    id: `${symbol}-${Date.now().toString(36)}`,
    symbol: symbol.toUpperCase(),
    price,
    direction,
    createdAt: new Date().toISOString(),
  };
  alerts.push(alert);
  await persistAll();
  logger.info(`[PRICE-ALERT] armed ${alert.symbol} ${direction} $${price}`);
  try {
    const { pulse } = await import('./system-pulse');
    pulse('alert', `alert armed: ${alert.symbol} crossing ${direction} $${price}`);
  } catch { /* pulse is decoration */ }
  return alert;
}

export async function listAlerts(): Promise<PriceAlert[]> {
  await load();
  return [...alerts];
}

export async function removeAlert(id: string): Promise<boolean> {
  await load();
  const n = alerts.length;
  alerts = alerts.filter((a) => a.id !== id);
  if (alerts.length !== n) await persistAll();
  return alerts.length !== n;
}

/** Sweep armed alerts against real quotes; fire + mark on cross. */
export async function checkAlerts(): Promise<number> {
  await load();
  const armed = alerts.filter((a) => !a.triggeredAt);
  if (!armed.length) return 0;
  let fired = 0;
  try {
    const { getRealtimeBatchQuotes } = await import('./realtime-pricing-service');
    const symbols = Array.from(new Set(armed.map((a) => a.symbol)));
    const quotes = await getRealtimeBatchQuotes(symbols.map((symbol) => ({ symbol, assetType: 'stock' as const })));
    const lines: string[] = [];
    for (const a of armed) {
      const q = quotes.get(a.symbol);
      const px = Number((q as any)?.price);
      if (!Number.isFinite(px) || px <= 0) continue;
      const crossed = a.direction === 'above' ? px >= a.price : px <= a.price;
      if (!crossed) continue;
      a.triggeredAt = new Date().toISOString();
      a.triggeredPrice = px;
      fired++;
      lines.push(`🔔 **${a.symbol}** crossed ${a.direction} $${a.price} — now $${px.toFixed(2)}`);
      logger.info(`[PRICE-ALERT] fired ${a.symbol} ${a.direction} $${a.price} @ $${px.toFixed(2)}`);
      try {
        const { pulse } = await import('./system-pulse');
        pulse('alert', `🔔 ${a.symbol} crossed ${a.direction} $${a.price} — now $${px.toFixed(2)}`);
      } catch { /* pulse is decoration */ }
    }
    if (fired) {
      await persistAll();
      try {
        const { sendDiscordAlert } = await import('./discord-service');
        await sendDiscordAlert(lines.join('\n'), 'info');
      } catch (err) {
        logger.warn('[PRICE-ALERT] discord relay failed (alert still recorded):', err);
      }
    }
  } catch (err) {
    logger.warn('[PRICE-ALERT] sweep failed:', err);
  }
  return fired;
}
