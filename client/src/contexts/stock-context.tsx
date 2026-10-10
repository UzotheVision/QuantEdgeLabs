import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface StockInfo {
  symbol: string;
  name?: string;
  price?: number;
  change?: number;
}

interface StockContextValue {
  currentStock: StockInfo | null;
  setCurrentStock: (stock: StockInfo | null) => void;
  clearStock: () => void;
}

const StockContext = createContext<StockContextValue | undefined>(undefined);

export function StockContextProvider({ children }: { children: ReactNode }) {
  const [currentStock, setCurrentStockState] = useState<StockInfo | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = sessionStorage.getItem("quantedge_current_stock");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const setCurrentStock = useCallback((stock: StockInfo | null) => {
    setCurrentStockState(stock);
    // Store in sessionStorage for persistence across page navigation
    if (stock) {
      sessionStorage.setItem("quantedge_current_stock", JSON.stringify(stock));
    } else {
      sessionStorage.removeItem("quantedge_current_stock");
    }
  }, []);

  const clearStock = useCallback(() => {
    setCurrentStockState(null);
    sessionStorage.removeItem("quantedge_current_stock");
  }, []);

  return (
    <StockContext.Provider value={{ currentStock, setCurrentStock, clearStock }}>
      {children}
    </StockContext.Provider>
  );
}

export function useStockContext() {
  const context = useContext(StockContext);
  if (context === undefined) {
    throw new Error("useStockContext must be used within StockContextProvider");
  }
  return context;
}
