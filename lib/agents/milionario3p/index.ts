/**
 * Categoria: Romance de Milionário 3ª pessoa (canal Rowan, estilo Helô Stories™).
 *
 * Reúne os 5 agentes — premissa, estrutura1, estrutura2, escrita, revisor —
 * junto com o prompt da Escrita exposto separadamente (consumido por
 * /api/escrita-fix-wordcount) e o par de extração estruturada do Revisor
 * (fallback /api/revisor-extract-errors).
 *
 * NARRAÇÃO: Terceira pessoa LIMITADA À FMC. Sem POV masculino. O MMC é mostrado
 * apenas pelos atos, falas e gestos observáveis — o leitor nunca entra na
 * cabeça dele. Esse regime vale para a Parte 1 sempre. Para a Parte 2, a
 * estrutura aprovada (Step 3) prevalece — em casos legados ela pode pedir
 * narrador onisciente, e o agent da Escrita segue a estrutura nesses casos
 * (ver nota dedicada em escrita-prompt.ts).
 *
 * Word counts: P1 11.000–12.000 palavras (alvo 12.000), P2 13.000–13.500
 * (alvo 13.250). Símbolos do Revisor: 🟢🟡🔴💀.
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
