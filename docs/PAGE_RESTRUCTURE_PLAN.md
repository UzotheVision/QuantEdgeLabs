# QuantEdge Page Restructuring Plan

## Competitive Analysis: Kavout vs QuantEdge

### What Kavout Does Well
1. **Intent-Based Navigation** - "I want to trade", "I want to invest", "I want to stay updated"
2. **Smart Money Depth** - Congress trades, Insider buys, Guru holdings, Analyst ratings
3. **Content Hub** - Breaking news, Market Lens articles, Podcasts
4. **Quick Discovery Chips** - Today's Top Picks, Guru Holdings, RSI Oversold, etc.
5. **Clear Footer Organization** - Tools, Resources, Other sections

---

## Proposed QuantEdge Navigation Structure

### Primary Navigation (Sidebar)

```
MAIN
├── Home                    (Dashboard with market overview)
├── Discover                (Intent-based discovery - NEW DESIGN)
├── Trade Desk              (AI Trade Ideas hub)
└── Chart Analysis          (Advanced charting)

RESEARCH
├── Smart Money             (Enhanced - Congress, Gurus, Insiders)
├── Options Flow            (NEW - Dedicated whale tracking)
├── Market Movers           (Top gainers/losers)
└── News & Sentiment        (NEW - Breaking news hub)

TOOLS
├── AI Stock Picker         (Strategy-based picks)
├── Screener                (Custom filters)
├── Watchlist               (Personal tracking)
└── Portfolio               (Performance tracking)

HISTORY
└── Activity                (Combined chat + research history)
```

---

## Page-by-Page Improvements

### 1. SMART MONEY PAGE (Major Enhancement)

**Current State:** Basic institutional flow
**Proposed State:** Full smart money tracking like Kavout

```
SMART MONEY
├── Overview Dashboard
│   └── Cross-Signal Alerts (when multiple sources agree)
│
├── Tab: Insider Trades
│   ├── Hot Insider Buys (3+ execs buying same stock)
│   ├── Recent Filings
│   └── Insider Selling Alerts
│
├── Tab: Congress Trades
│   ├── Recent Trades (both parties)
│   ├── Bipartisan Buys (high confidence)
│   ├── Senator/Rep Profiles
│   └── Sector Exposure
│
├── Tab: Guru Holdings
│   ├── Buffett, Ackman, Dalio, etc.
│   ├── New Positions
│   ├── Increased Stakes
│   └── Sold Positions
│
├── Tab: Analyst Ratings
│   ├── Recent Upgrades/Downgrades
│   ├── 20%+ Upside Targets
│   └── Strong Buy Consensus
│
└── Tab: Dark Pool / Block Trades
    ├── Unusual Block Activity
    └── Institutional Accumulation
```

**Data Sources Needed:**
- SEC Form 4 filings (insider trades)
- Congressional trading disclosures (Capitol Trades API or similar)
- 13F filings (hedge fund holdings)
- Analyst ratings aggregators

---

### 2. OPTIONS FLOW PAGE (New Dedicated Page)

**Rationale:** Currently buried in whale-flow, deserves its own page

```
OPTIONS FLOW
├── Overview
│   ├── Market-Wide Call/Put Ratio
│   ├── Premium Flow Summary
│   └── Unusual Activity Count
│
├── Tab: Unusual Options Activity
│   ├── Large premium trades (>$100K)
│   ├── Sweeps vs Blocks
│   ├── Near-expiry bets
│   └── Filter by sector/ticker
│
├── Tab: Whale Alerts
│   ├── Real-time whale trades
│   ├── Smart money flow direction
│   └── Historical accuracy
│
├── Tab: Options Scanners
│   ├── Bullish Flow Scanner
│   ├── Bearish Flow Scanner
│   ├── Earnings Plays
│   └── Gamma Squeeze Candidates
│
└── Tab: Options Education
    ├── Reading flow
    └── Strategy explanations
```

---

### 3. DISCOVER PAGE (Intent-Based Redesign)

**Current State:** Basic discovery
**Proposed State:** Kavout-style intent-based navigation

