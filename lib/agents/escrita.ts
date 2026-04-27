import { MODELS } from "@/lib/anthropic";
import type { Agent } from "./types";
import { ESCRITA_SYSTEM_PROMPT } from "./escrita-prompt";

/**
 * Etapa 4 — Escrita (Helô Stories™ / Kay - Romance de Milionário).
 *
 * Fluxo unificado (Escrita + Start fundidos): recebe Premissa + Estrutura
 * Parte 1 + Estrutura Parte 2 e ESCREVE o roteiro completo de uma só vez,
 * em fluxo contínuo, todos os capítulos. Ao final aplica a tecnologia
 * promptmaster — relatório de auto-revisão, memória viva final e validação.
 */
export const escritaAgent: Agent = {
  id: "escrita",
  label: "Escrita",
  description:
    "Escreve o roteiro COMPLETO (Parte 1 + Parte 2) em fluxo contínuo seguindo as estruturas aprovadas, e aplica auto-revisão + memória viva + validação ao final",
  model: MODELS.opus,
  fallbackModel: MODELS.sonnet,
  thinking: "disabled",
  effort: "low",
  systemPrompt: ESCRITA_SYSTEM_PROMPT,
  acceptsReferenceImage: true,
  buildUserMessage: (ctx) => {
    const premissa = ctx.previousOutputs.premissa?.content?.trim() ?? "";
    const estrutura1 = ctx.previousOutputs.estrutura1?.content?.trim() ?? "";
    const estrutura2 = ctx.previousOutputs.estrutura2?.content?.trim() ?? "";
    const ajustes = ctx.userInput?.trim() ?? "";

    const sections: string[] = [];

    sections.push(
      "Você vai escrever o ROTEIRO COMPLETO agora — Parte 1 + Parte 2, todos os capítulos, em fluxo contínuo, sem interrupções, no estilo Helô Stories™. As estruturas abaixo são FONTE DE VERDADE — eventos, ordem, cenas, gancho de cada capítulo precisam bater com elas. Identifique automaticamente quantos capítulos cada Parte tem, a contagem alvo de cada um, onde há cena íntima e onde há trocas de POV (Parte 2). Comece DIRETO pelo Capítulo 1 da Parte 1.",
    );

    if (ctx.referenceImage) {
      sections.push(
        "━━━ IMAGEM DE REFERÊNCIA ANEXADA ━━━\n\nA roteirista anexou uma imagem visual (chega como input multimodal antes desta mensagem). USE pra calibrar:\n• Descrições físicas dos personagens (rosto, corpo, cabelo, traços) sempre que aparecerem na narrativa\n• Cenário/ambientação descrita nas cenas\n• Mood/atmosfera (paleta de cores, peso emocional, iluminação)\n• Estilo de pequenos detalhes sensoriais (cheiro, textura, som)\n\nIntegre os elementos visuais ao texto narrativo de forma natural, sem ficar descrevendo a imagem. As ESTRUTURAS aprovadas e a PREMISSA TEXTUAL prevalecem sobre a imagem em qualquer conflito.",
      );
    }

    if (premissa) {
      sections.push(`━━━ PREMISSA APROVADA (Step 1) ━━━\n\n${premissa}`);
    } else {
      sections.push(
        "━━━ PREMISSA ━━━\n\n⚠️ Não fornecida. Avise no início do roteiro mas siga gerando com base nas estruturas.",
      );
    }

    if (estrutura1) {
      sections.push(
        `━━━ ESTRUTURA DA PARTE 1 APROVADA (Step 2 — siga FIELMENTE) ━━━\n\n${estrutura1}`,
      );
    } else {
      sections.push(
        "━━━ ESTRUTURA DA PARTE 1 ━━━\n\n⚠️ Não fornecida. Marque \"⚠️ ESTRUTURA DA PARTE 1 NÃO RECEBIDA — improviso baseado na premissa\" e siga.",
      );
    }

    if (estrutura2) {
      sections.push(
        `━━━ ESTRUTURA DA PARTE 2 APROVADA (Step 3 — siga FIELMENTE) ━━━\n\n${estrutura2}`,
      );
    } else {
      sections.push(
        "━━━ ESTRUTURA DA PARTE 2 ━━━\n\n⚠️ Não fornecida. Marque \"⚠️ ESTRUTURA DA PARTE 2 NÃO RECEBIDA — improviso\" e siga até a Parte 2 com base no que tiver.",
      );
    }

    if (ajustes) {
      sections.push(
        `━━━ INSTRUÇÕES ADICIONAIS DA ROTEIRISTA (ajustes opcionais) ━━━\n\n${ajustes}`,
      );
    }

    sections.push(
      "━━━ AÇÃO ━━━\n\n1) Identifique pela estrutura quantos capítulos a Parte 1 tem, quantos a Parte 2 tem, a contagem alvo de cada um, onde há cena íntima e onde há trocas de POV.\n2) Escreva TODOS os capítulos da Parte 1 em fluxo contínuo, depois TODOS os capítulos da Parte 2 (com marcadores de POV onde a estrutura indicar).\n3) NÃO escreva HOOK. NÃO interrompa entre capítulos. NÃO insira contagem de palavras dentro do corpo da narrativa. NÃO mencione \"parte 1\", \"parte 2\", \"capítulo X\" no corpo da narrativa — só nos cabeçalhos estruturais.\n4) AO FINAL DO ROTEIRO COMPLETO, aplique a tecnologia: 5 passadas de auto-revisão (espaço, tempo, cruzamento, POV, 1ª pessoa) → memória viva final completa → validação bloqueante (8 regras).\n5) Siga o FORMATO DE SAÍDA do system prompt na risca — comece com o marcador \"═══ ROTEIRO ═══\", depois \"═══ PARTE 1 ═══\", depois capítulos, depois \"═══ PARTE 2 ═══\", depois capítulos, depois RELATÓRIO, MEMÓRIA, VALIDAÇÃO.\n\n⚠️ CONTAGEM DE PALAVRAS (REGRAS INEGOCIÁVEIS):\n- **Parte 1: TOTAL entre 11.300 e 11.700 palavras** (alvo 11.500), distribuídas conforme a estrutura aprovada.\n- **Parte 2: TOTAL entre 13.000 e 13.500 palavras** (RIGOROSO), distribuídas conforme a estrutura aprovada.\n- Cada capítulo dentro da margem ±5% do que a estrutura indica.\n- Antes de fechar cada Parte, SOME mentalmente as palavras de seus capítulos. Se faltar, EXPANDA cenas; se sobrar, ENCURTE.\n- Registre a contagem real de cada capítulo no campo \`contagem_palavras\` da memória viva final.",
    );

    return sections.join("\n\n");
  },
  // Capacidade alta — roteiro completo (Parte 1 ~11.500 + Parte 2 ~13.250)
  // ≈ 24.750 palavras + relatório + memória viva + validação. Subindo o
  // teto pro máximo razoável; se truncar, ajustamos.
  maxTokens: 64000,
  temperature: 0.85,
};
