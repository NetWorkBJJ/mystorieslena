import type { RoteiroReferenceImage, StepId, StepOutput } from "@/types/roteiro";

export interface AgentContext {
  previousOutputs: Partial<Record<StepId, StepOutput>>;
  userInput?: string;
  /** Imagem de referência opcional anexada na Premissa. */
  referenceImage?: RoteiroReferenceImage;
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
  /**
   * Quando true, o agente recebe a imagem de referência (Premissa) como
   * input multimodal junto com o userMessage. Modelo precisa ser
   * vision-capable (Opus, Sonnet recentes).
   */
  acceptsReferenceImage?: boolean;
}
