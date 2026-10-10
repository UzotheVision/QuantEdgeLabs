/**
 * Portfolio AI Insights — grounded analysis of an imported broker portfolio.
 *
 * Truth-in-advertising contract (matches the platform's standing rule):
 *  - Every NUMBER (P/L, concentration, DTE, risk score) is computed deterministically
 *    from the user's real positions. The LLM is never asked to produce figures.
 *  - The LLM receives those computed facts + our active signals and only narrates /
 *    prioritises them. Its output is returned separately and flagged `isAI`.
 *  - If the LLM is unavailable, we fall back to an honest deterministic summary rather
 *    than fabricating a narrative.
 *  - Screenshot extraction returns ONLY what the vision model can read; missing fields
 *    are omitted rather than guessed.
 */
import { GoogleGenAI } from "@google/genai";
import { generateAI } from "./multi-llm-service";
import type { UnifiedPortfolio, UnifiedPosition, BrokerType } from "./broker-integration";

export interface SignalCorrelation {
  symbol: string;
  exposure: "long" | "short";
  ourDirection: "BULL" | "BEAR" | "NEUTRAL";
  alignment: "agrees" | "conflicts" | "no_signal";
  ourConfidence?: number;
  note: string;
}

export interface DeterministicInsights {
  riskScore: number;
  topRisks: string[];
  suggestions: string[];
  optionsExpiringThisWeek: number;
  biggestWinner: { symbol: string; plPercent: number } | null;
  biggestLoser: { symbol: string; plPercent: number } | null;
}

export interface PortfolioInsightResult {
  correlations: SignalCorrelation[];
  aiSummary: string;
  aiSuggestions: string[];
  isAI: boolean;
}

const round2 = (n: number | undefined | null): number =>
  Number.isFinite(n as number) ? Math.round((n as number) * 100) / 100 : 0;

/** Strip code fences / prose and parse the first JSON object found. */
function safeParseJSON(raw: string): any {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** A held position's effective directional exposure. */
function positionExposure(pos: UnifiedPosition): "long" | "short" {
  if (pos.isOption && pos.optionDetails) {
    const bullishContract = pos.optionDetails.optionType === "call";
    const owned = pos.quantity >= 0; // sold/written contracts invert the exposure
    return bullishContract === owned ? "long" : "short";
  }
  return pos.quantity >= 0 ? "long" : "short";
}

/** Normalise a trade idea's direction (schema uses 'long'|'short'; predictions use bullish/bearish). */
function ideaDirection(idea: any): "BULL" | "BEAR" | "NEUTRAL" {
  const d = (idea?.direction ?? "").toString().toUpperCase();
  if (d.includes("BEAR") || d === "SHORT" || d === "PUT") return "BEAR";
  if (d.includes("NEUTRAL")) return "NEUTRAL";
  if (d.includes("BULL") || d === "LONG" || d === "CALL") return "BULL";
  return "NEUTRAL";
}

/**
 * Correlate each held symbol against our most-recent active signals.
 * One row per underlying symbol; flags agreement / conflict / no-signal.
 */
export function correlatePositions(
  portfolio: UnifiedPortfolio,
  activeIdeas: any[],
): SignalCorrelation[] {
  const ideaBySymbol = new Map<string, any>();
  for (const idea of activeIdeas) {
    const sym = (idea?.symbol ?? "").toString().toUpperCase();
    if (!sym) continue;
    if (!ideaBySymbol.has(sym)) ideaBySymbol.set(sym, idea); // assumes input ordered newest-first
  }

  const out: SignalCorrelation[] = [];
  const seen = new Set<string>();

  for (const pos of portfolio.positions) {
    const sym = (
      pos.isOption && pos.optionDetails ? pos.optionDetails.underlying : pos.symbol
    )
      .toString()
      .toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);

    const exposure = positionExposure(pos);
    const idea = ideaBySymbol.get(sym);

    if (!idea) {
      out.push({
        symbol: sym,
        exposure,
        ourDirection: "NEUTRAL",
        alignment: "no_signal",
        note: `No active QuantEdge signal on ${sym}.`,
      });
      continue;
    }

    const our = ideaDirection(idea);
    const userBullish = exposure === "long";
    const agrees = (our === "BULL" && userBullish) || (our === "BEAR" && !userBullish);
    const conf =
      typeof idea.confidenceScore === "number" ? Math.round(idea.confidenceScore) : undefined;

    out.push({
      symbol: sym,
      exposure,
      ourDirection: our,
      alignment: our === "NEUTRAL" ? "no_signal" : agrees ? "agrees" : "conflicts",
      ourConfidence: conf,
      note:
        our === "NEUTRAL"
          ? `We're neutral on ${sym} right now.`
          : agrees
            ? `Your ${exposure} ${sym} aligns with our ${our} signal${conf ? ` (${conf}% conviction)` : ""}.`
            : `Heads up — your ${exposure} ${sym} conflicts with our ${our} signal${conf ? ` (${conf}% conviction)` : ""}.`,
    });
  }

  return out;
}

