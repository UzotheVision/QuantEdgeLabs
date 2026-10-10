export interface SEOMetadata {
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: "summary" | "summary_large_image";
  keywords?: string[];
  canonical?: string;
}

// High-value keywords for AI trading search ranking
const CORE_KEYWORDS = [
  // Primary targets (highest search volume)
  "AI trading",
  "AI stock analysis",
  "stock research AI",
  "AI trading platform",
  "AI powered trading",

  // Secondary targets
  "quantitative trading",
  "AI trading signals",
  "AI stock picker",
  "automated stock analysis",
  "AI market analysis",

  // Long-tail keywords (lower competition, high intent)
  "best AI trading tool",
  "AI trading for beginners",
  "free AI stock analysis",
  "AI options trading",
  "AI crypto trading",

  // Feature-specific keywords
  "AI chart analysis",
  "AI technical analysis",
  "quantitative trading signals",
  "algorithmic trading platform",
  "real-time trading AI",
];

export const DEFAULT_SEO: SEOMetadata = {
  title: "Quant Edge Labs | Quantitative Trading Research Platform",
  description: "Free quantitative stock analysis with a 14-layer confluence scoring engine. Trade ideas, options flow, gamma exposure, and chart pattern recognition for stocks, options & crypto.",
  ogImage: "/og-image.png",
  twitterCard: "summary_large_image",
  keywords: CORE_KEYWORDS,
};

export const PAGE_SEO: Record<string, SEOMetadata> = {
  landing: {
    title: "Quant Edge Labs | Quantitative Stock Analysis & Trading Signals",
    description: "Free quantitative trading platform with a 14-layer confluence scoring engine. Trade ideas, gamma exposure, options flow, and chart pattern recognition across stocks, options, and crypto.",
    ogTitle: "Quant Edge Labs - Quantitative Trading Research Platform",
    ogDescription: "Free quantitative stock research platform. 14-layer confluence engine, real-time signals, and gamma-exposure analysis for stocks, options & crypto.",
    keywords: [
      "AI trading platform",
      "AI stock analysis free",
      "quantitative trading signals",
      "best AI for stock trading",
      "AI trading software",
      "automated stock research",
      "AI investment platform",
      "stock market AI",
    ],
  },
  home: {
    title: "Dashboard | Quant Edge Labs Trading Platform",
    description: "Your quantitative trading command center. Market data, scanner-generated trade ideas, and confluence scoring across stocks, options, and crypto.",
    ogTitle: "Quant Edge Labs Dashboard - Quantitative Trading Signals",
    ogDescription: "Quantitative trading signals and market analysis powered by a 14-layer confluence scoring engine.",
    keywords: [
      "AI trading dashboard",
      "real-time AI signals",
      "AI market scanner",
      "stock market AI analysis",
      "AI trade ideas",
    ],
  },
  pricing: {
    title: "Pricing | Free AI Trading Platform - Quant Edge Labs",
    description: "Start free with quantitative stock analysis and trading signals. Upgrade for advanced features, unlimited scans, and priority insights.",
    ogTitle: "Quant Edge Labs Pricing - Free Trading Tools",
    ogDescription: "Free quantitative trading analysis. Premium plans for serious traders with advanced confluence scoring features.",
    keywords: [
      "free AI trading platform",
      "AI trading subscription",
      "best free AI stock analysis",
      "AI trading tools pricing",
      "quantitative trading cost",
    ],
  },
  about: {
    title: "About QuantEdge Labs | Research Method and Founder",
    description: "Learn how QuantEdge Labs combines systems engineering, model-risk discipline and quantitative market research. Founded by Abdulmalik Ajisegiri.",
    ogTitle: "About QuantEdge Labs",
    ogDescription: "The research method and systems-engineering discipline behind QuantEdge Labs.",
    keywords: [
      "about Quant Edge Labs",
      "AI trading startup",
      "quantitative fintech",
      "quantitative trading company",
    ],
  },
  blog: {
    title: "AI Trading Blog | Stock Analysis & Market Insights - Quant Edge Labs",
    description: "Learn trading strategies, quantitative market analysis, and scoring methods. Expert insights on using confluence engines for stock research and trading signals.",
    ogTitle: "Quant Edge Labs Blog - Trading Insights",
    ogDescription: "Expert trading education, market analysis, and quantitative strategies for traders.",
    keywords: [
      "AI trading blog",
      "quantitative trading strategies",
      "AI stock analysis tips",
      "how to use AI for trading",
      "AI trading education",
      "stock market AI insights",
      "AI trading tutorial",
      "quantitative investing",
    ],
  },
  successStories: {
    title: "Trading Results | Real Trades & Performance - Quant Edge Labs",
    description: "Verified trading results and winning trades from our 14-layer quantitative confluence engine. See real performance data and trade outcomes.",
    ogTitle: "AI Trading Success Stories - Real Results",
    ogDescription: "Browse verified winning trades generated by our quantitative analysis layers.",
    keywords: [
      "AI trading results",
      "AI stock picks performance",
      "quantitative trading success",
      "AI trading track record",
      "verified AI trades",
    ],
  },
  tradeDesk: {
    title: "AI Trade Desk | Real-Time Trading Signals - Quant Edge Labs",
    description: "Your trading command center. Access real-time confluence scoring signals, scanner-generated trade ideas, and quantitative analysis across all markets.",
    ogTitle: "Quant Edge Labs Trade Desk",
    ogDescription: "Real-time quantitative trading signals and confluence analysis for stocks, options, and crypto.",
    keywords: [
      "AI trade desk",
      "real-time trading signals",
      "trading terminal",
      "quantitative trade signals",
      "AI stock scanner",
    ],
  },
  performance: {
    title: "Trading Performance | Analytics & Win Rates - Quant Edge Labs",
    description: "Transparent trading performance metrics. Track hit rates, returns, and analytics across each scanner source — with sample sizes and breakeven thresholds disclosed.",
    ogTitle: "Quant Edge Labs AI Performance Analytics",
    ogDescription: "Transparent performance tracking for our quantitative confluence trading signals.",
    keywords: [
      "AI trading performance",
      "quantitative trading win rate",
      "AI signal analytics",
      "AI trading pattern scanner results",
    ],
  },
  chartAnalysis: {
    title: "AI Chart Analysis | Pattern Recognition & Technical Analysis - Quant Edge Labs",
    description: "Upload trading charts for instant pattern recognition. Quantitative analysis identifies support, resistance, trends, and trading opportunities automatically.",
    ogTitle: "Chart Analysis - Instant Pattern Recognition",
    ogDescription: "Chart pattern recognition and technical analysis. Upload any chart for instant quantitative insights.",
    keywords: [
      "AI chart analysis",
      "AI pattern recognition trading",
      "quantitative technical analysis",
      "AI chart reading",
      "automated chart analysis",
      "AI candlestick pattern recognition",
      "best AI for chart analysis",
    ],
  },
  academy: {
    title: "Trading Academy | Learn Quantitative Trading - Quant Edge Labs",
    description: "Free trading courses and tutorials. Learn how to use quantitative scoring for stock analysis, confluence strategies, and algorithmic trading.",
    ogTitle: "Quant Edge Labs Academy - Learn Trading",
    ogDescription: "Master trading with free courses on quantitative analysis, confluence scoring, and algorithmic strategies.",
    keywords: [
      "AI trading course",
      "learn AI trading",
      "quantitative trading tutorial",
      "AI trading for beginners",
      "algorithmic trading course",
      "quantitative trading education",
    ],
  },
  discover: {
    title: "AI Stock Discovery | Find Trading Opportunities - Quant Edge Labs",
    description: "Discover high-potential stocks with quantitative scoring. Our scanners analyze thousands of stocks to find breakout candidates, momentum plays, and undervalued opportunities.",
    ogTitle: "Stock Discovery - Find Your Next Trade",
    ogDescription: "Quantitative stock discovery. Let confluence scoring find your next winning trade.",
    keywords: [
      "AI stock discovery",
      "AI stock screener",
      "quantitative stock picks",
      "AI find stocks",
      "automated stock discovery",
      "AI stock scanner free",
    ],
  },
  research: {
    title: "AI Stock Research | Deep Analysis & Reports - Quant Edge Labs",
    description: "Institutional-grade stock research. Get comprehensive quantitative analysis, fundamental scores, and technical ratings for any stock.",
    ogTitle: "Stock Research - Deep Analysis",
    ogDescription: "Quantitative stock research with fundamental and technical analysis powered by a 14-layer confluence engine.",
    keywords: [
      "AI stock research",
      "AI fundamental analysis",
      "quantitative stock analysis",
      "AI equity research",
      "automated stock research",
      "AI stock report",
    ],
  },
};

