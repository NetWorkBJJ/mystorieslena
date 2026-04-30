"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  SkipForward,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import {
  STEP_LABELS,
  STEP_ORDER,
  nextStep,
  prevStep,
  type EscritaChapter,
  type EscritaSynopsis,
  type StepId,
  type StepOutput,
} from "@/types/roteiro";
import { useWizard } from "@/store/wizard";
import { AGENTS } from "@/lib/agents";
import {
  filterMemoryBlockForDisplay,
  parseEscritaChaptersDirect,
} from "@/lib/parse-escrita-output";
import {
  countMarkdownErrorNumbers,
  hashEscritaContent,
  parseMarkdownErrorList,
  parseRevisorErrors,
  serializeRevisorErrors,
  stripErrosDetalhados,
} from "@/lib/parse-revisor-output";
import {
  applyCorrectionPatches,
  parseCorrectionPatches,
} from "@/lib/parse-correction-patches";
import { RevisorErrorsView } from "@/components/wizard/RevisorErrorsView";
import {
  countChaptersInEstrutura,
  planBatches,
} from "@/lib/parse-estrutura-chapters";
import { parseEscritaBatch } from "@/lib/parse-escrita-batch";
import {
  extractChapterTargets,
  isWithinTarget,
  partTotalRange,
} from "@/lib/parse-estrutura-targets";
import { MemoryVivaCard } from "@/components/wizard/MemoryVivaCard";
import { WordCountBadge } from "@/components/wizard/WordCountBadge";
// countWords sempre da lib canônica — mesmo contador que a UI usa pra
// exibir os totais. Ver CLAUDE.md seção "Contagem de palavras".
import { countWords } from "@/lib/word-count";
import { HistoryPanel } from "@/components/wizard/HistoryPanel";
import { DownloadEscritaButton } from "@/components/wizard/DownloadEscritaButton";
import { CopyPartButton } from "@/components/wizard/CopyPartButton";
import { ReferenceImageUpload } from "@/components/wizard/ReferenceImageUpload";
import { Prose } from "@/components/ui/prose";
import { cn } from "@/lib/utils";

type WizardProgress =
  | {
      kind: "writing";
      batchIndex: number;
      totalBatches: number;
      part: "Parte 1" | "Parte 2";
      chapters: number[];
    }
  | {
      kind: "preparing";
      chaptersCount: number;
    }
  | {
      kind: "extending-chapter";
      chapterNumber: number;
      part: "Parte 1" | "Parte 2";
      currentWords: number;
      targetWords: number;
      direction: "expand" | "shrink";
    }
  | {
      kind: "balancing-part";
      part: "Parte 1" | "Parte 2";
      partTotal: number;
      targetTotal: number;
      direction: "expand" | "shrink";
    }
  | {
      kind: "revising";
      chaptersCount: number;
    };

const PART_BANNER = (part: string) =>
  `═══════════════════════════════════════\n${part.toUpperCase()}\n═══════════════════════════════════════`;

/**
 * Parser leve do output do revisor gramatical: extrai capítulos pela
 * mesma regex do batch normal. Cada cap volta SEM `part` — o caller
 * (que tem a lista original) faz o merge por número.
 */
function parseRevisedChapters(
  raw: string,
): Array<{ number: number; title?: string; content: string }> {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  type Hit = { number: number; title?: string; index: number; headerEnd: number };
  const hits: Hit[] = [];
  const titledRe = /^#{1,4}\s*Cap[ií]tulo\s+(\d+)\s*(?:—|–|-)\s*(.+?)\s*$/gim;
  const noTitleRe = /^#{1,4}\s*Cap[ií]tulo\s+(\d+)\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = titledRe.exec(trimmed)) !== null) {
    hits.push({
      number: parseInt(m[1]!, 10),
      title: m[2]!.trim(),
      index: m.index,
      headerEnd: m.index + m[0].length,
    });
  }
  while ((m = noTitleRe.exec(trimmed)) !== null) {
    if (hits.some((h) => h.index === m!.index)) continue;
    hits.push({
      number: parseInt(m[1]!, 10),
      index: m.index,
      headerEnd: m.index + m[0].length,
    });
  }
  hits.sort((a, b) => a.index - b.index);
  const result: Array<{ number: number; title?: string; content: string }> = [];
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]!;
    const nextStart = i + 1 < hits.length ? hits[i + 1]!.index : trimmed.length;
    result.push({
      number: cur.number,
      title: cur.title,
      content: trimmed.slice(cur.headerEnd, nextStart).trim(),
    });
  }
  return result;
}

// Contador de palavras: SEMPRE `countWords` de @/lib/word-count.
// Importado acima. NUNCA criar outro contador local — split(/\s+/) ingênuo
// conta diferente porque não trata `—`, `–`, `-` (separadores em diálogo).
// Toda divergência entre o contador do backend e o da UI vira bug de
// fix-wordcount/balance pedindo expansão errada.

function concatenateChapters(chapters: EscritaChapter[]): string {
  const blocks: string[] = [];
  let currentPart: string | undefined;
  for (const c of chapters) {
    if (c.part && c.part !== currentPart) {
      blocks.push(PART_BANNER(c.part));
      currentPart = c.part;
    }
    const header = c.title
      ? `# Capítulo ${c.number} — ${c.title}`
      : `# Capítulo ${c.number}`;
    blocks.push(`${header}\n\n${c.content.trim()}`);
  }
  return blocks.join("\n\n");
}

interface Props {
  step: StepId;
}

