import type {
  EscritaSynopsis,
  RoteiroReferenceImage,
  StepId,
  StepOutput,
} from "@/types/roteiro";

/**
 * Quando o Escrita roda em modo 2-em-2, cada request descreve qual par de
 * capítulos a IA deve gerar e em qual Parte está. Outros agentes ignoram.
 */
export interface AgentBatchContext {
  part: "Parte 1" | "Parte 2";
  /** Números absolutos dos capítulos a gerar — 1 ou 2 entradas. Ex.: [3, 4]. */
  chapters: number[];
  /** Quantidade total de capítulos da Parte (pra orientar o agente). */
  totalInPart: number;
  /** Índice 1-based deste batch dentro da rodada inteira. */
  batchIndex: number;
  /** Total de batches que serão disparados nessa rodada (Parte 1 + Parte 2). */
  totalBatches: number;
}

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
  /** Modo 2-em-2 do Escrita — só presente quando o frontend está iterando. */
  batch?: AgentBatchContext;
  /** Sinopses dos capítulos já gerados em batches anteriores (continuidade). */
  previousSynopses?: EscritaSynopsis[];
  /**
   * Fase do agente Premissa. "resumo" pede só o Bloco 0 (dois resumos longos);
   * "estrutura" pede Blocos 1-8 com o resumo já aprovado em `approvedResumo`.
   * Outros agentes ignoram.
   */
  premissaPhase?: "resumo" | "estrutura";
  /** Resumo (Bloco 0) já aprovado pelo usuário — usado na fase "estrutura". */
  approvedResumo?: string;
}

export interface Agent {
  id: StepId;
  label: string;
  description: string;
  model: string;
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
