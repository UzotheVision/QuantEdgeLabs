# 🔑 Complete API & Service Setup Guide for QuantEdge

## 📋 Overview

This guide will help you set up ALL the external services and API keys needed for QuantEdge to work properly.

**Current Status:** Most APIs are using placeholder values. This is why:
- ❌ Trade validation is failing (WebSocket errors)
- ❌ No price data for stocks/crypto/options
- ❌ AI features not working
- ❌ Email/notifications not working

---

## 🎯 Priority Setup (Critical for Core Functionality)

### 1. **Tradier API** (Stock/Options Data) - **HIGH PRIORITY**
**Cost:** FREE sandbox, $10/month live
**Why:** Without this, trade validation doesn't work, no real-time prices

**Steps:**
1. Go to: https://tradier.com/products/market-data
2. Click "Get Started" → Create account
3. Go to Dashboard → API Access
4. Copy your API key
5. Update `.env`:
   ```bash
   TRADIER_API_KEY=your_actual_tradier_key_here
   TRADIER_USE_SANDBOX=true  # Set to false for live data
   ```

**Sandbox vs Live:**
- Sandbox: FREE, delayed data, good for testing
- Live: $10/month, real-time data, production use

---

### 2. **OpenAI API** (AI Trade Analysis) - **HIGH PRIORITY**
**Cost:** Pay-as-you-go (~$5-20/month depending on usage)
**Why:** Powers the AI-generated trade ideas, chart analysis, and QuantAI chat

**Steps:**
1. Go to: https://platform.openai.com/api-keys
2. Create account / Sign in
3. Click "Create new secret key"
4. Name it "QuantEdge Production"
5. Copy the key (starts with `sk-...`)
6. Update `.env`:
   ```bash
   OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxx
   ```

**Cost Control:**
- Set usage limits in OpenAI dashboard
- Recommended: $20/month limit to start
- Monitor usage at: https://platform.openai.com/usage

---

### 3. **Alpha Vantage** (Stock Historical Data) - **MEDIUM PRIORITY**
**Cost:** FREE (500 calls/day), $50/month (unlimited)
**Why:** Used for fetching historical stock prices when Tradier fails

**Steps:**
1. Go to: https://www.alphavantage.co/support/#api-key
2. Enter your email → Get free API key
3. Update `.env`:
   ```bash
   ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
   ```

---

## 💰 Payment Processing (If offering subscriptions)

### 4. **Stripe** (Payments) - **OPTIONAL**
**Cost:** FREE, 2.9% + $0.30 per transaction
**Why:** Handle subscriptions (Advanced $39/mo, Pro $79/mo)

**Steps:**
1. Go to: https://dashboard.stripe.com/register
2. Complete verification
3. Go to Developers → API Keys
4. Copy "Secret key" (starts with `sk_live_` or `sk_test_`)
5. Create products:
   - Product 1: "Advanced Plan" → $39/month → Copy price_id
   - Product 2: "Pro Plan" → $79/month → Copy price_id
6. Update `.env`:
   ```bash
   STRIPE_SECRET_KEY=sk_test_xxxxx
   STRIPE_ADVANCED_MONTHLY_PRICE_ID=price_xxxxx
   STRIPE_PRO_MONTHLY_PRICE_ID=price_xxxxx
   STRIPE_WEBHOOK_SECRET=whsec_xxxxx  # From webhooks section
   ```

**Testing:**
- Use `sk_test_` keys for development
- Use test cards: 4242 4242 4242 4242
- Switch to `sk_live_` when ready for real payments

---

## 🤖 Additional AI Services (Optional but Recommended)

### 5. **Anthropic (Claude)** - **OPTIONAL**
**Cost:** Pay-as-you-go
**Why:** Alternative AI for better reasoning, used as fallback

