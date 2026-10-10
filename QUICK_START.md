# ⚡ Quick Start Guide - Get QuantEdge Running in 15 Minutes

## 🎯 Current Status

You have:
- ✅ Database connected (Neon PostgreSQL)
- ✅ Server running on port 3000
- ✅ Admin access with code `0065`
- ❌ No API keys configured (1/10 services working)

**Result:** Platform loads but trade validation, AI features, and price data won't work.

---

## 🚀 15-Minute Minimum Setup

### Step 1: Get Tradier API Key (5 minutes) - **FREE**

1. Visit: https://developer.tradier.com/
2. Click "Sign Up" (top right)
3. Choose "Sandbox Account" (FREE, no credit card)
4. Verify email
5. Go to: https://developer.tradier.com/user/settings
6. Copy your **Sandbox Access Token**
7. Update `.env`:
   ```bash
   TRADIER_API_KEY=paste_your_token_here
   TRADIER_USE_SANDBOX=true
   ```

**What this fixes:**
- ✅ Real-time stock prices
- ✅ Trade validation works
- ✅ Options data
- ✅ No more WebSocket errors

---

### Step 2: Get OpenAI API Key (5 minutes) - **$10 prepaid**

1. Visit: https://platform.openai.com/signup
2. Create account
3. Go to: https://platform.openai.com/api-keys
4. Click "Create new secret key"
5. Name it "QuantEdge"
6. Copy the key (starts with `sk-proj-` or `sk-`)
7. Go to: https://platform.openai.com/settings/organization/billing
8. Add $10 credit (will last 1-2 months with light usage)
9. Update `.env`:
   ```bash
   OPENAI_API_KEY=sk-proj-your_key_here
   ```

**What this fixes:**
- ✅ AI trade idea generation
- ✅ Chart analysis
- ✅ QuantAI chat assistant
- ✅ Automated analysis

---

### Step 3: Get Alpha Vantage Key (2 minutes) - **FREE**

1. Visit: https://www.alphavantage.co/support/#api-key
2. Enter your email
3. Copy the API key from email
4. Update `.env`:
   ```bash
   ALPHA_VANTAGE_API_KEY=your_key_here
   ```

**What this fixes:**
- ✅ Backup price data source
- ✅ Historical price charts
- ✅ Better reliability

---

### Step 4: Restart Server (1 minute)

```bash
# Kill current server
# Press Ctrl+C in terminal

# Restart with new keys
npm run dev
```

---

### Step 5: Test Everything (2 minutes)

```bash
# Run API test script
node test-api-keys.js
```

You should now see:
```
✅ Database (PostgreSQL)               Configured (Neon)
✅ Tradier (Stock/Options Data)        Working! SPY: $XXX (SANDBOX)
✅ OpenAI (AI Trade Analysis)          Working!
✅ Alpha Vantage (Historical Data)     Working!

📊 SUMMARY: 4/10 services configured (40%)
```

---

## 🎮 Using the Platform

### Login
1. Go to: http://localhost:3000
2. Enter admin code: **0065**
3. You'll land on Command Center v2

### Test Features

**1. View Command Center**
- Should see 6 analysis layer status cards
- Interactive performance chart
- Quick action buttons

**2. Generate AI Trade Ideas**
- Click "Find Trades" or go to `/trade-desk`
- Click "Generate Ideas"
- Should work if OpenAI key is valid

**3. Check Trade Validation**
- Validation service runs every 5 minutes
- Check terminal logs for:
  ```
  ✅ Validated X trades: Y winners, Z losers
  ```

**4. Check Real-Time Prices**
- Open any trade idea
- Should show current price (from Tradier)
- Price updates every few minutes

---

## 📊 What You Get With Minimum Setup

| Feature | Status | Notes |
|---------|--------|-------|
| Login/Auth | ✅ | Works with code 0065 |
| Command Center | ✅ | New interactive dashboard |
| Real-time prices | ✅ | Tradier sandbox data |
| Trade validation | ✅ | Auto-checks targets/stops |
| AI trade ideas | ✅ | OpenAI generates setups |
| Chart analysis | ✅ | AI analyzes charts |
| Historical data | ✅ | Alpha Vantage backup |
| Email notifications | ❌ | Need Resend API |
| Payments/subscriptions | ❌ | Need Stripe |
| Discord alerts | ❌ | Need webhooks |
| Google login | ❌ | Need OAuth setup |

---

## 💰 Cost Breakdown

**Minimum Setup:**
- Tradier Sandbox: **FREE**
- OpenAI (light usage): **$10 prepaid** (lasts 1-2 months)
- Alpha Vantage: **FREE**
- **Total: $10 one-time**

**Monthly costs after setup:**
- OpenAI (moderate usage): ~$5-15/month
- Everything else: FREE
- **Estimated: $10/month**

---

## 🎯 Success Checklist

After setup, you should be able to:

- [ ] Login with code 0065
- [ ] See Command Center with live data
- [ ] Generate AI trade ideas
- [ ] View real-time stock prices
- [ ] See trades auto-validate (wait 5 min)
- [ ] Use interactive charts
- [ ] View engine status cards

---

## 🐛 Troubleshooting

### "Trade validation failing"
- Check Tradier key is correct
- Verify you used **Sandbox Access Token** not Account ID
- Check logs for "401 Unauthorized"
- Solution: Re-copy token from https://developer.tradier.com/user/settings

### "AI not generating ideas"
- Check OpenAI key is valid
- Verify you added billing/credits
- Check for "insufficient quota" in logs
- Solution: Add $10 credit at https://platform.openai.com/settings/organization/billing

### "No price data showing"
- Check Tradier key is set
- Check Alpha Vantage key as backup
- Look for "HTTP 401" errors
- Solution: Get both keys configured

### "WebSocket errors in logs"
- These are from real-time price feeds
- Usually fixed by valid Tradier key
- Can ignore if prices still update

---

## 🚀 Next Steps After Minimum Setup

### For Testing/Development (Free/Cheap):
1. Keep using sandbox Tradier (FREE)
2. Monitor OpenAI usage (should be <$10/month)
3. Add Discord webhooks for alerts (FREE)
4. Test all features locally

### For Production (When Ready):
1. Upgrade to Tradier Live ($10/month for real-time data)
2. Add Resend for emails ($20/month or FREE for <100/day)
3. Add Stripe if selling subscriptions (2.9% + $0.30 per transaction)
4. Deploy to Render/Vercel/Railway ($0-7/month)
5. Get custom domain ($12/year)

### For Advanced Features:
1. Add Anthropic (Claude) for better AI reasoning
2. Add Google Gemini for multi-modal analysis
3. Add Google OAuth for social login
4. Add Notion integration for docs
5. Add Alchemy for crypto features

---

## 📚 Resources

- **Full Setup Guide:** [API_SETUP_GUIDE.md](./API_SETUP_GUIDE.md)
- **Test Script:** Run `node test-api-keys.js`
- **GitHub:** https://github.com/Maleek23/QuantEdgeResearch
- **Support:** abdulmalikajisegiri@gmail.com

---

## 🎉 You're Ready!

With just 3 API keys (Tradier, OpenAI, Alpha Vantage), you'll have:
- ✅ Working trade validation
- ✅ AI-powered trade ideas
- ✅ Real-time price data
- ✅ Interactive command center
- ✅ Full admin access

**Total setup time:** 15 minutes
**Total cost:** $10 (prepaid OpenAI credit)

Let's go! 🚀
