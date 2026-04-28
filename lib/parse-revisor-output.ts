import type { RevisorError, RevisorErrorGravity } from "@/types/roteiro";

/**
 * Parser do bloco <erros_detalhados> emitido pelo Revisor (Step 5).
 *
 * O system prompt do Revisor instrui a emitir, ao final da resposta, um
 * bloco XML-like contendo um <erro> por cada erro 🟡/🟠/🔴 listado em
 * "PRINCIPAIS ERROS". Esse parser extrai esses blocos e devolve um array
 * estruturado que a UI usa pra renderizar os cards de correção e fazer
 * find+replace no roteiro da Escrita.
 *
 * Pra ser tolerante a output meio bagunçado (modelo às vezes esquece tag
 * de fechamento, mistura espaços, etc), o parser usa regex permissiva e
 * só valida que os 3 blocos obrigatórios (trecho_original, trecho_corrigido,
 * por_que_alterado) estão presentes — ignora silenciosamente erros mal
 * formados em vez de quebrar a tela inteira.
 */

const GRAVITY_MAP: Record<string, RevisorErrorGravity> = {
  atencao: "atencao",
  atenção: "atencao",
  interfere: "interfere",
  gravissimo: "gravissimo",
  gravíssimo: "gravissimo",
};

function decode(s: string): string {
  return s.trim();
}

function getAttr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m?.[1];
}

function getInner(block: string, tagName: string): string | undefined {
  const re = new RegExp(
    `<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`,
    "i",
  );
  const m = re.exec(block);
  return m ? decode(m[1]!) : undefined;
}

/**
 * Remove o bloco <erros_detalhados>...</erros_detalhados> do conteúdo bruto,
 * devolvendo o texto principal "limpo" (markdown da revisão sem o XML).
 */
export function stripErrosDetalhados(content: string): string {
  return content
    .replace(/<erros_detalhados>[\s\S]*?(?:<\/erros_detalhados>|$)/i, "")
    .trim();
}

/**
 * Extrai array de RevisorError do output bruto do Revisor. Devolve
 * lista vazia se o bloco não foi emitido ou se nada parseou.
 */
export function parseRevisorErrors(content: string): RevisorError[] {
  if (!content) return [];

  // 1) Localiza o bloco <erros_detalhados>...</erros_detalhados>. Se não
  //    encontrar fechamento, pega até o fim — modelo às vezes corta.
  const blockRe = /<erros_detalhados>([\s\S]*?)(?:<\/erros_detalhados>|$)/i;
  const blockMatch = blockRe.exec(content);
  if (!blockMatch) return [];
  const block = blockMatch[1] ?? "";

  // 2) Itera sobre cada <erro ...>...</erro>.
  const erroRe = /<erro\b([^>]*)>([\s\S]*?)<\/erro>/gi;
  const out: RevisorError[] = [];
  let m: RegExpExecArray | null;
  while ((m = erroRe.exec(block)) !== null) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";

    const numero = getAttr(attrs, "numero");
    const gravidadeRaw = getAttr(attrs, "gravidade")?.toLowerCase();
    const titulo = getAttr(attrs, "titulo");
    const capituloRaw = getAttr(attrs, "capitulo");
    const gravidade = gravidadeRaw
      ? (GRAVITY_MAP[gravidadeRaw] ?? "interfere")
      : "interfere";

    const trechoOriginal = getInner(inner, "trecho_original");
    const trechoCorrigido = getInner(inner, "trecho_corrigido");
    const porqueAlterado = getInner(inner, "por_que_alterado");

    // Skipa erro malformado — sem trechos, não dá pra aplicar.
    if (!trechoOriginal || !trechoCorrigido) continue;

    out.push({
      id: numero ?? `${out.length + 1}`,
      numero: numero ?? String(out.length + 1),
      gravidade,
      capitulo: capituloRaw ? Number(capituloRaw) : undefined,
      titulo: titulo ?? "Erro sem título",
      trechoOriginal,
      trechoCorrigido,
      porqueAlterado: porqueAlterado ?? "",
    });
  }

  return out;
}

/** Retorna o emoji + label correspondente à gravidade. */
export function gravityLabel(g: RevisorErrorGravity): {
  emoji: string;
  label: string;
} {
  switch (g) {
    case "atencao":
      return { emoji: "🟡", label: "Atenção" };
    case "interfere":
      return { emoji: "🟠", label: "Interfere" };
    case "gravissimo":
      return { emoji: "🔴", label: "Gravíssimo" };
  }
}

/**
 * Aplica uma lista de correções num texto-base (find+replace literal).
 * Devolve o texto novo + lista de IDs de erros que falharam (o trecho
 * original não foi encontrado no texto).
 */
export function applyCorrections(
  baseText: string,
  errors: RevisorError[],
): { text: string; appliedIds: string[]; failedIds: string[] } {
  let text = baseText;
  const appliedIds: string[] = [];
  const failedIds: string[] = [];

  for (const err of errors) {
    const original = err.trechoOriginal;
    if (!original) {
      failedIds.push(err.id);
      continue;
    }
    const idx = text.indexOf(original);
    if (idx === -1) {
      failedIds.push(err.id);
      continue;
    }
    // Substituição literal — só a primeira ocorrência. Se houver duplicadas,
    // o agente deveria ter dado contexto suficiente pra desambiguar (frase
    // completa). Substituir todas é arriscado.
    text =
      text.slice(0, idx) + err.trechoCorrigido + text.slice(idx + original.length);
    appliedIds.push(err.id);
  }

  return { text, appliedIds, failedIds };
}
