import { SectorFocus, RiskProfile, ResearchHorizon } from '@shared/schema';

const SECTOR_MAPPINGS: Record<string, SectorFocus> = {
  'IONQ': 'quantum_computing',
  'RGTI': 'quantum_computing',
  'QUBT': 'quantum_computing',
  'QBTS': 'quantum_computing',
  'ARQQ': 'quantum_computing',
  'QMCO': 'quantum_computing',
  'QTUM': 'quantum_computing',
  'FORM': 'quantum_computing',
  
  'NNE': 'nuclear',
  'OKLO': 'nuclear',
  'SMR': 'nuclear',
  'LEU': 'nuclear',
  'CCJ': 'nuclear',
  'UEC': 'nuclear',
  'UUUU': 'nuclear',
  'DNN': 'nuclear',
  'NXE': 'nuclear',
  'BWXT': 'nuclear',
  'CEG': 'nuclear',
  'VST': 'nuclear',
  'URG': 'nuclear',
  'UROY': 'nuclear',
  'LTBR': 'nuclear',
  'URA': 'nuclear',
  
  'NVAX': 'healthcare',
  'MRNA': 'healthcare',
  'BNTX': 'healthcare',
  'CRSP': 'healthcare',
  'EDIT': 'healthcare',
  'NTLA': 'healthcare',
  'BEAM': 'healthcare',
  'VERV': 'healthcare',
  'BLUE': 'healthcare',
  'INO': 'healthcare',
  'SRNE': 'healthcare',
  'VXRT': 'healthcare',
  'NKTR': 'healthcare',
  'ADVM': 'healthcare',
  'FATE': 'healthcare',
  'GRTS': 'healthcare',
  'IMVT': 'healthcare',
  'RXRX': 'healthcare',
  
  'SOUN': 'ai_ml',
  'BBAI': 'ai_ml',
  'AI': 'ai_ml',
  'PLTR': 'ai_ml',
  'PATH': 'ai_ml',
  'SNOW': 'ai_ml',
  'DDOG': 'ai_ml',
  'MDB': 'ai_ml',
  'ESTC': 'ai_ml',
  'GTLB': 'ai_ml',
  'GFAI': 'ai_ml',
  
  'ASTS': 'space',
  'RKLB': 'space',
  'LUNR': 'space',
  'RDW': 'space',
  'SPCE': 'space',
  'BKSY': 'space',
  'IRDM': 'space',
  'LLAP': 'space',
  
  'PLUG': 'clean_energy',
  'FCEL': 'clean_energy',
  'BE': 'clean_energy',
  'ENPH': 'clean_energy',
  'SEDG': 'clean_energy',
  'RUN': 'clean_energy',
  'ENVX': 'clean_energy',
  'QS': 'clean_energy',
  'STEM': 'clean_energy',
  'CLNE': 'clean_energy',
  'BLDP': 'clean_energy',
  'RIVN': 'clean_energy',
  'LCID': 'clean_energy',
  'NIO': 'clean_energy',
  'XPEV': 'clean_energy',
  'LI': 'clean_energy',
  'CHPT': 'clean_energy',
  'BLNK': 'clean_energy',
  'EVGO': 'clean_energy',
  
  'MARA': 'crypto',
  'RIOT': 'crypto',
  'CLSK': 'crypto',
  'BTBT': 'crypto',
  'BITF': 'crypto',
  'HUT': 'crypto',
  'CIFR': 'crypto',
  'COIN': 'crypto',
  'MSTR': 'crypto',
  'WULF': 'crypto',
  'IREN': 'crypto',
  
  'BROS': 'consumer',
  'SBUX': 'consumer',
  'MCD': 'consumer',
  'CMG': 'consumer',
  'YUM': 'consumer',
  'DPZ': 'consumer',
  'QSR': 'consumer',

  'DKNG': 'gaming',
  'PENN': 'gaming',
  'MGM': 'gaming',
  'CZR': 'gaming',
  'TTWO': 'gaming',
  'EA': 'gaming',
  'RBLX': 'gaming',

  'UPST': 'fintech',
  'AFRM': 'fintech',
  'SOFI': 'fintech',
  'DAVE': 'fintech',
  'HOOD': 'fintech',
  'SQ': 'fintech',
  'PYPL': 'fintech',
  'NU': 'fintech',
};

