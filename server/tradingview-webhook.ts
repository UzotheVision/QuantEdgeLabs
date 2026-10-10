/**
 * TradingView Webhook Service
 * ===========================
 * Receives signals from TradingView strategy alerts (v15/v15B),
 * enriches with Tradier options data, creates trade ideas,
 * and sends Discord alerts.
 *
 * Flow: TV Alert → Webhook POST → Enrich → Trade Idea → Discord
 */

import { logger } from './logger';
import { getTradierQuote, getTradierOptionsChainsByDTE } from './tradier-api';
import { isLottoCandidate, calculateLottoTargets } from './lotto-detector';
import { sendTradeIdeaToDiscord } from './discord-service';
import { createHash, timingSafeEqual } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface TVWebhookPayload {
  secret?: string;
  ticker?: string;
  symbol?: string;
  exchange?: string;
  direction?: 'long' | 'short' | 'buy' | 'sell' | 'bullish' | 'bearish';
  action?: string;
  side?: string;
  price?: number | string;
  close?: number | string;
  entry?: number | string;
  stop?: number | string;
  target?: number | string;
  t1?: number | string;
  t2?: number | string;
  strategy?: string;       // e.g. "v15", "v15B"
  timeframe?: string;      // e.g. "15", "60"
  confidence?: string | number; // "high", "medium", "low" or 0-100
  signal_type?: string;    // "reversal", "breakout", "breakdown"
  message?: string;        // TradingView {{strategy.order.comment}}
  event?: 'entry' | 'exit' | 'update' | string;
  signal_id?: string;
  bar_time?: string | number;
  timestamp?: string | number;
  confirmed?: boolean | string;
  expiry_tier?: string;
  dte?: number | string;
  account_size?: number | string;
  risk_budget?: number | string;
  max_debit?: number | string;
}

export interface NormalizedTVSignal {
  secret: string;
  rawTicker: string;
  symbol: string;
  exchange?: string;
  direction: 'long' | 'short';
  price: number;
  entry: number;
  stop?: number;
  target?: number;
  t2?: number;
  strategy: string;
  timeframe: string;
  confidence: number;
  signalType: string;
  message: string;
  event: 'entry' | 'exit' | 'update';
  signalId: string;
  barTime?: string;
  confirmed: boolean;
  isZeroDte: boolean;
  accountSize: number;
  riskBudget: number;
  maxDebit: number;
  strategyFamily: 'index_closing_drive' | 'generic';
}

// Rate limiting
const recentSignals = new Map<string, number>();
const MAX_SIGNALS_PER_MIN = 10;
const SIGNAL_COOLDOWN_MS = 30 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateWebhookSecret(secret: string): boolean {
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!expected) {
    logger.error('[TV-WEBHOOK] TRADINGVIEW_WEBHOOK_SECRET not configured');
    return false;
  }
  const supplied = Buffer.from(String(secret));
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

function isRateLimited(signalId: string): boolean {
  const now = Date.now();
  const lastSignal = recentSignals.get(signalId);
  if (lastSignal && now - lastSignal < SIGNAL_COOLDOWN_MS) {
    return true;
  }

  // Global rate limit
  const recentCount = Array.from(recentSignals.values()).filter(t => now - t < 60_000).length;
  if (recentCount >= MAX_SIGNALS_PER_MIN) {
    return true;
  }

  return false;
}

function normalizeDirection(dir: string): 'long' | 'short' {
  const d = dir.toLowerCase();
  if (d === 'buy' || d === 'long' || d === 'bullish' || d === 'call') return 'long';
  return 'short';
}

const SPX_ALIASES = new Set(['SPX', 'SPX500', 'SPX500USD', 'US500', 'US500USD', 'SPXUSD', 'GSPC']);

export function normalizeTradingViewSymbol(raw: string): string {
  const withoutExchange = raw.trim().toUpperCase().split(':').pop() || '';
  const compact = withoutExchange.replace(/^\^/, '').replace(/[^A-Z0-9.-]/g, '');
  return SPX_ALIASES.has(compact) ? 'SPX' : compact;
}

