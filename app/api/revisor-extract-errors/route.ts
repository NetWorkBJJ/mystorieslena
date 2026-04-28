/**
 * Endpoint FALLBACK do Revisor — extrai bloco <erros_detalhados> de uma
 * revisão que veio sem o XML (truncado ou esquecido pelo modelo).
 *
 * Disparado pela UI (StepShell.tsx) quando parseRevisorErrors devolve []
 * mas o markdown contém erros listados em PRINCIPAIS ERROS. Modelo: Opus
 * (precisão de localização do trecho literal). Output: stream do XML
 * `<erros_detalhados>...</erros_detalhados>`.
 */

import { NextRequest } from "next/server";
import { streamClaudeText } from "@/lib/claude";
import { MODELS } from "@/lib/anthropic";
import {
  REVISOR_EXTRACT_SYSTEM_PROMPT,
  buildRevisorExtractUserMessage,
} from "@/lib/agents/revisor-extract-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  revisaoMarkdown: string;
  escritaContent: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Body inválido", { status: 400 });
  }

  if (!body.revisaoMarkdown?.trim() || !body.escritaContent?.trim()) {
    return new Response("Faltam revisaoMarkdown ou escritaContent", {
      status: 400,
    });
  }

  const userMessage = buildRevisorExtractUserMessage({
    revisaoMarkdown: body.revisaoMarkdown,
    escritaContent: body.escritaContent,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamClaudeText({
          systemPrompt: REVISOR_EXTRACT_SYSTEM_PROMPT,
          userMessage,
          model: MODELS.opus,
          thinking: "disabled",
          effort: "low",
          signal: req.signal,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        controller.enqueue(encoder.encode(`\n\n[ERRO] ${msg}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
