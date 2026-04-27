import { MODELS } from "@/lib/anthropic";
import type { Agent } from "./types";
import { REVISOR_SYSTEM_PROMPT } from "./revisor-prompt";

/**
 * Etapa 5 — Revisor.
 *
 * Editor literário rigoroso especializado em romance de milionário.
 * Revisa o roteiro produzido no Step 4 (Escrita) cruzando com Premissa e
 * Estruturas aprovadas. Aplica os 4 graus de classificação de erro
 * (🟢 não interfere, 🟡 atenção, 🟠 interfere, 🔴 gravíssimo), numera
 * sequencialmente, dá nota final e mede risco de hate.
 *
 * Saída estruturada: Principais Erros → Sugestões → Análise como Leitor Real
 * → Análise de Hater → Risco de Hate → Nota Final → Melhorias Práticas.
 */
export const revisorAgent: Agent = {
  id: "revisor",
  label: "Revisor",
  description:
    "Editor literário rigoroso — revisa o roteiro completo classificando erros em 4 graus (não interfere / atenção / interfere / gravíssimo), numerando sequencialmente, com análise de leitor real, hater e nota final 0-10",
  model: MODELS.opus,
  fallbackModel: MODELS.sonnet,
  thinking: "disabled",
  effort: "low",
  systemPrompt: REVISOR_SYSTEM_PROMPT,
  acceptsReferenceImage: true,
  buildUserMessage: (ctx) => {
    const premissa = ctx.previousOutputs.premissa?.content?.trim() ?? "";
    const estrutura1 = ctx.previousOutputs.estrutura1?.content?.trim() ?? "";
    const estrutura2 = ctx.previousOutputs.estrutura2?.content?.trim() ?? "";
    const escrita = ctx.previousOutputs.escrita?.content?.trim() ?? "";
    const sections: string[] = [];

    sections.push(
      "Você vai revisar o roteiro abaixo com rigor TOTAL, aplicando todos os critérios do seu system prompt na risca. Use os materiais de referência (Premissa + Estruturas) para verificação de coerência. Entregue no FORMATO OBRIGATÓRIO definido no system prompt.",
    );

    if (ctx.referenceImage) {
      sections.push(
        "━━━ IMAGEM DE REFERÊNCIA ANEXADA ━━━\n\nA roteirista anexou uma imagem visual de referência (chega como input multimodal antes desta mensagem) que foi usada nos steps anteriores. NA SUA REVISÃO, verifique se:\n• Descrições físicas dos personagens no roteiro batem com a aparência da imagem\n• Mood/atmosfera/paleta da imagem está refletida na narrativa\n• Não há contradições visuais entre o que a imagem mostra e o que o roteiro descreve\n\nSe encontrar inconsistências entre imagem e roteiro, classifique-as conforme os 4 graus do seu system prompt (de 🟢 a 🔴) na seção apropriada.",
      );
    }

    if (escrita) {
      sections.push(
        `━━━ MATERIAL A REVISAR (vindo do Step 4 — Escrita) ━━━\n\n${escrita}`,
      );
    } else {
      sections.push(
        "━━━ MATERIAL A REVISAR ━━━\n\n⚠️ Nenhum roteiro foi encontrado no Step 4 (Escrita). Avise o usuário que precisa gerar o roteiro antes da revisão. NÃO invente conteúdo para revisar.",
      );
    }

    if (premissa) {
      sections.push(
        `━━━ REFERÊNCIA — PREMISSA APROVADA (Step 1) ━━━\n\n${premissa}`,
      );
    }

    if (estrutura1) {
      sections.push(
        `━━━ REFERÊNCIA — ESTRUTURA DA PARTE 1 APROVADA (Step 2) ━━━\n\n${estrutura1}`,
      );
    }

    if (estrutura2) {
      sections.push(
        `━━━ REFERÊNCIA — ESTRUTURA DA PARTE 2 APROVADA (Step 3) ━━━\n\n${estrutura2}`,
      );
    }

    if (ctx.userInput?.trim()) {
      sections.push(
        `━━━ INSTRUÇÕES ADICIONAIS DA ROTEIRISTA (foco específico da revisão, opcional) ━━━\n\n${ctx.userInput.trim()}`,
      );
    }

    sections.push(
      "━━━ AÇÃO ━━━\n\nFaça a revisão completa do roteiro acima cruzando com a premissa e as estruturas. Classifique TODOS os erros pelo grau correto (🟢 / 🟡 / 🟠 / 🔴), numere sequencialmente (apenas 🟡, 🟠 e 🔴), entregue no formato obrigatório (Principais Erros → Sugestões → Análise como Leitor Real → Análise de Hater → Risco de Hate → Nota Final → Melhorias Práticas). Seja brutalmente honesto. Não peça confirmação. Comece direto.",
    );

    return sections.join("\n\n");
  },
  // Capacidade alta — revisão de roteiro completo + relatório estruturado.
  maxTokens: 24000,
  temperature: 0.4,
};
