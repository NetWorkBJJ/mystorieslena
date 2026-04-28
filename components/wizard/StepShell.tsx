"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  parseEscritaOutput,
} from "@/lib/parse-escrita-output";
import {
  parseRevisorErrors,
  stripErrosDetalhados,
} from "@/lib/parse-revisor-output";
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
import { GoogleDocsButton } from "@/components/wizard/GoogleDocsButton";
import { DownloadEscritaButton } from "@/components/wizard/DownloadEscritaButton";
import { CopyEscritaButton } from "@/components/wizard/CopyEscritaButton";
import { ReferenceImageUpload } from "@/components/wizard/ReferenceImageUpload";
import { cn } from "@/lib/utils";

type EscritaProgress =
  | {
      kind: "writing";
      batchIndex: number;
      totalBatches: number;
      part: "Parte 1" | "Parte 2";
      chapters: number[];
    }
  | {
      kind: "fixing-wordcount";
      chapterNumber: number;
      part: "Parte 1" | "Parte 2";
      currentWords: number;
      targetWords: number;
      direction: "expand" | "shrink";
    }
  | {
      kind: "revising-grammar";
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
  const fastMode = useWizard((s) => s.fastMode);
  const setFastMode = useWizard((s) => s.setFastMode);
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
  const [batchProgress, setBatchProgress] = useState<EscritaProgress | null>(
    null,
  );
  // Ajuste/correção é "draft" local — só vira o userInput do roteiro quando
  // o usuário clica "Aplicar correção". Sem isso, qualquer caractere digitado
  // entra na próxima geração mesmo sem confirmação. Sync com store quando
  // o roteiro muda (carregar outro / restaurar histórico).
  const [pendingInput, setPendingInput] = useState<string>(
    roteiro?.userInput ?? "",
  );
  useEffect(() => {
    setPendingInput(roteiro?.userInput ?? "");
  }, [roteiro?.id, roteiro?.userInput]);
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

  const generate = useCallback(async (mode: "regenerate" | "refine" = "regenerate") => {
    if (!roteiro) return;

    // Modo correção precisa de output existente + instrução escrita.
    if (mode === "refine") {
      if (!output?.content?.trim() || !roteiro.userInput?.trim()) return;
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

    setIsGenerating(true);
    setDraft("");
    setLiveStream("");
    setBatchProgress(null);
    const startedAt = new Date().toISOString();
    setOutput(step, { content: "", generatedAt: startedAt });

    // ─── Branch Escrita: loop 2-em-2 + fix-wordcount + revisor ──────────
    if (step === "escrita") {
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

      // Extrai alvos de palavras por capítulo da estrutura. Cap sem alvo
      // declarado vira fallback proporcional (11.500/N pra Parte 1, 13.250/N
      // pra Parte 2).
      const targetsP1Raw = extractChapterTargets(estrutura1);
      const targetsP2Raw = extractChapterTargets(estrutura2);
      // Totais do prompt mestre das estruturas (lib/agents/estrutura{1,2}-prompt.ts):
      //   P1 = 11.500 alvo (faixa 11.300-11.700)
      //   P2 = 13.000-13.500 (rigoroso, alvo 13.250)
      // Fallback só ativo se a estrutura não declarar alvo per cap (caso
      // degenerado — o prompt real sempre declara entre parênteses no header).
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
        // ═══ PHASE 1: gerar batches + fix word count ════════════════════
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
              userInput: roteiro.userInput,
              fastMode,
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
              `O modelo não seguiu o formato esperado (sem cabeçalhos "## Capítulo N — Título"). Isso é mais comum em Modo rápido (Sonnet) — desligue e tente novamente em Opus.`,
              b.batchIndex,
            );
            setIsGenerating(false);
            setBatchProgress(null);
            return;
          }

          // Verifica word count de cada capítulo do batch e dispara fix
          // automático se algum estiver fora de ±5% do alvo. Max 1 retry
          // por capítulo (evita loop).
          for (let i = 0; i < parsed.chapters.length; i++) {
            if (ctrl.signal.aborted) break;
            const ch = parsed.chapters[i]!;
            const target = b.targets[i];
            if (!target) continue;
            const real = countWords(ch.content);
            if (isWithinTarget(real, target)) continue;

            const direction: "expand" | "shrink" =
              real < target ? "expand" : "shrink";
            setBatchProgress({
              kind: "fixing-wordcount",
              chapterNumber: ch.number,
              part: b.part,
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
                  part: b.part,
                  content: ch.content,
                },
                currentWords: real,
                targetWords: target,
                premissa: roteiro.outputs.premissa?.content,
                neighborSynopses: accSynopses.slice(-4), // sinopses recentes pra continuidade
              }),
              signal: ctrl.signal,
            });

            if (!fixRes.ok || !fixRes.body) {
              // Falha do fix não é fatal — segue com o cap original.
              console.warn(
                `Fix word count falhou pro Cap ${ch.number}: ${fixRes.statusText}`,
              );
              continue;
            }

            const fixAcc = await readStreamFully(fixRes);
            if (ctrl.signal.aborted) break;

            // Parse: extrai o capítulo reescrito do output do fix.
            const fixParsed = parseRevisedChapters(fixAcc);
            const fixedCh = fixParsed.find((p) => p.number === ch.number);
            if (fixedCh?.content) {
              parsed.chapters[i] = {
                ...ch,
                content: fixedCh.content,
                title: fixedCh.title ?? ch.title,
              };
            } else {
              console.warn(
                `Fix devolveu output sem header parseável pro Cap ${ch.number} — mantendo original`,
              );
            }
          }

          if (ctrl.signal.aborted) break;

          accChapters.push(...parsed.chapters);
          accSynopses.push(...parsed.synopses);
          persist();

          // ─── Check de TOTAL da Parte após o último batch dela ─────────
          // Se o total da Parte ficou fora do range PDF (P1: 11.200-11.500,
          // P2: 13.400-13.600), dispara UM fix compensatório no cap mais
          // distante do alvo per-cap na direção certa.
          const remainingInPart = plan
            .slice(plan.indexOf(b) + 1)
            .some((p) => p.part === b.part);

          if (!remainingInPart) {
            const partCaps = accChapters.filter((c) => c.part === b.part);
            const partTotal = partCaps.reduce(
              (s, c) => s + countWords(c.content),
              0,
            );
            const range = partTotalRange(b.part);

            if (partTotal < range.min || partTotal > range.max) {
              const direction: "expand" | "shrink" =
                partTotal < range.min ? "expand" : "shrink";
              const delta = range.target - partTotal; // positivo = expandir

              // Escolhe cap pra ajustar:
              //   expand → cap MENOR (tem mais espaço pra crescer)
              //   shrink → cap MAIOR
              let pickedCap = partCaps[0]!;
              for (const c of partCaps) {
                const cWords = countWords(c.content);
                const pickedWords = countWords(pickedCap.content);
                if (direction === "expand" && cWords < pickedWords)
                  pickedCap = c;
                if (direction === "shrink" && cWords > pickedWords)
                  pickedCap = c;
              }

              const currentWords = countWords(pickedCap.content);
              const newTarget = currentWords + delta;

              setBatchProgress({
                kind: "fixing-wordcount",
                chapterNumber: pickedCap.number,
                part: b.part,
                currentWords,
                targetWords: newTarget,
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
                    part: b.part,
                    content: pickedCap.content,
                  },
                  currentWords,
                  targetWords: newTarget,
                  premissa: roteiro.outputs.premissa?.content,
                  neighborSynopses: accSynopses.slice(-4),
                }),
                signal: ctrl.signal,
              });

              if (balanceRes.ok && balanceRes.body) {
                const balAcc = await readStreamFully(balanceRes);
                if (!ctrl.signal.aborted) {
                  const balParsed = parseRevisedChapters(balAcc);
                  const balCh = balParsed.find(
                    (p) => p.number === pickedCap.number,
                  );
                  if (balCh?.content) {
                    // Atualiza o cap em accChapters (precisa achar o índice
                    // certo — pode ter o mesmo number em P1 e P2).
                    const idxInAcc = accChapters.findIndex(
                      (c) =>
                        c.part === b.part && c.number === pickedCap.number,
                    );
                    if (idxInAcc >= 0) {
                      accChapters[idxInAcc] = {
                        ...accChapters[idxInAcc]!,
                        content: balCh.content,
                        title: balCh.title ?? accChapters[idxInAcc]!.title,
                      };
                      persist();
                    }
                  } else {
                    console.warn(
                      `Balance da ${b.part} devolveu output sem header — total ficou em ${partTotal} (range ${range.min}-${range.max})`,
                    );
                  }
                }
              } else {
                console.warn(
                  `Balance da ${b.part} falhou — total ficou em ${partTotal}`,
                );
              }
            }
          }
        }

        if (ctrl.signal.aborted) {
          setLiveStream("");
          setBatchProgress(null);
          setIsGenerating(false);
          return;
        }

        // ═══ PHASE 2: revisor gramatical no roteiro inteiro ═════════════
        if (accChapters.length > 0) {
          setBatchProgress({
            kind: "revising-grammar",
            chaptersCount: accChapters.length,
          });
          setLiveStream("");

          const revRes = await fetch("/api/escrita-revisor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapters: accChapters.map((c) => ({
                number: c.number,
                title: c.title,
                part: c.part as "Parte 1" | "Parte 2",
                content: c.content,
              })),
            }),
            signal: ctrl.signal,
          });

          if (revRes.ok && revRes.body) {
            const revAcc = await readStreamFully(revRes);
            if (!ctrl.signal.aborted) {
              const revised = parseRevisedChapters(revAcc);
              if (revised.length > 0) {
                // Merge por (numero + parte) — capítulos têm o mesmo número
                // em Parte 1 e Parte 2, então preciso considerar a ordem
                // também. Estratégia: caminha em paralelo pelos arrays.
                // Se a ordem dos parseados bate, substitui; se não, fallback
                // por número dentro da mesma parte (raro mas seguro).
                if (revised.length === accChapters.length) {
                  for (let i = 0; i < accChapters.length; i++) {
                    const r = revised[i]!;
                    if (r.content) {
                      accChapters[i] = {
                        ...accChapters[i]!,
                        content: r.content,
                        title: r.title ?? accChapters[i]!.title,
                      };
                    }
                  }
                } else {
                  console.warn(
                    `Revisor devolveu ${revised.length} capítulos, esperava ${accChapters.length} — pulando merge`,
                  );
                }
                persist();
              } else {
                console.warn("Revisor devolveu output não parseável — pulando");
              }
            }
          } else {
            console.warn(
              `Revisor falhou: ${revRes.statusText} — capítulos ficam sem revisão final`,
            );
          }
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

    // ─── Branch padrão (outros steps): 1 request, 1 stream ──────────────
    try {
      const res = await fetch(`/api/agent/${step}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousOutputs: roteiro.outputs,
          userInput: roteiro.userInput,
          fastMode,
          referenceImage: roteiro.referenceImage,
          ...(mode === "refine" && {
            refineMode: true,
            currentOutput: baseContent,
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
        setDraft(acc);
        setOutput(step, {
          content: acc,
          generatedAt: startedAt,
        });
      }

      // No Revisor, parseamos o bloco <erros_detalhados> ao final pra
      // popular os cards de correção automática (com checkbox + apply).
      // O conteúdo principal fica sem o XML pra não poluir a leitura.
      if (step === "revisor" && acc.trim()) {
        const errors = parseRevisorErrors(acc);
        const cleanContent = stripErrosDetalhados(acc);
        setOutput(step, {
          content: cleanContent,
          metadata: { errors },
          generatedAt: startedAt,
        });
        setDraft(cleanContent);
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
    fastMode,
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
              fastMode
                ? "bg-amber-100 border-amber-400 text-amber-900"
                : "bg-background border-border text-muted-foreground hover:bg-muted",
            )}
            title={
              step === "escrita" || step === "revisor"
                ? "Troca de Opus pra Sonnet — mais rápido, qualidade ainda alta. Útil pra rodadas de teste."
                : "Troca de Sonnet pra Haiku — bem mais rápido, qualidade um pouco menor."
            }
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={fastMode}
              onChange={(e) => setFastMode(e.target.checked)}
            />
            <Rocket className="size-3.5" />
            Modo rápido
          </label>
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
                  <pre className="text-xs whitespace-pre-wrap font-sans bg-background border rounded-md p-3 max-h-40 overflow-auto">
                    {p.content}
                  </pre>
                </div>
              ) : null,
            )}
          </div>
        </details>
      )}

      {step === "premissa" ? (
        <PremissaEditor
          value={output?.content ?? ""}
          onChange={(v) =>
            setOutput("premissa", {
              content: v,
              generatedAt: output?.generatedAt ?? new Date().toISOString(),
            })
          }
        />
      ) : (
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
          placeholder={
            step === "escrita"
              ? "Ex.: deixe o tom mais intenso na Parte 2 · enfatize o conflito interno do MMC · adicione mais humor nos primeiros capítulos\n\n(Deixe vazio para o agente derivar 100% das estruturas aprovadas)"
              : idx === 0
                ? "Ex.: romance com executiva herdeira que retorna pra cidade natal..."
                : "Ex.: deixe o tom mais intenso, foco no conflito interno..."
          }
          value={pendingInput}
          onChange={(e) => setPendingInput(e.target.value)}
          rows={step === "escrita" ? 4 : 3}
          className="resize-none"
        />
        {/* Botão "Aplicar correção" — comita o ajuste local pro store. Sem
            esse clique, o texto digitado fica só local e a próxima geração
            usa o ajuste anterior (vazio na primeira vez). Visual indica
            estado: dirty (pendente) / aplicado / desabilitado. */}
        {(() => {
          const savedInput = roteiro.userInput ?? "";
          const isDirty = pendingInput !== savedInput;
          const hasContent = pendingInput.trim().length > 0;
          return (
            <div className="flex items-center justify-end gap-2 flex-wrap">
              {!isDirty && hasContent && (
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
                disabled={!isDirty || isGenerating}
                onClick={() => setUserInput(pendingInput)}
                className="gap-2"
                title={
                  isDirty
                    ? "Aplica a correção pra a próxima geração"
                    : hasContent
                      ? "Correção já aplicada — edite o texto pra reativar"
                      : "Digite uma correção primeiro"
                }
              >
                <Send className="size-3.5" />
                Aplicar correção
              </Button>
            </div>
          );
        })()}
      </section>
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (
                      step === "escrita" &&
                      chapters.length > 0
                    ) {
                      setDraft(chapters[chapters.length - 1]!.content);
                    } else {
                      setDraft(output?.content ?? "");
                    }
                    setIsEditing(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                  {step === "escrita" && chapters.length > 0
                    ? `Editar Cap ${chapters[chapters.length - 1]!.number}`
                    : "Editar"}
                </Button>
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
              <div className="rounded-lg border bg-card p-4 sm:p-5 max-h-[50vh] overflow-auto">
                <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
                  {output?.content}
                </pre>
              </div>
            )}
            {isGenerating && batchProgress && (
              <BatchProgressPanel
                progress={batchProgress}
                liveStream={liveStream}
              />
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
        ) : hasContent ? (
          <div className="rounded-lg border bg-card p-4 sm:p-5 max-h-[50vh] overflow-auto">
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
              {output?.content}
            </pre>
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
              <div className="flex items-center gap-2">
                <Wand2 className="size-4 text-primary" />
                <Label className="text-sm font-semibold">
                  Correção automática
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  marque os erros que quer aplicar e clique em &quot;Aplicar&quot; — o
                  trecho corrigido substitui o original no roteiro do Step 4
                </span>
              </div>
              <RevisorErrorsView
                errors={output!.metadata!.errors!}
              />
            </div>
          )}

        <div className="flex items-center gap-2 flex-wrap pt-2">
          {!isGenerating ? (
            <>
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
              {hasContent && (
                <Button
                  onClick={() => generate("refine")}
                  size="lg"
                  variant="outline"
                  className="gap-2"
                  disabled={!roteiro.userInput?.trim()}
                  title={
                    !roteiro.userInput?.trim()
                      ? "Escreva a correção na caixa 'Instruções adicionais' acima"
                      : "Aplica a correção sem regenerar do zero — mantém o resto intacto"
                  }
                >
                  <Send className="size-4" />
                  Aplicar correção
                </Button>
              )}
              {fastMode && (
                <span className="text-[11px] text-amber-700 flex items-center gap-1 px-2 py-1 rounded bg-amber-50 border border-amber-200">
                  <Rocket className="size-3" />
                  {step === "escrita" || step === "revisor"
                    ? "Sonnet (rápido)"
                    : "Haiku (rápido)"}
                </span>
              )}
            </>
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
              <CopyEscritaButton roteiro={roteiro} />
              <DownloadEscritaButton roteiro={roteiro} />
            </>
          )}
          {step === "revisor" && (
            <>
              <CopyEscritaButton roteiro={roteiro} />
              <DownloadEscritaButton roteiro={roteiro} />
              <GoogleDocsButton roteiro={roteiro} />
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

interface PremissaEditorProps {
  value: string;
  onChange: (v: string) => void;
}

function PremissaEditor({ value, onChange }: PremissaEditorProps) {
  const wordCount = value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const hasContent = value.trim().length > 0;
  const tooLong = wordCount > 1000;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="premissa-text" className="text-sm font-semibold">
            Cole a premissa pronta
          </Label>
          <span className="text-[11px] text-muted-foreground">
            Parte 1 + Parte 2 (até 500 palavras cada). Salva automaticamente.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasContent && (
            <Badge
              className={cn(
                "font-normal gap-1",
                tooLong
                  ? "bg-amber-100 text-amber-800 border-amber-300"
                  : "bg-emerald-100 text-emerald-800 border-emerald-300",
              )}
            >
              <CheckCircle2 className="size-3" />
              Salvo · {wordCount.toLocaleString("pt-BR")} palavra
              {wordCount === 1 ? "" : "s"}
              {tooLong ? " (acima do limite)" : ""}
            </Badge>
          )}
        </div>
      </div>

      <div className="rounded-md border border-primary/25 bg-primary/[0.04] px-4 py-3 flex items-start gap-2.5">
        <Sparkles className="size-4 text-primary mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-primary">
            A automação absorve esta premissa nas próximas etapas
          </p>
          <p className="text-[11px] text-foreground/75 leading-relaxed">
            Tudo que você colar aqui é injetado automaticamente nos Steps 2
            (Estrutura — Parte 1), 3 (Estrutura — Parte 2) e 4 (Escrita).
            Os agentes geram as estruturas e os capítulos a partir
            <span className="font-semibold"> exatamente</span> dessa premissa
            — sem digitar de novo. Se você editar e voltar a avançar, a
            próxima geração já usa a versão nova.
          </p>
        </div>
      </div>

      <Textarea
        id="premissa-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Cole aqui a premissa completa.\n\nFormato sugerido:\n\n# PARTE 1\n[texto corrido — até 500 palavras]\n\n# PARTE 2\n[texto corrido — até 500 palavras]`}
        rows={20}
        className="font-sans text-[14px] leading-relaxed resize-y min-h-[400px]"
      />

      <ReferenceImageUpload />

      {!hasContent && (
        <div className="rounded-md border border-dashed bg-muted/20 px-4 py-3 flex items-start gap-2">
          <Sparkles className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Esta etapa é <span className="font-semibold">manual</span> — quem
            escreve a premissa é o roteirista. Cole o texto pronto acima e
            clique em <span className="font-semibold">Avançar</span> pra
            seguir pra Estrutura.
          </p>
        </div>
      )}
    </section>
  );
}

