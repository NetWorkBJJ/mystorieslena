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

export function saveRoteiro(roteiro: Roteiro) {
  if (!isBrowser()) return;
  const all = listRoteiros();
  const idx = all.findIndex((r) => r.id === roteiro.id);
  const updated: Roteiro = { ...roteiro, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = updated;
  else all.push(updated);
  window.localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteRoteiro(id: string) {
  if (!isBrowser()) return;
  const all = listRoteiros().filter((r) => r.id !== id);
  window.localStorage.setItem(KEY, JSON.stringify(all));
}

export function newRoteiroId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
