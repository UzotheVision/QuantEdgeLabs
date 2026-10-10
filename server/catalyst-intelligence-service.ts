import { db } from "./db";
import { 
  secFilings, 
  secFilingSignals, 
  governmentContracts, 
  catalystEvents, 
  symbolCatalystSnapshots,
  type InsertSecFiling,
  type InsertGovernmentContract,
  type InsertCatalystEvent,
  type SecFiling,
  type GovernmentContract,
  type CatalystEvent,
  type SECFilingType,
  type FilingSentiment,
  type CatalystEventType
} from "@shared/schema";
import { eq, desc, and, gte, sql, inArray } from "drizzle-orm";
import { log } from "./vite";
import { recordSymbolAttention } from "./attention-tracking-service";

const SEC_EDGAR_BASE_URL = "https://data.sec.gov";
const USA_SPENDING_BASE_URL = "https://api.usaspending.gov/api/v2";

const COMPANY_CIK_MAP: Record<string, string> = {
  'AAPL': '0000320193',
  'MSFT': '0000789019',
  'GOOGL': '0001652044',
  'AMZN': '0001018724',
  'META': '0001326801',
  'NVDA': '0001045810',
  'TSLA': '0001318605',
  'JPM': '0000019617',
  'V': '0001403161',
  'JNJ': '0000200406',
  'UNH': '0000731766',
  'HD': '0000354950',
  'PG': '0000080424',
  'MA': '0001141391',
  'BAC': '0000070858',
  'XOM': '0000034088',
  'DIS': '0001744489',
  'NFLX': '0001065280',
  'ADBE': '0000796343',
  'CRM': '0001108524',
  'INTC': '0000050863',
  'AMD': '0000002488',
  'BA': '0000012927',
  'GE': '0000040545',
  'LMT': '0000936468',
  'RTX': '0000101829',
  'NOC': '0001133421',
  'GD': '0000040533',
};

const TICKER_TO_COMPANY_NAME: Record<string, string> = {
  'AAPL': 'Apple Inc.',
  'MSFT': 'Microsoft Corporation',
  'GOOGL': 'Alphabet Inc.',
  'AMZN': 'Amazon.com, Inc.',
  'META': 'Meta Platforms, Inc.',
  'NVDA': 'NVIDIA Corporation',
  'TSLA': 'Tesla, Inc.',
  'JPM': 'JPMorgan Chase & Co.',
  'LMT': 'Lockheed Martin Corporation',
  'RTX': 'RTX Corporation',
  'NOC': 'Northrop Grumman Corporation',
  'GD': 'General Dynamics Corporation',
  'BA': 'The Boeing Company',
};

interface SECFilingRaw {
  accessionNumber: string;
  filingDate: string;
  form: string;
  primaryDocument: string;
  acceptanceDateTime?: string;
}

interface USASpendingAward {
  Award_ID: string;
  recipient_name: string;
  awarding_agency_name: string;
  total_obligation: number;
  description: string;
  award_date: string;
  naics_code?: string;
  naics_description?: string;
  period_of_performance_start_date?: string;
  period_of_performance_current_end_date?: string;
}

