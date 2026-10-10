/**
 * idea-sources — canonical taxonomy for a trade idea's `source` field.
 * ====================================================================
 * One source of truth shared by the spine (storage.createTradeIdea) and
 * every frontend that renders a source chip. Replaces the two divergent,
 * truncation-prone label functions (trade-card sourceLabel, admin sourceLabels).
 *
 * Normalization direction matters: we collapse the verbose universal-generator
 * spellings (options_flow, quant_signal, ai_analysis) DOWN to the short schema
 * canon (flow, quant, ai — see schema.ts IdeaSource). That direction is safe
 * because existing UI filters compare against the short names (e.g.
 * `idea.source === 'flow'`); producing more of them only helps those filters.
 *
 * Provenance rule: synonyms are alternate spellings of the SAME engine only.
 * Never rewrites one engine into another, and never touches data-provider tags
 * (tradier, yahoo, cboe…) or news outlets (Reuters, WSJ…) — not idea-sources.
 */

export type IdeaSourceTone =
  | "quant"
  | "ai"
  | "hybrid"
  | "flow"
  | "news"
  | "scanner"
  | "chart"
  | "lotto"
  | "social"
  | "bullish"
  | "neutral";

export interface IdeaSourceMeta {
  /** Normalized canonical key. */
  canonical: string;
  /** Dense chip code for compact surfaces, e.g. "QNT". Always uppercase, ≤6 chars. */
  short: string;
  /** Full human label for roomy surfaces, e.g. "Quant". */
  label: string;
  /** Color/icon intent — each surface maps this to its own styling. */
  tone: IdeaSourceTone;
}

/**
 * Synonym map. Key = raw value (lowercased), value = canonical. Verbose names
 * collapse to the short schema canon; a few near-duplicate scanner names merge
 * into the common form. ONLY alternate spellings of the same engine.
 */
const SYNONYMS: Record<string, string> = {
  options_flow: "flow",
  quant_signal: "quant",
  ai_analysis: "ai",
  market_wide_scan: "market_scanner",
  scanner: "market_scanner",
  bot: "bot_screener",
  sentiment: "social_sentiment",
  spx_scanner: "spx_session",
};

/** Canonical taxonomy. Anything not here renders via the prettifying fallback. */
const META: Record<string, { short: string; label: string; tone: IdeaSourceTone }> = {
  quant: { short: "QNT", label: "Quant", tone: "quant" },
  ai: { short: "AI", label: "AI", tone: "ai" },
  hybrid: { short: "HYB", label: "Hybrid", tone: "hybrid" },
  flow: { short: "FLOW", label: "Options Flow", tone: "flow" },
  unusual_activity: { short: "UNUSL", label: "Unusual Activity", tone: "flow" },
  institutional_flow: { short: "INSTL", label: "Institutional Flow", tone: "flow" },
  whale_flow: { short: "WHALE", label: "Whale Flow", tone: "flow" },
  gex_scanner: { short: "GEX", label: "GEX Scanner", tone: "flow" },
  news: { short: "NEWS", label: "News", tone: "news" },
  news_catalyst: { short: "NEWS", label: "News Catalyst", tone: "news" },
  news_nlp: { short: "NEWS", label: "News NLP", tone: "news" },
  breaking_news: { short: "BREAK", label: "Breaking News", tone: "news" },
  analyst_ratings: { short: "RATING", label: "Analyst Ratings", tone: "news" },
  earnings_play: { short: "ERN", label: "Earnings Play", tone: "news" },
  market_scanner: { short: "SCAN", label: "Market Scanner", tone: "scanner" },
  bot_screener: { short: "BOT", label: "Bot Screener", tone: "scanner" },
  surge_detection: { short: "SURGE", label: "Surge Detection", tone: "scanner" },
  swing_catcher: { short: "SWING", label: "Swing Catcher", tone: "scanner" },
  penny_scanner: { short: "PENNY", label: "Penny Scanner", tone: "scanner" },
  orb_scanner: { short: "ORB", label: "ORB Scanner", tone: "scanner" },
  spx_session: { short: "SPX", label: "SPX Session", tone: "scanner" },
  sector_rotation: { short: "SECTOR", label: "Sector Rotation", tone: "scanner" },
  watchlist: { short: "WATCH", label: "Watchlist", tone: "scanner" },
  chart_analysis: { short: "CHART", label: "Chart Analysis", tone: "chart" },
  tradingview: { short: "TV", label: "TradingView", tone: "chart" },
  price_action: { short: "PA", label: "Price Action", tone: "chart" },
  lotto: { short: "LOTTO", label: "Lotto", tone: "lotto" },
  social_sentiment: { short: "SOCIAL", label: "Social Sentiment", tone: "social" },
  prediction_market: { short: "PRED", label: "Prediction Market", tone: "social" },
  bullish_trend: { short: "TREND", label: "Bullish Trend", tone: "bullish" },
  manual: { short: "MANUAL", label: "Manual", tone: "neutral" },
};

/** Acronyms that should stay uppercase in the prettified fallback label. */
const ACRONYMS = new Set([
  "ai", "tv", "gex", "vex", "orb", "spx", "iv", "rs", "nlp", "wsj", "etf", "spy", "btc",
]);

/**
 * Collapse a raw source to its canonical spelling for STORAGE: trim, lowercase,
 * apply synonyms. Deliberately conservative — no hyphen rewriting (schema canon
 * keeps `penny-scanner`) and unmapped values pass through untouched, preserving
 * provenance. Used at the write path.
 */
export function normalizeIdeaSource(src?: string | null): string {
  if (!src) return "quant";
  const base = src.trim().toLowerCase();
  return SYNONYMS[base] ?? base;
}

/** Title-case a delimited token, keeping known acronyms uppercase. */
function prettify(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Resolve any raw source value to DISPLAY metadata. Does a slightly fuller
 * normalization than the storage path (also folds hyphens) so old hyphenated
 * rows and new rows render identically. Known sources use the curated table;
 * unknown ones get a clean prettified label + word-boundary short code
 * (never a mid-word truncation like "SWIN"/"OPTI").
 */
export function ideaSourceMeta(src?: string | null): IdeaSourceMeta {
  const folded = (src ?? "").trim().toLowerCase().replace(/-/g, "_");
  const canonical = SYNONYMS[folded] ?? folded ?? "quant";
  const known = META[canonical];
  if (known) return { canonical, ...known };

  const label = prettify(canonical) || "Scan";
  const firstWord = canonical.split(/[-_\s]+/).filter(Boolean)[0] ?? "scan";
  const short = firstWord.toUpperCase().slice(0, 6);
  return { canonical, short, label, tone: "neutral" };
}
