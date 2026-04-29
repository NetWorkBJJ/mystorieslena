/**
 * Endpoint que aplica UMA OU MAIS sugestões de revisão "transversais"
 * num trecho do roteiro.
 *
 * Otimização chave: vários erros que afetam o MESMO ESCOPO (ex: 3 erros
 * no Cap 4 da Parte 2) são enviados juntos numa única chamada Opus.
 * Reduz drasticamente o tempo total quando há muitos erros transversais
 * — em vez de N chamadas seriais, faz 1 chamada por escopo único.
 *
 * Modelo: Opus (precisão na reescrita preservando voz e estrutura).
 */

import { NextRequest } from "next/server";
import { streamClaudeText } from "@/lib/claude";
import { MODELS } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface SuggestionItem {
  numero?: string;
  titulo: string;
  sugestao: string;
  porqueAlterado?: string;
  gravidade?: string;
}

interface Body {
  escritaContent: string;
  /** Escopo do trecho: capítulo, parte, ou roteiro inteiro. */
  scopeKind?: "chapter" | "part" | "full";
  /** Rótulo legível ("Cap. 4 da Parte 2", "Parte 1 inteira"). */
  scopeLabel?: string;
  /** Lista de sugestões a aplicar de uma vez. */
  suggestions: SuggestionItem[];
  // Compat: aceita também os campos antigos (uma sugestão só) — wrap em array.
  titulo?: string;
  sugestao?: string;
  porqueAlterado?: string;
  gravidade?: string;
}

const APPLY_SUGGESTION_SYSTEM_PROMPT = `Você é um editor literário aplicando UMA OU MAIS sugestões de revisão num trecho de roteiro brasileiro de romance em primeira pessoa (POV da FMC).

Sua única função:
1. Ler o trecho recebido (capítulo único, Parte inteira ou roteiro todo — escopo informado no user message)
2. Aplicar TODAS as sugestões da lista — cada uma na ordem em que aparecem
3. Devolver o trecho INTEIRO modificado, no MESMO formato

REGRAS RÍGIDAS — qualquer violação invalida o output:
• Devolva exatamente o ESCOPO recebido, nem mais, nem menos.
• Mantenha banners de Parte recebidos: "═══════════════════════════════════════\\nPARTE 1\\n═══════════════════════════════════════"
• Mantenha headers de capítulo no formato "# Capítulo N — Título" (mesma numeração e títulos exceto se a sugestão pedir mudar).
• Mantenha 1ª pessoa, voz da FMC, todos os eventos e diálogos existentes.
• Aplique TODAS as sugestões da lista — nada além delas.
• Sem cortar, sem resumir, sem usar "[...]" ou marcadores de elipse.
• Sem comentários, sem explicações, sem "[aplicado]", sem markdown extra.
• Sem ** ou _ ou # extras (só os headers de capítulo originais).

INSTRUÇÕES POR TIPO DE SUGESTÃO:
• Trocar nomes/termos ("X por Y"): SUBSTITUIÇÃO LITERAL em todas as ocorrências dentro DO ESCOPO.
• Adicionar conteúdo novo ("Adicionar epílogo"): adicione no lugar apropriado mantendo tom e voz da FMC.
• Reescrever passagens (ex: localização Chicago → NY): reescreva PRESERVANDO ritmo, eventos e tensão.
• REMOVER capítulos DUPLICADOS: se o escopo contém o mesmo "# Capítulo N — Título" (mesmo número e título dentro da mesma Parte) aparecendo MAIS DE UMA VEZ, mantenha APENAS UMA versão (a mais completa/coerente) e DELETE as outras ocorrências. Não renumere os outros capítulos.
• REMOVER conteúdo: se uma sugestão pedir explicitamente remover algo, REMOVA literalmente.
• MÚLTIPLAS SUGESTÕES no mesmo escopo: aplique TODAS — se uma diz "trocar X por Y" e outra diz "adicionar Z no início", faça ambas. Não pule nenhuma.

Comece direto pelo conteúdo modificado (sem prefixo). Termine assim que o trecho acabar.`;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Body inválido", { status: 400 });
  }

  // Suporte ao formato antigo: 1 sugestão como campos top-level.
  let suggestions: SuggestionItem[] = body.suggestions ?? [];
  if (suggestions.length === 0 && body.titulo && body.sugestao) {
    suggestions = [
      {
        titulo: body.titulo,
        sugestao: body.sugestao,
        porqueAlterado: body.porqueAlterado,
        gravidade: body.gravidade,
      },
    ];
  }

  const { escritaContent, scopeKind, scopeLabel } = body;
  if (!escritaContent?.trim() || suggestions.length === 0) {
    return new Response(
      "Faltam escritaContent ou suggestions",
      { status: 400 },
    );
  }

  const escopoTexto =
    scopeKind === "chapter"
      ? `UM CAPÍTULO ISOLADO${scopeLabel ? ` (${scopeLabel})` : ""}`
      : scopeKind === "part"
      ? `UMA PARTE INTEIRA${scopeLabel ? ` (${scopeLabel})` : ""}`
      : `O ROTEIRO INTEIRO`;

  const sections: string[] = [];

  sections.push(
    `Você está aplicando ${suggestions.length} sugestão${suggestions.length === 1 ? "" : "es"} de revisão. O escopo é: ${escopoTexto}. Aplique TODAS as sugestões da lista APENAS dentro desse escopo e devolva o mesmo escopo modificado — nem mais, nem menos.`,
  );

  // Lista numerada de sugestões.
  const suggestionsBlock = suggestions
    .map((s, i) => {
      const lines: string[] = [];
      lines.push(`SUGESTÃO ${i + 1}/${suggestions.length}${s.numero ? ` (Erro #${s.numero})` : ""}:`);
      lines.push(`Título: ${s.titulo}`);
      lines.push(`Ação: ${s.sugestao}`);
      if (s.porqueAlterado?.trim()) {
        lines.push(`Motivo: ${s.porqueAlterado}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  sections.push(`━━━ SUGESTÕES PARA APLICAR (todas, na ordem) ━━━\n\n${suggestionsBlock}`);

  sections.push(
    `━━━ TRECHO RECEBIDO (escopo: ${escopoTexto}) ━━━\n\n${escritaContent}`,
  );

  sections.push(
    `━━━ FORMATO DE SAÍDA ━━━\n\nDevolva o ESCOPO RECEBIDO modificado, mantendo:\n• Headers "# Capítulo N — Título" exatamente como estão (mesmo número, mesmo título — exceto se uma sugestão pedir mudar)\n• ${scopeKind === "part" || scopeKind === "full" ? "Banners de Parte (═══) se presentes no input" : "Sem inventar banner de Parte se o input não tinha"}\n• Mesma quantidade de capítulos do input — não adicione, não remova (exceto se uma sugestão pedir explicitamente)\n• 1ª pessoa, voz da FMC, tom narrativo\n\nAplique TODAS as ${suggestions.length} sugestões acima, dentro do escopo recebido. Sem comentários, sem prefixos. Comece direto pelo conteúdo modificado.`,
  );

  const userMessage = sections.join("\n\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamClaudeText({
          systemPrompt: APPLY_SUGGESTION_SYSTEM_PROMPT,
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