**Steps:**
1. Go to: https://console.anthropic.com/
2. Create account → API Keys
3. Create key
4. Update `.env`:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-xxxxx
   ```

### 6. **Google Gemini** - **OPTIONAL**
**Cost:** FREE tier available
**Why:** Used for multi-modal analysis (charts + text)

**Steps:**
1. Go to: https://makersuite.google.com/app/apikey
2. Create API key
3. Update `.env`:
   ```bash
   GEMINI_API_KEY=AIzaSyxxxxx
   ```

### 7. **Grok (xAI)** - **OPTIONAL**
**Cost:** Varies
**Why:** Alternative AI model

**Steps:**
1. Go to: https://x.ai/api (when available)
2. Update `.env`:
   ```bash
   GROK_API_KEY=your_grok_key
   ```

---

## 📧 Email & Notifications

### 8. **Resend** (Email Service) - **RECOMMENDED**
**Cost:** FREE (100 emails/day), $20/month (unlimited)
**Why:** Send beta invites, welcome emails, password resets

**Steps:**
1. Go to: https://resend.com/
2. Create account
3. API Keys → Create
4. Add sending domain (optional, or use onboarding@resend.dev)
5. Update `.env`:
   ```bash
   RESEND_API_KEY=re_xxxxx
   FROM_EMAIL=noreply@yourdomain.com
   ```

### 9. **Discord Webhooks** (Trading Alerts) - **OPTIONAL**
**Cost:** FREE
**Why:** Get real-time trade alerts in Discord

**Steps:**
1. Open Discord → Server Settings → Integrations → Webhooks
2. Create webhook for each channel:
   - #trade-alerts
   - #quant-signals
   - #options-flow
   - #futures-trades
3. Copy webhook URLs
4. Update `.env`:
   ```bash
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxx
   DISCORD_WEBHOOK_QUANTBOT=https://discord.com/api/webhooks/xxxxx
   DISCORD_WEBHOOK_LOTTO=https://discord.com/api/webhooks/xxxxx
   DISCORD_WEBHOOK_FUTURE_TRADES=https://discord.com/api/webhooks/xxxxx
   ```

---

## 🔐 Authentication

### 10. **Google OAuth** (Social Login) - **OPTIONAL**
**Cost:** FREE
**Why:** Allow users to sign in with Google

**Steps:**
1. Go to: https://console.cloud.google.com/
2. Create new project "QuantEdge"
3. APIs & Services → OAuth consent screen → External
4. Credentials → Create OAuth 2.0 Client ID
5. Authorized redirect URIs:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://yourdomain.com/api/auth/google/callback`
6. Update `.env`:
   ```bash
   GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
   APP_URL=http://localhost:3000  # Change to your domain in production
   ```

---

## 🌐 Crypto & Blockchain (If using crypto features)

### 11. **Alchemy** (Ethereum/Crypto) - **OPTIONAL**
**Cost:** FREE tier (300M compute units/month)
**Why:** Track crypto wallets, get blockchain data

**Steps:**
1. Go to: https://www.alchemy.com/
2. Create account → Create App
3. Network: Ethereum Mainnet
4. Copy API key
5. Update `.env`:
   ```bash
   ALCHEMY_API_KEY=your_alchemy_key
   ```

### 12. **DataBento** (Market Data) - **OPTIONAL**
**Cost:** Variable
**Why:** Professional-grade market data for advanced users

**Steps:**
1. Go to: https://databento.com/
2. Create account
3. Get API key
4. Update `.env`:
   ```bash
   DATABENTO_API_KEY=your_databento_key
   ```

---

## 📊 Notion Integration (Documentation Sync)

### 13. **Notion API** - **OPTIONAL**
**Cost:** FREE
**Why:** Sync documentation to Notion automatically

**Steps:**
1. Go to: https://www.notion.so/my-integrations
2. Create new integration "QuantEdge Sync"
3. Copy Internal Integration Token
4. Share target database with integration
5. Copy database ID from URL
6. Update `.env`:
   ```bash
   NOTION_API_KEY=secret_xxxxx
   NOTION_DATABASE_ID=xxxxx
   ```

---

## 🚀 Deployment Setup

### 14. **Domain & Hosting**

**Option A: Render.com** (Recommended for beginners)
**Cost:** FREE tier, $7/month for production
1. Go to: https://render.com/
2. New → Web Service
3. Connect GitHub repo
4. Build command: `npm install && npm run build`
5. Start command: `npm start`
6. Add all environment variables from `.env`

**Option B: Vercel**
**Cost:** FREE tier, $20/month for production
1. Go to: https://vercel.com/
2. Import project from GitHub
3. Framework: Vite
4. Add environment variables

