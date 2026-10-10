# QuantEdge Platform Architecture Hierarchy

*Updated: 2026-01-29*

---

## Access Control Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        ACCESS TIERS                             │
├─────────────────────────────────────────────────────────────────┤
│  VISITORS              │  BETA USERS                            │
│  (not logged in)       │  (hasBetaAccess=true)                  │
├────────────────────────┼────────────────────────────────────────┤
│  • Landing page        │  • Full unlimited access               │
│  • Marketing pages     │  • All features unlocked               │
│  • Auth pages          │  • No restrictions                     │
│  • Educational content │                                        │
│  • Blurred preview     │                                        │
│    of protected pages  │                                        │
└────────────────────────┴────────────────────────────────────────┘
```

---

## Page Purposes & Connections

### 1. CORE HUB PAGES

| Page | Route | Lines | Purpose | Connects To |
|------|-------|-------|---------|-------------|
| **Home** | `/home` | 953 | Central dashboard hub, gateway to all tools | trade-desk, chart-analysis, market, discover, smart-money, watchlist |
| **Trade Desk** | `/trade-desk` | 3,374 | AI trade idea generation & multi-engine signals | stock/:symbol, chart-analysis |
| **Market** | `/market` | 985 | Market overview, movers, sector analysis | stock/:symbol, chart-analysis |
| **Charts** | `/chart-analysis` | 5,173 | Advanced technical analysis with 50+ indicators | stock/:symbol |
| **Watchlist** | `/watchlist` | - | Unified watchlist (personal + bot picks) | stock/:symbol |

**Data Flow:**
```
Home (hub) ──► Trade Desk ──► Stock Detail ──► Chart Analysis
    │              │              │
    ├──► Market ───┘              │
    │                             │
    └──► Watchlist ───────────────┘
