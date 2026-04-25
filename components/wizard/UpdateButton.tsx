"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  Check,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DownloadProgress,
  RuntimeInfo,
  UpdateEvent,
} from "@/types/electron-bridge";

type State =
  | { kind: "loading" } // checando runtime info
  | { kind: "unavailable"; reason: string } // dev/live/sem updater
  | { kind: "idle"; current: string } // pronto pra checar
  | { kind: "checking" }
  | { kind: "up-to-date"; current: string }
  | { kind: "available"; version: string }
  | { kind: "downloading"; progress: DownloadProgress }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

export function UpdateButton({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [info, setInfo] = useState<RuntimeInfo | null>(null);

  // Carrega runtime info na primeira renderização.
  useEffect(() => {
    const bridge = window.mystorieslena;
    if (!bridge) {
      setState({
        kind: "unavailable",
        reason:
          "Updates só disponíveis no app Electron instalado. Você está abrindo pelo navegador.",
      });
      return;
    }
    let cancelled = false;
    bridge
      .getRuntimeInfo()
      .then((rt) => {
        if (cancelled) return;
        setInfo(rt);
        if (!rt.updaterAvailable) {
          setState({
            kind: "unavailable",
            reason:
              rt.mode === "live"
                ? "Modo LIVE ativo (lendo da pasta de código). Atualizações automáticas só funcionam no .exe instalado normal."
                : rt.mode === "external-dev"
                  ? "Modo dev externo — sem updater."
                  : "Updater indisponível neste build.",
          });
        } else {
          setState({ kind: "idle", current: rt.version });
        }
      })
      .catch(() =>
        setState({ kind: "unavailable", reason: "Falha ao consultar runtime." }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  // Assina eventos do updater.
  useEffect(() => {
    const bridge = window.mystorieslena;
    if (!bridge) return;
    const unsubscribe = bridge.onUpdateEvent((event: UpdateEvent) => {
      switch (event.type) {
        case "checking-for-update":
          setState({ kind: "checking" });
          break;
        case "update-available":
          setState({
            kind: "available",
            version: event.payload?.version ?? "?",
          });
          break;
        case "update-not-available":
          setState((prev) =>
            prev.kind === "checking" || prev.kind === "idle"
              ? {
                  kind: "up-to-date",
                  current: info?.version ?? "?",
                }
              : prev,
          );
          break;
        case "download-progress":
          setState({ kind: "downloading", progress: event.payload });
          break;
        case "update-downloaded":
          setState({
            kind: "ready",
            version: event.payload?.version ?? "?",
          });
          break;
        case "error":
          setState({
            kind: "error",
            message: event.payload?.message ?? "erro desconhecido",
          });
          break;
      }
    });
    return unsubscribe;
  }, [info?.version]);

  const checkForUpdates = useCallback(async () => {
    const bridge = window.mystorieslena;
    if (!bridge) return;
    setState({ kind: "checking" });
    const r = await bridge.checkForUpdates();
    if (!r.ok) {
      setState({
        kind: "error",
        message: r.reason ?? "Falha ao verificar atualizações.",
      });
    }
    // Os eventos do updater (update-available / update-not-available) tomam conta do resto.
  }, []);

  const downloadNow = useCallback(async () => {
    const bridge = window.mystorieslena;
    if (!bridge) return;
    setState({
      kind: "downloading",
      progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 },
    });
    const r = await bridge.downloadUpdate();
    if (!r.ok) {
      setState({
        kind: "error",
        message: r.reason ?? "Falha ao baixar atualização.",
      });
    }
  }, []);

  const restartNow = useCallback(async () => {
    const bridge = window.mystorieslena;
    if (!bridge) return;
    await bridge.quitAndInstall();
  }, []);

  // ─── render por estado ────────────────────────────────────────────────────
  if (state.kind === "loading") {
    return null;
  }

  if (state.kind === "unavailable") {
    // Em dev/LIVE/browser, esconde o botão pra não confundir.
    return null;
  }

  const baseClass = cn("gap-2 h-8 text-xs", className);

  if (state.kind === "idle") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={checkForUpdates}
        className={baseClass}
        title={`Versão atual: v${state.current}`}
      >
        <RefreshCw className="size-3.5" />
        Verificar atualizações
      </Button>
    );
  }

  if (state.kind === "checking") {
    return (
      <Button variant="ghost" size="sm" disabled className={baseClass}>
        <Loader2 className="size-3.5 animate-spin" />
        Verificando…
      </Button>
    );
  }

  if (state.kind === "up-to-date") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={checkForUpdates}
        className={cn(baseClass, "text-emerald-700")}
      >
        <Check className="size-3.5" />
        Atualizado · v{state.current}
      </Button>
    );
  }

  if (state.kind === "available") {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={downloadNow}
        className={cn(baseClass, "bg-primary text-primary-foreground")}
      >
        <Download className="size-3.5" />
        Atualização disponível: v{state.version} — baixar
      </Button>
    );
  }

  if (state.kind === "downloading") {
    const pct = Math.max(0, Math.min(100, Math.round(state.progress.percent)));
    return (
      <Button variant="ghost" size="sm" disabled className={baseClass}>
        <Loader2 className="size-3.5 animate-spin" />
        Baixando atualização… {pct}%
      </Button>
    );
  }

  if (state.kind === "ready") {
    return (
      <Button
        variant="default"
        size="sm"
        onClick={restartNow}
        className={cn(baseClass, "bg-emerald-600 hover:bg-emerald-700 text-white")}
      >
        <RotateCcw className="size-3.5" />
        Reiniciar e atualizar pra v{state.version}
      </Button>
    );
  }

  if (state.kind === "error") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={checkForUpdates}
        className={cn(baseClass, "text-red-700")}
        title={state.message}
      >
        <AlertCircle className="size-3.5" />
        Erro · tentar de novo
      </Button>
    );
  }

  return null;
}