export async function fetchSECFilingsForTicker(ticker: string, filingTypes: SECFilingType[] = ['8-K', 'Form4']): Promise<SecFiling[]> {
  // Resolve against SEC's own published ticker->CIK file rather than the
  // hand-typed map below it. That map held 28 mega-caps and not one name from
  // the 175-symbol universe this platform scans, which is why AAOI's $600M
  // at-the-market announcement — an ordinary 8-K — went unseen while the stock
  // fell 13% after hours. The filing pipeline was working that same day; it was
  // pointed at the wrong 28 companies. Resolving dynamically takes coverage from
  // 8.6% to 92%, and the remainder are ETFs and crypto that SEC rightly does not
  // list. The static map stays as a fallback for when SEC is unreachable.
  const { resolveCik } = await import('./sec-cik-resolver');
  const cik = (await resolveCik(ticker)) ?? COMPANY_CIK_MAP[ticker.toUpperCase()];
  if (!cik) {
    log(`[CATALYST] No CIK for ticker: ${ticker} (not listed at SEC — ETF, crypto or foreign)`, 'intel');
    return [];
  }

  try {
    const url = `${SEC_EDGAR_BASE_URL}/submissions/CIK${cik}.json`;
    log(`[CATALYST] Fetching SEC filings from: ${url}`, 'intel');
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Quant Edge Labs Platform support@quantedgelabs.com',
        'Accept-Encoding': 'gzip, deflate',
      },
    });

    if (!response.ok) {
      log(`[CATALYST] SEC EDGAR request failed: ${response.status}`, 'intel');
      return [];
    }

    const data = await response.json();
    const companyName = data.name || TICKER_TO_COMPANY_NAME[ticker.toUpperCase()] || ticker;
    
    const recentFilings = data.filings?.recent || {};
    const filings: SecFiling[] = [];
    
    const forms = recentFilings.form || [];
    const accessionNumbers = recentFilings.accessionNumber || [];
    const filingDates = recentFilings.filingDate || [];
    const primaryDocuments = recentFilings.primaryDocument || [];
    const acceptanceDateTimes = recentFilings.acceptanceDateTime || [];

    for (let i = 0; i < Math.min(forms.length, 20); i++) {
      const form = forms[i] as string;
      const formType = mapFormToType(form);
      
      if (!filingTypes.includes(formType)) continue;
      
      const rawAccessionNumber = accessionNumbers[i] || '';
      const normalizedAccessionNumber = rawAccessionNumber.replace(/-/g, '');
      const filingDate = filingDates[i];
      const primaryDoc = primaryDocuments[i];
      const acceptanceDate = acceptanceDateTimes[i];
      
      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${normalizedAccessionNumber}/${primaryDoc}`;
      
      const existing = await db.select().from(secFilings)
        .where(eq(secFilings.accessionNumber, normalizedAccessionNumber))
        .limit(1);
      
      if (existing.length > 0) {
        filings.push(existing[0]);
        continue;
      }

      const sentiment = await analyzeFiling(formType, ticker);
      
      const insertData: InsertSecFiling = {
        accessionNumber: normalizedAccessionNumber,
        cik,
        ticker: ticker.toUpperCase(),
        companyName,
        filingType: formType,
        filingDate,
        acceptanceDate,
        filingUrl,
        documentCount: 1,
        sentiment: sentiment.sentiment,
        sentimentScore: sentiment.score,
        catalystTags: sentiment.tags,
        isProcessed: true,
        parsedAt: new Date(),
      };

      const [inserted] = await db.insert(secFilings).values(insertData).returning();
      filings.push(inserted);
      
      await createCatalystFromFiling(inserted);
      
      // 🎯 CONVERGENCE TRACKING: Record SEC filings for heat map
      try {
        await recordSymbolAttention(ticker, 'catalyst_alert', 'alert', {
          direction: sentiment.sentiment === 'bullish' ? 'bullish' : sentiment.sentiment === 'bearish' ? 'bearish' : undefined,
          confidence: 50 + sentiment.score,
          message: `SEC ${formType}: ${sentiment.tags.join(', ')}`
        });
      } catch (err) {
        // Silently ignore attention tracking errors
      }
      
      log(`[CATALYST] Inserted SEC filing: ${formType} for ${ticker}`, 'intel');
    }

    return filings;
  } catch (error) {
    log(`[CATALYST] Error fetching SEC filings for ${ticker}: ${error}`, 'intel');
    return [];
  }
}

function mapFormToType(form: string): SECFilingType {
  const formUpper = form.toUpperCase();
  if (formUpper === '8-K' || formUpper === '8-K/A') return '8-K';
  if (formUpper === '10-K' || formUpper === '10-K/A') return '10-K';
  if (formUpper === '10-Q' || formUpper === '10-Q/A') return '10-Q';
  if (formUpper === '13F-HR' || formUpper.startsWith('13F')) return '13F';
  if (formUpper === '4' || formUpper === '4/A') return 'Form4';
  if (formUpper === 'S-1' || formUpper === 'S-1/A') return 'S-1';
  if (formUpper === 'DEF 14A') return 'DEF14A';
  return 'other';
}

async function analyzeFiling(filingType: SECFilingType, ticker: string): Promise<{
  sentiment: FilingSentiment;
  score: number;
  tags: string[];
}> {
  const baseSentiments: Record<SECFilingType, { sentiment: FilingSentiment; score: number; tags: string[] }> = {
    '8-K': { sentiment: 'neutral', score: 0, tags: ['material_event'] },
    '10-K': { sentiment: 'neutral', score: 0, tags: ['annual_report'] },
    '10-Q': { sentiment: 'neutral', score: 0, tags: ['quarterly_report'] },
    '13F': { sentiment: 'neutral', score: 10, tags: ['institutional_holdings'] },
    'Form4': { sentiment: 'neutral', score: 0, tags: ['insider_transaction'] },
    'S-1': { sentiment: 'bullish', score: 20, tags: ['ipo_filing', 'growth'] },
    'DEF14A': { sentiment: 'neutral', score: 0, tags: ['proxy_statement'] },
    'other': { sentiment: 'neutral', score: 0, tags: [] },
  };

  return baseSentiments[filingType] || baseSentiments['other'];
}

async function createCatalystFromFiling(filing: SecFiling): Promise<void> {
  if (!filing.ticker) return;
  
  const eventTypeMap: Record<SECFilingType, CatalystEventType> = {
    '8-K': 'sec_filing',
    '10-K': 'earnings',
    '10-Q': 'earnings',
    '13F': 'sec_filing',
    'Form4': 'insider_trade',
    'S-1': 'sec_filing',
    'DEF14A': 'sec_filing',
    'other': 'sec_filing',
  };

  const signalStrength = Math.min(100, Math.max(0, 50 + (filing.sentimentScore || 0)));
  const polarity = filing.sentiment === 'bullish' ? 'bullish' : 
                   filing.sentiment === 'bearish' ? 'bearish' : 'neutral';

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const catalystData: InsertCatalystEvent = {
    ticker: filing.ticker,
    companyName: filing.companyName,
    eventType: eventTypeMap[filing.filingType as SECFilingType] || 'sec_filing',
    sourceId: filing.id,
    sourceTable: 'sec_filings',
    title: `${filing.filingType} Filing - ${filing.companyName}`,
    summary: filing.extractedSummary || `New ${filing.filingType} filing submitted to SEC`,
    eventDate: filing.filingDate,
    signalStrength,
    polarity,
    confidence: 0.7,
    expiresAt: expiresAt.toISOString(),
    isActive: true,
  };

  await db.insert(catalystEvents).values(catalystData);
}

export async function fetchGovernmentContractsForTicker(ticker: string): Promise<GovernmentContract[]> {
  const companyName = TICKER_TO_COMPANY_NAME[ticker.toUpperCase()];
  if (!companyName) {
    log(`[CATALYST] No company name mapping for ticker: ${ticker}`, 'intel');
    return [];
  }

  try {
    const searchTerms = companyName.split(' ').slice(0, 2).join(' ');
    const url = `${USA_SPENDING_BASE_URL}/search/spending_by_award/`;
    
    log(`[CATALYST] Fetching gov contracts for: ${searchTerms}`, 'intel');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters: {
          recipient_search_text: [searchTerms],
          time_period: [
            {
              start_date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              end_date: new Date().toISOString().split('T')[0],
            }
          ],
          award_type_codes: ['A', 'B', 'C', 'D', 'IDV_A', 'IDV_B', 'IDV_C', 'IDV_D', 'IDV_E'],
        },
        fields: [
          'Award ID',
          'Recipient Name',
          'Awarding Agency',
          'Award Amount',
          'Description',
          'Start Date',
          'End Date',
        ],
        page: 1,
        limit: 20,
        sort: 'Award Amount',
        order: 'desc',
      }),
    });

    if (!response.ok) {
      log(`[CATALYST] USASpending request failed: ${response.status}`, 'intel');
      return [];
    }

    const data = await response.json();
    const contracts: GovernmentContract[] = [];
    
    for (const result of (data.results || []).slice(0, 10)) {
      const awardId = result['Award ID'] || `USG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const existing = await db.select().from(governmentContracts)
        .where(eq(governmentContracts.awardId, awardId))
        .limit(1);
      
      if (existing.length > 0) {
        contracts.push(existing[0]);
        continue;
      }

      const obligationAmount = parseFloat(result['Award Amount']) || 0;
      const isDefense = (result['Awarding Agency'] || '').toLowerCase().includes('defense') ||
                       (result['Awarding Agency'] || '').toLowerCase().includes('army') ||
                       (result['Awarding Agency'] || '').toLowerCase().includes('navy') ||
                       (result['Awarding Agency'] || '').toLowerCase().includes('air force');

      const significanceScore = Math.min(100, (obligationAmount / 10000000) * 10);

      const insertData: InsertGovernmentContract = {
        awardId,
        recipientName: result['Recipient Name'] || companyName,
        recipientTicker: ticker.toUpperCase(),
        awardingAgencyName: result['Awarding Agency'] || 'Unknown Agency',
        description: result['Description'] || 'Government Contract',
        obligationAmount,
        awardDate: result['Start Date'] || new Date().toISOString().split('T')[0],
        startDate: result['Start Date'],
        endDate: result['End Date'],
        isDefense,
        isTechnology: (result['Description'] || '').toLowerCase().includes('technology') ||
                      (result['Description'] || '').toLowerCase().includes('software') ||
                      (result['Description'] || '').toLowerCase().includes('cyber'),
        significanceScore,
      };

      const [inserted] = await db.insert(governmentContracts).values(insertData).returning();
      contracts.push(inserted);
      
      await createCatalystFromContract(inserted, ticker);
      
      log(`[CATALYST] Inserted gov contract: $${obligationAmount.toLocaleString()} for ${ticker}`, 'intel');
    }

    return contracts;
  } catch (error) {
    log(`[CATALYST] Error fetching gov contracts for ${ticker}: ${error}`, 'intel');
    return [];
  }
}

