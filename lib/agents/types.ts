import type { StepId, StepOutput } from "@/types/roteiro";

export interface AgentContext {
  previousOutputs: Partial<Record<StepId, StepOutput>>;
  userInput?: string;
}

export interface Agent {
  id: StepId;
  label: string;
  description: string;
  model: string;
  /** Fallback model se o primário falhar (ex: 'haiku'). */
  fallbackModel?: string;
  systemPrompt: string;
  buildUserMessage: (ctx: AgentContext) => string;
  maxTokens: number;
  temperature?: number;
  /**
   * Thinking mode. Default: 'disabled' (mais rápido).
   * Use 'adaptive' só se o agente precisar de raciocínio pesado.
   */
  thinking?: "disabled" | "adaptive";
  /** Effort level. Default: 'low' (mais rápido). */
  effort?: "low" | "medium" | "high";
  /** if true, shows a warning that the prompt is still a placeholder */
  placeholder?: boolean;
}
