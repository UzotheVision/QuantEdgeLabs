/**
 * UNIFIED TICKER UNIVERSE (800+ tickers)
 * Shared across all scanners: Flow Scanner, Market Scanner, Lotto Scanner, Auto-Lotto Trader
 * This ensures comprehensive market coverage across all platform features
 * 
 * ALSO: Dynamic mover scanner (mover-discovery.ts) fetches real-time most-active
 * stocks from Yahoo Finance to catch movers NOT in this static list.
 */

// === 📈 MEGA CAP TECH (35) ===
export const MEGA_CAP_TECH = [
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'AVGO', 'ORCL',
  'ADBE', 'CRM', 'CSCO', 'ACN', 'IBM', 'INTC', 'TXN', 'QCOM', 'NOW', 'INTU',
  'AMD', 'MU', 'AMAT', 'LRCX', 'ADI', 'NFLX', 'PYPL', 'UBER', 'ABNB', 'SHOP',
  'XYZ', 'SNAP', 'PINS', 'TWTR', 'ZM'
];

// === 💵 FINANCIALS (40) ===
export const FINANCIALS = [
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'SCHW', 'AXP', 'SPGI',
  'ICE', 'CME', 'MCO', 'PNC', 'USB', 'TFC', 'COF', 'BK', 'STT', 'FITB',
  'KEY', 'RF', 'CFG', 'HBAN', 'ZION', 'CMA', 'MTB', 'NTRS', 'DFS', 'SYF',
  'ALLY', 'SOFI', 'HOOD', 'COIN', 'AFRM', 'UPST', 'PYPL', 'NU', 'XYZ', 'V', 'MA'
];

// === 🏥 HEALTHCARE & PHARMA (45) ===
export const HEALTHCARE = [
  'JNJ', 'UNH', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'DHR', 'BMY',
  'AMGN', 'GILD', 'VRTX', 'REGN', 'ISRG', 'MDT', 'SYK', 'BSX', 'ELV', 'CI',
  'HUM', 'CVS', 'MCK', 'CAH', 'ABC', 'ZTS', 'DXCM', 'IDXX', 'IQV', 'A',
  'MRNA', 'BNTX', 'NVAX', 'CRSP', 'EDIT', 'NTLA', 'BEAM', 'INO', 'VXRT', 'NKTR',
  'IMVT', 'RXRX', 'HIMS', 'TDOC', 'DOCS'
];

// === 🏭 INDUSTRIALS (35) ===
export const INDUSTRIALS = [
  'CAT', 'DE', 'HON', 'UNP', 'UPS', 'RTX', 'LMT', 'BA', 'GE', 'MMM',
  'ETN', 'EMR', 'ITW', 'PH', 'CMI', 'PCAR', 'NSC', 'CSX', 'FDX', 'DAL',
  'UAL', 'AAL', 'LUV', 'JBLU', 'ALK', 'SAVE', 'GD', 'NOC', 'TXT', 'HII',
  'LHX', 'LDOS', 'KTOS', 'AVAV', 'AXON'
];

// === 🛒 CONSUMER DISCRETIONARY (45) ===
export const CONSUMER_DISCRETIONARY = [
  'HD', 'LOW', 'NKE', 'MCD', 'SBUX', 'TGT', 'COST', 'WMT',
  'TJX', 'ROST', 'BURL', 'DG', 'DLTR', 'BBY', 'ULTA', 'LULU', 'GPS', 'ANF',
  'AEO', 'URBN', 'FL', 'DKS', 'HIBB', 'ASO', 'BOOT', 'VFC', 'PVH', 'RL',
  'GRMN', 'POOL', 'LKQ', 'CMG', 'YUM', 'DPZ', 'QSR', 'CAKE', 'DINE',
  'PLAY', 'SIX', 'FUN', 'SEAS', 'MTN', 'MAR', 'HLT', 'ABNB'
];

