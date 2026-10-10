import { useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageShell, PageHeader } from '@/components/template/page-shell';
import {
  MessageSquare,
  FileText,
  Search,
  Clock,
  Eye,
  Trash2,
  BarChart3,
  TrendingUp,
  Target,
} from "lucide-react";

interface ChatHistoryItem {
  id: number;
  title: string;
  createdAt: string;
  messages: number;
}

interface ResearchHistoryItem {
  id: number;
  symbol: string;
  companyName?: string;
  analysisType: string;
  createdAt: string;
  signal?: string;
  direction?: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function History() {
  const [location] = useLocation();
  const defaultTab = location.includes("/research") ? "research" : "chat";
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch chat history from real API
  const { data: chatData, isLoading: chatLoading } = useQuery<{ history: ChatHistoryItem[] }>({
    queryKey: ["/api/ai/chat/history"],
  });

  // Fetch research history from real API
  const { data: researchData, isLoading: researchLoading } = useQuery<{ history: ResearchHistoryItem[] }>({
    queryKey: ["/api/research-history"],
  });

  const chatHistory = chatData?.history || [];
  const researchHistory = researchData?.history || [];

  // Filter based on search query
  const filteredChatHistory = chatHistory.filter(chat =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredResearchHistory = researchHistory.filter(research =>
    research.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (research.companyName?.toLowerCase().includes(searchQuery.toLowerCase())) ||
    research.analysisType.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSignalColor = (signal: string | undefined) => {
    switch (signal?.toUpperCase()) {
      case "BUY":
      case "BULLISH":
      case "LONG": return "bg-emerald-500/20 text-[var(--trade-bullish)] border-emerald-500/30";
      case "SELL":
      case "BEARISH":
      case "SHORT": return "bg-red-500/20 text-[var(--trade-bearish)] border-red-500/30";
      case "HOLD":
      case "NEUTRAL": return "bg-amber-500/20 text-[var(--trade-neutral)] border-amber-500/30";
      default: return "bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30";
    }
  };

  return (
    <>
      <PageShell width="page">
        <PageHeader
          eyebrow="Record"
          title="History"
          description="Every idea the board has published, and what happened to it."
          actions={
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search history..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-64 bg-muted/50 border-border"
              data-testid="input-search-history"
            />
          </div>
          }
        />

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-muted/50 mb-6">
              <TabsTrigger
                value="chat"
                className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-sky-400 gap-2"
                data-testid="tab-chat-history"
              >
                <MessageSquare className="w-4 h-4" />
                Chat History
              </TabsTrigger>
              <TabsTrigger
                value="research"
                className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-sky-400 gap-2"
                data-testid="tab-research-history"
              >
                <FileText className="w-4 h-4" />
                Research History
              </TabsTrigger>
            </TabsList>

            {/* Chat History Tab */}
            <TabsContent value="chat">
              <Card className="bg-card/60 border-border overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-sm text-muted-foreground">Your previous AI chat conversations</p>
                </div>
                {chatLoading ? (
                  <div className="p-4 space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 bg-muted" />
                    ))}
                  </div>
                ) : filteredChatHistory.length > 0 ? (
                  <div className="divide-y divide-slate-800/50">
                    {filteredChatHistory.map((chat) => (
                      <div
                        key={chat.id}
                        className="p-4 hover:bg-muted/30 transition-colors flex items-center justify-between cursor-pointer"
                        data-testid={`chat-history-${chat.id}`}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                            <MessageSquare className="w-5 h-5 text-sky-400" />
                          </div>
                          <div>
                            <p className="font-medium text-foreground/90">{chat.title}</p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {formatDate(chat.createdAt)}
                              <span>•</span>
                              <span>{chat.messages} messages</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" className="text-sky-400">
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-[var(--trade-bearish)]">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-12 text-center">
                    <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No chat history yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Your AI conversations will appear here</p>
                  </div>
                )}
              </Card>
            </TabsContent>

            {/* Research History Tab */}
            <TabsContent value="research">
              <Card className="bg-card/60 border-border overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-sm text-muted-foreground">Every analysis you've run, organized and ready to revisit</p>
                </div>
                {researchLoading ? (
                  <div className="p-4 space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 bg-muted" />
                    ))}
                  </div>
                ) : filteredResearchHistory.length > 0 ? (
                  <div className="divide-y divide-slate-800/50">
                    {filteredResearchHistory.map((research) => (
                      <div
                        key={research.id}
                        className="p-4 hover:bg-muted/30 transition-colors flex items-center justify-between"
                        data-testid={`research-history-${research.id}`}
                      >
                        <div className="flex items-center gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <Link href={`/r/${research.symbol}?tab=chart`}>
                                <span className="font-semibold text-sky-400 hover:text-[var(--trade-bullish)] cursor-pointer">
                                  {research.symbol}
                                </span>
                              </Link>
                              <span className="text-sm text-muted-foreground">{research.companyName}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                                <BarChart3 className="w-3 h-3 mr-1" />
                                {research.analysisType}
                              </Badge>
                              <span className="text-xs text-muted-foreground">• {formatDate(research.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {(research.signal || research.direction) && (
                            <Badge className={cn("text-xs", getSignalColor(research.signal || research.direction))}>
                              {(research.signal || research.direction)?.toUpperCase()}
                            </Badge>
                          )}
                          <Link href={`/r/${research.symbol}?tab=chart`}>
                            <Button variant="ghost" size="sm" className="text-sky-400">
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                          </Link>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-[var(--trade-bearish)]">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-12 text-center">
                    <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No research history yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Run an analysis to get started</p>
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </PageShell>
    </>
  );
}