/**
 * Build an in-depth narrative + actionable suggestions from PRE-COMPUTED facts.
 * The LLM never invents numbers; on failure we return an honest deterministic summary.
 */
export async function generatePortfolioInsights(
  portfolio: UnifiedPortfolio,
  deterministic: DeterministicInsights,
  correlations: SignalCorrelation[],
): Promise<PortfolioInsightResult> {
  const facts = {
    totalValue: round2(portfolio.totalValue),
    totalCost: round2(portfolio.totalCost),
    unrealizedPL: round2(portfolio.unrealizedPL),
    unrealizedPLPercent: round2(portfolio.unrealizedPLPercent),
    positionCount: portfolio.positions.length,
    optionCount: portfolio.positions.filter((p) => p.isOption).length,
    riskScore: deterministic.riskScore,
    topRisks: deterministic.topRisks,
    optionsExpiringThisWeek: deterministic.optionsExpiringThisWeek,
    biggestWinner: deterministic.biggestWinner,
    biggestLoser: deterministic.biggestLoser,
    holdings: portfolio.positions.map((p) => ({
      ticker:
        p.isOption && p.optionDetails
          ? `${p.optionDetails.underlying} $${p.optionDetails.strike}${p.optionDetails.optionType === "call" ? "C" : "P"} ${p.optionDetails.expiry}`
          : p.symbol,
      qty: p.quantity,
      plPct: round2(p.unrealizedPLPercent ?? 0),
      dte: p.optionDetails?.daysToExpiry,
    })),
    signalAlignment: correlations.map((c) => ({
      symbol: c.symbol,
      yourSide: c.exposure,
      ourCall: c.ourDirection,
      alignment: c.alignment,
    })),
  };

  const system = `You are a disciplined risk analyst for a SMALL retail options/equities account.
You are handed FACTUAL, already-computed portfolio data. Never restate a number that isn't in the data, and never invent prices, win rates, or figures.
Give an honest, concrete read covering: concentration risk, net directional bias, options time-decay (DTE) exposure, and how the holdings line up with the platform's active signals (agrees/conflicts).
Be direct about problems. Prefer specific, actionable guidance (e.g. "trim X", "roll Y before Friday", "your book is 80% bullish into a bearish signal on Z").
Respond ONLY as compact JSON: {"summary": string (2-4 sentences), "suggestions": string[] (3-6 specific items)}.`;

  const prompt = `Portfolio facts (JSON):\n${JSON.stringify(facts)}\n\nReturn the JSON response now.`;

  try {
    const raw = await generateAI(prompt, { system, mode: "fallback", strategy: "quality" });
    const parsed = safeParseJSON(raw);
    if (parsed && (parsed.summary || Array.isArray(parsed.suggestions))) {
      return {
        correlations,
        aiSummary: String(parsed.summary ?? "").trim(),
        aiSuggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.map((s: any) => String(s)).filter(Boolean).slice(0, 6)
          : [],
        isAI: true,
      };
    }
  } catch {
    /* fall through to deterministic */
  }

  // Honest fallback — no fabricated narrative.
  const dir = facts.unrealizedPLPercent >= 0 ? "up" : "down";
  return {
    correlations,
    aiSummary: `${facts.positionCount} positions (${facts.optionCount} options), ${dir} ${Math.abs(facts.unrealizedPLPercent).toFixed(1)}% unrealized. Computed risk score ${facts.riskScore}/100. (AI narrative unavailable — showing computed facts only.)`,
    aiSuggestions: deterministic.suggestions,
    isAI: false,
  };
}

