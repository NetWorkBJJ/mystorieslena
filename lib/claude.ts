import { query } from "@anthropic-ai/claude-agent-sdk";

export type ClaudeImageMime =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface ClaudeImageInput {
  /** Apenas o base64 puro, SEM o prefixo "data:image/...;base64,". */
  base64Data: string;
  mimeType: ClaudeImageMime;
}

export interface StreamClaudeParams {
  systemPrompt: string;
  userMessage: string;
  model: string;
  /** Override thinking mode. Default: disabled (maior velocidade). */
  thinking?: "disabled" | "adaptive";
  /**
   * Effort level. Only aplicável com thinking=adaptive.
   * Default: "low" (maior velocidade).
   */
  effort?: "low" | "medium" | "high";
  /**
   * Imagem opcional anexada como input multimodal. Quando presente, o
   * prompt é enviado como AsyncIterable<SDKUserMessage> com [imageBlock,
   * textBlock] em vez de string simples.
   */
  image?: ClaudeImageInput;
  signal?: AbortSignal;
}

/**
 * Runs a single-turn generation via the Claude Agent SDK (uses the local
 * Claude Code CLI auth — the user's subscription — instead of an API key).
 *
 * Defaults otimizados para VELOCIDADE em geração criativa:
 * - thinking desabilitado (não gasta tempo "pensando" antes de escrever)
 * - effort low
 * - sem tools, sem session persist, sem setting sources
 *
 * Yields text chunks as they stream from the model.
 */
export async function* streamClaudeText(
  params: StreamClaudeParams,
): AsyncGenerator<string, void, void> {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  params.signal?.addEventListener("abort", onAbort, { once: true });

  const thinking =
    params.thinking === "adaptive"
      ? ({ type: "adaptive" } as const)
      : ({ type: "disabled" } as const);

  // Sanitiza o env: remove ANTHROPIC_API_KEY/AUTH_TOKEN/BASE_URL contaminados
  // (mesmo vazios eles fazem o SDK tentar API key mode em vez de OAuth do
  // plano do usuário, causando 401). Mantém o resto do env intacto.
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  if (cleanEnv.ANTHROPIC_API_KEY !== undefined && !cleanEnv.ANTHROPIC_API_KEY) {
    delete cleanEnv.ANTHROPIC_API_KEY;
  }
  if (cleanEnv.ANTHROPIC_AUTH_TOKEN !== undefined && !cleanEnv.ANTHROPIC_AUTH_TOKEN) {
    delete cleanEnv.ANTHROPIC_AUTH_TOKEN;
  }
  // Remove BASE_URL custom — usa o default do CLI logado
  if (cleanEnv.ANTHROPIC_BASE_URL) {
    delete cleanEnv.ANTHROPIC_BASE_URL;
  }

  // Quando empacotado pelo Electron, o subpacote nativo @anthropic-ai/
  // claude-agent-sdk-win32-x64 fica em app.asar.unpacked, fora do alcance
  // do require.resolve do SDK. O Electron passa o caminho exato do
  // claude.exe via MYSTORIESLENA_CLAUDE_EXEC pra resolver isso.
  const pathToClaudeCodeExecutable = process.env.MYSTORIESLENA_CLAUDE_EXEC;

  // Quando ha imagem anexada, monta o prompt como AsyncIterable<SDKUserMessage>
  // com content array (imagem + texto). Sem imagem, prompt eh string simples.
  const promptInput = params.image
    ? (async function* () {
        yield {
          type: "user" as const,
          parent_tool_use_id: null,
          message: {
            role: "user" as const,
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: params.image!.mimeType,
                  data: params.image!.base64Data,
                },
              },
              {
                type: "text" as const,
                text: params.userMessage,
              },
            ],
          },
        };
      })()
    : params.userMessage;

  try {
    const iter = query({
      prompt: promptInput,
      options: {
        model: params.model,
        systemPrompt: params.systemPrompt,
        tools: [],
        maxTurns: 1,
        includePartialMessages: true,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        settingSources: [],
        thinking,
        effort: params.effort ?? "low",
        env: cleanEnv,
        abortController,
        ...(pathToClaudeCodeExecutable
          ? { pathToClaudeCodeExecutable }
          : {}),
      },
    });

    for await (const msg of iter) {
      if (msg.type === "stream_event") {
        const ev = msg.event;
        if (
          ev.type === "content_block_delta" &&
          ev.delta.type === "text_delta"
        ) {
          yield ev.delta.text;
        }
      } else if (msg.type === "result" && msg.subtype !== "success") {
        const errMsg = msg.errors?.join("; ") || msg.subtype;
        throw new Error(`Claude Agent SDK falhou: ${errMsg}`);
      }
    }
  } finally {
    params.signal?.removeEventListener("abort", onAbort);
  }
}
