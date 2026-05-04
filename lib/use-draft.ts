import { useCallback, useEffect, useRef, useState } from "react";
import type { RoteiroDrafts } from "@/types/roteiro";
import { useWizard } from "@/store/wizard";

const DEBOUNCE_MS = 400;

/**
 * Hook de rascunho persistido para textareas do wizard.
 *
 * Resolve o bug de "perdi minha digitação ao trocar de step": o textarea
 * usa local state pra não relentar a UI, e o draft é gravado em
 * `roteiro.drafts[step][field]` (= localStorage) com debounce de 400ms.
 * No unmount, a última digitação é flush'ada — então mesmo trocar de step
 * imediatamente após digitar não perde o conteúdo.
 *
 * Hidratação: na primeira render, escolhe `drafts[step][field]` se existir,
 * senão `committedValue`. Rascunho prevalece sobre o valor oficial — se há
 * rascunho, é porque o usuário editou e não salvou ainda.
 *
 * Sincronização externa: se `committedValue` mudar e o local state ainda
 * casar com o último valor commitado conhecido, atualiza (cobre cenário de
 * "outra parte do app commitou via setOutput / setUserInput"). Se o local
 * state divergir, mantém o que o usuário tem digitado (não sobrescreve
 * trabalho não-salvo).
 */
export function useDraft<S extends keyof RoteiroDrafts>(
  step: S,
  field: keyof NonNullable<RoteiroDrafts[S]>,
  committedValue: string,
): [string, (value: string) => void, () => void] {
  const setDraft = useWizard((s) => s.setDraft);
  const clearDraft = useWizard((s) => s.clearDraft);
  // Lê snapshot atual do draft só na hidratação inicial — depois disso o
  // useState local é a fonte de verdade pro textarea, e o draft é apenas
  // o backup persistido. Sem isso, mudanças no store re-renderizariam
  // todo componente que chama useDraft em cada keystroke.
  // Cast intencional: a forma exata de drafts[step] varia por step (ver
  // RoteiroDrafts), mas em runtime sempre é um objeto flat de strings.
  // TS não consegue estreitar a partir de S genérico — então tratamos
  // como Record<string,string> só pra ler o valor inicial.
  const stepDraftsSnapshot = useWizard.getState().roteiro?.drafts?.[step] as
    | Record<string, string>
    | undefined;
  const initialDraft = stepDraftsSnapshot?.[field as string];

  const [value, setValueState] = useState<string>(
    initialDraft ?? committedValue,
  );

  const lastCommittedRef = useRef(committedValue);
  const pendingValueRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingValueRef.current !== null) {
      const pending = pendingValueRef.current;
      pendingValueRef.current = null;
      // Se o valor pendente bate com o committedValue, não há rascunho a
      // gravar — limpa qualquer draft antigo pra não confundir hidratação.
      if (pending === lastCommittedRef.current) {
        clearDraft(step, field);
      } else {
        setDraft(step, field, pending);
      }
    }
  }, [setDraft, clearDraft, step, field]);

  const setValue = useCallback(
    (next: string) => {
      setValueState(next);
      pendingValueRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pending = pendingValueRef.current;
        if (pending === null) return;
        pendingValueRef.current = null;
        if (pending === lastCommittedRef.current) {
          clearDraft(step, field);
        } else {
          setDraft(step, field, pending);
        }
      }, DEBOUNCE_MS);
    },
    [setDraft, clearDraft, step, field],
  );

  // Sync externo: outro fluxo (geração, restoreFromHistory, etc) commitou
  // um valor novo. Se o local state estava idêntico ao último commit
  // conhecido, o usuário não está digitando — pode adotar o novo valor.
  // Caso contrário, preserva o rascunho (não sobrescreve trabalho).
  useEffect(() => {
    if (committedValue === lastCommittedRef.current) return;
    setValueState((prev) => {
      if (prev === lastCommittedRef.current) {
        return committedValue;
      }
      return prev;
    });
    lastCommittedRef.current = committedValue;
  }, [committedValue]);

  // No unmount: flush imediato de qualquer pendência. Cobre o caso da
  // roteirista digitar e clicar em "Voltar" antes do debounce disparar.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  return [value, setValue, flush];
}
