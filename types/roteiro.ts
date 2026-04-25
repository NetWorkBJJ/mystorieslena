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

export interface StepOutputMetadata {
  /** Relatório de auto-revisão. */
  report?: string;
  /** Memória Viva em JSON (string). */
  memory?: string;
  /** Detalhes da validação bloqueante (texto livre). */
  validation?: string;
  /** Status resumido da validação. */
  validationStatus?: "APROVADO" | "BLOQUEADO";
  /** Capítulos extraídos do roteiro completo (Escrita all-at-once). */
  chapters?: EscritaChapter[];
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

export interface Roteiro {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentStep: StepId;
  outputs: Partial<Record<StepId, StepOutput>>;
  userInput?: string;
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