export function generateSEO(pageKey?: string, overrides?: Partial<SEOMetadata>): SEOMetadata {
  const pageSeo: Partial<SEOMetadata> = pageKey && PAGE_SEO[pageKey] ? PAGE_SEO[pageKey] : {};
  // SEOHead passes every prop, most of them undefined — and spreading
  // {title: undefined} OVERWRITES the page's title. Every page using SEOHead
  // shipped with document.title "undefined" (UI validation 2026-09-24).
  const set = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<SEOMetadata>;

  return {
    ...DEFAULT_SEO,
    ...pageSeo,
    ...set,
    ogTitle: overrides?.ogTitle || pageSeo.ogTitle || overrides?.title || pageSeo.title || DEFAULT_SEO.title,
    ogDescription: overrides?.ogDescription || pageSeo.ogDescription || overrides?.description || pageSeo.description || DEFAULT_SEO.description,
  };
}

export function formatTitle(title: string, siteName: string = "Quant Edge Labs"): string {
  if (title.includes(siteName)) return title;
  return `${title} | ${siteName}`;
}

// Generate dynamic SEO for stock detail pages
export function generateStockSEO(symbol: string, companyName?: string): SEOMetadata {
  const name = companyName || symbol;
  return {
    title: `${symbol} AI Analysis | Stock Research & Signals - Quant Edge Labs`,
    description: `Quantitative ${name} (${symbol}) analysis. Get confluence scoring, technical signals, fundamental scores, and real-time trading insights.`,
    ogTitle: `${symbol} Stock Analysis - Quant Edge Labs`,
    ogDescription: `Quantitative analysis for ${name}. Confluence scoring, technical patterns, and research.`,
    keywords: [
      `${symbol} AI analysis`,
      `${symbol} stock prediction`,
      `${symbol} quantitative analysis`,
      `${symbol} trading signals`,
      `AI analysis ${symbol}`,
    ],
    twitterCard: "summary_large_image",
    ogImage: "/og-image.png",
  };
}

// Generate dynamic SEO for blog posts
export function generateBlogPostSEO(title: string, excerpt: string, slug: string): SEOMetadata {
  return {
    title: `${title} | AI Trading Blog - Quant Edge Labs`,
    description: excerpt.slice(0, 160),
    ogTitle: title,
    ogDescription: excerpt.slice(0, 160),
    canonical: `https://quantedgelabs.net/blog/${slug}`,
    keywords: [
      "AI trading",
      "quantitative trading",
      "stock analysis",
      ...title.toLowerCase().split(' ').filter(w => w.length > 4),
    ],
    twitterCard: "summary_large_image",
    ogImage: "/og-image.png",
  };
}
