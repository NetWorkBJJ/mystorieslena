"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import type { Roteiro } from "@/types/roteiro";
import { STEP_LABELS, STEP_ORDER } from "@/types/roteiro";
import { cn } from "@/lib/utils";

interface GoogleDocsButtonProps {
  roteiro: Roteiro;
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  className?: string;
}

/**
 * Compila o roteiro inteiro em HTML formatado, copia pra área de
 * transferência e abre uma nova aba no Google Docs (docs.new).
 * O usuário só precisa colar (Ctrl+V) — Google Docs preserva a formatação
 * vinda do clipboard HTML.
 */
export function GoogleDocsButton({
  roteiro,
  variant = "default",
  size = "default",
  className,
}: GoogleDocsButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "copied">("idle");

  const handleClick = useCallback(async () => {
    setState("loading");
    try {
      const { html, text } = buildExport(roteiro);

      // Copia HTML + texto plano via Clipboard API.
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
          // Fallback: copia só texto plano se o navegador não aceitar ClipboardItem.
          await clipboard.writeText(text);
        }
      } else if (clipboard && typeof clipboard.writeText === "function") {
        await clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API não disponível");
      }

      // Abre nova aba do Google Docs.
      window.open("https://docs.new", "_blank", "noopener,noreferrer");

      setState("copied");
      setTimeout(() => setState("idle"), 4000);
    } catch (err) {
      console.error("Erro ao copiar pro Google Docs:", err);
      setState("idle");
      alert(
        "Não consegui copiar o roteiro automaticamente. Tente baixar o .md e fazer o upload no Drive.",
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
          ? "Copiado — cole no Google Docs (Ctrl+V)"
          : "Exportar pro Google Docs"}
    </Button>
  );
}

function buildExport(roteiro: Roteiro): { html: string; text: string } {
  const title = escapeHtml(roteiro.title || "Roteiro");
  const sections: string[] = [];
  const textSections: string[] = [];

  textSections.push(roteiro.title || "Roteiro");
  textSections.push("=".repeat(40));

  for (const step of STEP_ORDER) {
    const out = roteiro.outputs[step];
    if (!out?.content?.trim()) continue;
    const label = STEP_LABELS[step];
    sections.push(
      `<h2 style="font-family: Georgia, serif; color: #6b1f2d; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-top: 24px;">${escapeHtml(label)}</h2>`,
    );
    sections.push(contentToHtml(out.content));

    textSections.push("");
    textSections.push(`# ${label}`);
    textSections.push("");
    textSections.push(out.content);
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #1a1a1a;">
<h1 style="font-family: Georgia, serif; color: #6b1f2d; border-bottom: 2px solid #6b1f2d; padding-bottom: 8px;">${title}</h1>
<p style="color: #666; font-size: 12px;">Gerado pelo MyStoriesLena · ${new Date().toLocaleString("pt-BR")}</p>
${sections.join("\n")}
</body>
</html>`;

  return { html, text: textSections.join("\n") };
}

function contentToHtml(raw: string): string {
  // Conversão simples: parágrafos + cabeçalhos markdown + ênfase.
  const lines = raw.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let paraBuffer: string[] = [];

  const flushPara = () => {
    if (paraBuffer.length === 0) return;
    const text = paraBuffer.join(" ").trim();
    if (text) {
      out.push(`<p style="margin: 12px 0;">${inlineFormat(text)}</p>`);
    }
    paraBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      flushPara();
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        out.push(
          '<pre style="background: #f4f4f4; padding: 8px; border-radius: 4px; font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap;">',
        );
      } else {
        out.push("</pre>");
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(escapeHtml(line));
      continue;
    }

    if (!line.trim()) {
      flushPara();
      continue;
    }

    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);
    if (h1) {
      flushPara();
      out.push(
        `<h2 style="font-family: Georgia, serif; color: #6b1f2d; margin-top: 20px;">${escapeHtml(h1[1])}</h2>`,
      );
      continue;
    }
    if (h2) {
      flushPara();
      out.push(
        `<h3 style="font-family: Georgia, serif; color: #6b1f2d; margin-top: 16px;">${escapeHtml(h2[1])}</h3>`,
      );
      continue;
    }
    if (h3) {
      flushPara();
      out.push(
        `<h4 style="font-family: Georgia, serif; margin-top: 12px;">${escapeHtml(h3[1])}</h4>`,
      );
      continue;
    }

    // Lista de bullet
    const bullet = line.match(/^[-•*]\s+(.+)$/);
    if (bullet) {
      flushPara();
      out.push(`<p style="margin: 4px 0 4px 16px;">• ${inlineFormat(bullet[1])}</p>`);
      continue;
    }

    // Tarja decorativa (═══ ou ━━━)
    if (/^[═━─]{5,}/.test(line.trim())) {
      flushPara();
      out.push(
        `<hr style="border: none; border-top: 1px solid #ccc; margin: 16px 0;">`,
      );
      continue;
    }

    paraBuffer.push(line);
  }
  flushPara();
  return out.join("\n");
}

function inlineFormat(text: string): string {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\*(.+?)\*/g, "<em>$1</em>");
  escaped = escaped.replace(/`(.+?)`/g, "<code>$1</code>");
  return escaped;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
