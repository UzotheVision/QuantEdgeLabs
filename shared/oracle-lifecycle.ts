/**
 * Oracle lifecycle is deliberately separate from a setup's direction or score.
 * A thesis can be good without being entered; only an observed trigger or a
 * paper/broker fill is allowed to produce performance outcomes.
 */

export type OracleLifecycleState =
  | "coverage"
  | "thesis"
  | "pending_trigger"
  | "triggered"
  | "executed"
  | "closed";

export interface OracleExecutionAudit {
  version: 1;
  state: OracleLifecycleState;
  triggerType?: "breakout" | "breakdown" | "reclaim" | "pullback" | "market" | "manual";
  triggerPrice?: number;
  triggerObservedAt?: string;
  triggerObservedPrice?: number;
  executionRecordedAt?: string;
  executionPrice?: number;
  executionVenue?: "paper" | "broker" | "manual";
  paperPositionId?: string;
}

type AnalysisWithLifecycle = {
  executionAudit?: OracleExecutionAudit;
  [key: string]: unknown;
};

export function readOracleExecutionAudit(value: unknown): OracleExecutionAudit | null {
  if (!value || typeof value !== "object") return null;
  const audit = (value as AnalysisWithLifecycle).executionAudit;
  if (!audit || audit.version !== 1 || !audit.state) return null;
  return audit;
}

export function isOutcomeEligible(value: unknown): boolean {
  const audit = readOracleExecutionAudit(value);
  return audit?.state === "triggered" || audit?.state === "executed" || audit?.state === "closed";
}

export function withOracleExecutionAudit(
  value: unknown,
  audit: OracleExecutionAudit,
): AnalysisWithLifecycle {
  const analysis = value && typeof value === "object" ? value as AnalysisWithLifecycle : {};
  return { ...analysis, executionAudit: audit };
}

export function recordPaperExecution(
  value: unknown,
  args: { price: number; at: string; paperPositionId?: string },
): AnalysisWithLifecycle {
  const previous = readOracleExecutionAudit(value);
  return withOracleExecutionAudit(value, {
    version: 1,
    state: "executed",
    triggerType: previous?.triggerType ?? "manual",
    triggerPrice: previous?.triggerPrice,
    triggerObservedAt: previous?.triggerObservedAt ?? args.at,
    triggerObservedPrice: previous?.triggerObservedPrice ?? args.price,
    executionRecordedAt: args.at,
    executionPrice: args.price,
    executionVenue: "paper",
    paperPositionId: args.paperPositionId,
  });
}
