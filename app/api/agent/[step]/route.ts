import { NextRequest } from "next/server";
import { streamClaudeText, type ClaudeImageInput, type ClaudeImageMime } from "@/lib/claude";
import { getAgent } from "@/lib/agents";
import type {
  EscritaSynopsis,
  RoteiroReferenceImage,
  StepId,
  StepOutput,
} from "@/types/roteiro";
import { STEP_ORDER } from "@/types/roteiro";
import type { AgentBatchContext } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  previousOutputs?: Partial<Record<StepId, StepOutput>>;
  userInput?: string;
  /** Imagem de referência anexada na Premissa (passada por todos steps; só
   *  agentes com acceptsReferenceImage=true recebem como input multimodal). */
  referenceImage?: RoteiroReferenceImage;
  /** Modo correção: usa currentOutput como base e userInput como instrução
   *  de ajuste pontual, sem regenerar do zero. */
  refineMode?: boolean;
  /** Versão atual do output desse step (base do modo correção). */
  currentOutput?: string;
  /** Modo 2-em-2 do Escrita — descreve qual par o agente deve gerar agora. */
  batch?: AgentBatchContext;
  /** Sinopses dos capítulos já gerados em batches anteriores. */
  previousSynopses?: EscritaSynopsis[];
  /** Fase do agente Premissa: "resumo" (Bloco 0) ou "estrutura" (Blocos 1-8). */
  premissaPhase?: "resumo" | "estrutura";
  /** Resumo (Bloco 0) já aprovado pelo usuário — exigido na fase "estrutura". */
  approvedResumo?: string;
}

const ACCEPTED_IMAGE_MIMES: ClaudeImageMime[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

/** Extrai base64 puro de uma data URL "data:image/jpeg;base64,...". */
function dataUrlToImageInput(
  dataUrl: string,
  mime: ClaudeImageMime,
): ClaudeImageInput | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const detectedMime = m[1] as ClaudeImageMime;
  const data = m[2];
  if (!ACCEPTED_IMAGE_MIMES.includes(detectedMime)) return null;
  return { mimeType: detectedMime || mime, base64Data: data };
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

  if (
    step === "premissa" &&
    body.premissaPhase === "estrutura" &&
    !body.approvedResumo?.trim()
  ) {
    return new Response(
      "Para gerar a estrutura (Blocos 1-8) é necessário enviar o resumo aprovado pelo usuário em `approvedResumo`.",
      { status: 400 },
    );
  }

  const agent = getAgent(step as StepId);
  const userMessage = agent.buildUserMessage({
    previousOutputs: body.previousOutputs ?? {},
    userInput: body.userInput,
    referenceImage: body.referenceImage,
    refineMode: body.refineMode,
    currentOutput: body.currentOutput,
    ...(body.batch ? { batch: body.batch } : {}),
    ...(body.previousSynopses
      ? { previousSynopses: body.previousSynopses }
      : {}),
    ...(body.premissaPhase ? { premissaPhase: body.premissaPhase } : {}),
    ...(body.approvedResumo ? { approvedResumo: body.approvedResumo } : {}),
  });

  // Image multimodal — só vai pro modelo se o agente declarou acceptsReferenceImage.
  // Steps que não aceitam imagem ignoram (mantém prompt mais barato/leve).
  const imageInput =
    agent.acceptsReferenceImage && body.referenceImage
      ? dataUrlToImageInput(
          body.referenceImage.dataUrl,
          body.referenceImage.mimeType,
        )
      : null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamClaudeText({
          systemPrompt: agent.systemPrompt,
          userMessage,
          model: agent.model,
          thinking: agent.thinking,
          effort: agent.effort,
          ...(imageInput ? { image: imageInput } : {}),
          signal: req.signal,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro desconhecido";
        const isBinaryError =
          /native binary not found|claude\.exe.*not found|pathToClaudeCodeExecutable/i.test(msg);
        const isAuthError =
          /authentication|401|invalid auth|unauthorized|credentials/i.test(msg);
        if (isBinaryError) {
          controller.enqueue(
            encoder.encode(
              `\n\n[BINÁRIO CLAUDE NÃO ENCONTRADO]\n\nO binário do Claude Code não está disponível neste pacote do app. Isso costuma acontecer quando a instalação ficou incompleta ou foi corrompida durante uma atualização.\n\n💡 COMO RESOLVER:\n\n1. Baixe o instalador mais recente em:\n   https://github.com/lucasbaziliocomercial-crypto/mystorieslena/releases\n2. Rode o "MyStoriesLena-Setup-x.y.z.exe" — ele substitui a instalação atual sem perder seus roteiros (ficam salvos no localStorage).\n3. Abra o app de novo e tente gerar.\n\nSe persistir mesmo após reinstalar, abra um issue colando os logs do DevTools:\n   • Pressione Ctrl+Shift+I dentro do app pra abrir o DevTools\n   • Vá na aba "Console" e copie as linhas que começam com [claude]\n   • Reporte em https://github.com/lucasbaziliocomercial-crypto/mystorieslena/issues\n\n--- Detalhe técnico ---\n${msg}`,
            ),
          );
        } else if (isAuthError) {
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
