import type { RoteiroReferenceImage, StepId, StepOutput } from "@/types/roteiro";

export interface AgentContext {
  previousOutputs: Partial<Record<StepId, StepOutput>>;
  userInput?: string;
  /** Imagem de referência opcional anexada na Premissa. */
  referenceImage?: RoteiroReferenceImage;
  /**
   * Modo correção: a roteirista NÃO quer regenerar do zero, só aplicar uma
   * correção pontual em cima da versão atual. Quando true, o agente recebe
   * `currentOutput` (a versão atual desse step) e o `userInput` vira a
   * instrução de correção.
   */
  refineMode?: boolean;
  /** Versão atual do output desse step — usada como base no modo correção. */
  currentOutput?: string;
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
