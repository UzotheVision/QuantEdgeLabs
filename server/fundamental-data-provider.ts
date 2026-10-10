/**
 * Fundamental Data Provider
 *
 * Abstraction layer for fetching fundamental data from multiple sources
 * Priority: Yahoo Finance (free) > Alpha Vantage (free 500/day) > FMP (fallback)
 */

import type {
  CompanyFundamentals,
  CompanyProfile,
  FinancialRatios,
  FinancialStatement,
  BalanceSheet,
  CashFlow,
} from '../shared/fundamental-types';

export class FundamentalDataProvider {
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Get comprehensive fundamentals for a symbol
   */
  async getFundamentals(symbol: string): Promise<CompanyFundamentals | null> {
    const cacheKey = `fundamentals:${symbol}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      // Fetch from Yahoo Finance first (primary source)
      const data = await this.fetchFromYahoo(symbol);

      if (data) {
        this.setCache(cacheKey, data);
        return data;
      }

      // Fallback: Try Alpha Vantage
      const avData = await this.fetchFromAlphaVantage(symbol);
      if (avData) {
        this.setCache(cacheKey, avData);
        return avData;
      }

      /**
       * Third fallback: Finnhub.
       *
       * Both sources above are currently dead — Yahoo answers 429 and Alpha
       * Vantage's free tier is 25 requests/day and exhausted. With no third
       * source this method returned null, and the fundamental scorer then
       * emitted 50 with an EMPTY breakdown: a number with nothing behind it and
       * no marker saying so.
       *
       * Finnhub covers the ten ratios grade-calculator.ts reads. It does not
       * carry statements, so those stay empty — the scorer weights ratios and
       * tolerates that, but anything added later that walks incomeStatement
       * must check length rather than assume it is populated.
       */
      const fhData = await this.fetchFromFinnhub(symbol);
      if (fhData) {
        this.setCache(cacheKey, fhData);
        return fhData;
      }

      return null;
    } catch (error) {
      console.error(`Error fetching fundamentals for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch ratios from Finnhub (third fallback — see getFundamentals).
   *
   * Returns ratios and profile only. Statements are left empty because the free
   * tier does not carry them; callers must not assume they are populated.
   */
  private async fetchFromFinnhub(symbol: string): Promise<CompanyFundamentals | null> {
    try {
      const { getFinnhubRatios, getCompanyProfile } = await import('./finnhub-adapter');
      const [r, prof] = await Promise.all([
        getFinnhubRatios(symbol),
        getCompanyProfile(symbol).catch(() => null),
      ]);
      if (!r) return null;

      const ratios: FinancialRatios = {
        peRatio: r.peRatio, pbRatio: r.pbRatio, pegRatio: r.pegRatio,
        priceToSales: r.priceToSales, evToEbitda: null,
        grossMargin: null, operatingMargin: null, netMargin: r.netMargin,
        roe: r.roe, roa: null, roic: null,
        currentRatio: r.currentRatio, quickRatio: null,
        debtToEquity: r.debtToEquity, interestCoverage: null,
        revenueGrowthYoY: r.revenueGrowthYoY, revenueGrowthQoQ: null,
        epsGrowthYoY: r.epsGrowthYoY,
        dividendYield: null, payoutRatio: null, dividendGrowth: null,
      };

      return {
        profile: {
          symbol: symbol.toUpperCase(),
          companyName: prof?.name ?? symbol.toUpperCase(),
          exchange: '', sector: null, industry: prof?.industry ?? null,
          description: null, website: null, ceo: null, employees: null,
          marketCap: prof?.marketCap ?? null, country: null,
        },
        ratios,
        incomeStatement: [],
        balanceSheet: [],
        cashFlow: [],
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Finnhub fundamentals failed for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch from Yahoo Finance (primary, free)
   */
  private async fetchFromYahoo(symbol: string): Promise<CompanyFundamentals | null> {
    try {
      const response = await fetch(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryProfile,financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory,earnings`
      );

      if (!response.ok) return null;

      const data = await response.json();
      const result = data.quoteSummary?.result?.[0];
      if (!result) return null;

      return this.transformYahooData(symbol, result);
    } catch (error) {
      console.error(`Yahoo Finance error for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Transform Yahoo Finance response to our format
   */
  private transformYahooData(symbol: string, data: any): CompanyFundamentals {
    const profile = data.summaryProfile || {};
    const financialData = data.financialData || {};
    const keyStats = data.defaultKeyStatistics || {};

    // Company Profile
    const companyProfile: CompanyProfile = {
      symbol,
      companyName: profile.longName || symbol,
      exchange: profile.exchange || 'UNKNOWN',
      sector: profile.sector || null,
      industry: profile.industry || null,
      description: profile.longBusinessSummary || null,
      website: profile.website || null,
      ceo: profile.companyOfficers?.[0]?.name || null,
      employees: profile.fullTimeEmployees || null,
      marketCap: financialData.marketCap?.raw || null,
      country: profile.country || null,
    };

    // Financial Ratios
    const ratios: FinancialRatios = {
      // Valuation
      peRatio: keyStats.trailingPE?.raw || null,
      pbRatio: keyStats.priceToBook?.raw || null,
      pegRatio: keyStats.pegRatio?.raw || null,
      priceToSales: keyStats.priceToSalesTrailing12Months?.raw || null,
      evToEbitda: keyStats.enterpriseToEbitda?.raw || null,

      // Profitability
      grossMargin: financialData.grossMargins?.raw * 100 || null,
      operatingMargin: financialData.operatingMargins?.raw * 100 || null,
      netMargin: financialData.profitMargins?.raw * 100 || null,
      roe: financialData.returnOnEquity?.raw * 100 || null,
      roa: financialData.returnOnAssets?.raw * 100 || null,
      roic: null, // Not available from Yahoo

      // Liquidity & Solvency
      currentRatio: financialData.currentRatio?.raw || null,
      quickRatio: financialData.quickRatio?.raw || null,
      debtToEquity: financialData.debtToEquity?.raw || null,
      interestCoverage: null, // Calculate manually if needed

      // Growth
      revenueGrowthYoY: financialData.revenueGrowth?.raw * 100 || null,
      revenueGrowthQoQ: null,
      epsGrowthYoY: keyStats.earningsQuarterlyGrowth?.raw * 100 || null,

      // Dividend
      dividendYield: keyStats.dividendYield?.raw * 100 || null,
      payoutRatio: keyStats.payoutRatio?.raw * 100 || null,
      dividendGrowth: null,
    };

    // Income Statements (last 4 quarters)
    const incomeStatements: FinancialStatement[] = [];
    const incomeHistory = data.incomeStatementHistory?.incomeStatementHistory || [];
    for (const stmt of incomeHistory.slice(0, 4)) {
      incomeStatements.push({
        date: new Date(stmt.endDate?.raw * 1000).toISOString().split('T')[0],
        revenue: stmt.totalRevenue?.raw || 0,
        netIncome: stmt.netIncome?.raw || 0,
        grossProfit: stmt.grossProfit?.raw || 0,
        operatingIncome: stmt.operatingIncome?.raw || 0,
        ebitda: stmt.ebitda?.raw || 0,
        eps: stmt.netIncome?.raw / (keyStats.sharesOutstanding?.raw || 1),
        sharesOutstanding: keyStats.sharesOutstanding?.raw || 0,
      });
    }

    // Balance Sheets
    const balanceSheets: BalanceSheet[] = [];
    const balanceHistory = data.balanceSheetHistory?.balanceSheetStatements || [];
    for (const stmt of balanceHistory.slice(0, 4)) {
      balanceSheets.push({
        date: new Date(stmt.endDate?.raw * 1000).toISOString().split('T')[0],
        totalAssets: stmt.totalAssets?.raw || 0,
        totalLiabilities: stmt.totalLiab?.raw || 0,
        totalEquity: stmt.totalStockholderEquity?.raw || 0,
        currentAssets: stmt.totalCurrentAssets?.raw || 0,
        currentLiabilities: stmt.totalCurrentLiabilities?.raw || 0,
        longTermDebt: stmt.longTermDebt?.raw || 0,
        cash: stmt.cash?.raw || 0,
      });
    }

    // Cash Flow Statements
    const cashFlows: CashFlow[] = [];
    const cashFlowHistory = data.cashflowStatementHistory?.cashflowStatements || [];
    for (const stmt of cashFlowHistory.slice(0, 4)) {
      const capEx = stmt.capitalExpenditures?.raw || 0;
      const opCF = stmt.totalCashFromOperatingActivities?.raw || 0;
      cashFlows.push({
        date: new Date(stmt.endDate?.raw * 1000).toISOString().split('T')[0],
        operatingCashFlow: opCF,
        investingCashFlow: stmt.totalCashflowsFromInvestingActivities?.raw || 0,
        financingCashFlow: stmt.totalCashFromFinancingActivities?.raw || 0,
        freeCashFlow: opCF + capEx, // capEx is negative
        capitalExpenditure: capEx,
      });
    }

    return {
      profile: companyProfile,
      ratios,
      incomeStatement: incomeStatements,
      balanceSheet: balanceSheets,
      cashFlow: cashFlows,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Fetch from Alpha Vantage (fallback, 500 calls/day)
   */
  private async fetchFromAlphaVantage(symbol: string): Promise<CompanyFundamentals | null> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) {
      console.warn('Alpha Vantage API key not configured');
      return null;
    }

    try {
      // Fetch company overview
      const overviewUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${apiKey}`;
      const response = await fetch(overviewUrl);

      if (!response.ok) return null;

      const data = await response.json();

      if (data.Note || data.Information) {
        // Rate limited or invalid
        console.warn('Alpha Vantage rate limit or error:', data.Note || data.Information);
        return null;
      }

      // Transform Alpha Vantage data (simplified)
      const companyProfile: CompanyProfile = {
        symbol: data.Symbol,
        companyName: data.Name,
        exchange: data.Exchange,
        sector: data.Sector,
        industry: data.Industry,
        description: data.Description,
        website: null,
        ceo: null,
        employees: null,
        marketCap: parseFloat(data.MarketCapitalization) || null,
        country: data.Country,
      };

      const ratios: FinancialRatios = {
        peRatio: parseFloat(data.PERatio) || null,
        pbRatio: parseFloat(data.PriceToBookRatio) || null,
        pegRatio: parseFloat(data.PEGRatio) || null,
        priceToSales: parseFloat(data.PriceToSalesRatioTTM) || null,
        evToEbitda: parseFloat(data.EVToEBITDA) || null,
        grossMargin: parseFloat(data.GrossProfitTTM) || null,
        operatingMargin: parseFloat(data.OperatingMarginTTM) || null,
        netMargin: parseFloat(data.ProfitMargin) || null,
        roe: parseFloat(data.ReturnOnEquityTTM) || null,
        roa: parseFloat(data.ReturnOnAssetsTTM) || null,
        roic: null,
        currentRatio: parseFloat(data.CurrentRatio) || null,
        quickRatio: parseFloat(data.QuickRatio) || null,
        debtToEquity: parseFloat(data.DebtToEquity) || null,
        interestCoverage: null,
        revenueGrowthYoY: parseFloat(data.QuarterlyRevenueGrowthYOY) * 100 || null,
        revenueGrowthQoQ: null,
        epsGrowthYoY: parseFloat(data.QuarterlyEarningsGrowthYOY) * 100 || null,
        dividendYield: parseFloat(data.DividendYield) * 100 || null,
        payoutRatio: parseFloat(data.PayoutRatio) * 100 || null,
        dividendGrowth: null,
      };

      return {
        profile: companyProfile,
        ratios,
        incomeStatement: [],
        balanceSheet: [],
        cashFlow: [],
        lastUpdated: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`Alpha Vantage error for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get data from cache if available and not expired
   */
  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Store data in cache
   */
  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // Limit cache size to 1000 entries
    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance
export const fundamentalDataProvider = new FundamentalDataProvider();
