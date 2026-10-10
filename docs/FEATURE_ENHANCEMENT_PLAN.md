# QuantEdge Feature Enhancement Plan

*Based on Intellectia.ai analysis - Updated 2026-01-29*

---

## Current State vs Target State

### What We Already Have

| Feature | Location | Current State | Enhancement Needed |
|---------|----------|---------------|-------------------|
| AI Chatbot | `components/ai-chatbot-popup.tsx` | Basic Q&A | Add stock analysis, portfolio queries |
| WSB/Social Sentiment | `server/social-sentiment-scanner.ts` | Backend exists | Surface in UI prominently |
| Smart Money/Whales | `pages/smart-money.tsx` | Insider trades, options flow | Add congressional trades |
| Backtesting | `pages/backtest.tsx` | Pattern analysis only | True strategy backtesting |
| Market Scanner | `pages/market-scanner.tsx` | Filter-based | Add NLP natural language |

---

## Enhancement 1: AI Chatbot Upgrade

**Location:** `components/ai-chatbot-popup.tsx` + `server/routes.ts`

**Current:** Basic research assistant Q&A

**Target:** Full financial AI assistant like "Chat with Tia"

### New Capabilities:
```typescript
// New query types to support:
- "What's the sentiment on AAPL?"     → Pull from 6-layer analysis
- "Show me breakout stocks today"     → Query breakout scanner
- "Analyze NVDA for me"               → Full multi-engine summary
- "What's trending on WSB?"           → Pull from social scanner
- "Should I buy TSLA?"                → Risk/reward analysis
```

### Implementation:
1. Add intent detection to `/api/ai/research-assistant`
2. Route financial queries to existing engines
3. Format responses with actionable insights

**Fits in Hierarchy:** Global component (available everywhere)

---

## Enhancement 2: Natural Language Screener

**Location:** `pages/market-scanner.tsx` + new `server/nlp-screener.ts`

**Current:** Filter dropdowns only

**Target:** Type natural language like "tech stocks under $50 with momentum"

### Implementation:
```typescript
// Example NLP parsing:
"tech stocks under $50 with momentum"
→ {
    sector: "Technology",
    priceMax: 50,
    signals: ["momentum"],
    sortBy: "percentChange"
  }
```

### New Server Endpoint:
```typescript
POST /api/screener/nlp
Body: { query: "tech stocks under $50 with RSI below 30" }
Response: { filters: {...}, results: [...] }
```

**Fits in Hierarchy:** Discovery → Market Scanner (add NLP input at top)

---

## Enhancement 3: Backtesting Playground Upgrade

**Location:** `pages/backtest.tsx`

**Current:** Pattern detection only (not true backtesting)

**Target:** Full strategy backtesting with metrics like Intellectia

### New Features:
- Strategy builder (entry/exit rules)
- Historical simulation
- Performance metrics (Sharpe, max drawdown, win rate)
- Equity curve visualization
- Compare vs buy-and-hold

### New API Endpoints:
```typescript
POST /api/backtest/run
Body: {
  symbol: "AAPL",
  strategy: {
    entryRules: [{ indicator: "RSI", condition: "<", value: 30 }],
    exitRules: [{ indicator: "RSI", condition: ">", value: 70 }]
  },
  period: "1Y",
  capital: 10000
}
Response: {
  trades: [...],
  metrics: { sharpe, maxDrawdown, winRate, totalReturn },
  equityCurve: [...]
}
```

**Fits in Hierarchy:** Performance & History → Backtest (upgrade existing)

---

## Enhancement 4: WSB/Social Integration

**Location:** `pages/discover.tsx` + `pages/market-scanner.tsx`

**Current:** Backend has WSB data but not prominently shown

**Target:** Dedicated section for social sentiment

### Where to Surface:

1. **Home page:** "Trending on WSB" card
2. **Discover page:** Social tab with Reddit/Twitter trends
3. **Market Scanner:** "WSB Trending" filter option
4. **Stock Detail:** Social sentiment section

### New Components:
```typescript
// components/wsb-trending-card.tsx
function WSBTrendingCard() {
  const { data } = useQuery(['/api/social/wsb-trending']);
  return (
    <Card>
      <CardHeader>🚀 Trending on WSB</CardHeader>
      {data?.tickers.map(ticker => (
        <TrendingItem
          symbol={ticker.symbol}
          mentions={ticker.mentionCount}
          sentiment={ticker.sentiment}
        />
      ))}
    </Card>
  );
}
```

