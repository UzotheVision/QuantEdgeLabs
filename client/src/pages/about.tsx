import {
  Activity, Target, Shield, Zap, Brain, TrendingUp, BarChart3,
  LineChart, Eye, Users, Award, Lock, Server, CheckCircle2,
  ArrowLeft, Sparkles, Globe, Clock, ChartCandlestick
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CONVICTION_LAYER_COUNT } from "@shared/conviction-layers";
import { SEOHead } from "@/components/seo-head";
import { Link } from "wouter";
import qeMark from "@assets/qe-mark.svg";
import profileImage from "@assets/malikpic-480.jpg";

const engines = [
  {
    name: "Technical Layer",
    icon: LineChart,
    color: "from-blue-500 to-blue-600",
    description: "Multi-timeframe pattern recognition across 50+ indicators including RSI, MACD, Bollinger Bands, and proprietary momentum signals."
  },
  {
    name: "Fundamental Layer",
    icon: BarChart3,
    color: "from-emerald-500 to-emerald-600",
    description: "Real-time financial analysis covering earnings, revenue growth, P/E ratios, debt levels, and sector comparisons."
  },
  {
    name: "Sentiment Layer",
    icon: Brain,
    color: "from-purple-500 to-purple-600",
    description: "NLP-powered analysis of news, social media, and analyst reports to gauge market sentiment and crowd psychology."
  },
  {
    name: "Options Flow Layer",
    icon: Eye,
    color: "from-amber-500 to-amber-600",
    description: "Track unusual options activity, smart money positioning, and institutional hedging patterns in real-time."
  },
  {
    name: "Convergence Layer",
    icon: Target,
    color: "from-sky-500 to-sky-600",
    description: "Our proprietary algorithm that synthesizes all layers into a unified signal strength score with graded bands."
  }
];

const values = [
  {
    title: "Accuracy Over Volume",
    description: "We'd rather give you 3 high-conviction ideas than 30 mediocre ones. Quality signals matter.",
    icon: Target
  },
  {
    title: "Transparency First",
    description: "Every recommendation shows exactly why it was made. No black boxes, no hidden logic.",
    icon: Eye
  },
  {
    title: "Continuous Learning",
    description: "Our models improve daily based on market feedback and performance tracking.",
    icon: Brain
  },
  {
    title: "Trader-Centric Design",
    description: "Built by traders, for traders. Every feature solves a real problem we've faced.",
    icon: Users
  }
];

const stats = [
  { value: String(CONVICTION_LAYER_COUNT), label: "Conviction Layers", suffix: "" },
  // Measured 2026-09-24, not aspirational: the feeds the server actually calls
  // (Yahoo, CBOE, Finnhub, Bullflow, CoinGecko, Coinbase, SEC EDGAR, Nasdaq) and
  // the liquid universe ranked daily (server/data/liquid-universe.json).
  { value: "8", label: "Market Data Feeds", suffix: "" },
  { value: "2000", label: "Liquid Names Ranked Daily", suffix: "" },
  { value: "24/7", label: "Market Monitoring", suffix: "" },
];

const milestones = [
  { year: "2024 Q1", event: "Research & Development begins" },
  { year: "2024 Q2", event: "Technical & Fundamental engines deployed" },
  { year: "2024 Q3", event: "Sentiment analysis integration" },
  { year: "2024 Q4", event: "Options flow tracking added" },
  { year: "2025 Q1", event: "Convergence Engine & Beta Launch" },
];

