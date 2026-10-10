/**
 * Universal Search Types
 *
 * Types for the platform-wide search system
 */

export type SearchCategory = 'stocks' | 'crypto' | 'news' | 'ideas' | 'actions' | 'help' | 'all';

export interface SearchResult {
  id: string;
  category: SearchCategory;
  title: string;
  subtitle?: string;
  description?: string;
  icon?: string;
  url: string;
  metadata?: Record<string, any>;
  relevanceScore?: number;
}

export interface StockSearchResult extends SearchResult {
  category: 'stocks';
  symbol: string;
  companyName: string;
  exchange: string;
  price?: number;
  change?: number;
  changePercent?: number;
  grade?: string;
  sector?: string;
}

export interface CryptoSearchResult extends SearchResult {
  category: 'crypto';
  symbol: string;
  name: string;
  price?: number;
  change?: number;
  changePercent?: number;
  marketCap?: number;
}

export interface NewsSearchResult extends SearchResult {
  category: 'news';
  headline: string;
  source: string;
  publishedAt: string;
  symbols?: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  imageUrl?: string;
}

export interface TradeIdeaSearchResult extends SearchResult {
  category: 'ideas';
  symbol: string;
  direction: 'long' | 'short';
  confidence: number;
  engine: string;
  strategy: string;
  entryPrice: number;
  targetPrice: number;
  createdAt: string;
}

export interface ActionSearchResult extends SearchResult {
  category: 'actions';
  action: string;
  label: string;
  icon: string;
  parameters?: Record<string, string>;
}

export interface HelpSearchResult extends SearchResult {
  category: 'help';
  topic: string;
  section: string;
  tags: string[];
}

export type AnySearchResult =
  | StockSearchResult
  | CryptoSearchResult
  | NewsSearchResult
  | TradeIdeaSearchResult
  | ActionSearchResult
  | HelpSearchResult;

export interface SearchResponse {
  query: string;
  results: AnySearchResult[];
  categories: {
    category: SearchCategory;
    count: number;
    results: AnySearchResult[];
  }[];
  totalResults: number;
  searchTime: number; // ms
}

export interface SearchSuggestion {
  text: string;
  category: SearchCategory;
  icon?: string;
  metadata?: Record<string, any>;
}

export interface TrendingSearch {
  query: string;
  category: SearchCategory;
  count: number;
  trendDirection: 'up' | 'down' | 'stable';
}

export interface RecentSearch {
  userId: string;
  query: string;
  category: SearchCategory;
  timestamp: string;
  resultClicked?: string;
}

export interface SearchFilters {
  categories?: SearchCategory[];
  dateRange?: {
    from: string;
    to: string;
  };
  minConfidence?: number;
  sectors?: string[];
  exchanges?: string[];
}