// === 🍔 CONSUMER STAPLES (25) ===
export const CONSUMER_STAPLES = [
  'PG', 'KO', 'PEP', 'PM', 'MO', 'MDLZ', 'CL', 'GIS', 'K', 'KHC',
  'HSY', 'SJM', 'CPB', 'HRL', 'TSN', 'BG', 'ADM', 'INGR', 'STZ', 'TAP',
  'BUD', 'SAM', 'MNST', 'CELH', 'KDP'
];

// === ⚡ ENERGY (35) ===
export const ENERGY = [
  'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'VLO', 'PSX', 'OXY', 'DVN', 'FANG', 'HAL', 'BKR', 'MRO', 'APA', 'OVV', 'EQT', 'AR', 'RRC',
  'SWN', 'CHK', 'CTRA', 'MTDR', 'PR', 'CHRD', 'SM', 'PDCE', 'GPOR', 'MGY',
  'VTLE', 'ESTE', 'TRGP', 'WMB', 'KMI'
];

// === 🔌 UTILITIES & CLEAN ENERGY (40) ===
export const UTILITIES_CLEAN_ENERGY = [
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'XEL', 'SRE', 'WEC', 'ED', 'EXC',
  'PCG', 'EIX', 'AWK', 'ES', 'DTE', 'PPL', 'FE', 'AES', 'CEG', 'VST',
  'PLUG', 'FCEL', 'BE', 'ENPH', 'SEDG', 'FSLR', 'RUN', 'NOVA', 'ARRY', 'MAXN',
  'EOSE', 'ENVX', 'QS', 'STEM', 'CLNE', 'BLDP', 'BLNK', 'CHPT', 'EVGO', 'NKLA'
];

// === 🏠 REAL ESTATE (20) ===
export const REAL_ESTATE = [
  'AMT', 'PLD', 'EQIX', 'CCI', 'PSA', 'SPG', 'O', 'WELL', 'DLR', 'AVB',
  'EQR', 'VTR', 'ARE', 'BXP', 'SLG', 'VNO', 'KIM', 'REG', 'FRT', 'HST'
];

// === 📱 COMMUNICATION SERVICES (25) ===
export const COMMUNICATION_SERVICES = [
  'DIS', 'NFLX', 'CMCSA', 'VZ', 'T', 'TMUS', 'CHTR', 'PARA',
  'WBD', 'FOXA', 'FOX', 'DISH', 'LYV', 'SPOT', 'SNAP', 'PINS', 'MTCH',
  'TTWO', 'EA', 'RBLX', 'DKNG', 'PENN', 'FUBO', 'ROKU', 'AMC'
];

// === 🔬 QUANTUM COMPUTING (15) ===
export const QUANTUM_COMPUTING = [
  'IONQ', 'RGTI', 'QUBT', 'QBTS', 'ARQQ', 'QMCO', 'QTUM', 'FORM'
];

// === ⚛️ NUCLEAR & URANIUM (20) ===
export const NUCLEAR_URANIUM = [
  'NNE', 'OKLO', 'SMR', 'LEU', 'CCJ', 'UEC', 'UUUU', 'DNN', 'NXE', 'BWXT',
  'URG', 'UROY', 'LTBR', 'GEV', 'FLR'
];

// === 🤖 AI & SOFTWARE (40) ===
export const AI_SOFTWARE = [
  'PLTR', 'AI', 'SOUN', 'BBAI', 'PATH', 'SNOW', 'DDOG', 'MDB', 'ESTC', 'GTLB',
  'TEAM', 'ZM', 'DOCU', 'TWLO', 'OKTA', 'ZS', 'CRWD', 'S', 'PANW', 'NET',
  'FSLY', 'CFLT', 'NEWR', 'DT', 'SPLK', 'SUMO', 'ASAN', 'MNDY', 'BILL', 'COUP',
  'VEEV', 'WDAY', 'HUBS', 'ZEN', 'RNG', 'FIVN', 'NICE', 'APPN', 'AGYS', 'PRFT'
];

// === 🚀 SPACE & SATELLITES (15) ===
export const SPACE_SATELLITES = [
  'ASTS', 'RKLB', 'LUNR', 'RDW', 'SPCE', 'BKSY', 'IRDM', 'GSAT', 'VSAT', 'GILT'
];

