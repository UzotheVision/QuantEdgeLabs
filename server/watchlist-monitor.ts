import { db } from './db';
import { watchlist } from '@shared/schema';
import { eq, and, gt } from 'drizzle-orm';
import { fetchStockPrice, fetchCryptoPrice } from './market-api';
import { sendDiscordAlert } from './discord-service';
import { logger } from './logger';

// Watchlist Price Alert Types
type AlertType = 'entry' | 'stop' | 'target';

interface PriceAlert {
  watchlistId: string;
  symbol: string;
  assetType: string;
  alertType: AlertType;
  currentPrice: number;
  alertPrice: number;
  percentFromTarget: number;
}

/**
 * Main watchlist monitoring function
 * Checks all watchlist items with alerts enabled and sends notifications
 */
export async function monitorWatchlist(): Promise<PriceAlert[]> {
  const triggeredAlerts: PriceAlert[] = [];
  
  try {
    // Fetch all watchlist items with alerts enabled
    const watchlistItems = await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.alertsEnabled, true));
    
    if (watchlistItems.length === 0) {
      logger.info('📊 Watchlist Monitor: No items with alerts enabled');
      return [];
    }
    
    logger.info(`📊 Watchlist Monitor: Checking ${watchlistItems.length} items...`);
    
    // Check each watchlist item
    for (const item of watchlistItems) {
      try {
        // Fetch current price based on asset type
        let currentPrice: number | null = null;
        
        if (item.assetType === 'crypto') {
          const data = await fetchCryptoPrice(item.symbol);
          currentPrice = data?.currentPrice || null;
        } else {
          const data = await fetchStockPrice(item.symbol);
          currentPrice = data?.currentPrice || null;
        }
        
        if (!currentPrice) {
          logger.info(`⚠️ Watchlist Monitor: Could not fetch price for ${item.symbol}`);
          continue;
        }
        
        // Check if we should send alerts (cooldown: 1 hour minimum between alerts)
        const shouldSendAlert = !item.lastAlertSent || 
          (Date.now() - new Date(item.lastAlertSent).getTime()) > (60 * 60 * 1000); // 1 hour cooldown
        
        if (!shouldSendAlert) {
          continue; // Skip this item - still in cooldown period
        }
        
        // Check entry alert (buying opportunity - price dropped to target)
        if (item.entryAlertPrice && currentPrice <= item.entryAlertPrice) {
          const alert: PriceAlert = {
            watchlistId: item.id,
            symbol: item.symbol,
            assetType: item.assetType,
            alertType: 'entry',
            currentPrice,
            alertPrice: item.entryAlertPrice,
            percentFromTarget: ((currentPrice - item.entryAlertPrice) / item.entryAlertPrice) * 100,
          };
          
          triggeredAlerts.push(alert);
          await sendWatchlistAlert(item, alert);
          continue; // Only send one alert per check to avoid spam
        }
        
        // Check stop loss alert
        if (item.stopAlertPrice && currentPrice <= item.stopAlertPrice) {
          const alert: PriceAlert = {
            watchlistId: item.id,
            symbol: item.symbol,
            assetType: item.assetType,
            alertType: 'stop',
            currentPrice,
            alertPrice: item.stopAlertPrice,
            percentFromTarget: ((currentPrice - item.stopAlertPrice) / item.stopAlertPrice) * 100,
          };
          
          triggeredAlerts.push(alert);
          await sendWatchlistAlert(item, alert);
          continue; // Only send one alert per check to avoid spam
        }
        
        // Check profit target alert
        if (item.targetAlertPrice && currentPrice >= item.targetAlertPrice) {
          const alert: PriceAlert = {
            watchlistId: item.id,
            symbol: item.symbol,
            assetType: item.assetType,
            alertType: 'target',
            currentPrice,
            alertPrice: item.targetAlertPrice,
            percentFromTarget: ((currentPrice - item.targetAlertPrice) / item.targetAlertPrice) * 100,
          };
          
          triggeredAlerts.push(alert);
          await sendWatchlistAlert(item, alert);
        }
        
      } catch (error) {
        logger.error(`❌ Watchlist Monitor: Error checking ${item.symbol}:`, error);
      }
    }
    
    if (triggeredAlerts.length > 0) {
      logger.info(`🔔 Watchlist Monitor: ${triggeredAlerts.length} alerts triggered!`);
    }
    
    return triggeredAlerts;
    
  } catch (error) {
    logger.error('❌ Watchlist Monitor: Fatal error:', error);
    return [];
  }
}

