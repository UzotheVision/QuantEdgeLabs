import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GraduationCap, BookOpen, Target, Brain, Calculator, TrendingUp, Clock, Shield, ChevronRight, Lightbulb, BarChart2, DollarSign, Heart, Scale, Compass, FileText, Calendar, ArrowRight, Users } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

import technicalAnalysisImg from "@assets/stock_images/stock_market_trading_8de20e16.jpg";
import chartPatternsImg from "@assets/stock_images/stock_market_trading_86b3df18.jpg";
import movingAveragesImg from "@assets/stock_images/stock_market_trading_bc4536f2.jpg";
import positionSizingImg from "@assets/stock_images/stock_trading_risk_m_d5015c58.jpg";
import stopLossesImg from "@assets/stock_images/stock_trading_risk_m_32dd27bb.jpg";
import riskRewardImg from "@assets/stock_images/stock_trading_risk_m_e3a95378.jpg";
import psychologyImg from "@assets/stock_images/business_person_thin_ec170101.jpg";
import tradingPlanImg from "@assets/stock_images/business_person_thin_3d22268f.jpg";
import cryptoImg from "@assets/stock_images/cryptocurrency_bitco_69b7fa93.jpg";
import optionsImg from "@assets/stock_images/cryptocurrency_bitco_a0a19b3e.jpg";

const CATEGORIES = [
  { id: 'all', label: 'All Articles', icon: BookOpen },
  { id: 'technical', label: 'Technical Analysis', icon: BarChart2 },
  { id: 'risk', label: 'Risk Management', icon: Shield },
  { id: 'psychology', label: 'Psychology', icon: Brain },
  { id: 'options', label: 'Options Trading', icon: DollarSign },
];

interface Article {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  level: string;
  readTime: string;
  image: string;
  author: string;
  date: string;
  featured?: boolean;
}

const articles: Article[] = [
  {
    id: 'what-is-technical-analysis',
    title: "What is Technical Analysis? A Complete Guide for Beginners",
    excerpt: "Understanding how price patterns, volume, and indicators help identify potential market movements. Learn the fundamentals of reading charts and making informed trading decisions.",
    category: 'technical',
    level: 'Beginner',
    readTime: '12 min',
    image: technicalAnalysisImg,
    author: 'Quant Edge Labs',
    date: 'Jan 2, 2026',
    featured: true,
  },
  {
    id: 'chart-patterns',
    title: "15 Common Chart Patterns Every Trader Should Know",
    excerpt: "Learn to recognize head and shoulders, double tops/bottoms, triangles, flags, and other patterns that traders use to anticipate price movements.",
    category: 'technical',
    level: 'Beginner',
    readTime: '18 min',
    image: chartPatternsImg,
    author: 'Quant Edge Labs',
    date: 'Jan 1, 2026',
  },
  {
    id: 'moving-averages',
    title: "Understanding Moving Averages: SMA vs EMA",
    excerpt: "Explore simple, exponential, and weighted moving averages. Learn how traders use them to identify trends, support/resistance, and potential entry points.",
    category: 'technical',
    level: 'Beginner',
    readTime: '15 min',
    image: movingAveragesImg,
    author: 'Quant Edge Labs',
    date: 'Dec 30, 2025',
  },
  {
    id: 'position-sizing',
    title: "Position Sizing: The Most Important Trading Skill",
    excerpt: "Why the 1-2% rule exists, how to calculate position size correctly, and why risking too much on a single trade destroys accounts faster than bad entries.",
    category: 'risk',
    level: 'Beginner',
    readTime: '20 min',
    image: positionSizingImg,
    author: 'Quant Edge Labs',
    date: 'Dec 28, 2025',
  },
  {
    id: 'stop-losses',
    title: "The Complete Guide to Setting Stop Losses",
    excerpt: "Where to place stops, why most traders place them wrong, and techniques for protecting profits while giving trades room to work without getting stopped out prematurely.",
    category: 'risk',
    level: 'Intermediate',
    readTime: '22 min',
    image: stopLossesImg,
    author: 'Quant Edge Labs',
    date: 'Dec 26, 2025',
  },
  {
    id: 'risk-reward-ratios',
    title: "Risk-Reward Ratios Explained: The Math Behind Profits",
    excerpt: "Why a 1:2 risk-reward ratio means you can be wrong 60% of the time and still be profitable. The math behind consistent trading success.",
    category: 'risk',
    level: 'Beginner',
    readTime: '15 min',
    image: riskRewardImg,
    author: 'Quant Edge Labs',
    date: 'Dec 24, 2025',
  },
  {
    id: 'trading-psychology',
    title: "Trading Psychology: Mastering Your Emotions",
    excerpt: "Fear, greed, FOMO, and revenge trading. Understanding the emotional traps that cause most traders to fail and practical strategies to overcome them.",
    category: 'psychology',
    level: 'Beginner',
    readTime: '25 min',
    image: psychologyImg,
    author: 'Quant Edge Labs',
    date: 'Dec 22, 2025',
  },
  {
    id: 'building-trading-plan',
    title: "How to Build a Trading Plan That Works",
    excerpt: "Why trading without a plan is gambling. Step-by-step guide to creating rules for entries, exits, position sizing, and when to step away from the screen.",
    category: 'psychology',
    level: 'Intermediate',
    readTime: '30 min',
    image: tradingPlanImg,
    author: 'Quant Edge Labs',
    date: 'Dec 20, 2025',
  },
  {
    id: 'options-101',
    title: "Options 101: Understanding Calls and Puts",
    excerpt: "What options are, how they work, and the basic mechanics of buying calls and puts. Clear explanations without the confusing jargon.",
    category: 'options',
    level: 'Beginner',
    readTime: '20 min',
    image: optionsImg,
    author: 'Quant Edge Labs',
    date: 'Dec 18, 2025',
  },
  {
    id: 'the-greeks',
    title: "The Greeks: Delta, Theta, Gamma Explained",
    excerpt: "How options prices change based on time, volatility, and price movement. Essential knowledge for any serious options trader.",
    category: 'options',
    level: 'Intermediate',
    readTime: '28 min',
    image: cryptoImg,
    author: 'Quant Edge Labs',
    date: 'Dec 16, 2025',
  },
];

