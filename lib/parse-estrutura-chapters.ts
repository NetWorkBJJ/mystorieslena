/**
 * Conta quantos capítulos uma Estrutura aprovada (Step 2 ou Step 3) declara.
 *
 * As estruturas saem com cabeçalhos no formato `# Capítulo N — Título` (ou
 * `## Capítulo N`, ou variações com en/em-dash). O agente Escrita usa esse
 * número pra saber quantos pares vai gerar — sem isso, não há como o
 * frontend planejar o loop de batches 2-em-2.
 */

const CHAPTER_HEADER_REGEX =
  /^#{1,4}\s*Cap[ií]tulo\s+(\d+)\b/gim;

export function countChaptersInEstrutura(estrutura: string | undefined): number {
  if (!estrutura?.trim()) return 0;
  const seen = new Set<number>();
  let m: RegExpExecArray | null;
  // RegExp com flag /g é stateful — instancia uma cópia pra evitar bugs de reuse.
  const re = new RegExp(CHAPTER_HEADER_REGEX.source, "gim");
  while ((m = re.exec(estrutura)) !== null) {
    const n = parseInt(m[1]!, 10);
    if (Number.isFinite(n) && n > 0) seen.add(n);
  }
  return seen.size;
}

export interface BatchPlan {
  part: "Parte 1" | "Parte 2";
  chapters: number[]; // 1 ou 2 entradas, números absolutos dentro da Parte
  totalInPart: number;
  batchIndex: number; // 1-based
  /** Alvo de palavras por capítulo desse batch — alinhado com `chapters`. */
  targets: number[];
}

/**
 * Monta a lista de batches respeitando a fronteira entre Parte 1 e Parte 2.
 * Nenhum batch atravessa parte — se Parte 1 tem 5 caps, sai como [1,2], [3,4], [5].
 *
 * `targetsP1`/`targetsP2` são arrays alinhados aos números absolutos dos caps
 * (índice 0 = cap 1, índice 1 = cap 2, etc). Se a estrutura não declarou alvo
 * pra algum cap, o caller já deveria ter feito o fallback.
 */
export function planBatches(
  totalParte1: number,
  totalParte2: number,
  targetsP1?: number[],
  targetsP2?: number[],
): BatchPlan[] {
  const plan: BatchPlan[] = [];
  let idx = 0;
  // Fallbacks só são usados quando a estrutura NÃO declara alvo per cap
  // (caso degenerado). Os totais batem com partTotalRange (P1: 11.500 mid,
  // P2: 13.250 mid). Em uso real a estrutura sempre tem alvo per cap.
  for (let i = 1; i <= totalParte1; i += 2) {
    const chapters = i + 1 <= totalParte1 ? [i, i + 1] : [i];
    const targets = chapters.map(
      (n) => targetsP1?.[n - 1] ?? Math.round(11500 / Math.max(totalParte1, 1)),
    );
    idx += 1;
    plan.push({
      part: "Parte 1",
      chapters,
      totalInPart: totalParte1,
      batchIndex: idx,
      targets,
    });
  }
  for (let i = 1; i <= totalParte2; i += 2) {
    const chapters = i + 1 <= totalParte2 ? [i, i + 1] : [i];
    const targets = chapters.map(
      (n) => targetsP2?.[n - 1] ?? Math.round(13250 / Math.max(totalParte2, 1)),
    );
    idx += 1;
    plan.push({
      part: "Parte 2",
      chapters,
      totalInPart: totalParte2,
      batchIndex: idx,
      targets,
    });
  }
  return plan;
}
