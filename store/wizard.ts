import { create } from "zustand";
import type {
  EscritaChapter,
  Roteiro,
  RoteiroReferenceImage,
  StepGenerationSnapshot,
  StepId,
  StepOutput,
} from "@/types/roteiro";
import { STEP_ORDER } from "@/types/roteiro";
import { saveRoteiro } from "@/lib/storage";
import { applyCorrections } from "@/lib/parse-revisor-output";

interface WizardState {
  roteiro: Roteiro | null;
  isGenerating: boolean;
  autoAdvance: boolean;
  setRoteiro: (r: Roteiro) => void;
  setCurrentStep: (step: StepId) => void;
  setOutput: (step: StepId, output: StepOutput) => void;
  updateOutputContent: (step: StepId, content: string) => void;
  setUserInput: (input: string) => void;
  setReferenceImage: (image: RoteiroReferenceImage | null) => void;
  setTitle: (title: string) => void;
  setIsGenerating: (v: boolean) => void;
  setAutoAdvance: (v: boolean) => void;
  /** Salva o output atual do step no histórico (se houver conteúdo). */
  pushOutputToHistory: (step: StepId, customLabel?: string) => void;
  /** Restaura uma versão do histórico para o output atual.
   * O output atual (se existir) vai pro histórico antes da troca. */
  restoreFromHistory: (step: StepId, snapshotId: string) => void;
  /** Remove um snapshot do histórico. */
  deleteFromHistory: (step: StepId, snapshotId: string) => void;
  /**
   * Aplica correções do Revisor (find+replace literal) no output da Escrita.
   * Recebe IDs dos erros marcados — busca em metadata.errors do revisor,
   * pega trecho_original / trecho_corrigido e substitui no output.escrita.
   * Atualiza chapter.content também quando o erro tiver capítulo. Marca
   * cada erro aplicado em metadata.errors[].applied=true.
   *
   * Devolve { applied: ids[], failed: ids[] } pra UI exibir feedback.
   */
  applyRevisorCorrections: (errorIds: string[]) => {
    applied: string[];
    failed: string[];
  };
  reset: () => void;
}

function persist(r: Roteiro): Roteiro {
  saveRoteiro(r);
  return r;
}

