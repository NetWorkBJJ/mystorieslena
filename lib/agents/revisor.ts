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

    // Modo correção: a roteirista pediu pra ajustar um detalhe da REVISÃO
    // anterior — não é pra revisar o roteiro do zero. O agente devolve a
    // revisão atualizada no mesmo formato, aplicando apenas o ajuste pedido.
    if (ctx.refineMode && ctx.currentOutput?.trim() && ctx.userInput?.trim()) {
      const refine: string[] = [];
      refine.push(
        "Você JÁ entregou uma revisão completa do roteiro. A roteirista pediu uma CORREÇÃO PONTUAL na sua revisão — NÃO é pra revisar o roteiro do zero. Aplique APENAS o ajuste pedido (pode ser: rever uma classificação que ela discorda, refocar uma seção, expandir uma análise específica, recalcular a nota considerando algo que faltou) e devolva a revisão COMPLETA atualizada no FORMATO OBRIGATÓRIO do system prompt.",
      );
      refine.push(
        `━━━ SUA REVISÃO ANTERIOR (base a corrigir) ━━━\n\n${ctx.currentOutput.trim()}`,
      );
      refine.push(
        `━━━ INSTRUÇÃO DE CORREÇÃO DA ROTEIRISTA ━━━\n\n${ctx.userInput.trim()}`,
      );
      if (escrita) {
        refine.push(
          `━━━ ROTEIRO REVISADO (Step 4 — referência, consulte se a correção pedir releitura) ━━━\n\n${escrita}`,
        );
      }
      if (premissa) {
        refine.push(
          `━━━ PREMISSA APROVADA (Step 1 — referência) ━━━\n\n${premissa}`,
        );
      }
      if (estrutura1) {
        refine.push(
          `━━━ ESTRUTURA DA PARTE 1 APROVADA (Step 2 — referência) ━━━\n\n${estrutura1}`,
        );
      }
      if (estrutura2) {
        refine.push(
          `━━━ ESTRUTURA DA PARTE 2 APROVADA (Step 3 — referência) ━━━\n\n${estrutura2}`,
        );
      }
      refine.push(
        "━━━ AÇÃO ━━━\n\nReescreva a revisão COMPLETA aplicando APENAS a correção pedida. Mantenha o restante INTACTO (mesmas classificações, mesmos números, mesma análise) — só o que a roteirista pediu pra ajustar deve mudar. Se a correção implicar revisar a Nota Final ou o Risco de Hate, recalcule e justifique a mudança no item correspondente. Use o formato obrigatório (Principais Erros → Sugestões → Análise como Leitor Real → Análise de Hater → Risco de Hate → Nota Final → Melhorias Práticas). Comece direto, sem pedir confirmação.",
      );
      return refine.join("\n\n");
    }

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
