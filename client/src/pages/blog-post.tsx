import { useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  ArrowLeft, Calendar, Clock, User, Search, BarChart3, Target, 
  DollarSign, CheckCircle2, AlertTriangle, Lightbulb, TrendingUp,
  TrendingDown, Zap, Shield, BookOpen, ArrowRight, Sparkles
} from "lucide-react";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SEOHead } from "@/components/seo-head";
import { useState } from "react";
import type { BlogPost } from "@shared/schema";

const CATEGORY_VISUALS: Record<string, { gradient: string; icon: any; pattern: string }> = {
  'education': { 
    gradient: 'from-blue-600 via-sky-500 to-teal-400', 
    icon: BookOpen,
    pattern: 'radial-gradient(circle at 20% 80%, rgba(59, 130, 246, 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(20, 184, 166, 0.3) 0%, transparent 50%)'
  },
  'strategy': { 
    gradient: 'from-purple-600 via-violet-500 to-pink-400', 
    icon: Target,
    pattern: 'radial-gradient(circle at 30% 70%, rgba(147, 51, 234, 0.3) 0%, transparent 50%), radial-gradient(circle at 70% 30%, rgba(236, 72, 153, 0.3) 0%, transparent 50%)'
  },
  'risk-management': { 
    gradient: 'from-emerald-600 via-green-500 to-lime-400', 
    icon: Shield,
    pattern: 'radial-gradient(circle at 25% 75%, rgba(16, 185, 129, 0.3) 0%, transparent 50%), radial-gradient(circle at 75% 25%, rgba(163, 230, 53, 0.3) 0%, transparent 50%)'
  },
  'market-commentary': { 
    gradient: 'from-orange-600 via-amber-500 to-yellow-400', 
    icon: BarChart3,
    pattern: 'radial-gradient(circle at 20% 80%, rgba(234, 88, 12, 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(250, 204, 21, 0.3) 0%, transparent 50%)'
  },
  'news': { 
    gradient: 'from-red-600 via-rose-500 to-pink-400', 
    icon: Zap,
    pattern: 'radial-gradient(circle at 30% 70%, rgba(220, 38, 38, 0.3) 0%, transparent 50%), radial-gradient(circle at 70% 30%, rgba(244, 114, 182, 0.3) 0%, transparent 50%)'
  },
  'platform-updates': { 
    gradient: 'from-sky-600 via-blue-500 to-indigo-400', 
    icon: Lightbulb,
    pattern: 'radial-gradient(circle at 25% 75%, rgba(8, 145, 178, 0.3) 0%, transparent 50%), radial-gradient(circle at 75% 25%, rgba(99, 102, 241, 0.3) 0%, transparent 50%)'
  },
};

function getVisualForCategory(category: string) {
  return CATEGORY_VISUALS[category] || CATEGORY_VISUALS['education'];
}