**Option C: Railway**
**Cost:** $5/month credit, then pay-as-you-go
1. Go to: https://railway.app/
2. New Project → Deploy from GitHub
3. Add environment variables

---

## ✅ Quick Setup Checklist

### Minimum Viable Setup (Free):
- [ ] Tradier (FREE sandbox account)
- [ ] OpenAI ($5-10 prepaid credit)
- [ ] Alpha Vantage (FREE key)
- [ ] Database already configured ✅

### Recommended Setup (Production):
- [ ] All Minimum Viable items
- [ ] Tradier (Live data $10/month)
- [ ] Resend (Email service)
- [ ] Stripe (If selling subscriptions)
- [ ] Discord webhooks (FREE alerts)

### Advanced Setup (Full Features):
- [ ] All Recommended items
- [ ] Anthropic API (Claude)
- [ ] Google Gemini
- [ ] Google OAuth
- [ ] Alchemy (Crypto)
- [ ] Notion integration

---

## 🔧 Testing Your Setup

After adding API keys, test each service:

```bash
# 1. Restart server to load new .env
npm run dev

# 2. Check logs for successful connections
# Look for:
# ✅ Tradier connected
# ✅ OpenAI initialized
# ✅ Database connected

# 3. Test trade validation
# Go to http://localhost:3000/command-center-v2
# Check if trades update with real prices

# 4. Test AI features
# Go to Trade Desk → Generate Ideas
# Should work if OpenAI key is valid
```

---

## 💡 Cost Estimate

### Minimal Setup (Testing):
- Tradier Sandbox: **FREE**
- OpenAI (light usage): **$5-10/month**
- Alpha Vantage: **FREE**
- **Total: ~$10/month**

### Production Setup:
- Tradier Live: **$10/month**
- OpenAI (moderate usage): **$20/month**
- Resend (emails): **$20/month**
- Render hosting: **$7/month**
- **Total: ~$60/month**

### With Subscriptions:
- All Production costs
- Stripe: **2.9% per transaction**
- If you get 10 customers × $39/mo = $390/mo revenue
- Stripe fees: ~$11/mo
- Net: $390 - $60 - $11 = **$319/mo profit**

---

## 🆘 Troubleshooting

### Trade validation not working:
1. Check TRADIER_API_KEY is valid
2. Check logs for "401 Unauthorized"
3. Try sandbox key first
4. Verify ALPHA_VANTAGE_API_KEY as backup

### AI not generating trades:
1. Check OPENAI_API_KEY is valid
2. Check OpenAI usage limits
3. Look for "insufficient quota" errors
4. Add billing info to OpenAI account

### WebSocket errors:
1. These are from real-time price feeds
2. Usually fixed by valid Tradier key
3. Check firewall isn't blocking WebSocket connections

### Can't login with Google:
1. Check GOOGLE_CLIENT_ID is correct
2. Verify redirect URIs match exactly
3. Check APP_URL is set correctly

---

## 📞 Support

Need help?
- GitHub Issues: https://github.com/Maleek23/QuantEdgeResearch/issues
- Email: abdulmalikajisegiri@gmail.com

---

## 🔐 Security Notes

**CRITICAL:**
- ✅ Never commit `.env` file to Git (already in .gitignore)
- ✅ Use environment variables on hosting platforms
- ✅ Rotate API keys if exposed
- ✅ Use `_test_` or `_sandbox_` keys for development
- ✅ Enable 2FA on all service accounts

**API Key Storage:**
- Development: `.env` file (local only)
- Production: Hosting platform environment variables
- Never hardcode keys in source code

---

## 🎯 Next Steps

1. **Start with Minimum Viable Setup**
   - Get Tradier sandbox key (5 min)
   - Add OpenAI key with $10 credit (10 min)
   - Get Alpha Vantage free key (2 min)
   - Restart server and test

2. **Verify Everything Works**
   - Login with code 0065
   - Check Command Center loads
   - Generate a test trade idea
   - Verify prices update

3. **Gradually Add More Services**
   - Add email when you need beta invites
   - Add Stripe when ready to accept payments
   - Add Discord for trading alerts

4. **Deploy to Production**
   - Choose hosting platform
   - Add production domain
   - Configure environment variables
   - Enable live API keys

---

**Last Updated:** January 13, 2026
**Maintained by:** Abdulmalik Ajisegiri
