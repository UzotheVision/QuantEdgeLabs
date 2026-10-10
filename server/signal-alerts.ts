/**
 * ORACLE SIGNAL ALERTS — tell you when the board publishes something, once.
 *
 * The board has been publishing silently. sendTradeIdeaToDiscord existed but was
 * only ever called from manual API routes, so a signal firing at 9:50am reached
 * nobody unless somebody happened to have the page open — which is exactly how a
 * setup gets found hours after the entry was good.
 *
 * The hard part is not sending; it is not sending twice. A conviction rebuild
 * re-emits the same picks on every cycle, so alerting on "what the board returned"
 * would fire the same signal every fifteen minutes until it aged out. Alerts are
 * therefore keyed on the IDEA ID, and a sent key is remembered.
 */
import { logger } from './logger';
import { signalKey } from '@shared/signal-continuity';
import { marketDateET } from '@shared/market-day';
import { convictionDisplayPercent } from '@shared/conviction-display';

/** Ideas already announced. Keyed by idea id, cleared daily. */
let _sent = new Set<string>();
let _sentDay = marketDateET();

/** Only announce setups worth interrupting someone for. */
const MIN_CONVICTION = 22;

export interface AlertablePick {
  ideaId?: string;
  symbol: string;
  direction: string;
  convictionScore: number;
  convictionBand: string;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  riskRewardRatio?: number | null;
  optionType?: string | null;
  strikePrice?: number | null;
  expiryDate?: string | null;
  entryPremium?: number | null;
  thesis?: string | null;
  layers?: { why?: string; points: number }[];
  generatedAt?: string;
}

function rollDay(): void {
  const today = marketDateET();
  if (today !== _sentDay) {
    _sent = new Set();
    _sentDay = today;
    logger.info('[SIGNAL-ALERTS] new session — alert memory cleared');
  }
}

// Keyed on the THESIS, not the row. The old key used ideaId (a fresh uuid every
// scan) and generatedAt (a fresh timestamp every scan), so dedupe never matched
// across cycles and the same standing CRCL long re-announced itself all day. See
// shared/signal-continuity.ts. Still in-memory, so a restart re-arms it — that is
// the remaining gap, and it needs a persisted table to close properly.
export async function alertNewSignals(picks: AlertablePick[]): Promise<number> {
  rollDay();
  if (!picks?.length) return 0;

  const fresh = picks.filter((p) => {
    const key = signalKey({
      symbol: p.symbol,
      direction: p.direction as 'long' | 'short',
      optionType: p.optionType as 'call' | 'put' | null | undefined,
      strikePrice: p.strikePrice,
      expiryDate: p.expiryDate,
    });
    if (!key || _sent.has(key)) return false;
    if ((p.convictionScore ?? 0) < MIN_CONVICTION) return false;
    return true;
  });

  if (!fresh.length) return 0;

  let sentCount = 0;
  for (const p of fresh) {
    const key = signalKey({
      symbol: p.symbol,
      direction: p.direction as 'long' | 'short',
      optionType: p.optionType as 'call' | 'put' | null | undefined,
      strikePrice: p.strikePrice,
      expiryDate: p.expiryDate,
    });
    // Mark BEFORE sending. A send that throws halfway must not re-fire on the next
    // cycle — a duplicate alert is worse than a missed one, because it trains you
    // to ignore the channel.
    _sent.add(key);

    try {
      const { sendTradeIdeaToDiscord } = await import('./discord-service');
      // The engine emits confluence points while Discord grades on 0–100.
      // Passing raw points made an S/A Oracle call look like an F and vanish.
      await sendTradeIdeaToDiscord({
        symbol: p.symbol,
        direction: p.direction,
        entryPrice: p.entryPrice,
        targetPrice: p.targetPrice,
        stopLoss: p.stopLoss,
        confidenceScore: convictionDisplayPercent(p.convictionScore),
        riskRewardRatio: p.riskRewardRatio ?? undefined,
        optionType: p.optionType ?? undefined,
        strikePrice: p.strikePrice ?? undefined,
        expiryDate: p.expiryDate ?? undefined,
        entryPremium: p.entryPremium ?? undefined,
        analysis: p.thesis ?? undefined,
        source: 'oracle-signal',
        catalyst: (p.layers ?? []).filter((l) => l.points > 0).slice(0, 3).map((l) => l.why).filter(Boolean).join(' · '),
      } as any);
      sentCount++;
    } catch (err: any) {
      logger.warn(`[SIGNAL-ALERTS] ${p.symbol} failed: ${err?.message ?? err}`);
    }
  }

  if (sentCount) logger.info(`[SIGNAL-ALERTS] announced ${sentCount} new signal(s)`);
  return sentCount;
}

/** For diagnostics — how many have been announced this session. */
export function alertedToday(): number {
  rollDay();
  return _sent.size;
}
