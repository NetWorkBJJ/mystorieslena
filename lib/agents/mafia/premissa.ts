import { MODELS } from "@/lib/anthropic";
import type { Agent } from "../types";
import { PREMISSA_SYSTEM_PROMPT } from "./premissa-prompt";

/**
 * Etapa 1 — Premissa (Romance de Máfia, duologia).
 *
 * Mesmo fluxo de duas fases do milionário (resumo → estrutura), mas com
 * o prompt mestre de Máfia (20 etapas, FMC ativa, mundo mafioso convincente,
 * até 4 POVs masculinos na Parte 2, cidades-mãe da máfia).
 *
 * FASE 1 — RESUMO (Bloco 0): dois resumos detalhados Parte 1 + Parte 2.
 * FASE 2 — ESTRUTURA: Blocos 1 ao 8 com 6 etapas Parte 1 + 14 etapas Parte 2.
 */
export const premissaAgent: Agent = {
  id: "premissa",
  label: "Premissa",
  description:
    "Premissa de Romance de Máfia (duologia). Fluxo em duas fases: gera resumo, espera aprovação, gera estrutura completa Blocos 1-8 com 20 etapas",
  model: MODELS.opus,
  thinking: "disabled",
  effort: "low",
  systemPrompt: PREMISSA_SYSTEM_PROMPT,
  acceptsReferenceImage: true,
  buildUserMessage: (ctx) => {
    const phase = ctx.premissaPhase ?? "resumo";
    const briefing = ctx.userInput?.trim() || "";
    const briefingBlock = briefing
      ? `IDEIA BASE DO USUÁRIO:\n\n${briefing}`
      : "IDEIA BASE DO USUÁRIO: nenhuma ideia específica foi enviada — escolha cidade da lista permitida (Nova York/Chicago/Las Vegas/Miami/Boston/Sicília/Nápoles/Moscou/São Petersburgo), tipo de organização mafiosa (Cosa Nostra americana, máfia siciliana, Camorra, Bratva russa), cargo do MMC, profissão/gatilho inicial da FMC e segredo central seguindo as regras do prompt mestre.";

    if (phase === "estrutura") {
      const resumo = ctx.approvedResumo?.trim() || "";
      const resumoBlock = resumo
        ? `RESUMO APROVADO PELO USUÁRIO (BLOCO 0 — fonte de verdade, mantenha coerência total):\n\n${resumo}`
        : "RESUMO APROVADO PELO USUÁRIO: (não fornecido — gere os blocos seguindo apenas a ideia base e as regras do prompt mestre).";

      return [
        briefingBlock,
        resumoBlock,
        `TAREFA NESTE TURNO:

Entregue APENAS os Blocos 1 ao 8, na ordem exata definida na PARTE I do prompt mestre:
- BLOCO 1: CABEÇALHO
- BLOCO 2: ELENCO FIXO
- BLOCO 3: CENÁRIOS FIXOS
- BLOCO 4: REGRAS DO MUNDO MAFIOSO
- BLOCO 5: CONTEXTO HISTÓRICO TRAVADO
- BLOCO 6: PARTE 1 — ETAPAS 1 ATÉ 6
- BLOCO 7: PARTE 2 — ETAPAS 7 ATÉ 20
- BLOCO 8: REGRAS GLOBAIS DE ESCRITA

NÃO repita o Bloco 0 (resumo). Comece direto pelo Bloco 1.

Mantenha coerência total com o resumo aprovado: nomes, cidade, organização mafiosa, gatilho, segredo central, antagonista e final feliz precisam ser exatamente os mesmos. Os Blocos 1-8 detalham e expandem o que o resumo já estabeleceu — não introduzem mudanças de rumo.

Aplique TODAS as regras das Partes A-P (romance em primeiro plano com perigo em segundo, FMC ATIVA em todos os 20 pontos de virada, cidade da lista permitida, nomes fora da lista proibida, elemento de ritmo + elemento dark em cada etapa, construção gradual do romance — beijo nunca antes da Etapa 4, reconciliação entre Etapas 14-18 não apressada, até 4 POVs masculinos na Parte 2 distribuídos com função clara, mapa de plantio e pagamento, timeline matemática, Parte 1 fecha sem cliffhanger, Parte 2 abre com bomba).`,
      ].join("\n\n");
    }

    return [
      briefingBlock,
      `TAREFA NESTE TURNO:

Entregue APENAS o BLOCO 0 — os dois resumos longos (RESUMO DA PARTE 1 e RESUMO DA PARTE 2), cada um com aproximadamente 600 a 900 palavras, em prosa corrida, com a estrutura de parágrafos definida na PARTE I do prompt mestre.

NÃO entregue Blocos 1-8 neste turno. NÃO escreva frases de espera ou pedidos de aprovação — o usuário vai aprovar/editar o resumo na interface do app antes de pedir os Blocos 1-8 em uma chamada separada.

Use linguagem clara e didática conforme a PARTE I (apresente cada personagem pelo nome completo, idade, profissão/cargo e situação; explique termos mafiosos — don, capo, consigliere, omertà, Bratva, Cosa Nostra — em palavras simples; conte cronologicamente; DETALHE A APROXIMAÇÃO dos dois com cenas concretas, não generalize). Aplique TODAS as regras das Partes A-P (cidade da lista permitida, nomes fora da lista proibida, FMC ATIVA em pontos de virada, romance em primeiro plano com mundo mafioso em segundo, fechamento da Parte 1 sem cliffhanger, abertura da Parte 2 com bomba, reconciliação não apressada entre Etapas 14-18, final feliz obrigatório).

FORMATO DE SAÍDA esperado neste turno:

# RESUMO DA PARTE 1

[8 parágrafos cobrindo: apresentação da FMC, apresentação do MMC + organização mafiosa explicada, encontro, o que força a convivência, APROXIMAÇÃO detalhada com cenas concretas, primeiro grande perigo do mundo mafioso, como enfrentam e se escolhem, fechamento sem entrega total]

# RESUMO DA PARTE 2

[9 parágrafos cobrindo: bomba inicial, por que parece o fim, afastamento ativo da FMC, investigação ativa da FMC, tentativas e sacrifícios do MMC (impérios, vingança, sangue), verdade completa, reconciliação não apressada, queda do antagonista com FMC participante, final feliz com casamento/gravidez/sonho realizado]`,
    ].join("\n\n");
  },
  maxTokens: 16000,
  temperature: 0.9,
};