// === 🚗 EV & AUTONOMOUS (20) ===
export const EV_AUTONOMOUS = [
  'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'FSR', 'PSNY', 'VFS', 'HYLN',
  'WKHS', 'RIDE', 'LEV', 'GOEV', 'LAZR', 'MVIS', 'INVZ', 'LIDR', 'OUST'
];

// === 💰 CRYPTO & BLOCKCHAIN (15) ===
export const CRYPTO_BLOCKCHAIN = [
  'COIN', 'MSTR', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITF', 'BTBT', 'CIFR', 'WULF',
  'IREN', 'CORZ', 'ARBK', 'GREE', 'SDIG'
];

// === 💎 SEMICONDUCTORS EXTENDED (30) ===
export const SEMICONDUCTORS = [
  'KLAC', 'MRVL', 'ON', 'NXPI', 'SWKS', 'QRVO', 'MCHP', 'MPWR', 'SMCI', 'ARM',
  'ASML', 'TSM', 'WOLF', 'CRUS', 'SITM', 'RMBS', 'LSCC', 'ACLS', 'UCTT', 'OLED',
  'AEHR', 'PLAB', 'AEIS', 'MKSI', 'ENTG', 'ONTO', 'COHR', 'IPGP', 'NOVT', 'LSCC'
];

// === 🔭 OPTICS & PHOTONICS (10) — AI datacenter fiber buildout ===
export const OPTICS_PHOTONICS = [
  'LITE', 'VIAV', 'CIEN', 'INFN', 'CALX', 'AAOI', 'FNSR', 'IIVI'
];

// === 🛡️ DEFENSE & AEROSPACE (20) ===
export const DEFENSE_AEROSPACE = [
  'RCAT', 'JOBY', 'ACHR', 'UAVS', 'TDG', 'HWM', 'SPR', 'ERJ', 'AJRD'
];

// === 🌿 CANNABIS (10) ===
export const CANNABIS = [
  'TLRY', 'CGC', 'SNDL', 'ACB', 'CRON', 'GRWG', 'VFF'
];

// === ⛏️ COMMODITIES & MATERIALS (30) ===
export const COMMODITIES_MATERIALS = [
  'MP', 'LAC', 'ALB', 'FCX', 'NEM', 'GOLD', 'AEM', 'KGC', 'BTG', 'HL',
  'PAAS', 'FSM', 'AG', 'EXK', 'SLI', 'PLL', 'LTHM', 'SQM', 'CLF', 'X',
  'NUE', 'STLD', 'AA', 'CENX', 'CMC', 'RS', 'ATI', 'HAYN', 'KALU', 'ZEUS'
];

// === 🎮 GAMING & ENTERTAINMENT (15) ===
export const GAMING_ENTERTAINMENT = [
  'U', 'MGM', 'LVS', 'WYNN', 'CZR', 'RRR', 'BYD', 'GDEN', 'CHDN', 'BALY'
];

// === 📦 E-COMMERCE & LOGISTICS (15) ===
export const ECOMMERCE_LOGISTICS = [
  'SHOP', 'ETSY', 'W', 'CHWY', 'WISH', 'RVLV', 'POSH', 'REAL', 'OSTK',
  'BIGC', 'CPNG', 'MELI', 'SE', 'GRAB'
];