**Fits in Hierarchy:**
- Home → Add WSB card
- Discover → Add Social tab
- Stock Detail → Add social section

---

## Enhancement 5: Congressional Trades Tracker

**Location:** `pages/smart-money.tsx` (new section)

**Current:** Insider trades only

**Target:** Add congressional trading data

### Data Source Options:
- Quiver Quantitative API
- Capitol Trades API
- House Stock Watcher

### New UI Section:
```typescript
// Inside smart-money.tsx
<Card>
  <CardHeader>
    <Icon icon={Landmark} />
    Congressional Trades
  </CardHeader>
  <CardContent>
    {congressTrades.map(trade => (
      <TradeRow
        politician={trade.representative}
        party={trade.party}
        symbol={trade.ticker}
        type={trade.transactionType}
        amount={trade.amount}
        date={trade.transactionDate}
      />
    ))}
  </CardContent>
</Card>
```

**Fits in Hierarchy:** Analysis Tools → Smart Money (add tab/section)

---

## Enhancement 6: "Should I Buy?" Analysis

**Location:** New `components/should-i-buy.tsx` + Stock Detail page

**Target:** One-click comprehensive analysis like Intellectia

### Features:
- Bull case summary
- Bear case summary
- AI confidence score
- Entry/exit suggestions
- Risk assessment
- Peer comparison

### Implementation:
```typescript
// components/should-i-buy.tsx
function ShouldIBuy({ symbol }: { symbol: string }) {
  const { data } = useQuery(['/api/analysis/should-buy', symbol]);

  return (
    <Card>
      <CardHeader>
        <Brain /> Should I Buy {symbol}?
        <Badge>{data.verdict}</Badge> {/* BUY / HOLD / SELL */}
      </CardHeader>
      <CardContent>
        <Section title="Bull Case">{data.bullCase}</Section>
        <Section title="Bear Case">{data.bearCase}</Section>
        <ConfidenceScore value={data.confidence} />
        <EntryExitSuggestion entry={data.entryPrice} exit={data.targetPrice} stop={data.stopLoss} />
      </CardContent>
    </Card>
  );
}
```

**Fits in Hierarchy:** Stock Detail page → Add as prominent section

---

## Enhancement 7: Earnings Prediction & Analysis

**Location:** New `pages/earnings-analysis.tsx` + Stock Detail page + `server/earnings-prediction-service.ts`

**Inspiration:** Intellectia.ai earnings prediction system

**Target:** Comprehensive AI-powered earnings prediction with scenario analysis

### Features:
- **AI Summary**: Pre-earnings prediction with confidence level
- **Scenario Analysis**: Probability distribution (Strong Beat, Beat, Neutral, Miss, Strong Miss)
- **Key Indicators Forecast**: Revenue/EPS predictions with justifications
- **Prediction Logic**: Explain the AI's reasoning
- **Tactical Strategy**: Options strategies for each scenario
- **Historical Context**: Past earnings surprises with charts
- **Transcript Analysis**: Post-earnings transcript key points

### Data Structure:
```typescript
interface EarningsPrediction {
  symbol: string;
  earningsDate: string;

  // AI Prediction
  prediction: 'strong_beat' | 'beat' | 'neutral' | 'miss' | 'strong_miss';
  confidence: number; // 0-100
  aiSummary: string;

  // Scenario Probabilities
  scenarios: {
    strongBeat: { probability: number; priceTarget: number };
    beat: { probability: number; priceTarget: number };
    neutral: { probability: number; priceTarget: number };
    miss: { probability: number; priceTarget: number };
    strongMiss: { probability: number; priceTarget: number };
  };

  // Forecasts
  revenueForecast: {
    estimate: number;
    consensus: number;
    justification: string;
  };
  epsForecast: {
    estimate: number;
    consensus: number;
    justification: string;
  };

  // Strategy
  tacticalStrategies: {
    bullish: string;
    neutral: string;
    bearish: string;
  };

  // Historical
  surpriseHistory: Array<{
    date: string;
    expected: number;
    actual: number;
    surprise: number;
    priceReaction: number;
  }>;
}
```

### New API Endpoints:
```typescript
GET /api/earnings/prediction/:symbol
// Returns: EarningsPrediction object

GET /api/earnings/history/:symbol
// Returns: Historical earnings with surprises

GET /api/earnings/transcript/:symbol/:date
// Returns: Earnings call transcript analysis
```

