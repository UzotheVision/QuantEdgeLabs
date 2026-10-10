/**
 * LAYER TAXONOMY — the 18-layer AI-cycle rotation map.
 *
 * Each "layer" represents a position in the AI buildout chain:
 *   derivative_order: 1 = the AI thing itself (compute/GPU)
 *                     2 = what the AI thing CONSUMES (power, bandwidth, memory)
 *                     3 = what USES the AI thing (SaaS apps, vertical AI)
 *
 * This file is the single source of truth for sector rotation.
 * Hand-curated cap-tiers; expand carefully.
 *
 * Pattern:
 *   When derivative_order=1 layer tops, derivative_order=2 layers heat.
 *   When derivative_order=2 layers mature, derivative_order=3 layers ignite.
 *   Aschenbrenner's trade was D=1 (compute) → D=2 (power+optical+memory+cloud).
 */

export type CapTier = 'mega' | 'large' | 'mid' | 'small' | 'micro';
export type DerivativeOrder = 1 | 2 | 3;

export interface LayerTicker {
  symbol: string;
  cap: CapTier;
}

export interface Layer {
  id: string;                // unique slug — used everywhere
  label: string;             // display name
  description: string;       // 1-line "what is this layer"
  derivativeOrder: DerivativeOrder;
  /** Higher number = closer to the AI core (used for visualization) */
  rank: number;
  tickers: LayerTicker[];
}

// ─── THE 18 LAYERS ─────────────────────────────────────────────────