function finiteNumber(value: unknown): number | undefined {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(100, value));
  const numeric = finiteNumber(value);
  if (numeric != null) return Math.max(0, Math.min(100, numeric));
  const label = String(value || 'medium').toLowerCase();
  return label === 'high' ? 85 : label === 'low' ? 65 : 75;
}

function parseEvent(payload: TVWebhookPayload): 'entry' | 'exit' | 'update' {
  const explicit = String(payload.event || '').toLowerCase();
  if (explicit === 'exit' || explicit === 'close') return 'exit';
  if (explicit === 'update') return 'update';
  const message = String(payload.message || '').toUpperCase().trim();
  if (/^(SL|TP|TRAIL|TIME|MAXHOLD|EXIT|CLOSE|STOP)(\b|\+)/.test(message)) return 'exit';
  return 'entry';
}

function parseTimestamp(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    const ms = n > 10_000_000_000 ? n : n * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function makeSignalId(parts: Array<string | number | undefined>): string {
  return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 24);
}

/**
 * Accept the common field names emitted by Pine indicators and strategies,
 * then turn them into one strict internal contract. A chart alert is evidence,
 * not an executable quote: SPX/0DTE must include its actual entry, stop and T1.
 */
export function normalizeTradingViewPayload(payload: TVWebhookPayload):
  { ok: true; signal: NormalizedTVSignal } | { ok: false; error: string } {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'JSON object required' };

  const rawTicker = String(payload.ticker || payload.symbol || '').trim();
  const symbol = normalizeTradingViewSymbol(rawTicker);
  if (!symbol) return { ok: false, error: 'Missing ticker/symbol' };

  const rawDirection = String(payload.direction || payload.side || payload.action || '').toLowerCase();
  if (!/^(long|short|buy|sell|bullish|bearish|call|put)$/.test(rawDirection)) {
    return { ok: false, error: 'Direction must be long/short, buy/sell, bullish/bearish, or call/put' };
  }
  const direction = normalizeDirection(rawDirection);
  const price = finiteNumber(payload.price ?? payload.close ?? payload.entry);
  const entry = finiteNumber(payload.entry) ?? price;
  if (!(price && price > 0) || !(entry && entry > 0)) return { ok: false, error: 'A positive price/close or entry is required' };

  const stop = finiteNumber(payload.stop);
  const target = finiteNumber(payload.target ?? payload.t1);
  const t2 = finiteNumber(payload.t2);
  const strategy = String(payload.strategy || 'tradingview').trim().slice(0, 80);
  const timeframe = String(payload.timeframe || '').trim().slice(0, 20);
  const signalType = String(payload.signal_type || 'signal').trim().slice(0, 80);
  const message = String(payload.message || '').trim().slice(0, 1_000);
  const event = parseEvent(payload);
  const requestedDte = finiteNumber(payload.dte);
  const isZeroDte = requestedDte === 0 || String(payload.expiry_tier || '').toUpperCase() === '0DTE' || /0DTE|LOTTO/.test(`${strategy} ${message}`.toUpperCase());
  const strategyFamily = /CLOSING[ _-]?DRIVE|EOD[ _-]?(?:SPX|INDEX|DRIVE)|POWER[ _-]?HOUR/.test(
    `${strategy} ${signalType} ${message}`.toUpperCase(),
  ) ? 'index_closing_drive' : 'generic';

  if (event === 'entry' && isZeroDte && symbol === 'SPX') {
    if (!(stop && stop > 0 && target && target > 0)) {
      return { ok: false, error: 'SPX 0DTE requires explicit entry, stop, and target/t1 from the Pine script' };
    }
    const geometryIsValid = direction === 'long'
      ? stop < entry && target > entry
      : stop > entry && target < entry;
    if (!geometryIsValid) return { ok: false, error: `Stop/T1 do not point ${direction === 'long' ? 'up' : 'down'} from entry` };
    if (timeframe && !/^(1|2|3|5|10|15|30|45|60|[1-9][0-9]*S)$/i.test(timeframe)) {
      return { ok: false, error: `SPX 0DTE requires an intraday timeframe, received ${timeframe}` };
    }
  }

  const barDate = parseTimestamp(payload.bar_time ?? payload.timestamp);
  if (isZeroDte && barDate && Math.abs(Date.now() - barDate.getTime()) > 15 * 60_000) {
    return { ok: false, error: 'Stale 0DTE alert (older than 15 minutes)' };
  }
  const confirmed = payload.confirmed == null
    ? true
    : payload.confirmed === true || String(payload.confirmed).toLowerCase() === 'true';
  if (isZeroDte && event === 'entry' && !confirmed) return { ok: false, error: 'Unconfirmed intrabar 0DTE alert rejected' };

  const signalId = String(payload.signal_id || makeSignalId([
    strategy, symbol, direction, timeframe, barDate?.toISOString(), entry, signalType,
  ])).slice(0, 120);

  return {
    ok: true,
    signal: {
      secret: String(payload.secret || ''), rawTicker, symbol, exchange: payload.exchange,
      direction, price, entry, stop, target, t2, strategy, timeframe,
      confidence: normalizeConfidence(payload.confidence), signalType, message,
      event, signalId, barTime: barDate?.toISOString(), confirmed, isZeroDte,
      accountSize: Math.max(100, finiteNumber(payload.account_size) ?? Number(process.env.INDEX_0DTE_ACCOUNT_SIZE ?? 10_000)),
      riskBudget: Math.max(10, finiteNumber(payload.risk_budget) ?? Number(process.env.INDEX_0DTE_RISK_BUDGET ?? 250)),
      maxDebit: Math.max(10, finiteNumber(payload.max_debit) ?? Number(process.env.INDEX_0DTE_MAX_DEBIT ?? 300)),
      strategyFamily,
    },
  };
}