### Implementation Components:
```typescript
// components/earnings/earnings-prediction-card.tsx
function EarningsPredictionCard({ symbol }: { symbol: string }) {
  return (
    <Card>
      <CardHeader>
        <Brain /> Earnings Prediction
        <Badge>{prediction.confidence}% confidence</Badge>
      </CardHeader>
      <CardContent>
        <ScenarioAnalysis scenarios={prediction.scenarios} />
        <ForecastIndicators revenue={prediction.revenueForecast} eps={prediction.epsForecast} />
        <PredictionLogic summary={prediction.aiSummary} />
        <TacticalStrategies strategies={prediction.tacticalStrategies} />
      </CardContent>
    </Card>
  );
}
```

**Fits in Hierarchy:**
```
Stock Detail (/stock/:symbol)
├── Existing: Quote, Chart, News, Analysis
└── NEW: Earnings Prediction Tab/Section
    ├── AI Prediction Summary
    ├── Scenario Probability Chart
    ├── Forecast Indicators
    ├── Strategy Recommendations
    └── Historical Surprises Chart

Earnings Calendar (accessible from Discover)
└── Click any stock → Opens earnings prediction modal/page

Trade Desk
└── "Earnings Play" section
    └── Stocks with upcoming earnings + predictions
```

---

## Enhancement 8: Daily Market Brief

**Location:** New scheduled job + email/notification

**Target:** Morning summary like Intellectia's 8 AM picks

### Features:
- Top 5 AI picks for the day
- Market overview (futures, sectors)
- Key earnings today
- Macro events
- WSB trending

### Implementation:
1. Server cron job at 8 AM ET
2. Generate brief from existing data
3. Send via email/Discord
4. Store for in-app viewing

```typescript
// server/daily-brief-generator.ts
async function generateDailyBrief() {
  const [picks, earnings, movers, wsb] = await Promise.all([
    getBestTradeIdeas(5),
    getEarningsToday(),
    getMarketMovers(),
    getWSBTrending()
  ]);

  return {
    date: new Date(),
    topPicks: picks,
    marketOverview: { futures, sectors },
    earnings,
    wsbTrending: wsb.slice(0, 5),
    macroEvents: await getMacroEvents()
  };
}
```

**Fits in Hierarchy:** Home page → Daily Brief card at top

---

## Priority Order

| # | Enhancement | Effort | Impact |
|---|-------------|--------|--------|
| 1 | WSB/Social Integration | Low | High (already have data) |
| 2 | "Should I Buy?" Analysis | Medium | High (differentiation) |
| 3 | **Earnings Prediction** | Medium | High (Intellectia-level depth) |
| 4 | Daily Market Brief | Medium | High (retention) |
| 5 | AI Chatbot Upgrade | Medium | High (user experience) |
| 6 | NLP Screener | High | Medium (nice to have) |
| 7 | Congressional Trades | Medium | Medium (data sourcing) |
| 8 | Backtesting Upgrade | High | Medium (complex) |

---

## Architecture Placement Summary

```
Home (Dashboard)
├── NEW: Daily Market Brief card
├── NEW: WSB Trending card
├── NEW: Upcoming Earnings with AI predictions
└── Existing: Market Ticker, AI Ideas, News

Trade Desk (AI Ideas)
├── Existing: Best setups
├── NEW: "Should I Buy?" quick analysis
└── NEW: "Earnings Plays" section (upcoming earnings + predictions)

Stock Detail (/stock/:symbol)
├── Existing: Quote, Chart, News
├── NEW: "Should I Buy?" section
├── NEW: Social Sentiment section
└── NEW: Earnings Prediction tab
    ├── AI Summary & Confidence
    ├── Scenario Analysis (probability chart)
    ├── Revenue/EPS Forecasts
    ├── Tactical Strategies
    └── Historical Surprises

Market Scanner
├── Existing: Filters
├── NEW: NLP input bar
├── NEW: WSB filter option
└── NEW: "Earnings This Week" filter

Smart Money
├── Existing: Insider trades, Whale flow
└── NEW: Congressional trades tab

Discover
├── Existing: News
├── NEW: Social/WSB tab
├── NEW: Trending analysis
└── NEW: Earnings Calendar with predictions

AI Chatbot (Global)
└── NEW: Financial query routing
    └── "What's the earnings prediction for AAPL?"

Backtest (Future)
└── NEW: Strategy builder & simulation
```

---

*This plan should be used when adding any new feature to ensure proper placement in the hierarchy.*