// === 🔥 HIGH-MOMENTUM MID-CAPS (60) ===
// Volatile names that frequently have big moves - MUST track these
export const HIGH_MOMENTUM_MIDCAPS = [
  // Retail favorites with explosive moves
  'CVNA', 'UPST', 'DASH', 'UBER', 'LYFT', 'ABNB', 'RBLX', 'SNAP', 'PINS', 'PTON',
  'Z', 'ZG', 'OPEN', 'CLOV', 'FUBO', 'SOFI', 'AFRM', 'GME', 'AMC', 'KOSS',
  // High-beta growth names
  'TTD', 'ROKU', 'CRSP', 'BILL', 'HUBS', 'VEEV', 'WDAY', 'OKTA', 'TWLO', 'DOCU',
  // SPACs turned movers
  'DWAC', 'LUCID', 'CCIV', 'IPOF', 'PSTH', 'SPCE', 'NKLA', 'QS', 'CHPT', 'FSR',
  // High short interest / squeeze candidates
  'BYND', 'SPWR', 'BBAI', 'VRM', 'RIDE', 'GOEV', 'REV', 'EXPR', 'PRTY', 'BGFV',
  // Recent IPOs / hot names
  'RDDT', 'ARM', 'BIRK', 'CART', 'IBKR', 'GTLB', 'DUOL', 'BROS', 'RIVN', 'LCID'
];

// === 🇨🇳 CHINA ADRs (25) ===
// Track due to volume surges and cross-market momentum
export const CHINA_ADRS = [
  'BABA', 'BIDU', 'JD', 'PDD', 'NIO', 'XPEV', 'LI', 'BILI', 'TAL', 'EDU',
  'FUTU', 'TIGR', 'YMM', 'DIDI', 'TME', 'BEKE', 'KC', 'ZTO', 'IQ', 'VNET',
  'QFIN', 'LU', 'MNSO', 'VIPS', 'WB'
];

// === 📊 SMALL-CAP MOVERS (50) ===
// Small caps with high relative volume that can move 10%+ in a day
export const SMALL_CAP_MOVERS = [
  'FFIE', 'MULN', 'GFAI', 'NRXP', 'TPST', 'CXAI', 'PRPH', 'MGAM', 'AULT', 'SXTC',
  'TOP', 'TCON', 'TRVN', 'VERI', 'VTNR', 'WISA', 'WRAP', 'XELA', 'ZIVO', 'ARDS',
  'APDN', 'ATNF', 'BFRG', 'BHAT', 'BNGO', 'BPTH', 'BTCS', 'CEMI', 'CFRX', 'CLVR',
  'DARE', 'DGLY', 'DLPN', 'DMAQ', 'DPRO', 'EAST', 'ELLO', 'ERYP', 'ESPR', 'EVFM',
  'FBIO', 'FGEN', 'FLNT', 'FNGR', 'FRGE', 'GEVO', 'GLBE', 'GNPX', 'GOVX', 'GROY'
];

// === 🏆 TOP VOLUME STOCKS (30) ===
// The most traded stocks by daily volume - always liquid, always moving
export const TOP_VOLUME_STOCKS = [
  'TSLA', 'AAPL', 'NVDA', 'AMZN', 'AMD', 'META', 'MSFT', 'AMC', 'GOOGL', 'PLTR',
  'BAC', 'BABA', 'GOOG', 'MARA', 'INTC', 'SOFI', 'NIO', 'COIN', 'NFLX', 'F',
  'T', 'VZ', 'PFE', 'WFC', 'C', 'XOM', 'GM', 'RIOT', 'CLSK', 'HUT'
];

// === 🏦 REGIONAL BANKS (20) ===
export const REGIONAL_BANKS = [
  'WAL', 'PACW', 'EWBC', 'OZK', 'BOKF', 'FHN', 'SNV',
  'GBCI', 'UMBF', 'PNFP', 'IBOC', 'TCBI', 'COLB', 'FFIN', 'STBA', 'FIBK', 'BANF'
];

// === 📡 TELECOM & 5G (10) ===
export const TELECOM_5G = [
  'LUMN', 'FYBR', 'USM', 'TDS', 'SHEN', 'GOGO'
];

// === 🧬 BIOTECH PENNY PLAYS (20) ===
export const BIOTECH_PENNY = [
  'SRNE', 'ADVM', 'FATE', 'GRTS', 'TGTX', 'XNCR', 'RAPT', 'RCKT', 'MGNX', 'SELB',
  'BCYC', 'CMPS', 'MNMD', 'ATAI', 'PRAX', 'SAGE', 'ALNY', 'IONS', 'ARWR', 'RARE'
];

