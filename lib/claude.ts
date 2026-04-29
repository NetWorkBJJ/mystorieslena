import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";

export type ClaudeImageMime =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

/**
 * Resolve o caminho do binário claude.exe (nativo). Em modo packaged o
 * Electron já passa via MYSTORIESLENA_CLAUDE_EXEC — mas se o env var estiver
 * ausente ou inválido, tentamos resolver aqui pra não depender só do main
 * process. NOTA: a lista de subPaths está duplicada em electron/main.js
 * (`getClaudeExecutablePath`); se mudar lá, mude aqui também.
 */
let cachedExecutable: { value: string | undefined } | null = null;

function resolveClaudeExecutable(): string | undefined {
  if (cachedExecutable) return cachedExecutable.value;

  const envPath = process.env.MYSTORIESLENA_CLAUDE_EXEC;
  if (envPath && fs.existsSync(envPath)) {
    cachedExecutable = { value: envPath };
    return envPath;
  }
  if (envPath) {
    console.warn(
      `[claude.ts] MYSTORIESLENA_CLAUDE_EXEC aponta pra arquivo inexistente: ${envPath} — caindo em fallback`,
    );
  }

  const platform = process.platform;
  const arch = process.arch;
  const platArch = `${platform}-${arch}`;
  const exe = platform === "win32" ? "claude.exe" : "claude";

  const subPaths = [
    `node_modules/@anthropic-ai/claude-agent-sdk-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-code-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-code/bin/${exe}`,
  ];

  const roots = [process.cwd(), path.dirname(process.execPath)];
  const tested: string[] = [];
  for (const root of roots) {
    for (const sub of subPaths) {
      const full = path.join(root, sub);
      tested.push(full);
      if (fs.existsSync(full)) {
        console.log(`[claude.ts] fallback resolveu binário em: ${full}`);
        cachedExecutable = { value: full };
        return full;
      }
    }
  }

  console.error(
    `[claude.ts] FALHA ao resolver binário claude — testados ${tested.length} caminhos:\n  ${tested.join("\n  ")}`,
  );
  cachedExecutable = { value: undefined };
  return undefined;
}

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
  //
  // Fallback robusto: se o env var não estiver setado OU apontar pra um
  // arquivo que não existe (ex: boot do Electron falhou em encontrar o
  // binário), tenta resolver aqui mesmo a partir de process.cwd() e
  // dirname(process.execPath). Em modo packaged, cwd === resources/app/.
  const pathToClaudeCodeExecutable = resolveClaudeExecutable();

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
