/**
 * Categoria: Romance de Milionário em 1ª pessoa (estilo Helô Stories™).
 *
 * Reúne os 5 agentes da categoria — premissa, estrutura1, estrutura2,
 * escrita, revisor — junto com o prompt da Escrita exposto separadamente
 * (usado pelo endpoint /api/escrita-fix-wordcount sem montar Agent) e
 * o par de extração estruturada do Revisor (fallback /api/revisor-extract-errors).
 */

import type { StepId } from "@/types/roteiro";
import type { Agent } from "../types";
import { premissaAgent } from "./premissa";
import { estrutura1Agent } from "./estrutura1";
import { estrutura2Agent } from "./estrutura2";
import { escritaAgent } from "./escrita";
import { revisorAgent } from "./revisor";
import { ESCRITA_SYSTEM_PROMPT } from "./escrita-prompt";
import {
  REVISOR_EXTRACT_SYSTEM_PROMPT,
  buildRevisorExtractUserMessage,
} from "./revisor-extract-prompt";

export const milionario1pAgents: Record<StepId, Agent> = {
  premissa: premissaAgent,
  estrutura1: estrutura1Agent,
  estrutura2: estrutura2Agent,
  escrita: escritaAgent,
  revisor: revisorAgent,
};

export const milionario1pEscritaSystemPrompt = ESCRITA_SYSTEM_PROMPT;

export const milionario1pRevisorExtract = {
  systemPrompt: REVISOR_EXTRACT_SYSTEM_PROMPT,
  buildUserMessage: buildRevisorExtractUserMessage,
};