const PENNY_STOCK_SYMBOLS = new Set([
  'RGTI', 'QUBT', 'QBTS', 'ARQQ', 'QMCO',
  'DNN', 'URG', 'LTBR',
  'EDIT', 'BLUE', 'INO', 'SRNE', 'VXRT', 'NKTR', 'ADVM', 'FATE', 'GRTS',
  'BBAI', 'GFAI',
  'SPCE', 'BKSY', 'LLAP', 'RDW',
  'PLUG', 'FCEL', 'STEM', 'QS', 'BLDP', 'CLNE',
  'LCID', 'NIO', 'CHPT', 'BLNK', 'EVGO', 'FFIE', 'GOEV', 'NKLA',
  'BTBT', 'BITF', 'WULF', 'CIFR',
  'TLRY', 'CGC', 'SNDL', 'ACB',
  'SLI', 'PLL',
  'RCAT', 'UAVS',
]);

const ULTRA_SPECULATIVE_SYMBOLS = new Set([
  'FFIE', 'GOEV', 'NKLA', 'SRNE', 'UAVS', 'LLAP', 'BKSY',
  'GME', 'AMC', 'SNDL',
]);

export function detectSectorFocus(symbol: string): SectorFocus {
  return SECTOR_MAPPINGS[symbol.toUpperCase()] || 'other';
}

export function detectRiskProfile(
  symbol: string,
  price: number,
  isLottoPlay: boolean = false,
  assetType: string = 'stock'
): RiskProfile {
  const upperSymbol = symbol.toUpperCase();
  
  if (ULTRA_SPECULATIVE_SYMBOLS.has(upperSymbol) || price < 1) {
    return 'speculative';
  }
  
  if (isLottoPlay || assetType === 'option') {
    if (price < 0.50) return 'speculative';
    if (price < 2.00) return 'aggressive';
    return 'moderate';
  }
  
  if (PENNY_STOCK_SYMBOLS.has(upperSymbol) || price < 5) {
    return 'aggressive';
  }
  
  if (price < 20) {
    return 'moderate';
  }
  
  return 'conservative';
}

export function detectResearchHorizon(
  holdingPeriod: string,
  daysToExpiry?: number
): ResearchHorizon {
  if (holdingPeriod === 'day') return 'intraday';
  if (holdingPeriod === 'swing' || holdingPeriod === 'week-ending') return 'short_swing';
  if (holdingPeriod === 'position') {
    if (daysToExpiry && daysToExpiry > 30) return 'thematic_long';
    return 'multi_week';
  }
  
  if (daysToExpiry) {
    if (daysToExpiry <= 7) return 'intraday';
    if (daysToExpiry <= 21) return 'short_swing';
    if (daysToExpiry <= 60) return 'multi_week';
    return 'thematic_long';
  }
  
  return 'intraday';
}

export function getEducationalDisclaimer(riskProfile: RiskProfile, sectorFocus?: SectorFocus): string {
  const baseDisclaimer = 'Educational research only - not financial advice.';
  
  if (riskProfile === 'speculative') {
    return `⚠️ HIGH-VARIANCE RESEARCH SCENARIO: This represents an extremely speculative opportunity with potential for total capital loss. ${baseDisclaimer} Suitable only for risk capital you can afford to lose entirely.`;
  }
  
  if (riskProfile === 'aggressive') {
    return `⚠️ ELEVATED RISK SCENARIO: This represents an aggressive opportunity with higher-than-average volatility. ${baseDisclaimer} Consider position sizing carefully.`;
  }
  
  if (sectorFocus === 'quantum_computing' || sectorFocus === 'nuclear') {
    return `🔬 EMERGING TECHNOLOGY: ${sectorFocus === 'quantum_computing' ? 'Quantum computing' : 'Nuclear energy'} is an early-stage sector with binary outcomes. ${baseDisclaimer}`;
  }
  
  return baseDisclaimer;
}

export function isPennyStock(symbol: string, price: number): boolean {
  return PENNY_STOCK_SYMBOLS.has(symbol.toUpperCase()) || price < 5;
}
