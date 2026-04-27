import { MODELS } from "@/lib/anthropic";
import type { Agent } from "./types";
import { ESTRUTURA_MASTER_PROMPT } from "./estrutura-master-prompt";
import { ESTRUTURA1_PROMPT } from "./estrutura1-prompt";

/**
 * Etapa 2 — Estrutura da Parte 1.
 *
 * Agente especializado que segue NA RISCA o prompt mestre da Parte 1
 * (11.500 palavras, 6 capítulos fixos, ritmo rápido→equilibrado→desenvolvido,
 * narração 1ª pessoa FMC, hook obrigatório de 90-120 palavras, questionamento
 * sutil no final).
 *
 * System prompt = regras gerais do projeto (master) + regras específicas
 * da Parte 1 (estrutura1-prompt). User message = Premissa do Step 1 +
 * ajustes/pedidos opcionais do usuário no campo de Instruções.
 */
export const estrutura1Agent: Agent = {
  id: "estrutura1",
  label: "Estrutura — Parte 1",
  description:
    "Monta a estrutura completa da Parte 1 (11.500 palavras, 6 capítulos) seguindo o prompt mestre especializado — hook, mapa, capítulos, cena íntima, questionamento final",
  model: MODELS.opus,
  fallbackModel: MODELS.sonnet,
  thinking: "adaptive",
  effort: "high",
  systemPrompt: ESTRUTURA_MASTER_PROMPT + ESTRUTURA1_PROMPT,
  acceptsReferenceImage: true,
  buildUserMessage: (ctx) => {
    const premissa = ctx.previousOutputs.premissa?.content?.trim() ?? "";
    const sections: string[] = [];

    sections.push(
      "Você vai montar a ESTRUTURA da PARTE 1 da história. Toda a regra está no seu system prompt — siga na risca, sem alucinar e sem desvios. A premissa abaixo é a fonte primária do conteúdo. Use o que estiver no campo de instruções adicionais como ajuste opcional.",
    );

    if (ctx.referenceImage) {
      sections.push(
        "━━━ IMAGEM DE REFERÊNCIA ANEXADA ━━━\n\nA roteirista anexou uma imagem visual de referência (vai chegar como input multimodal antes desta mensagem). USE essa imagem pra calibrar:\n• Mood/atmosfera da história (luz, paleta, peso emocional)\n• Aparência física dos personagens, se a imagem mostrar pessoas\n• Cenário/ambientação se a imagem mostrar locais\n• Estilo de narrativa visual (cinematográfico, intimista, etc)\n\nIntegre os elementos visuais à estrutura sem inventar contradições com a premissa textual. Se imagem e premissa entrarem em conflito, a PREMISSA TEXTUAL prevalece.",
      );
    }

    if (premissa) {
      sections.push(
        `━━━ PREMISSA APROVADA (Step 1 — fonte primária) ━━━\n\n${premissa}`,
      );
    } else {
      sections.push(
        "━━━ PREMISSA ━━━\n\n⚠️ Não fornecida. Avise que o Step 1 (Premissa) precisa estar preenchido para gerar a Parte 1 com qualidade. Se mesmo assim houver instruções no campo abaixo que tragam contexto suficiente, use-as como base.",
      );
    }

    if (ctx.userInput?.trim()) {
      sections.push(
        `━━━ INSTRUÇÕES ADICIONAIS DA ROTEIRISTA (ajustes opcionais) ━━━\n\n${ctx.userInput.trim()}`,
      );
    }

    sections.push(
      "━━━ AÇÃO ━━━\n\nMonte a ESTRUTURA COMPLETA da Parte 1 seguindo o LAYOUT DE SAÍDA OBRIGATÓRIO definido no system prompt (Mapa → Mundo → Pessoas-Chave → FMC → MMC → Casal → Secundários → Hook → Capítulos → Questionamento → Temas → Arcos → Momentos-chave → Checklist). Comece direto, sem pedir confirmação. Não escreva os capítulos em si — apenas a ESTRUTURA/PLANEJAMENTO.\n\n⚠️ ATENÇÃO CRÍTICA — CONTAGEM DE PALAVRAS: A SOMA das contagens de palavras planejadas para os 6 capítulos DEVE ficar entre 11.300 e 11.700 palavras (ALVO 11.500). Esta é uma REGRA INEGOCIÁVEL. Distribua conforme a tabela do system prompt (~12% / 14% / 18% / 20% / 18% / 18%). Antes de finalizar, SOME mentalmente a quantidade indicada em cada capítulo e CONFIRME que o total está dentro da faixa. Se ficar fora, REDISTRIBUA até bater. Não pule essa verificação.",
    );

    return sections.join("\n\n");
  },
  maxTokens: 16000,
  temperature: 0.8,
};