/**
 * Extract positions from a brokerage screenshot via Gemini vision.
 * Reads only what is visible; omits fields it cannot read. Never guesses prices.
 */
export async function extractPositionsFromScreenshot(
  imageBuffer: Buffer,
  mimeType: string,
  brokerType: BrokerType,
): Promise<{ positions: UnifiedPosition[]; error?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { positions: [], error: "Screenshot import unavailable (no GEMINI_API_KEY configured)." };
  }

  const system = `You read brokerage app/website screenshots and extract ONLY the positions clearly visible.
Do NOT guess or infer values that are not shown. If a field is not visible, omit it.
"costBasis" must be the TOTAL cost basis for the position when shown; if only an average/per-share price is visible, return that as "avgCost" instead.
Return ONLY compact JSON of the form:
{"positions":[{"symbol":"AAPL","quantity":10,"costBasis":1500,"avgCost":150,"currentPrice":162,"isOption":false,"optionType":"call|put","strike":150,"expiry":"YYYY-MM-DD"}]}
Omit option fields for stock rows. If you cannot read any positions, return {"positions":[]}.`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: { systemInstruction: system, temperature: 0 },
      contents: [
        {
          parts: [
            { text: "Extract every visible position from this brokerage screenshot as JSON." },
            { inlineData: { mimeType: mimeType || "image/png", data: imageBuffer.toString("base64") } },
          ],
        },
      ],
    });

    const parsed = safeParseJSON(result.text || "");
    const rows: any[] = Array.isArray(parsed?.positions) ? parsed.positions : [];

    const positions: UnifiedPosition[] = [];
    for (const r of rows) {
      const symbol = (r?.symbol ?? "").toString().toUpperCase().trim();
      const quantity = Number(r?.quantity);
      if (!symbol || !Number.isFinite(quantity) || quantity === 0) continue;

      const isOption = !!r?.isOption && (r?.optionType === "call" || r?.optionType === "put");
      const perShare = Number(r?.avgCost);
      const total = Number(r?.costBasis);
      const multiplier = isOption ? 100 : 1;
      const costBasis = Number.isFinite(total)
        ? total
        : Number.isFinite(perShare)
          ? perShare * Math.abs(quantity) * multiplier
          : 0;

      let optionDetails: UnifiedPosition["optionDetails"];
      if (isOption) {
        const expiry = (r?.expiry ?? "").toString();
        let daysToExpiry = 0;
        const expMs = Date.parse(expiry);
        if (Number.isFinite(expMs)) {
          daysToExpiry = Math.max(0, Math.round((expMs - Date.now()) / 86_400_000));
        }
        optionDetails = {
          underlying: symbol,
          optionType: r.optionType,
          strike: Number(r?.strike) || 0,
          expiry,
          daysToExpiry,
        };
      }

      positions.push({
        symbol,
        quantity,
        costBasis,
        currentPrice: Number.isFinite(Number(r?.currentPrice)) ? Number(r.currentPrice) : undefined,
        broker: brokerType,
        isOption,
        optionDetails,
      });
    }

    if (positions.length === 0) {
      return { positions: [], error: "Couldn't read any positions from that screenshot. Try a clearer, full-width capture of the positions list." };
    }
    return { positions };
  } catch (e: any) {
    return { positions: [], error: e?.message || "Screenshot extraction failed." };
  }
}
