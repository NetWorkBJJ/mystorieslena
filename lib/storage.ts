import type { Roteiro } from "@/types/roteiro";
import { DEFAULT_CATEGORY } from "@/types/roteiro";

const KEY = "veludo:roteiros";

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

export function listRoteiros(): Roteiro[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Roteiro[];
    return parsed
      .map(migrateLegacy)
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
  safeSetItem(JSON.stringify(all));
}

export function deleteRoteiro(id: string) {
  if (!isBrowser()) return;
  const all = listRoteiros().filter((r) => r.id !== id);
  safeSetItem(JSON.stringify(all));
}

export function newRoteiroId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