async function createCatalystFromContract(contract: GovernmentContract, ticker: string): Promise<void> {
  const signalStrength = Math.min(100, contract.significanceScore || 50);
  
  const polarity: 'bullish' | 'bearish' | 'neutral' = 
    contract.obligationAmount > 50000000 ? 'bullish' :
    contract.obligationAmount > 10000000 ? 'bullish' : 'neutral';

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14);

  const catalystData: InsertCatalystEvent = {
    ticker,
    companyName: contract.recipientName,
    eventType: 'gov_contract',
    sourceId: contract.id,
    sourceTable: 'government_contracts',
    title: `Government Contract - $${(contract.obligationAmount / 1000000).toFixed(1)}M`,
    summary: contract.description || `Contract awarded by ${contract.awardingAgencyName}`,
    eventDate: contract.awardDate,
    signalStrength,
    polarity,
    confidence: 0.8,
    expiresAt: expiresAt.toISOString(),
    isActive: true,
  };

  await db.insert(catalystEvents).values(catalystData);
}

export async function getCatalystsForSymbol(ticker: string, limit = 10): Promise<CatalystEvent[]> {
  const catalysts = await db.select()
    .from(catalystEvents)
    .where(and(
      eq(catalystEvents.ticker, ticker.toUpperCase()),
      eq(catalystEvents.isActive, true)
    ))
    .orderBy(desc(catalystEvents.eventDate))
    .limit(limit);
  
  return catalysts;
}

