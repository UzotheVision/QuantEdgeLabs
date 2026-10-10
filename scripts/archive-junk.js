require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const APPROVED = new Set([
  "AAOI","CRCL","OKLO","LUNR","KLAC","SMTC","AEHR","OLED","RMBS","BILL","INTA","MKSI",
  "LRCX","AFRM","WDC","MU","AMD","TSEM","COIN","ARM","HIMS","ONTO","ENTG","UPST",
  "DUOL","PATH","MDB","AMBA","COHU","SNOW","NET","FRSH","ESTC","ACLS","ASAN",
  "SOFI","DDOG","DELL","SHOP","DKNG","MARA","LITE","FN","CIEN","AXTI","BROS",
  "NBIS","TSLA","AVGO","NFLX","COHR","ALGM",
  "SPY","QQQ","IWM","XSP","DIA",
  "BTC","ETH","SOL","DOGE",
  "CLSK","RKLB","ASTS","PLTR","SMCI"
]);

(async () => {
  const result = await pool.query("SELECT id, symbol FROM trade_ideas WHERE DATE(timestamp) >= CURRENT_DATE - 1");
  let archived = 0;
  for (const row of result.rows) {
    if (!APPROVED.has(row.symbol)) {
      await pool.query("UPDATE trade_ideas SET archived = true WHERE id = $1", [row.id]);
      archived++;
      console.log("Archived:", row.symbol);
    }
  }
  console.log("\nArchived", archived, "non-watchlist ideas");
  const remaining = await pool.query("SELECT count(*) FROM trade_ideas WHERE (archived IS NULL OR archived = false) AND DATE(timestamp) >= CURRENT_DATE - 1");
  console.log("Visible ideas:", remaining.rows[0].count);
  await pool.end();
})().catch(e => console.error(e.message));
