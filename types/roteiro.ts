export type StepId =
  | "premissa"
  | "estrutura1"
  | "estrutura2"
  | "escrita"
  | "revisor";

export const STEP_ORDER: StepId[] = [
  "premissa",
  "estrutura1",
  "estrutura2",
  "escrita",
  "revisor",
];

export const STEP_LABELS: Record<StepId, string> = {
  premissa: "Premissa",
  estrutura1: "Estrutura — Parte 1",
  estrutura2: "Estrutura — Parte 2",
  escrita: "Escrita",
  revisor: "Revisor",
};

export interface EscritaChapter {
  /** Número do capítulo (1, 2, 3...). */
  number: number;
  /** "Parte 1" | "Parte 2" ou livre. */
  part?: string;
  /** Título do capítulo. */
  title?: string;
  /** Texto narrativo limpo do capítulo. */
  content: string;
  /** Cliffhanger extraído da memória viva final, se disponível. */
  cliffhanger?: string;
  /** Contagem de palavras do capítulo, se extraída da memória viva final. */
  wordCount?: number;
  /** Timestamp de geração. */
  generatedAt: string;
  /** Se foi editado manualmente depois. */
  edited?: boolean;
  /** Timestamp da última edição. */
  editedAt?: string;
}

/** Grau de severidade de um erro apontado pelo Revisor. */
export type RevisorErrorGravity = "atencao" | "interfere" | "gravissimo";

/**
 * Um erro estruturado emitido pelo Revisor (bloco <erros_detalhados>).
 * Cada erro tem trecho_original / trecho_corrigido literais — a UI usa
 * essa info pra fazer find+replace direto no roteiro da Escrita quando
 * a roteirista marca o checkbox e clica em "Aplicar correções".
 */
export interface RevisorError {
  /** ID estável (numero + sufixo, ex: "1", "3a"). */
  id: string;
  /** Numeração que casa com "PRINCIPAIS ERROS" (ex: "1", "3a"). */
  numero: string;
  gravidade: RevisorErrorGravity;
  /** Capítulo onde o erro foi encontrado, se aplicável. */
  capitulo?: number;
  /** Linha curta resumindo o erro. */
  titulo: string;
  /** Trecho exato do roteiro a substituir — literal, fiel ao original. */
  trechoOriginal: string;
  /** Versão corrigida — substitui o trecho original 1:1. */
  trechoCorrigido: string;
  /** Justificativa da mudança (1-3 frases). */
  porqueAlterado: string;
  /** Marcado como aplicado no roteiro (find+replace já rodou com sucesso). */
  applied?: boolean;
  /** Timestamp de quando foi aplicado. */
  appliedAt?: string;
}

/**
 * Sinopse curta de um capítulo gerado em batch — vira contexto pro próximo
 * batch (continuidade) e ponte Parte 1 → Parte 2.
 */
export interface EscritaSynopsis {
  number: number;
  part: "Parte 1" | "Parte 2";
  synopsis: string;
}

export interface StepOutputMetadata {
  /** [Legacy all-at-once] Relatório de auto-revisão. */
  report?: string;
  /** [Legacy all-at-once] Memória Viva em JSON (string). */
  memory?: string;
  /** [Legacy all-at-once] Detalhes da validação bloqueante (texto livre). */
  validation?: string;
  /** [Legacy all-at-once] Status resumido da validação. */
  validationStatus?: "APROVADO" | "BLOQUEADO";
  /** Capítulos do roteiro Escrita (formato 2-em-2 vai acumulando aqui). */
  chapters?: EscritaChapter[];
  /** Erros estruturados parseados do bloco <erros_detalhados> do Revisor. */
  errors?: RevisorError[];
  /** Sinopses por capítulo do fluxo 2-em-2 (continuidade entre batches). */
  synopses?: EscritaSynopsis[];
}

export interface StepOutput {
  /** Conteúdo principal — limpo, editável, alimenta os próximos steps. */
  content: string;
  /** Metadados auxiliares (relatório/memória/validação). Não vão adiante. */
  metadata?: StepOutputMetadata;
  generatedAt?: string;
  editedAt?: string;
  edited?: boolean;
}

/** Snapshot de uma geração anterior, salva no histórico de cada step. */
export interface StepGenerationSnapshot {
  /** ID único do snapshot. */
  id: string;
  /** Quando foi gerado/salvo. */
  savedAt: string;
  /** Conteúdo principal capturado. */
  content: string;
  /** Metadata associado (relatório, memória, validação, capítulos da Escrita). */
  metadata?: StepOutputMetadata;
  /** Se foi editado manualmente antes de virar histórico. */
  edited?: boolean;
  /** Quando foi editado pela última vez. */
  editedAt?: string;
  /** Quando foi gerado originalmente. */
  generatedAt?: string;
  /** Rótulo opcional ("v1", "antes da revisão", etc) — gerado automaticamente. */
  label?: string;
}

/**
 * Imagem de referência visual anexada à premissa. O agente Estrutura 1
 * recebe essa imagem como input multimodal pra ajudar a montar a
 * estrutura conforme o estilo/mood/personagens da imagem.
 */
export interface RoteiroReferenceImage {
  /** Data URL completa: "data:image/jpeg;base64,..." */
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  filename: string;
  /** Tamanho em bytes do arquivo original (pre-base64). */
  size: number;
  uploadedAt: string;
}

export interface Roteiro {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentStep: StepId;
  outputs: Partial<Record<StepId, StepOutput>>;
  userInput?: string;
  /** Imagem opcional de referência visual pra Estrutura 1. */
  referenceImage?: RoteiroReferenceImage;
  /** Histórico de gerações por step. Cada step tem sua própria pilha de snapshots. */
  history?: Partial<Record<StepId, StepGenerationSnapshot[]>>;
}

export function nextStep(step: StepId): StepId | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1 || idx === STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1];
}

export function prevStep(step: StepId): StepId | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx <= 0) return null;
  return STEP_ORDER[idx - 1];
}
