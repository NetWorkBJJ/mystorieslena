import { compressToUTF16, decompressFromUTF16 } from "lz-string";

import type { Roteiro, StepGenerationSnapshot, StepId } from "@/types/roteiro";
import { DEFAULT_CATEGORY } from "@/types/roteiro";

const KEY = "veludo:roteiros";

/**
 * Sentinel que marca um valor comprimido com lz-string. Sem isso, não dá pra
 * distinguir um JSON cru (formato legado, escrito por versões ≤ 1.0.51) de
 * uma string UTF-16 comprimida — leitura quebraria pra qualquer um dos dois.
 * Backward-compat: roteiros antigos seguem sendo lidos como JSON cru, e o
 * próximo `saveRoteiro` regrava comprimido.
 */
const COMPRESSED_PREFIX = "LZ1:";

/**
 * Cap de snapshots por step no histórico. Antes era 20, mas com o texto
 * completo da Escrita (~200KB) salvo em cada snapshot sem dedup, isso
 * sozinho enchia o localStorage (4MB por roteiro só de histórico). 5 é o
 * suficiente pra dar undo confortável sem estourar o quota.
 */
const HISTORY_CAP = 5;

function isBrowser() {
  return typeof window !== "undefined";
}

/**
 * Backfill: roteiros antigos no localStorage não têm `category`. Como o app
 * sempre rodou só para Romance de Milionário (1ª pessoa), todo roteiro
 * legado vira dessa categoria. Sem esse fallback, qualquer lookup de
 * `category` em roteiros antigos quebraria silenciosamente.
 */
function migrateLegacy(r: Roteiro): Roteiro {
  if (!r.category) {
    return { ...r, category: DEFAULT_CATEGORY };
  }
  return r;
}

/**
 * Trunca qualquer pilha de history que esteja acima do HISTORY_CAP. Roteiros
 * salvos por versões antigas podem ter até 20 snapshots — esse prune roda na
 * leitura pra que a primeira gravação após a atualização já saia enxuta.
 */
function pruneHistory(r: Roteiro): Roteiro {
  if (!r.history) return r;
  let changed = false;
  const newHistory: Partial<Record<StepId, StepGenerationSnapshot[]>> = {};
  for (const [step, stack] of Object.entries(r.history) as [
    StepId,
    StepGenerationSnapshot[] | undefined,
  ][]) {
    if (!stack) continue;
    if (stack.length > HISTORY_CAP) {
      newHistory[step] = stack.slice(0, HISTORY_CAP);
      changed = true;
    } else {
      newHistory[step] = stack;
    }
  }
  return changed ? { ...r, history: newHistory } : r;
}

function serialize(roteiros: Roteiro[]): string {
  const json = JSON.stringify(roteiros);
  // Tenta comprimir; se algo bizarro acontecer (lz-string nunca lança em uso
  // normal, mas mantemos o fallback), grava cru — perder dados é pior do
  // que gravar maior.
  try {
    const compressed = compressToUTF16(json);
    if (compressed && compressed.length > 0) {
      return COMPRESSED_PREFIX + compressed;
    }
  } catch (e) {
    console.warn("[storage] falha na compressão, gravando cru:", e);
  }
  return json;
}

function deserialize(raw: string): Roteiro[] {
  if (raw.startsWith(COMPRESSED_PREFIX)) {
    const compressed = raw.slice(COMPRESSED_PREFIX.length);
    const json = decompressFromUTF16(compressed);
    if (!json) {
      console.error("[storage] falha ao descomprimir localStorage");
      return [];
    }
    return JSON.parse(json) as Roteiro[];
  }
  // Formato legado (JSON cru, versões ≤ 1.0.51). Próximo save vira comprimido.
  return JSON.parse(raw) as Roteiro[];
}

