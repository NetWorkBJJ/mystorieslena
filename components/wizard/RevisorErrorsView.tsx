"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertTriangle,
  Wand2,
  Loader2,
} from "lucide-react";
import type { RevisorError } from "@/types/roteiro";
import {
  gravityLabel,
  hashEscritaContent,
  inferPartFromContent,
} from "@/lib/parse-revisor-output";
import {
  applySuggestionToScope,
  isInformativoError,
} from "@/lib/apply-suggestion";
import { useWizard } from "@/store/wizard";
import { cn } from "@/lib/utils";

interface Props {
  errors: RevisorError[];
  /** Hash do conteúdo da Escrita NO MOMENTO em que a revisão foi gerada. */
  escritaSnapshotHash?: string;
}

const GRAVITY_CIRCLE: Record<RevisorError["gravidade"], string> = {
  naoInterfere: "bg-emerald-200 text-emerald-900",
  atencao: "bg-amber-200 text-amber-900",
  interfere: "bg-orange-200 text-orange-900",
  gravissimo: "bg-red-200 text-red-900",
};

const GRAVITY_PILL: Record<RevisorError["gravidade"], string> = {
  naoInterfere: "bg-emerald-100 text-emerald-900 border-emerald-300",
  atencao: "bg-amber-100 text-amber-900 border-amber-300",
  interfere: "bg-orange-100 text-orange-900 border-orange-300",
  gravissimo: "bg-red-100 text-red-900 border-red-300",
};

