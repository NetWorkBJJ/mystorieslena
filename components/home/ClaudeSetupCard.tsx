"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClaudeStatus } from "@/types/electron-bridge";

type State =
  | { kind: "loading" }
  | { kind: "no-bridge" } // rodando no navegador, não no Electron
  | { kind: "connected" }
  | { kind: "needs-setup" }
  | { kind: "no-binary" } // CLI não foi encontrado (instalação corrompida)
  | { kind: "opening-terminal" }
  | { kind: "waiting-login" }
  | { kind: "error"; message: string };

/**
 * Card mostrado na home quando a usuária ainda não conectou a conta Claude.
 * Abre uma janela externa do Terminal/CMD rodando o `claude` CLI bundleado,
 * onde ela digita `/login` pra iniciar o OAuth. Depois de logar, clica em
 * "Já loguei, verificar" e o card vira o estado "conectado".
 *
 * Esconde sozinho se rodar fora do Electron (preview pelo navegador).
 */
export function ClaudeSetupCard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refreshStatus = useCallback(async (): Promise<ClaudeStatus | null> => {
    const bridge = window.mystorieslena;
    if (!bridge) {
      setState({ kind: "no-bridge" });
      return null;
    }
    try {
      const status = await bridge.getClaudeStatus();
      if (!status.hasBinary) {
        setState({ kind: "no-binary" });
      } else if (status.loggedIn) {
        setState({ kind: "connected" });
      } else {
        setState((prev) =>
          prev.kind === "waiting-login" || prev.kind === "opening-terminal"
            ? prev
            : { kind: "needs-setup" },
        );
      }
      return status;
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleSetup = useCallback(async () => {
    const bridge = window.mystorieslena;
    if (!bridge) return;
    setState({ kind: "opening-terminal" });
    const r = await bridge.setupClaude();
    if (!r.ok) {
      setState({
        kind: "error",
        message: r.reason ?? "Falha ao abrir o terminal de configuração.",
      });
      return;
    }
    setState({ kind: "waiting-login" });
  }, []);

  const handleVerify = useCallback(async () => {
    setState({ kind: "loading" });
    await refreshStatus();
  }, [refreshStatus]);

  // No navegador (sem bridge), esconde o card pra não confundir.
  if (state.kind === "no-bridge" || state.kind === "loading") {
    return null;
  }

  if (state.kind === "connected") {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
        <CheckCircle2 className="size-4" />
        <span>Conta Claude conectada — tudo pronto pra gerar roteiros.</span>
      </div>
    );
  }

  if (state.kind === "no-binary") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
        <div className="flex items-center gap-2 font-medium">
          <ShieldAlert className="size-4" />
          Claude CLI não encontrado no app
        </div>
        <p className="mt-1 text-xs text-red-800/80">
          Isso indica uma instalação corrompida. Reinstale o MyStoriesLena pela
          última release no GitHub.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3.5 flex flex-col gap-3",
        state.kind === "error"
          ? "border-red-200 bg-red-50"
          : "border-amber-200 bg-amber-50",
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert
          className={cn(
            "size-4 mt-0.5 shrink-0",
            state.kind === "error" ? "text-red-700" : "text-amber-700",
          )}
        />
        <div className="flex-1">
          <p
            className={cn(
              "text-sm font-medium",
              state.kind === "error" ? "text-red-900" : "text-amber-900",
            )}
          >
            {state.kind === "error"
              ? "Erro ao configurar Claude"
              : "Conecte sua conta Claude pra começar"}
          </p>
          <p
            className={cn(
              "text-xs mt-0.5",
              state.kind === "error" ? "text-red-800/80" : "text-amber-800/90",
            )}
          >
            {state.kind === "error"
              ? state.message
              : "O MyStoriesLena usa sua assinatura Claude Pro/Max. É só logar uma vez — depois não precisa mexer mais."}
          </p>
        </div>
      </div>

      {state.kind === "waiting-login" && (
        <div className="rounded-md bg-white/70 border border-amber-300 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
          <p className="font-medium mb-1">Próximo passo:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>
              Vá pra janela do <strong>Terminal</strong> (ou CMD) que acabou de
              abrir.
            </li>
            <li>
              Digite <code className="px-1 py-0.5 rounded bg-amber-100 font-mono">/login</code>{" "}
              e aperte Enter.
            </li>
            <li>O navegador abre — faça login na sua conta Claude.</li>
            <li>Volte aqui e clique no botão abaixo pra verificar.</li>
          </ol>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(state.kind === "needs-setup" || state.kind === "error") && (
          <Button
            size="sm"
            onClick={handleSetup}
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
          >
            <ExternalLink className="size-3.5" />
            Conectar conta Claude
          </Button>
        )}

        {state.kind === "opening-terminal" && (
          <Button size="sm" disabled className="gap-2">
            <Loader2 className="size-3.5 animate-spin" />
            Abrindo terminal…
          </Button>
        )}

        {state.kind === "waiting-login" && (
          <Button
            size="sm"
            onClick={handleVerify}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <RefreshCw className="size-3.5" />
            Já loguei — verificar
          </Button>
        )}

        {(state.kind === "needs-setup" ||
          state.kind === "waiting-login" ||
          state.kind === "error") && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleVerify}
            className="gap-2 text-xs"
          >
            <RefreshCw className="size-3.5" />
            Verificar status
          </Button>
        )}
      </div>
    </div>
  );
}
