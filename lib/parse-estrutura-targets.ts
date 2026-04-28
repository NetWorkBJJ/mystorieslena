/**
 * Extrai o alvo de palavras de cada capítulo de uma Estrutura aprovada.
 *
 * As estruturas sinalizam o alvo de várias formas — o parser tolera
 * todas as comuns:
 *   - "Alvo: ~2.500 palavras"
 *   - "(2500 palavras)"
 *   - "~2.500 palavras"
 *   - "Contagem: 2300-2700"
 *   - "Contagem: 2300 a 2700 palavras"
 *
 * Quando uma faixa é dada (`A-B`), o alvo é a média (a, b) → (a+b)/2.
 * Quando nenhum alvo é detectável pra um capítulo, retorna undefined
 * pra ele — a chamada que pediu pode fazer fallback.
 */

const CHAPTER_HEADER_REGEX = /^#{1,4}\s*Cap[ií]tulo\s+(\d+)/im;

/**
 * Quebra a estrutura em blocos de capítulo. Cada bloco vai do header
 * "# Capítulo N" até o próximo header (ou fim do texto). O `body`
 * INCLUI a linha do header — porque no formato real do prompt mestre o
 * alvo de palavras vem entre parênteses no próprio header:
 *   `## Capítulo 1 — A Chegada (~1.380 palavras — ritmo rápido)`
 * Sem incluir a linha do header, o parser nunca acha o alvo.
 */
function splitChapterBlocks(
  estrutura: string,
): Array<{ number: number; body: string }> {
  type Hit = { number: number; index: number };
  const hits: Hit[] = [];
  const re = /^#{1,4}\s*Cap[ií]tulo\s+(\d+)\b[^\n]*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(estrutura)) !== null) {
    hits.push({
      number: parseInt(m[1]!, 10),
      index: m.index,
    });
  }
  hits.sort((a, b) => a.index - b.index);

  const blocks: Array<{ number: number; body: string }> = [];
  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i]!;
    const nextStart =
      i + 1 < hits.length ? hits[i + 1]!.index : estrutura.length;
    blocks.push({
      number: cur.number,
      body: estrutura.slice(cur.index, nextStart), // INCLUI header
    });
  }
  return blocks;
}

/** Tenta extrair um número de palavras de um bloco de texto. */
function extractTargetFromBlock(body: string): number | undefined {
  // Normaliza separador de milhar: "2.500" → "2500" (mas "2.5" continua "2.5")
  const normalized = body.replace(/(\d)\.(\d{3}\b)/g, "$1$2");

  // Padrão 1: faixa "X-Y palavras" ou "X a Y palavras"
  const range =
    /(\d{3,5})\s*(?:[-–—]|a)\s*(\d{3,5})\s*palavras/i.exec(normalized);
  if (range) {
    const a = parseInt(range[1]!, 10);
    const b = parseInt(range[2]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a < b) {
      return Math.round((a + b) / 2);
    }
  }

  // Padrão 2: "~X palavras" / "X palavras" / "(X palavras)"
  const single = /(?:~|aproximadamente\s+)?(\d{3,5})\s*palavras/i.exec(
    normalized,
  );
  if (single) {
    const n = parseInt(single[1]!, 10);
    if (Number.isFinite(n) && n >= 100 && n <= 50000) return n;
  }

  return undefined;
}

export interface ChapterTarget {
  number: number;
  target?: number; // undefined → caller faz fallback
}

export function extractChapterTargets(
  estrutura: string | undefined,
): ChapterTarget[] {
  if (!estrutura?.trim()) return [];
  const blocks = splitChapterBlocks(estrutura);
  return blocks.map((b) => ({
    number: b.number,
    target: extractTargetFromBlock(b.body),
  }));
}

/**
 * Helper: dado a lista de targets parseados e o total esperado da Parte
 * (11.500 pra Parte 1, 13.250 pra Parte 2 — defaults do prompt),
 * preenche os capítulos sem alvo com a média da Parte (uniform fallback).
 */
export function fillTargetsWithFallback(
  targets: ChapterTarget[],
  partTotal: number,
): Array<{ number: number; target: number }> {
  const numChapters = targets.length || 1;
  const fallback = Math.round(partTotal / numChapters);
  return targets.map((t) => ({
    number: t.number,
    target: t.target ?? fallback,
  }));
}

/**
 * Margens de aceitação: ±3% do alvo (apertado pra atender a regra rígida do
 * PDF — totais por Parte são quase exatos, então cada cap precisa cair perto
 * do seu alvo individual). Mínimo absoluto de 30 palavras pra alvos pequenos.
 */
export function targetRange(target: number): { min: number; max: number } {
  const margin = Math.max(30, Math.round(target * 0.03));
  return { min: target - margin, max: target + margin };
}

export function isWithinTarget(actual: number, target: number): boolean {
  const { min, max } = targetRange(target);
  return actual >= min && actual <= max;
}

/**
 * Range obrigatório de palavras TOTAIS de uma Parte, conforme regra do PDF
 * mestre EXATA do prompt das estruturas (lib/agents/estrutura1-prompt.ts e
 * estrutura2-prompt.ts). Esses números não são negociáveis — diferente do
 * alvo per cap (que tem margem ±3%), o total da Parte tem que cair aqui.
 */
export function partTotalRange(part: "Parte 1" | "Parte 2"): {
  min: number;
  max: number;
  target: number;
} {
  if (part === "Parte 1") {
    // estrutura1-prompt.ts: "Total de palavras: 11.500 (faixa 11.300–11.700) — RIGOROSO"
    return { min: 11300, max: 11700, target: 11500 };
  }
  // estrutura2-prompt.ts: "Mínimo 13.000 — Máximo 13.500. Rigoroso."
  return { min: 13000, max: 13500, target: 13250 };
}