// === 📺 STREAMING & MEDIA (15) ===
export const STREAMING_MEDIA = [
  'CNK', 'IMAX', 'MSGS', 'EDR', 'TKO', 'WWE'
];

// === 🏗️ CONSTRUCTION & HOUSING (15) ===
export const CONSTRUCTION_HOUSING = [
  'DHI', 'TPH', 'LEN', 'PHM', 'NVR', 'TOL', 'KBH', 'TMHC', 'MHO', 'CCS', 'MTH',
  'MDC', 'BLD', 'BLDR', 'IBP'
];

// === 📊 ETFs - MAJOR (30) ===
export const MAJOR_ETFS = [
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'VT', 'SCHD', 'JEPI', 'JEPQ',
  'ARKK', 'ARKG', 'ARKF', 'ARKW', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY',
  'XLP', 'XLU', 'XLB', 'XLRE', 'SMH', 'SOXX', 'IGV', 'FXI', 'EEM', 'TLT'
];

// === 📊 ETFs - LEVERAGED (15) ===
export const LEVERAGED_ETFS = [
  'TQQQ', 'SQQQ', 'UPRO', 'SPXU', 'TNA', 'TZA', 'SOXL', 'SOXS', 'LABU', 'LABD',
  'NUGT', 'DUST', 'UVXY', 'SVXY', 'VXX'
];

// === FULL UNIVERSE (800+ unique tickers) ===
export function getFullUniverse(): string[] {
  const allTickers = new Set([
    ...MEGA_CAP_TECH,
    ...FINANCIALS,
    ...HEALTHCARE,
    ...INDUSTRIALS,
    ...CONSUMER_DISCRETIONARY,
    ...CONSUMER_STAPLES,
    ...ENERGY,
    ...UTILITIES_CLEAN_ENERGY,
    ...REAL_ESTATE,
    ...COMMUNICATION_SERVICES,
    ...QUANTUM_COMPUTING,
    ...NUCLEAR_URANIUM,
    ...AI_SOFTWARE,
    ...SPACE_SATELLITES,
    ...EV_AUTONOMOUS,
    ...CRYPTO_BLOCKCHAIN,
    ...SEMICONDUCTORS,
    ...OPTICS_PHOTONICS,
    ...DEFENSE_AEROSPACE,
    ...CANNABIS,
    ...COMMODITIES_MATERIALS,
    ...GAMING_ENTERTAINMENT,
    ...ECOMMERCE_LOGISTICS,
    ...HIGH_MOMENTUM_MIDCAPS,  // CVNA, DASH, UBER, LYFT, GME, AMC, etc.
    ...CHINA_ADRS,             // BABA, BIDU, JD, PDD, NIO, etc.
    ...SMALL_CAP_MOVERS,       // Penny stocks that can move 10%+ daily
    ...TOP_VOLUME_STOCKS,      // Most traded by volume
    ...REGIONAL_BANKS,
    ...TELECOM_5G,
    ...BIOTECH_PENNY,
    ...STREAMING_MEDIA,
    ...CONSTRUCTION_HOUSING,
    ...MAJOR_ETFS,
    ...LEVERAGED_ETFS,
    // The operator's own lists were NEVER part of the "full" universe — CRCL
    // sat on USER_CORE_WATCHLIST while the pattern engine (which sweeps this
    // function's output) could not see it. Caught by a live pipeline trace on
    // 2026-08-26: "full universe: 761 names | CRCL in it: false". The names
    // the operator explicitly watches belong in every universal sweep, by
    // definition of the word full.
    ...USER_CORE_WATCHLIST,
    ...PREMIUM_WATCHLIST
  ]);
  return Array.from(allTickers);
}

