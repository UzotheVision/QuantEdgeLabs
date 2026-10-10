# QuantEdge TradingView bridge

`quantedge-index-closing-drive-v1.pine` is the late-session index playbook for
SPX, SPY, QQQ and IWM.

1. Add it to a 1-minute or 2-minute chart.
2. Set the QuantEdge webhook secret in the indicator settings.
3. Create one TradingView alert using **Any alert() function call** and point it
   at QuantEdge's `/api/webhooks/tradingview` URL.
4. Keep the chart on the actual underlying index/ETF, not an option contract.

The script builds the 3:20–3:35 PM ET decision range, allows completed-bar
entries from 3:35–3:50, draws trigger/invalidation/T1/T2, and emits a mandatory
3:57 exit event. QuantEdge—not Pine—selects the live contract and enforces the
configured debit/risk budget. Alerts are hypotheses until live-chain liquidity
and account-fit checks pass. T1/T2 alerts describe the underlying crossing its
level; Cockpit only records an option win after replaying the selected contract's
actual trade marks.