export function isTradingViewConfigured(): boolean {
  return Boolean(process.env.TRADINGVIEW_WEBHOOK_SECRET);
}

// ═══════════════════════════════════════════════════════════════
// OPTION SELECTION (from Tradier chain)
// ═══════════════════════════════════════════════════════════════

function isValidTradingDay(dateStr: string): boolean {
  const date = new Date(dateStr + 'T12:00:00Z');
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return true;
}

async function pickBestOption(symbol: string, direction: 'long' | 'short', stockPrice: number) {
  const chain = await getTradierOptionsChainsByDTE(symbol);
  if (!chain || chain.length === 0) return null;

  const optionType: 'call' | 'put' = direction === 'long' ? 'call' : 'put';
  const today = new Date().toISOString().split('T')[0];

  const candidates = chain
    .filter(opt => {
      if (opt.option_type !== optionType) return false;
      if (!opt.bid || opt.bid <= 0 || !opt.ask || opt.ask <= 0) return false;
      if (!isValidTradingDay(opt.expiration_date)) return false;
      // Skip 0DTE unless very cheap (lotto)
      const midPrice = (opt.bid + opt.ask) / 2;
      if (opt.expiration_date === today && midPrice > 0.50) return false;
      // Delta 0.20-0.45 (slightly wider for TV signals)
      const delta = opt.greeks?.delta ? Math.abs(opt.greeks.delta) : 0;
      if (delta < 0.20 || delta > 0.45) return false;
      return true;
    })
    .sort((a, b) => (b.volume || 0) - (a.volume || 0));

  if (candidates.length === 0) return null;

  const best = candidates[0];
  const midPrice = (best.bid + best.ask) / 2;
  const delta = best.greeks?.delta ? Math.abs(best.greeks.delta) : 0;
  const dte = Math.max(1, Math.ceil((new Date(best.expiration_date).getTime() - Date.now()) / 86400000));

  // Lotto check
  const isLotto = isLottoCandidate({
    lastPrice: midPrice,
    greeks: best.greeks,
    expiration: best.expiration_date,
    symbol: best.symbol,
  });

  let targetPremium: number;
  let stopPremium: number;

  if (isLotto) {
    const lottoTargets = calculateLottoTargets(midPrice, best.expiration_date);
    targetPremium = lottoTargets.targetPrice;
    stopPremium = 0.01;
  } else {
    // DTE-based targets matching options-enricher.ts pattern
    const mult = dte <= 3 ? 2.0 : dte <= 7 ? 1.75 : dte <= 14 ? 1.60 : 1.50;
    targetPremium = midPrice * mult;
    stopPremium = midPrice * 0.50;
  }

  const risk = midPrice - stopPremium;
  const reward = targetPremium - midPrice;
  const rr = risk > 0 ? reward / risk : 1;

  return {
    vehicleSymbol: symbol,
    levelScale: 1,
    optionType,
    strikePrice: best.strike,
    expiryDate: best.expiration_date,
    entryPremium: +midPrice.toFixed(2),
    targetPremium: +targetPremium.toFixed(2),
    stopPremium: +stopPremium.toFixed(2),
    riskRewardRatio: +rr.toFixed(2),
    delta: +delta.toFixed(2),
    dte,
    isLotto,
    iv: best.greeks?.mid_iv || 0,
    selectionNote: 'legacy TradingView chain selection',
  };
}