function makeSnapshotId(): string {
  return `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function snapshotFromOutput(
  output: StepOutput,
  customLabel?: string,
): StepGenerationSnapshot {
  return {
    id: makeSnapshotId(),
    savedAt: new Date().toISOString(),
    content: output.content,
    metadata: output.metadata,
    edited: output.edited,
    editedAt: output.editedAt,
    generatedAt: output.generatedAt,
    label: customLabel,
  };
}

export const useWizard = create<WizardState>((set, get) => ({
  roteiro: null,
  isGenerating: false,
  autoAdvance: false,

  setRoteiro: (r) => set({ roteiro: r }),

  setCurrentStep: (step) =>
    set((s) => {
      if (!s.roteiro) return s;
      return { roteiro: persist({ ...s.roteiro, currentStep: step }) };
    }),

  setOutput: (step, output) =>
    set((s) => {
      if (!s.roteiro) return s;
      return {
        roteiro: persist({
          ...s.roteiro,
          outputs: { ...s.roteiro.outputs, [step]: output },
        }),
      };
    }),

  updateOutputContent: (step, content) =>
    set((s) => {
      if (!s.roteiro) return s;
      const current = s.roteiro.outputs[step];
      const output: StepOutput = {
        content,
        metadata: current?.metadata,
        generatedAt: current?.generatedAt,
        editedAt: new Date().toISOString(),
        edited: true,
      };
      return {
        roteiro: persist({
          ...s.roteiro,
          outputs: { ...s.roteiro.outputs, [step]: output },
        }),
      };
    }),

  setUserInput: (input) =>
    set((s) => {
      if (!s.roteiro) return s;
      return { roteiro: persist({ ...s.roteiro, userInput: input }) };
    }),

  setReferenceImage: (image) =>
    set((s) => {
      if (!s.roteiro) return s;
      const next: Roteiro = { ...s.roteiro };
      if (image) {
        next.referenceImage = image;
      } else {
        delete next.referenceImage;
      }
      return { roteiro: persist(next) };
    }),

  setTitle: (title) =>
    set((s) => {
      if (!s.roteiro) return s;
      return { roteiro: persist({ ...s.roteiro, title }) };
    }),

  setIsGenerating: (v) => set({ isGenerating: v }),

  setAutoAdvance: (v) => set({ autoAdvance: v }),

  pushOutputToHistory: (step, customLabel) =>
    set((s) => {
      if (!s.roteiro) return s;
      const current = s.roteiro.outputs[step];
      // Não salva no histórico se não há conteúdo significativo.
      if (!current?.content?.trim()) return s;

      const history = { ...(s.roteiro.history ?? {}) };
      const stack = history[step] ? [...history[step]!] : [];
      stack.unshift(snapshotFromOutput(current, customLabel));
      // Limite de 20 snapshots por step para não estourar localStorage.
      if (stack.length > 20) stack.length = 20;
      history[step] = stack;

      return {
        roteiro: persist({ ...s.roteiro, history }),
      };
    }),

  restoreFromHistory: (step, snapshotId) =>
    set((s) => {
      if (!s.roteiro) return s;
      const stack = s.roteiro.history?.[step];
      if (!stack) return s;
      const snapshot = stack.find((sn) => sn.id === snapshotId);
      if (!snapshot) return s;

      // Move o output atual pro histórico antes de substituir.
      const newHistoryStack = stack.filter((sn) => sn.id !== snapshotId);
      const current = s.roteiro.outputs[step];
      if (current?.content?.trim()) {
        newHistoryStack.unshift(snapshotFromOutput(current));
      }
      if (newHistoryStack.length > 20) newHistoryStack.length = 20;

      const restoredOutput: StepOutput = {
        content: snapshot.content,
        metadata: snapshot.metadata,
        generatedAt: snapshot.generatedAt ?? snapshot.savedAt,
        edited: snapshot.edited,
        editedAt: snapshot.editedAt,
      };

      return {
        roteiro: persist({
          ...s.roteiro,
          outputs: { ...s.roteiro.outputs, [step]: restoredOutput },
          history: {
            ...(s.roteiro.history ?? {}),
            [step]: newHistoryStack,
          },
        }),
      };
    }),

  deleteFromHistory: (step, snapshotId) =>
    set((s) => {
      if (!s.roteiro) return s;
      const stack = s.roteiro.history?.[step];
      if (!stack) return s;
      const newStack = stack.filter((sn) => sn.id !== snapshotId);
      return {
        roteiro: persist({
          ...s.roteiro,
          history: { ...(s.roteiro.history ?? {}), [step]: newStack },
        }),
      };
    }),

  applyRevisorCorrections: (errorIds) => {
    const state = get();
    const roteiro = state.roteiro;
    if (!roteiro) return { applied: [], failed: errorIds };

    const revisorOutput = roteiro.outputs.revisor;
    const escritaOutput = roteiro.outputs.escrita;
    const allErrors = revisorOutput?.metadata?.errors ?? [];
    if (!escritaOutput?.content || allErrors.length === 0) {
      return { applied: [], failed: errorIds };
    }

    // Filtra os erros marcados que ainda não foram aplicados.
    const targetErrors = allErrors.filter(
      (e) => errorIds.includes(e.id) && !e.applied,
    );
    if (targetErrors.length === 0) {
      return { applied: [], failed: errorIds };
    }

    // Antes de mexer, salva snapshot da Escrita no histórico pra reversão.
    state.pushOutputToHistory("escrita", "Antes das correções do Revisor");

    // 1) Aplica no content monolítico (sempre existe).
    const monolithic = applyCorrections(escritaOutput.content, targetErrors);

    // 2) Aplica nos chapters[] também — varre todos os capítulos e tenta
    //    substituir cada trecho. Como o monolithic já anota quais aplicaram,
    //    aqui só atualizamos chapters que mudaram.
    let updatedChapters: EscritaChapter[] | undefined =
      escritaOutput.metadata?.chapters
        ? escritaOutput.metadata.chapters.map((ch) => {
            const res = applyCorrections(ch.content, targetErrors);
            if (res.appliedIds.length === 0) return ch;
            return {
              ...ch,
              content: res.text,
              edited: true,
              editedAt: new Date().toISOString(),
            };
          })
        : undefined;

    // União dos IDs aplicados: tanto os que pegaram no monolítico quanto
    // os que pegaram em algum chapter — pra não falsamente marcar fail.
    const appliedSet = new Set(monolithic.appliedIds);
    if (updatedChapters) {
      for (const ch of escritaOutput.metadata?.chapters ?? []) {
        const res = applyCorrections(ch.content, targetErrors);
        for (const id of res.appliedIds) appliedSet.add(id);
      }
    }
    const applied = targetErrors
      .filter((e) => appliedSet.has(e.id))
      .map((e) => e.id);
    const failed = targetErrors
      .filter((e) => !appliedSet.has(e.id))
      .map((e) => e.id);

    if (applied.length === 0) {
      return { applied: [], failed };
    }

    const now = new Date().toISOString();

    set((s) => {
      if (!s.roteiro) return s;

      // Atualiza output da Escrita (content + chapters + edited flags)
      const updatedEscrita: StepOutput = {
        ...s.roteiro.outputs.escrita!,
        content: monolithic.text,
        edited: true,
        editedAt: now,
        ...(updatedChapters && {
          metadata: {
            ...s.roteiro.outputs.escrita!.metadata,
            chapters: updatedChapters,
          },
        }),
      };

      // Marca os erros aplicados em metadata.errors[].applied
      const revisor = s.roteiro.outputs.revisor;
      const updatedRevisor: StepOutput | undefined = revisor
        ? {
            ...revisor,
            metadata: {
              ...revisor.metadata,
              errors: (revisor.metadata?.errors ?? []).map((e) =>
                applied.includes(e.id)
                  ? { ...e, applied: true, appliedAt: now }
                  : e,
              ),
            },
          }
        : revisor;

      return {
        roteiro: persist({
          ...s.roteiro,
          outputs: {
            ...s.roteiro.outputs,
            escrita: updatedEscrita,
            ...(updatedRevisor && { revisor: updatedRevisor }),
          },
        }),
      };
    });

    return { applied, failed };
  },

  reset: () => set({ roteiro: null, isGenerating: false, autoAdvance: false }),
}));

export { STEP_ORDER };
