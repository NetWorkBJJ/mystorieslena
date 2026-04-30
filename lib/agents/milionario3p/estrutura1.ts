import { MODELS } from "@/lib/anthropic";
import type { Agent } from "../types";
import { ESTRUTURA_MASTER_PROMPT } from "./estrutura-master-prompt";
import { ESTRUTURA1_PROMPT } from "./estrutura1-prompt";

/**
 * Etapa 2 — Estrutura da Parte 1 (Romance de Milionário 3ª pessoa, canal Rowan).
 *
 * 11.500 palavras (faixa 11.300-11.700, alvo 11.500), 5-6 capítulos.
 * Hook expansão do título de 90-120 palavras, narração em terceira pessoa
 * onisciente externa (alterna foco FMC ↔ MMC), cena erótica elegante e
 * resumida no penúltimo/último cap (≤500 palavras), final feliz sem
 * casamento e sem filhos.
 *
 * System prompt = master M3P + estrutura1 M3P.
 */
export const estrutura1Agent: Agent = {
  id: "estrutura1",
  label: "Estrutura — Parte 1",
  description:
    "Monta a estrutura completa da Parte 1 de Milionário 3p (11.500 palavras, 5-6 capítulos) — hook expansão do título, mapa cena por cena, capítulos com química crescente, cena íntima elegante, casal junto e em paz no final",
  model: MODELS.opus,
  thinking: "adaptive",
  effort: "high",
  systemPrompt: ESTRUTURA_MASTER_PROMPT + ESTRUTURA1_PROMPT,
  acceptsReferenceImage: true,
  buildUserMessage: (ctx) => {
    const premissa = ctx.previousOutputs.premissa?.content?.trim() ?? "";

    if (ctx.refineMode && ctx.currentOutput?.trim() && ctx.userInput?.trim()) {
      const refine: string[] = [];
      refine.push(
        "Você JÁ entregou uma versão dessa ESTRUTURA da PARTE 1. A roteirista pediu uma CORREÇÃO PONTUAL. NÃO regere a estrutura inteira. Devolva APENAS as alterações no formato XML descrito abaixo — o app aplica via find+replace literal no documento corrente.",
      );
      refine.push(
        `━━━ ESTRUTURA ATUAL — PARTE 1 (consulte mas NÃO devolva inteira) ━━━\n\n${ctx.currentOutput.trim()}`,
      );
      refine.push(
        `━━━ CORREÇÃO PEDIDA PELA ROTEIRISTA ━━━\n\n${ctx.userInput.trim()}`,
      );
      if (premissa) {
        refine.push(
          `━━━ PREMISSA APROVADA (Step 1 — referência de coerência) ━━━\n\n${premissa}`,
        );
      }
      refine.push(
        [
          "━━━ FORMATO DE SAÍDA OBRIGATÓRIO ━━━",
          "",
          "Para cada trecho da estrutura que precisa mudar, emita um bloco:",
          "",
          "<alteracao>",
          "<descricao>linha curta explicando o que muda</descricao>",
          "<original>",
          "[trecho EXATO do documento atual — copie literal, com mesma quebra de linha, mesmas aspas, mesmos travessões. Inclua contexto suficiente pra ser único no documento.]",
          "</original>",
          "<corrigido>",
          "[trecho novo que substitui o original.]",
          "</corrigido>",
          "</alteracao>",
          "",
          "REGRAS RIGOROSAS:",
          "• Inclua um bloco <alteracao> POR cada trecho que muda. Não há limite — pode ser 1, 5, 20.",
          "• <original> precisa ser uma cópia LITERAL do documento atual.",
          "• <original> precisa ser ÚNICO no documento. Se duplicado, expanda com contexto.",
          "• NÃO devolva a estrutura inteira. NÃO devolva markdown explicativo fora dos blocos <alteracao>.",
          "• Não invente mudanças que a roteirista não pediu.",
          "• Se mudar a contagem de palavras de um capítulo, EMITA TAMBÉM blocos <alteracao> rebalanceando outros para manter o total entre 11.300 e 11.700 palavras (REGRA INEGOCIÁVEL).",
          "• Se a correção pedida não exigir alteração nenhuma, devolva apenas a string [NENHUMA_ALTERACAO_NECESSARIA] e nada mais.",
          "",
          "Comece direto pelo primeiro <alteracao>. Sem preâmbulo, sem perguntas.",
        ].join("\n"),
      );
      return refine.join("\n\n");
    }

    const sections: string[] = [];

    sections.push(
      "Você vai montar a ESTRUTURA da PARTE 1 da história de romance de milionário em 3ª pessoa. Toda a regra está no seu system prompt — siga na risca, sem alucinar e sem desvios. A premissa abaixo é a fonte primária do conteúdo. Use o que estiver no campo de instruções adicionais como ajuste opcional.",
    );

    if (ctx.referenceImage) {
      sections.push(
        "━━━ IMAGEM DE REFERÊNCIA ANEXADA ━━━\n\nA roteirista anexou uma imagem visual de referência. USE essa imagem pra calibrar mood/atmosfera (luz, paleta, peso emocional do mundo de luxo), aparência física dos personagens (especialmente o MMC), cenário/ambientação, estilo visual da narrativa. Integre os elementos visuais à estrutura sem inventar contradições com a premissa textual. Em conflito, a PREMISSA TEXTUAL prevalece.",
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
      "━━━ AÇÃO ━━━\n\nMonte a ESTRUTURA COMPLETA da Parte 1 seguindo o LAYOUT DE SAÍDA OBRIGATÓRIO definido no system prompt (Mundo → Pessoas-chave → FMC → MMC → Casal → Secundários → Hook → Mapa cena por cena → Capítulos → Temas → Arcos → Momentos-chave). Comece direto, sem pedir confirmação. Não escreva os capítulos em si — apenas a ESTRUTURA/PLANEJAMENTO.\n\n⚠️ ATENÇÃO CRÍTICA — CONTAGEM DE PALAVRAS: a SOMA das contagens declaradas para os 5-6 capítulos DEVE ficar entre 11.300 e 11.700 palavras (alvo 11.500). REGRA INEGOCIÁVEL. Antes de finalizar, SOME mentalmente as contagens de cada capítulo e CONFIRME que o total está dentro da faixa. Se ficar fora, REDISTRIBUA até bater.\n\n⚠️ NARRAÇÃO em TERCEIRA PESSOA — narrador externo onisciente que alterna foco entre FMC e MMC. NÃO é narração da FMC em primeira pessoa.",
    );

    return sections.join("\n\n");
  },
  maxTokens: 16000,
  temperature: 0.8,
};
