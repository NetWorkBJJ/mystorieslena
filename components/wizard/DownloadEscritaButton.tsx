"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Download, Loader2 } from "lucide-react";
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
 * Baixa apenas o conteúdo da Escrita como arquivo .html já formatado com
 * a hierarquia de headings (h1 PARTE / h2 Capítulo / h3 ✦ POV) — pronto pra
 * abrir no navegador, copiar e colar no Google Docs com as guias laterais
 * já reconhecidas.
 */
export function DownloadEscritaButton({
  roteiro,
  variant = "outline",
  size = "default",
  className,
}: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  const handleClick = useCallback(() => {
    const escritaContent = roteiro.outputs.escrita?.content?.trim();
    if (!escritaContent) {
      alert("Gere o roteiro primeiro pra baixar.");
      return;
    }

    setState("loading");
    try {
      const title = roteiro.title || "Roteiro";
      const bodyHtml = escritaContentToHtml(escritaContent);
      const html = buildEscritaHtmlDocument(title, bodyHtml);

      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title || "roteiro").replace(/[^\w\s-]/g, "").trim() || "roteiro"}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setState("done");
      setTimeout(() => setState("idle"), 2500);
    } catch (err) {
      console.error("Erro ao baixar roteiro:", err);
      setState("idle");
      alert("Não consegui gerar o arquivo. Tente novamente.");
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
      {state === "done" && <Check className="size-4 text-emerald-600" />}
      {state === "idle" && <Download className="size-4" />}
      {state === "loading"
        ? "Preparando..."
        : state === "done"
          ? "Baixado!"
          : "Baixar roteiro (.html)"}
    </Button>
  );
}