interface TVOptionSelection {
  vehicleSymbol: string;
  levelScale: number;
  optionType: 'call' | 'put';
  strikePrice: number;
  expiryDate: string;
  entryPremium: number;
  targetPremium: number;
  stopPremium: number;
  riskRewardRatio: number;
  delta: number;
  dte: number;
  isLotto: boolean;
  iv: number;
  selectionNote?: string;
}

async function selectZeroDteContract(signal: NormalizedTVSignal): Promise<TVOptionSelection | null> {
  if (!(signal.stop && signal.target)) return null;
  const { selectContracts } = await import('./option-selection-engine');
  const direction = signal.direction === 'long' ? 'bullish' : 'bearish';
  const vehicles: Array<{ symbol: string; scale: number }> = [{ symbol: signal.symbol, scale: 1 }];

  // An SPX thesis can be perfectly valid while one SPXW contract is too large
  // for the account. SPY is the liquid, account-sized execution fallback. Its
  // levels are scaled from the same thesis, never independently invented.
  if (signal.symbol === 'SPX') {
    const spyQuote = await getTradierQuote('SPY').catch(() => null);
    const spySpot = spyQuote?.last ?? spyQuote?.close;
    if (spySpot && spySpot > 0) vehicles.push({ symbol: 'SPY', scale: spySpot / signal.entry });
  }

  let lastNote = '';
  for (const vehicle of vehicles) {
    const result = await selectContracts({
      symbol: vehicle.symbol,
      direction,
      setup: 'scalp',
      expiryTier: '0DTE',
      allowZeroDte: true,
      entry: signal.entry * vehicle.scale,
      stop: signal.stop * vehicle.scale,
      t1: signal.target * vehicle.scale,
      t2: signal.t2 ? signal.t2 * vehicle.scale : undefined,
      holdingDays: 0,
      conviction: signal.confidence,
      asOfSpot: signal.price * vehicle.scale,
      accountSize: signal.accountSize,
      riskBudgetDollars: signal.riskBudget,
      maxDebitDollars: signal.maxDebit,
      minRoiAtT1Pct: 30,
    });
    lastNote = result.note || '';
    const contract = result.recommendedTier
      ? result.picks.find((pick) => pick.tier === result.recommendedTier)
      : undefined;
    if (!contract) continue;
    return {
      vehicleSymbol: vehicle.symbol,
      levelScale: vehicle.scale,
      optionType: contract.optionType,
      strikePrice: contract.strike,
      expiryDate: contract.expiry,
      entryPremium: contract.entryPremium,
      targetPremium: contract.projectedAtT1,
      stopPremium: contract.modelPremiumAtStop,
      riskRewardRatio: contract.riskRewardRatio,
      delta: Math.abs(contract.delta),
      dte: contract.dte,
      isLotto: true,
      iv: contract.iv,
      selectionNote: `${result.recommendedTier} ${contract.grade}${lastNote ? ` — ${lastNote}` : ''}`,
    };
  }

  logger.info(`[TV-WEBHOOK] ${signal.symbol} 0DTE withheld: ${lastNote || 'no account-fit live contract'}`);
  return null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN PROCESSOR
// ═══════════════════════════════════════════════════════════════

export async function processSignal(payload: TVWebhookPayload | NormalizedTVSignal): Promise<{ success: boolean; ideaId?: string; error?: string }> {
  const normalized = 'signalId' in payload
    ? { ok: true as const, signal: payload as NormalizedTVSignal }
    : normalizeTradingViewPayload(payload as TVWebhookPayload);
  if (!normalized.ok) return { success: false, error: normalized.error };
  const signal = normalized.signal;
  const originalSymbol = signal.symbol;
  const direction = signal.direction;
  const strategy = signal.strategy;
  const signalType = signal.signalType;
  const confidence = signal.confidence;
  const message = signal.message.toUpperCase().trim();

  // IGNORE EXIT SIGNALS — only process new entries
  // v15 sends: "SL" (stop loss), "TP" (take profit), "TRAIL" (trailing stop),
  // "TIME" (time stop), "MAXHOLD" (max hold exit), "EXIT" as exit comments
  const EXIT_KEYWORDS = ['SL', 'TP', 'TRAIL', 'TIME', 'MAXHOLD', 'EXIT', 'CLOSE', 'STOP'];
  const isExitSignal = EXIT_KEYWORDS.some(kw => message === kw || message.startsWith(kw + '+') || message.startsWith(kw + ' '));

  if (isExitSignal || signal.event !== 'entry') {
    logger.info(`[TV-WEBHOOK] Recorded non-entry event for ${originalSymbol}: "${signal.message || signal.event}"`);
    return { success: false, error: `Non-entry event acknowledged: ${signal.message || signal.event}` };
  }

  logger.info(`[TV-WEBHOOK] Processing ${originalSymbol} ${direction} signal (${strategy}, ${signalType}, id=${signal.signalId})`);

  // Rate limit check
  if (isRateLimited(signal.signalId)) {
    logger.warn(`[TV-WEBHOOK] Duplicate/rate limited: ${signal.signalId}`);
    return { success: false, error: 'Duplicate signal id or global webhook rate limit' };
  }
  // Reserve the id before any slow network work so two simultaneous webhook
  // deliveries cannot both pass the dedup check.
  recentSignals.set(signal.signalId, Date.now());

  try {
    // 1. Get live quote (fall back to payload price if market closed)
    let stockPrice = signal.price;
    let optionAvailable = true;
    const quote = originalSymbol === 'SPX'
      ? null
      : await getTradierQuote(originalSymbol).catch(() => null);
    if (quote?.last && quote.last > 0) {
      stockPrice = quote.last;
    } else if (stockPrice <= 0) {
      return { success: false, error: `Could not get quote for ${originalSymbol}` };
    } else {
      logger.info(`[TV-WEBHOOK] Using chart price $${stockPrice} for ${originalSymbol}; it is reference data, not an option fill`);
      optionAvailable = signal.isZeroDte;
    }

    // 2. Pick a live, account-fit contract. 0DTE uses the canonical selector;
    // generic TV alerts keep the legacy chain picker until their strategies are
    // migrated to explicit horizon/account fields.
    const option = signal.isZeroDte
      ? await selectZeroDteContract(signal)
      : optionAvailable ? await pickBestOption(originalSymbol, direction, stockPrice) : null;
    if (signal.isZeroDte && !option) {
      return { success: false, error: 'Valid chart alert, but no live 0DTE contract cleared liquidity, reachability, and account-risk gates' };
    }

    const symbol = option?.vehicleSymbol ?? originalSymbol;
    const levelScale = option?.levelScale ?? 1;
    const entryPrice = signal.entry * levelScale;
    const targetPrice = signal.target != null ? signal.target * levelScale : undefined;
    const stopLoss = signal.stop != null ? signal.stop * levelScale : undefined;
    if (!(targetPrice && stopLoss)) {
      return { success: false, error: 'Entry alerts require explicit stop and target/t1; QuantEdge will not invent trade levels' };
    }

    // 3. QuantEdge Validation — unified validator (TV signals never blocked, only scored)
    let tvScore = confidence;
    if (signalType === 'reversal') tvScore = Math.min(95, tvScore + 5);

    let qeScore = 50;
    let qeVerdict = 'NEUTRAL';
    let qeChecks: string[] = [];

    try {
      const { validateIdea } = await import('./unified-validator');
      const validation = await validateIdea({
        symbol,
        direction,
        source: 'tradingview',
        entryPrice,
        targetPrice,
        stopLoss,
        assetType: option ? 'option' : 'stock',
        confidence: tvScore,
      });

      qeScore = validation.finalConfidence;
      qeVerdict = validation.verdict;
      qeChecks = validation.checks.map(c => `${c.passed ? '✓' : '✗'} ${c.name}: ${c.detail}`);
    } catch (e) {
      logger.debug(`[TV-WEBHOOK] Unified validation failed, using defaults: ${e}`);
    }

    // Combined: TV 60% + QE 40% (TV never blocked)
    const combinedScore = Math.round(tvScore * 0.6 + qeScore * 0.4);

    logger.info(`[TV-WEBHOOK] ${symbol} scores — TV: ${tvScore}, QE: ${qeScore} (${qeVerdict}), Combined: ${combinedScore}`);
    logger.info(`[TV-WEBHOOK] QE checks: ${qeChecks.join(' | ')}`);

    // 4. Route through unified ingestion pipeline (dedup, loss cooldown, confidence gates)
    const isOption = !!option;
    const qeNote = qeChecks.length > 0 ? ` | QE: ${qeVerdict} — ${qeChecks.join(', ')}` : '';
    const feedNote = signal.rawTicker !== symbol ? ` | chart feed ${signal.exchange ? `${signal.exchange}:` : ''}${signal.rawTicker} → vehicle ${symbol}` : '';
    const catalyst = (signal.message || `TradingView ${strategy} ${signalType} signal on ${originalSymbol}`) + feedNote + qeNote;

    const { ingestTradeIdea } = await import('./trade-idea-ingestion');

    const signals = [
      { type: `tv_${strategy}`, weight: 20, description: `TradingView ${signalType} signal` },
      { type: 'tv_confidence', weight: tvScore >= 85 ? 15 : 10, description: `TV confidence: ${tvScore}/100` },
      { type: 'qe_validation', weight: qeScore >= 80 ? 15 : qeScore >= 60 ? 10 : 5, description: `QE: ${qeVerdict} (${qeScore})` },
      ...(signal.isZeroDte ? [{ type: 'tv_0dte_confirmed', weight: 10, description: `Confirmed ${signal.timeframe || 'intraday'} SPX 0DTE bar` }] : []),
    ];

    const analysis = isOption
      ? `${strategy.toUpperCase()} ${signalType} signal. ${option!.vehicleSymbol} ${option!.optionType.toUpperCase()} $${option!.strikePrice} (delta: ${option!.delta.toFixed(2)}, IV: ${(option!.iv * 100).toFixed(0)}%) exp ${option!.expiryDate}. Live mid: $${option!.entryPremium.toFixed(2)}, modeled at T1: $${option!.targetPremium.toFixed(2)}. Underlying plan ${entryPrice.toFixed(2)} / ${stopLoss.toFixed(2)} / ${targetPrice.toFixed(2)}. ${option!.selectionNote || ''} TV:${tvScore} QE:${qeScore}(${qeVerdict})`
      : `${strategy.toUpperCase()} ${signalType} signal at $${entryPrice.toFixed(2)}; stop $${stopLoss.toFixed(2)}, T1 $${targetPrice.toFixed(2)}. TV:${tvScore} QE:${qeScore}(${qeVerdict}). ${signal.message}`;

    const result = await ingestTradeIdea({
      source: 'tradingview',
      symbol,
      assetType: isOption ? 'option' : 'stock',
      direction: direction === 'long' ? 'bullish' : 'bearish',
      signals,
      currentPrice: entryPrice,
      targetPrice,
      stopLoss,
      catalyst,
      holdingPeriod: signal.isZeroDte ? 'day' : 'swing',
      analysis,
      optionType: isOption ? option!.optionType : undefined,
      strikePrice: isOption ? option!.strikePrice : undefined,
      expiryDate: isOption ? option!.expiryDate : undefined,
      entryPremium: isOption ? option!.entryPremium : undefined,
      signalTimestamp: signal.barTime,
      dataSourceUsed: isOption ? 'live-option-chain' : 'tradingview',
      sourceMetadata: {
        signalId: signal.signalId,
        strategyFamily: signal.strategyFamily,
        chartSymbol: originalSymbol,
        executionVehicle: symbol,
        optionMarkBasis: isOption ? 'live chain mid at receipt' : undefined,
        playbook: signal.strategyFamily === 'index_closing_drive' ? {
          trigger: signal.signalType,
          triggerLevel: signal.entry,
          invalidation: signal.stop,
          t1: signal.target,
          t2: signal.t2,
          entryWindowEt: '15:35-15:50',
          forceFlatEt: '15:57',
          premiumManagement: 'recover principal at +100%; trail the runner; never hold a 0DTE runner into settlement',
        } : undefined,
      },
    });

    if (result.success) {
      logger.info(`[TV-WEBHOOK] Ingested via pipeline — ${symbol} ${direction}`);

      // Push chart-script calls into Cockpit immediately. This is separate from
      // Discord so a webhook/channel outage cannot make the terminal silent.
      const { broadcastBotEvent } = await import('./bot-notification-service');
      broadcastBotEvent({
        eventType: 'signal',
        source: 'tradingview',
        symbol,
        optionType: option?.optionType,
        strike: option?.strikePrice,
        expiry: option?.expiryDate,
        price: option?.entryPremium,
        confidence: combinedScore,
        portfolio: 'small_account',
        reason: `${signal.strategyFamily}|${signal.signalType}|entry ${entryPrice.toFixed(2)}|stop ${stopLoss.toFixed(2)}|t1 ${targetPrice.toFixed(2)}${signal.t2 ? `|t2 ${(signal.t2 * levelScale).toFixed(2)}` : ''}`,
      });

      // Send Discord alert (bypass grade filters — user's own backtested signals)
      try {
        // Fetch the most recent idea for this symbol/source to get the saved ID
        const { storage } = await import('./storage');
        const recentIdeas = await storage.getRecentTradeIdeas(1, 5);
        const saved = recentIdeas.find((i: any) => i.symbol === symbol && i.source === 'tradingview');
        if (saved) {
          await sendTradeIdeaToDiscord(saved as any, { forceBypassFilters: false });
          logger.info(`[TV-WEBHOOK] Discord alert sent for ${symbol}`);
        }
      } catch (e) {
        logger.error(`[TV-WEBHOOK] Discord alert failed: ${e}`);
      }

      return { success: true };
    } else {
      logger.info(`[TV-WEBHOOK] Ingestion gate blocked: ${result.reason} — ${symbol}`);
      return { success: false, error: result.reason };
    }
  } catch (error) {
    logger.error(`[TV-WEBHOOK] Error processing ${originalSymbol}:`, error);
    return { success: false, error: `Processing failed: ${error}` };
  }
}

logger.info('[TV-WEBHOOK] TradingView Webhook Service initialized');