// Sector-specific getters for targeted scanning
export function getSectorTickers(sector: string): string[] {
  const sectorMap: Record<string, string[]> = {
    'tech': MEGA_CAP_TECH,
    'financials': FINANCIALS,
    'healthcare': HEALTHCARE,
    'industrials': INDUSTRIALS,
    'consumer': [...CONSUMER_DISCRETIONARY, ...CONSUMER_STAPLES],
    'energy': ENERGY,
    'utilities': UTILITIES_CLEAN_ENERGY,
    'real_estate': REAL_ESTATE,
    'communication': COMMUNICATION_SERVICES,
    'quantum': QUANTUM_COMPUTING,
    'nuclear': NUCLEAR_URANIUM,
    'ai': AI_SOFTWARE,
    'space': SPACE_SATELLITES,
    'ev': EV_AUTONOMOUS,
    'crypto': CRYPTO_BLOCKCHAIN,
    'semiconductors': SEMICONDUCTORS,
    'optics': OPTICS_PHOTONICS,
    'defense': DEFENSE_AEROSPACE,
    'cannabis': CANNABIS,
    'commodities': COMMODITIES_MATERIALS,
    'gaming': GAMING_ENTERTAINMENT,
    'ecommerce': ECOMMERCE_LOGISTICS,
    'momentum': HIGH_MOMENTUM_MIDCAPS,  // CVNA, DASH, UBER, etc.
    'china': CHINA_ADRS,                 // BABA, BIDU, JD, etc.
    'smallcap': SMALL_CAP_MOVERS,        // Penny stocks with big moves
    'topvolume': TOP_VOLUME_STOCKS,      // Most traded stocks
    'banks': REGIONAL_BANKS,
    'telecom': TELECOM_5G,
    'biotech': BIOTECH_PENNY,
    'media': STREAMING_MEDIA,
    'construction': CONSTRUCTION_HOUSING,
    'etfs': [...MAJOR_ETFS, ...LEVERAGED_ETFS]
  };
  return sectorMap[sector] || [];
}

// High-priority tickers for Best Setups & Premium Alerts
export const PREMIUM_WATCHLIST = [
  // Index ETFs (SPX lottos - crazy moves)
  'SPY', 'QQQ', 'IWM', 'DIA', 'TQQQ', 'SQQQ', 'UPRO', 'SPXU',
  // Nuclear plays (high conviction)
  'NNE', 'OKLO', 'SMR', 'LEU', 'CCJ', 'UEC', 'UUUU',
  // Quantum plays
  'IONQ', 'RGTI', 'QUBT', 'QBTS',
  // AI leaders
  'NVDA', 'PLTR', 'SOUN', 'AI', 'SMCI', 'ARM',
  // Space
  'RKLB', 'ASTS', 'LUNR',
  // EV/Autonomous
  'TSLA', 'RIVN', 'JOBY', 'ACHR',
  // Crypto miners
  'MARA', 'RIOT', 'CLSK', 'COIN', 'MSTR',
  // Defense drones
  'RCAT', 'KTOS', 'AVAV',
  // Mega caps (always liquid)
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AMD',
  // Popular retail
  'SBUX', 'NKE', 'DIS', 'NFLX'
];

/**
 * USER CORE WATCHLIST — the operator's own names.
 *
 * Kept separate from PREMIUM_WATCHLIST on purpose: that list feeds Best Setups
 * and premium alerting, and silently doubling it would change those surfaces
 * too. This one exists so the idea generator always quotes these regardless of
 * what a screener happened to surface that day.
 *
 * Why it matters: before this, APP, CRCL, ASST, CRWV, WDC, SNDK and SATL were
 * not in getFullUniverse() at all. CRCL still produced 25 ideas and ASST 11 —
 * but only because both were Yahoo day-gainers those sessions. On a quiet day
 * for a name, it simply vanished from the board. Coverage by luck is not
 * coverage.
 */
