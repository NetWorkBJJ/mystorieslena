/**
 * Categoria: Romance de Milionário 3ª pessoa (canal Rowan, estilo Helô Stories™).
 *
 * Reúne os 5 agentes — premissa, estrutura1, estrutura2, escrita, revisor —
 * junto com o prompt da Escrita exposto separadamente (consumido por
 * /api/escrita-fix-wordcount) e o par de extração estruturada do Revisor
 * (fallback /api/revisor-extract-errors).
 *
 * NARRAÇÃO: Toda a história em terceira pessoa onisciente externa, alternando
 * foco entre FMC e MMC.
 *
 * NOTA — PREMISSA: o agente da Premissa é um stub travado (placeholder=true)
 * enquanto a autora não envia o prompt mestre M3P da Premissa. A roteirista
 * deve usar manual-paste no Step 1 até lá.
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

export const milionario3pAgents: Record<StepId, Agent> = {
  premissa: premissaAgent,
  estrutura1: estrutura1Agent,
  estrutura2: estrutura2Agent,
  escrita: escritaAgent,
  revisor: revisorAgent,
};

export const milionario3pEscritaSystemPrompt = ESCRITA_SYSTEM_PROMPT;

export const milionario3pRevisorExtract = {
  systemPrompt: REVISOR_EXTRACT_SYSTEM_PROMPT,
  buildUserMessage: buildRevisorExtractUserMessage,
};
