import type { StepId } from "@/types/roteiro";
import type { Agent } from "./types";
import { premissaAgent } from "./premissa";
import { estrutura1Agent } from "./estrutura1";
import { estrutura2Agent } from "./estrutura2";
import { escritaAgent } from "./escrita";
import { revisorAgent } from "./revisor";

export const AGENTS: Record<StepId, Agent> = {
  premissa: premissaAgent,
  estrutura1: estrutura1Agent,
  estrutura2: estrutura2Agent,
  escrita: escritaAgent,
  revisor: revisorAgent,
};

export function getAgent(id: StepId): Agent {
  return AGENTS[id];
}

export type { Agent } from "./types";
