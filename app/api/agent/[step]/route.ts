import { NextRequest } from "next/server";
import { streamClaudeText } from "@/lib/claude";
import { getAgent } from "@/lib/agents";
import type { StepId, StepOutput } from "@/types/roteiro";
import { STEP_ORDER } from "@/types/roteiro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  previousOutputs?: Partial<Record<StepId, StepOutput>>;
  userInput?: string;
  /** Quando true, usa o fallbackModel (Haiku) — mais rápido, qualidade um pouco menor. */
  fastMode?: boolean;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ step: string }> },
) {
  const { step } = await ctx.params;

  if (!STEP_ORDER.includes(step as StepId)) {
    return new Response(`Etapa inválida: ${step}`, { status: 400 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const agent = getAgent(step as StepId);
  const userMessage = agent.buildUserMessage({
    previousOutputs: body.previousOutputs ?? {},
    userInput: body.userInput,
  });

  // Modo rápido: troca pro fallbackModel (geralmente Haiku) — bem mais
  // rápido na geração, com perda de nuance aceitável pra rodadas de teste.
  const effectiveModel =
    body.fastMode && agent.fallbackModel ? agent.fallbackModel : agent.model;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamClaudeText({
          systemPrompt: agent.systemPrompt,
          userMessage,
          model: effectiveModel,
          fallbackModel: agent.fallbackModel,
          thinking: agent.thinking,
          effort: agent.effort,
          signal: req.signal,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        const isAuthError =
          /authentication|401|invalid auth|unauthorized|credentials/i.test(msg);
        if (isAuthError) {
          controller.enqueue(
            encoder.encode(
              `\n\n[LOGIN NECESSÁRIO NO CLAUDE]\n\nVocê precisa estar logado na sua conta Claude Pro/Max pra usar o MyStoriesLena. Pode ser a primeira vez que abre o app, ou o token expirou.\n\n💡 COMO RESOLVER (1 minuto):\n\n1. Abra o PowerShell (Iniciar → digite "PowerShell" → Enter)\n2. Cole este comando e aperte Enter:\n\n       claude\n\n3. Vai abrir o navegador pedindo pra fazer login com sua conta Claude.\n4. Autorize. Quando voltar pro PowerShell, pode fechar.\n5. Volte aqui no MyStoriesLena e clique em "Gerar novamente" — não precisa reiniciar o app.\n\n--- Detalhe técnico ---\n${msg}`,
            ),
          );
        } else {
          controller.enqueue(encoder.encode(`\n\n[ERRO] ${msg}`));
        }
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
