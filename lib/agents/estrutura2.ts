import { MODELS } from "@/lib/anthropic";
import type { Agent } from "./types";
import { ESTRUTURA_MASTER_PROMPT } from "./estrutura-master-prompt";
import { ESTRUTURA2_PROMPT } from "./estrutura2-prompt";

/**
 * Etapa 3 — Estrutura da Parte 2.
 *
 * Agente especializado que segue NA RISCA o prompt mestre da Parte 2
 * (13.000–13.500 palavras, 5-6 capítulos, narração 1ª pessoa alternando
 * FMC + MMC com 2-4 trechos do MMC, hook de 90-140 palavras, cena íntima
 * obrigatória no penúltimo capítulo, final feliz/epílogo no último).
 *
 * System prompt = regras gerais do projeto (master) + regras específicas
 * da Parte 2 (estrutura2-prompt). User message = Premissa do Step 1 +
 * Estrutura da Parte 1 do Step 2 + ajustes/pedidos opcionais do usuário no
 * campo de Instruções.
 */
export const estrutura2Agent: Agent = {
  id: "estrutura2",
  label: "Estrutura — Parte 2",
  description:
    "Monta a estrutura completa da Parte 2 (13.000–13.500 palavras, 5-6 capítulos) seguindo o prompt mestre especializado — hook, mapa com narrador, alternância FMC/MMC, cena íntima no penúltimo, epílogo/final feliz",
  model: MODELS.opus,
  fallbackModel: MODELS.sonnet,
  thinking: "adaptive",
  effort: "high",
  systemPrompt: ESTRUTURA_MASTER_PROMPT + ESTRUTURA2_PROMPT,
  buildUserMessage: (ctx) => {
    const premissa = ctx.previousOutputs.premissa?.content?.trim() ?? "";
    const estrutura1 = ctx.previousOutputs.estrutura1?.content?.trim() ?? "";
    const sections: string[] = [];

    sections.push(
      "Você vai montar a ESTRUTURA da PARTE 2 da história. Toda a regra está no seu system prompt — siga na risca, sem alucinar e sem desvios. A Estrutura da Parte 1 (do Step 2) é fonte de verdade e a premissa do Step 1 é o conteúdo base. Use o que estiver no campo de instruções adicionais como ajuste opcional.",
    );

    if (premissa) {
      sections.push(
        `━━━ PREMISSA APROVADA (Step 1) ━━━\n\n${premissa}`,
      );
    } else {
      sections.push(
        "━━━ PREMISSA ━━━\n\n⚠️ Não fornecida. Avise no topo da estrutura que a premissa não foi fornecida e siga gerando o melhor possível com base na Parte 1 e nas instruções da roteirista.",
      );
    }

    if (estrutura1) {
      sections.push(
        `━━━ ESTRUTURA DA PARTE 1 APROVADA (Step 2 — fonte de verdade para coerência) ━━━\n\n${estrutura1}`,
      );
    } else {
      sections.push(
        "━━━ ESTRUTURA DA PARTE 1 ━━━\n\n⚠️ Não fornecida. Marque no topo da estrutura: \"⚠️ ATENÇÃO: a Estrutura da Parte 1 não foi enviada. Esta estrutura foi feita sem ela e pode contradizer o material da Parte 1.\" — e siga gerando.",
      );
    }

    if (ctx.userInput?.trim()) {
      sections.push(
        `━━━ INSTRUÇÕES ADICIONAIS DA ROTEIRISTA (ajustes opcionais) ━━━\n\n${ctx.userInput.trim()}`,
      );
    }

    sections.push(
      "━━━ AÇÃO ━━━\n\nMonte a ESTRUTURA COMPLETA da Parte 2 seguindo o LAYOUT DE SAÍDA OBRIGATÓRIO definido no system prompt (Mapa com narrador → Hook/Isca → Ponto de Retomada → Distribuição POVs do MMC → Conflitos herdados → Capítulos → Cena Íntima → Easter Eggs → Entrega Final → Resolução → Checklist). Comece direto, sem pedir confirmação. NÃO escreva os capítulos em si — apenas a ESTRUTURA/PLANEJAMENTO.\n\n⚠️ ATENÇÃO CRÍTICA — CONTAGEM DE PALAVRAS: a SOMA das contagens planejadas para os capítulos DEVE ficar entre 13.000 e 13.500 palavras. ZERO tolerância pra fora dessa faixa. Capítulos: 5 ou 6 (máx 6). Antes de finalizar, SOME mentalmente a contagem de cada capítulo e CONFIRME que o total cabe na faixa 13.000–13.500. Se ficar abaixo, AUMENTE algum(s) capítulo(s); se ficar acima, REDUZA. Não pule essa verificação.",
    );

    return sections.join("\n\n");
  },
  maxTokens: 16000,
  temperature: 0.8,
};
