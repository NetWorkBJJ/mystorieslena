"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  History,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { StepGenerationSnapshot, StepId } from "@/types/roteiro";
import { useWizard } from "@/store/wizard";
import { countWords } from "./WordCountBadge";

interface HistoryPanelProps {
  step: StepId;
  history: StepGenerationSnapshot[];
}

export function HistoryPanel({ step, history }: HistoryPanelProps) {
  const restoreFromHistory = useWizard((s) => s.restoreFromHistory);
  const deleteFromHistory = useWizard((s) => s.deleteFromHistory);

  if (history.length === 0) return null;

  return (
    <details className="group rounded-lg border bg-muted/20">
      <summary className="list-none cursor-pointer px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <History className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            Histórico de gerações
          </span>
          <Badge variant="secondary" className="font-normal text-[10px]">
            {history.length} {history.length === 1 ? "versão" : "versões"}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 group-open:hidden">
          expandir
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0 hidden group-open:inline">
          recolher
        </span>
      </summary>

      <div className="px-4 pb-4 flex flex-col gap-2">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Cada vez que você clica em <strong>Gerar</strong> ou
          <strong> Gerar novamente</strong>, a versão anterior é salva aqui.
          Pode restaurar qualquer uma — a versão atual vai pro histórico
          quando isso acontecer.
        </p>
        <div className="flex flex-col gap-1.5">
          {history.map((snap) => (
            <SnapshotRow
              key={snap.id}
              snap={snap}
              onRestore={() => restoreFromHistory(step, snap.id)}
              onDelete={() => deleteFromHistory(step, snap.id)}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function SnapshotRow({
  snap,
  onRestore,
  onDelete,
}: {
  snap: StepGenerationSnapshot;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const savedAt = new Date(snap.savedAt).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const wordCount = countWords(snap.content);
  const preview = snap.content.replace(/\s+/g, " ").trim().slice(0, 120);

  return (
    <div className="flex items-start gap-3 rounded-md border bg-background px-3 py-2.5">
      <div className="flex flex-col min-w-0 flex-1 gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Clock className="size-3 text-muted-foreground" />
          <span className="text-xs font-medium">{savedAt}</span>
          <span className="text-[10px] text-muted-foreground">
            · {wordCount.toLocaleString("pt-BR")} palavras
          </span>
          {snap.edited && (
            <Badge
              variant="outline"
              className="text-[9px] h-4 font-normal text-amber-700 border-amber-300 bg-amber-50"
            >
              editado
            </Badge>
          )}
          {snap.label && (
            <Badge variant="secondary" className="text-[9px] h-4 font-normal">
              {snap.label}
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
          {preview}
          {snap.content.length > 120 ? "…" : ""}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={onRestore}
          title="Restaurar esta versão (a atual vai pro histórico)"
        >
          <RotateCcw className="size-3" />
          Restaurar
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          title="Excluir esta versão"
          aria-label="Excluir"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}