export function StepShell({ step }: Props) {
  const roteiro = useWizard((s) => s.roteiro);
  const isGenerating = useWizard((s) => s.isGenerating);
  const autoAdvance = useWizard((s) => s.autoAdvance);
  const setAutoAdvance = useWizard((s) => s.setAutoAdvance);
  const skipCalibration = useWizard((s) => s.skipCalibration);
  const setSkipCalibration = useWizard((s) => s.setSkipCalibration);
  const setIsGenerating = useWizard((s) => s.setIsGenerating);
  const setOutput = useWizard((s) => s.setOutput);
  const updateOutputContent = useWizard((s) => s.updateOutputContent);
  const setUserInput = useWizard((s) => s.setUserInput);
  const setCurrentStep = useWizard((s) => s.setCurrentStep);
  const pushOutputToHistory = useWizard((s) => s.pushOutputToHistory);

  const agent = AGENTS[step];
  const output = roteiro?.outputs[step];
  const idx = STEP_ORDER.indexOf(step);
  const prev = prevStep(step);
  const next = nextStep(step);

  const [draft, setDraft] = useState(output?.content ?? "");
  const [liveStream, setLiveStream] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<WizardProgress | null>(
    null,
  );
  // Input/correção salvo desse step específico — input de outro step NÃO
  // vaza pra cá. Roteiros antigos (campo legado `userInput` único, global
  // pro roteiro) começam com input vazio em todos os steps; o legado é
  // ignorado pra evitar exatamente o problema de "o texto aparece em todos
  // os steps".
  const savedStepInput = roteiro?.userInputs?.[step] ?? "";
  // Limpa progresso local quando o usuário troca de step. Sem isso, um
  // batchProgress da Escrita (kind:"writing") fica visível no Revisor se
  // o usuário navegar durante uma geração — a UI mostraria "Par X de Y"
  // dentro do step Revisor, dando a falsa impressão de que a extensão
  // está rodando junto com a Escrita.
  useEffect(() => {
    setBatchProgress(null);
    setLiveStream("");
  }, [step]);
  const abortRef = useRef<AbortController | null>(null);

  const previousOutputsSummary = useMemo(() => {
    if (!roteiro) return [];
    return STEP_ORDER.slice(0, idx).map((s) => ({
      id: s,
      label: STEP_LABELS[s],
      content: roteiro.outputs[s]?.content ?? "",
    }));
  }, [roteiro, idx]);

  const hasContent = !!output?.content;
  const hasMetadata = !!(
    output?.metadata?.report ||
    output?.metadata?.memory ||
    output?.metadata?.validation
  );
  const validationStatus = output?.metadata?.validationStatus;

  const chapters = output?.metadata?.chapters ?? [];
  const chapterCount = chapters.length;
  const generateLabel = useMemo(() => {
    if (step === "escrita")
      return hasContent ? "Gerar roteiro novamente" : "Gerar roteiro completo";
    return hasContent ? "Gerar novamente" : "Gerar";
  }, [step, hasContent]);

  const historyStack = roteiro?.history?.[step] ?? [];

  // Faixa-alvo de palavras por step pro WordCountBadge
  const wordCountTarget = useMemo<{
    min?: number;
    max?: number;
    label?: string;
  }>(() => {
    if (step === "escrita") {
      // Total prompt mestre: P1 (11.300-11.700) + P2 (13.000-13.500) = 24.300-25.200
      return { min: 24300, max: 25200, label: "Total" };
    }
    return {};
  }, [step]);

  const generate = useCallback(async (
    mode: "regenerate" | "refine" = "regenerate",
    userInputOverride?: string,
  ) => {
    if (!roteiro) return;

    // userInput pode vir do store OU de um override (caso o caller acabou
    // de comitar via setUserInput e ainda não viu o re-render do Zustand —
    // ex.: botão "Aplicar correção" da caixa, que comita+dispara num clique).
    // Lê só o input desse step específico — input de outro step NÃO vaza
    // pra essa chamada.
    const effectiveUserInput =
      (userInputOverride ?? roteiro.userInputs?.[step] ?? "").trim();

    // Modo correção precisa de output existente + instrução escrita.
    if (mode === "refine") {
      if (!output?.content?.trim() || !effectiveUserInput) return;
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Antes de gerar, salva o output atual no histórico (incluindo Escrita
    // 2-em-2 — a versão anterior é preservada). Em modo correção também
    // salvamos pra que a roteirista possa voltar pra versão antes da correção.
    const baseContent = output?.content?.trim() ?? "";
    if (baseContent) {
      pushOutputToHistory(
        step,
        mode === "refine" ? "Antes da correção" : undefined,
      );
    }

    // Pra correção pontual da Escrita, o agente devolve APENAS os capítulos
    // que mudaram — precisamos dos existentes pra fazer merge depois.
    const previousChapters: EscritaChapter[] =
      output?.metadata?.chapters ? [...output.metadata.chapters] : [];
    const previousSynopsesAll: EscritaSynopsis[] =
      output?.metadata?.synopses ? [...output.metadata.synopses] : [];

    setIsGenerating(true);
    setLiveStream("");
    setBatchProgress(null);
    const startedAt = new Date().toISOString();

    // Em correção pontual (qualquer step), NÃO zere o output corrente:
    //  - Escrita: a resposta é parcial (só os caps corrigidos) — o resto
    //    do roteiro precisa continuar exibido durante a chamada.
    //  - Estrutura 1/2 e Revisor: a resposta é só patches <alteracao> que
    //    o frontend aplica no output atual via find+replace literal.
    // O stream parcial vai pra liveStream (área secundária) e só a
    // finalização toca no output de fato (merge da Escrita ou apply dos
    // patches dos demais).
    const isRefine = mode === "refine";
    const isEscritaRefine = step === "escrita" && isRefine;
    if (!isRefine) {
      setDraft("");
      setOutput(step, { content: "", generatedAt: startedAt });
    }

    // ─── Branch Escrita: loop 2-em-2 (sem fix-wordcount nem revisor) ────
    // Calibração de palavras e revisão gramatical/estrutural acontecem no
    // step Revisor — aqui só geramos os capítulos.
    //
    // Em modo correção, pulamos o loop 2-em-2 e caímos no branch padrão
    // (1 chamada com refineMode: true). O agente da Escrita devolve o
    // roteiro inteiro corrigido em uma única passada.
    if (step === "escrita" && mode !== "refine") {
      const estrutura1 = roteiro.outputs.estrutura1?.content;
      const estrutura2 = roteiro.outputs.estrutura2?.content;
      const totalP1 = countChaptersInEstrutura(estrutura1);
      const totalP2 = countChaptersInEstrutura(estrutura2);

      if (totalP1 === 0 || totalP2 === 0) {
        setOutput(step, {
          content: `[ERRO] As Estruturas das Partes 1 e 2 precisam ter capítulos detectáveis (cabeçalhos como "# Capítulo 1 — Título"). Detectei Parte 1 = ${totalP1} capítulos, Parte 2 = ${totalP2} capítulos. Volte aos Steps 2 e 3 e regenere.`,
          generatedAt: startedAt,
        });
        setIsGenerating(false);
        return;
      }

      // planBatches ainda usa targets pra dar contexto ao agente, mas a UI
      // não mais checa programaticamente o output — a calibração é feita
      // pelo step Revisor.
      const targetsP1Raw = extractChapterTargets(estrutura1);
      const targetsP2Raw = extractChapterTargets(estrutura2);
      const targetsP1 = Array.from({ length: totalP1 }, (_, i) =>
        targetsP1Raw.find((t) => t.number === i + 1)?.target ??
        Math.round(11500 / totalP1),
      );
      const targetsP2 = Array.from({ length: totalP2 }, (_, i) =>
        targetsP2Raw.find((t) => t.number === i + 1)?.target ??
        Math.round(13250 / totalP2),
      );

      const plan = planBatches(totalP1, totalP2, targetsP1, targetsP2);
      const accChapters: EscritaChapter[] = [];
      const accSynopses: EscritaSynopsis[] = [];

      // ─── helpers locais ──────────────────────────────────────────────
      const readStreamFully = async (res: Response): Promise<string> => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setLiveStream(acc);
        }
        return acc;
      };

      const persist = () => {
        const newContent = concatenateChapters(accChapters);
        setOutput(step, {
          content: newContent,
          metadata: {
            chapters: [...accChapters],
            synopses: [...accSynopses],
          },
          generatedAt: startedAt,
        });
        setDraft(newContent);
      };

      const failBatch = async (msg: string, batchIdx: number) => {
        const errContent =
          accChapters.length > 0
            ? `${concatenateChapters(accChapters)}\n\n[ERRO no Par ${batchIdx} de ${plan.length}] ${msg}`
            : `[ERRO no Par ${batchIdx} de ${plan.length}] ${msg}`;
        setOutput(step, {
          content: errContent,
          metadata: { chapters: accChapters, synopses: accSynopses },
          generatedAt: startedAt,
        });
      };

      try {
        // ═══ Loop 2-em-2: gera batches e acumula ════════════════════════
        for (const b of plan) {
          if (ctrl.signal.aborted) break;
          setBatchProgress({
            kind: "writing",
            batchIndex: b.batchIndex,
            totalBatches: plan.length,
            part: b.part,
            chapters: b.chapters,
          });
          setLiveStream("");

          const res = await fetch(`/api/agent/${step}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              previousOutputs: roteiro.outputs,
              userInput: effectiveUserInput,
              referenceImage: roteiro.referenceImage,
              batch: {
                part: b.part,
                chapters: b.chapters,
                totalInPart: b.totalInPart,
                batchIndex: b.batchIndex,
                totalBatches: plan.length,
              },
              previousSynopses: accSynopses,
            }),
            signal: ctrl.signal,
          });

          if (!res.ok || !res.body) {
            await failBatch(
              (await res.text()) || res.statusText,
              b.batchIndex,
            );
            setIsGenerating(false);
            setBatchProgress(null);
            return;
          }

          const acc = await readStreamFully(res);
          if (ctrl.signal.aborted) break;

          const parsed = parseEscritaBatch(acc, b.part);

          // Sanity check: se o parser caiu no fallback (cap número 0)
          // significa que o modelo não devolveu cabeçalho `## Capítulo N`.
          // Não tem sentido tentar fix-wordcount em cima disso. Para o
          // loop com erro claro pra a roteirista regenerar.
          const fallbackOnly = parsed.chapters.every((c) => c.number === 0);
          if (fallbackOnly && parsed.chapters.length > 0) {
            await failBatch(
              `O modelo não seguiu o formato esperado (sem cabeçalhos "## Capítulo N — Título"). Tente regenerar o batch.`,
              b.batchIndex,
            );
            setIsGenerating(false);
            setBatchProgress(null);
            return;
          }

          if (ctrl.signal.aborted) break;

          accChapters.push(...parsed.chapters);
          accSynopses.push(...parsed.synopses);
          persist();
        }

        if (ctrl.signal.aborted) {
          setLiveStream("");
          setBatchProgress(null);
          setIsGenerating(false);
          return;
        }

        setLiveStream("");
        setBatchProgress(null);
        setIsGenerating(false);

        if (autoAdvance && next && !ctrl.signal.aborted) {
          setCurrentStep(next);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error(err);
        }
        setIsGenerating(false);
        setBatchProgress(null);
      }
      return;
    }

    // ─── Branch Revisor: pré-fase de extensão + revisão XML ─────────────
    // Etapas:
    //   1) Lê os capítulos da Escrita e re-extrai targets das estruturas.
    //   2) Para cada cap fora do alvo (±3%), dispara fix-wordcount e atualiza
    //      o output da Escrita imediatamente.
    //   3) Para cada Parte, checa total e dispara balance compensatório se
    //      fora de partTotalRange.
    //   4) Tira escritaSnapshotHash do roteiro já calibrado.
    //   5) Roda /api/agent/revisor (XML estruturado) e parseia erros + fallback.
    //
    // Em modo correção, pulamos a pré-fase de extensão/balance e caímos no
    // branch padrão (1 chamada com refineMode: true). O agente do Revisor
    // devolve a revisão completa atualizada com apenas a correção pedida.
    if (step === "revisor" && mode !== "refine") {
      const escritaOutput = roteiro.outputs.escrita;
      const accChapters: EscritaChapter[] = escritaOutput?.metadata?.chapters
        ? [...escritaOutput.metadata.chapters]
        : [];
      const accSynopses: EscritaSynopsis[] =
        escritaOutput?.metadata?.synopses ?? [];

      if (accChapters.length === 0) {
        setOutput(step, {
          content: `[ERRO] O Step 4 (Escrita) ainda não tem capítulos parseados — gere o roteiro completo antes de revisar.`,
          generatedAt: startedAt,
        });
        setIsGenerating(false);
        return;
      }

      // Feedback visual imediato — sem isso a UI mostra "Clique em Gerar"
      // enquanto a pré-fase decide qual cap (se algum) precisa estender.
      setBatchProgress({
        kind: "preparing",
        chaptersCount: accChapters.length,
      });
      setLiveStream("");

      // Snapshot da Escrita no histórico antes da extensão re-escrever caps.
      pushOutputToHistory("escrita", "Antes da extensão pelo Revisor");

      const estrutura1 = roteiro.outputs.estrutura1?.content;
      const estrutura2 = roteiro.outputs.estrutura2?.content;
      const targetsP1Raw = extractChapterTargets(estrutura1);
      const targetsP2Raw = extractChapterTargets(estrutura2);

      const persistEscrita = () => {
        setOutput("escrita", {
          content: concatenateChapters(accChapters),
          metadata: {
            chapters: [...accChapters],
            synopses: [...accSynopses],
          },
          generatedAt: escritaOutput?.generatedAt ?? startedAt,
        });
      };

      const readStreamFully = async (res: Response): Promise<string> => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setLiveStream(acc);
        }
        return acc;
      };

      try {
        if (!skipCalibration) {
        // ═══ PHASE 1: extensão por capítulo ═══════════════════════════
        for (let i = 0; i < accChapters.length; i++) {
          if (ctrl.signal.aborted) break;
          const ch = accChapters[i]!;
          const isP1 = ch.part === "Parte 1";
          const isP2 = ch.part === "Parte 2";
          if (!isP1 && !isP2) continue;
          const targets = isP1 ? targetsP1Raw : targetsP2Raw;
          const target = targets.find((t) => t.number === ch.number)?.target;
          if (!target) continue;
          const real = countWords(ch.content);
          if (isWithinTarget(real, target)) continue;

          const direction: "expand" | "shrink" =
            real < target ? "expand" : "shrink";
          const partLabel = (isP1 ? "Parte 1" : "Parte 2") as
            | "Parte 1"
            | "Parte 2";
          setBatchProgress({
            kind: "extending-chapter",
            chapterNumber: ch.number,
            part: partLabel,
            currentWords: real,
            targetWords: target,
            direction,
          });
          setLiveStream("");

          const fixRes = await fetch("/api/escrita-fix-wordcount", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapter: {
                number: ch.number,
                title: ch.title,
                part: partLabel,
                content: ch.content,
              },
              currentWords: real,
              targetWords: target,
              premissa: roteiro.outputs.premissa?.content,
              neighborSynopses: accSynopses
                .filter((s) => s.part === partLabel)
                .slice(-4),
            }),
            signal: ctrl.signal,
          });

          if (!fixRes.ok || !fixRes.body) {
            console.warn(
              `Fix word count falhou pro Cap ${ch.number} (${partLabel}): ${fixRes.statusText}`,
            );
            continue;
          }

          const fixAcc = await readStreamFully(fixRes);
          if (ctrl.signal.aborted) break;

          const fixParsed = parseRevisedChapters(fixAcc);
          const fixedCh = fixParsed.find((p) => p.number === ch.number);
          if (fixedCh?.content) {
            accChapters[i] = {
              ...ch,
              content: fixedCh.content,
              title: fixedCh.title ?? ch.title,
            };
            persistEscrita();
          } else {
            console.warn(
              `Fix devolveu output sem header parseável pro Cap ${ch.number} (${partLabel}) — mantendo original`,
            );
          }
        }

        if (ctrl.signal.aborted) {
          setLiveStream("");
          setBatchProgress(null);
          setIsGenerating(false);
          return;
        }

        // ═══ PHASE 2: balance part-total ═════════════════════════════
        for (const part of ["Parte 1", "Parte 2"] as const) {
          if (ctrl.signal.aborted) break;
          const partCaps = accChapters.filter((c) => c.part === part);
          if (partCaps.length === 0) continue;
          const partTotal = partCaps.reduce(
            (s, c) => s + countWords(c.content),
            0,
          );
          const range = partTotalRange(part);
          if (partTotal >= range.min && partTotal <= range.max) continue;

          const direction: "expand" | "shrink" =
            partTotal < range.min ? "expand" : "shrink";
          const delta = range.target - partTotal;

          // Escolhe cap pra ajustar:
          //   expand → cap MENOR (tem mais espaço pra crescer)
          //   shrink → cap MAIOR
          let pickedCap = partCaps[0]!;
          for (const c of partCaps) {
            const cWords = countWords(c.content);
            const pickedWords = countWords(pickedCap.content);
            if (direction === "expand" && cWords < pickedWords) pickedCap = c;
            if (direction === "shrink" && cWords > pickedWords) pickedCap = c;
          }

          const currentWords = countWords(pickedCap.content);
          const newTarget = currentWords + delta;

          setBatchProgress({
            kind: "balancing-part",
            part,
            partTotal,
            targetTotal: range.target,
            direction,
          });
          setLiveStream("");

          const balanceRes = await fetch("/api/escrita-fix-wordcount", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapter: {
                number: pickedCap.number,
                title: pickedCap.title,
                part,
                content: pickedCap.content,
              },
              currentWords,
              targetWords: newTarget,
              premissa: roteiro.outputs.premissa?.content,
              neighborSynopses: accSynopses
                .filter((s) => s.part === part)
                .slice(-4),
            }),
            signal: ctrl.signal,
          });

          if (balanceRes.ok && balanceRes.body) {
            const balAcc = await readStreamFully(balanceRes);
            if (ctrl.signal.aborted) break;
            const balParsed = parseRevisedChapters(balAcc);
            const balCh = balParsed.find((p) => p.number === pickedCap.number);
            if (balCh?.content) {
              const idxInAcc = accChapters.findIndex(
                (c) => c.part === part && c.number === pickedCap.number,
              );
              if (idxInAcc >= 0) {
                accChapters[idxInAcc] = {
                  ...accChapters[idxInAcc]!,
                  content: balCh.content,
                  title: balCh.title ?? accChapters[idxInAcc]!.title,
                };
                persistEscrita();
              }
            } else {
              console.warn(
                `Balance da ${part} devolveu output sem header — total ficou em ${partTotal} (range ${range.min}-${range.max})`,
              );
            }
          } else {
            console.warn(
              `Balance da ${part} falhou — total ficou em ${partTotal}`,
            );
          }
        }

        if (ctrl.signal.aborted) {
          setLiveStream("");
          setBatchProgress(null);
          setIsGenerating(false);
          return;
        }
        } else {
          console.info("[revisor] calibragem desativada pelo usuário — pulando Phase 1+2");
        }

        // ═══ PHASE 3: revisão estruturada (XML) ═══════════════════════
        setBatchProgress({
          kind: "revising",
          chaptersCount: accChapters.length,
        });
        setLiveStream("");

        const escritaContent = concatenateChapters(accChapters);
        const escritaSnapshotHash = hashEscritaContent(escritaContent);

        const res = await fetch(`/api/agent/${step}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            previousOutputs: roteiro.outputs,
            userInput: effectiveUserInput,
            referenceImage: roteiro.referenceImage,
          }),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const msg = await res.text();
          setOutput(step, {
            content: `[ERRO] ${msg || res.statusText}`,
            generatedAt: startedAt,
          });
          setIsGenerating(false);
          setBatchProgress(null);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          const display = stripErrosDetalhados(acc);
          setDraft(display);
          setOutput(step, {
            content: display,
            generatedAt: startedAt,
          });
        }

        if (ctrl.signal.aborted) {
          setLiveStream("");
          setBatchProgress(null);
          setIsGenerating(false);
          return;
        }

        let errors = parseRevisorErrors(acc);
        const cleanContent = stripErrosDetalhados(acc);

        // Fallback: dispara extração estruturada quando o XML emitido
        // tem MENOS erros do que o markdown lista em PRINCIPAIS ERROS.
        // Casos:
        //   - errors=0 e markdown lista 5 → modelo esqueceu o XML inteiro
        //   - errors=1 e markdown lista 5 → modelo truncou o XML após o 1º
        //   - errors=N e markdown lista N → tudo OK, pula fallback
        const expectedCount = countMarkdownErrorNumbers(cleanContent);
        if (expectedCount > 0 && errors.length < expectedCount) {
          console.info(
            `[revisor] XML tem ${errors.length} erro(s), markdown lista ${expectedCount} — disparando fallback de extração estruturada`,
          );
          try {
            const fbRes = await fetch("/api/revisor-extract-errors", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                revisaoMarkdown: cleanContent,
                escritaContent,
              }),
              signal: ctrl.signal,
            });
            if (fbRes.ok && fbRes.body) {
              const fbReader = fbRes.body.getReader();
              const fbDecoder = new TextDecoder();
              let fbAcc = "";
              while (true) {
                const { done, value } = await fbReader.read();
                if (done) break;
                fbAcc += fbDecoder.decode(value, { stream: true });
              }
              const fallbackErrors = parseRevisorErrors(fbAcc);
              if (fallbackErrors.length > errors.length) {
                console.info(
                  `[revisor] fallback extraiu ${fallbackErrors.length} erro(s) (vs ${errors.length} originais) — usando fallback`,
                );
                errors = fallbackErrors;
              } else if (fallbackErrors.length > 0) {
                console.info(
                  `[revisor] fallback extraiu ${fallbackErrors.length} erro(s) — não supera os ${errors.length} originais, mantendo originais`,
                );
              } else {
                console.warn(
                  "[revisor] fallback rodou mas não devolveu erros parseáveis — mantendo originais",
                );
              }
            } else {
              console.warn(
                `[revisor] fallback HTTP ${fbRes.status} — mantendo ${errors.length} erro(s) originais`,
              );
            }
          } catch (fbErr) {
            if ((fbErr as Error).name !== "AbortError") {
              console.warn("[revisor] fallback falhou:", fbErr);
            }
          }
        }

        // Defesa final: se ainda há erros listados em PRINCIPAIS ERROS que
        // não viraram <erro> XML (nem o LLM principal nem o fallback do
        // servidor pegaram), gera cards informativos sintéticos parseando
        // o markdown direto. Garante que a roteirista vê TODOS os erros.
        const markdownErrors = parseMarkdownErrorList(cleanContent);
        const xmlNumbers = new Set(errors.map((e) => e.numero.toLowerCase()));
        const missingFromXml = markdownErrors.filter(
          (m) => !xmlNumbers.has(m.numero.toLowerCase()),
        );
        if (missingFromXml.length > 0) {
          console.info(
            `[revisor] ${missingFromXml.length} erro(s) listado(s) em PRINCIPAIS ERROS não viraram XML — adicionando como cards informativos`,
          );
          errors = [...errors, ...missingFromXml].sort((a, b) => {
            const na = parseInt(a.numero, 10);
            const nb = parseInt(b.numero, 10);
            if (Number.isNaN(na) || Number.isNaN(nb)) {
              return a.numero.localeCompare(b.numero);
            }
            return na - nb;
          });
        }

        setOutput(step, {
          content: cleanContent,
          metadata: {
            errors,
            escritaSnapshotHash,
          },
          generatedAt: startedAt,
        });
        setDraft(cleanContent);
        setLiveStream("");
        setBatchProgress(null);
        setIsGenerating(false);

        if (autoAdvance && next && !ctrl.signal.aborted) {
          setCurrentStep(next);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error(err);
        }
        setIsGenerating(false);
        setBatchProgress(null);
      }
      return;
    }

    // ─── Branch padrão: 1 request, 1 stream ─────────────────────────────
    // Atende:
    //   - Premissa, Estrutura 1/2 (regenerate ou refine)
    //   - Escrita em modo REFINE (correção pontual: 1 chamada com refineMode,
    //     pula o loop 2-em-2)
    //   - Revisor em modo REFINE (correção pontual: 1 chamada com refineMode,
    //     pula a pré-fase de extensão/balance)
    // Pro Revisor refine, o agente precisa enxergar o XML <erros_detalhados>
    // pra poder mexer nele via patches. O `output.content` corrente foi
    // stripado do XML quando salvamos no store — reconstituímos a partir
    // de `metadata.errors` antes de enviar.
    const currentOutputForAgent =
      isRefine && step === "revisor" && output?.metadata?.errors
        ? `${baseContent}\n\n${serializeRevisorErrors(output.metadata.errors)}`
        : baseContent;

    try {
      const res = await fetch(`/api/agent/${step}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousOutputs: roteiro.outputs,
          userInput: effectiveUserInput,
          referenceImage: roteiro.referenceImage,
          ...(mode === "refine" && {
            refineMode: true,
            currentOutput: currentOutputForAgent,
          }),
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const msg = await res.text();
        setOutput(step, {
          content: `[ERRO] ${msg || res.statusText}`,
          generatedAt: startedAt,
        });
        setIsGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        if (isRefine) {
          // Em correção pontual (qualquer step) o output corrente fica
          // intacto — só atualizamos o liveStream (área secundária)
          // mostrando o que o agente está emitindo (caps na Escrita,
          // <alteracao> blocks nos demais). A finalização aplica.
          setLiveStream(acc);
          continue;
        }
        // Geração do zero: stream em tempo real no output principal.
        // Display: Revisor esconde o XML <erros_detalhados>.
        let display = acc;
        if (step === "revisor") display = stripErrosDetalhados(acc);
        setDraft(display);
        setOutput(step, {
          content: display,
          generatedAt: startedAt,
        });
      }

      if (ctrl.signal.aborted) {
        setIsGenerating(false);
        return;
      }

      // ── Finalização específica por step ────────────────────────────────

      if (step === "revisor" && !isRefine && acc.trim()) {
        // Geração do zero do Revisor: parse <erros_detalhados> pra popular
        // os cards de correção automática. Snapshot da Escrita pra detectar
        // drift na UI.
        let errors = parseRevisorErrors(acc);
        const cleanContent = stripErrosDetalhados(acc);
        const escritaContent =
          roteiro.outputs.escrita?.content?.trim() ?? "";
        const escritaSnapshotHash = escritaContent
          ? hashEscritaContent(escritaContent)
          : undefined;

        if (
          errors.length === 0 &&
          /Erro\s*#?\s*\d+/i.test(cleanContent) &&
          escritaContent
        ) {
          console.info(
            "[revisor] XML <erros_detalhados> ausente — disparando fallback de extração estruturada",
          );
          try {
            const fbRes = await fetch("/api/revisor-extract-errors", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                revisaoMarkdown: cleanContent,
                escritaContent,
              }),
              signal: ctrl.signal,
            });
            if (fbRes.ok && fbRes.body) {
              const fbReader = fbRes.body.getReader();
              const fbDecoder = new TextDecoder();
              let fbAcc = "";
              while (true) {
                const { done, value } = await fbReader.read();
                if (done) break;
                fbAcc += fbDecoder.decode(value, { stream: true });
              }
              const fallbackErrors = parseRevisorErrors(fbAcc);
              if (fallbackErrors.length > 0) errors = fallbackErrors;
            }
          } catch (fbErr) {
            if ((fbErr as Error).name !== "AbortError") {
              console.warn("[revisor] fallback falhou:", fbErr);
            }
          }
        }

        setOutput(step, {
          content: cleanContent,
          metadata: {
            errors,
            ...(escritaSnapshotHash ? { escritaSnapshotHash } : {}),
          },
          generatedAt: startedAt,
        });
        setDraft(cleanContent);
      } else if (
        isRefine &&
        (step === "estrutura1" || step === "estrutura2" || step === "revisor") &&
        acc.trim()
      ) {
        // Correção pontual em Estrutura 1, Estrutura 2 ou Revisor: o agente
        // devolve apenas pares <alteracao>/<original>/<corrigido>. Aplicamos
        // via find+replace literal no output corrente — trechos não tocados
        // permanecem byte-a-byte. Pra Revisor, o XML <erros_detalhados> faz
        // parte da base do patch (foi reconstituído via serializeRevisorErrors
        // antes da chamada) e os erros são reparseados ao final.
        const trimmed = acc.trim();

        if (/\[NENHUMA_ALTERACAO_NECESSARIA\]/i.test(trimmed)) {
          console.info(
            `[${step} refine] agente respondeu NENHUMA_ALTERACAO_NECESSARIA — mantendo output intacto`,
          );
          setLiveStream("");
        } else {
          const patches = parseCorrectionPatches(trimmed);
          if (patches.length === 0) {
            console.warn(
              `[${step} refine] nenhum bloco <alteracao> detectado — descartando resposta`,
            );
            setOutput(step, {
              content: output?.content ?? "",
              metadata: {
                ...(output?.metadata ?? {}),
                parseWarning:
                  "A correção não pôde ser aplicada — o agente respondeu em formato inesperado. Tente uma instrução mais específica.",
              },
              generatedAt: output?.generatedAt ?? startedAt,
            });
            setLiveStream("");
          } else {
            // Pro Revisor, base inclui o XML reconstituído (mesma string que
            // foi enviada ao agente). Pros demais, base = output.content cru.
            const patchBase = currentOutputForAgent;
            const result = applyCorrectionPatches(patchBase, patches);
            console.info(
              `[${step} refine] aplicados ${result.appliedIndices.length}/${patches.length} patches (${result.failedIndices.length} falharam)`,
            );

            if (step === "revisor") {
              const newErrors = parseRevisorErrors(result.text);
              const cleanContent = stripErrosDetalhados(result.text);
              const escritaContent =
                roteiro.outputs.escrita?.content?.trim() ?? "";
              const escritaSnapshotHash = escritaContent
                ? hashEscritaContent(escritaContent)
                : output?.metadata?.escritaSnapshotHash;
              setOutput(step, {
                content: cleanContent,
                metadata: {
                  errors: newErrors,
                  ...(escritaSnapshotHash ? { escritaSnapshotHash } : {}),
                },
                generatedAt: startedAt,
              });
              setDraft(cleanContent);
            } else {
              // Estrutura 1 / 2: o output é texto plano markdown.
              setOutput(step, {
                content: result.text,
                metadata: { ...(output?.metadata ?? {}) },
                generatedAt: startedAt,
              });
              setDraft(result.text);
            }
            setLiveStream("");

            // Avisa via console quando patches falharam (a UI continua
            // mostrando o output com os patches que deram certo aplicados).
            if (result.failedIndices.length > 0) {
              const failedLabels = result.failedIndices
                .map((i) => patches[i]?.descricao ?? `#${i + 1}`)
                .join(", ");
              console.warn(
                `[${step} refine] patches que não casaram: ${failedLabels}`,
              );
            }
          }
        }
      } else if (isEscritaRefine && acc.trim()) {
        // Pós-correção pontual da Escrita: o agente devolve APENAS os caps
        // que mudaram (banner ═══ PARTE X ═══ + ## Capítulo N — Título +
        // texto completo do cap). Mesclamos com os capítulos existentes —
        // os intactos ficam exatamente como estavam.
        const trimmed = acc.trim();

        // Sentinela: agente decidiu que nenhuma alteração é necessária.
        if (/\[NENHUMA_ALTERACAO_NECESSARIA\]/i.test(trimmed)) {
          console.info(
            "[escrita refine] agente respondeu NENHUMA_ALTERACAO_NECESSARIA — mantendo roteiro intacto",
          );
          // Restaura o output do snapshot (já mexemos só em userInput).
          // Não há o que fazer — o output atual no store já está intacto.
          setLiveStream("");
        } else {
          // Parser direto (sem o pré-corte de parseEscritaOutput) — pega os
          // banners ═══ PARTE 1/2 ═══ no próprio texto pra atribuir a Parte
          // certa a cada capítulo retornado.
          const incoming = parseEscritaChaptersDirect(trimmed).filter(
            (c) => c.number > 0,
          );

          if (incoming.length === 0) {
            console.warn(
              "[escrita refine] parser não detectou capítulos no output corrigido — descartando resposta",
            );
            // Não sobrescreve o roteiro corrente; avisa o usuário via parseWarning
            // sem destruir os capítulos.
            setOutput(step, {
              content: output?.content ?? "",
              metadata: {
                ...(output?.metadata ?? {}),
                parseWarning:
                  "A correção não pôde ser aplicada — o agente respondeu em formato inesperado. Tente reescrever a correção mais específica (ex.: \"refaça o cap 5 da Parte 2 deixando o tom mais íntimo\").",
              },
              generatedAt: output?.generatedAt ?? startedAt,
            });
            setLiveStream("");
          } else {
            // Merge: substitui capítulos existentes com mesmo (number, part);
            // se vier um cap novo (não existia antes), adiciona no final da
            // sua Parte. Os caps intactos permanecem inalterados.
            const merged: EscritaChapter[] = previousChapters.map((existing) => {
              const replacement = incoming.find(
                (i) =>
                  i.number === existing.number &&
                  (i.part ?? "") === (existing.part ?? ""),
              );
              return replacement
                ? {
                    ...existing,
                    title: replacement.title ?? existing.title,
                    content: replacement.content,
                    edited: false,
                    generatedAt: new Date().toISOString(),
                  }
                : existing;
            });
            // Caps novos (não casaram com nada existente) — append.
            const newOnes = incoming.filter(
              (i) =>
                !previousChapters.some(
                  (e) =>
                    e.number === i.number &&
                    (e.part ?? "") === (i.part ?? ""),
                ),
            );
            merged.push(...newOnes);

            const finalContent = concatenateChapters(merged);
            setOutput(step, {
              content: finalContent,
              metadata: {
                chapters: merged,
                ...(previousSynopsesAll.length > 0
                  ? { synopses: previousSynopsesAll }
                  : {}),
              },
              generatedAt: startedAt,
            });
            setDraft(finalContent);
            setLiveStream("");
            console.info(
              `[escrita refine] mesclados ${incoming.length} cap(s) corrigido(s) (${newOnes.length} novo(s), ${incoming.length - newOnes.length} substituído(s))`,
            );
          }
        }
      }

      setIsGenerating(false);

      if (autoAdvance && next) {
        setCurrentStep(next);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error(err);
      }
      setIsGenerating(false);
    }
  }, [
    roteiro,
    step,
    next,
    autoAdvance,
    skipCalibration,
    output,
    setOutput,
    setIsGenerating,
    setCurrentStep,
    pushOutputToHistory,
  ]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
  }, [setIsGenerating]);

  const saveEdit = useCallback(() => {
    if (
      step === "escrita" &&
      output?.metadata?.chapters &&
      output.metadata.chapters.length > 0
    ) {
      const chapters = [...output.metadata.chapters];
      const lastIdx = chapters.length - 1;
      const last = chapters[lastIdx]!;
      chapters[lastIdx] = {
        ...last,
        content: draft,
        edited: true,
        editedAt: new Date().toISOString(),
      };
      const newConcat = concatenateChapters(chapters);
      setOutput(step, {
        ...output,
        content: newConcat,
        metadata: { ...output.metadata, chapters },
      });
    } else {
      updateOutputContent(step, draft);
    }
    setIsEditing(false);
  }, [draft, step, output, setOutput, updateOutputContent]);

  const copyOutput = useCallback(async () => {
    if (!output?.content) return;
    await navigator.clipboard.writeText(output.content);
  }, [output]);

  const copyText = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
  }, []);

  // Callback estável pro sub-componente isolado da caixa de input. O
  // sub-componente é memo'd e tem estado próprio do textarea, então cada
  // tecla NÃO re-renderiza o StepShell inteiro (que tem EscritaOutputView,
  // chapters[], etc — tudo pesado). Aplica a correção: comita o input
  // escopado nesse step + dispara generate("refine") com override pra
  // evitar race com o re-render do Zustand.
  const handleApplyCorrection = useCallback(
    (text: string) => {
      setUserInput(step, text);
      void generate("refine", text);
    },
    [step, setUserInput, generate],
  );

  if (!roteiro) return null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-normal">
              Etapa {idx + 1} de {STEP_ORDER.length}
            </Badge>
            {agent.placeholder && (
              <Badge
                variant="outline"
                className="font-normal text-amber-700 border-amber-300 bg-amber-50"
              >
                Prompt placeholder
              </Badge>
            )}
          </div>
          <h2 className="text-2xl sm:text-3xl font-serif tracking-tight">
            {STEP_LABELS[step]}
          </h2>
          <p className="text-sm text-muted-foreground">{agent.description}</p>
        </div>

        {step !== "premissa" && (
        <div className="flex items-center gap-2 flex-wrap">
          <label
            className={cn(
              "flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md border cursor-pointer transition",
              autoAdvance
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-background border-border text-muted-foreground hover:bg-muted",
            )}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
            />
            <Zap className="size-3.5" />
            Avançar auto
          </label>
          {step === "revisor" && (
            <label
              className={cn(
                "flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md border cursor-pointer transition",
                skipCalibration
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-background border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={skipCalibration}
                onChange={(e) => setSkipCalibration(e.target.checked)}
              />
              <SkipForward className="size-3.5" />
              Pular calibragem
            </label>
          )}
        </div>
        )}
      </header>

      {previousOutputsSummary.some((p) => p.content) && (
        <details className="group border rounded-lg bg-muted/30">
          <summary className="list-none cursor-pointer px-4 py-3 text-sm font-medium flex items-center justify-between">
            <span>Contexto das etapas anteriores</span>
            <span className="text-xs text-muted-foreground group-open:hidden">
              clique para expandir
            </span>
          </summary>
          <div className="px-4 pb-4 flex flex-col gap-3">
            {previousOutputsSummary.map((p) =>
              p.content ? (
                <div key={p.id} className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {p.label}
                  </span>
                  <div className="bg-background border rounded-md p-3 max-h-40 overflow-auto">
                    <Prose size="sm">{p.content}</Prose>
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </details>
      )}

      {step === "premissa" ? (
        <PremissaWizard />
      ) : (
        <StepUserInputBox
          step={step}
          idx={idx}
          chapterCount={chapterCount}
          savedInput={savedStepInput}
          hasOutput={!!output?.content?.trim()}
          isGenerating={isGenerating}
          onApply={handleApplyCorrection}
        />
      )}

      {step !== "premissa" && (
      <>
      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-sm font-semibold">
              {step === "escrita" ? "Capítulo gerado" : `Saída do agente ${agent.label}`}
            </Label>
            {validationStatus === "APROVADO" && (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-normal gap-1">
                <CheckCircle2 className="size-3" />
                Validado
              </Badge>
            )}
            {validationStatus === "BLOQUEADO" && (
              <Badge className="bg-red-100 text-red-800 border-red-300 font-normal gap-1">
                <AlertTriangle className="size-3" />
                Bloqueado — revisar antes de avançar
              </Badge>
            )}
            {hasContent &&
              !isEditing &&
              (step === "escrita" || step === "estrutura1" || step === "estrutura2") && (
                <WordCountBadge
                  content={output?.content ?? ""}
                  targetMin={wordCountTarget.min}
                  targetMax={wordCountTarget.max}
                  margin={500}
                  label={wordCountTarget.label}
                />
              )}
          </div>
          <div className="flex items-center gap-2">
            {hasContent && !isEditing && (
              <>
                {/* No Escrita com chapters[], cada ChapterCard tem seu próprio
                    botão Editar — então não exibimos o "Editar global" aqui
                    pra evitar dois caminhos de edição. Demais steps mantêm o
                    Editar global que abre a Textarea com o markdown completo. */}
                {!(step === "escrita" && chapters.length > 0) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDraft(output?.content ?? "");
                      setIsEditing(true);
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Editar
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={copyOutput}>
                  <Copy className="size-3.5" /> Copiar
                </Button>
              </>
            )}
            {isEditing && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={saveEdit}>
                  Salvar edição
                </Button>
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={16}
            className="font-mono text-sm"
          />
        ) : step === "escrita" ? (
          <div className="flex flex-col gap-4">
            {chapters.length > 0 && <EscritaOutputView output={output!} />}
            {chapters.length === 0 && hasContent && !isGenerating && (
              <>
                {output?.metadata?.parseWarning && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm flex items-start gap-2">
                    <AlertTriangle className="size-4 flex-none mt-0.5" />
                    <span>{output.metadata.parseWarning}</span>
                  </div>
                )}
                <div className="rounded-lg border bg-card p-4 sm:p-6 max-h-[50vh] overflow-auto">
                  <Prose>{output?.content ?? ""}</Prose>
                </div>
              </>
            )}
            {isGenerating && batchProgress && batchProgress.kind === "writing" && (
              <BatchProgressPanel
                progress={batchProgress}
                liveStream={liveStream}
              />
            )}
            {isGenerating && !batchProgress && (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/[0.03] px-4 sm:px-5 py-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span className="text-sm font-semibold text-primary">
                    Aplicando correção pontual no roteiro…
                  </span>
                </div>
                {liveStream && (
                  <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-muted-foreground max-h-48 overflow-auto border-t border-primary/20 pt-3">
                    {liveStream.slice(-2000)}
                  </pre>
                )}
              </div>
            )}
            {!isGenerating && !hasContent && (
              <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
                <Sparkles className="size-6 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Clique em <span className="font-semibold">Gerar</span> para
                  executar o agente{" "}
                  <span className="font-semibold">{agent.label}</span> em pares
                  de capítulos.
                </p>
              </div>
            )}
          </div>
        ) : step === "revisor" && isGenerating ? (
          batchProgress && batchProgress.kind !== "writing" ? (
            <BatchProgressPanel
              progress={batchProgress}
              liveStream={liveStream}
            />
          ) : (
            <div className="rounded-lg border-2 border-primary/40 bg-primary/[0.03] px-4 sm:px-5 py-6 flex items-center gap-3">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm font-semibold text-primary">
                Iniciando revisão…
              </span>
            </div>
          )
        ) : hasContent ? (
          <div className="rounded-lg border bg-card p-4 sm:p-6 max-h-[50vh] overflow-auto">
            <Prose>{output?.content ?? ""}</Prose>
            {output?.edited && (
              <p className="text-[11px] text-muted-foreground mt-3">
                Editado manualmente em{" "}
                {output.editedAt
                  ? new Date(output.editedAt).toLocaleString("pt-BR")
                  : "—"}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <Sparkles className="size-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Clique em <span className="font-semibold">Gerar</span> para
              executar o agente{" "}
              <span className="font-semibold">{agent.label}</span>.
            </p>
          </div>
        )}

        {step === "revisor" &&
          hasContent &&
          !isGenerating &&
          !isEditing &&
          (output?.metadata?.errors?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Wand2 className="size-4 text-primary" />
                <Label className="text-sm font-semibold">
                  Correção automática
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  abra cada card e clique em &quot;Aplicar essa correção&quot; — o
                  trecho corrigido substitui o original no roteiro do Step 4
                </span>
              </div>
              <RevisorErrorsView
                errors={output!.metadata!.errors!}
                {...(output?.metadata?.escritaSnapshotHash
                  ? { escritaSnapshotHash: output.metadata.escritaSnapshotHash }
                  : {})}
              />
            </div>
          )}

        <div className="flex items-center gap-2 flex-wrap pt-2">
          {!isGenerating ? (
            <Button onClick={() => generate("regenerate")} size="lg" className="gap-2">
              {step === "escrita" && chapterCount > 0 ? (
                <ArrowRight className="size-4" />
              ) : hasContent ? (
                <RotateCcw className="size-4" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {generateLabel}
            </Button>
          ) : (
            <Button
              onClick={cancel}
              size="lg"
              variant="secondary"
              className="gap-2"
            >
              <Loader2 className="size-4 animate-spin" />
              Gerando... (clique para cancelar)
            </Button>
          )}
        </div>
      </section>

      {hasMetadata && !isGenerating && step !== "escrita" && (
        <MetadataPanel
          report={output?.metadata?.report}
          memory={output?.metadata?.memory}
          validation={output?.metadata?.validation}
          validationStatus={validationStatus}
          onCopy={copyText}
        />
      )}

      {!isGenerating && historyStack.length > 0 && (
        <HistoryPanel step={step} history={historyStack} />
      )}
      </>
      )}

      <Separator />

      <footer className="flex items-center justify-between gap-2 flex-wrap">
        <Button
          variant="outline"
          disabled={!prev}
          onClick={() => prev && setCurrentStep(prev)}
        >
          <ArrowLeft className="size-4" /> Voltar
        </Button>

        <div className="flex items-center gap-2 flex-wrap">
          {step === "escrita" && hasContent && (
            <>
              <CopyPartButton roteiro={roteiro} part={1} />
              <CopyPartButton roteiro={roteiro} part={2} />
              <DownloadEscritaButton roteiro={roteiro} />
            </>
          )}
          {step === "revisor" && (
            <>
              <CopyPartButton roteiro={roteiro} part={1} />
              <CopyPartButton roteiro={roteiro} part={2} />
              <DownloadEscritaButton roteiro={roteiro} />
            </>
          )}
          {next && (
            <Button
              onClick={() => setCurrentStep(next)}
              className="gap-2"
            >
              Avançar <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── Caixa de "Instruções adicionais" / "Aplicar correção" ─────────────
//
// Componente isolado E memo'd: estado do textarea fica AQUI dentro, então
// cada tecla digitada só re-renderiza esta caixa, NÃO o StepShell inteiro
// (que tem EscritaOutputView, lista de chapters, MetadataPanel, etc — tudo
// pesado). Sem essa separação, digitar 1 letra disparava re-render de tudo
// e a roteirista percebia lag visível em roteiros grandes.
//
// O pai injeta `savedInput` (escopado por step) e `onApply` (estável via
// useCallback). O sub-componente sincroniza pendingInput → savedInput
// quando o roteiro/step troca.
interface StepUserInputBoxProps {
  step: StepId;
  idx: number;
  chapterCount: number;
  savedInput: string;
  hasOutput: boolean;
  isGenerating: boolean;
  onApply: (text: string) => void;
}

const StepUserInputBox = memo(function StepUserInputBox({
  step,
  idx,
  chapterCount,
  savedInput,
  hasOutput,
  isGenerating,
  onApply,
}: StepUserInputBoxProps) {
  const [pendingInput, setPendingInput] = useState<string>(savedInput);

  // Sincroniza com o saved quando o usuário troca de step ou roteiro.
  // Não sincroniza durante digitação (o saved só muda em setUserInput,
  // que acontece no clique do botão — depois disso pendingInput === saved
  // e o useEffect é no-op).
  useEffect(() => {
    setPendingInput(savedInput);
  }, [savedInput, step]);

  const trimmedPending = pendingInput.trim();
  const isDirty = pendingInput !== savedInput;
  const hasInputContent = trimmedPending.length > 0;
  const canApply = hasInputContent && hasOutput && !isGenerating;

  const placeholder =
    step === "escrita"
      ? "Ex.: deixe o tom mais intenso na Parte 2 · enfatize o conflito interno do MMC · adicione mais humor nos primeiros capítulos\n\n(Deixe vazio para o agente derivar 100% das estruturas aprovadas)"
      : idx === 0
        ? "Ex.: romance com executiva herdeira que retorna pra cidade natal..."
        : "Ex.: deixe o tom mais intenso, foco no conflito interno...";

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <Label htmlFor="user-input" className="text-sm">
          {step === "escrita"
            ? "Ajustes opcionais para o roteiro"
            : "Instruções adicionais (opcional)"}
        </Label>
        {step === "escrita" && (
          <span className="text-[11px] text-muted-foreground">
            {chapterCount === 0
              ? "O agente derivará tudo das estruturas aprovadas"
              : `${chapterCount} capítulo${chapterCount === 1 ? "" : "s"} no roteiro atual · regenerar substitui tudo`}
          </span>
        )}
      </div>
      <Textarea
        id="user-input"
        placeholder={placeholder}
        value={pendingInput}
        onChange={(e) => setPendingInput(e.target.value)}
        rows={step === "escrita" ? 4 : 3}
        className="resize-none"
      />
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {!isDirty && hasInputContent && (
          <Badge
            variant="outline"
            className="font-normal gap-1 border-emerald-300 bg-emerald-50 text-emerald-800"
          >
            <CheckCircle2 className="size-3" />
            Correção aplicada
          </Badge>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!canApply}
          onClick={() => onApply(pendingInput)}
          className="gap-2"
          title={
            !hasInputContent
              ? "Digite a correção primeiro"
              : !hasOutput
                ? "Gere o conteúdo desse step antes de aplicar uma correção"
                : "Aplica essa correção pontual no step atual sem regerar do zero"
          }
        >
          <Send className="size-3.5" />
          Aplicar correção
        </Button>
      </div>
    </section>
  );
});

// ─── Premissa em duas fases ───────────────────────────────────────────
//
// Fluxo (modo automático):
//   1. briefing  → usuário descreve a ideia, clica "Gerar resumo"
//   2. streaming → /api/agent/premissa com premissaPhase: "resumo" (Bloco 0)
//   3. approving → resumo aparece editável; usuário ajusta e aprova
//   4. streaming → /api/agent/premissa com premissaPhase: "estrutura" (Blocos 1-8)
//   5. done      → outputs.premissa.content recebe "RESUMO + ESTRUTURA"
//
// Fluxo (modo manual): toggle "Já tenho a premissa pronta" → textarea
// livre, content gravado direto. Mantido como fallback.
function PremissaWizard() {
  const roteiro = useWizard((s) => s.roteiro);
  const setOutput = useWizard((s) => s.setOutput);
  const setIsGenerating = useWizard((s) => s.setIsGenerating);
  const pushOutputToHistory = useWizard((s) => s.pushOutputToHistory);
  const isGenerating = useWizard((s) => s.isGenerating);

  const output = roteiro?.outputs.premissa;
  const meta = output?.metadata ?? {};
  const briefing = meta.premissaBriefing ?? "";
  const resumo = meta.premissaResumo ?? "";
  const approved = !!meta.premissaResumoApproved;
  const manual = !!meta.premissaManualPaste;
  const content = output?.content ?? "";

  const [briefingDraft, setBriefingDraft] = useState(briefing);
  const [resumoDraft, setResumoDraft] = useState(resumo);
  const [contentDraft, setContentDraft] = useState(content);
  const [liveStream, setLiveStream] = useState("");
  const [streamingPhase, setStreamingPhase] = useState<
    null | "resumo" | "estrutura"
  >(null);
  const [isEditingResumo, setIsEditingResumo] = useState(false);
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isEditingManual, setIsEditingManual] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Sincroniza drafts quando o roteiro muda (troca de tela, undo, etc).
  useEffect(() => {
    setBriefingDraft(briefing);
  }, [briefing]);
  useEffect(() => {
    if (!isEditingResumo) setResumoDraft(resumo);
  }, [resumo, isEditingResumo]);
  useEffect(() => {
    if (!isEditingContent && !isEditingManual) setContentDraft(content);
  }, [content, isEditingContent, isEditingManual]);

  // Aborta stream quando o componente desmonta (usuário trocou de step).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Roteiros antigos (pré-fluxo automático) têm `content` mas nenhum metadado
  // novo. Tratamos como "manual" para preservar a premissa que o usuário já
  // tinha — sem isso, a tela de briefing apareceria por cima do conteúdo.
  const isLegacy = !!content && !resumo && !manual && !approved;
  const phase: "manual" | "briefing" | "approving" | "done" =
    manual || isLegacy
      ? "manual"
      : !resumo
        ? "briefing"
        : !approved || !content
          ? "approving"
          : "done";

  // ─── Streaming helpers ──────────────────────────────────────────────
  const readStreamFully = async (
    res: Response,
    signal: AbortSignal,
  ): Promise<string> => {
    if (!res.body) throw new Error("Stream sem corpo");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    while (true) {
      if (signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setLiveStream(acc);
    }
    return acc;
  };

  // ─── Fase 1: gerar resumo (Bloco 0) ─────────────────────────────────
  const generateResumo = useCallback(async () => {
    const briefingTrim = briefingDraft.trim();
    if (!briefingTrim || isGenerating) return;

    if (resumo) {
      pushOutputToHistory("premissa", "Antes de regenerar resumo");
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsGenerating(true);
    setLiveStream("");
    setStreamingPhase("resumo");

    const startedAt = new Date().toISOString();

    // Persiste o briefing no metadata logo no início — assim, se a
    // geração falhar, o usuário não perde o que digitou.
    setOutput("premissa", {
      content,
      generatedAt: output?.generatedAt ?? startedAt,
      metadata: { ...meta, premissaBriefing: briefingTrim },
    });

    try {
      const res = await fetch("/api/agent/premissa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInput: briefingTrim,
          referenceImage: roteiro?.referenceImage,
          premissaPhase: "resumo",
        }),
        signal: ctrl.signal,
      });
      if (!res.ok && res.status !== 200) {
        const errText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const fullText = (await readStreamFully(res, ctrl.signal)).trim();
      if (!fullText) return;

      const now = new Date().toISOString();
      setOutput("premissa", {
        // O conteúdo final só é populado depois da Fase 2; aqui zeramos
        // pra que o downstream (Estrutura 1/2) não consuma um resumo
        // ainda não aprovado como se fosse a premissa final.
        content: "",
        generatedAt: now,
        metadata: {
          ...meta,
          premissaBriefing: briefingTrim,
          premissaResumo: fullText,
          premissaResumoApproved: false,
          premissaManualPaste: false,
        },
      });
      setResumoDraft(fullText);
      setIsEditingResumo(false);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        console.error("[premissa] erro fase resumo:", e);
      }
    } finally {
      setIsGenerating(false);
      setStreamingPhase(null);
      setLiveStream("");
    }
  }, [
    briefingDraft,
    isGenerating,
    resumo,
    pushOutputToHistory,
    setIsGenerating,
    setOutput,
    content,
    output?.generatedAt,
    meta,
    roteiro?.referenceImage,
  ]);

  // ─── Fase 2: aprovar resumo + gerar Blocos 1-8 ──────────────────────
  const approveAndGenerateEstrutura = useCallback(async () => {
    const resumoTrim = resumoDraft.trim();
    const briefingTrim = briefingDraft.trim() || briefing;
    if (!resumoTrim || isGenerating) return;

    if (content) {
      pushOutputToHistory("premissa", "Antes de regenerar estrutura");
    }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsGenerating(true);
    setLiveStream("");
    setStreamingPhase("estrutura");

    try {
      const res = await fetch("/api/agent/premissa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInput: briefingTrim,
          referenceImage: roteiro?.referenceImage,
          premissaPhase: "estrutura",
          approvedResumo: resumoTrim,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok && res.status !== 200) {
        const errText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const estrutura = (await readStreamFully(res, ctrl.signal)).trim();
      if (!estrutura) return;

      const fullContent = `# RESUMO\n\n${resumoTrim}\n\n# ESTRUTURA COMPLETA\n\n${estrutura}`;
      const now = new Date().toISOString();
      setOutput("premissa", {
        content: fullContent,
        generatedAt: now,
        metadata: {
          ...meta,
          premissaBriefing: briefingTrim,
          premissaResumo: resumoTrim,
          premissaResumoApproved: true,
          premissaResumoApprovedAt: now,
          premissaManualPaste: false,
        },
      });
      setContentDraft(fullContent);
      setIsEditingResumo(false);
      setIsEditingContent(false);
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        console.error("[premissa] erro fase estrutura:", e);
      }
    } finally {
      setIsGenerating(false);
      setStreamingPhase(null);
      setLiveStream("");
    }
  }, [
    resumoDraft,
    briefingDraft,
    briefing,
    isGenerating,
    content,
    pushOutputToHistory,
    setIsGenerating,
    setOutput,
    meta,
    roteiro?.referenceImage,
  ]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
    setIsGenerating(false);
    setStreamingPhase(null);
    setLiveStream("");
  }, [setIsGenerating]);

  // ─── Manual paste ───────────────────────────────────────────────────
  const switchToManual = useCallback(() => {
    setOutput("premissa", {
      content,
      generatedAt: output?.generatedAt ?? new Date().toISOString(),
      metadata: { ...meta, premissaManualPaste: true },
    });
    setIsEditingManual(!content);
  }, [setOutput, content, output?.generatedAt, meta]);

  const switchToAutomatic = useCallback(() => {
    setOutput("premissa", {
      content: "",
      generatedAt: new Date().toISOString(),
      metadata: { ...meta, premissaManualPaste: false },
    });
    setContentDraft("");
    setIsEditingManual(false);
  }, [setOutput, meta]);

  const saveManualEdit = useCallback(() => {
    setOutput("premissa", {
      content: contentDraft,
      generatedAt: output?.generatedAt ?? new Date().toISOString(),
      editedAt: new Date().toISOString(),
      edited: true,
      metadata: { ...meta, premissaManualPaste: true },
    });
    setIsEditingManual(false);
  }, [setOutput, contentDraft, output?.generatedAt, meta]);

  const saveContentEdit = useCallback(() => {
    setOutput("premissa", {
      content: contentDraft,
      generatedAt: output?.generatedAt ?? new Date().toISOString(),
      editedAt: new Date().toISOString(),
      edited: true,
      metadata: meta,
    });
    setIsEditingContent(false);
  }, [setOutput, contentDraft, output?.generatedAt, meta]);

  // ─── Word counts (regra do CLAUDE.md: usar countWords) ─────────────
  const resumoWordCount = countWords(resumoDraft || resumo);
  const contentWordCount = countWords(contentDraft || content);
  const resumoTargetMin = 1200;
  const resumoTargetMax = 1800;
  const resumoOutOfTarget =
    resumoWordCount > 0 &&
    (resumoWordCount < resumoTargetMin || resumoWordCount > resumoTargetMax);

  // ─── Streaming view (compartilhada entre fase resumo e estrutura) ──
  if (streamingPhase) {
    return (
      <section className="flex flex-col gap-3">
        <div className="rounded-lg border-2 border-primary/40 bg-primary/[0.03] px-4 sm:px-5 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="text-sm font-semibold text-primary">
                {streamingPhase === "resumo"
                  ? "Gerando resumo (Bloco 0)…"
                  : "Construindo universo da história (Blocos 1-8)…"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelStream}
              className="gap-2"
            >
              Cancelar
            </Button>
          </div>
          {streamingPhase === "estrutura" && (
            <p className="text-[11px] text-muted-foreground">
              Esta fase é mais detalhada — pode levar 1 a 3 minutos. O resumo
              aprovado já está salvo; se algo der errado, ele permanece
              disponível para regenerar a estrutura.
            </p>
          )}
          {liveStream && (
            <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-foreground/85 max-h-[55vh] overflow-auto border-t border-primary/20 pt-3">
              {liveStream}
            </pre>
          )}
        </div>
      </section>
    );
  }

  // ─── Modo manual ────────────────────────────────────────────────────
  if (phase === "manual") {
    const tooLongManual = contentWordCount > 1000;
    return (
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="premissa-manual" className="text-sm font-semibold">
              {isEditingManual ? "Cole a premissa pronta" : "Premissa (modo manual)"}
            </Label>
            <span className="text-[11px] text-muted-foreground">
              Texto colado direto vai para os Steps 2/3/4 sem passar pelo agente.
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!!content && (
              <Badge
                className={cn(
                  "font-normal gap-1",
                  tooLongManual
                    ? "bg-amber-100 text-amber-800 border-amber-300"
                    : "bg-emerald-100 text-emerald-800 border-emerald-300",
                )}
              >
                <CheckCircle2 className="size-3" />
                {contentWordCount.toLocaleString("pt-BR")} palavra
                {contentWordCount === 1 ? "" : "s"}
                {tooLongManual ? " (acima do limite)" : ""}
              </Badge>
            )}
            {!isEditingManual && !!content && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setContentDraft(content);
                  setIsEditingManual(true);
                }}
              >
                <Pencil className="size-3.5" />
                Editar
              </Button>
            )}
            {isEditingManual && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setContentDraft(content);
                    setIsEditingManual(!content);
                  }}
                >
                  Cancelar
                </Button>
                <Button size="sm" onClick={saveManualEdit}>
                  Salvar
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={switchToAutomatic}
              className="text-muted-foreground"
            >
              Voltar ao modo automático
            </Button>
          </div>
        </div>

        {isEditingManual ? (
          <Textarea
            id="premissa-manual"
            value={contentDraft}
            onChange={(e) => setContentDraft(e.target.value)}
            placeholder={`Cole aqui a premissa completa.\n\nFormato sugerido:\n\n# PARTE 1\n[texto corrido]\n\n# PARTE 2\n[texto corrido]`}
            rows={20}
            className="font-sans text-[14px] leading-relaxed resize-y min-h-[400px]"
          />
        ) : (
          <div className="rounded-lg border bg-card p-4 sm:p-6 max-h-[60vh] overflow-auto">
            {content ? (
              <Prose>{content}</Prose>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Sem conteúdo. Clique em <span className="font-semibold">Editar</span> e cole o texto.
              </p>
            )}
          </div>
        )}

        <ReferenceImageUpload />
      </section>
    );
  }

  // ─── Modo automático: briefing → approving → done ───────────────────
  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-md border border-primary/25 bg-primary/[0.04] px-4 py-3 flex items-start gap-2.5">
        <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-primary">
            Dark Romance de Máfia — fluxo em duas fases
          </p>
          <p className="text-[11px] text-foreground/75 leading-relaxed">
            <span className="font-semibold">Fase 1:</span> descreva sua ideia, o agente gera um resumo (Parte 1 + Parte 2). <span className="font-semibold">Fase 2:</span> você aprova ou edita o resumo, e o agente constrói o universo completo (elenco, cenários, regras do mundo, 20 etapas) que vai alimentar Estrutura 1, 2 e Escrita.
          </p>
        </div>
      </div>

      {/* ─── Briefing ─── */}
      {(phase === "briefing" || phase === "approving") && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <Label htmlFor="premissa-briefing" className="text-sm font-semibold">
              Sua ideia
            </Label>
            <span className="text-[11px] text-muted-foreground">
              {phase === "briefing"
                ? "Quanto mais detalhe, melhor o resumo"
                : "Edite e clique em Regenerar resumo se quiser ajustar"}
            </span>
          </div>
          <Textarea
            id="premissa-briefing"
            value={briefingDraft}
            onChange={(e) => setBriefingDraft(e.target.value)}
            placeholder={`Ex.: Nova York, máfia italoamericana. MMC: don jovem que herdou após o pai ser assassinado. FMC: forense de 26 anos que descobre algo que conecta o assassinato à família dele. Gatilho: casamento forçado por dívida do pai dela. Vilão: tio do MMC que comandou o assassinato e quer manter o poder. Segredo central: o MMC sabe quem matou o pai dela há anos e escondeu para protegê-la.\n\nMencione (opcional):\n• cidade (Nova York, Chicago, Boston, Las Vegas, Miami, Palermo, Catânia, Corleone, Nápoles, Moscou, São Petersburgo)\n• tipo de organização (Cosa Nostra, siciliana tradicional, Camorra, Bratva)\n• cargo do MMC (don, capo, herdeiro, sottocapo, consigliere)\n• profissão e situação inicial da FMC\n• trauma central de cada um\n• gatilho inicial (casamento forçado, dívida, fuga, vingança, contrato)\n• segredo central que você quer ver pago\n• tipo de vilão (família rival, traidor interno, ex, pai do MMC)`}
            rows={phase === "briefing" ? 12 : 5}
            className="font-sans text-[14px] leading-relaxed resize-y"
          />
        </div>
      )}

      {/* ─── Resumo: aprovar/editar/regenerar ─── */}
      {phase === "approving" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="premissa-resumo" className="text-sm font-semibold">
                Resumo gerado (Parte 1 + Parte 2)
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Edite à vontade. Quando estiver bom, aprove para gerar o universo completo.
              </span>
            </div>
            <Badge
              className={cn(
                "font-normal gap-1",
                resumoOutOfTarget
                  ? "bg-amber-100 text-amber-800 border-amber-300"
                  : "bg-emerald-100 text-emerald-800 border-emerald-300",
              )}
            >
              <CheckCircle2 className="size-3" />
              {resumoWordCount.toLocaleString("pt-BR")} palavras
              {resumoOutOfTarget
                ? ` (alvo ${resumoTargetMin}-${resumoTargetMax})`
                : ""}
            </Badge>
          </div>
          {isEditingResumo ? (
            <Textarea
              id="premissa-resumo"
              value={resumoDraft}
              onChange={(e) => setResumoDraft(e.target.value)}
              rows={20}
              className="font-sans text-[14px] leading-relaxed resize-y min-h-[400px]"
            />
          ) : (
            <div className="rounded-lg border bg-card p-4 sm:p-6 max-h-[55vh] overflow-auto">
              <Prose>{resumoDraft || resumo}</Prose>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 flex-wrap pt-1">
            {!isEditingResumo ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditingResumo(true)}
              >
                <Pencil className="size-3.5" /> Editar resumo
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setResumoDraft(resumo);
                    setIsEditingResumo(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setOutput("premissa", {
                      content,
                      generatedAt: output?.generatedAt ?? new Date().toISOString(),
                      metadata: { ...meta, premissaResumo: resumoDraft.trim() },
                    });
                    setIsEditingResumo(false);
                  }}
                >
                  Salvar edição
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <ReferenceImageUpload />

      {/* ─── Conteúdo final (Blocos 1-8) ─── */}
      {phase === "done" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <Label className="text-sm font-semibold">
                Universo completo da história
              </Label>
              <span className="text-[11px] text-muted-foreground">
                Resumo aprovado + Blocos 1 a 8. Vai alimentar Estrutura 1, 2 e Escrita.
              </span>
            </div>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-normal gap-1">
              <CheckCircle2 className="size-3" />
              {contentWordCount.toLocaleString("pt-BR")} palavras
            </Badge>
          </div>
          {isEditingContent ? (
            <>
              <Textarea
                value={contentDraft}
                onChange={(e) => setContentDraft(e.target.value)}
                rows={24}
                className="font-mono text-[13px] leading-relaxed resize-y min-h-[500px]"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setContentDraft(content);
                    setIsEditingContent(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button size="sm" onClick={saveContentEdit}>
                  Salvar edição
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg border bg-card p-4 sm:p-6 max-h-[60vh] overflow-auto">
                <Prose>{content}</Prose>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setContentDraft(content);
                    setIsEditingContent(true);
                  }}
                >
                  <Pencil className="size-3.5" /> Editar
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Botões de ação por fase ─── */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {phase === "briefing" && (
          <Button
            onClick={generateResumo}
            disabled={!briefingDraft.trim() || isGenerating}
            size="lg"
            className="gap-2"
          >
            <Sparkles className="size-4" /> Gerar resumo
          </Button>
        )}
        {phase === "approving" && (
          <>
            <Button
              onClick={approveAndGenerateEstrutura}
              disabled={!resumoDraft.trim() || isGenerating}
              size="lg"
              className="gap-2"
            >
              <CheckCircle2 className="size-4" /> Aprovar e gerar universo
            </Button>
            <Button
              onClick={generateResumo}
              disabled={!briefingDraft.trim() || isGenerating}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <RotateCcw className="size-4" /> Regenerar resumo
            </Button>
          </>
        )}
        {phase === "done" && (
          <Button
            onClick={approveAndGenerateEstrutura}
            disabled={!resumoDraft.trim() || isGenerating}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RotateCcw className="size-3.5" /> Regenerar universo
          </Button>
        )}
        <div className="ml-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={switchToManual}
            className="text-muted-foreground"
          >
            Já tenho a premissa pronta — colar manualmente
          </Button>
        </div>
      </div>
    </section>
  );
}

function EscritaOutputView({ output }: { output: StepOutput }) {
  const setOutput = useWizard((s) => s.setOutput);
  const pushOutputToHistory = useWizard((s) => s.pushOutputToHistory);

  const chapters = output.metadata?.chapters ?? [];
  const memory = output.metadata?.memory;
  const report = output.metadata?.report;
  const validation = output.metadata?.validation;
  const validationStatus = output.metadata?.validationStatus;

  // Edição inline por capítulo: substitui o conteúdo do capítulo no metadata,
  // re-concatena `output.content` e empurra um snapshot pro histórico antes
  // de aplicar (mesmo padrão das demais edições). Sem isso a edição manual de
  // um capítulo não-último era impossível pelo header (que só editava o último).
  const saveChapter = useCallback(
    (idx: number, newContent: string) => {
      const current = output.metadata?.chapters;
      if (!current || !current[idx]) return;
      pushOutputToHistory("escrita", `Antes da edição manual do Cap ${current[idx].number}`);
      const next = [...current];
      next[idx] = {
        ...next[idx]!,
        content: newContent,
        edited: true,
        editedAt: new Date().toISOString(),
      };
      setOutput("escrita", {
        ...output,
        content: concatenateChapters(next),
        metadata: { ...output.metadata, chapters: next },
        edited: true,
        editedAt: new Date().toISOString(),
      });
    },
    [output, setOutput, pushOutputToHistory],
  );

  // Fallback — output sem chapters[]: renderiza monolítico (output cru).
  if (chapters.length === 0) {
    return (
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex flex-col divide-y divide-border/60">
          <SectionBanner label="CAPÍTULO" />
          <div className="px-4 sm:px-6 py-5">
            <Prose>{output.content}</Prose>
          </div>
          {report && (
            <>
              <SectionBanner label="RELATÓRIO DE AUTO-REVISÃO" />
              <div className="px-4 sm:px-6 py-5">
                <Prose size="sm">{report}</Prose>
              </div>
            </>
          )}
          {memory && (
            <>
              <SectionBanner label="MEMÓRIA VIVA ATUALIZADA" />
              <div className="px-4 sm:px-5 py-4">
                <MemoryVivaCard memoryJson={memory} />
              </div>
            </>
          )}
          {validation && (
            <>
              <SectionBanner label="VALIDAÇÃO" />
              <div className="px-4 sm:px-6 py-5">
                <Prose size="sm">{validation}</Prose>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {chapters.map((ch, i) => {
          const isLast = i === chapters.length - 1;
          return (
            <ChapterCard
              key={i}
              chapter={ch}
              defaultOpen={isLast}
              onSave={(newContent) => saveChapter(i, newContent)}
            />
          );
        })}
      </div>

      {report && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <SectionBanner label="RELATÓRIO DE AUTO-REVISÃO" />
          <div className="px-4 sm:px-6 py-5">
            <Prose size="sm">{report}</Prose>
          </div>
        </div>
      )}

      {memory && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <SectionBanner label="MEMÓRIA VIVA ATUALIZADA" />
          <div className="px-4 sm:px-5 py-4">
            <MemoryVivaCard memoryJson={memory} />
          </div>
        </div>
      )}

      {validation && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <SectionBanner
            label={
              validationStatus === "BLOQUEADO"
                ? "VALIDAÇÃO — BLOQUEADO"
                : validationStatus === "APROVADO"
                  ? "VALIDAÇÃO — APROVADO"
                  : "VALIDAÇÃO"
            }
          />
          <div className="px-4 sm:px-6 py-5">
            <Prose size="sm">{validation}</Prose>
          </div>
        </div>
      )}
    </div>
  );
}

function ChapterCard({
  chapter,
  defaultOpen,
  onSave,
}: {
  chapter: EscritaChapter;
  defaultOpen: boolean;
  onSave?: (newContent: string) => void;
}) {
  const titleLabel = chapter.title
    ? `Capítulo ${chapter.number} — ${chapter.title}`
    : `Capítulo ${chapter.number}`;

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(chapter.content);

  // Se o conteúdo do capítulo mudar (ex: revisor aplicou correção, ou snapshot
  // restaurado), sincroniza o draft local quando NÃO estiver editando.
  useEffect(() => {
    if (!isEditing) setDraft(chapter.content);
  }, [chapter.content, isEditing]);

  const startEdit = useCallback(() => {
    setDraft(chapter.content);
    setIsEditing(true);
  }, [chapter.content]);

  const cancelEdit = useCallback(() => {
    setDraft(chapter.content);
    setIsEditing(false);
  }, [chapter.content]);

  const saveEdit = useCallback(() => {
    if (onSave) onSave(draft);
    setIsEditing(false);
  }, [draft, onSave]);

  return (
    <details
      open={defaultOpen || isEditing}
      className="group rounded-lg border bg-card overflow-hidden"
    >
      <summary className="list-none cursor-pointer px-4 sm:px-5 py-3 flex items-center gap-3 bg-muted/30 hover:bg-muted/50 transition">
        <span className="size-8 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0">
          {chapter.number}
        </span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-serif text-base tracking-tight truncate">
            {titleLabel}
          </span>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {chapter.part && (
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {chapter.part}
              </span>
            )}
            {(() => {
              const realCount = countWords(chapter.content);
              const declaredCount = chapter.wordCount;
              const showDeclared =
                typeof declaredCount === "number" &&
                Math.abs(declaredCount - realCount) > 30;
              return (
                <>
                  <span className="text-[10px] text-muted-foreground">
                    {realCount.toLocaleString("pt-BR")} palavras
                    {showDeclared && (
                      <span
                        className="ml-1 text-amber-700"
                        title="A contagem que o agente declarou difere do conteúdo real"
                      >
                        (declarou {declaredCount?.toLocaleString("pt-BR")})
                      </span>
                    )}
                  </span>
                </>
              );
            })()}
            {chapter.edited && (
              <span className="text-[10px] text-amber-700">
                editado manualmente
              </span>
            )}
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 group-open:hidden">
          abrir
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0 hidden group-open:inline">
          recolher
        </span>
      </summary>

      <div className="flex flex-col divide-y divide-border/60">
        <div className="px-4 sm:px-6 py-5">
          {onSave && (
            <div className="flex items-center justify-end gap-2 mb-3">
              {!isEditing ? (
                <Button variant="ghost" size="sm" onClick={startEdit}>
                  <Pencil className="size-3.5" />
                  Editar
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={cancelEdit}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={saveEdit}>
                    Salvar
                  </Button>
                </>
              )}
            </div>
          )}

          {isEditing ? (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={20}
              className="font-mono text-sm"
            />
          ) : (
            <Prose>{chapter.content}</Prose>
          )}

          {chapter.cliffhanger && !isEditing && (
            <p className="text-[12px] text-foreground/70 mt-3 italic border-l-2 border-primary/40 pl-3">
              <span className="font-semibold not-italic text-primary/80">
                Cliffhanger:
              </span>{" "}
              {chapter.cliffhanger}
            </p>
          )}
          {chapter.edited && !isEditing && (
            <p className="text-[11px] text-muted-foreground mt-3">
              Editado manualmente em{" "}
              {chapter.editedAt
                ? new Date(chapter.editedAt).toLocaleString("pt-BR")
                : "—"}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

function BatchProgressPanel({
  progress,
  liveStream,
}: {
  progress: WizardProgress;
  liveStream: string;
}) {
  let title: string;
  let subtitle: string;
  let placeholder: string;

  if (progress.kind === "writing") {
    const chapsLabel =
      progress.chapters.length === 2
        ? `Capítulos ${progress.chapters[0]} e ${progress.chapters[1]}`
        : `Capítulo ${progress.chapters[0]}`;
    title = `Par ${progress.batchIndex} de ${progress.totalBatches}`;
    subtitle = `· ${chapsLabel} da ${progress.part}`;
    placeholder = "Conectando ao agente…";
  } else if (progress.kind === "preparing") {
    title = "Preparando revisão";
    subtitle = `· verificando ${progress.chaptersCount} capítulos`;
    placeholder = "Calculando contagens e detectando capítulos fora do alvo…";
  } else if (progress.kind === "extending-chapter") {
    const verb = progress.direction === "expand" ? "Expandindo" : "Encurtando";
    title = `Ajustando contagem do Cap ${progress.chapterNumber}`;
    subtitle = `· ${verb} de ${progress.currentWords.toLocaleString("pt-BR")} → ${progress.targetWords.toLocaleString("pt-BR")} palavras (${progress.part})`;
    placeholder = "Reescrevendo capítulo dentro do alvo…";
  } else if (progress.kind === "balancing-part") {
    const verb = progress.direction === "expand" ? "Expandindo" : "Encurtando";
    title = `Equilibrando total da ${progress.part}`;
    subtitle = `· ${verb} para ${progress.partTotal.toLocaleString("pt-BR")} → ${progress.targetTotal.toLocaleString("pt-BR")} palavras`;
    placeholder = "Compensando o capítulo mais distante do alvo…";
  } else {
    // revising
    title = "Revisão final";
    subtitle = `· ${progress.chaptersCount} capítulos · Opus`;
    placeholder = "Revisor lendo o roteiro completo…";
  }

  return (
    <div className="rounded-lg border-2 border-primary/40 bg-primary/[0.03] overflow-hidden">
      <div className="px-4 sm:px-5 py-3 bg-primary/10 border-b border-primary/30 flex items-center gap-3 flex-wrap">
        <Loader2 className="size-4 animate-spin text-primary" />
        <span className="text-sm font-semibold text-primary">{title}</span>
        <span className="text-xs text-foreground/70">{subtitle}</span>
      </div>
      <div className="px-4 sm:px-5 py-4 max-h-[55vh] overflow-auto">
        {liveStream ? (
          <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
            {liveStream}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground italic">{placeholder}</p>
        )}
      </div>
    </div>
  );
}

function SectionBanner({ label }: { label: string }) {
  return (
    <div className="px-4 sm:px-5 py-2.5 bg-muted/40 border-y border-border/60 flex items-center gap-2">
      <span className="text-muted-foreground text-xs select-none">
        ═══════════
      </span>
      <span className="text-[11px] font-bold tracking-[0.2em] text-foreground/70 uppercase">
        {label}
      </span>
      <span className="text-muted-foreground text-xs select-none flex-1 overflow-hidden">
        ═══════════════════════════════════════
      </span>
    </div>
  );
}

interface MetadataPanelProps {
  report?: string;
  memory?: string;
  validation?: string;
  validationStatus?: "APROVADO" | "BLOQUEADO";
  onCopy: (text: string) => void;
}

function MetadataPanel({
  report,
  memory,
  validation,
  validationStatus,
  onCopy,
}: MetadataPanelProps) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-4 text-muted-foreground" />
        <Label className="text-sm font-semibold text-muted-foreground">
          Dados auxiliares da geração
        </Label>
      </div>

      <div className="flex flex-col gap-2">
        {report && (
          <MetadataBlock
            icon={<FileText className="size-4" />}
            title="Relatório de auto-revisão"
            subtitle="Passadas focadas (espaço, tempo, cruzamento, POV, 1ª pessoa) e checklist"
            content={report}
            onCopy={() => onCopy(report)}
            monospace={false}
          />
        )}
        {memory && (
          <MetadataBlock
            icon={<Sparkles className="size-4" />}
            title="Memória viva (JSON)"
            subtitle="Estado vivo da história — usada automaticamente no próximo capítulo"
            content={memory}
            onCopy={() => onCopy(memory)}
            monospace={true}
          />
        )}
        {validation && (
          <MetadataBlock
            icon={
              validationStatus === "BLOQUEADO" ? (
                <AlertTriangle className="size-4 text-red-600" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-600" />
              )
            }
            title={`Validação — ${validationStatus ?? "sem status"}`}
            subtitle="8 regras bloqueantes verificadas após a auto-revisão"
            content={validation}
            onCopy={() => onCopy(validation)}
            monospace={false}
          />
        )}
      </div>
    </section>
  );
}

interface MetadataBlockProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  content: string;
  onCopy: () => void;
  monospace: boolean;
}

function MetadataBlock({
  icon,
  title,
  subtitle,
  content,
  onCopy,
  monospace,
}: MetadataBlockProps) {
  return (
    <details className="group border rounded-lg bg-muted/20">
      <summary className="list-none cursor-pointer px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-muted-foreground">{icon}</span>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{title}</span>
            <span className="text-[11px] text-muted-foreground truncate">
              {subtitle}
            </span>
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 group-open:hidden">
          expandir
        </span>
      </summary>
      <div className="px-4 pb-4 flex flex-col gap-2">
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              onCopy();
            }}
            className="text-xs h-7"
          >
            <Copy className="size-3" /> Copiar
          </Button>
        </div>
        {monospace ? (
          <pre className="text-xs whitespace-pre-wrap bg-background border rounded-md p-3 max-h-80 overflow-auto font-mono">
            {content}
          </pre>
        ) : (
          <div className="bg-background border rounded-md p-4 max-h-80 overflow-auto">
            <Prose size="sm">{content}</Prose>
          </div>
        )}
      </div>
    </details>
  );
}
