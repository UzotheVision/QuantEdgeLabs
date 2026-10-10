/**
 * LEGACY REDIRECTS — the single source of truth for every retired URL.
 *
 * History: the router accumulated ~70 individual <Route><Redirect/></Route>
 * entries as pages were merged into the Terminal shell and the six primary
 * shells (Home / Hunt / GEX / Research / Positions / Journal). They now run
 * through ONE catch-all route (see App.tsx) driven by this table.
 *
 * Rules baked into the table:
 * - Redirect CHAINS were resolved to final destinations. Several legacy paths
 *   pointed at intermediate aliases (/home, /h, /p, /g, /chart-analysis,
 *   /command) that are themselves redirects, and chained redirects drop query
 *   params — so the table records where the user EFFECTIVELY landed, in one hop.
 * - One entry was dead code and is NOT here: a late `/t -> /r/SPY` redirect
 *   shadowed by the real `/t` Terminal route earlier in the Switch. `/t` IS
 *   the Terminal; that redirect could never fire.
 * - Parametric sources (/stock/:symbol etc.) keep their param substitution.
 *
 * To retire another URL: add one line to LEGACY_REDIRECTS. Nothing else changes.
 */

export type LegacyTarget = string | ((params: Record<string, string>) => string);

/**
 * [source pattern, destination] — exact paths first, then parametric.
 * `:name` segments match a single path segment (no slashes).
 */
export const LEGACY_REDIRECTS: Array<[string, LegacyTarget]> = [
  // ── Shell aliases → Terminal (/t) ──────────────────────────────────────
  ["/nexus", "/t"],
  ["/pos", "/t?tab=positions"],
  ["/j", "/t?tab=journal"],
  ["/p", "/t"],
  ["/h", "/t"],
  ["/g", "/t?tab=gex"],
  ["/btc", "/t?tab=crypto"],
  ["/crypto", "/t?tab=crypto"],
  ["/home", "/t"],
  ["/terminal", "/t"],
  ["/dashboard", "/t"],
  ["/command-center", "/t"],
  ["/command-center-v2", "/t"],
  ["/aion", "/t"],
  ["/paper-trading", "/t"],
  ["/wallet-tracker", "/t"],
  ["/ct-tracker", "/t"],
  ["/research", "/t"],
  ["/market-movers", "/t"],
  ["/movers", "/t"], // was /h?tab=movers → /h → /t (tab dropped by the chain)
  ["/discovery", "/t"], // was /h?tab=ai-picks → /t
  ["/pulse", "/t"], // was /p?tab=pulse → /t
  ["/watchlist", "/t"], // was /h?tab=watchlist → /t
  ["/watchlist/weekly", "/t"],
  ["/weekly-watchlist", "/t"], // was → /watchlist → /t
  ["/smart-signals", "/t"], // was /h?tab=surges → /t
  ["/market-scanner", "/t"], // was /h?tab=surges → /t
  ["/swing-scanner", "/t"], // was /h?tab=surges → /t
  ["/bullish-trends", "/t"], // was /h?tab=surges → /t

  // ── Folded into the Terminal GEX tab ────────────────────────────────────
  ["/whale-flow", "/t?tab=gex"], // was /g?tab=heatmap → /g → /t?tab=gex
  ["/smart-money", "/t?tab=gex"], // was /g?tab=heatmap → /t?tab=gex
  ["/gex-dashboard", "/t?tab=gex"],
  ["/gex-scanner", "/t?tab=gex"],
  ["/gex", "/t?tab=gex"],
  ["/scanner/gex", "/t?tab=gex"],
  ["/gex-legacy", "/t?tab=gex"],

  // ── Research / chart destinations ───────────────────────────────────────
  ["/analyze", "/r/SPY?tab=analyze"],
  ["/chart-analysis", "/r/SPY?tab=chart"],
  ["/pattern-scanner", "/r/SPY?tab=chart"], // was → /chart-analysis → …
  ["/geopolitical", "/r/SPY?tab=chart"], // was → /command → …
  ["/command", "/r/SPY?tab=chart"],
  ["/projector", "/r/SPY?tab=chart"],
  ["/options-analyzer", "/r/SPY?tab=options"],
  ["/terminal/heatmap", "/r/SPY?tab=gex"],
  ["/spx", "/r/SPX?tab=chart"],

  // ── Parametric (kept as functions) ─────────────────────────────────────
  ["/invite/:token", (p) => `/invite?code=${p.token}`],
  ["/stock/:symbol", (p) => `/r/${p.symbol}?tab=chart`],
  ["/terminal/:symbol", (p) => `/r/${p.symbol}?tab=chart`],
  ["/t/:symbol/:tab", (p) => `/r/${p.symbol}`],
  ["/t/:symbol", (p) => `/r/${p.symbol}`],
  ["/command/:symbol", (p) => `/r/${p.symbol}?tab=chart`],
  ["/gex/:symbol", (p) => `/r/${p.symbol}?tab=gex`],

  // ── Trade Desk ─────────────────────────────────────────────────────────
  ["/trade-desk-v2", "/trade-desk"],
  ["/discover", "/trade-desk"],
  ["/wsb-trending", "/trade-desk"],
  ["/social-trends", "/trade-desk"],
  ["/ai-stock-picker", "/trade-desk"],
  ["/trade-ideas", "/slate"],
  // Retired 2026-09-24 (nav-architecture test N6): Trade Desk duplicated the
  // NEXUS board and Slate and read "0 ideas" while the board had them;
  // Automations duplicated the BOT tab with a contradictory P&L.
  ["/trade-desk", "/slate"],
  ["/automations", "/t?tab=bot"],
  // PERF duplicated JOURNAL › Track record (same component, two doors).
  ["/performance", "/t?tab=journal&jtab=metrics"],
  ["/convictions", "/trade-desk?preset=todays-best"],
  ["/futures", "/trade-desk?tab=futures"],
  ["/futures-research", "/trade-desk?tab=futures"],

  // ── Performance ────────────────────────────────────────────────────────
  ["/trading-engine", "/performance"],
  ["/historical-intelligence", "/performance"],
  ["/smart-advisor", "/performance"],
  ["/convictions/backtest", "/performance"],
  ["/data-audit", "/performance"],
  ["/insights", "/performance"],
  ["/analytics", "/performance"],
  ["/signals", "/performance"],

  // ── Misc ───────────────────────────────────────────────────────────────
  ["/watchlist-bot", "/automations"],
  ["/account", "/settings"],
  ["/my-account", "/settings"],
  ["/trading-guide", "/blog/how-to-trade-like-a-pro"],
  ["/learn-more", "/"],
];

