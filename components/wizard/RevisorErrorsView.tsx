"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Wand2 } from "lucide-react";
import type { RevisorError } from "@/types/roteiro";
import { gravityLabel } from "@/lib/parse-revisor-output";
import { useWizard } from "@/store/wizard";
import { cn } from "@/lib/utils";

interface Props {
  errors: RevisorError[];
}

const GRAVITY_PILL: Record<RevisorError["gravidade"], string> = {
  atencao: "bg-amber-100 text-amber-900 border-amber-300",
  interfere: "bg-orange-100 text-orange-900 border-orange-300",
  gravissimo: "bg-red-100 text-red-900 border-red-300",
};

export function RevisorErrorsView({ errors }: Props) {
  const applyCorrections = useWizard((s) => s.applyRevisorCorrections);
  const escritaContent = useWizard(
    (s) => s.roteiro?.outputs.escrita?.content ?? "",
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<{
    applied: string[];
    failed: string[];
  } | null>(null);

  const pendingErrors = useMemo(
    () => errors.filter((e) => !e.applied),
    [errors],
  );
  const appliedErrors = useMemo(
    () => errors.filter((e) => e.applied),
    [errors],
  );

  const allSelected =
    pendingErrors.length > 0 &&
    pendingErrors.every((e) => selected.has(e.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingErrors.map((e) => e.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    if (selected.size === 0) return;
    const result = applyCorrections(Array.from(selected));
    setFeedback(result);
    // Tira do "selected" os que aplicaram com sucesso pra não tentar reaplicar
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of result.applied) next.delete(id);
      return next;
    });
  };

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
        {pendingErrors.length > 1 && (
          <Button variant="ghost" size="sm" onClick={toggleAll}>
            {allSelected ? "Desmarcar todos" : "Marcar todos pendentes"}
          </Button>
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

      <div className="flex flex-col gap-2">
        {errors.map((err) => (
          <ErrorCard
            key={err.id}
            error={err}
            checked={selected.has(err.id)}
            onToggle={() => toggleOne(err.id)}
            disabled={err.applied || !escritaContent}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-2">
        <Button
          onClick={handleApply}
          size="lg"
          className="gap-2"
          disabled={selected.size === 0 || !escritaContent}
          title={
            !escritaContent
              ? "Gere o roteiro no Step 4 primeiro"
              : selected.size === 0
                ? "Marque pelo menos um erro pra aplicar"
                : `Substitui ${selected.size} trecho${selected.size === 1 ? "" : "s"} no roteiro do Step 4`
          }
        >
          <Wand2 className="size-4" />
          Aplicar {selected.size > 0 ? `${selected.size} ` : ""}
          correç{selected.size === 1 ? "ão" : "ões"} no roteiro
        </Button>
      </div>

      {feedback && (
        <div
          className={cn(
            "rounded-md border px-4 py-3 flex flex-col gap-1",
            feedback.failed.length === 0
              ? "border-emerald-300 bg-emerald-50"
              : "border-amber-300 bg-amber-50",
          )}
        >
          {feedback.applied.length > 0 && (
            <p className="text-sm text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              {feedback.applied.length} correç
              {feedback.applied.length === 1 ? "ão" : "ões"} aplicada
              {feedback.applied.length === 1 ? "" : "s"} no Step 4 (Escrita).
            </p>
          )}
          {feedback.failed.length > 0 && (
            <p className="text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>
                {feedback.failed.length === 1
                  ? `1 correção (#${feedback.failed[0]}) não foi aplicada`
                  : `${feedback.failed.length} correções (#${feedback.failed.join(", #")}) não foram aplicadas`}{" "}
                — o trecho original não foi encontrado literalmente no roteiro.
                Pode ter sido editado depois da revisão. Aplique manualmente ou
                regere a revisão.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  error: RevisorError;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}

function ErrorCard({ error, checked, onToggle, disabled }: CardProps) {
  const { emoji, label } = gravityLabel(error.gravidade);
  return (
    <details
      className={cn(
        "group rounded-lg border bg-card overflow-hidden transition",
        error.applied ? "opacity-60" : "",
      )}
    >
      <summary className="list-none cursor-pointer px-4 sm:px-5 py-3 flex items-center gap-3 bg-muted/30 hover:bg-muted/50 transition">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          disabled={disabled}
          className="size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
          aria-label={`Marcar erro ${error.numero}`}
        />
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-serif text-base tracking-tight">
              Erro #{error.numero}
            </span>
            <span
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded border",
                GRAVITY_PILL[error.gravidade],
              )}
            >
              {emoji} {label}
            </span>
            {typeof error.capitulo === "number" && (
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Cap. {error.capitulo}
              </span>
            )}
            {error.applied && (
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-normal gap-1">
                <CheckCircle2 className="size-3" />
                Aplicado
              </Badge>
            )}
          </div>
          <span className="text-sm text-foreground/80 truncate">
            {error.titulo}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 group-open:hidden">
          abrir
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0 hidden group-open:inline">
          recolher
        </span>
      </summary>

      <div className="px-4 sm:px-5 py-4 flex flex-col gap-4 border-t">
        <Section
          label="Trecho original"
          content={error.trechoOriginal}
          tone="original"
        />
        <Section
          label="Trecho corrigido"
          content={error.trechoCorrigido}
          tone="fixed"
        />
        {error.porqueAlterado && (
          <Section
            label="Por que foi alterado"
            content={error.porqueAlterado}
            tone="reason"
          />
        )}
      </div>
    </details>
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
    original: "border-l-amber-400 bg-amber-50/40",
    fixed: "border-l-emerald-400 bg-emerald-50/40",
    reason: "border-l-primary/40 bg-primary/5",
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
        {label}
      </span>
      <pre
        className={cn(
          "whitespace-pre-wrap font-sans text-[14px] leading-relaxed border-l-2 pl-3 py-1",
          toneClasses[tone],
        )}
      >
        {content}
      </pre>
    </div>
  );
}
