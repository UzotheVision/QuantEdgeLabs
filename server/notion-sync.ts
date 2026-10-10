import { Client } from "@notionhq/client";
import { logger } from "./logger";

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

interface DocSection {
  title: string;
  content: string;
  category: string;
  lastUpdated: string;
}

async function clearDatabase(): Promise<void> {
  if (!DATABASE_ID) {
    throw new Error("NOTION_DATABASE_ID not configured");
  }

  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
    });

    for (const page of response.results) {
      await notion.pages.update({
        page_id: page.id,
        archived: true,
      });
    }
    logger.info(`Cleared ${response.results.length} existing pages from Notion database`);
  } catch (error) {
    logger.error("Error clearing Notion database:", error);
  }
}

async function createDocPage(section: DocSection): Promise<void> {
  if (!DATABASE_ID) {
    throw new Error("NOTION_DATABASE_ID not configured");
  }

  const contentBlocks = section.content.split('\n\n').map(paragraph => {
    if (paragraph.startsWith('## ')) {
      return {
        object: "block" as const,
        type: "heading_2" as const,
        heading_2: {
          rich_text: [{ type: "text" as const, text: { content: paragraph.replace('## ', '') } }],
        },
      };
    } else if (paragraph.startsWith('### ')) {
      return {
        object: "block" as const,
        type: "heading_3" as const,
        heading_3: {
          rich_text: [{ type: "text" as const, text: { content: paragraph.replace('### ', '') } }],
        },
      };
    } else if (paragraph.startsWith('- ')) {
      const items = paragraph.split('\n').filter(line => line.startsWith('- '));
      return items.map(item => ({
        object: "block" as const,
        type: "bulleted_list_item" as const,
        bulleted_list_item: {
          rich_text: [{ type: "text" as const, text: { content: item.replace('- ', '') } }],
        },
      }));
    } else if (paragraph.startsWith('```')) {
      const codeContent = paragraph.replace(/```\w*\n?/g, '').trim();
      return {
        object: "block" as const,
        type: "code" as const,
        code: {
          rich_text: [{ type: "text" as const, text: { content: codeContent } }],
          language: "typescript" as const,
        },
      };
    } else if (paragraph.trim()) {
      return {
        object: "block" as const,
        type: "paragraph" as const,
        paragraph: {
          rich_text: [{ type: "text" as const, text: { content: paragraph.substring(0, 2000) } }],
        },
      };
    }
    return null;
  }).flat().filter(Boolean);

  try {
    await notion.pages.create({
      parent: { database_id: DATABASE_ID },
      properties: {
        Name: {
          title: [{ text: { content: section.title } }],
        },
        Category: {
          select: { name: section.category },
        },
        "Last Updated": {
          date: { start: section.lastUpdated },
        },
      },
      children: contentBlocks.slice(0, 100) as any,
    });
    logger.info(`Created Notion page: ${section.title}`);
  } catch (error) {
    logger.error(`Error creating Notion page ${section.title}:`, error);
    throw error;
  }
}

export async function syncDocumentationToNotion(): Promise<{ success: boolean; pagesCreated: number; error?: string }> {
  if (!process.env.NOTION_API_KEY || !DATABASE_ID) {
    return { success: false, pagesCreated: 0, error: "Notion credentials not configured" };
  }

  const currentDate = new Date().toISOString().split('T')[0];

  const documentation: DocSection[] = [
    {
      title: "Platform Overview",
      category: "Overview",
      lastUpdated: currentDate,
      content: `## Quant Edge Labs Platform

Quant Edge Labs is a professional quantitative trading research platform designed for day-trading opportunities in US equities, options, and crypto markets.

### Core Purpose
- Deliver educational, research-grade trade ideas
- Robust risk management tools
- Real-time market analysis
- Strong risk controls with educational disclaimers

### Key Features
- AI-powered trade idea generation (OpenAI, Anthropic, Google Gemini)
- Quantitative engine with technical analysis
- Chart pattern recognition and validation
- Performance tracking and analytics
- Multi-asset support: Stocks, Options, Crypto, Futures

### Platform Philosophy
- Educational focus (not financial advice)
- Data-driven decision making
- Professional dark-themed UI optimized for rapid scanning
- Real-time market data integration`
    },
    {
      title: "Subscription Tiers",
      category: "Business",
      lastUpdated: currentDate,
      content: `## Subscription Model

Two-tier subscription model for beta launch:

### Free Tier ($0/month)
- 5 trade ideas per day
- Delayed market data (15 minutes)
- 7-day performance history
- Stocks & crypto only
- 3 watchlist items

### Advanced Tier ($39/month or $349/year)
- Unlimited trade ideas
- Real-time market data
- 10 chart analyses per day
- 25 AI generations per day
- Full performance history
- Discord alerts
- Advanced analytics
- Data export capabilities
- 50 watchlist items

### Future Pro Tier (Coming Soon)
- Options & futures coverage
- Unlimited chart analysis
- Unlimited AI generation
- Priority Discord channel
- API access
- Custom alerts
- White-label reports
- Priority support`
    },
    {
      title: "Quantitative Engine v3.7.0",
      category: "Technical",
      lastUpdated: currentDate,
      content: `## Quantitative Trading Engine

The core engine leverages multiple technical indicators and strategies:

### Technical Indicators
- RSI(2) Mean Reversion with 200-Day MA Filter
- VWAP Institutional Flow Analysis
- Volume Spike Early Entry Detection
- ADX Regime Filtering
- Signal Confidence Voting System
- Time-of-day filtering for optimal entry windows

### Risk Management
- Stop losses: 5-7% for stocks and crypto
- Standard 2:1 Risk/Reward ratio
- Minimum 1.5:1 R:R requirement
- Maximum 7% loss per trade guardrail

### Chart Pattern Validation (v3.7.0)
Chart validation is REQUIRED for standard trade ideas:
- Trade ideas without chart data are REJECTED
- Exception: Lotto plays and news catalyst trades (time-sensitive)
- 7 patterns detected: Head & Shoulders, Double Top/Bottom, Bull Flags, Triangles, Wedges, Channels

### Dynamic Exit Time Recalculation
Exit times fluctuate based on current market conditions:
- Uses live volatility estimates
- ±10-30% variance using symbol hash + random factors
- Asset-specific adjustments: options shorter (theta decay), crypto slightly longer (24/7 market)`
    },
    {
      title: "AI Integration",
      category: "Technical",
      lastUpdated: currentDate,
      content: `## AI Providers & Integration

### Supported AI Models
- OpenAI GPT-5
- Anthropic Claude Sonnet 4
- Google Gemini 2.5

### Multi-Provider Fallback
The platform implements intelligent fallback between providers:
1. Primary provider attempt
2. Automatic fallback to secondary provider on failure
3. Rate limit handling with exponential backoff

### AI Features
- Trade idea generation with fundamental analysis
- Chart screenshot analysis for technical patterns
- QuantAI Bot for conversational market research
- Hybrid AI+Quant system combining signals

### Conversation History
- Chat history persisted in PostgreSQL
- User-specific conversation threads
- Auto-save of structured trade ideas from AI responses`
    },
    {
      title: "Data Sources",
      category: "Technical",
      lastUpdated: currentDate,
      content: `## External Data Sources

### Market Data
- CoinGecko API: Crypto real-time prices, historical data, market cap
- Yahoo Finance: Stock quotes, discovery, historical data
- Alpha Vantage: Breaking news, earnings calendar, fallback for stocks
- Tradier API: Options chains, delta targeting, live pricing

### Data Caching Strategy
- Critical trading data: 30s refetch + 15s staleTime
- System metrics: 30s refetch + 15s staleTime
- Secondary analytics: 1hr refetch + 30min staleTime
- Server price cache: 60s TTL
- Performance stats cache: 5min TTL`
    },
    {
      title: "Performance Tracking",
      category: "Analytics",
      lastUpdated: currentDate,
      content: `## Performance Analytics

### Validation System
- Auto-validates trade outcomes (target hit vs stop hit)
- Win rate tracking per engine source
- Confidence score calibration

### Minimum Loss Threshold
Platform-wide 3% minimum loss threshold:
- Losses below 3% treated as "breakeven"
- Aligns with stop-loss rules (stocks 3.5%, crypto 5%)
- Filters noise from tight stops

### Analytics Dashboards
1. Symbol Performance Leaderboard
2. Time-of-Day Heatmap
3. Engine Performance Over Time
4. Confidence Score Calibration
5. Win/Loss Streak Tracker

### Performance Grading
- Trades graded based on outcome vs prediction
- Historical win rate by engine, symbol, time`
    },
    {
      title: "User Interface",
      category: "Frontend",
      lastUpdated: currentDate,
      content: `## UI/UX Design

### Theme
- Bloomberg-style dark theme with deep charcoal backgrounds
- Gradients, shadows, and glassmorphism effects
- Light/dark mode toggle available

### Color Palette
- Green: Bullish signals
- Red: Bearish signals
- Amber: Neutral/warning states
- Blue: Primary actions

### Typography
- Inter: UI elements
- JetBrains Mono: Financial data display

### Navigation Structure
Main Section: Home, Trade Desk, Trading Rules
More Section: Performance, Market, Chart Analysis
System Section: Settings, Admin (role-conditional)

### Key Components
- Collapsible sidebar navigation
- Real-time price displays
- Trade idea cards with source badges
- Performance charts (Recharts)
- 3D Visual Analytics (React Three Fiber)`
    },
    {
      title: "Authentication & Security",
      category: "Technical",
      lastUpdated: currentDate,
      content: `## Security Implementation

### Authentication Methods
- Replit Auth (OpenID Connect)
- Google OAuth
- GitHub OAuth
- Apple Sign-In
- Email/password

### Session Management
- PostgreSQL session storage (connect-pg-simple)
- 7-day session TTL
- HTTP-only cookies for admin JWT

### Access Control
- Free, Premium, and Admin tiers
- requireAdmin middleware for admin routes
- requirePremium middleware for premium features
- Password-protected admin panel with separate JWT

### Rate Limiting
- API rate limiting implemented
- Per-user daily usage tracking
- Tier-based limits enforcement`
    },
    {
      title: "Database Schema",
      category: "Technical",
      lastUpdated: currentDate,
      content: `## Database Architecture

### Technology Stack
- PostgreSQL (Neon-backed)
- Drizzle ORM
- Zod validation

### Core Tables
- users: User accounts and preferences
- sessions: Authentication sessions
- trade_ideas: Generated trade suggestions
- watchlist: User watchlist items
- daily_usage: Tier usage tracking
- catalysts: Market catalyst events
- chat_history: AI conversation logs

### Trade Ideas Schema
- Symbol, direction, entry/stop/target prices
- Asset type (stock, crypto, option, future)
- Source (ai, quant, hybrid, flow, news, chart, lotto)
- Confidence score and probability bands
- Timing windows (entry/exit times)
- Resolution status and P&L tracking`
    },
    {
      title: "API Endpoints",
      category: "Technical",
      lastUpdated: currentDate,
      content: `## REST API Reference

### Trade Ideas
- GET /api/trade-ideas - List all trade ideas
- POST /api/trade-ideas - Create manual trade idea
- PATCH /api/trade-ideas/:id - Update trade idea
- DELETE /api/trade-ideas/:id - Delete trade idea

### Generation
- POST /api/generate-ideas - Generate AI trade ideas
- POST /api/generate-quant-ideas - Generate quant trade ideas
- POST /api/generate-hybrid-ideas - Generate hybrid ideas

### Performance
- GET /api/performance/stats - Overall performance stats
- GET /api/performance/engine-trends - Weekly engine trends
- GET /api/performance/symbol-leaderboard - Top symbols
- GET /api/performance/time-heatmap - Time-of-day analysis

### User
- GET /api/auth/me - Current user info
- GET /api/user/tier - Tier info and usage
- GET /api/user/preferences - User preferences
- POST /api/user/preferences - Update preferences

### Market Data
- GET /api/market/quote/:symbol - Real-time quote
- GET /api/market/crypto/:symbol - Crypto price
- GET /api/catalysts - Market catalysts`
    }
  ];

  try {
    await clearDatabase();
    
    let pagesCreated = 0;
    for (const section of documentation) {
      await createDocPage(section);
      pagesCreated++;
    }

    logger.info(`Successfully synced ${pagesCreated} documentation pages to Notion`);
    return { success: true, pagesCreated };
  } catch (error: any) {
    logger.error("Error syncing to Notion:", error);
    return { success: false, pagesCreated: 0, error: error.message };
  }
}
