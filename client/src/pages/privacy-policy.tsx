import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Eye, Database, Lock, Mail, Scale } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="container mx-auto p-6 space-y-6 max-w-4xl">
      {/* Page Header */}
      <div className="relative overflow-visible rounded-xl mb-8">
        <div className="relative py-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Legal
          </p>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold">Privacy Policy</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Last updated: October 21, 2025
              </p>
            </div>
          </div>
        </div>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center">
              <Eye className="h-5 w-5 text-white" />
            </div>
            Information We Collect
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div>
            <p className="font-semibold text-foreground mb-2">Usage Data</p>
            <p>
              We collect information about how you interact with our platform, including pages visited, 
              features used, and technical data such as browser type, IP address, and device information.
            </p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-2">Account Information</p>
            <p>
              If you create an account or connect via Discord OAuth (future feature), we collect your 
              Discord username and user ID. We do not store your Discord password.
            </p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-2">Research Briefs and Watchlists</p>
            <p>
              Any research briefs you create, watchlist items you add, or settings you configure are stored 
              in our database to provide our services to you.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center">
              <Database className="h-5 w-5 text-white" />
            </div>
            How We Use Your Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <ul className="list-disc list-inside space-y-2">
            <li>Provide and improve our quantitative trading research platform</li>
            <li>Personalize your experience with saved settings and preferences</li>
            <li>Generate market analysis and research briefs based on your watchlist</li>
            <li>Track performance metrics and improve our algorithms</li>
            <li>Send important service updates and security notifications</li>
            <li>Comply with legal obligations and prevent fraud</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center">
              <Lock className="h-5 w-5 text-white" />
            </div>
            Data Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            We implement industry-standard security measures to protect your data, including:
          </p>
          <ul className="list-disc list-inside space-y-2">
            <li>Encrypted database connections (PostgreSQL with SSL)</li>
            <li>Secure session management with HTTP-only cookies</li>
            <li>Rate limiting to prevent abuse and unauthorized access</li>
            <li>Regular security audits and updates</li>
            <li>API key encryption for external service integrations</li>
          </ul>
          <p className="text-[var(--trade-neutral)] text-xs mt-4">
            No security system is impenetrable. While we strive to protect your data, 
            we cannot guarantee absolute security.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center">
              <Mail className="h-5 w-5 text-white" />
            </div>
            Third-Party Services
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>We use the following third-party services to provide our platform:</p>
          <ul className="list-disc list-inside space-y-2">
            <li><strong>CoinGecko API</strong> - Cryptocurrency market data</li>
            <li><strong>Yahoo Finance</strong> - Stock market data and screening</li>
            <li><strong>Alpha Vantage</strong> - Historical stock data and earnings calendar</li>
            <li><strong>Tradier</strong> - Options data and pricing</li>
            <li><strong>OpenAI / Anthropic / Google Gemini</strong> - AI-powered research brief generation</li>
            <li><strong>Neon Database</strong> - PostgreSQL database hosting</li>
          </ul>
          <p className="text-xs mt-4">
            These services have their own privacy policies. We do not control their data practices.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center">
              <Scale className="h-5 w-5 text-white" />
            </div>
            Your Rights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>You have the right to:</p>
          <ul className="list-disc list-inside space-y-2">
            <li>Access your personal data stored in our system</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your account and associated data</li>
            <li>Opt out of non-essential data collection</li>
            <li>Export your research briefs and watchlist data</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="glass-card overflow-visible hover-elevate border-border/50">
        <CardContent className="pt-6 space-y-2 text-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center">
              <Mail className="h-5 w-5 text-white" />
            </div>
            <p className="font-semibold text-lg">Contact Us</p>
          </div>
          <p className="text-muted-foreground">
            If you have questions about this Privacy Policy or how we handle your data, 
            please contact us through our Discord community or support channels.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