interface CompiledEntry {
  regex: RegExp;
  keys: string[];
  target: LegacyTarget;
}

function compilePattern(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = pattern
    .split("/")
    .map((seg) => {
      if (seg.startsWith(":")) {
        keys.push(seg.slice(1));
        return "([^/]+)";
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${src}$`), keys };
}

const COMPILED: CompiledEntry[] = LEGACY_REDIRECTS.map(([pattern, target]) => ({
  ...compilePattern(pattern),
  target,
}));

/**
 * Resolve a legacy pathname to its redirect target, or null if it isn't legacy.
 * Pure function — no router dependency, safe to unit test.
 */
export function resolveLegacyRedirect(pathname: string): string | null {
  const path = pathname.split("?")[0].split("#")[0];
  for (const { regex, keys, target } of COMPILED) {
    const m = regex.exec(path);
    if (!m) continue;
    if (typeof target === "string") return target;
    const params: Record<string, string> = {};
    keys.forEach((k, i) => {
      params[k] = decodeURIComponent(m[i + 1]);
    });
    return target(params);
  }
  return null;
}

/**
 * Single wouter Route pattern matching every legacy source path.
 * Built from the same table so the route and the resolver can never drift.
 */
export const LEGACY_REDIRECT_PATTERN: RegExp = new RegExp(
  `^(?:${LEGACY_REDIRECTS.map(([p]) => compilePattern(p).regex.source.slice(1, -1)).join("|")})$`
);