const trustBadges = [
  { icon: Lock, label: "HTTPS / TLS Encryption" },
  { icon: Server, label: "Hosted on SOC 2-Audited Cloud" },
  { icon: Shield, label: "Read-Only Data Access" },
  { icon: CheckCircle2, label: "No Trading Execution" },
];

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <SEOHead pageKey="about" />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 lg:px-6">
          <div className="flex h-14 items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <img src={qeMark} alt="" width={22} height={22} className="h-[22px] w-[22px]" />
                <h1 className="text-lg font-bold">Quant Edge Labs</h1>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 lg:px-6 py-12 max-w-6xl space-y-16">

        {/* Hero Section */}
        <section className="text-center space-y-6">
          <Badge variant="outline" className="border-sky-500/30 text-sky-400">
            <Sparkles className="h-3 w-3 mr-1" />
            About QuantEdge Labs
          </Badge>
          <h1 className="text-4xl sm:text-5xl font-bold">
            <span className="text-[var(--trade-bullish)]">
              Multi-Engine Intelligence
            </span>
            <br />
            <span className="text-foreground">for Smarter Trading</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We built QuantEdge Labs because we were tired of scattered data, conflicting signals,
            and analysis paralysis. Our platform scores every setup through {CONVICTION_LAYER_COUNT} layers and publishes
            its measured hit rate — including the models that failed validation.
          </p>
        </section>

        {/* Stats Bar */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, i) => (
            <Card key={i} className="glass-card text-center">
              <CardContent className="p-4">
                <div className="text-3xl font-bold text-[var(--trade-bullish)]">
                  {stat.value}{stat.suffix}
                </div>
                <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Mission Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Target className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl font-semibold">Our Mission</h2>
          </div>
          <Card className="glass-card border-l-2 border-[var(--trade-bullish)]/50">
            <CardContent className="p-4">
              <p className="text-muted-foreground leading-relaxed">
                Financial markets generate millions of data points daily. Individual traders can't
                possibly track technical patterns, fundamental changes, sentiment shifts, options flow
                and dealer gamma positioning simultaneously. Institutions have entire teams for this.
                <strong className="text-foreground"> We built QuantEdge to level the playing field.</strong>
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Our convergence-based approach means you only see opportunities where multiple independent
                layers agree. When technicals align with fundamentals, sentiment confirms the direction,
                and smart money is positioning accordingly—that's when you get a high-conviction signal.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Conviction layers — count comes from shared/conviction-layers.ts */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl font-semibold">{CONVICTION_LAYER_COUNT} Conviction Layers</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {engines.map((engine, i) => (
              <Card key={i} className="glass-card group hover:border-sky-500/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 rounded-lg bg-gradient-to-br ${engine.color} flex items-center justify-center flex-shrink-0`}>
                      <engine.icon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{engine.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {engine.description}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Core Values */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
              <Award className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl font-semibold">Core Values</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {values.map((value, i) => (
              <Card key={i} className="glass-card">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
                      <value.icon className="h-4 w-4 text-sky-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{value.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{value.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Timeline */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl font-semibold">Development Timeline</h2>
          </div>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="space-y-4">
                {milestones.map((milestone, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Badge variant="outline" className="w-24 justify-center text-xs border-sky-500/30 text-sky-400">
                      {milestone.year}
                    </Badge>
                    <div className="h-2 w-2 rounded-full bg-sky-500" />
                    <span className="text-sm text-muted-foreground">{milestone.event}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Security & Trust */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl font-semibold">Security & Trust</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {trustBadges.map((badge, i) => (
              <Card key={i} className="glass-card text-center">
                <CardContent className="p-4">
                  <badge.icon className="h-6 w-6 text-[var(--trade-bullish)] mx-auto mb-2" />
                  <span className="text-xs text-muted-foreground">{badge.label}</span>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-sm text-muted-foreground text-center">
            QuantEdge Labs is a research and analysis platform only. We never execute trades on your behalf
            or require brokerage credentials. Your data stays secure with enterprise-grade encryption.
          </p>
        </section>

        {/* Creator Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center">
              <Users className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl font-semibold">Meet the Creator</h2>
          </div>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-1 flex justify-center lg:justify-start">
                  <img
                    src={profileImage}
                    alt="Abdulmalik Ajisegiri"
                    width={128} height={128} loading="lazy" decoding="async"
                    className="w-32 h-32 rounded-lg object-cover border-2 border-sky-500/20 shadow-lg"
                  />
                </div>
                <div className="lg:col-span-3 space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold">
                      <a
                        href="https://abdulmalikajisegiri.com/"
                        target="_blank"
                        rel="me noopener noreferrer"
                        className="hover:text-sky-300 transition-colors"
                      >
                        Abdulmalik Ajisegiri
                      </a>
                    </h3>
                    <p className="text-sky-400 font-medium">Founder & Lead Developer</p>
                    <p className="text-sm text-muted-foreground">Model Risk Engineer @ DTCC</p>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Systems engineer specializing in AI/ML model validation, risk analytics, and quantitative methods.
                    With expertise in stress testing, benchmarking, and model governance, Abdulmalik brings institutional-grade
                    rigor to QuantEdge Labs. M.S. in Systems Engineering from University of Oklahoma, B.S. in Computer
                    Engineering from UT Arlington.
                  </p>
                  <div className="flex gap-3">
                    <a
                      href="https://abdulmalikajisegiri.com/"
                      target="_blank"
                      rel="me noopener noreferrer"
                      className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      Portfolio
                    </a>
                    <span className="text-muted-foreground">•</span>
                    <a
                      href="https://www.linkedin.com/in/malikajisegiri"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      LinkedIn
                    </a>
                    <span className="text-muted-foreground">•</span>
                    <a
                      href="https://github.com/Maleek23"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-sky-400 hover:text-sky-300 transition-colors"
                    >
                      GitHub
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* CTA Section */}
        <section className="text-center space-y-6 py-8">
          <h2 className="text-2xl font-semibold">Ready to Trade Smarter?</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Join the beta and experience multi-engine analysis that gives you the edge.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="bg-gradient-to-r from-emerald-500 to-sky-500 hover:from-emerald-600 hover:to-sky-600">
                <Sparkles className="h-4 w-4 mr-2" />
                Sign Up Free
              </Button>
            </Link>
            <Link href="/">
              <Button size="lg" variant="outline">
                View Features
              </Button>
            </Link>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-12">
        <div className="container mx-auto px-4 lg:px-6 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Quant Edge Labs. All rights reserved.</p>
          <div className="flex gap-4 justify-center mt-2">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
