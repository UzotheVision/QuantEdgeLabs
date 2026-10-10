/**
 * CONTRACT ANALYZER — Trade Text Parser
 * =======================================
 * Accepts loose human input and produces a ContractSpec the engine can analyze.
 *
 * Supported formats (all parse to the same shape):
 *
 *   "MU 415C 5/29 @ $5.00 x 1"
 *   "QCOM Jan 16 2027 $300C × 1 @ $18.50"
 *   "AAPL 200P 6/18 @ 4.20"
 *   "DGXX 7c 2027-01-15"
 *   "spy 500c 2026-12-19 5x"
 *   "tsla 400P jul 2026"
 *
 * Returns null when the input can't be confidently parsed (don't guess).
 */

export interface ContractSpec {
  symbol: string;
  strike: number;
  expiry: string;        // YYYY-MM-DD
  optionType: 'call' | 'put';
  contracts?: number;    // optional position size
  fillPrice?: number;    // optional entry premium
  /** True if the parser had to make assumptions */
  inferredFields?: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad2(n: number): string { return n.toString().padStart(2, '0'); }

function normalizeYear(y: number): number {
  if (y >= 100) return y;
  // 2-digit years: 00-49 → 20xx, 50-99 → 19xx (unlikely for options)
  return y < 50 ? 2000 + y : 1900 + y;
}

/**
 * Try to extract a date in any common format.
 * Returns YYYY-MM-DD or null.
 */
function parseDate(text: string): string | null {
  const t = text.toLowerCase();

  // Format 1: YYYY-MM-DD or YYYY/MM/DD
  const iso = t.match(/(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${pad2(parseInt(iso[2]))}-${pad2(parseInt(iso[3]))}`;
  }

  // Format 2: MM/DD/YY or MM/DD/YYYY or MM/DD (assumes current/next year)
  const mdyMatch = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (mdyMatch) {
    const mm = parseInt(mdyMatch[1]);
    const dd = parseInt(mdyMatch[2]);
    let yy = mdyMatch[3] ? normalizeYear(parseInt(mdyMatch[3])) : new Date().getFullYear();
    // If we inferred year and the date already passed, assume next year
    if (!mdyMatch[3]) {
      const candidate = new Date(yy, mm - 1, dd);
      if (candidate < new Date()) yy = yy + 1;
    }
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${yy}-${pad2(mm)}-${pad2(dd)}`;
    }
  }

  // Format 3: "Jan 15 2027" / "January 2027" / "Jun 18"
  const monthName = t.match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/);
  if (monthName) {
    const mm = MONTH_MAP[monthName[1]];
    // Look for day + year nearby
    const after = t.slice(t.indexOf(monthName[1]) + monthName[1].length);
    const dayMatch = after.match(/\b(\d{1,2})\b/);
    const yearMatch = after.match(/\b(20\d{2})\b/);
    const dd = dayMatch ? parseInt(dayMatch[1]) : 15; // default mid-month for "June 2027"
    let yy = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
    // If we inferred year and the month already passed, assume next year
    if (!yearMatch) {
      const candidate = new Date(yy, mm - 1, dd);
      if (candidate < new Date()) yy = yy + 1;
    }
    if (dd >= 1 && dd <= 31) {
      return `${yy}-${pad2(mm)}-${pad2(dd)}`;
    }
  }

  return null;
}

// ─── Strike + type extraction ───────────────────────────────────────

/**
 * Find the strike + option type in the text.
 * Supports: "415C", "$415C", "300P", "415c", "p300", "$5.50C", "12.5p"
 */
function parseStrikeAndType(text: string): { strike: number; optionType: 'call' | 'put' } | null {
  const t = text.toLowerCase();
  // Standard: NUMBERc or NUMBERp (allow $ and decimals)
  const m1 = t.match(/\$?(\d+(?:\.\d+)?)\s*([cp])\b/);
  if (m1) {
    const strike = parseFloat(m1[1]);
    const optionType = m1[2] === 'c' ? 'call' : 'put';
    if (strike > 0 && strike < 100000) return { strike, optionType };
  }
  // Inverted: c415 / p300 (rare but valid)
  const m2 = t.match(/\b([cp])\$?(\d+(?:\.\d+)?)\b/);
  if (m2) {
    const strike = parseFloat(m2[2]);
    const optionType = m2[1] === 'c' ? 'call' : 'put';
    if (strike > 0 && strike < 100000) return { strike, optionType };
  }
  // Words: "300 call" / "300 put"
  const m3 = t.match(/\$?(\d+(?:\.\d+)?)\s*(call|put)\b/);
  if (m3) {
    const strike = parseFloat(m3[1]);
    const optionType = m3[2] === 'call' ? 'call' : 'put';
    if (strike > 0 && strike < 100000) return { strike, optionType };
  }
  return null;
}

