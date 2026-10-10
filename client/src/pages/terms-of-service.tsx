import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, AlertTriangle, Shield, Scale } from "lucide-react";

export default function TermsOfService() {
  return (
    <div className="container mx-auto p-6 space-y-6 max-w-4xl">
      <div className="relative overflow-hidden rounded-xl mb-8">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(100,116,139,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(100,116,139,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />
        <div className="relative py-8 px-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            Legal
          </p>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold">Terms of Service</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Last updated: October 21, 2025
              </p>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-500/30 to-transparent" />
      </div>

      <Card className="glass-card border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-[var(--trade-neutral)]">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center shadow-lg">
              <AlertTriangle className="h-5 w-5 text-white" />
            </div>
            Educational Research Platform Only
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="font-semibold text-foreground">
            Quant Edge Labs is an EDUCATIONAL and RESEARCH platform. It is NOT financial advice.
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>All research briefs are for educational purposes and research demonstration only</li>
            <li>We are not licensed financial advisors, brokers, or investment professionals</li>
            <li>Past performance does not guarantee future results</li>
            <li>Trading involves substantial risk of loss and is not suitable for everyone</li>
            <li>You are solely responsible for your own trading decisions</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="glass-card hover-elevate">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg">
              <Scale className="h-5 w-5 text-white" />
            </div>
            Acceptance of Terms
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            By accessing or using Quant Edge Labs, you agree to be bound by these Terms of Service 
            and our Privacy Policy. If you do not agree to these terms, do not use this platform.
          </p>
          <p>
            We reserve the right to modify these terms at any time. Continued use of the platform 
            after changes constitutes acceptance of the modified terms.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card hover-elevate">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Section</p>
          </CardTitle>
          <CardTitle>Platform Services</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>Quant Edge Labs provides:</p>
          <ul className="list-disc list-inside space-y-2">
            <li>Quantitative analysis and technical indicator signals</li>
            <li>AI-powered research brief generation (educational demonstration)</li>
            <li>Market data aggregation from public sources</li>
            <li>Performance tracking and analytics tools</li>
            <li>Risk calculation and position sizing tools</li>
            <li>Educational resources about trading strategies</li>
          </ul>
          <p className="font-semibold text-foreground mt-4">
            These services are provided "AS IS" without warranties of any kind.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card hover-elevate">
        <CardHeader>
          <CardTitle>User Responsibilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>You agree to:</p>
          <ul className="list-disc list-inside space-y-2">
            <li>Provide accurate information when creating an account</li>
            <li>Keep your account credentials secure and confidential</li>
            <li>Use the platform only for lawful purposes</li>
            <li>Not attempt to circumvent security measures or access unauthorized data</li>
            <li>Not use automated tools to scrape or harvest data from the platform</li>
            <li>Not redistribute or resell our research briefs or analysis</li>
            <li>Conduct your own due diligence before making any trading decisions</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="glass-card hover-elevate">
        <CardHeader>
          <CardTitle>Disclaimer of Warranties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">
            WE MAKE NO GUARANTEES ABOUT:
          </p>
          <ul className="list-disc list-inside space-y-2">
            <li>Accuracy of market data, prices, or analysis</li>
            <li>Profitability of any research patterns or strategies</li>
            <li>Availability or uptime of the platform</li>
            <li>Compatibility with your specific use case</li>
            <li>Freedom from errors, bugs, or security vulnerabilities</li>
          </ul>
          <p className="text-xs mt-4">
            Market data may be delayed or inaccurate. Always verify prices with your broker 
            before executing trades.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card hover-elevate">
        <CardHeader>
          <CardTitle>Limitation of Liability</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW:
          </p>
          <ul className="list-disc list-inside space-y-2">
            <li>We are not liable for any trading losses you incur</li>
            <li>We are not liable for data loss, service interruptions, or technical failures</li>
            <li>We are not liable for indirect, consequential, or punitive damages</li>
            <li>Our total liability shall not exceed the amount you paid for premium services (if any)</li>
          </ul>
          <div className="flex items-center gap-2 text-[var(--trade-neutral)] text-xs mt-4">
            <AlertTriangle className="h-4 w-4" />
            <span>You assume all risk when using this platform for trading research.</span>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card hover-elevate">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg">
              <Shield className="h-5 w-5 text-white" />
            </div>
            Intellectual Property
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            The Quant Edge Labs platform UI, design, and educational content are the intellectual property 
            of Quant Edge Labs. Our quantitative algorithms and signal weights are proprietary.
          </p>
          <p>
            You may not copy, reproduce, or redistribute our proprietary code or algorithms without 
            explicit written permission.
          </p>
          <p className="text-xs mt-4">
            We may open-source certain UI components and educational materials, which will be 
            clearly marked with appropriate licenses.
          </p>
        </CardContent>
      </Card>

      <Card className="glass-card hover-elevate">
        <CardHeader>
          <CardTitle>Termination</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            We reserve the right to suspend or terminate your access to the platform at any time, 
            with or without notice, for:
          </p>
          <ul className="list-disc list-inside space-y-2">
            <li>Violation of these Terms of Service</li>
            <li>Fraudulent, abusive, or illegal activity</li>
            <li>Security threats or attempted unauthorized access</li>
            <li>Any reason at our sole discretion</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="glass-card border-muted-foreground/20">
        <CardContent className="pt-6 space-y-2 text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Contact & Governing Law
          </p>
          <p className="text-muted-foreground">
            These terms are governed by applicable laws. For questions or concerns, 
            contact us through our Discord community or support channels.
          </p>
          <p className="text-xs text-muted-foreground mt-4">
            By using Quant Edge Labs, you acknowledge that you have read, understood, 
            and agree to be bound by these Terms of Service.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
