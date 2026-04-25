"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import type { Roteiro } from "@/types/roteiro";
import {
  buildEscritaHtmlDocument,
  escritaContentToHtml,
} from "@/lib/export-html";
import { cn } from "@/lib/utils";

interface GoogleDocsButtonProps {
  roteiro: Roteiro;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  className?: string;
}

/**
 * Compila o roteiro (conteúdo do step Escrita) em HTML formatado, copia pra
 * área de transferência e abre uma aba nova em docs.new pro usuário só dar
 * Ctrl+V. Mantém a mesma hierarquia de headings (PARTE / Capítulo / ✦ POV)
 * que o Google Docs reconhece e mostra na barra lateral.
 */
export function GoogleDocsButton({
  roteiro,
  variant = "default",
  size = "default",
  className,
}: GoogleDocsButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "copied">("idle");

  const handleClick = useCallback(async () => {
    const escritaContent = roteiro.outputs.escrita?.content?.trim();
    if (!escritaContent) {
      alert("Gere o roteiro no step Escrita antes de exportar pro Docs.");
      return;
    }

    setState("loading");
    try {
      const title = roteiro.title || "Roteiro";
      const bodyHtml = escritaContentToHtml(escritaContent);
      const html = buildEscritaHtmlDocument(title, bodyHtml);
      const text = escritaContent;

      const clipboard = navigator.clipboard;
      if (
        clipboard &&
        typeof (clipboard as Clipboard).write === "function" &&
        typeof ClipboardItem !== "undefined"
      ) {
        try {
          const blobHtml = new Blob([html], { type: "text/html" });
          const blobText = new Blob([text], { type: "text/plain" });
          const item = new ClipboardItem({
            "text/html": blobHtml,
            "text/plain": blobText,
          });
          await clipboard.write([item]);
        } catch {
          await clipboard.writeText(text);
        }
      } else if (clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API não disponível");
      }

      window.open("https://docs.new", "_blank", "noopener,noreferrer");
      setState("copied");
      setTimeout(() => setState("idle"), 4000);
    } catch (err) {
      console.error("Erro ao copiar pro Google Docs:", err);
      setState("idle");
      alert(
        "Não consegui copiar o roteiro automaticamente. Use o botão Baixar (PDF) como alternativa.",
      );
    }
  }, [roteiro]);

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={state === "loading"}
      className={cn("gap-2", className)}
    >
      {state === "loading" && <Loader2 className="size-4 animate-spin" />}
      {state === "copied" && <Check className="size-4 text-emerald-600" />}
      {state === "idle" && <ExternalLink className="size-4" />}
      {state === "loading"
        ? "Preparando..."
        : state === "copied"
          ? "Aberto no Docs — cole com Ctrl+V"
          : "Exportar pro Google Docs"}
    </Button>
  );
}
