import { create } from "zustand";
import type {
  Roteiro,
  RoteiroReferenceImage,
  StepGenerationSnapshot,
  StepId,
  StepOutput,
} from "@/types/roteiro";
import { STEP_ORDER } from "@/types/roteiro";
import { saveRoteiro } from "@/lib/storage";

interface WizardState {
  roteiro: Roteiro | null;
  isGenerating: boolean;
  autoAdvance: boolean;
  fastMode: boolean;
  setRoteiro: (r: Roteiro) => void;
  setCurrentStep: (step: StepId) => void;
  setOutput: (step: StepId, output: StepOutput) => void;
  updateOutputContent: (step: StepId, content: string) => void;
  setUserInput: (input: string) => void;
  setReferenceImage: (image: RoteiroReferenceImage | null) => void;
  setTitle: (title: string) => void;
  setIsGenerating: (v: boolean) => void;
  setAutoAdvance: (v: boolean) => void;
  setFastMode: (v: boolean) => void;
  /** Salva o output atual do step no histórico (se houver conteúdo). */
  pushOutputToHistory: (step: StepId, customLabel?: string) => void;
  /** Restaura uma versão do histórico para o output atual.
   * O output atual (se existir) vai pro histórico antes da troca. */
  restoreFromHistory: (step: StepId, snapshotId: string) => void;
  /** Remove um snapshot do histórico. */
  deleteFromHistory: (step: StepId, snapshotId: string) => void;
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

export const useWizard = create<WizardState>((set) => ({
  roteiro: null,
  isGenerating: false,
  autoAdvance: false,
  fastMode: false,

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

  setFastMode: (v) => set({ fastMode: v }),

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

  reset: () => set({ roteiro: null, isGenerating: false, autoAdvance: false }),
}));

export { STEP_ORDER };
