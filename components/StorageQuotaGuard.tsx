"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Escuta o custom event `veludo:storage-quota-exceeded` (disparado por
 * `lib/storage.ts` quando o localStorage estoura ~5MB) e mostra um dialog
 * pedindo pra usuária apagar roteiros antigos. Sem esse guard, o erro de
 * quota crashava o renderer silenciosamente — a usuária via tela branca.
 *
 * Plugado em app/layout.tsx pra ficar disponível em qualquer rota.
 */
export function StorageQuotaGuard() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("veludo:storage-quota-exceeded", handler);
    return () => {
      window.removeEventListener("veludo:storage-quota-exceeded", handler);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Espaço de armazenamento cheio</DialogTitle>
          <DialogDescription>
            O navegador interno do app não conseguiu salvar o roteiro porque o
            espaço local (~5 MB) está cheio. Apague roteiros antigos da tela
            inicial pra liberar espaço — sem isso, o que você está editando
            agora não vai ser preservado quando fechar o app.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
