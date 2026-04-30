import { MODELS } from "@/lib/anthropic";
import type { Agent } from "../types";
import { REVISOR_SYSTEM_PROMPT } from "./revisor-prompt";

/**
 * Etapa 5 — Revisor (Romance de Milionário 3ª pessoa, canal Rowan).
 *
 * Editor literário rigoroso especializado em romance de milionário em 3ª
 * pessoa. Revisa o roteiro do Step 4 cruzando com Premissa e Estruturas
 * aprovadas. Aplica 4 graus de classificação (🟢 não interfere, 🟡 atenção,
 * 🔴 interfere, 💀 gravíssimo — mesmos símbolos da máfia, NÃO os 🟠/🔴 do 1p).
 * Numera sequencialmente, dá nota final, mede risco de hate.
 */
export const revisorAgent: Agent = {
  id: "revisor",
  label: "Revisor",
  description:
    "Editor literário rigoroso de Milionário 3p — revisa o roteiro completo classificando erros em 4 graus (🟢 / 🟡 / 🔴 / 💀), numerando sequencialmente, com análise de leitor real, hater e nota final 0-10",
  model: MODELS.opus,
  thinking: "disabled",
  effort: "low",
  systemPrompt: REVISOR_SYSTEM_PROMPT,
  acceptsReferenceImage: true,
  buildUserMessage: (ctx) => {
    const premissa = ctx.previousOutputs.premissa?.content?.trim() ?? "";
    const estrutura1 = ctx.previousOutputs.estrutura1?.content?.trim() ?? "";
    const estrutura2 = ctx.previousOutputs.estrutura2?.content?.trim() ?? "";
    const escrita = ctx.previousOutputs.escrita?.content?.trim() ?? "";

    if (ctx.refineMode && ctx.currentOutput?.trim() && ctx.userInput?.trim()) {
      const refine: string[] = [];
      refine.push(
        "Você JÁ entregou uma revisão completa do roteiro. A roteirista pediu uma CORREÇÃO PONTUAL na sua revisão. NÃO regere a revisão inteira. Devolva APENAS as alterações no formato XML descrito abaixo.",
      );
      refine.push(
        `━━━ SUA REVISÃO ATUAL (consulte mas NÃO devolva inteira) ━━━\n\n${ctx.currentOutput.trim()}`,
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
        [
          "━━━ FORMATO DE SAÍDA OBRIGATÓRIO ━━━",
          "",
          "Para cada trecho da revisão que precisa mudar, emita um bloco:",
          "",
          "<alteracao>",
          "<descricao>linha curta explicando o que muda</descricao>",
          "<original>",
          "[trecho EXATO da revisão atual — copie literal, com mesma quebra de linha, mesmas aspas, mesmos emojis (🟢🟡🔴💀), mesmos travessões. Se for remover um <erro> do bloco <erros_detalhados>, copie o <erro>...</erro> INTEIRO no <original>.]",
          "</original>",
          "<corrigido>",
          "[trecho novo que substitui o original. Pode ser vazio (string vazia) se a intenção é REMOVER o trecho.]",
          "</corrigido>",
          "</alteracao>",
          "",
          "EXEMPLOS DE USO:",
          "",
          "1) Remover um erro do bloco <erros_detalhados>: <original> = `<erro><numero>3</numero>...</erro>` inteiro / <corrigido> = vazio.",
          "2) Reclassificar um erro de 🔴 pra 🟡: <original> = `## 🔴 INTERFERE — Erro #5: ...` / <corrigido> = `## 🟡 ATENÇÃO — Erro #5: ...`.",
          "3) Atualizar a Nota Final: <original> = `Nota Final: 7.5/10` / <corrigido> = `Nota Final: 8.0/10`.",
          "4) Adicionar um novo erro ao XML: <original> = `</erros_detalhados>` / <corrigido> = `<erro>...</erro>\\n</erros_detalhados>`.",
          "",
          "REGRAS RIGOROSAS:",
          "• Inclua um bloco <alteracao> POR cada trecho que muda.",
          "• <original> precisa ser cópia LITERAL.",
          "• <original> precisa ser ÚNICO na revisão.",
          "• NÃO devolva a revisão inteira. NÃO devolva markdown explicativo fora dos blocos.",
          "• Se mexer em uma classificação ou erro, considere se a Nota Final ou o Risco de Hate precisa ser recalculado.",
          "• Se a correção pedida não exigir alteração nenhuma, devolva apenas a string [NENHUMA_ALTERACAO_NECESSARIA] e nada mais.",
          "",
          "Comece direto pelo primeiro <alteracao>. Sem preâmbulo, sem perguntas.",
        ].join("\n"),
      );
      return refine.join("\n\n");
    }

    const sections: string[] = [];

    sections.push(
      "Você vai revisar o roteiro abaixo com rigor TOTAL, aplicando todos os critérios do seu system prompt na risca. Use os materiais de referência (Premissa + Estruturas) para verificação de coerência. Entregue no FORMATO OBRIGATÓRIO definido no system prompt.",
    );

    if (ctx.referenceImage) {
      sections.push(
        "━━━ IMAGEM DE REFERÊNCIA ANEXADA ━━━\n\nVerifique se descrições físicas dos personagens batem com a aparência da imagem, mood/atmosfera/paleta refletida na narrativa, sem contradições visuais. Inconsistências entre imagem e roteiro: classifique conforme os 4 graus (🟢 / 🟡 / 🔴 / 💀).",
      );
    }

    if (escrita) {
      sections.push(
        `━━━ MATERIAL A REVISAR (vindo do Step 4 — Escrita) ━━━\n\n${escrita}`,
      );
    } else {
      sections.push(
        "━━━ MATERIAL A REVISAR ━━━\n\n⚠️ Nenhum roteiro foi encontrado no Step 4 (Escrita). Avise o usuário que precisa gerar o roteiro antes da revisão. NÃO invente conteúdo.",
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
        `━━━ INSTRUÇÕES ADICIONAIS DA ROTEIRISTA (foco específico, opcional) ━━━\n\n${ctx.userInput.trim()}`,
      );
    }

    sections.push(
      "━━━ AÇÃO ━━━\n\nFaça a revisão completa do roteiro acima cruzando com a premissa e as estruturas. Classifique TODOS os erros pelo grau correto (🟢 / 🟡 / 🔴 / 💀), numere sequencialmente (apenas 🟡, 🔴 e 💀), entregue no formato obrigatório (Principais Erros → Sugestões → Análise como Leitor Real → Análise de Hater → Risco de Hate → Nota Final → bloco <erros_detalhados>). Seja brutalmente honesto. Não peça confirmação. Comece direto.",
    );

    return sections.join("\n\n");
  },
  maxTokens: 32000,
  temperature: 0.4,
};
