/**
 * Helpers compartilhados pra aplicar sugestões de erros transversais do
 * Revisor (cards "Sugestão IA") via /api/escrita-apply-suggestion.
 *
 * Arquitetura:
 *   1. computeApplyScope(error, content, chapters) — calcula escopo SYNC.
 *      Retorna kind/label/conteúdo do trecho a mandar pro Opus.
 *   2. applySuggestionsToScope(scope, errors, ...) — faz a chamada (stream)
 *      e retorna o roteiro/chapters atualizados.
 *   3. applySuggestionToScope(error, ...) — wrapper pra aplicar UM erro
 *      (calcula escopo internamente). Chamado pelo botão da UI.
 */

import type { EscritaChapter, RevisorError } from "@/types/roteiro";
import {
  concatenateChapters,
  parseEscritaChaptersDirect,
} from "./parse-escrita-output";
import { validateRewrite } from "./validate-rewrite";

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
  /**
   * Sinaliza que a IA devolveu uma resposta que falhou validação (eco da
   * instrução, truncamento, briefing copiado em vez do capítulo) e o caller
   * deve avisar a usuária. Quando true, applied é false e o conteúdo
   * original foi preservado.
   */
  validationFailed?: boolean;
  /** Mensagem legível pra UI quando validationFailed=true. */
  validationMessage?: string;
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
  /** Cânone de Entidades — se presente, vai como referência canônica e o
   *  endpoint instrui o modelo a NÃO trocar nomes/idades/lugares/datas ao
   *  aplicar as sugestões. Sem isso, a expansão pode inventar variantes. */
  canone?: string;
  signal?: AbortSignal;
  onChunk?: (acc: string) => void;
}): Promise<SuggestionApplyResult> {
  const { scope, errors, fullEscritaContent, fullChapters, canone, signal, onChunk } =
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
        ...(canone?.trim() ? { canone } : {}),
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

  // Texto da instrução que pode ser ecoado pelo modelo. Usado pra detectar
  // quando o Opus copia o briefing literal em vez de aplicar a sugestão.
  // Concatena título + sugestão + porqueAlterado de todos os erros.
  const triggerText = suggestions
    .map((s) =>
      [s.titulo, s.sugestao, s.porqueAlterado].filter(Boolean).join(" "),
    )
    .join("\n");

  /**
   * Valida um cap reparseado contra o original correspondente em fullChapters.
   * Retorna o validation result do helper canônico.
   */
  const validateAgainstOriginal = (
    reparsed: EscritaChapter,
    original: EscritaChapter | undefined,
  ) => {
    if (!original) {
      return {
        ok: false as const,
        reason: "too-short" as const,
        message: `Cap ${reparsed.number} sem correspondente original.`,
      };
    }
    return validateRewrite({
      newContent: reparsed.content,
      originalContent: original.content,
      triggerText,
    });
  };

  let newFullContent: string;
  let newChapters: EscritaChapter[];

  if (scope.kind === "full") {
    const reparsed = parseEscritaChaptersDirect(newScopeContent);
    if (reparsed.length === 0) {
      // Sem capítulos parseáveis — não dá pra validar individualmente. Trata
      // como roteiro monolítico e roda só os checks de tamanho/eco no todo.
      const validation = validateRewrite({
        newContent: newScopeContent,
        originalContent: scope.content,
        triggerText,
      });
      if (!validation.ok) {
        console.warn(
          `[apply-suggestion] full sem caps + validação falhou: ${validation.reason}`,
        );
        return {
          applied: false,
          validationFailed: true,
          validationMessage:
            validation.message ??
            "A IA devolveu uma resposta inesperada — texto original mantido.",
        };
      }
      newFullContent = newScopeContent;
      newChapters = fullChapters;
    } else {
      // Valida cada cap reparseado contra seu original. Qualquer falha
      // invalida a aplicação inteira (evita salvar metade lixo).
      for (const r of reparsed) {
        const original = fullChapters.find(
          (c) => c.part === r.part && c.number === r.number,
        );
        const v = validateAgainstOriginal(r, original);
        if (!v.ok) {
          console.warn(
            `[apply-suggestion] full Cap ${r.number} ${r.part}: ${v.reason} — abortando aplicação. ${v.message ?? ""}`,
          );
          return {
            applied: false,
            validationFailed: true,
            validationMessage:
              v.message ??
              "A IA devolveu uma resposta inesperada — texto original mantido.",
          };
        }
      }
      newFullContent = newScopeContent;
      newChapters = reparsed;
    }
  } else if (scope.kind === "part") {
    const reparsedPart = parseEscritaChaptersDirect(newScopeContent);
    if (reparsedPart.length === 0) {
      console.warn(`[apply-suggestion] Não consegui reparsear a Parte`);
      return { applied: false };
    }
    const fallbackPart = scope.chapters[0]?.part;
    // Valida cada cap reparseado da Parte contra o original em scope.chapters.
    for (const r of reparsedPart) {
      const partOfR = r.part ?? fallbackPart;
      const original = scope.chapters.find(
        (c) => c.part === partOfR && c.number === r.number,
      );
      const v = validateAgainstOriginal(r, original);
      if (!v.ok) {
        console.warn(
          `[apply-suggestion] part Cap ${r.number} ${partOfR}: ${v.reason} — abortando aplicação. ${v.message ?? ""}`,
        );
        return {
          applied: false,
          validationFailed: true,
          validationMessage:
            v.message ??
            "A IA devolveu uma resposta inesperada — texto original mantido.",
        };
      }
    }
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
        const v = validateAgainstOriginal(r, updated[idx]);
        if (!v.ok) {
          console.warn(
            `[apply-suggestion] chapter Cap ${r.number} ${partOfR}: ${v.reason} — abortando aplicação. ${v.message ?? ""}`,
          );
          return {
            applied: false,
            validationFailed: true,
            validationMessage:
              v.message ??
              "A IA devolveu uma resposta inesperada — texto original mantido.",
          };
        }
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
  /** Cânone de Entidades — repassado pro endpoint pra preservar nomes/datas/
   *  lugares na reescrita. Opcional (roteiros legados sem cânone). */
  canone?: string;
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
    canone: params.canone,
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