export function RevisorErrorsView({ errors, escritaSnapshotHash }: Props) {
  const applyOne = useWizard((s) => s.applyRevisorCorrection);
  const applyMany = useWizard((s) => s.applyRevisorCorrections);
  const setOutput = useWizard((s) => s.setOutput);
  const pushOutputToHistory = useWizard((s) => s.pushOutputToHistory);
  const escritaOutput = useWizard((s) => s.roteiro?.outputs.escrita);
  const revisorOutput = useWizard((s) => s.roteiro?.outputs.revisor);
  const escritaContent = escritaOutput?.content ?? "";

  const pendingErrors = useMemo(
    () => errors.filter((e) => !e.applied),
    [errors],
  );
  const appliedErrors = useMemo(
    () => errors.filter((e) => e.applied),
    [errors],
  );
  // Erros aplicáveis automaticamente — têm trecho_original/trecho_corrigido.
  // Erros transversais (sem trecho) viram "sugestão da IA" — também aplicáveis,
  // mas via reescrita LLM em vez de find+replace.
  const pendingApplicable = useMemo(
    () => pendingErrors.filter((e) => !isInformativoError(e)),
    [pendingErrors],
  );
  const informativeCount = useMemo(
    () => errors.filter(isInformativoError).length,
    [errors],
  );

  /**
   * Aplica uma sugestão de erro transversal manualmente (botão "Aplicar
   * sugestão" — fallback caso a aplicação automática durante a geração
   * tenha falhado). Usa o mesmo helper compartilhado que o fluxo automático.
   */
  const applySuggestion = useCallback(
    async (
      errorId: string,
      opts: { signal?: AbortSignal; onChunk?: (acc: string) => void } = {},
    ): Promise<{ applied: boolean }> => {
      const err = errors.find((e) => e.id === errorId);
      if (!err || !escritaOutput?.content || !revisorOutput) {
        return { applied: false };
      }

      pushOutputToHistory(
        "escrita",
        `Antes da sugestão IA do Erro #${err.numero}`,
      );

      const result = await applySuggestionToScope({
        error: err,
        escritaContent: escritaOutput.content,
        chapters: escritaOutput.metadata?.chapters ?? [],
        signal: opts.signal,
        onChunk: opts.onChunk,
      });

      if (
        !result.applied ||
        !result.newContent ||
        !result.newChapters
      ) {
        return { applied: false };
      }

      const now = new Date().toISOString();

      setOutput("escrita", {
        ...escritaOutput,
        content: result.newContent,
        metadata: {
          ...escritaOutput.metadata,
          chapters: result.newChapters,
        },
        edited: true,
        editedAt: now,
      });

      const updatedErrors = errors.map((e) =>
        e.id === errorId ? { ...e, applied: true, appliedAt: now } : e,
      );
      setOutput("revisor", {
        ...revisorOutput,
        metadata: {
          ...revisorOutput.metadata,
          errors: updatedErrors,
        },
      });

      return { applied: true };
    },
    [errors, escritaOutput, revisorOutput, setOutput, pushOutputToHistory],
  );

  // Detecta se a Escrita foi editada depois da revisão.
  const escritaChangedSinceRevisor = useMemo(() => {
    if (!escritaSnapshotHash || !escritaContent) return false;
    return hashEscritaContent(escritaContent) !== escritaSnapshotHash;
  }, [escritaSnapshotHash, escritaContent]);

  if (errors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-6 text-center">
        <CheckCircle2 className="size-6 mx-auto text-emerald-600 mb-2" />
        <p className="text-sm text-muted-foreground">
          Nenhum erro estruturado foi extraído da revisão. O agente pode não ter
          gerado o bloco <code>&lt;erros_detalhados&gt;</code> — gere a revisão
          de novo se quiser usar a correção automática.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">
            {errors.length} erro{errors.length === 1 ? "" : "s"} estruturado
            {errors.length === 1 ? "" : "s"}
          </span>
          {appliedErrors.length > 0 && (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-normal gap-1">
              <CheckCircle2 className="size-3" />
              {appliedErrors.length} aplicado
              {appliedErrors.length === 1 ? "" : "s"}
            </Badge>
          )}
          {pendingErrors.length > 0 && (
            <Badge variant="outline" className="font-normal">
              {pendingErrors.length} pendente
              {pendingErrors.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        {pendingApplicable.length > 1 && escritaContent && (
          <ApplyAllButton
            pendingIds={pendingApplicable.map((e) => e.id)}
            onApply={(ids) =>
              applyMany(ids, "Antes de aplicar todas as correções pendentes")
            }
          />
        )}
      </div>

      {!escritaContent && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="size-4 text-amber-700 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900 leading-relaxed">
            O Step 4 (Escrita) está vazio — sem roteiro, não dá pra aplicar
            correção automática. Volte ao Step 4 e gere o roteiro antes.
          </p>
        </div>
      )}

      {escritaChangedSinceRevisor && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="size-4 text-amber-700 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900 leading-relaxed">
            O roteiro do Step 4 foi editado depois desta revisão. Algumas
            correções podem não bater literalmente — a aplicação tenta um
            match tolerante (aspas/travessões/espaços), mas se mudou conteúdo,
            o card vai mostrar &quot;trecho não encontrado&quot;. Gere a revisão de
            novo se quiser garantia.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {errors.map((err) => {
          // Fallback: se o agente não emitiu `parte` no XML (revisões
          // antigas), tenta inferir buscando o trecho no roteiro.
          const parte =
            err.parte ?? inferPartFromContent(escritaContent, err.trechoOriginal);
          const enrichedErr = parte ? { ...err, parte } : err;
          return (
            <ErrorCard
              key={err.id}
              error={enrichedErr}
              disabled={!escritaContent}
              onApply={() => applyOne(err.id)}
              onApplySuggestion={(opts) => applySuggestion(err.id, opts)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ApplyAllButton({
  pendingIds,
  onApply,
}: {
  pendingIds: string[];
  onApply: (ids: string[]) => { applied: string[]; failed: string[] };
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    applied: number;
    failed: number;
  } | null>(null);

  const handle = () => {
    startTransition(() => {
      const result = onApply(pendingIds);
      setFeedback({
        applied: result.applied.length,
        failed: result.failed.length,
      });
    });
  };

  return (
    <div className="flex items-center gap-2">
      {feedback && (
        <span className="text-[11px] text-muted-foreground">
          {feedback.applied > 0 && `${feedback.applied} aplicada(s)`}
          {feedback.applied > 0 && feedback.failed > 0 && " · "}
          {feedback.failed > 0 && `${feedback.failed} sem match`}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handle}
        disabled={pending}
        className="gap-2"
        title={`Aplica de uma vez todas as ${pendingIds.length} correções pendentes`}
      >
        {pending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Wand2 className="size-3" />
        )}
        Aplicar todas pendentes ({pendingIds.length})
      </Button>
    </div>
  );
}

interface CardProps {
  error: RevisorError;
  disabled: boolean;
  onApply: () => { applied: boolean; found: boolean };
  onApplySuggestion: (opts: {
    signal: AbortSignal;
    onChunk: (acc: string) => void;
  }) => Promise<{ applied: boolean }>;
}

function ErrorCard({
  error,
  disabled,
  onApply,
  onApplySuggestion,
}: CardProps) {
  const { emoji, label } = gravityLabel(error.gravidade);
  const [pending, startTransition] = useTransition();
  const [suggestionPending, setSuggestionPending] = useState(false);
  const [localFailed, setLocalFailed] = useState(false);
  const [livePreview, setLivePreview] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Erro "transversal" — sem trecho_original literal pra fazer find+replace.
  // O botão de aplicar dispara a reescrita LLM com a sugestão da IA (e o
  // card visualmente enfatiza que é uma SUGESTÃO). Pode demorar — por isso
  // o botão vira "Cancelar correção" enquanto a chamada está em curso.
  const isInformativo = isInformativoError(error);

  const handleApply = () => {
    setLocalFailed(false);
    startTransition(() => {
      const result = onApply();
      if (!result.applied) setLocalFailed(true);
    });
  };

  const handleApplySuggestion = async () => {
    setLocalFailed(false);
    setLivePreview("");
    setSuggestionPending(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await onApplySuggestion({
        signal: ctrl.signal,
        onChunk: (acc) => {
          if (!ctrl.signal.aborted) setLivePreview(acc);
        },
      });
      if (!result.applied && !ctrl.signal.aborted) setLocalFailed(true);
    } finally {
      abortRef.current = null;
      setSuggestionPending(false);
      setLivePreview("");
    }
  };

  const handleCancelSuggestion = () => {
    abortRef.current?.abort();
  };

  // Append "(Parte N)" no título se a parte é conhecida E o agente ainda
  // não colocou isso no titulo (alguns títulos já vêm com a info — não
  // queremos duplicar pra "...(Parte 2) (Parte 2)").
  const titleHasParte = /\(Parte\s+[12]\)/i.test(error.titulo ?? "");
  const tituloComParte =
    error.titulo && error.parte && !titleHasParte
      ? `${error.titulo} (Parte ${error.parte})`
      : error.titulo;
  const titleLabel = tituloComParte
    ? `Erro #${error.numero} — ${tituloComParte}`
    : `Erro #${error.numero}`;

  return (
    <details
      open={false}
      className={cn(
        "group rounded-lg border bg-card overflow-hidden transition",
        error.applied && "opacity-70",
      )}
    >
      <summary className="list-none cursor-pointer px-4 sm:px-5 py-3 flex items-center gap-3 bg-muted/30 hover:bg-muted/50 transition">
        <span
          className={cn(
            "size-8 rounded-full text-xs font-bold flex items-center justify-center shrink-0",
            GRAVITY_CIRCLE[error.gravidade],
          )}
        >
          {error.numero}
        </span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-serif text-base tracking-tight truncate">
            {titleLabel}
          </span>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <span
              className={cn(
                "text-[10px] font-medium px-2 py-0.5 rounded border uppercase tracking-wide",
                GRAVITY_PILL[error.gravidade],
              )}
            >
              {emoji} {label}
            </span>
            {typeof error.capitulo === "number" && (
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                Cap. {error.capitulo}
              </span>
            )}
            {error.applied && (
              <Badge className="bg-emerald-100 text-emerald-900 border-emerald-400 font-semibold gap-1.5 text-[11px] px-2 py-0.5">
                <CheckCircle2 className="size-3.5" />
                APLICADO
                {error.appliedAt && (
                  <span className="font-normal normal-case opacity-80">
                    em {new Date(error.appliedAt).toLocaleString("pt-BR")}
                  </span>
                )}
              </Badge>
            )}
            {localFailed && !error.applied && (
              <span className="text-[10px] text-amber-700 uppercase tracking-wide">
                trecho não encontrado
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

      <div className="px-4 sm:px-5 py-4 flex flex-col gap-4 border-t">
        {error.trechoOriginal?.trim() && (
          <Section
            label="📍 Trecho original"
            content={error.trechoOriginal}
            tone="original"
          />
        )}
        {error.trechoCorrigido?.trim() && (
          <Section
            label={isInformativo ? "🛠️ Ação sugerida" : "✏️ Trecho corrigido"}
            content={error.trechoCorrigido}
            tone="fixed"
          />
        )}
        {error.porqueAlterado && (
          <Section
            label="💡 Por que foi alterado"
            content={error.porqueAlterado}
            tone="reason"
          />
        )}

        <div className="flex items-center gap-2 flex-wrap pt-1">
          {error.applied ? (
            <Button
              variant="ghost"
              size="sm"
              disabled
              className="gap-2 text-emerald-700"
            >
              <CheckCircle2 className="size-4" />
              Correção aplicada no roteiro
            </Button>
          ) : suggestionPending ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelSuggestion}
              className="gap-2 border-amber-400 text-amber-900 hover:bg-amber-50"
              title="Cancela a reescrita em andamento — o roteiro do Step 4 não é alterado"
            >
              <Loader2 className="size-4 animate-spin" />
              Cancelar correção
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={isInformativo ? handleApplySuggestion : handleApply}
              disabled={disabled || pending}
              className="gap-2"
              title={
                disabled
                  ? "Gere o roteiro no Step 4 primeiro"
                  : isInformativo &&
                    error.parte &&
                    typeof error.capitulo === "number"
                  ? `Opus reescreve só o Cap. ${error.capitulo} da Parte ${error.parte} aplicando a sugestão (preview ao vivo no card)`
                  : isInformativo && error.parte
                  ? `Opus reescreve só a Parte ${error.parte} aplicando a sugestão (preview ao vivo no card)`
                  : isInformativo
                  ? "Opus reescreve o roteiro inteiro aplicando a sugestão (preview ao vivo no card)"
                  : "Substitui o trecho original pelo corrigido no roteiro do Step 4"
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              {pending ? "Aplicando…" : "Aplicar essa correção"}
            </Button>
          )}
          {localFailed && !error.applied && !isInformativo && (
            <span className="text-xs text-amber-800 leading-relaxed">
              O trecho original não foi encontrado no roteiro (mesmo com match
              tolerante). Pode ter sido editado depois da revisão — aplique
              manualmente ou regere a revisão.
            </span>
          )}
          {localFailed && !error.applied && isInformativo && (
            <span className="text-xs text-amber-800 leading-relaxed">
              Falha ao aplicar a correção — verifique o console e tente
              novamente, ou aplique manualmente no Step 4.
            </span>
          )}
        </div>

        {suggestionPending && (
          <LivePreviewBox text={livePreview} />
        )}
      </div>
    </details>
  );
}

function LivePreviewBox({ text }: { text: string }) {
  // Mantém a última linha visível conforme Opus escreve. Sem auto-scroll
  // o usuário fica olhando o início travado enquanto o texto cresce.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const charCount = text.length;
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
          ✨ Opus reescrevendo ao vivo
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {charCount.toLocaleString("pt-BR")} caracteres
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed border-l-2 border-l-primary/40 bg-primary/5 text-foreground/80 pl-4 pr-3 py-2.5 rounded-r-md"
      >
        {text || (
          <span className="italic text-muted-foreground">
            Aguardando primeiro chunk do Opus…
          </span>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  content,
  tone,
}: {
  label: string;
  content: string;
  tone: "original" | "fixed" | "reason";
}) {
  const toneClasses: Record<typeof tone, string> = {
    original: "border-l-amber-400 bg-amber-50/60 text-amber-950",
    fixed: "border-l-emerald-500 bg-emerald-50/60 text-emerald-950",
    reason: "border-l-primary/40 bg-primary/5 text-foreground",
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
        {label}
      </span>
      <div
        className={cn(
          "whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed border-l-2 pl-4 pr-3 py-2.5 rounded-r-md",
          toneClasses[tone],
        )}
      >
        {content}
      </div>
    </div>
  );
}
