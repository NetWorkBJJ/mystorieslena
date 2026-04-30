/**
 * Endpoint que reescreve UM capítulo pra atingir o alvo de palavras dele.
 *
 * Usado pelo loop do Escrita após cada batch: se algum capítulo saiu fora
 * de ±5% do alvo (medido programaticamente), a UI dispara essa chamada.
 * Modelo: Opus (mantém o estilo Helô — não pode ser Sonnet pra não perder
 * voz). Output: o capítulo INTEIRO reescrito, no mesmo formato de header
 * `## Capítulo N — Título`.
 *
 * NÃO é parte do registry de agentes — é um helper específico do fluxo
 * 2-em-2, com prompt próprio focado em expandir/encurtar sem mudar
 * eventos.
 */

import { NextRequest } from "next/server";
import { streamClaudeText } from "@/lib/claude";
import { MODELS } from "@/lib/anthropic";
import { getCategoryEscritaSystemPrompt } from "@/lib/categories";
import type { RoteiroCategory } from "@/types/roteiro";
import { DEFAULT_CATEGORY } from "@/types/roteiro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  /** Sub-nicho do roteiro — escolhe qual ESCRITA_SYSTEM_PROMPT usar. */
  category?: RoteiroCategory;
  chapter: {
    number: number;
    title?: string;
    part: "Parte 1" | "Parte 2";
    content: string;
  };
  currentWords: number;
  targetWords: number;
  /** Premissa pra dar contexto mínimo ao reescrever. Opcional. */
  premissa?: string;
  /** Capítulos vizinhos (sinopses) pra preservar continuidade. */
  neighborSynopses?: Array<{
    number: number;
    part: "Parte 1" | "Parte 2";
    synopsis: string;
  }>;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Body inválido", { status: 400 });
  }

  const { chapter, currentWords, targetWords } = body;
  if (!chapter?.content || !targetWords) {
    return new Response("Faltam campos obrigatórios", { status: 400 });
  }

  const diff = targetWords - currentWords;
  const action = diff > 0 ? "EXPANDA" : "ENCURTE";
  const absDiff = Math.abs(diff);
  const min = Math.round(targetWords * 0.95);
  const max = Math.round(targetWords * 1.05);

  const sections: string[] = [];

  sections.push(
    `Você está REVISANDO um capítulo já escrito do romance pra ajustar a contagem de palavras. O capítulo está com ${currentWords} palavras. O alvo é ${targetWords} palavras (faixa aceita: ${min}-${max}). Diferença: ${diff > 0 ? "faltam" : "sobram"} ~${absDiff} palavras.`,
  );

  if (diff > 0) {
    sections.push(
      `━━━ AÇÃO: EXPANDIR ━━━\n\nEXPANDA cenas existentes para adicionar cerca de ${absDiff} palavras. Use:\n• Mais detalhe sensorial (cheiro, textura, temperatura, som)\n• Mais descrição de ambiente (móveis, luz, atmosfera)\n• Fluxo de pensamento da narradora (FMC) entre falas\n• Ampliação dos diálogos JÁ presentes (mais beats, mais subtexto)\n• Pausas, silêncios e gestos que carregam tensão\n\nREGRAS RÍGIDAS — qualquer violação invalida o output:\n• NÃO acrescente eventos novos. Mesmas cenas, mais densas.\n• NÃO altere o cliffhanger final.\n• NÃO mude a ordem das cenas.\n• NÃO altere falas-chave (revelações, decisões, frases marcantes).\n• NÃO adicione personagens novos.\n• MANTENHA o tom Helô Stories (sedutor, intenso, primeira pessoa).`,
    );
  } else {
    sections.push(
      `━━━ AÇÃO: ENCURTAR ━━━\n\nENCURTE removendo cerca de ${absDiff} palavras. Use:\n• Cortar redundâncias (frases que repetem ideias)\n• Reduzir descrições excessivas que não carregam tensão\n• Eliminar advérbios desnecessários\n• Compactar parágrafos sem perder rítmo\n\nREGRAS RÍGIDAS — qualquer violação invalida o output:\n• NÃO remova cenas inteiras.\n• NÃO altere o cliffhanger final.\n• NÃO altere falas-chave.\n• NÃO mude a ordem das cenas.\n• MANTENHA o tom Helô Stories.`,
    );
  }

  if (body.premissa) {
    sections.push(`━━━ PREMISSA (contexto) ━━━\n\n${body.premissa}`);
  }

  if (body.neighborSynopses?.length) {
    const lines = body.neighborSynopses
      .map((s) => `• [${s.part} · Cap ${s.number}] ${s.synopsis}`)
      .join("\n");
    sections.push(
      `━━━ SINOPSES VIZINHAS (não contradiga) ━━━\n\n${lines}`,
    );
  }

  const headerLine = chapter.title
    ? `## Capítulo ${chapter.number} — ${chapter.title}`
    : `## Capítulo ${chapter.number}`;

  sections.push(
    `━━━ CAPÍTULO ATUAL (${chapter.part}) ━━━\n\n${headerLine}\n\n${chapter.content}`,
  );

  sections.push(
    `━━━ FORMATO DE SAÍDA ━━━\n\nDevolva o capítulo INTEIRO reescrito, começando pelo header EXATAMENTE neste formato:\n\n${headerLine}\n\n[texto inteiro do capítulo, ${diff > 0 ? "com cerca de " + absDiff + " palavras a mais" : "com cerca de " + absDiff + " palavras a menos"}, respeitando todas as regras acima]\n\nNada além disso. Sem comentários, sem ═══, sem sinopses, sem contagem de palavras no corpo.`,
  );

  const userMessage = sections.join("\n\n");
  const escritaSystemPrompt = getCategoryEscritaSystemPrompt(
    body.category ?? DEFAULT_CATEGORY,
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamClaudeText({
          systemPrompt: escritaSystemPrompt,
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