export default function Academy() {
  const [activeCategory, setActiveCategory] = useState('all');

  const filteredArticles = activeCategory === 'all'
    ? articles
    : articles.filter(a => a.category === activeCategory);

  const featuredArticle = filteredArticles.find(a => a.featured) || filteredArticles[0];
  const regularArticles = filteredArticles.filter(a => a.id !== featuredArticle?.id);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-emerald-500/10" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />
        
        <div className="container mx-auto max-w-[1600px] px-3 sm:px-4 py-6 md:py-8 relative">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Learning Center
          </p>

          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
              <GraduationCap className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold" data-testid="text-page-title">Trading Academy</h1>
              <p className="text-[10px] text-muted-foreground">Free educational resources for traders</p>
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground max-w-2xl mb-4 leading-relaxed">
            Master the art of trading with our comprehensive guides on technical analysis, 
            risk management, trading psychology, and options strategies.
          </p>
          
          {/* Category Tabs */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <Button
                  key={cat.id}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveCategory(cat.id)}
                  className={isActive ? "bg-purple-500 text-white" : "border-border"}
                  data-testid={`category-${cat.id}`}
                >
                  <cat.icon className="h-4 w-4 mr-2" />
                  {cat.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-7xl px-6 py-8">
        {/* Quick Links */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <Link href="/how-to">
            <Card className="glass-card hover-elevate h-full border-border/50 cursor-pointer" data-testid="link-technical-guide">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">Technical Guide</h3>
                  <p className="text-xs text-muted-foreground">Indicator reference</p>
                </div>
                <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/how-to">
            <Card className="glass-card hover-elevate h-full border-border/50 cursor-pointer" data-testid="link-trading-rules">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center flex-shrink-0">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">Trading Rules</h3>
                  <p className="text-xs text-muted-foreground">Risk management</p>
                </div>
                <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
          <Link href="/blog">
            <Card className="glass-card hover-elevate h-full border-border/50 cursor-pointer" data-testid="link-blog">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">Blog</h3>
                  <p className="text-xs text-muted-foreground">Market insights</p>
                </div>
                <ChevronRight className="h-4 w-4 ml-auto text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Featured Article */}
        {featuredArticle && (
          <div className="mb-10">
            <FeaturedArticleCard article={featuredArticle} />
          </div>
        )}

        {/* Article Grid */}
        <div className="mb-10">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Latest Articles
          </p>
          <h2 className="text-xl font-semibold mb-6">Continue Learning</h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {regularArticles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="glass-card rounded-xl p-5 border border-border/50 border-l-2 border-l-amber-500/50">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 flex-shrink-0">
              <Shield className="h-4 w-4 text-white" />
            </div>
            <div>
              <h4 className="font-medium text-sm mb-1">Educational Disclaimer</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This content is for educational purposes only and does not constitute financial advice. 
                Trading involves substantial risk of loss. Past performance does not guarantee future results. 
                Always do your own research and consider your financial situation before trading.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturedArticleCard({ article }: { article: Article }) {
  return (
    <Card className="glass-card overflow-hidden hover-elevate cursor-pointer group" data-testid="featured-article">
      <div className="grid md:grid-cols-2 gap-0">
        {/* Image Side */}
        <div className="relative h-64 md:h-auto min-h-[280px] overflow-hidden">
          <img 
            src={article.image} 
            alt={article.title}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
          <Badge className="absolute top-4 left-4 bg-purple-500 text-white border-purple-400">
            Featured
          </Badge>
        </div>
        
        {/* Content Side */}
        <CardContent className="p-6 md:p-8 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" className="capitalize text-xs">
              {article.category === 'technical' ? 'Technical Analysis' : 
               article.category === 'risk' ? 'Risk Management' :
               article.category === 'psychology' ? 'Psychology' : 'Options Trading'}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {article.level}
            </Badge>
          </div>
          
          <h2 className="text-2xl md:text-3xl font-bold mb-3 group-hover:text-purple-400 transition-colors">
            {article.title}
          </h2>
          <p className="text-muted-foreground mb-4 leading-relaxed line-clamp-3">
            {article.excerpt}
          </p>
          
          <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/50">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>{article.date}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>{article.readTime} read</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-purple-500 font-medium text-sm group-hover:gap-2 transition-all">
              Read article <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

function ArticleCard({ article }: { article: Article }) {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'technical': return 'text-blue-400';
      case 'risk': return 'text-[var(--trade-bullish)]';
      case 'psychology': return 'text-orange-400';
      case 'options': return 'text-purple-400';
      default: return 'text-[var(--trade-bullish)]';
    }
  };

  return (
    <Card 
      className="glass-card overflow-hidden h-full hover-elevate cursor-pointer group"
      data-testid={`article-${article.id}`}
    >
      {/* Image Header */}
      <div className="relative h-44 overflow-hidden">
        <img 
          src={article.image} 
          alt={article.title}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
          <Badge variant="secondary" className="text-xs bg-[var(--surface-base)]/50 backdrop-blur-sm border-none">
            {article.level}
          </Badge>
          <span className="text-xs text-white/80 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {article.readTime}
          </span>
        </div>
      </div>
      
      {/* Content */}
      <CardContent className="p-4">
        <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${getCategoryColor(article.category)}`}>
          {article.category === 'technical' ? 'Technical Analysis' : 
           article.category === 'risk' ? 'Risk Management' :
           article.category === 'psychology' ? 'Psychology' : 'Options Trading'}
        </p>
        
        <h3 className="font-bold text-base mb-2 line-clamp-2 group-hover:text-purple-400 transition-colors leading-tight">
          {article.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
          {article.excerpt}
        </p>
        
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border/50">
          <span>{article.date}</span>
          <div className="flex items-center gap-1 text-purple-500 font-medium group-hover:gap-2 transition-all">
            Read <ChevronRight className="h-3 w-3" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
