/**
 * Helper que monta o bloco "CÂNONE DE ENTIDADES" que é injetado no user
 * message de TODOS os agentes pós-Premissa (estrutura1, estrutura2,
 * escrita, revisor) em TODAS as categorias.
 *
 * Padrão: bloco vai como PRIMEIRA referência, antes da Premissa, porque
 * em caso de conflito o cânone vence (ver REGRA CANÔNICA nos system
 * prompts). Quando o roteiro é legado (sem cânone), retorna null e o
 * agente cai no fluxo antigo — comportamento backward-compatible.
 */
export function buildCanoneBlock(canone: string | undefined): string | null {
  const trimmed = canone?.trim();
  if (!trimmed) return null;
  return `━━━ CÂNONE DE ENTIDADES — fonte canônica de nomes/idades/lugares/datas (NUNCA inventar variações) ━━━\n\n${trimmed}`;
}
