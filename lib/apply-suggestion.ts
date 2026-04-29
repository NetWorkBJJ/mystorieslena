/**
 * Helpers compartilhados pra aplicar sugestões de erros transversais do
 * Revisor (cards "Sugestão IA") via /api/escrita-apply-suggestion.
 *
 * Arquitetura:
 *   1. computeApplyScope(error, content, chapters) — calcula escopo SYNC.
 *      Retorna kind/label/conteúdo do trecho a mandar pro Opus.
 *   2. getScopeKey(scope) — chave única do escopo, pra agrupar erros que
 *      afetam o mesmo trecho numa única chamada Opus.
 *   3. applySuggestionsToScope(scope, errors, ...) — faz a chamada (stream)
 *      e retorna o roteiro/chapters atualizados.
 *
 * Otimização: vários erros de mesmo escopo (ex: 3 erros no Cap 4 da Parte 2)
 * viram UMA chamada Opus com lista de sugestões — em vez de N chamadas
 * sequenciais. Reduz drasticamente o tempo total.
 */

import type { EscritaChapter, RevisorError } from "@/types/roteiro";
import {
  concatenateChapters,
  parseEscritaChaptersDirect,
} from "./parse-escrita-output";

export type ScopeKind = "chapter" | "part" | "full";

export interface ApplyScope {
  kind: ScopeKind;
  /** Conteúdo do trecho recortado pra mandar pro Opus. */
  content: string;
  /** Caps incluídos no escopo (vazio quando kind=full). */
  chapters: EscritaChapter[];
  /** Rótulo legível pra UI ("Cap. 4 da Parte 2", "Parte 1 inteira", "roteiro inteiro"). */
  label: string;
}

export interface SuggestionApplyResult {
  applied: boolean;
  /** Conteúdo completo do roteiro atualizado (só populado se applied=true). */
  newContent?: string;
  /** Array de chapters atualizado (só populado se applied=true). */
  newChapters?: EscritaChapter[];
}

/**
 * Calcula o escopo cirúrgico pra aplicar a sugestão. Lógica:
 *   - parte+capítulo definidos + 1 cap match → "chapter"
 *   - parte+capítulo + múltiplos matches (duplicação) → "part" pra remover
 *   - só parte → "part"
 *   - nenhum → "full" (roteiro inteiro, último recurso)
 */
export function computeApplyScope(
  err: RevisorError,
  escritaContent: string,
  allChapters: EscritaChapter[],
): ApplyScope {
  const hasChaptersMetadata = allChapters.length > 0;
  const partLabel =
    err.parte === 1 ? "Parte 1" : err.parte === 2 ? "Parte 2" : undefined;

  if (
    hasChaptersMetadata &&
    partLabel &&
    typeof err.capitulo === "number"
  ) {
    const matchingCaps = allChapters.filter(
      (c) => c.part === partLabel && c.number === err.capitulo,
    );
    if (matchingCaps.length === 1) {
      return {
        kind: "chapter",
        chapters: matchingCaps,
        content: concatenateChapters(matchingCaps),
        label: `Cap. ${err.capitulo} da ${partLabel}`,
      };
    }
    if (matchingCaps.length > 1) {
      const partCaps = allChapters.filter((c) => c.part === partLabel);
      return {
        kind: "part",
        chapters: partCaps,
        content: concatenateChapters(partCaps),
        label: `${partLabel} (Cap. ${err.capitulo} duplicado ${matchingCaps.length}×)`,
      };
    }
  }

  if (hasChaptersMetadata && partLabel) {
    const partCaps = allChapters.filter((c) => c.part === partLabel);
    if (partCaps.length > 0) {
      return {
        kind: "part",
        chapters: partCaps,
        content: concatenateChapters(partCaps),
        label: `${partLabel} inteira`,
      };
    }
  }

  return {
    kind: "full",
    chapters: [],
    content: escritaContent,
    label: "roteiro inteiro",
  };
}

/**
 * Chave única de um escopo pra agrupar erros que afetam o mesmo trecho.
 * Erros com mesma chave podem ser aplicados em UMA chamada Opus.
 */
export function getScopeKey(scope: ApplyScope): string {
  if (scope.kind === "full") return "full";
  if (scope.kind === "part") {
    const part = scope.chapters[0]?.part ?? "?";
    return `part:${part}`;
  }
  // chapter
  const c = scope.chapters[0];
  return `chapter:${c?.part ?? "?"}:${c?.number ?? "?"}`;
}

/**
 * Aplica uma ou mais sugestões NO MESMO ESCOPO via Opus (uma chamada
 * só), via /api/escrita-apply-suggestion. O endpoint instrui o modelo
 * a aplicar todas as sugestões da lista no trecho recebido.
 *
 * onChunk: callback chamado a cada pedaço do stream (pra mostrar liveStream).
 */
