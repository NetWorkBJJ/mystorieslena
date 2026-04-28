/**
 * Endpoint de revisão gramatical do roteiro completo.
 *
 * Recebe TODOS os capítulos do roteiro Escrita já gerados (após o último
 * batch fechar) e devolve cada um com correções apenas gramaticais —
 * ortografia, concordância, regência, crase, pontuação, conjugação.
 *
 * Modelo: Opus (decisão da roteirista — sempre Opus, sem Sonnet).
 *
 * NÃO altera eventos, diálogos, ordem, estilo, vocabulário criativo. Não
 * é ghost-writer, é revisor.
 *
 * Output: capítulos em formato `## Capítulo N — Título\n\n[texto]`,
 * separados por linha em branco. Frontend usa o mesmo parser do batch
 * pra extrair.
 */

import { NextRequest } from "next/server";
import { streamClaudeText } from "@/lib/claude";
import { MODELS } from "@/lib/anthropic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface ChapterIn {
  number: number;
  title?: string;
  part: "Parte 1" | "Parte 2";
  content: string;
}

interface Body {
  chapters: ChapterIn[];
}

const REVISOR_SYSTEM_PROMPT = `Você é um revisor gramatical profissional de literatura em português brasileiro. Sua função é EXCLUSIVA: corrigir erros formais sem tocar no conteúdo criativo.

CORRIGIR:
• Ortografia (palavras erradas, "firmessa" → "firmeza")
• Acentuação (faltando ou sobrando)
• Concordância verbal (sujeito-verbo) e nominal (gênero/número)
• Regência verbal e nominal (preposições corretas)
• Crase (uso correto do "à" — ex.: "marcada para às doze horas", não "para as")
• Pontuação (vírgulas faltando, ponto-e-vírgula correto, dois pontos)
• Conjugação verbal (especialmente futuro do pretérito: "iria" e não "ia")
• Erros de digitação evidentes
• Espaçamento incorreto (espaços duplos, espaço antes de pontuação)

NÃO TOCAR:
• Eventos, ações, decisões
• Diálogos (palavras das falas — só pontuação dentro deles, se errada)
• Ordem das cenas e parágrafos
• Estilo, tom, vocabulário criativo, escolhas autorais
• Frases já corretas (não "melhorar" o que está bom)
• Cabeçalhos de capítulo (mantenha "## Capítulo N — Título" exato)
• Marcadores de POV se existirem
• Não acrescentar nada novo. Não remover nada além de erros.

REGRA DE OURO: se na dúvida sobre se algo é erro ou escolha de estilo, NÃO mexa. É melhor deixar passar uma ambiguidade do que descaracterizar a voz da história.

FORMATO DE SAÍDA: devolva os capítulos na mesma ordem recebida, no formato exato:

## Capítulo N — Título
[texto corrigido]

## Capítulo N+1 — Título
[texto corrigido]

(continuando...)

Sem comentários, sem explicações, sem listar o que mudou. Só os capítulos corrigidos.`;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Body inválido", { status: 400 });
  }

  if (!body.chapters?.length) {
    return new Response("Sem capítulos pra revisar", { status: 400 });
  }

  // Monta input concatenando todos os capítulos.
  const blocks: string[] = [];
  for (const ch of body.chapters) {
    const header = ch.title
      ? `## Capítulo ${ch.number} — ${ch.title}`
      : `## Capítulo ${ch.number}`;
    blocks.push(`${header}\n\n${ch.content.trim()}`);
  }

  const userMessage = `Revise GRAMATICALMENTE os ${body.chapters.length} capítulos abaixo. Devolva-os corrigidos no formato pedido pelo system prompt — mesma ordem, mesmos cabeçalhos, conteúdo só com erros gramaticais consertados.\n\n${blocks.join("\n\n")}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamClaudeText({
          systemPrompt: REVISOR_SYSTEM_PROMPT,
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