```
DISCOVER PAGE LAYOUT
┌─────────────────────────────────────────────────────────────┐
│  🔍 Universal Search Bar (AI-powered)                       │
│  "Search stocks, ask questions, find trades..."             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📈 I WANT TO TRADE                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Swing Trade │ │ Day Trade   │ │ Options     │           │
│  │ Analysis    │ │ Signals     │ │ Plays       │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
│  💰 I WANT TO INVEST                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Buy/Sell    │ │ Fundamental │ │ Dividend    │           │
│  │ Ratings     │ │ Analysis    │ │ Stocks      │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
│  📰 I WANT TO STAY UPDATED                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Breaking    │ │ Market      │ │ Earnings    │           │
│  │ News        │ │ Sentiment   │ │ Calendar    │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
│  🎓 I WANT TO LEARN                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ Trading     │ │ Strategy    │ │ AI Chat     │           │
│  │ Academy     │ │ Guides      │ │ Tutor       │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ⚡ QUICK DISCOVERY                                         │
│  [Today's Picks] [Guru Holdings] [Insider Buys]            │
│  [RSI Oversold] [Breakouts] [Earnings This Week]           │
└─────────────────────────────────────────────────────────────┘
```

---

### 4. NEWS & SENTIMENT PAGE (New)

**Rationale:** Consolidate news from multiple pages into dedicated hub

```
NEWS & SENTIMENT
├── Breaking News Feed (real-time)
│
├── Tab: Market Sentiment
│   ├── Overall market mood
│   ├── Sector sentiment heatmap
│   └── Social buzz (trending tickers)
│
├── Tab: Earnings News
│   ├── Pre-market movers
│   ├── After-hours reactions
│   └── Guidance changes
│
├── Tab: Macro News
│   ├── Fed/FOMC updates
│   ├── Economic data releases
│   └── Global markets
│
└── Tab: Stock-Specific
    └── Search for news by ticker
```

---

## Pages to CONSOLIDATE/REMOVE

| Current Page | Action | Reason |
|--------------|--------|--------|
| Chat History | MERGE → Activity | Combine with Research History |
| Research History | MERGE → Activity | Single history page is cleaner |
| Whale Flow | MERGE → Options Flow | Dedicated options page better |
| Smart Signals | KEEP | Distinct from AI Stock Picker |
| Performance | MERGE → Portfolio | Portfolio should include performance |

---

## Footer Restructure

```
┌─────────────────────────────────────────────────────────────┐
│ QUANT EDGE                                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ TRADING               ANALYSIS            TOOLS             │
│ • Trade Desk          • Smart Money       • Screener        │
│ • Options Flow        • Market Movers     • Watchlist       │
│ • AI Stock Picker     • News & Sentiment  • Portfolio       │
│ • Chart Analysis      • Research Hub      • Alerts          │
│                                                             │
│ RESOURCES             COMPANY             LEGAL             │
│ • Academy             • About Us          • Privacy Policy  │
│ • API Docs            • Pricing           • Terms of Use    │
│ • Blog                • Contact           • Disclaimer      │
│ • Help Center         • Careers                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ © 2026 Quant Edge Labs. All rights reserved.               │
│ Real-time data provided by Tradier. Delayed quotes 15 min. │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Priority

### Phase 1: Quick Wins (This Week)
1. ✅ Consolidate History pages (Chat + Research → Activity)
2. ✅ Rename Whale Flow → Options Flow (dedicated page)
3. ✅ Update footer structure

### Phase 2: Smart Money Enhancement (Week 2)
1. Add Congress Trades tab
2. Add Guru Holdings tab
3. Add Insider clustering detection
4. Cross-signal alerts

### Phase 3: Discover Redesign (Week 3)
1. Intent-based section cards
2. Quick Discovery chips
3. Improved search integration

### Phase 4: News Hub (Week 4)
1. Dedicated News & Sentiment page
2. Real-time news feed
3. Sentiment analysis integration

---

## Data APIs Needed

| Feature | Potential API | Cost |
|---------|---------------|------|
| Congress Trades | Capitol Trades, Quiver Quant | $50-200/mo |
| Insider Trades | SEC EDGAR (free), Finnhub | Free-$100/mo |
| Guru Holdings | WhaleWisdom, 13F filings | $100-300/mo |
| Analyst Ratings | Benzinga, TipRanks | $200-500/mo |
| Options Flow | Unusual Whales, FlowAlgo | $50-200/mo |

---

## Summary

**ADD:**
- Congress Trades tracking
- Guru/Hedge Fund holdings
- Intent-based Discover page
- News & Sentiment hub
- Cross-signal smart alerts

**CONSOLIDATE:**
- History pages → single Activity page
- Performance → into Portfolio
- Whale Flow → Options Flow (rename + expand)

**ENHANCE:**
- Smart Money (major upgrade)
- Discover (intent-based)
- Footer (better organization)

---

*Generated: 2026-01-27*
