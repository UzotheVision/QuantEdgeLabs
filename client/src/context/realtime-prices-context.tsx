import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

interface PriceData {
  price: number;
  source: 'coinbase' | 'yahoo';
  timestamp: string;
  previousPrice?: number;
}

interface PriceMessage {
  type: 'price';
  symbol: string;
  price: number;
  source: 'coinbase' | 'yahoo';
  timestamp: string;
}

interface RealtimePricesContextValue {
  prices: Map<string, PriceData>;
  isConnected: boolean;
  getPrice: (symbol: string) => PriceData | undefined;
}

const RealtimePricesContext = createContext<RealtimePricesContextValue | null>(null);

export function RealtimePricesProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/prices`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (mountedRef.current) {
          setIsConnected(true);
          reconnectAttemptsRef.current = 0;
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: PriceMessage = JSON.parse(event.data);
          
          if (message.type === 'price' && mountedRef.current) {
            setPrices(prev => {
              const newPrices = new Map(prev);
              const existing = newPrices.get(message.symbol);
              newPrices.set(message.symbol, {
                price: message.price,
                source: message.source,
                timestamp: message.timestamp,
                previousPrice: existing?.price
              });
              return newPrices;
            });
          }
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      ws.onclose = () => {
        if (mountedRef.current) {
          setIsConnected(false);
          wsRef.current = null;
          
          const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        ws.close();
      };
    } catch (error) {
      console.error('[WS] Failed to connect:', error);
      const delay = Math.min(3000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
      reconnectAttemptsRef.current++;
      
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, delay);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const getPrice = useCallback((symbol: string): PriceData | undefined => {
    return prices.get(symbol.toUpperCase());
  }, [prices]);

  return (
    <RealtimePricesContext.Provider value={{ prices, isConnected, getPrice }}>
      {children}
    </RealtimePricesContext.Provider>
  );
}

export function useRealtimePrices(): RealtimePricesContextValue {
  const context = useContext(RealtimePricesContext);
  if (!context) {
    return {
      prices: new Map(),
      isConnected: false,
      getPrice: () => undefined
    };
  }
  return context;
}