export const USER_CORE_WATCHLIST = [
  // Persistent core — carried week to week
  'PLTR', 'CRWV', 'ARM', 'MRVL', 'TSLA', 'ORCL', 'AMD', 'CRCL',
  'APP', 'SMH', 'WDC', 'SNDK', 'FSLY', 'SATL',
  // Highest-conviction backtested tier
  'AAOI', 'OKLO', 'LUNR', 'KLAC', 'SMTC', 'AEHR', 'OLED', 'RMBS',
  'BILL', 'INTA', 'MKSI',
  // Second tier
  'LRCX', 'AFRM', 'MU', 'TSEM', 'COIN', 'HIMS', 'ONTO', 'ENTG',
  'UPST', 'DUOL', 'PATH', 'MDB', 'AMBA', 'COHU', 'SNOW', 'NET',
  'FRSH', 'ESTC', 'ACLS', 'ASAN', 'QCOM',
  // Recent live plays worth keeping quoted
  'MARA', 'ASST',
];

// Lotto-eligible tickers (penny stocks with liquid options)
export const LOTTO_ELIGIBLE = [
  // Quantum pennies
  'RGTI', 'QUBT', 'QBTS', 'ARQQ', 'QMCO',
  // Nuclear pennies
  'DNN', 'URG', 'LTBR', 'NNE', 'OKLO', 'SMR',
  // Space pennies
  'SPCE', 'BKSY', 'RDW', 'LUNR',
  // EV pennies
  'LCID', 'NIO', 'RIVN', 'NKLA', 'CHPT', 'BLNK',
  // Biotech pennies
  'NVAX', 'EDIT', 'INO', 'VXRT', 'NKTR',
  // Clean energy pennies
  'PLUG', 'FCEL', 'STEM', 'QS', 'EOSE',
  // Crypto miners
  'BTBT', 'BITF', 'CIFR', 'WULF',
  // AI pennies
  'SOUN', 'BBAI',
  // Cannabis
  'TLRY', 'CGC', 'SNDL',
  // Defense drones
  'RCAT', 'JOBY', 'ACHR', 'UAVS'
];

// Count unique tickers
export function getUniverseStats(): { total: number; sectors: Record<string, number> } {
  const full = getFullUniverse();
  return {
    total: full.length,
    sectors: {
      'Mega Cap Tech': MEGA_CAP_TECH.length,
      'Financials': FINANCIALS.length,
      'Healthcare': HEALTHCARE.length,
      'Industrials': INDUSTRIALS.length,
      'Consumer Discretionary': CONSUMER_DISCRETIONARY.length,
      'Consumer Staples': CONSUMER_STAPLES.length,
      'Energy': ENERGY.length,
      'Utilities & Clean Energy': UTILITIES_CLEAN_ENERGY.length,
      'Real Estate': REAL_ESTATE.length,
      'Communication Services': COMMUNICATION_SERVICES.length,
      'Quantum Computing': QUANTUM_COMPUTING.length,
      'Nuclear & Uranium': NUCLEAR_URANIUM.length,
      'AI & Software': AI_SOFTWARE.length,
      'Space & Satellites': SPACE_SATELLITES.length,
      'EV & Autonomous': EV_AUTONOMOUS.length,
      'Crypto & Blockchain': CRYPTO_BLOCKCHAIN.length,
      'Semiconductors': SEMICONDUCTORS.length,
      'Defense & Aerospace': DEFENSE_AEROSPACE.length,
      'Cannabis': CANNABIS.length,
      'Commodities & Materials': COMMODITIES_MATERIALS.length,
      'Gaming & Entertainment': GAMING_ENTERTAINMENT.length,
      'E-Commerce & Logistics': ECOMMERCE_LOGISTICS.length,
      'High-Momentum Mid-Caps': HIGH_MOMENTUM_MIDCAPS.length,
      'China ADRs': CHINA_ADRS.length,
      'Small-Cap Movers': SMALL_CAP_MOVERS.length,
      'Top Volume Stocks': TOP_VOLUME_STOCKS.length,
      'Regional Banks': REGIONAL_BANKS.length,
      'Telecom & 5G': TELECOM_5G.length,
      'Biotech Penny': BIOTECH_PENNY.length,
      'Streaming & Media': STREAMING_MEDIA.length,
      'Construction & Housing': CONSTRUCTION_HOUSING.length,
      'Major ETFs': MAJOR_ETFS.length,
      'Leveraged ETFs': LEVERAGED_ETFS.length
    }
  };
}
