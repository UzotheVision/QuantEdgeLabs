import WebSocket, { WebSocketServer } from 'ws';
import { logger } from './logger';
import type { Server } from 'http';

export type BotEventType = 'looking' | 'signal' | 'entry' | 'exit' | 'skip' | 'error';

export interface BotNotification {
  type: 'bot_event';
  eventType: BotEventType;
  symbol: string;
  optionType?: 'call' | 'put';
  strike?: number;
  expiry?: string;
  price?: number;
  quantity?: number;
  confidence?: number;
  reason?: string;
  /** Stable origin lets clients route high-priority index alerts without
   * guessing from prose. */
  source?: 'quant_bot' | 'index_scalp' | 'tradingview' | 'system';
  ideaId?: string;
  portfolio?: 'options' | 'small_account' | 'futures' | 'crypto';
  pnl?: number;
  timestamp: string;
}

let botWss: WebSocketServer | null = null;

export function broadcastBotEvent(notification: Omit<BotNotification, 'type' | 'timestamp'>): void {
  if (!botWss) {
    logger.debug('[BOT-WS] No WebSocket server, skipping broadcast');
    return;
  }
  
  const message: BotNotification = {
    type: 'bot_event',
    ...notification,
    timestamp: new Date().toISOString()
  };
  
  const payload = JSON.stringify(message);
  let sent = 0;
  
  botWss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
      sent++;
    }
  });
  
  if (sent > 0) {
    const emoji = notification.eventType === 'entry' ? '🟢' : 
                  notification.eventType === 'exit' ? '🔴' : 
                  notification.eventType === 'looking' ? '👀' : '⚪';
    logger.info(`[BOT-WS] ${emoji} Broadcast ${notification.eventType.toUpperCase()} ${notification.symbol} to ${sent} clients`);
  }
}

export function initializeBotNotificationService(httpServer: Server): void {
  if (botWss) {
    logger.info('[BOT-WS] Bot notification WebSocket already initialized');
    return;
  }
  
  botWss = new WebSocketServer({ noServer: true });
  
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    
    if (pathname === '/ws/bot') {
      botWss!.handleUpgrade(request, socket, head, (ws) => {
        botWss!.emit('connection', ws, request);
      });
    }
  });
  
  botWss.on('connection', (ws) => {
    logger.info(`[BOT-WS] Client connected (total: ${botWss?.clients.size})`);
    
    ws.send(JSON.stringify({
      type: 'bot_event',
      eventType: 'connected',
      symbol: 'SYSTEM',
      reason: 'Connected to bot notification feed',
      timestamp: new Date().toISOString()
    }));
    
    ws.on('close', () => {
      logger.info(`[BOT-WS] Client disconnected (total: ${botWss?.clients.size})`);
    });
    
    ws.on('error', (error) => {
      logger.error('[BOT-WS] Client error:', error);
    });
  });
  
  logger.info('[BOT-WS] Bot notification WebSocket server started on /ws/bot');
}

export function shutdownBotNotificationService(): void {
  if (botWss) {
    botWss.close();
    botWss = null;
    logger.info('[BOT-WS] Bot notification service shut down');
  }
}