function TradingGuideContent() {
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const toggleCheck = (key: string) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const checklistItems = [
    { key: 'grade', label: 'Signal grade is A or B?' },
    { key: 'timeframe', label: 'Chart timeframe matches expiry?' },
    { key: 'trend', label: 'Trend on higher timeframe confirms?' },
    { key: 'rr', label: 'R:R is at least 2:1?' },
    { key: 'stop', label: 'Stop loss is set before entry?' },
    { key: 'size', label: 'Position size is max 2% of account?' },
    { key: 'dte', label: 'At least 3+ days to expiration?' },
    { key: 'events', label: 'No major earnings/events during hold?' },
  ];

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-lg glass-card p-8 md:p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/20 via-primary/10 to-purple-500/20" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />
        <div className="relative">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
            Complete Trading Guide
          </p>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
              <BookOpen className="h-6 w-6 text-foreground" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold">
              How to Trade Like a Pro
            </h1>
          </div>
          <p className="text-base text-muted-foreground max-w-2xl leading-relaxed">
            A complete step-by-step guide to analyzing charts, picking the right options, and executing trades with confidence.
          </p>
        </div>
        
        {/* Step Progress */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { num: 1, label: 'Find Ideas', icon: Search },
            { num: 2, label: 'Analyze Chart', icon: BarChart3 },
            { num: 3, label: 'Pick Strike/Expiry', icon: Target },
            { num: 4, label: 'Execute Trade', icon: DollarSign },
          ].map((step) => (
            <div key={step.num} className="flex items-center gap-3 stat-glass rounded-lg p-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-foreground font-bold font-mono tabular-nums">
                {step.num}
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Step {step.num}</div>
                <div className="font-medium text-sm">{step.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Find Trade Ideas */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center text-foreground font-bold font-mono text-xl">
            1
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Step 1</p>
            <h2 className="text-xl font-semibold">Find Trade Ideas</h2>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {[
            { title: 'Trade Desk', desc: 'Fresh AI + Quant research briefs generated daily at market open', icon: Sparkles, color: 'from-sky-500 to-blue-600' },
            { title: 'Flow Scanner', desc: 'Unusual options activity from institutional traders', icon: Zap, color: 'from-purple-500 to-pink-600' },
            { title: 'Lotto Ideas', desc: 'High R:R weekly options with 2:1+ risk/reward', icon: Target, color: 'from-orange-500 to-red-600' },
            { title: 'Chart Analysis', desc: 'Upload your own chart for AI-powered analysis', icon: BarChart3, color: 'from-green-500 to-emerald-600' },
          ].map((item) => (
            <Card key={item.title} className="glass-card hover-elevate overflow-visible rounded-lg">
              <CardContent className="p-0">
                <div className="flex items-start gap-4 p-4">
                  <div className={`h-12 w-12 rounded-lg bg-gradient-to-br ${item.color} flex items-center justify-center shrink-0`}>
                    <item.icon className="h-6 w-6 text-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Signal Grades */}
        <Card className="glass-card border-sky-500/20 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Understanding</p>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-foreground" />
              </div>
              Signal Grades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              Signal grades show how many technical indicators agree on the trade direction:
            </p>
            <div className="space-y-2">
              {[
                { grade: 'A+', signals: '5 signals', meaning: 'Strong consensus - highest probability', color: 'bg-[var(--trade-bullish)]' },
                { grade: 'A', signals: '4 signals', meaning: 'Good consensus - reliable setup', color: 'bg-[var(--trade-bullish)]' },
                { grade: 'B', signals: '3 signals', meaning: 'Moderate - proceed with caution', color: 'bg-yellow-500' },
                { grade: 'C', signals: '2 signals', meaning: 'Weak - consider skipping', color: 'bg-orange-500' },
                { grade: 'D', signals: '1 signal', meaning: 'Conflicting signals - avoid', color: 'bg-[var(--trade-bearish)]' },
              ].map((item) => (
                <div key={item.grade} className="flex items-center gap-4 p-3 rounded-lg stat-glass">
                  <Badge className={`${item.color} text-foreground font-bold font-mono min-w-[40px] justify-center`}>
                    {item.grade}
                  </Badge>
                  <span className="text-sm font-medium font-mono w-24">{item.signals}</span>
                  <span className="text-sm text-muted-foreground">{item.meaning}</span>
                </div>
              ))}
            </div>
            
            <div className="mt-6 p-4 rounded-lg bg-sky-500/10 border border-sky-500/20">
              <div className="flex items-start gap-3">
                <Lightbulb className="h-5 w-5 text-sky-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-sky-400">Pro Tip:</span>
                  <span className="text-muted-foreground ml-2">
                    Focus on A and B grade setups with clear risk/reward. Skip C and D grades unless you have additional confirmation.
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Step 2: Analyze the Chart */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-foreground font-bold font-mono text-xl">
            2
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Step 2</p>
            <h2 className="text-xl font-semibold">Analyze the Chart</h2>
          </div>
        </div>

        <Card className="glass-card mb-6 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Timeframe Guide</p>
            <CardTitle>Which Timeframe for Which Expiry?</CardTitle>
            <p className="text-muted-foreground">This is the most important concept. Your chart timeframe should match your trade duration:</p>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                { timeframe: '5-15 Minute', best: 'Same-day (0DTE)', use: 'Quick momentum plays that resolve in hours', color: 'from-red-500 to-orange-500' },
                { timeframe: '1 Hour', best: '1-3 day swings', use: 'Catching overnight moves or 2-day momentum', color: 'from-orange-500 to-amber-500' },
                { timeframe: '4 Hour', best: 'Weekly options (5-7 days)', use: 'Best for Friday expirations bought Mon-Wed', color: 'from-green-500 to-emerald-500' },
                { timeframe: 'Daily', best: '2-4 week swings', use: 'Monthly options or longer-dated plays', color: 'from-blue-500 to-sky-500' },
              ].map((item) => (
                <div key={item.timeframe} className="p-4 rounded-lg stat-glass relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${item.color}`} />
                  <div className="pl-3">
                    <div className="font-bold text-lg font-mono">{item.timeframe}</div>
                    <div className="text-sm text-sky-400 font-medium">{item.best}</div>
                    <div className="text-sm text-muted-foreground mt-1">{item.use}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Weekly Options Guide */}
        <Card className="glass-card mb-6 border-purple-500/20 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Weekly Options</p>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-foreground" />
              </div>
              For Weekly Options (Expiring Friday)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              {[
                { label: 'Primary', chart: '4-Hour Chart', desc: 'Shows the weekly trend and key support/resistance levels', color: 'from-purple-500 to-violet-600' },
                { label: 'Entry', chart: '1-Hour Chart', desc: 'Fine-tune your entry point within the larger trend', color: 'from-pink-500 to-rose-600' },
                { label: 'Confirmation', chart: 'Daily Chart', desc: "Make sure you're trading WITH the larger trend", color: 'from-blue-500 to-sky-600' },
              ].map((item) => (
                <div key={item.label} className="text-center p-4 rounded-lg stat-glass">
                  <Badge className={`bg-gradient-to-r ${item.color} text-foreground mb-3 border-0`}>{item.label}</Badge>
                  <div className="font-bold mb-2 font-mono">{item.chart}</div>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Bullish/Bearish Signs */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="glass-card border-green-500/20 rounded-lg">
            <CardHeader className="pb-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Bullish</p>
              <CardTitle className="flex items-center gap-2 text-[var(--trade-bullish)]">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-foreground" />
                </div>
                Bullish Signs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {[
                  'Price above key moving averages',
                  'Higher highs and higher lows',
                  'Bouncing off support levels',
                  'RSI below 30 (oversold bounce)',
                  'Volume increasing on up moves',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-[var(--trade-bullish)] shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="glass-card border-red-500/20 rounded-lg">
            <CardHeader className="pb-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Bearish</p>
              <CardTitle className="flex items-center gap-2 text-[var(--trade-bearish)]">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
                  <TrendingDown className="h-4 w-4 text-foreground" />
                </div>
                Bearish Signs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {[
                  'Price below key moving averages',
                  'Lower highs and lower lows',
                  'Rejecting at resistance levels',
                  'RSI above 70 (overbought fade)',
                  'Volume increasing on down moves',
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-[var(--trade-bearish)] shrink-0" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Step 3: Pick Strike & Expiry */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-foreground font-bold font-mono text-xl">
            3
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Step 3</p>
            <h2 className="text-xl font-semibold">Pick Your Strike & Expiry</h2>
          </div>
        </div>

        {/* Strike Selection */}
        <Card className="glass-card mb-6 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Strike Selection</p>
            <CardTitle>Strike Price Selection</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4">
              {[
                { type: 'ITM', name: 'In-The-Money', delta: 'Delta 0.60-0.80', desc: 'Higher cost, higher probability. Best for directional conviction plays.', color: 'from-green-500 to-emerald-600' },
                { type: 'ATM', name: 'At-The-Money', delta: 'Delta ~0.50', desc: 'Balanced risk/reward. Good for uncertain direction but expecting a move.', color: 'from-yellow-500 to-orange-500' },
                { type: 'OTM', name: 'Out-of-The-Money', delta: 'Delta 0.20-0.40', desc: 'Cheaper, higher reward but lower probability. Use for lotto plays only.', color: 'from-red-500 to-pink-600' },
              ].map((item) => (
                <div key={item.type} className="relative overflow-hidden rounded-lg glass-card">
                  <div className={`h-2 bg-gradient-to-r ${item.color}`} />
                  <div className="p-4">
                    <Badge variant="outline" className="mb-2 font-mono">{item.type}</Badge>
                    <h4 className="font-bold mb-1">{item.name}</h4>
                    <div className="text-xs text-sky-400 mb-2 font-mono">{item.delta}</div>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Expiration Rules */}
        <Card className="glass-card mb-6 border-orange-500/20 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Expiration</p>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center">
                <Clock className="h-4 w-4 text-foreground" />
              </div>
              Expiration Selection Rules
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { icon: Clock, text: 'Give yourself 2x the time you think you need' },
                { icon: Calendar, text: 'Weekly plays: Buy Monday-Wednesday for Friday expiry' },
                { icon: AlertTriangle, text: 'Avoid buying options expiring in less than 3 days' },
                { icon: TrendingDown, text: 'Theta decay accelerates rapidly in final 5 days' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg stat-glass">
                  <item.icon className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-muted-foreground">{item.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* R:R Guide */}
        <Card className="glass-card rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Risk Management</p>
            <CardTitle>Risk/Reward Quick Guide</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {[
                { rr: '2:1', label: 'Minimum R:R', desc: 'Risk $1 to make $2', color: 'text-yellow-500' },
                { rr: '3:1', label: 'Good R:R', desc: 'Risk $1 to make $3', color: 'text-[var(--trade-bullish)]' },
                { rr: '5:1+', label: 'Lotto R:R', desc: 'Risk $1 to make $5+', color: 'text-sky-500' },
              ].map((item) => (
                <div key={item.rr} className="text-center p-4 rounded-lg stat-glass">
                  <div className={`text-3xl font-bold font-mono ${item.color}`}>{item.rr}</div>
                  <div className="font-medium text-sm mt-1">{item.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{item.desc}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Step 4: Execute the Trade */}
      <section>
        <div className="flex items-center gap-3 mb-6">
          <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-foreground font-bold font-mono text-xl">
            4
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Step 4</p>
            <h2 className="text-xl font-semibold">Execute the Trade</h2>
          </div>
        </div>

        {/* Before You Buy */}
        <Card className="glass-card mb-6 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Pre-Entry</p>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <Shield className="h-4 w-4 text-foreground" />
              </div>
              Before You Click Buy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { num: 1, text: 'Know your stop loss BEFORE entering (max 50% of premium)' },
                { num: 2, text: 'Know your profit target (minimum 2x your risk)' },
                { num: 3, text: 'Size correctly: Risk only 1-2% of account per trade' },
                { num: 4, text: 'Write it down in your trading journal' },
              ].map((item) => (
                <div key={item.num} className="flex items-start gap-3 p-3 rounded-lg stat-glass">
                  <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 text-foreground flex items-center justify-center text-xs font-bold font-mono shrink-0">
                    {item.num}
                  </div>
                  <span className="text-sm text-muted-foreground">{item.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Position Sizing Example */}
        <Card className="glass-card mb-6 border-green-500/20 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Position Sizing</p>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-foreground" />
              </div>
              Position Sizing Example
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: 'Account Size', value: '$10,000' },
                { label: 'Max Risk (2%)', value: '$200' },
                { label: 'Option Price', value: '$2.00' },
                { label: 'Stop Loss (50%)', value: '$1.00 loss/contract' },
                { label: 'Max Contracts', value: '2 contracts' },
              ].map((item) => (
                <div key={item.label} className="text-center p-3 rounded-lg stat-glass">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">{item.label}</div>
                  <div className="font-bold text-sm font-mono">{item.value}</div>
                </div>
              ))}
            </div>
            
            <div className="mt-6 p-4 rounded-lg bg-[var(--trade-bearish)]/10 border border-red-500/20">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-[var(--trade-bearish)] shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-[var(--trade-bearish)]">Golden Rule:</span>
                  <span className="text-muted-foreground ml-2">
                    Never risk more than you can afford to lose. Options can go to zero. Only trade with money you can lose completely.
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pre-Trade Checklist */}
        <Card className="glass-card border-sky-500/20 rounded-lg">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Checklist</p>
            <CardTitle className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-foreground" />
              </div>
              Pre-Trade Checklist
            </CardTitle>
            <p className="text-muted-foreground text-sm">Run through this before every trade</p>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-3">
              {checklistItems.map((item) => (
                <div 
                  key={item.key} 
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover-elevate ${
                    checklist[item.key] ? 'bg-[var(--trade-bullish)]/10 border border-green-500/30' : 'stat-glass'
                  }`}
                  onClick={() => toggleCheck(item.key)}
                >
                  <Checkbox 
                    checked={checklist[item.key] || false}
                    className="data-[state=checked]:bg-[var(--trade-bullish)] data-[state=checked]:border-green-500"
                  />
                  <span className={`text-sm ${checklist[item.key] ? 'text-[var(--trade-bullish)]' : 'text-muted-foreground'}`}>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
            
            {Object.values(checklist).filter(Boolean).length === checklistItems.length && (
              <div className="mt-4 p-4 rounded-lg bg-[var(--trade-bullish)]/10 border border-green-500/30 text-center">
                <CheckCircle2 className="h-8 w-8 text-[var(--trade-bullish)] mx-auto mb-2" />
                <div className="font-bold text-[var(--trade-bullish)]">All checks passed! You're ready to trade.</div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Disclaimer */}
      <Card className="glass-card bg-muted/30 border-muted rounded-lg">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground italic">
            <strong>Educational Disclaimer:</strong> This guide is for educational purposes only and does not constitute financial advice. Trading options involves substantial risk of loss and is not suitable for all investors. Past performance does not guarantee future results. Always do your own research and consider consulting a financial advisor before making investment decisions.
          </p>
        </CardContent>
      </Card>

      {/* CTA */}
      <Card className="glass-card bg-gradient-to-br from-sky-500/10 via-primary/5 to-purple-500/10 border-sky-500/20 rounded-lg">
        <CardContent className="p-8 text-center">
          <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="h-6 w-6 text-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Ready to Start Trading?</h3>
          <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
            Put what you've learned into practice with our AI-powered research tools
          </p>
          <Link href="/slate">
            <Button size="lg" className="gap-2 bg-sky-500 text-foreground" data-testid="button-go-to-trade-desk">
              Go to Slate
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function DefaultBlogContent({ content }: { content: string }) {
  return (
    <div className="prose prose-lg dark:prose-invert max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground prose-a:text-primary prose-code:text-primary prose-table:text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function BlogPostPage() {
  const [, params] = useRoute("/blog/:slug");
  const slug = params?.slug;

  const { data: post, isLoading, error } = useQuery<BlogPost>({
    queryKey: ["/api/blog", slug],
    enabled: !!slug,
  });

  // Inject JSON-LD structured data for SEO - MUST be before any conditional returns
  useEffect(() => {
    if (!post) return;

    const baseUrl = window.location.origin;
    const wordCount = post.content?.split(/\s+/).length || 0;
    const readingTime = Math.max(3, Math.ceil(wordCount / 200));

    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": post.title,
      "description": post.metaDescription || post.excerpt || post.title,
      "author": {
        "@type": "Person",
        "name": post.authorName
      },
      "publisher": {
        "@type": "Organization",
        "name": "Quant Edge Labs",
        "logo": {
          "@type": "ImageObject",
          "url": `${baseUrl}/logo.png`
        }
      },
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": `${baseUrl}/blog/${post.slug}`
      },
      "datePublished": post.publishedAt ? new Date(post.publishedAt).toISOString() : new Date().toISOString(),
      "dateModified": post.updatedAt ? new Date(post.updatedAt).toISOString() : new Date().toISOString(),
      "image": post.heroImageUrl || `${baseUrl}/og-image.png`,
      "articleSection": post.category.replace('-', ' '),
      "keywords": post.metaKeywords || post.tags?.join(', ') || '',
      "wordCount": wordCount,
      "timeRequired": `PT${readingTime}M`
    };

    // Remove any existing JSON-LD script
    const existingScript = document.querySelector('script[data-jsonld="article"]');
    if (existingScript) {
      existingScript.remove();
    }

    // Add new JSON-LD script
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute('data-jsonld', 'article');
    script.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    // Cleanup on unmount
    return () => {
      const scriptToRemove = document.querySelector('script[data-jsonld="article"]');
      if (scriptToRemove) {
        scriptToRemove.remove();
      }
    };
  }, [post]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="container mx-auto max-w-4xl">
          <Skeleton className="h-8 w-32 mb-6" />
          <Skeleton className="h-64 w-full rounded-lg mb-8" />
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="container mx-auto max-w-4xl text-center py-20">
          <h1 className="text-2xl font-bold mb-4">Article Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The article you're looking for doesn't exist or has been removed.
          </p>
          <Link href="/blog">
            <Button variant="outline" className="border-border" data-testid="button-back-to-blog">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isTradeGuide = slug === 'how-to-trade-like-a-pro';
  const visual = getVisualForCategory(post.category);
  const Icon = visual.icon;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title={`${post.title} | Quant Edge Labs Blog`}
        description={post.metaDescription || post.excerpt || post.title}
        keywords={post.metaKeywords?.split(',').map(k => k.trim()) || post.tags}
        ogTitle={post.title}
        ogDescription={post.metaDescription || post.excerpt}
        ogImage={post.heroImageUrl}
        canonical={`/blog/${post.slug}`}
      />
      
      {/* Hero Header */}
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-purple-500/10" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />
        
        <div className="container mx-auto max-w-4xl px-6 py-8 relative">
          <Link href="/blog">
            <Button variant="ghost" size="sm" className="mb-6 hover-elevate" data-testid="button-back-to-blog">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </Link>

          {!isTradeGuide && (
            <header>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
                {post.category.replace('-', ' ')}
              </p>
              
              <div className="flex items-start gap-4 mb-4">
                <div className={`h-12 w-12 rounded-lg bg-gradient-to-br ${visual.gradient} flex items-center justify-center shrink-0`}>
                  <Icon className="h-6 w-6 text-foreground" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-semibold" data-testid="text-post-title">
                    {post.title}
                  </h1>
                </div>
              </div>
              
              {post.excerpt && (
                <p className="text-base text-muted-foreground mb-6 leading-relaxed max-w-2xl">
                  {post.excerpt}
                </p>
              )}
              
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span>{post.authorName}</span>
                </div>
                {post.publishedAt && (
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>{format(new Date(post.publishedAt), 'MMMM d, yyyy')}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span className="font-mono">8 min read</span>
                </div>
              </div>
            </header>
          )}
        </div>
      </div>

      <div className="container mx-auto max-w-4xl px-6 py-8">
        {isTradeGuide ? (
          <TradingGuideContent />
        ) : (
          <article>
            <DefaultBlogContent content={post.content} />

            {post.tags && post.tags.length > 0 && (
              <div className="mt-8 pt-8 border-t border-border/50">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
