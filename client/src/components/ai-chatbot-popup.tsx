import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  Bot, 
  Send, 
  Loader2, 
  X, 
  MessageCircle,
  Sparkles,
  AlertTriangle,
  Minimize2,
  Zap,
  ArrowUpCircle
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { useAuth } from "@/hooks/useAuth";

interface ResearchResponse {
  response: string;
  disclaimer: string;
  timestamp: string;
  creditsRemaining?: number;
}

interface CreditBalance {
  creditsRemaining: number;
  creditsUsed: number;
  creditsAllocated: number;
  cycleEnd: string;
  tier: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function AIChatbotPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  const { data: creditBalance, refetch: refetchCredits } = useQuery<CreditBalance>({
    queryKey: ['/api/ai/credits'],
    enabled: isOpen && !!user,
    staleTime: 30000,
  });

  useEffect(() => {
    if (creditBalance) {
      setCreditsRemaining(creditBalance.creditsRemaining);
    }
  }, [creditBalance]);

  const researchMutation = useMutation({
    mutationFn: async (questionText: string) => {
      const res = await apiRequest("POST", "/api/ai/research-assistant", {
        question: questionText,
      });
      return res.json() as Promise<ResearchResponse>;
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(data.timestamp),
      }]);
      if (data.creditsRemaining !== undefined) {
        setCreditsRemaining(data.creditsRemaining);
      }
      refetchCredits();
    },
    onError: async (error: Error) => {
      const errorMessage = error.message || 'Failed to get response. Please try again.';
      const isOutOfCredits = errorMessage.includes('No AI credits');
      
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: isOutOfCredits 
          ? `You've used all your AI credits for this month. Visit the [Pricing page](/pricing) to upgrade your plan for more credits.`
          : `Error: ${errorMessage}`,
        timestamp: new Date(),
      }]);
      
      if (isOutOfCredits) {
        setCreditsRemaining(0);
      }
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (question.trim() && !researchMutation.isPending) {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: question.trim(),
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);
      researchMutation.mutate(question.trim());
      setQuestion("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const toggleOpen = () => {
    if (!isOpen) {
      setIsOpen(true);
      setIsMinimized(false);
    } else {
      setIsOpen(false);
    }
  };

  const handleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  return (
    <>
      {isOpen && (
        <div 
          className={cn(
            "fixed bottom-20 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] bg-background border border-border rounded-xl shadow-2xl flex flex-col transition-all duration-200",
            isMinimized ? "h-14" : "h-[500px] max-h-[70vh]"
          )}
          data-testid="container-ai-chatbot"
        >
          <div 
            className="flex items-center justify-between p-3 border-b bg-gradient-to-r from-sky-500/10 to-blue-500/10 rounded-t-xl"
          >
            <div className="flex items-center gap-2">
              <div className="relative">
                <Bot className="h-5 w-5 text-sky-400" />
                <Sparkles className="absolute -top-1 -right-1 h-2.5 w-2.5 text-sky-300" />
              </div>
              <span className="font-medium text-sm">Quant Edge AI</span>
              {user && creditsRemaining !== null && (
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-xs gap-1",
                    creditsRemaining <= 5 ? "border-red-500/50 text-[var(--trade-bearish)]" :
                    creditsRemaining <= 15 ? "border-amber-500/50 text-[var(--trade-neutral)]" :
                    "border-sky-500/50 text-sky-400"
                  )}
                  data-testid="badge-credits"
                >
                  <Zap className="h-3 w-3" />
                  {String(creditsRemaining)}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={handleMinimize}
                data-testid="button-chatbot-minimize"
              >
                <Minimize2 className="h-4 w-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7"
                onClick={toggleOpen}
                data-testid="button-chatbot-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {!isMinimized && (
            <>
              <ScrollArea className="flex-1 p-3" ref={scrollRef}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-6">
                    <Bot className="h-12 w-12 text-sky-400/50 mb-3" />
                    <h3 className="font-medium mb-1">How can I help you?</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Ask about trading concepts, market analysis, or research questions.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {[
                        "What is RSI?",
                        "Explain options Greeks",
                        "How to read candlesticks?"
                      ].map((suggestion) => (
                        <Button
                          key={suggestion}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            setQuestion(suggestion);
                            inputRef.current?.focus();
                          }}
                          data-testid={`button-suggestion-${suggestion.slice(0, 10)}`}
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "flex",
                          message.role === 'user' ? "justify-end" : "justify-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-lg px-3 py-2",
                            message.role === 'user' 
                              ? "bg-sky-500/20 text-foreground" 
                              : "bg-muted"
                          )}
                        >
                          {message.role === 'assistant' ? (
                            <div className="prose prose-sm prose-invert max-w-none">
                              <ReactMarkdown
                                components={{
                                  p: ({ children }) => <p className="mb-2 text-sm leading-relaxed last:mb-0">{children}</p>,
                                  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                                  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                                  li: ({ children }) => <li className="text-sm">{children}</li>,
                                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                                  code: ({ children }) => (
                                    <code className="bg-background/50 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
                                  ),
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p className="text-sm">{message.content}</p>
                          )}
                        </div>
                      </div>
                    ))}
                    {researchMutation.isPending && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                          <span className="text-sm text-muted-foreground">Thinking...</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              <div className="p-3 border-t bg-muted/30">
                {/* 70% Usage Upgrade Nudge */}
                {creditBalance && creditBalance.tier !== 'pro' && creditBalance.tier !== 'admin' && 
                  creditBalance.creditsUsed / creditBalance.creditsAllocated >= 0.7 && (
                  <a 
                    href="/pricing" 
                    className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-gradient-to-r from-sky-500/10 to-purple-500/10 border border-sky-500/20 hover:border-sky-500/40 transition-colors"
                    data-testid="link-upgrade-nudge"
                  >
                    <ArrowUpCircle className="h-4 w-4 text-sky-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-sky-300">
                        Running low on credits!
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        Upgrade for {creditBalance.tier === 'free' ? '20x' : '2.5x'} more AI queries
                      </p>
                    </div>
                  </a>
                )}
                <div className="flex items-center gap-1 mb-2 text-xs text-[var(--trade-neutral)]/80">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Educational only. Not financial advice.</span>
                </div>
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <Input
                    ref={inputRef}
                    placeholder="Ask a question..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={researchMutation.isPending}
                    className="flex-1 h-9"
                    data-testid="input-chatbot-question"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="h-9 w-9 bg-sky-500 hover:bg-sky-600"
                    disabled={!question.trim() || researchMutation.isPending}
                    data-testid="button-chatbot-send"
                  >
                    {researchMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      )}

      <Button
        onClick={toggleOpen}
        className={cn(
          "fixed bottom-4 right-4 z-50 h-14 w-14 rounded-full shadow-lg",
          "bg-gradient-to-br from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500",
          "transition-all duration-200",
          isOpen && "scale-0 opacity-0"
        )}
        data-testid="button-chatbot-open"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>
    </>
  );
}
