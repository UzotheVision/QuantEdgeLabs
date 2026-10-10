import { generateAIAnalysis } from "./ai-service";
import { log } from "./vite";

interface AnalysisRequest {
  symbol: string;
  analysisType: "swing_trade" | "buy_sell" | "technical" | "news_sentiment" | "fundamental" | "market_outlook";
}

interface AnalysisResult {
  symbol: string;
  type: string;
  signal: "BUY" | "SELL" | "HOLD" | "WAIT";
  confidence: number;
  timestamp: string;
  summary: string;
  synthetic?: boolean; // true when returning stub data (AI unavailable)
  sections: AnalysisSection[];
}

interface AnalysisSection {
  title: string;
  content?: string;
  metrics?: { name: string; value: number | string; signal: string }[];
  levels?: { entry: string; stop: string; target1: string; target2: string };
}

const analysisPrompts: Record<string, string> = {
  swing_trade: `Analyze this stock for a SWING TRADE opportunity (3-15 day hold).
Provide:
1. Executive Summary with clear BUY/SELL/HOLD/WAIT signal
2. Multi-timeframe technical analysis (Daily, 4H, Weekly alignment)
3. Entry zone, stop loss, and profit targets with R/R ratio
4. Key risks and catalysts
5. Confidence level (0-100%)`,

  buy_sell: `Provide a BUY or SELL investment rating for this stock.
Include:
1. Overall rating (Strong Buy, Buy, Hold, Sell, Strong Sell)
2. Price target and upside/downside potential
3. Key investment thesis
4. Risk factors
5. Confidence level (0-100%)`,

  technical: `Perform comprehensive TECHNICAL ANALYSIS on this stock.
Cover:
1. Trend analysis across multiple timeframes
2. Key support and resistance levels
3. Momentum indicators (RSI, MACD, Stochastic)
4. Volume analysis
5. Chart patterns
6. Clear signal (Bullish/Bearish/Neutral)`,

  news_sentiment: `Analyze NEWS SENTIMENT for this stock.
Evaluate:
1. Recent news and headlines
2. Overall sentiment (Bullish/Bearish/Neutral)
3. Key catalysts and events
4. Social media sentiment if relevant
5. Impact assessment on price`,

  fundamental: `Perform FUNDAMENTAL ANALYSIS on this stock.
Assess:
1. Valuation metrics (P/E, P/S, P/B, EV/EBITDA)
2. Financial health (debt, cash flow, margins)
3. Growth metrics (revenue, earnings growth)
4. Competitive position
5. Fair value estimate`,

  market_outlook: `Provide MARKET OUTLOOK and context for trading this stock.
Include:
1. Sector performance
2. Market regime (risk-on/risk-off)
3. Correlation with major indices
4. Macro factors affecting the stock
5. Best trading strategy given current conditions`,
};

export async function runResearchAnalysis(request: AnalysisRequest): Promise<AnalysisResult> {
  const { symbol, analysisType } = request;
  
  log(`[RESEARCH] Running ${analysisType} analysis on ${symbol}`, "info");
  
  try {
    const prompt = `
${analysisPrompts[analysisType]}

Stock: ${symbol}
Date: ${new Date().toLocaleDateString()}

IMPORTANT: Structure your response as JSON with the following format:
{
  "signal": "BUY" | "SELL" | "HOLD" | "WAIT",
  "confidence": 0-100,
  "summary": "One paragraph executive summary",
  "sections": [
    {
      "title": "Section Title",
      "content": "Analysis content..."
    }
  ],
  "entry": "price if applicable",
  "stop": "price if applicable", 
  "target1": "price if applicable",
  "target2": "price if applicable"
}
`;

    // Try AI analysis
    const aiResponse = await generateAIAnalysis(prompt);
    
    if (aiResponse) {
      try {
        // Try to parse as JSON
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            symbol,
            type: analysisType,
            signal: parsed.signal || "HOLD",
            confidence: parsed.confidence || 70,
            timestamp: new Date().toISOString(),
            summary: parsed.summary || aiResponse.slice(0, 200),
            sections: formatSections(parsed, analysisType),
          };
        }
      } catch (parseError) {
        // If JSON parsing fails, extract key info from text
        log(`[RESEARCH] JSON parse failed, using text extraction`, "warn");
      }
      
      // Text-based extraction fallback
      const signal = extractSignal(aiResponse);
      const confidence = extractConfidence(aiResponse);
      
      return {
        symbol,
        type: analysisType,
        signal,
        confidence,
        timestamp: new Date().toISOString(),
        summary: aiResponse.slice(0, 500),
        sections: [
          {
            title: "Executive Summary",
            content: aiResponse.slice(0, 800),
          },
          {
            title: "Technical Analysis",
            metrics: generateTechnicalMetrics(signal),
          },
          {
            title: "Entry & Risk Management",
            levels: generateLevels(symbol, signal),
          },
        ],
      };
    }
    
    // Fallback to quantitative analysis
    return generateQuantAnalysis(symbol, analysisType);
    
  } catch (error) {
    log(`[RESEARCH] Analysis error: ${error}`, "error");
    return generateQuantAnalysis(symbol, analysisType);
  }
}

