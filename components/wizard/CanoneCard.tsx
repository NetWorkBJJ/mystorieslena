"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useWizard } from "@/store/wizard";

/**
 * Card de Cânone de Entidades — aparece dentro do step Premissa, abaixo do
 * conteúdo da premissa, e trava o avanço pra Estrutura P1 enquanto não
 * estiver aprovado (em roteiros novos). Roteiros legados sem cânone
 * aparecem com um banner "Gerar agora" não-bloqueante: a roteirista pode
 * seguir sem aprovar e o app funciona como antes.
 *
 * Fluxo:
 *   1. Roteirista clica "Gerar cânone" → POST /api/canone com a premissa
 *      atual; stream de markdown chega num textarea editável.
 *   2. Ela ajusta livremente (corrigir nome, idade, profissão, etc.).
 *   3. Clica "Aprovar cânone" → flag canoneApproved=true. A partir daí o
 *      cânone vira contexto canônico injetado em estrutura1/2, escrita,
 *      revisor, escrita-apply-suggestion (ver canone-rule.ts).
 *
 * Edição depois de aprovar invalida a aprovação automaticamente (store
 * setCanone) — força a roteirista a re-aprovar antes de avançar.
 */

// Lê stream de texto (Response do POST /api/canone) acumulando e atualizando
// `setLive` ~1×/frame. Mesmo padrão de `readStreamThrottled` do StepShell —
// duplicado aqui pra evitar dependência cruzada com o módulo gigante. Sem
// throttle, setState a cada chunk causava OOM em geração de markdown longo.
async function readStreamThrottled(
  res: Response,
  setLive: (v: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!res.body) throw new Error("Stream sem corpo");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  let pending: string | null = null;
  let rafId: number | null = null;
  const flush = () => {
    if (pending !== null) setLive(pending);
    pending = null;
    rafId = null;
  };
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      pending = acc;
      if (rafId === null && typeof requestAnimationFrame !== "undefined") {
        rafId = requestAnimationFrame(flush);
      }
    }
  } finally {
    if (rafId !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(rafId);
    }
    setLive(acc);
  }
  return acc;
}

export function CanoneCard() {
  const roteiro = useWizard((s) => s.roteiro);
  const setCanone = useWizard((s) => s.setCanone);
  const approveCanone = useWizard((s) => s.approveCanone);
  const clearCanone = useWizard((s) => s.clearCanone);

  const [isGenerating, setIsGenerating] = useState(false);
  const [liveStream, setLiveStream] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Quando uma nova geração termina, limpa o liveStream pra que o textarea
  // passe a refletir só o `roteiro.canone` (fonte de verdade persistida).
  // Sem isso, edições subsequentes ficavam sobrescritas pelo último chunk.
  useEffect(() => {
    if (!isGenerating) setLiveStream("");
  }, [isGenerating]);

  if (!roteiro) return null;

  const premissaContent = roteiro.outputs.premissa?.content?.trim() ?? "";
  const canone = roteiro.canone ?? "";
  const canoneApproved = !!roteiro.canoneApproved;
  const canoneTrim = canone.trim();
  const hasCanone = canoneTrim.length > 0;
  const displayedValue = isGenerating ? liveStream : canone;

  const canGenerate = premissaContent.length > 0 && !isGenerating;

  const generate = async () => {
    if (!canGenerate) return;
    setError(null);
    setLiveStream("");
    setIsGenerating(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/canone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ premissa: premissaContent }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const acc = await readStreamThrottled(res, setLiveStream, ctrl.signal);
      // setCanone invalida canoneApproved automaticamente se já estava aprovado
      // — força re-aprovação manual depois de regerar.
      setCanone(acc);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message || "Erro ao gerar cânone.");
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
  };

  // Roteiro sem premissa preenchida: card fica oculto (cânone só faz sentido
  // depois que tem texto na premissa). O StepShell já renderiza primeiro.
  if (premissaContent.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/30 dark:border-amber-900/40 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle>Cânone de Entidades</CardTitle>
        <CardDescription>
          Lista travada de nomes, idades, profissões, lugares, datas e relações
          extraídos da premissa. Vai como referência canônica em todos os
          próximos steps (Estrutura P1, Estrutura P2, Escrita e Revisor) — sem
          isso o modelo às vezes troca nomes ou inventa idades ao longo do
          roteiro.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {!hasCanone && !isGenerating && (
          <div className="rounded-md border border-amber-300/50 bg-amber-100/40 p-3 text-sm dark:border-amber-800/40 dark:bg-amber-900/20">
            Ainda não há cânone para esse roteiro. Clique em <strong>Gerar
            cânone</strong> para extrair as entidades da premissa. Você pode
            ajustar o texto antes de aprovar.
          </div>
        )}

        {isGenerating && (
          <div className="rounded-md border border-blue-300/50 bg-blue-50 p-3 text-sm dark:border-blue-800/40 dark:bg-blue-950/30">
            Extraindo entidades da premissa…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {(hasCanone || isGenerating) && (
          <Textarea
            value={displayedValue}
            onChange={(e) => {
              if (isGenerating) return; // evita corrida com stream
              setCanone(e.target.value);
            }}
            placeholder="O cânone aparecerá aqui após a geração — você pode editar livremente."
            className="min-h-[280px] font-mono text-xs"
            readOnly={isGenerating}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!isGenerating ? (
            <Button
              type="button"
              size="sm"
              variant={hasCanone ? "outline" : "default"}
              onClick={generate}
              disabled={!canGenerate}
            >
              {hasCanone ? "Regerar cânone" : "Gerar cânone"}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={cancel}>
              Cancelar geração
            </Button>
          )}

          {hasCanone && !isGenerating && (
            <>
              {canoneApproved ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                  ✓ Cânone aprovado
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={approveCanone}
                  disabled={!hasCanone}
                >
                  Aprovar cânone
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (
                    confirm(
                      "Limpar o cânone? Você poderá gerar de novo a partir da premissa.",
                    )
                  ) {
                    clearCanone();
                  }
                }}
              >
                Limpar
              </Button>
            </>
          )}
        </div>

        {hasCanone && !canoneApproved && !isGenerating && (
          <p className="text-xs text-amber-900/80 dark:text-amber-100/70">
            ⚠️ Aprove o cânone para destravar o avanço pra Estrutura — Parte 1.
            Em roteiros legados (sem cânone), o avanço continua liberado mas
            sem o reforço de consistência.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