/**
 * Send alert notification via Discord
 * AUTO-DISABLES the triggered alert after firing (one-time alerts)
 */
async function sendWatchlistAlert(item: any, alert: PriceAlert): Promise<void> {
  try {
    // RE-FETCH the latest item from DB to avoid race conditions with PATCH requests
    // This ensures we see any new thresholds added while monitor was processing
    const [freshItem] = await db
      .select()
      .from(watchlist)
      .where(eq(watchlist.id, item.id))
      .limit(1);
    
    if (!freshItem) {
      logger.info(`⚠️ Watchlist item ${item.id} was deleted before alert could be processed`);
      return;
    }
    
    // Build update object - always update tracking fields
    const updateData: Record<string, any> = {
      lastAlertSent: new Date().toISOString(),
      alertCount: (freshItem.alertCount || 0) + 1,
    };
    
    // AUTO-DISABLE: Clear the specific alert price that triggered (one-time alert)
    // This prevents the same alert from firing repeatedly
    if (alert.alertType === 'entry') {
      updateData.entryAlertPrice = null;
      logger.info(`🔕 Auto-disabled entry alert for ${alert.symbol} after firing`);
    } else if (alert.alertType === 'stop') {
      updateData.stopAlertPrice = null;
      logger.info(`🔕 Auto-disabled stop alert for ${alert.symbol} after firing`);
    } else if (alert.alertType === 'target') {
      updateData.targetAlertPrice = null;
      logger.info(`🔕 Auto-disabled target alert for ${alert.symbol} after firing`);
    }
    
    // Use FRESH item data to check for remaining alerts
    // This ensures we see any thresholds added via PATCH while monitor was processing
    const effectiveEntry = updateData.entryAlertPrice !== undefined 
      ? updateData.entryAlertPrice 
      : freshItem.entryAlertPrice;
    const effectiveStop = updateData.stopAlertPrice !== undefined 
      ? updateData.stopAlertPrice 
      : freshItem.stopAlertPrice;
    const effectiveTarget = updateData.targetAlertPrice !== undefined 
      ? updateData.targetAlertPrice 
      : freshItem.targetAlertPrice;
    
    // Check if any alert prices remain after this update
    // IMPORTANT: Use explicit null checks, not falsy checks (0 is a valid price)
    const hasRemainingAlerts = 
      (effectiveEntry !== null && effectiveEntry !== undefined) ||
      (effectiveStop !== null && effectiveStop !== undefined) ||
      (effectiveTarget !== null && effectiveTarget !== undefined);
    
    if (!hasRemainingAlerts) {
      updateData.alertsEnabled = false;
      updateData.discordAlertsEnabled = false;
      logger.info(`🔕 All alerts fired for ${alert.symbol} - disabling alert monitoring`);
    }
    
    // Update the database
    await db
      .update(watchlist)
      .set(updateData)
      .where(eq(watchlist.id, freshItem.id));
    
    // Send Discord notification if enabled (use fresh item state)
    if (freshItem.discordAlertsEnabled) {
      await sendDiscordAlert({
        symbol: alert.symbol,
        assetType: alert.assetType,
        alertType: alert.alertType,
        currentPrice: alert.currentPrice,
        alertPrice: alert.alertPrice,
        percentFromTarget: alert.percentFromTarget,
        notes: freshItem.notes || 'Watchlist alert triggered',
      });
    }
    
    logger.info(`✅ Watchlist Alert Sent: ${alert.symbol} ${alert.alertType.toUpperCase()} - $${alert.currentPrice.toFixed(2)} (alert auto-disabled)`);
    
  } catch (error) {
    logger.error(`❌ Failed to send watchlist alert for ${alert.symbol}:`, error);
  }
}

/**
 * Start the watchlist monitoring loop
 * Checks every 5 minutes by default
 */
export function startWatchlistMonitor(intervalMinutes: number = 5): NodeJS.Timeout {
  logger.info(`🚀 Starting Watchlist Monitor (interval: ${intervalMinutes} minutes)`);
  
  // Run immediately on start
  monitorWatchlist();
  
  // Then run on interval
  const interval = setInterval(() => {
    monitorWatchlist();
  }, intervalMinutes * 60 * 1000);
  
  return interval;
}