// ─── Symbol extraction ─────────────────────────────────────────────

/**
 * First token of 1-5 uppercase letters that ISN'T a known direction/format word.
 */
function parseSymbol(text: string): string | null {
  const t = text.toUpperCase();
  // OCC format like "O:MU260529C00415000" → extract the prefix before digits
  const occ = t.match(/^O?:?([A-Z]{1,6})\d{6,8}[CP]/);
  if (occ) return occ[1];
  // Common: first 1-5 letter chunk
  const words = t.split(/[\s,\/\-_@×x]+/).filter(Boolean);
  const blacklist = new Set(['CALL','PUT','BUY','SELL','LONG','SHORT','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','SEPT','OCT','NOV','DEC','EXP','EXPIRY','LIMIT','MID','BID','ASK','CON','CONS','LOT']);
  for (const w of words) {
    if (w.length < 1 || w.length > 6) continue;
    if (!/^[A-Z]+$/.test(w)) continue;
    if (blacklist.has(w)) continue;
    return w;
  }
  return null;
}

// ─── Contracts (size) extraction ───────────────────────────────────

function parseContracts(text: string): number | undefined {
  const t = text.toLowerCase();
  // "x 5", "× 3", "5x", "5 cons", "5 contracts"
  const m = t.match(/(?:×|x|)\s*(\d+)\s*(?:×|x|cons?|contracts?|lots?)\b/) ||
            t.match(/(\d+)\s*(?:×|x|cons?|contracts?|lots?)/) ||
            t.match(/×\s*(\d+)/) ||
            t.match(/\bx\s*(\d+)\b/);
  if (m) {
    const n = parseInt(m[1]);
    if (n > 0 && n < 10000) return n;
  }
  return undefined;
}

// ─── Fill price extraction ─────────────────────────────────────────

function parseFillPrice(text: string): number | undefined {
  // "@ $5.00", "@ 1.20", "$18.50 mid"
  const m = text.match(/@\s*\$?(\d+(?:\.\d+)?)/);
  if (m) {
    const p = parseFloat(m[1]);
    if (p > 0 && p < 10000) return p;
  }
  return undefined;
}

// ─── Main parser ───────────────────────────────────────────────────

export function parseContractInput(raw: string): ContractSpec | null {
  if (!raw || raw.trim().length < 3) return null;
  const text = raw.trim();
  const inferred: string[] = [];

  const symbol = parseSymbol(text);
  if (!symbol) return null;

  const st = parseStrikeAndType(text);
  if (!st) return null;

  const expiry = parseDate(text);
  if (!expiry) return null;

  const contracts = parseContracts(text);
  const fillPrice = parseFillPrice(text);

  // Sanity: expiry must be in the future (within 3 years)
  const expMs = new Date(expiry).getTime();
  const nowMs = Date.now();
  if (expMs < nowMs - 86400000 * 7) return null; // > 7 days ago = bad parse
  if (expMs > nowMs + 86400000 * 365 * 3) return null;

  return {
    symbol,
    strike: st.strike,
    expiry,
    optionType: st.optionType,
    contracts,
    fillPrice,
    inferredFields: inferred.length > 0 ? inferred : undefined,
  };
}

// ─── OCC symbol parser ─────────────────────────────────────────────

/**
 * Parse OCC format directly: O:MU260529C00415000 or MU260529C00415000
 * Format: SYM + YYMMDD + C/P + 8-digit (strike × 1000)
 */
export function parseOCCSymbol(occ: string): ContractSpec | null {
  const cleaned = occ.replace(/^O:?/i, '').toUpperCase();
  const m = cleaned.match(/^([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  const [, symbol, yy, mm, dd, cp, strikeRaw] = m;
  return {
    symbol,
    strike: parseInt(strikeRaw) / 1000,
    expiry: `20${yy}-${mm}-${dd}`,
    optionType: cp === 'C' ? 'call' : 'put',
  };
}
