// Wallet Sync Service for whale wallet tracking
// Supports both real data (with Alchemy API) and mock data for demo

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

// Mock token data for demo
const POPULAR_TOKENS_ETH = [
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "WETH", name: "Wrapped Ethereum" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "USDT", name: "Tether" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "UNI", name: "Uniswap" },
];

const POPULAR_TOKENS_SOL = [
  { symbol: "SOL", name: "Solana" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "BONK", name: "Bonk" },
  { symbol: "JTO", name: "Jito" },
  { symbol: "PYTH", name: "Pyth Network" },
];

// Add wallet to track
export async function addWallet(
  address: string,
  chain: 'ethereum' | 'solana',
  alias?: string,
  userId?: number
): Promise<{ id: number; address: string; chain: string }> {
  if (!userId) throw new Error("User ID required");
  // Dead feature — no real wallet tracking implemented
  return {
    id: 0,
    address,
    chain,
  };
}

// Sync wallet holdings from API or mock data
export async function syncWalletHoldings(walletId: number, chain: string): Promise<void> {
  // This would sync real holdings if Alchemy key exists
  // For now, just a placeholder that can be called
  if (ALCHEMY_API_KEY) {
    // Use real Alchemy API
    console.log(`Syncing wallet ${walletId} with Alchemy...`);
  } else {
    // Use mock data
    console.log(`Syncing wallet ${walletId} with mock data...`);
  }
}

// Check for new transactions
export async function checkTransactions(walletId: number): Promise<void> {
  // Check for new transactions since last sync
  console.log(`Checking transactions for wallet ${walletId}...`);
}

// Get recent whale activity (>$100K)
export async function getWhaleActivity(): Promise<any[]> {
  // Dead feature — no real whale tracking data source
  return [];
}

// Process alerts for a user
export async function processAlerts(userId: number): Promise<void> {
  // Check alerts and send notifications
  console.log(`Processing alerts for user ${userId}...`);
}

// Generate mock holdings — dead feature, returns empty
export function generateMockHoldings(_chain: string): any[] {
  return [];
}

// Generate mock transactions — dead feature, returns empty
export function generateMockTransactions(): any[] {
  return [];
}
