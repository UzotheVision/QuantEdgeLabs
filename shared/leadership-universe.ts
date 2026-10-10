/**
 * LEADERSHIP UNIVERSE — curated benchmark membership (operator policy
 * 2026-09-23: "nothing from SMH, IGV, QQQ, SPX, IWM" on the board is a
 * failure mode; suggestions should skew toward names inside the indices a
 * trader actually benchmarks against).
 *
 * This is a CURATED approximation of major-index leadership, not licensed
 * constituent data — kept deliberately compact and reviewable. Membership
 * here earns a modest conviction boost (liquid options, institutional
 * participation, index flows); absence is never evidence against a name.
 */
export const LEADERSHIP_UNIVERSE = new Set<string>([
  // Mega-cap core (SPX/NDX/DOW overlap)
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA', 'AVGO', 'BRK.B',
  'JPM', 'V', 'MA', 'UNH', 'XOM', 'LLY', 'JNJ', 'WMT', 'PG', 'HD', 'COST', 'ORCL',
  'NFLX', 'BAC', 'KO', 'PEP', 'MRK', 'ABBV', 'CVX', 'CRM', 'AMD', 'ADBE', 'DIS',
  // Semis / SMH-class
  'TSM', 'ASML', 'QCOM', 'TXN', 'INTC', 'MU', 'AMAT', 'LRCX', 'KLAC', 'ADI', 'NXPI',
  'MRVL', 'ARM', 'SNPS', 'CDNS', 'MCHP', 'ON', 'MPWR', 'SWKS', 'QRVO', 'TER', 'ENTG',
  'SMCI', 'SNDK', 'WDC', 'STX', 'RMBS', 'ALAB', 'CRDO', 'COHR', 'LITE', 'AEHR', 'COHU',
  'GFS', 'MKSI', 'ONTO', 'NVMI', 'CAMT', 'ACLS', 'AMBA', 'SITM', 'POWI', 'DIOD',
  // Optics/photonics + etch/deposition complex (operator themes)
  'AAOI', 'FN', 'CIEN', 'INFN', 'IPGP', 'NVTS', 'AXTI', 'AEIS', 'UCTT', 'ICHR', 'COHU',
  // Software / IGV-class
  'NOW', 'INTU', 'PANW', 'CRWD', 'FTNT', 'ZS', 'NET', 'DDOG', 'SNOW', 'MDB', 'TEAM',
  'WDAY', 'HUBS', 'PLTR', 'APP', 'SHOP', 'SQ', 'UBER', 'ABNB', 'DASH', 'COIN', 'HOOD',
  'MSTR', 'TWLO', 'OKTA', 'GTLB', 'S', 'DOCU', 'BILL', 'ASAN', 'PATH', 'DUOL', 'FRSH',
  // NDX/momentum complex + operator-named
  'ISRG', 'REGN', 'VRTX', 'GILD', 'AMGN', 'MRNA', 'BKNG', 'MELI', 'PDD', 'CMCSA',
  'CSCO', 'IBM', 'GE', 'CAT', 'BA', 'NKE', 'SBUX', 'TGT', 'LOW', 'AXP', 'GS', 'MS',
  'NBIS', 'CRWV', 'IONQ', 'RGTI', 'LUNR', 'RKLB', 'ASTS', 'ACHR', 'HIMS', 'SOFI',
  'IBIT', 'ETHA',
  // Benchmark ETFs themselves (a sector turn is a real thesis)
  'SPY', 'QQQ', 'IWM', 'SMH', 'SOXX', 'IGV', 'XBI', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI',
]);

export function isLeadershipName(symbol: string): boolean {
  return LEADERSHIP_UNIVERSE.has(symbol.toUpperCase());
}

/**
 * Operator favorites — always interrogated by the tape scanner (per-symbol
 * flow read every sweep, leaderboard or not) and exempt from scanner
 * liquidity floors. META first: the operator's stated favorite.
 */
export const FAVORITE_TICKERS = new Set(
  String(
    process.env.USER_FAVORITE_TICKERS ??
    'META,TSLA,NVDA,AMD,MU,AVGO,SNDK,CRWD,COIN,MSTR,AAPL,AMZN,GOOGL,MSFT,STX,ALAB,NBIS,MRVL,SMCI,WDC',
  ).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
);