export async function getUpcomingCatalysts(limit = 20): Promise<CatalystEvent[]> {
  const now = new Date().toISOString();
  
  const catalysts = await db.select()
    .from(catalystEvents)
    .where(and(
      eq(catalystEvents.isActive, true),
      gte(catalystEvents.expiresAt, now)
    ))
    .orderBy(desc(catalystEvents.signalStrength))
    .limit(limit);
  
  return catalysts;
}

export async function calculateCatalystScore(ticker: string): Promise<{
  score: number;
  catalystCount: number;
  recentCatalysts: CatalystEvent[];
  summary: string;
}> {
  const catalysts = await getCatalystsForSymbol(ticker, 5);
  
  if (catalysts.length === 0) {
    return {
      score: 0,
      catalystCount: 0,
      recentCatalysts: [],
      summary: 'No recent catalysts detected',
    };
  }

  let weightedScore = 0;
  let totalWeight = 0;
  
  for (const catalyst of catalysts) {
    const eventDate = new Date(catalyst.eventDate);
    const daysSinceEvent = (Date.now() - eventDate.getTime()) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.exp(-daysSinceEvent / 7);
    
    const polarityMultiplier = catalyst.polarity === 'bullish' ? 1 :
                                catalyst.polarity === 'bearish' ? -1 : 0;
    
    const catalystContribution = catalyst.signalStrength * polarityMultiplier * catalyst.confidence * decayFactor;
    
    weightedScore += catalystContribution;
    totalWeight += decayFactor;
  }

  const normalizedScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  
  const bullishCount = catalysts.filter(c => c.polarity === 'bullish').length;
  const bearishCount = catalysts.filter(c => c.polarity === 'bearish').length;
  
  let summary = '';
  if (bullishCount > bearishCount) {
    summary = `${bullishCount} bullish catalysts detected. Recent events favor upside.`;
  } else if (bearishCount > bullishCount) {
    summary = `${bearishCount} bearish catalysts detected. Exercise caution.`;
  } else {
    summary = `Mixed catalyst signals. ${catalysts.length} events in recent period.`;
  }

  return {
    score: Math.round(normalizedScore),
    catalystCount: catalysts.length,
    recentCatalysts: catalysts,
    summary,
  };
}

