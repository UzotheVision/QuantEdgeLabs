import { logger } from './logger';

interface ScanEntry {
  symbol: string;
  source: string;
  lastScanAt: number;
  lastChangePercent?: number;
}

const SCAN_TTL_MS = 60 * 60 * 1000; // 60 minutes default TTL
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Clean every 10 minutes
const PRICE_CHANGE_OVERRIDE_THRESHOLD = 8; // If price moves 8%+ from last scan, allow rescan

const scanCache = new Map<string, ScanEntry>();
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    const entries = Array.from(scanCache.entries());
    for (const [key, entry] of entries) {
      if (now - entry.lastScanAt > SCAN_TTL_MS) {
        scanCache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.debug(`[SCAN-DEDUP] Cleaned ${cleaned} expired entries, ${scanCache.size} remaining`);
    }
  }, CLEANUP_INTERVAL_MS);
}

startCleanupTimer();

export interface ScanCheckResult {
  shouldSkip: boolean;
  reason: string;
  lastScannedBy?: string;
  minutesAgo?: number;
}

export function checkAndMarkScanned(
  symbol: string,
  source: string,
  currentChangePercent?: number
): ScanCheckResult {
  const key = symbol.toUpperCase();
  const now = Date.now();
  const existing = scanCache.get(key);

  if (existing) {
    const ageMs = now - existing.lastScanAt;
    const minutesAgo = Math.round(ageMs / 60000);

    if (ageMs < SCAN_TTL_MS) {
      if (
        currentChangePercent !== undefined &&
        existing.lastChangePercent !== undefined
      ) {
        const changeDiff = Math.abs(currentChangePercent - existing.lastChangePercent);
        if (changeDiff >= PRICE_CHANGE_OVERRIDE_THRESHOLD) {
          scanCache.set(key, {
            symbol: key,
            source,
            lastScanAt: now,
            lastChangePercent: currentChangePercent,
          });
          return {
            shouldSkip: false,
            reason: `Price change delta ${changeDiff.toFixed(1)}% exceeds threshold - rescan allowed`,
          };
        }
      }

      return {
        shouldSkip: true,
        reason: `Recently scanned by ${existing.source} ${minutesAgo}m ago`,
        lastScannedBy: existing.source,
        minutesAgo,
      };
    }
  }

  scanCache.set(key, {
    symbol: key,
    source,
    lastScanAt: now,
    lastChangePercent: currentChangePercent,
  });

  return {
    shouldSkip: false,
    reason: 'New scan allowed',
  };
}

export function getScanCacheStats(): { size: number; entries: { symbol: string; source: string; minutesAgo: number }[] } {
  const now = Date.now();
  const entries = Array.from(scanCache.values()).map(e => ({
    symbol: e.symbol,
    source: e.source,
    minutesAgo: Math.round((now - e.lastScanAt) / 60000),
  }));
  return { size: scanCache.size, entries };
}

export function clearScanCache(): void {
  scanCache.clear();
  logger.info('[SCAN-DEDUP] Cache cleared');
}

export function getRecentlyScannedSymbols(): Set<string> {
  const now = Date.now();
  const recent = new Set<string>();
  const entries = Array.from(scanCache.entries());
  for (const [key, entry] of entries) {
    if (now - entry.lastScanAt < SCAN_TTL_MS) {
      recent.add(key);
    }
  }
  return recent;
}
