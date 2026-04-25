"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Copy, Loader2 } from "lucide-react";
import type { Roteiro } from "@/types/roteiro";
import {
  buildEscritaHtmlDocument,
  escritaContentToHtml,
} from "@/lib/export-html";
import { cn } from "@/lib/utils";

interface Props {
  roteiro: Roteiro;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  className?: string;
}

/**
 * Copia o conteúdo da Escrita formatado em HTML pro clipboard.
 * Cola direto no Google Docs, Word ou qualquer editor que aceite HTML
 * preservando a hierarquia (Heading 1 PARTE / Heading 2 Capítulo / Heading 3 ✦ POV).
 */
export function CopyEscritaButton({
  roteiro,
  variant = "outline",
  size = "default",
  className,
}: Props) {
  const [state, setState] = useState<"idle" | "loading" | "copied">("idle");

  const handleClick = useCallback(async () => {
    const escritaContent = roteiro.outputs.escrita?.content?.trim();
    if (!escritaContent) {
      alert("Gere o roteiro primeiro pra copiar.");
      return;
    }

    setState("loading");
    try {
      const title = roteiro.title || "Roteiro";
      const bodyHtml = escritaContentToHtml(escritaContent);
      const html = buildEscritaHtmlDocument(title, bodyHtml);
      const text = stripHtmlToText(escritaContent);

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
      } else if (clipboard?.writeText) {
        await clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API indisponível.");
      }

      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      console.error("Erro ao copiar roteiro:", err);
      alert("Não consegui copiar. Use o botão Baixar como alternativa.");
      setState("idle");
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
      {state === "idle" && <Copy className="size-4" />}
      {state === "loading"
        ? "Copiando..."
        : state === "copied"
          ? "Copiado! Cole no Docs (Ctrl+V)"
          : "Copiar roteiro formatado"}
    </Button>
  );
}

/**
 * Limpa marcadores markdown do conteúdo cru pra ter um fallback de texto puro
 * (usado quando o Clipboard API não suporta HTML).
 */
function stripHtmlToText(raw: string): string {
  return raw
    .replace(/═{3,}\s*\n\s*(PARTE 1|PARTE 2|ROTEIRO)\s*\n\s*═{3,}/g, "$1")
    .replace(/━{3,}\s*\n\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^\n]+)\n━{3,}/g, "✦ $1")
    .replace(/^#+\s+/gm, "")
    .trim();
}
