# Trade Idea Generation Pipeline

## Overview

Quant Edge Labs uses a multi-engine approach to generate trade ideas. Each engine has different data sources, logic, and confidence calculations.

## Engine Types

### 1. Flow Scanner (`server/flow-scanner.ts`)
**Source:** `flow`  
**Asset Type:** Options  
**Purpose:** Detect unusual options activity that may signal institutional positioning

#### How It Works:
1. **Ticker Universe**: Scans 100+ tickers across sectors (quantum computing, nuclear, AI, biotech, etc.)
2. **Options Chain Fetch**: Pulls options data from Tradier API
3. **Unusual Activity Detection**: Flags contracts where:
   - Volume > 500 contracts (absolute threshold)
   - High premium relative to average
   - Unusual bid/ask spreads
4. **Direction Determination**: 
   - If call premium > put premium → `direction = 'long'` (bullish)
   - If put premium > call premium → `direction = 'short'` (bearish)
5. **Confidence Scoring** (multi-factor weighted):
   - Volume Score (25%): Average volume vs threshold
   - Premium Score (20%): Total premium magnitude ($10k-$1M+)
   - IV Score (15%): Implied volatility level
   - Breadth Score (15%): Number of unusual contracts
   - Skew Score (15%): Call/put imbalance strength
   - Timing Score (10%): Time of day factor
6. **Premium Targets**: Entry/Target/Stop based on option premium (always targeting premium increase)

#### Key Validation:
- Entry window must be before exit window
- R:R ratio minimum 1.5:1
- Options must have valid bid/ask spreads

---

### 2. Lotto Scanner (`server/lotto-scanner.ts`)
**Source:** `lotto`  
**Asset Type:** Options  
**Purpose:** Find high-risk/high-reward far-OTM weekly options

#### How It Works:
1. **Filter Criteria**:
   - Premium < $0.50 (cheap options)
   - Delta < 0.15 (far out of the money)
   - Expiration within 7 days (weekly)
   - High volume relative to open interest
2. **Target Calculation**: 20x return potential
3. **Risk Profile**: Expect to lose 100% of premium most times

---

### 3. Quant Engine (`server/quant-ideas-generator.ts`)
**Source:** `quant`  
**Asset Type:** Stocks, Crypto  
**Purpose:** Generate ideas using quantitative signals

#### Signal Components:
1. **RSI(2) Mean Reversion**: Look for oversold/overbought conditions
2. **VWAP Flow**: Institutional volume-weighted average price
3. **Volume Spike Detection**: 3x average volume = early entry
4. **ADX Regime Filter**: Trend strength measurement

#### Process:
1. Fetch market data from Yahoo Finance
2. Calculate technical indicators
3. Apply signal voting system
4. Generate entry/exit prices based on ATR

---

### 4. AI Engine (`server/ai-service.ts`)
**Source:** `ai`  
**Asset Type:** Stocks, Options  
**Purpose:** Use LLM analysis for fundamental research

#### Providers:
- Claude (Anthropic) - Primary
- Gemini (Google) - Fallback (free tier)
- GPT-4 (OpenAI) - Secondary

#### Process:
1. Fetch market context and news
2. Send to AI with structured prompt
3. Parse response for trade parameters
4. Validate and enrich with options data

---

## Pipeline Flow

```
User Request / Scheduled Job
         │
         ▼
┌─────────────────────────────────────────────┐
│           Engine Selection                   │
│  (flow, lotto, quant, ai, or hybrid)        │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│           Data Fetching                      │
│  - Market prices (Yahoo, CoinGecko)         │
│  - Options chains (Tradier)                 │
│  - News & catalysts (Alpha Vantage)         │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│           Signal Detection                   │
│  - Technical indicators (RSI, VWAP, ADX)    │
│  - Flow analysis (volume, premium)          │
│  - AI analysis (fundamentals)               │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│           Trade Validation                   │
│  (server/trade-validation.ts)               │
│  - Risk/reward ratio check (>1.5:1)         │
│  - Stop loss within bounds (5-15%)          │
│  - Liquidity check (volume, bid/ask)        │
│  - Time window validation                   │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│           Options Enrichment                 │
│  (server/options-enricher.ts)               │
│  - Select optimal strike (delta 0.3-0.5)    │
│  - Fetch live premium from Tradier          │
│  - Calculate target/stop premiums           │
│  - Add Greeks (delta, IV)                   │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│           Storage & Display                  │
│  - Save to PostgreSQL (tradeIdeas table)    │
│  - Display on Trade Desk                    │
│  - Send Discord notification                │
└─────────────────────────────────────────────┘
```

---

## Confidence Score Interpretation

| Score | Band | Meaning |
|-------|------|---------|
| 75-85% | A | Very strong signal, multiple confirmations, high premium |
| 65-74% | B+ | Good signal, worth watching |
| 55-64% | B | Moderate signal, needs confirmation |
| 45-54% | C+ | Weak signal, higher risk |
| 35-44% | C | Marginal signal, speculative |

### Confidence Score Factors (Weighted):
- **Volume (25%)**: Average volume vs 500 contract threshold
- **Premium (20%)**: Total premium - $50k=40%, $250k=60%, $500k=75%, $1M+=90%
- **IV (15%)**: Implied volatility level (higher = more unusual activity)
- **Breadth (15%)**: Number of unusual contracts detected
- **Skew (15%)**: Call/put imbalance strength (one-sided = stronger signal)
- **Timing (10%)**: Time of day (morning flow weighted highest)

---

## Quality Guardrails

### What Makes a "Good" Idea:
1. **Clear Entry/Exit**: Specific price levels, not vague
2. **Defined Risk**: Stop loss that limits downside
3. **Reasonable R:R**: At least 1.5:1 reward-to-risk
4. **Time-Bound**: Entry window and exit deadline
5. **Data-Backed**: Real market data, not guesses

### What Gets Rejected:
- Entry window after exit window
- No valid bid/ask (illiquid options)
- R:R below 1.5:1
- Stop loss too wide (>15%)
- Missing required fields

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Low confidence scores | Volume-only calculation | Fixed: Now uses 6-factor composite |
| All LONG, no SHORT | Call premium often dominates | Consider: Add put bias filter |
| Wrong premium targets | Direction inversion bug | Fixed: Always target premium UP |
| Stale prices | Market closed | Ideas generated during market hours |

---

## Performance Validation

Trades are tracked by `server/performance-validation-service.ts`:
- Checks every 5 minutes during market hours
- Updates outcome: `hit_target`, `hit_stop`, `expired`
- Records exit price and P&L for analytics
