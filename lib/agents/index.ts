/**
 * Dispatcher de agentes por categoria.
 *
 * Antes era um Record<StepId, Agent> único — agora cada categoria registra
 * o próprio jogo de 5 agentes. Os call sites ganharam um parâmetro
 * `category` que casa com `Roteiro.category` (default "milionario-1p"
 * para roteiros legados, backfill em lib/storage.ts).
 */

import type { StepId } from "@/types/roteiro";
import { DEFAULT_CATEGORY } from "@/types/roteiro";
import type { RoteiroCategory } from "@/lib/categories/types";
import { getCategoryAgent } from "@/lib/categories";
import type { Agent } from "./types";

export function getAgent(
  category: RoteiroCategory | undefined,
  step: StepId,
): Agent {
  return getCategoryAgent(category ?? DEFAULT_CATEGORY, step);
}

export type { Agent } from "./types";