function extractSignal(text: string): "BUY" | "SELL" | "HOLD" | "WAIT" {
  const upperText = text.toUpperCase();
  if (upperText.includes("STRONG BUY") || upperText.includes("BULLISH")) return "BUY";
  if (upperText.includes("STRONG SELL") || upperText.includes("BEARISH")) return "SELL";
  if (upperText.includes("WAIT") || upperText.includes("PULLBACK")) return "WAIT";
  if (upperText.includes("BUY")) return "BUY";
  if (upperText.includes("SELL")) return "SELL";
  return "HOLD";
}

function extractConfidence(text: string): number {
  const match = text.match(/(\d{1,3})\s*%?\s*(confidence|conviction)/i);
  if (match) return Math.min(100, parseInt(match[1]));
  
  const upperText = text.toUpperCase();
  if (upperText.includes("HIGH CONFIDENCE") || upperText.includes("STRONG")) return 85;
  if (upperText.includes("MEDIUM") || upperText.includes("MODERATE")) return 65;
  if (upperText.includes("LOW") || upperText.includes("UNCERTAIN")) return 45;
  
  return 70;
}

function formatSections(parsed: any, analysisType: string): AnalysisSection[] {
  const sections: AnalysisSection[] = [];
  
  if (parsed.summary) {
    sections.push({
      title: "Executive Summary",
      content: parsed.summary,
    });
  }
  
  if (parsed.sections) {
    sections.push(...parsed.sections);
  }
  
  // Add technical metrics section
  sections.push({
    title: "Technical Analysis",
    metrics: generateTechnicalMetrics(parsed.signal),
  });
  
  // Add levels if available
  if (parsed.entry || parsed.stop || parsed.target1) {
    sections.push({
      title: "Entry & Risk Management",
      levels: {
        entry: parsed.entry || "N/A",
        stop: parsed.stop || "N/A",
        target1: parsed.target1 || "N/A",
        target2: parsed.target2 || "N/A",
      },
    });
  }
  
  return sections;
}

function generateTechnicalMetrics(_signal: string): { name: string; value: number | string; signal: string }[] {
  // No real data available — return null values instead of fabricated metrics
  return [
    { name: "RSI(14)", value: "N/A", signal: "unavailable" },
    { name: "MACD", value: "N/A", signal: "unavailable" },
    { name: "Volume Ratio", value: "N/A", signal: "unavailable" },
  ];
}

function generateLevels(_symbol: string, _signal: string): { entry: string; stop: string; target1: string; target2: string } {
  // No real price data — return N/A instead of fabricated levels
  return {
    entry: "N/A",
    stop: "N/A",
    target1: "N/A",
    target2: "N/A",
  };
}

function generateQuantAnalysis(symbol: string, analysisType: string): AnalysisResult {
  // Stub fallback when AI is unavailable — no fabricated signals
  return {
    symbol,
    type: analysisType,
    signal: "WAIT",
    confidence: 0,
    timestamp: new Date().toISOString(),
    summary: `Analysis for ${symbol} is currently unavailable. AI service is offline and no cached analysis exists. Please try again later.`,
    synthetic: true,
    sections: [
      {
        title: "Executive Summary",
        content: `Real-time analysis for ${symbol} is temporarily unavailable. This is a placeholder response — no signals or recommendations should be acted upon.`,
      },
      {
        title: "Technical Analysis",
        metrics: generateTechnicalMetrics("WAIT"),
      },
      {
        title: "Entry & Risk Management",
        levels: generateLevels(symbol, "WAIT"),
      },
    ],
  };
}

export const researchService = {
  runAnalysis: runResearchAnalysis,
};
