/**
 * Trade Desk — page-level asset filter.
 * =====================================
 * Phase 4: the Trade Desk declares one asset filter that scopes both the
 * insights sidebar AND the Today's Picks grid. The predicate below is the
 * single implementation; trade-desk.tsx (sidebar + filter buttons),
 * todays-picks.tsx (All tab) and the tab panels (Ideas / Discovery) all
 * share it so the filter means the same thing everywhere.
 *
 * Semantics (preserved from the original per-type memos in trade-desk.tsx):
 *   stock   — assetType === 'stock', or untyped non-option ideas
 *   option  — assetType === 'option', or anything with an optionType
 *   crypto / future / penny_stock — exact assetType match
 *   watchlist — idea symbol is on the user's watchlist
 *   tv      — source === 'tradingview'
 *   all     — everything
 */

export type PageAssetFilter =
  | "all"
  | "stock"
  | "option"
  | "crypto"
  | "future"
  | "penny_stock"
  | "watchlist"
  | "tv";

export interface AssetFilterable {
  assetType?: string | null;
  optionType?: string | null;
  symbol?: string | null;
  source?: string | null;
}

export function matchesAssetFilter(
  idea: AssetFilterable,
  filter: PageAssetFilter,
  watchlistSymbols?: Set<string>,
): boolean {
  switch (filter) {
    case "stock":
      return idea.assetType === "stock" || (!idea.assetType && !idea.optionType);
    case "option":
      return idea.assetType === "option" || !!idea.optionType;
    case "crypto":
      return idea.assetType === "crypto";
    case "future":
      return idea.assetType === "future";
    case "penny_stock":
      return idea.assetType === "penny_stock";
    case "watchlist":
      return (
        !!watchlistSymbols &&
        watchlistSymbols.has((idea.symbol || "").toUpperCase())
      );
    case "tv":
      return idea.source === "tradingview";
    case "all":
    default:
      return true;
  }
}

/** The filter buttons rendered in the Trade Desk filter row (Phase 4: all
 *  eight declared values are now reachable — previously only four buttons
 *  existed for the eight-value state). */
export const ASSET_FILTER_BUTTONS: Array<{
  value: PageAssetFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "watchlist", label: "Watchlist" },
  { value: "stock", label: "Stocks" },
  { value: "option", label: "Options" },
  { value: "crypto", label: "Crypto" },
  { value: "future", label: "Futures" },
  { value: "penny_stock", label: "Penny" },
  { value: "tv", label: "TV" },
];
