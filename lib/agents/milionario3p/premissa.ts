import { MODELS } from "@/lib/anthropic";
import type { Agent } from "../types";

/**
 * Etapa 1 — Premissa (Romance de Milionário 3ª pessoa, canal Rowan).
 *
 * STUB TRAVADO — o prompt mestre da Premissa M3P ainda não foi enviado pela
 * autora. Por enquanto a geração automática retorna uma mensagem clara
 * orientando a usar manual-paste no UI.
 *
 * Quando o prompt mestre M3P chegar, substitua esta stub por uma definição
 * real (com `premissa-prompt.ts` próprio e `buildUserMessage` bifásico —
 * fase "resumo" + fase "estrutura" — espelhando o agent de Mafia/1p).
 */
export const premissaAgent: Agent = {
  id: "premissa",
  label: "Premissa",
  description:
    "Premissa M3P (placeholder — prompt mestre ainda não disponível). Use manual-paste no app.",
  model: MODELS.opus,
  thinking: "disabled",
  effort: "low",
  systemPrompt:
    "A geração automática da Premissa para Romance de Milionário em 3ª pessoa ainda não está disponível. Responda apenas com a mensagem definida em buildUserMessage, sem adicionar nada antes ou depois.",
  buildUserMessage: () =>
    "PREMISSA M3P AINDA NÃO DISPONÍVEL\n\nO prompt mestre da Premissa para Romance de Milionário em 3ª pessoa (canal Rowan) ainda não foi configurado neste app. Por favor, use a opção 'Já tenho a premissa pronta' no Step 1 e cole sua premissa manualmente. A geração automática estará disponível assim que o prompt mestre M3P for adicionado.",
  maxTokens: 500,
  temperature: 0,
  placeholder: true,
};