```

### 2. DISCOVERY PAGES

| Page | Route | Purpose | Key Data |
|------|-------|---------|----------|
| **Discover** | `/discover` | News, social trends, earnings | News API, earnings, movers |
| **Market Scanner** | `/market-scanner` | Multi-timeframe stock screening | Movers, sectors, scanners |
| **Bullish Trends** | `/bullish-trends` | Momentum & breakout patterns | Breakouts, heat scores |
| **Smart Money** | `/smart-money` | Institutional flow, insiders | Whale flow, insider trades |

**Overlap Analysis:**
```
┌────────────────────────────────────────────────────────────────┐
│                    DATA DUPLICATION MAP                        │
├────────────────────────────────────────────────────────────────┤
│  Market Movers: home, market, discover, market-scanner,        │
│                 trade-desk, smart-money (6 PAGES!)             │
│                                                                │
│  News Feed: home, discover, market, stock-detail (4 PAGES)    │
│                                                                │
│  Earnings: home, discover, market-scanner (3 PAGES)           │
│                                                                │
│  Breakouts: trade-desk, market-scanner, bullish-trends        │
└────────────────────────────────────────────────────────────────┘
```

### 3. ANALYSIS PAGES

| Page | Route | Purpose | API Endpoints |
|------|-------|---------|---------------|
| **Stock Detail** | `/stock/:symbol` | Full stock research | `/api/analyze/:symbol`, quotes, news, options, analysts, insiders |
| **Options Analyzer** | `/options-analyzer` | Greeks, volatility, Black-Scholes | `/api/options-analyzer/*` |
| **Analysis** | `/analysis/:symbol` | Multi-engine analysis view | `/api/analyze/:symbol` |

### 4. TRADING PAGES

| Page | Route | Purpose |
|------|-------|---------|
| **Paper Trading** | `/paper-trading` | Simulated trading, portfolio tracking |
| **Automations** | `/automations` | Bot management (Lotto, Crypto, Futures, Swing, Day) |
| **Trading Engine** | `/trading-engine` | Live trading execution |

### 5. PERFORMANCE PAGES

| Page | Route | Purpose |
|------|-------|---------|
| **Performance** | `/performance` | Win rates, P&L, engine metrics, calibration |
| **History** | `/history` | Chat & research history |
| **Backtest** | `/backtest` | Strategy backtesting |

### 6. EDUCATIONAL PAGES

| Page | Route | Content | Dynamic? |
|------|-------|---------|----------|
| **Academy** | `/academy` | Trading fundamentals | Static (hardcoded) |
| **Blog** | `/blog` | Market insights, updates | Dynamic (API) |
| **Technical Guide** | `/technical-guide` | Trading techniques | Static |
| **Trading Rules** | `/trading-rules` | Platform rules | Static |

### 7. MARKETING PAGES

| Page | Route | Purpose |
|------|-------|---------|
| **Landing** | `/` | Marketing, convert visitors |
| **Features** | `/features` | Feature showcase |
| **Pricing** | `/pricing` | Plan comparison |
| **About** | `/about` | Company info |

---

## User Flow Diagrams

### Visitor Flow
```
Visitor ──► Landing Page
              │
    ┌─────────┼─────────┬─────────┐
    ▼         ▼         ▼         ▼
Features  Pricing   Academy    Blog
    │         │
    └────┬────┘
         ▼
      Sign Up ──► Waitlist ──► (Admin Approval) ──► Beta Access
```

### Beta User Flow
```
Beta User ──► Home (Dashboard)
               │
    ┌──────────┼──────────┬──────────┬──────────┐
    ▼          ▼          ▼          ▼          ▼
Trade Desk  Market    Charts    Watchlist   More...
    │          │          │          │
    │          │          │          │
    └──────────┴──────────┴──────────┘
                    │
                    ▼
            Stock Detail ──► Options Analyzer
                    │              │
                    ▼              ▼
            Paper Trading ──► Performance
```

---

## Consolidation Opportunities

### HIGH PRIORITY: Discovery Pages (4 → 1)

```
CURRENT:                          PROPOSED:
├── discover.tsx                  └── discover.tsx (tabs)
├── market-scanner.tsx      ──►       ├── Tab: News & Social
├── bullish-trends.tsx                ├── Tab: Scanner
└── smart-money.tsx                   ├── Tab: Momentum
                                      └── Tab: Smart Money
```

**Why:** All 4 pages show variations of the same data (movers, breakouts, trends).

### MEDIUM PRIORITY: Market vs Scanner

```
CURRENT:                          PROPOSED:
├── market.tsx (has scanner)      └── market.tsx
└── market-scanner.tsx       ──►      ├── Tab: Overview
                                      └── Tab: Full Scanner
```

**Why:** market.tsx already has a scanner tab; market-scanner.tsx is redundant.

### MEDIUM PRIORITY: Trade Desk Focus

```
CURRENT: trade-desk.tsx (3,374 lines - does everything)

PROPOSED: Focus on core value
└── trade-desk.tsx
    ├── Best AI Trade Ideas (PRIMARY)
    ├── Convergence Signals
    └── Quick links to specialized pages
```

**Why:** Too bloated; breakouts/momentum belong in discovery.

---

## Page Size Analysis

| Page | Lines | Assessment |
|------|-------|------------|
| chart-analysis.tsx | 5,173 | ⚠️ Too large - split charting logic |
| trade-desk.tsx | 3,374 | ⚠️ Too large - remove duplicated features |
| stock-detail.tsx | 2,202 | ✅ Acceptable |
| market-scanner.tsx | 2,141 | ⚠️ Consider merge with market.tsx |
| options-analyzer.tsx | 1,728 | ✅ Acceptable |
| automations.tsx | 1,578 | ✅ Acceptable |
| market.tsx | 985 | ✅ Good |
| home.tsx | 953 | ✅ Good |
| settings.tsx | 801 | ✅ Good |
| paper-trading.tsx | 784 | ✅ Good |

---

## Security Issues

| Route | Issue | Priority |
|-------|-------|----------|
| `/admin/*` | No auth protection | 🔴 HIGH |
| `/signal-weights` | Maps to PerformancePage unprotected | 🟡 MEDIUM |

---

## Shared Data Hooks Needed

```typescript
// These hooks would reduce API call duplication:

useMarketMovers()     // Used by 6 pages
useNewsFeed()         // Used by 4 pages
useEarnings()         // Used by 3 pages
useBreakouts()        // Used by 3 pages
useOptionsData()      // Used by 3 pages
```

---

## Complete Page List

### Public Pages (20)
```
Marketing:     /, /features, /pricing, /about
Auth:          /login, /signup, /forgot-password, /reset-password, /join-beta, /invite
Educational:   /academy, /blog, /blog/:slug, /technical-guide, /trading-rules,
               /chart-database, /success-stories
Legal:         /privacy, /terms
```

### Protected Pages (35)
```
Core:          /home, /trade-desk, /chart-analysis, /stock/:symbol, /market, /watchlist
Discovery:     /discover, /market-scanner, /bullish-trends, /smart-money
Analysis:      /options-analyzer, /analysis/:symbol
Trading:       /paper-trading, /automations, /trading-engine
Performance:   /performance, /history, /backtest
Utility:       /settings, /trade-ideas/:id/audit, /ct-tracker, /wallet-tracker
Admin (12):    /admin, /admin/users, /admin/invites, /admin/waitlist, /admin/system,
               /admin/trade-ideas, /admin/blog, /admin/reports, /admin/security,
               /admin/win-loss, /admin/credits, /admin/beta-invites
```

---

## Server Architecture

```
SERVER SERVICES (100+ files)
============================

CORE LAYER
├── routes.ts              → Main API router (22K+ lines)
├── storage.ts             → Database operations (Drizzle ORM)
├── db.ts                  → PostgreSQL connection
├── auth.ts                → JWT authentication
└── index.ts               → Server entry point

DATA SOURCES
├── tradier-api.ts         → Stocks/options quotes
├── coinbase-api.ts        → Crypto prices
├── yahoo-finance-api.ts   → Backup equity data
├── alpha-vantage-api.ts   → News/earnings
├── polygon-api.ts         → Historical data
└── news-service.ts        → News aggregation

ANALYSIS LAYERS (6 Layers)
├── Technical Layer        → technical-scanner, chart-pattern-detector
├── Flow Layer             → flow-scanner, whale-tracker, institutional-flow
├── Sentiment Layer        → sentiment-analyzer, social-scanner, multi-llm-service
├── Quant Layer            → quantitative-engine, breakout-scanner, bullish-trend-scanner
├── Convergence Layer      → multi-factor-analysis, confidence-calibration, regime-detection
└── GEX Layer              → gamma-exposure, dealer-positioning, strike-levels

TRADING SYSTEMS
├── trading-engine.ts
├── auto-idea-generator.ts
├── auto-lotto-trader.ts
├── convergence-engine.ts
├── pre-move-detection-service.ts
└── breakout-discovery-service.ts
```

---

## Cleanup History

### Completed (2026-01-29)
- [x] Deleted `/components/terminal/` (unused)
- [x] Deleted `/components/remotion/` (unused)
- [x] Deleted `catalyst-calendar.tsx`
- [x] Deleted `data-audit-center.tsx`
- [x] Moved admin-*.tsx to admin/ folder
- [x] Deleted old `admin.tsx` monolith (2,447 lines)

### Remaining Issues
| Issue | Status |
|-------|--------|
| Mock testimonials in landing.tsx | Pending |
| Mock data in live-activity-feed.tsx | Pending |
| Duplicate services (realtime-price vs realtime-pricing) | Pending |

---

## Next Steps

1. **Immediate:** Fix admin page security (add protection)
2. **Short-term:** Implement blurred preview for visitors on protected pages
3. **Medium-term:** Consolidate discovery pages (4 → 1 with tabs)
4. **Long-term:** Create shared data hooks to reduce API duplication

---

*This document should be updated when pages are added, removed, or consolidated.*
