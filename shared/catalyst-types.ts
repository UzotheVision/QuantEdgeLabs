/**
 * Catalyst Intelligence Types
 *
 * Types for tracking market-moving catalysts:
 * - Insider buying/selling (SEC Form 4)
 * - Government contracts (DOD, NASA, etc.)
 * - M&A announcements
 * - Unusual options activity
 * - FDA decisions (biotech)
 * - Earnings surprises
 */

export type CatalystType =
  | 'insider_buy'
  | 'insider_sell'
  | 'gov_contract'
  | 'merger'
  | 'acquisition'
  | 'partnership'
  | 'fda_approval'
  | 'fda_rejection'
  | 'earnings_beat'
  | 'earnings_miss'
  | 'guidance_raise'
  | 'guidance_cut'
  | 'unusual_options'
  | 'analyst_upgrade'
  | 'analyst_downgrade'
  | 'stock_buyback'
  | 'dividend_increase'
  | 'institutional_buy'
  | 'sec_13f';

export type CatalystImpact = 'high' | 'medium' | 'low';
export type CatalystSentiment = 'bullish' | 'bearish' | 'neutral';

export interface Catalyst {
  id: string;
  symbol: string;
  companyName?: string;
  type: CatalystType;
  title: string;
  description: string;
  impact: CatalystImpact;
  sentiment: CatalystSentiment;
  value?: number; // Dollar amount (contract value, shares bought, etc.)
  valueFormatted?: string; // "$1.6B", "49,000 shares"
  source: string;
  sourceUrl?: string;
  filingDate: string; // ISO date
  announcedAt: string; // ISO datetime
  expiresAt?: string; // When this catalyst is no longer relevant
  relatedSymbols?: string[];
  tags?: string[];
}

// Insider trade from SEC Form 4
export interface InsiderTrade extends Catalyst {
  type: 'insider_buy' | 'insider_sell';
  insiderName: string;
  insiderTitle: string; // CEO, CFO, Director, etc.
  shares: number;
  pricePerShare: number;
  totalValue: number;
  ownershipAfter?: number;
  transactionCode: string; // P = Purchase, S = Sale
}

// Government contract
export interface GovContract extends Catalyst {
  type: 'gov_contract';
  contractValue: number;
  agency: string; // DOD, NASA, HHS, etc.
  contractType: string; // IDIQ, Firm-Fixed-Price, etc.
  duration?: string; // "5 years", "through 2030"
  competitors?: string[]; // Other bidders
}

// M&A activity
export interface MergerAcquisition extends Catalyst {
  type: 'merger' | 'acquisition' | 'partnership';
  dealValue?: number;
  acquirer?: string;
  target?: string;
  dealType: 'cash' | 'stock' | 'mixed';
  premium?: number; // % premium to current price
  expectedClose?: string;
  status: 'announced' | 'pending' | 'completed' | 'terminated';
}

// Unusual options activity
export interface UnusualOptions extends Catalyst {
  type: 'unusual_options';
  optionType: 'call' | 'put';
  strikePrice: number;
  expirationDate: string;
  volume: number;
  openInterest: number;
  volumeOiRatio: number;
  premium: number;
  impliedMove?: number; // Expected move %
  sentiment: 'bullish' | 'bearish';
}

// FDA decision
export interface FdaDecision extends Catalyst {
  type: 'fda_approval' | 'fda_rejection';
  drugName: string;
  indication: string; // Disease/condition
  pdfuaDate?: string; // Target action date
  phase?: string; // Phase 3, BLA, NDA, etc.
  marketSize?: number; // Addressable market
}

// Analyst rating change
export interface AnalystRating extends Catalyst {
  type: 'analyst_upgrade' | 'analyst_downgrade';
  analystFirm: string;
  analystName?: string;
  previousRating?: string;
  newRating: string;
  previousTarget?: number;
  newTarget: number;
}

// Institutional 13F filing
export interface Institutional13F extends Catalyst {
  type: 'sec_13f' | 'institutional_buy';
  fundName: string;
  fundManager?: string;
  shares: number;
  value: number;
  changePercent?: number; // % change in position
  portfolioPercent?: number; // % of fund's portfolio
  quarterEnd: string; // Q4 2025, Q1 2026
}

// Union type for all catalyst types
export type AnyCatalyst =
  | InsiderTrade
  | GovContract
  | MergerAcquisition
  | UnusualOptions
  | FdaDecision
  | AnalystRating
  | Institutional13F
  | Catalyst;

// API response for catalyst feed
export interface CatalystFeed {
  catalysts: AnyCatalyst[];
  bySymbol: Record<string, AnyCatalyst[]>;
  byType: Record<CatalystType, AnyCatalyst[]>;
  highImpact: AnyCatalyst[];
  lastUpdated: string;
  totalCount: number;
}

// Catalyst alert for real-time notifications
export interface CatalystAlert {
  id: string;
  catalyst: AnyCatalyst;
  priority: 'urgent' | 'high' | 'normal';
  notifiedAt?: string;
  acknowledged?: boolean;
}

// Stock with catalyst enrichment (for surge detection integration)
export interface StockWithCatalysts {
  symbol: string;
  catalysts: AnyCatalyst[];
  catalystScore: number; // 0-100 based on catalyst quality
  topCatalyst?: AnyCatalyst;
  hasBullishCatalyst: boolean;
  hasBearishCatalyst: boolean;
  catalystSummary?: string; // "CEO bought $2.1M, $816M DOD contract"
}