export function listRoteiros(): Roteiro[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = deserialize(raw);
    return parsed
      .map(migrateLegacy)
      .map(pruneHistory)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export function getRoteiro(id: string): Roteiro | null {
  return listRoteiros().find((r) => r.id === id) ?? null;
}

/**
 * Detecta se um erro vindo do localStorage é o limite de quota (~5MB).
 * Suporta tanto navegadores que setam `name === "QuotaExceededError"` quanto
 * versões antigas que usam o legacy `code === 22`.
 */
function isQuotaExceededError(e: unknown): boolean {
  if (e instanceof DOMException) {
    return e.name === "QuotaExceededError" || e.code === 22;
  }
  return false;
}

function safeSetItem(value: string) {
  // Sem o try/catch, se o usuário enche o localStorage (roteiros com imagem
  // inline em data URL passam fácil dos 5MB), o setItem lança e crasha o
  // renderer — Electron mostra tela branca sem nenhum aviso. Aqui capturamos
  // QuotaExceededError e disparamos um custom event pra UI mostrar dialog.
  try {
    window.localStorage.setItem(KEY, value);
  } catch (e) {
    if (isQuotaExceededError(e)) {
      console.error("[storage] localStorage cheio:", e);
      window.dispatchEvent(new CustomEvent("veludo:storage-quota-exceeded"));
      return;
    }
    throw e;
  }
}

export function saveRoteiro(roteiro: Roteiro) {
  if (!isBrowser()) return;
  const all = listRoteiros();
  const idx = all.findIndex((r) => r.id === roteiro.id);
  const updated: Roteiro = { ...roteiro, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = updated;
  else all.push(updated);
  safeSetItem(serialize(all));
}

/**
 * Coalesce de gravações: o Zustand chama persist() em todas as mutações
 * (setOutput, setUserInput, setDraft, etc). Sem debounce, cada keystroke
 * acionava `compressToUTF16()` síncrono em ~500KB-1MB de JSON, bloqueando
 * o main thread por 100-300ms — UI travava ao digitar.
 *
 * Aqui o roteiro mais recente fica num map (último vence), e um único
 * timer de SAVE_DEBOUNCE_MS dispara o flush. 50 keystrokes em rajada
 * viram 1 gravação. O flush em si roda em requestIdleCallback pra que,
 * se o teclado ainda estiver ativo no momento, a compressão saia do
 * critical path.
 *
 * `flushPendingSave()` força sync imediato — usar em beforeunload, ao
 * trocar de step, ao resetar o wizard. Sem isso, fechar o app antes do
 * timer expirar perderia a última edição.
 */
const SAVE_DEBOUNCE_MS = 600;
const pendingRoteiros = new Map<string, Roteiro>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let idleHandle: number | null = null;

type IdleCallbackHandle = number;
type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
interface IdleWindow {
  requestIdleCallback?: (
    cb: (deadline: IdleDeadline) => void,
    opts?: { timeout: number },
  ) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
}

function runWhenIdle(cb: () => void) {
  const w = window as IdleWindow & Window;
  if (typeof w.requestIdleCallback === "function") {
    idleHandle = w.requestIdleCallback(
      () => {
        idleHandle = null;
        cb();
      },
      { timeout: 1000 },
    );
  } else {
    idleHandle = window.setTimeout(() => {
      idleHandle = null;
      cb();
    }, 0) as unknown as number;
  }
}

function performPendingSave() {
  if (pendingRoteiros.size === 0) return;
  const all = listRoteiros();
  const now = new Date().toISOString();
  for (const [id, roteiro] of pendingRoteiros) {
    const idx = all.findIndex((r) => r.id === id);
    const updated: Roteiro = { ...roteiro, updatedAt: now };
    if (idx >= 0) all[idx] = updated;
    else all.push(updated);
  }
  pendingRoteiros.clear();
  safeSetItem(serialize(all));
}

export function scheduleSave(roteiro: Roteiro) {
  if (!isBrowser()) return;
  pendingRoteiros.set(roteiro.id, roteiro);
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    runWhenIdle(performPendingSave);
  }, SAVE_DEBOUNCE_MS);
}

export function flushPendingSave() {
  if (!isBrowser()) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (idleHandle !== null) {
    const w = window as IdleWindow & Window;
    if (typeof w.cancelIdleCallback === "function") {
      w.cancelIdleCallback(idleHandle);
    } else {
      clearTimeout(idleHandle);
    }
    idleHandle = null;
  }
  performPendingSave();
}

export function deleteRoteiro(id: string) {
  if (!isBrowser()) return;
  // Se havia gravação pendente desse roteiro, descarta — o delete vence.
  pendingRoteiros.delete(id);
  const all = listRoteiros().filter((r) => r.id !== id);
  safeSetItem(serialize(all));
}

export function newRoteiroId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