export async function refreshCatalystsForWatchlist(tickers: string[]): Promise<{
  secFilingsAdded: number;
  contractsAdded: number;
  errors: string[];
}> {
  let secFilingsAdded = 0;
  let contractsAdded = 0;
  const errors: string[] = [];

  for (const ticker of tickers) {
    try {
      const filings = await fetchSECFilingsForTicker(ticker);
      secFilingsAdded += filings.length;
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const contracts = await fetchGovernmentContractsForTicker(ticker);
      contractsAdded += contracts.length;
      
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      errors.push(`${ticker}: ${error}`);
    }
  }

  log(`[CATALYST] Refresh complete: ${secFilingsAdded} filings, ${contractsAdded} contracts`, 'intel');
  
  return { secFilingsAdded, contractsAdded, errors };
}

export async function updateSymbolCatalystSnapshot(ticker: string): Promise<void> {
  const catalysts = await getCatalystsForSymbol(ticker, 20);
  
  const bullishCount = catalysts.filter(c => c.polarity === 'bullish').length;
  const bearishCount = catalysts.filter(c => c.polarity === 'bearish').length;
  const neutralCount = catalysts.filter(c => c.polarity === 'neutral').length;
  
  const { score } = await calculateCatalystScore(ticker);
  
  const secFilingCatalysts = catalysts.filter(c => c.eventType === 'sec_filing' || c.eventType === 'insider_trade' || c.eventType === 'earnings');
  const govContractCatalysts = catalysts.filter(c => c.eventType === 'gov_contract');
  
  const lastSecFiling = secFilingCatalysts[0];
  const lastGovContract = govContractCatalysts[0];

  const existing = await db.select().from(symbolCatalystSnapshots)
    .where(eq(symbolCatalystSnapshots.ticker, ticker.toUpperCase()))
    .limit(1);

  const snapshotData = {
    ticker: ticker.toUpperCase(),
    bullishCatalystCount: bullishCount,
    bearishCatalystCount: bearishCount,
    neutralCatalystCount: neutralCount,
    aggregateCatalystScore: score,
    recentCatalysts: catalysts.slice(0, 5).map(c => ({
      id: c.id,
      title: c.title,
      eventType: c.eventType,
      polarity: c.polarity,
      eventDate: c.eventDate,
    })),
    lastSecFilingDate: lastSecFiling?.eventDate,
    lastSecFilingType: lastSecFiling?.eventType,
    lastGovContractDate: lastGovContract?.eventDate,
    lastGovContractValue: undefined,
    lastUpdated: new Date(),
  };

  if (existing.length > 0) {
    await db.update(symbolCatalystSnapshots)
      .set(snapshotData)
      .where(eq(symbolCatalystSnapshots.ticker, ticker.toUpperCase()));
  } else {
    await db.insert(symbolCatalystSnapshots).values(snapshotData);
  }
}

const PRIORITY_TICKERS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
  'JPM', 'LMT', 'RTX', 'NOC', 'GD', 'BA', 'V', 'JNJ', 'UNH',
];

let catalystPollingInterval: NodeJS.Timeout | null = null;

export async function runScheduledCatalystRefresh(): Promise<void> {
  try {
    log('[CATALYST] Running scheduled catalyst data refresh...', 'intel');
    
    const result = await refreshCatalystsForWatchlist(PRIORITY_TICKERS);
    
    log(`[CATALYST] Scheduled refresh complete: ${result.secFilingsAdded} filings, ${result.contractsAdded} contracts`, 'intel');
    
    for (const ticker of PRIORITY_TICKERS) {
      try {
        await updateSymbolCatalystSnapshot(ticker);
      } catch (err) {
        log(`[CATALYST] Failed to update snapshot for ${ticker}`, 'intel');
      }
    }
    
    log('[CATALYST] Catalyst snapshots updated', 'intel');
  } catch (error) {
    log(`[CATALYST] Scheduled refresh failed: ${error}`, 'intel');
  }
}

export function startCatalystPolling(intervalMinutes: number = 30): void {
  if (catalystPollingInterval) {
    log('[CATALYST] Stopping existing polling interval', 'intel');
    clearInterval(catalystPollingInterval);
  }
  
  log(`[CATALYST] Starting catalyst polling every ${intervalMinutes} minutes`, 'intel');
  
  runScheduledCatalystRefresh();
  
  catalystPollingInterval = setInterval(
    () => runScheduledCatalystRefresh(),
    intervalMinutes * 60 * 1000
  );
}

export function stopCatalystPolling(): void {
  if (catalystPollingInterval) {
    clearInterval(catalystPollingInterval);
    catalystPollingInterval = null;
    log('[CATALYST] Catalyst polling stopped', 'intel');
  }
}

log('[CATALYST] Catalyst Intelligence Service initialized', 'intel');
