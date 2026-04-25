"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
  Download,
  FileText,
  Loader2,
  Pencil,
  Rocket,
  RotateCcw,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  STEP_LABELS,
  STEP_ORDER,
  nextStep,
  prevStep,
  type EscritaChapter,
  type StepId,
  type StepOutput,
} from "@/types/roteiro";
import { useWizard } from "@/store/wizard";
import { AGENTS } from "@/lib/agents";
import {
  filterMemoryBlockForDisplay,
  parseEscritaOutput,
} from "@/lib/parse-escrita-output";
import { MemoryVivaCard } from "@/components/wizard/MemoryVivaCard";
import {
  WordCountBadge,
  countWords,
} from "@/components/wizard/WordCountBadge";
import { HistoryPanel } from "@/components/wizard/HistoryPanel";
import { GoogleDocsButton } from "@/components/wizard/GoogleDocsButton";
import { DownloadEscritaButton } from "@/components/wizard/DownloadEscritaButton";
import { CopyEscritaButton } from "@/components/wizard/CopyEscritaButton";
import { cn } from "@/lib/utils";

const PART_BANNER = (part: string) =>
  `═══════════════════════════════════════\n${part.toUpperCase()}\n═══════════════════════════════════════`;

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
      // Total = Parte 1 (~11.500) + Parte 2 (~13.000-13.500) ≈ 24.300-25.200
      return { min: 24300, max: 25200, label: "Total" };
    }
    return {};
  }, [step]);

  const generate = useCallback(async () => {
    if (!roteiro) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Antes de gerar, salva o output atual no histórico (incluindo Escrita,
    // que agora gera tudo de uma vez — a versão anterior é preservada).
    if (output?.content?.trim()) {
      pushOutputToHistory(step);
    }

    setIsGenerating(true);
    setDraft("");
    setLiveStream("");
    const startedAt = new Date().toISOString();
    setOutput(step, { content: "", generatedAt: startedAt });

    try {
      const res = await fetch(`/api/agent/${step}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previousOutputs: roteiro.outputs,
          userInput: roteiro.userInput,
          fastMode,
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

        if (step === "escrita") {
          // Stream cru fica visível (com tarjas ROTEIRO / PARTE 1 / PARTE 2
          // / RELATÓRIO / VALIDAÇÃO) — só o bloco bruto do JSON da Memória
          // Viva vira placeholder elegante até o stream terminar.
          setLiveStream(filterMemoryBlockForDisplay(acc));
        } else {
          setDraft(acc);
          setOutput(step, {
            content: acc,
            generatedAt: startedAt,
          });
        }
      }

      // Stream terminou. No caso da Escrita, parseamos o acumulado completo:
      // o roteiro vira o `content`, e capítulos individuais + relatório +
      // memória + validação vão para metadata.
      if (step === "escrita" && acc.trim()) {
        const parsed = parseEscritaOutput(acc);
        const structured: StepOutput = {
          content: parsed.roteiro || acc,
          metadata: {
            memory: parsed.memory,
            chapters: parsed.chapters,
            report: parsed.report,
            validation: parsed.validation,
            ...(parsed.validationStatus && {
              validationStatus: parsed.validationStatus,
            }),
          },
          generatedAt: startedAt,
        };
        setOutput(step, structured);
        setDraft(parsed.roteiro || acc);
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

  const downloadAll = useCallback(() => {
    if (!roteiro) return;
    const body = STEP_ORDER.map((s) => {
      const c = roteiro.outputs[s]?.content;
      if (!c) return null;
      return `# ${STEP_LABELS[s]}\n\n${c}\n`;
    })
      .filter(Boolean)
      .join("\n---\n\n");
    const blob = new Blob([`# ${roteiro.title}\n\n${body}`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${roteiro.title.replace(/[^\w\s-]/g, "").trim() || "roteiro"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [roteiro]);

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
          value={roteiro.userInput ?? ""}
          onChange={(e) => setUserInput(e.target.value)}
          rows={step === "escrita" ? 4 : 3}
          className="resize-none"
        />
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
        ) : isGenerating && step === "escrita" && liveStream ? (
          <div className="rounded-lg border bg-card p-4 sm:p-5 max-h-[60vh] overflow-auto">
            <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
              {liveStream}
            </pre>
          </div>
        ) : hasContent && step === "escrita" ? (
          <EscritaOutputView output={output!} />
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

        <div className="flex items-center gap-2 flex-wrap pt-2">
          {!isGenerating ? (
            <>
              <Button onClick={generate} size="lg" className="gap-2">
                {step === "escrita" && chapterCount > 0 ? (
                  <ArrowRight className="size-4" />
                ) : hasContent ? (
                  <RotateCcw className="size-4" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {generateLabel}
              </Button>
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
              <Button variant="outline" onClick={downloadAll} className="gap-2">
                <Download className="size-4" />
                Baixar .md
              </Button>
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
