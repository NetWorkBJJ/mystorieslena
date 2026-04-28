/**
 * Patches de correção pontual emitidos pelos agentes em refineMode.
 *
 * Quando a roteirista pede uma correção (ex.: "encurta o cap 3", "tira a
 * menção a João do parágrafo 2"), o agente NÃO regera o output inteiro:
 * devolve apenas pares `<alteracao>...<original>...</original>
 * <corrigido>...</corrigido></alteracao>`. O frontend faz find+replace
 * literal (com fallback fuzzy) no `output.content` corrente.
 *
 * Esse formato é uniforme entre Estrutura 1, Estrutura 2 e Revisor — a
 * Escrita usa um padrão diferente (capítulos completos por número+parte)
 * porque trechos longos de prosa ficam mais robustos quando o agente
 * devolve o capítulo inteiro do que como pares find/replace.
 */

import { findTrechoInText } from "@/lib/parse-revisor-output";

export interface CorrectionPatch {
  /** Texto literal a procurar no output corrente. */
  trechoOriginal: string;
  /** Texto novo que substitui o trecho_original. */
  trechoCorrigido: string;
  /** Descrição opcional do que mudou (vai pra log). */
  descricao?: string;
}

const ALTERACAO_RE = /<alteracao>([\s\S]*?)<\/alteracao>/gi;
const ORIGINAL_RE = /<(?:trecho_)?original>([\s\S]*?)<\/(?:trecho_)?original>/i;
const CORRIGIDO_RE =
  /<(?:trecho_)?corrigido>([\s\S]*?)<\/(?:trecho_)?corrigido>/i;
const DESCRICAO_RE = /<descricao>([\s\S]*?)<\/descricao>/i;

/**
 * Extrai os blocos `<alteracao>` do output do agente em refineMode. Aceita
 * tanto `<original>/<corrigido>` quanto `<trecho_original>/<trecho_corrigido>`
 * (o agente pode escolher — a versão curta é mais natural em refineMode,
 * a longa é o legado do Revisor).
 *
 * Retorna [] se nenhum bloco for detectado (fallback: a UI avisa que a
 * correção não pôde ser aplicada e mantém o output corrente intacto).
 */
export function parseCorrectionPatches(text: string): CorrectionPatch[] {
  const patches: CorrectionPatch[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(ALTERACAO_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const inner = m[1] ?? "";
    const orig = ORIGINAL_RE.exec(inner)?.[1];
    const corr = CORRIGIDO_RE.exec(inner)?.[1];
    if (typeof orig !== "string" || typeof corr !== "string") continue;
    const desc = DESCRICAO_RE.exec(inner)?.[1]?.trim();
    patches.push({
      trechoOriginal: orig.trim(),
      trechoCorrigido: corr.trim(),
      ...(desc ? { descricao: desc } : {}),
    });
  }
  return patches;
}

export interface ApplyResult {
  /** Texto após todos os patches aplicáveis. */
  text: string;
  /** Índices dos patches aplicados com sucesso (0-based). */
  appliedIndices: number[];
  /** Índices dos patches que não casaram nem com fuzzy match. */
  failedIndices: number[];
}

/**
 * Aplica patches num texto-base. Cada patch é tentado em ordem; só a
 * primeira ocorrência do trecho_original é substituída. Se um patch não
 * casar (nem literal nem fuzzy), entra em `failedIndices` e os outros
 * continuam.
 */
export function applyCorrectionPatches(
  baseText: string,
  patches: CorrectionPatch[],
): ApplyResult {
  let text = baseText;
  const appliedIndices: number[] = [];
  const failedIndices: number[] = [];

  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]!;
    if (!p.trechoOriginal) {
      failedIndices.push(i);
      continue;
    }
    const range = findTrechoInText(text, p.trechoOriginal);
    if (!range) {
      failedIndices.push(i);
      continue;
    }
    text =
      text.slice(0, range.start) + p.trechoCorrigido + text.slice(range.end);
    appliedIndices.push(i);
  }

  return { text, appliedIndices, failedIndices };
}