function EscritaOutputView({ output }: { output: StepOutput }) {
  const chapters = output.metadata?.chapters ?? [];
  const memory = output.metadata?.memory;
  const report = output.metadata?.report;
  const validation = output.metadata?.validation;
  const validationStatus = output.metadata?.validationStatus;

  // Fallback — output sem chapters[]: renderiza monolítico (output cru).
  if (chapters.length === 0) {
    return (
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="flex flex-col divide-y divide-border/60">
          <SectionBanner label="CAPÍTULO" />
          <div className="px-4 sm:px-5 py-4">
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
              {output.content}
            </pre>
          </div>
          {report && (
            <>
              <SectionBanner label="RELATÓRIO DE AUTO-REVISÃO" />
              <div className="px-4 sm:px-5 py-4">
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground/85">
                  {report}
                </pre>
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
              <div className="px-4 sm:px-5 py-4">
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground/85">
                  {validation}
                </pre>
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
          return <ChapterCard key={i} chapter={ch} defaultOpen={isLast} />;
        })}
      </div>

      {report && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <SectionBanner label="RELATÓRIO DE AUTO-REVISÃO" />
          <div className="px-4 sm:px-5 py-4">
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground/85">
              {report}
            </pre>
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
          <div className="px-4 sm:px-5 py-4">
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-foreground/85">
              {validation}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ChapterCard({
  chapter,
  defaultOpen,
}: {
  chapter: EscritaChapter;
  defaultOpen: boolean;
}) {
  const titleLabel = chapter.title
    ? `Capítulo ${chapter.number} — ${chapter.title}`
    : `Capítulo ${chapter.number}`;

  return (
    <details
      open={defaultOpen}
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
              // Conta palavras reais do conteúdo (mais confiável que o número
              // que o agente diz que escreveu).
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
        <div className="px-4 sm:px-5 py-4">
          <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
            {chapter.content}
          </pre>
          {chapter.cliffhanger && (
            <p className="text-[12px] text-foreground/70 mt-3 italic border-l-2 border-primary/40 pl-3">
              <span className="font-semibold not-italic text-primary/80">
                Cliffhanger:
              </span>{" "}
              {chapter.cliffhanger}
            </p>
          )}
          {chapter.edited && (
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
  progress: EscritaProgress;
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
  } else if (progress.kind === "fixing-wordcount") {
    const verb = progress.direction === "expand" ? "Expandindo" : "Encurtando";
    title = `Ajustando contagem do Cap ${progress.chapterNumber}`;
    subtitle = `· ${verb} de ${progress.currentWords.toLocaleString("pt-BR")} → ${progress.targetWords.toLocaleString("pt-BR")} palavras (${progress.part})`;
    placeholder = "Reescrevendo capítulo dentro do alvo…";
  } else {
    // revising-grammar
    title = "Revisão gramatical final";
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
        <pre
          className={cn(
            "text-xs whitespace-pre-wrap bg-background border rounded-md p-3 max-h-80 overflow-auto",
            monospace ? "font-mono" : "font-sans leading-relaxed",
          )}
        >
          {content}
        </pre>
      </div>
    </details>
  );
}
