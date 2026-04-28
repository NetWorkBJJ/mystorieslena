/**
 * Contador de palavras CANÔNICO do projeto.
 *
 * Esta é a ÚNICA fonte de verdade pra contagem de palavras em qualquer
 * parte do app — UI, lógica de fix-wordcount, balance de Parte, exports.
 *
 * NUNCA crie outro contador (`split(/\s+/)` ingênuo conta diferente porque
 * não trata `—`, `–`, `-` e símbolos markdown). Toda divergência entre o
 * que o backend "vê" e o que o usuário lê na UI vira bug grave: o sistema
 * pediria fix-wordcount errado, e o usuário veria totais que não batem.
 *
 * Regras de contagem:
 *   - Code blocks ```...``` são removidos antes de contar.
 *   - Os caracteres markdown e dashes ( # * _ ` > ~ | — – - ) viram
 *     separadores. Importante em romance Helô com muito diálogo
 *     (`— Boa tarde.` → 2 palavras, não 3).
 *   - Sequências de whitespace colapsam em 1 espaço.
 *   - Palavras vazias são filtradas.
 *
 * Compatível com a regra de contagem do PDF mestre (Helô Stories™):
 *   - Parte 1: 11.200-11.500 palavras totais
 *   - Parte 2: 13.500 palavras totais
 */
export function countWords(text: string): number {
  if (!text) return 0;
  return text
    .replace(/```[\s\S]*?```/g, " ") // Remove code blocks
    .replace(/[#*_`>~|—–-]/g, " ") // Markdown + em/en dash + hífen
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}