export const LAYERS: Layer[] = [
  // ═══ DERIVATIVE 1 — the AI thing itself ═══
  {
    id: 'compute_gpu',
    label: 'AI Compute / GPU',
    description: 'The brain — GPUs that run AI training & inference',
    derivativeOrder: 1,
    rank: 1,
    tickers: [
      { symbol: 'NVDA', cap: 'mega' },
      { symbol: 'AMD',  cap: 'large' },
      { symbol: 'TSM',  cap: 'mega' },
      { symbol: 'INTC', cap: 'large' },
    ],
  },
  {
    id: 'asic_custom',
    label: 'ASIC / Custom Si',
    description: 'Hyperscaler in-house chips + connectivity ASICs',
    derivativeOrder: 1,
    rank: 2,
    tickers: [
      { symbol: 'AVGO', cap: 'mega' },
      { symbol: 'MRVL', cap: 'large' },
      { symbol: 'ARM',  cap: 'large' },
      { symbol: 'CRDO', cap: 'small' },
      { symbol: 'ALAB', cap: 'small' },
    ],
  },
  {
    id: 'eda',
    label: 'EDA / Chip Design SW',
    description: 'Tools every chip designer uses — Synopsys, Cadence',
    derivativeOrder: 1,
    rank: 3,
    tickers: [
      { symbol: 'SNPS', cap: 'large' },
      { symbol: 'CDNS', cap: 'large' },
    ],
  },

  // ═══ DERIVATIVE 2 — what the AI consumes ═══
  {
    id: 'memory_hbm',
    label: 'Memory / HBM / Storage',
    description: 'High-bandwidth memory + NAND storage — the bottleneck of bottlenecks',
    derivativeOrder: 2,
    rank: 4,
    tickers: [
      { symbol: 'MU',   cap: 'large' },
      { symbol: 'SNDK', cap: 'mid' },
      { symbol: 'STX',  cap: 'mid' },
      { symbol: 'WDC',  cap: 'mid' },
      { symbol: 'RMBS', cap: 'small' },
    ],
  },
  {
    id: 'semi_equipment',
    label: 'Semi Equipment',
    description: 'The pickaxe — ASML/AMAT/LRCX/KLAC + small-cap tooling',
    derivativeOrder: 2,
    rank: 5,
    tickers: [
      { symbol: 'ASML', cap: 'mega' },
      { symbol: 'AMAT', cap: 'large' },
      { symbol: 'LRCX', cap: 'large' },
      { symbol: 'KLAC', cap: 'large' },
      { symbol: 'ENTG', cap: 'mid' },
      { symbol: 'MKSI', cap: 'small' },
      { symbol: 'ACMR', cap: 'small' },
      { symbol: 'AEHR', cap: 'small' },
      { symbol: 'COHU', cap: 'small' },
      { symbol: 'ICHR', cap: 'small' },
      { symbol: 'ONTO', cap: 'small' },
      { symbol: 'TSEM', cap: 'small' },
      { symbol: 'CAMT', cap: 'small' },
      { symbol: 'AMKR', cap: 'small' },
    ],
  },
  {
    id: 'microcontrollers',
    label: 'Microcontrollers / Power IC',
    description: 'MCUs, power management, GaN/SiC — the silicon every device needs. Shortage thesis play.',
    derivativeOrder: 2,
    rank: 5.5,
    tickers: [
      // Pure-play MCU
      { symbol: 'MCHP', cap: 'large' },
      { symbol: 'SLAB', cap: 'mid' },
      { symbol: 'NXPI', cap: 'large' },
      { symbol: 'ON',   cap: 'large' },
      // Power management / GaN / SiC small-caps (shortage upside)
      { symbol: 'POWI', cap: 'small' },
      { symbol: 'NVTS', cap: 'small' },     // GaN — Aschenbrenner-adjacent
      { symbol: 'AOSL', cap: 'micro' },
      { symbol: 'ALGM', cap: 'small' },
      { symbol: 'HIMX', cap: 'small' },
      { symbol: 'AMBA', cap: 'small' },
      { symbol: 'CEVA', cap: 'micro' },
      { symbol: 'DIOD', cap: 'small' },
      // Adjacent / fab / FPGA
      { symbol: 'LSCC', cap: 'mid' },
      { symbol: 'GFS',  cap: 'mid' },
      { symbol: 'SITM', cap: 'mid' },
    ],
  },
  {
    id: 'cpo_optical',
    label: 'CPO / Optical Interconnect',
    description: 'Co-packaged optics replacing copper at scale — Aschenbrenner\'s LITE pick',
    derivativeOrder: 2,
    rank: 6,
    tickers: [
      { symbol: 'LITE', cap: 'mid' },
      { symbol: 'COHR', cap: 'large' },
      { symbol: 'FN',   cap: 'mid' },
      { symbol: 'AAOI', cap: 'small' },
      { symbol: 'POET', cap: 'micro' },
      { symbol: 'CIEN', cap: 'mid' },
    ],
  },
  {
    id: 'networking_switches',
    label: 'Networking / Switches',
    description: 'The fabric — switch chips + Ethernet IP for AI clusters',
    derivativeOrder: 2,
    rank: 7,
    tickers: [
      { symbol: 'ANET', cap: 'large' },
      { symbol: 'CSCO', cap: 'mega' },
      { symbol: 'JNPR', cap: 'mid' },
      { symbol: 'EXTR', cap: 'small' },
    ],
  },
  {
    id: 'power_generation',
    label: 'Power Generation',
    description: 'Watts — natural gas, gas turbines, nuclear, fuel cells (BE thesis)',
    derivativeOrder: 2,
    rank: 8,
    tickers: [
      { symbol: 'GEV',  cap: 'large' },
      { symbol: 'CEG',  cap: 'large' },
      { symbol: 'VST',  cap: 'mid' },
      { symbol: 'TLN',  cap: 'mid' },
      { symbol: 'BE',   cap: 'mid' },     // Aschenbrenner pick
      { symbol: 'OKLO', cap: 'small' },
      { symbol: 'NNE',  cap: 'small' },
      { symbol: 'SMR',  cap: 'small' },
      { symbol: 'BWXT', cap: 'mid' },
      { symbol: 'LEU',  cap: 'small' },
      { symbol: 'CCJ',  cap: 'mid' },
      { symbol: 'UEC',  cap: 'small' },
      { symbol: 'NEE',  cap: 'mega' },
    ],
  },
  {
    id: 'power_equipment',
    label: 'Power Equipment / Grid',
    description: 'Transmission build, substations, power distribution',
    derivativeOrder: 2,
    rank: 9,
    tickers: [
      { symbol: 'ETN',  cap: 'large' },
      { symbol: 'PWR',  cap: 'large' },
      { symbol: 'HUBB', cap: 'mid' },
      { symbol: 'POWL', cap: 'small' },
      { symbol: 'GNRC', cap: 'mid' },
      { symbol: 'EME',  cap: 'mid' },
    ],
  },
  {
    id: 'cooling_thermal',
    label: 'Cooling / Thermal',
    description: 'Liquid cooling for racks — VRT/MOD/AAON',
    derivativeOrder: 2,
    rank: 10,
    tickers: [
      { symbol: 'VRT',  cap: 'large' },
      { symbol: 'MOD',  cap: 'mid' },
      { symbol: 'AAON', cap: 'mid' },
    ],
  },
  {
    id: 'datacenter_reit',
    label: 'Datacenter REITs',
    description: 'The landlords — DLR/EQIX/IRM',
    derivativeOrder: 2,
    rank: 11,
    tickers: [
      { symbol: 'DLR',  cap: 'large' },
      { symbol: 'EQIX', cap: 'large' },
      { symbol: 'IRM',  cap: 'mid' },
    ],
  },
  {
    id: 'ai_cloud_infra',
    label: 'AI Cloud / GPU-as-a-Service',
    description: 'Renting compute to AI companies — CRWV/IREN (Aschenbrenner picks)',
    derivativeOrder: 2,
    rank: 12,
    tickers: [
      { symbol: 'CRWV', cap: 'mid' },
      { symbol: 'NBIS', cap: 'small' },
      { symbol: 'IREN', cap: 'small' },
      { symbol: 'WULF', cap: 'small' },
      { symbol: 'CIFR', cap: 'small' },
      { symbol: 'HUT',  cap: 'small' },
      { symbol: 'CLSK', cap: 'small' },
      { symbol: 'MARA', cap: 'small' },
      { symbol: 'RIOT', cap: 'small' },
    ],
  },
  {
    id: 'construction',
    label: 'Construction / Engineering',
    description: 'Builders of data centers — IESC/MYRG/MTZ',
    derivativeOrder: 2,
    rank: 13,
    tickers: [
      { symbol: 'PWR',  cap: 'large' },
      { symbol: 'EME',  cap: 'mid' },
      { symbol: 'MTZ',  cap: 'mid' },
      { symbol: 'PRIM', cap: 'small' },
      { symbol: 'STRL', cap: 'small' },
    ],
  },
  {
    id: 'commodities',
    label: 'Commodities Inputs',
    description: 'Copper, uranium, silver, rare earths consumed by the build',
    derivativeOrder: 2,
    rank: 14,
    tickers: [
      { symbol: 'FCX',  cap: 'large' },
      { symbol: 'CCJ',  cap: 'mid' },
      { symbol: 'UEC',  cap: 'small' },
      { symbol: 'MP',   cap: 'small' },
      { symbol: 'UAMY', cap: 'micro' },
      { symbol: 'USAR', cap: 'micro' },
      { symbol: 'LAC',  cap: 'small' },
      { symbol: 'SGML', cap: 'small' },
      { symbol: 'PAAS', cap: 'small' },
    ],
  },

  // ═══ DERIVATIVE 3 — what USES the AI ═══
  {
    id: 'ai_software_app',
    label: 'AI Software (3rd derivative)',
    description: 'SaaS that consumes AI capacity — CRM/PANW/CRWD/DDOG/MDB/SNOW',
    derivativeOrder: 3,
    rank: 15,
    tickers: [
      { symbol: 'CRM',  cap: 'mega' },
      { symbol: 'PANW', cap: 'large' },
      { symbol: 'NOW',  cap: 'mega' },
      { symbol: 'CRWD', cap: 'large' },
      { symbol: 'DDOG', cap: 'large' },
      { symbol: 'NET',  cap: 'large' },
      { symbol: 'ZS',   cap: 'mid' },
      { symbol: 'MDB',  cap: 'large' },
      { symbol: 'SNOW', cap: 'large' },
      { symbol: 'HUBS', cap: 'large' },
      { symbol: 'BILL', cap: 'small' },
      { symbol: 'PATH', cap: 'small' },
      { symbol: 'ASAN', cap: 'small' },
      { symbol: 'GTLB', cap: 'mid' },
      { symbol: 'SOUN', cap: 'small' },
      { symbol: 'AI',   cap: 'small' },
      { symbol: 'PLTR', cap: 'large' },
    ],
  },
  {
    id: 'edge_automotive',
    label: 'Edge / Automotive AI',
    description: 'Where inference runs — TSLA/MBLY + auto OS plays',
    derivativeOrder: 3,
    rank: 16,
    tickers: [
      { symbol: 'TSLA', cap: 'mega' },
      { symbol: 'MBLY', cap: 'mid' },
      { symbol: 'BB',   cap: 'small' },
      { symbol: 'AMBA', cap: 'small' },
    ],
  },
  {
    id: 'robotics',
    label: 'Robotics / Humanoid',
    description: 'Coming wave — Symbotic/Kodiak/SYM',
    derivativeOrder: 3,
    rank: 17,
    tickers: [
      { symbol: 'SYM',  cap: 'mid' },
      { symbol: 'ABB',  cap: 'large' },
      { symbol: 'ROK',  cap: 'large' },
      { symbol: 'RCAT', cap: 'micro' },
    ],
  },
  {
    id: 'bio_ai',
    label: 'Bio-AI / Drug Discovery',
    description: 'AI for biology — RXRX/ABCL/VRNT',
    derivativeOrder: 3,
    rank: 18,
    tickers: [
      { symbol: 'RXRX', cap: 'small' },
      { symbol: 'ABCL', cap: 'small' },
      { symbol: 'ABSI', cap: 'micro' },
      { symbol: 'NTLA', cap: 'small' },
    ],
  },
];

// ─── Lookup helpers ────────────────────────────────────────────────

export const LAYER_BY_ID: Record<string, Layer> = Object.fromEntries(
  LAYERS.map(l => [l.id, l]),
);

/** All unique tickers across all layers */
export const ALL_LAYER_TICKERS: string[] = Array.from(
  new Set(LAYERS.flatMap(l => l.tickers.map(t => t.symbol))),
);

/** symbol → layers it appears in (a name can be in multiple) */
export const LAYERS_BY_SYMBOL: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const l of LAYERS) {
    for (const t of l.tickers) {
      (map[t.symbol] ??= []).push(l.id);
    }
  }
  return map;
})();

/** Cap weight for a tier — used in spread / aggregation calculations */
export const CAP_WEIGHT: Record<CapTier, number> = {
  mega:  1.0,
  large: 0.7,
  mid:   0.4,
  small: 0.2,
  micro: 0.1,
};
