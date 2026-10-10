/**
 * FLOW IMPORT — manual Bullflow ingestion.
 *
 * The $39.99 Bullflow consumer tier has no API, so instead of a live feed the
 * user pastes the alerts they see in the Bullflow app. Each line is parsed,
 * graded by the same option engine that powers the Oracle Option Pick, and only
 * B-/B-and-up contracts are pushed to the Trade Desk. Nothing is fabricated —
 * unparseable or quote-less lines come back labeled, not invented.
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface FlowIngestItem {
  raw: string;
  parsed: boolean;
  symbol?: string;
  contract?: string;
  grade?: string;
  score?: number;
  pushed: boolean;
  reason: string;
}
interface FlowIngestResult {
  items: FlowIngestItem[];
  parsedCount: number;
  gradedCount: number;
  pushedCount: number;
  minScore: number;
}

const PLACEHOLDER = `Paste Bullflow alerts (one per line), e.g.
AAPL 200C 6/20 SWEEP $1.2M ASK
NVDA 145C 6/13 @ 4.20
TSLA 350P 6/27`;

function gradeClass(grade?: string): string {
  if (!grade) return "text-muted-foreground";
  if (grade.startsWith("S") || grade.startsWith("A")) return "text-[var(--trade-bullish)]";
  if (grade.startsWith("B")) return "text-[var(--brand-cyan)]";
  if (grade.startsWith("C")) return "text-amber-400";
  return "text-rose-400";
}

/** Phase 4: `bare` renders the import tool without the outer card / collapse
 *  toggle, for embedding as a tab in Today's Picks (always expanded). */
export function FlowImport({ bare = false }: { bare?: boolean }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FlowIngestResult | null>(null);
  const [open, setOpen] = useState(bare);

  async function run() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/flow/ingest", { text });
      const data = (await res.json()) as FlowIngestResult & { success: boolean };
      setResult(data);
      if (data.pushedCount > 0) {
        queryClient.invalidateQueries({ queryKey: ["/api/trade-ideas/best-setups"] });
        toast({
          title: `${data.pushedCount} contract${data.pushedCount > 1 ? "s" : ""} pushed`,
          description: `B- and up added to the Trade Desk.`,
        });
      } else {
        toast({
          title: "Nothing pushed",
          description: `Parsed ${data.parsedCount}, none graded B- or higher.`,
        });
      }
    } catch {
      toast({ title: "Flow import failed", description: "Could not analyze the pasted alerts.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const editor = (
    <>
      <div className="mt-3 space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={4}
          className="w-full rounded-lg bg-background/60 border border-border/40 p-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--brand-cyan)]/40 resize-y"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">
            Only contracts grading B- (70+) are pushed. Live CBOE quotes only — no fabricated fills.
          </span>
          <Button size="sm" disabled={busy || !text.trim()} onClick={run}>
            {busy ? "Analyzing…" : "Analyze & Push"}
          </Button>
        </div>

        {result && (
          <div className="pt-2 border-t border-border/30 space-y-1">
            <div className="text-[10px] font-mono text-muted-foreground">
              {result.parsedCount} parsed · {result.gradedCount} graded · {result.pushedCount} pushed
            </div>
            {result.items.map((it, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                <span className={cn("w-6 shrink-0", it.pushed ? "text-[var(--trade-bullish)]" : "text-muted-foreground")}>
                  {it.pushed ? "✓" : "·"}
                </span>
                <span className="w-28 shrink-0 truncate text-foreground">
                  {it.symbol ? `${it.symbol} ${it.contract ?? ""}` : it.raw}
                </span>
                {it.grade && <span className={cn("w-8 shrink-0 font-semibold", gradeClass(it.grade))}>{it.grade}</span>}
                <span className="text-muted-foreground truncate">{it.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  if (bare) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--brand-cyan)]">Flow Import</span>
          <span className="text-[10px] font-mono text-muted-foreground">
            Paste Bullflow alerts → engine grades → B- and up hit the desk
          </span>
        </div>
        {open && editor}
      </div>
    );
  }

  return (
    <Card className="p-3 bg-card/60 border-border/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--brand-cyan)]">Flow Import</span>
          <span className="text-[10px] font-mono text-muted-foreground">
            Paste Bullflow alerts → engine grades → B- and up hit the desk
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{open ? "−" : "+"}</span>
      </button>

      {open && editor}
    </Card>
  );
}
