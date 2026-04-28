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

/**
 * Hash leve do conteúdo da Escrita pra detectar edição posterior à revisão.
 * Não é cripto — só precisa mudar quando o texto muda. Inclui length +
 * primeiros e últimos 100 chars (cobre edições no meio também porque
 * length muda).
 */
export function hashEscritaContent(content: string): string {
  const len = content.length;
  const head = content.slice(0, 100);
  const tail = content.slice(-100);
  return `${len}:${head.length}:${tail.length}:${head}|${tail}`;
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
 * Normalização tolerante a variações tipográficas: aspas curvas → retas,
 * travessões equivalentes, runs de whitespace → 1 espaço. Devolve a string
 * normalizada + mapa de índice (cada posição na normalizada aponta pro
 * índice correspondente na original) pra permitir reconstituição.
 */
function normalizeForMatch(s: string): {
  norm: string;
  mapToOrig: number[];
} {
  const out: string[] = [];
  const map: number[] = [];
  let prevWasSpace = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    let normalized: string;
    if (c === "“" || c === "”" || c === "«" || c === "»") {
      normalized = '"';
    } else if (
      c === "‘" ||
      c === "’" ||
      c === "′" ||
      c === "`"
    ) {
      normalized = "'";
    } else if (c === "–" || c === "—" || c === "−") {
      // En-dash, em-dash, minus → em-dash unificado.
      normalized = "—";
    } else if (/\s/.test(c)) {
      // Runs de whitespace viram um único espaço.
      if (prevWasSpace) continue;
      normalized = " ";
      prevWasSpace = true;
      out.push(normalized);
      map.push(i);
      continue;
    } else {
      normalized = c;
    }
    prevWasSpace = false;
    out.push(normalized);
    map.push(i);
  }
  return { norm: out.join(""), mapToOrig: map };
}

/**
 * Procura `needle` dentro de `haystack` tentando primeiro match literal e,
 * se falhar, match fuzzy (normalizando aspas curvas, travessões e
 * whitespace). Devolve {start, end} no texto ORIGINAL pra fazer slice
 * direto, ou null se nem assim achou.
 */
function findTrechoInText(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  // Tentativa 1: literal.
  const literal = haystack.indexOf(needle);
  if (literal !== -1) {
    return { start: literal, end: literal + needle.length };
  }

  // Tentativa 2: fuzzy.
  const normHay = normalizeForMatch(haystack);
  const normNeedle = normalizeForMatch(needle);
  const fuzzy = normHay.norm.indexOf(normNeedle.norm);
  if (fuzzy === -1) return null;

  const normEnd = fuzzy + normNeedle.norm.length;
  // Mapeia: posição no normalizado → posição no original.
  const start = normHay.mapToOrig[fuzzy];
  if (start === undefined) return null;
  // O fim é a posição original do último char + 1. Se o último char no
  // normalizado é um " " (whitespace run colapsado), pegamos até o fim do
  // run no original.
  const lastNormIdx = normEnd - 1;
  const lastOrigIdx = normHay.mapToOrig[lastNormIdx];
  if (lastOrigIdx === undefined) return null;
  // Se a posição seguinte no original também é whitespace (parte do mesmo
  // run colapsado), avança até sair do run.
  let end = lastOrigIdx + 1;
  if (/\s/.test(haystack[lastOrigIdx]!)) {
    while (end < haystack.length && /\s/.test(haystack[end]!)) end++;
  }
  return { start, end };
}

/**
 * Aplica uma lista de correções num texto-base (find+replace).
 * Tenta primeiro match literal; se o trecho não bate exatamente (aspas
 * curvas vs retas, travessão diferente, whitespace), tenta match fuzzy
 * normalizado. Devolve o texto novo + lista de IDs aplicados/falhados.
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
    const range = findTrechoInText(text, original);
    if (!range) {
      failedIds.push(err.id);
      continue;
    }
    // Substituição literal — só a primeira ocorrência. Se houver duplicadas,
    // o agente deveria ter dado contexto suficiente pra desambiguar (frase
    // completa). Substituir todas é arriscado.
    text =
      text.slice(0, range.start) + err.trechoCorrigido + text.slice(range.end);
    appliedIds.push(err.id);
  }

  return { text, appliedIds, failedIds };
}
