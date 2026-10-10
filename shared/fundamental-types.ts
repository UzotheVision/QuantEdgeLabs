/**
 * Fundamental Analysis Types
 *
 * Type definitions for fundamental data, financial metrics, and stock analysis
 */

export interface FinancialStatement {
  date: string;
  revenue: number;
  netIncome: number;
  grossProfit: number;
  operatingIncome: number;
  ebitda: number;
  eps: number;
  sharesOutstanding: number;
}

export interface BalanceSheet {
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentAssets: number;
  currentLiabilities: number;
  longTermDebt: number;
  cash: number;
}

export interface CashFlow {
  date: string;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  freeCashFlow: number;
  capitalExpenditure: number;
}

export interface FinancialRatios {
  // Valuation
  peRatio: number | null;
  pbRatio: number | null;
  pegRatio: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;

  // Profitability
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null; // Return on Equity
  roa: number | null; // Return on Assets
  roic: number | null; // Return on Invested Capital

  // Liquidity & Solvency
  currentRatio: number | null;
  quickRatio: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;

  // Growth
  revenueGrowthYoY: number | null;
  revenueGrowthQoQ: number | null;
  epsGrowthYoY: number | null;

  // Dividend
  dividendYield: number | null;
  payoutRatio: number | null;
  dividendGrowth: number | null;
}

export interface CompanyProfile {
  symbol: string;
  companyName: string;
  exchange: string;
  sector: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  ceo: string | null;
  employees: number | null;
  marketCap: number | null;
  country: string | null;
}

export interface AnalystEstimates {
  symbol: string;
  targetPrice: number | null;
  numberOfAnalysts: number;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  consensus: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell';
}

export interface InsiderTrading {
  symbol: string;
  filingDate: string;
  transactionDate: string;
  insider: string;
  position: string;
  transactionType: 'Buy' | 'Sell';
  shares: number;
  pricePerShare: number;
  totalValue: number;
}

export interface InstitutionalOwnership {
  symbol: string;
  institution: string;
  shares: number;
  dateReported: string;
  percentHeld: number;
  changePercent: number;
}

export interface CompanyFundamentals {
  profile: CompanyProfile;
  ratios: FinancialRatios;
  incomeStatement: FinancialStatement[];
  balanceSheet: BalanceSheet[];
  cashFlow: CashFlow[];
  analystEstimates?: AnalystEstimates;
  insiderTrading?: InsiderTrading[];
  institutionalOwnership?: InstitutionalOwnership[];
  lastUpdated: string;
}

export interface FundamentalScore {
  category: 'Financial Health' | 'Valuation' | 'Growth' | 'Dividend' | 'Quality';
  score: number; // 0-100
  weight: number; // 0-1
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  metrics: {
    name: string;
    value: number | string | null;
    score: number;
    benchmark?: number;
    interpretation: string;
  }[];
}

export interface ComprehensiveGrade {
  symbol: string;
  overallScore: number; // 0-100
  overallGrade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

  technicalScore: number;
  technicalGrade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

  fundamentalScore: number;
  fundamentalGrade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

  sentimentScore?: number;
  sentimentGrade?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

  aiConfidence?: number;

  breakdown: FundamentalScore[];

  strengths: string[];
  weaknesses: string[];

  generatedAt: string;
}

export interface PeerComparison {
  symbol: string;
  peers: string[];
  comparisonMetrics: {
    symbol: string;
    companyName: string;
    marketCap: number | null;
    peRatio: number | null;
    revenueGrowth: number | null;
    profitMargin: number | null;
    roe: number | null;
    debtToEquity: number | null;
    overallGrade: string;
  }[];
}