export async function applySuggestionsToScope(params: {
  scope: ApplyScope;
  errors: RevisorError[];
  /** Roteiro inteiro (precisa pra reconstruir após aplicar o escopo). */
  fullEscritaContent: string;
  fullChapters: EscritaChapter[];
  signal?: AbortSignal;
  onChunk?: (acc: string) => void;
}): Promise<SuggestionApplyResult> {
  const { scope, errors, fullEscritaContent, fullChapters, signal, onChunk } =
    params;

  if (errors.length === 0) return { applied: false };

  const suggestions = errors
    .map((err) => {
      const sug = err.trechoCorrigido?.trim() || err.porqueAlterado?.trim();
      return sug
        ? {
            numero: err.numero,
            titulo: err.titulo || `Erro #${err.numero}`,
            sugestao: sug,
            porqueAlterado: err.porqueAlterado,
            gravidade: err.gravidade,
          }
        : null;
    })
    .filter((s): s is NonNullable<typeof s> => !!s);

  if (suggestions.length === 0) return { applied: false };

  let res: Response;
  try {
    res = await fetch("/api/escrita-apply-suggestion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        escritaContent: scope.content,
        scopeKind: scope.kind,
        scopeLabel: scope.label,
        suggestions,
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      return { applied: false };
    }
    console.warn(`[apply-suggestion] fetch falhou:`, e);
    return { applied: false };
  }

  if (!res.ok || !res.body) {
    console.warn(`[apply-suggestion] HTTP ${res.status}`);
    return { applied: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    onChunk?.(acc);
  }

  const newScopeContent = acc.trim();
  if (!newScopeContent || newScopeContent.includes("[ERRO]")) {
    console.warn(`[apply-suggestion] Stream vazio/erro`);
    return { applied: false };
  }

  const now = new Date().toISOString();

  let newFullContent: string;
  let newChapters: EscritaChapter[];

  if (scope.kind === "full") {
    newFullContent = newScopeContent;
    const reparsed = parseEscritaChaptersDirect(newFullContent);
    newChapters = reparsed.length > 0 ? reparsed : fullChapters;
  } else if (scope.kind === "part") {
    const reparsedPart = parseEscritaChaptersDirect(newScopeContent);
    if (reparsedPart.length === 0) {
      console.warn(`[apply-suggestion] Não consegui reparsear a Parte`);
      return { applied: false };
    }
    const fallbackPart = scope.chapters[0]?.part;
    const reparsedWithPart: EscritaChapter[] = reparsedPart.map((r) => ({
      ...r,
      part: r.part ?? fallbackPart,
      edited: true,
      editedAt: now,
    }));
    const firstIdx = fullChapters.findIndex((c) => c.part === fallbackPart);
    let lastIdx = -1;
    fullChapters.forEach((c, i) => {
      if (c.part === fallbackPart) lastIdx = i;
    });
    if (firstIdx === -1 || lastIdx === -1) {
      console.warn(`[apply-suggestion] Não localizei a Parte ${fallbackPart}`);
      return { applied: false };
    }
    const updated = [
      ...fullChapters.slice(0, firstIdx),
      ...reparsedWithPart,
      ...fullChapters.slice(lastIdx + 1),
    ];
    newChapters = updated;
    newFullContent = concatenateChapters(updated);
  } else {
    // chapter
    const reparsedScope = parseEscritaChaptersDirect(newScopeContent);
    if (reparsedScope.length === 0) {
      console.warn(`[apply-suggestion] Não consegui reparsear o capítulo`);
      return { applied: false };
    }
    const fallbackPart = scope.chapters[0]?.part;
    const updated = [...fullChapters];
    for (const r of reparsedScope) {
      const partOfR = r.part ?? fallbackPart;
      const idx = updated.findIndex(
        (c) => c.part === partOfR && c.number === r.number,
      );
      if (idx >= 0) {
        updated[idx] = {
          ...updated[idx]!,
          content: r.content,
          title: r.title ?? updated[idx]!.title,
          edited: true,
          editedAt: now,
        };
      }
    }
    newChapters = updated;
    newFullContent = concatenateChapters(updated);
  }

  // Suprime warnings sobre fullEscritaContent (só usado pra futura extensão).
  void fullEscritaContent;

  return {
    applied: true,
    newContent: newFullContent,
    newChapters,
  };
}

/**
 * Wrapper compatível com o call-site antigo do botão manual:
 * aplica UMA sugestão, calcula escopo internamente.
 */
export async function applySuggestionToScope(params: {
  error: RevisorError;
  escritaContent: string;
  chapters: EscritaChapter[];
  signal?: AbortSignal;
  onChunk?: (acc: string) => void;
}): Promise<SuggestionApplyResult & { scopeLabel: string; scopeKind: ScopeKind }> {
  const scope = computeApplyScope(
    params.error,
    params.escritaContent,
    params.chapters,
  );
  const result = await applySuggestionsToScope({
    scope,
    errors: [params.error],
    fullEscritaContent: params.escritaContent,
    fullChapters: params.chapters,
    signal: params.signal,
    onChunk: params.onChunk,
  });
  return {
    ...result,
    scopeLabel: scope.label,
    scopeKind: scope.kind,
  };
}

/**
 * Filtro: erros que precisam ser aplicados via Opus em vez de find+replace
 * (transversais, sem trecho_original literal).
 */
export function isInformativoError(e: RevisorError): boolean {
  return !e.trechoOriginal?.trim() || !e.trechoCorrigido?.trim();
}

/**
 * Agrupa uma lista de erros por escopo. Cada grupo pode ser aplicado em
 * uma chamada Opus única.
 */
export function groupErrorsByScope(
  errors: RevisorError[],
  escritaContent: string,
  chapters: EscritaChapter[],
): Array<{ scope: ApplyScope; errors: RevisorError[]; key: string }> {
  const map = new Map<
    string,
    { scope: ApplyScope; errors: RevisorError[]; key: string }
  >();
  for (const err of errors) {
    const scope = computeApplyScope(err, escritaContent, chapters);
    const key = getScopeKey(scope);
    const existing = map.get(key);
    if (existing) {
      existing.errors.push(err);
    } else {
      map.set(key, { scope, errors: [err], key });
    }
  }
  return Array.from(map.values());
}
