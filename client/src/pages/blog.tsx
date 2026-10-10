import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Newspaper, Calendar, Clock, TrendingUp, Brain, Target, BarChart3, 
  ArrowRight, BookOpen, Shield, Zap, DollarSign, LineChart, 
  Lightbulb, GraduationCap, Users, ChevronRight
} from "lucide-react";
import { format } from "date-fns";
import { SEOHead } from "@/components/seo-head";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { BlogPost } from "@shared/schema";
import { useState } from "react";

const CATEGORIES = [
  { id: 'all', label: 'All Articles', icon: BookOpen },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'strategy', label: 'Strategy', icon: Target },
  { id: 'risk-management', label: 'Risk Management', icon: Shield },
  { id: 'market-commentary', label: 'Market Insights', icon: LineChart },
];

const CATEGORY_VISUALS: Record<string, { gradient: string; icon: any; pattern: string }> = {
  'education': { 
    gradient: 'from-blue-600 via-sky-500 to-teal-400', 
    icon: GraduationCap,
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
    icon: LineChart,
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

function estimateReadTime(content: string): number {
  const wordsPerMinute = 200;
  const words = content?.split(/\s+/).length || 0;
  return Math.max(3, Math.ceil(words / wordsPerMinute));
}

export default function Blog() {
  const [activeCategory, setActiveCategory] = useState('all');
  
  const { data: articles = [], isLoading } = useQuery<BlogPost[]>({
    queryKey: ["/api/blog"],
  });

  const filteredArticles = activeCategory === 'all' 
    ? articles 
    : articles.filter(a => a.category === activeCategory);

  const featuredArticle = filteredArticles[0];
  const regularArticles = filteredArticles.slice(1);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <SEOHead pageKey="blog" />
        <div className="container mx-auto max-w-7xl px-6 py-8">
          <Skeleton className="h-[400px] w-full rounded-lg mb-8" />
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-80 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead pageKey="blog" />
      
      {/* Hero Section */}
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-purple-500/10" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:32px_32px]" />
        
        <div className="container mx-auto max-w-[1600px] px-3 sm:px-4 py-6 md:py-8 relative">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Trading Education
          </p>

          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
              <BookOpen className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Trading Insights</h1>
              <p className="text-[10px] text-muted-foreground">Learn. Grow. Trade Smarter.</p>
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground max-w-2xl mb-4 leading-relaxed">
            Free educational content to help you understand options trading, risk management, 
            and market analysis. Written by traders, for traders.
          </p>
          
          {/* Quick Links */}
          <div className="flex items-center gap-3 mb-8">
            <Link href="/academy">
              <Button variant="outline" size="sm" className="border-border gap-2" data-testid="link-to-academy">
                <GraduationCap className="h-4 w-4" />
                Trading Academy
                <ChevronRight className="h-3 w-3" />
              </Button>
            </Link>
            <Link href="/how-to">
              <Button variant="outline" size="sm" className="border-border gap-2" data-testid="link-to-rules">
                <Shield className="h-4 w-4" />
                Trading Rules
              </Button>
            </Link>
          </div>
          
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
                  className={isActive ? "bg-sky-500 text-foreground" : "border-border"}
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
        {articles.length === 0 ? (
          <EmptyBlogState />
        ) : (
          <>
            {/* Featured Article */}
            {featuredArticle && (
              <div className="mb-12">
                <FeaturedArticleCard article={featuredArticle} />
              </div>
            )}

            {/* Article Grid */}
            {regularArticles.length > 0 && (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                {regularArticles.map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            )}
          </>
        )}

        {/* Educational Topics Section */}
        <TopicsSection />
        
        {/* Newsletter CTA */}
        <NewsletterCTA />
      </div>
    </div>
  );
}

function FeaturedArticleCard({ article }: { article: BlogPost }) {
  const visual = getVisualForCategory(article.category);
  const Icon = visual.icon;
  const readTime = estimateReadTime(article.content);

  return (
    <Link href={`/blog/${article.slug}`}>
      <Card className="glass-card overflow-visible hover-elevate cursor-pointer group rounded-lg" data-testid="featured-article">
        <div className="grid md:grid-cols-2 gap-0">
          {/* Visual Side */}
          <div 
            className="relative h-64 md:h-auto min-h-[280px] overflow-hidden rounded-t-lg md:rounded-l-lg md:rounded-tr-none"
            style={{ background: visual.pattern }}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${visual.gradient} opacity-80`} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 blur-3xl bg-white/20 rounded-full scale-150" />
                <Icon className="h-24 w-24 text-white/90 relative z-10 group-hover:scale-110 transition-transform duration-300" />
              </div>
            </div>
            <Badge className="absolute top-4 left-4 bg-white/20 text-white border-white/30 backdrop-blur-sm">
              Featured
            </Badge>
          </div>
          
          {/* Content Side */}
          <CardContent className="p-6 md:p-8 flex flex-col justify-center">
            <Badge variant="outline" className="w-fit mb-3 capitalize">
              {article.category.replace('-', ' ')}
            </Badge>
            <h2 className="text-2xl md:text-3xl font-bold mb-3 group-hover:text-sky-400 transition-colors">
              {article.title}
            </h2>
            <p className="text-muted-foreground mb-4 leading-relaxed line-clamp-3">
              {article.excerpt}
            </p>
            
            <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/50">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>{article.publishedAt ? format(new Date(article.publishedAt), 'MMM d, yyyy') : 'Draft'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span>{readTime} min read</span>
                </div>
              </div>
              <div className="flex items-center gap-1 text-sky-500 font-medium text-sm group-hover:gap-2 transition-all">
                Read more <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    </Link>
  );
}

function ArticleCard({ article }: { article: BlogPost }) {
  const visual = getVisualForCategory(article.category);
  const Icon = visual.icon;
  const readTime = estimateReadTime(article.content);

  return (
    <Link href={`/blog/${article.slug}`}>
      <Card className="glass-card overflow-visible h-full hover-elevate cursor-pointer group rounded-lg" data-testid={`article-${article.id}`}>
        {/* Visual Header */}
        <div 
          className="relative h-40 overflow-hidden rounded-t-lg"
          style={{ background: visual.pattern }}
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${visual.gradient} opacity-70`} />
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon className="h-16 w-16 text-white/80 group-hover:scale-110 transition-transform duration-300" />
          </div>
        </div>
        
        {/* Content */}
        <CardContent className="p-4">
          <Badge variant="outline" className="mb-3 capitalize text-xs">
            {article.category.replace('-', ' ')}
          </Badge>
          <h3 className="font-bold text-lg mb-2 line-clamp-2 group-hover:text-sky-400 transition-colors">
            {article.title}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
            {article.excerpt}
          </p>
          
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border/50">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{readTime} min</span>
            </div>
            <div className="flex items-center gap-1 text-sky-500 font-medium group-hover:gap-2 transition-all">
              Read <ChevronRight className="h-3 w-3" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function TopicsSection() {
  const topics = [
    { 
      title: 'Options Basics', 
      desc: 'Learn calls, puts, strikes, and expiration dates',
      icon: BookOpen,
      color: 'from-blue-500 to-sky-500'
    },
    { 
      title: 'Risk Management', 
      desc: 'Position sizing, stop losses, and portfolio protection',
      icon: Shield,
      color: 'from-green-500 to-emerald-500'
    },
    { 
      title: 'Chart Analysis', 
      desc: 'Support, resistance, trends, and patterns',
      icon: BarChart3,
      color: 'from-purple-500 to-pink-500'
    },
    { 
      title: 'Trading Psychology', 
      desc: 'Discipline, emotions, and building good habits',
      icon: Brain,
      color: 'from-orange-500 to-amber-500'
    },
  ];

  return (
    <div className="mb-12">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Explore
      </p>
      <div className="flex items-center gap-2 mb-6">
        <GraduationCap className="h-5 w-5 text-sky-500" />
        <h2 className="text-xl font-semibold">Popular Topics</h2>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {topics.map((topic) => (
          <Card key={topic.title} className="glass-card overflow-visible hover-elevate cursor-pointer group rounded-lg">
            <CardContent className="p-4 text-center">
              <div className={`h-12 w-12 rounded-lg bg-gradient-to-br ${topic.color} flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform duration-200`}>
                <topic.icon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-semibold text-sm mb-1">{topic.title}</h3>
              <p className="text-xs text-muted-foreground">{topic.desc}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EmptyBlogState() {
  return (
    <Card className="glass-card text-center py-16 rounded-lg">
      <CardContent>
        <div className="h-20 w-20 rounded-lg bg-gradient-to-br from-sky-500/20 to-blue-500/20 flex items-center justify-center mx-auto mb-6">
          <Newspaper className="h-10 w-10 text-sky-500" />
        </div>
        <h2 className="text-2xl font-semibold mb-2">Content Coming Soon</h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-6 leading-relaxed">
          We're working on creating helpful educational content about options trading, 
          risk management, and market analysis.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            <span>Trading Guides</span>
          </div>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            <span>Strategy Deep-Dives</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span>Risk Tips</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NewsletterCTA() {
  return (
    <Card className="glass-card bg-gradient-to-br from-sky-500/10 via-transparent to-purple-500/10 border-sky-500/20 rounded-lg">
      <CardContent className="p-6 md:p-8">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              Stay Updated
            </p>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center">
                <Users className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold">Join Our Community</h3>
            </div>
            <p className="text-muted-foreground mb-4 leading-relaxed">
              Get weekly trading insights, educational content, and market analysis 
              delivered straight to your inbox. No spam, just valuable content.
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[var(--trade-bullish)]" />
                Weekly market recaps and analysis
              </li>
              <li className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-blue-400" />
                Educational articles and trading tips
              </li>
              <li className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[var(--trade-neutral)]" />
                Trade ideas and setup breakdowns
              </li>
            </ul>
          </div>
          <div className="flex flex-col items-center md:items-end">
            <Button 
              size="lg"
              variant="outline"
              disabled
              className="w-full md:w-auto border-border"
              data-testid="button-subscribe-newsletter"
            >
              Newsletter Coming Soon
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Free forever. Unsubscribe anytime.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
