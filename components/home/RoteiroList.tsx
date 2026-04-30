"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteRoteiro,
  listRoteiros,
  newRoteiroId,
  saveRoteiro,
} from "@/lib/storage";
import type { Roteiro } from "@/types/roteiro";
import { STEP_ORDER } from "@/types/roteiro";
import { CATEGORIES } from "@/lib/categories";
import type { RoteiroCategory } from "@/lib/categories/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialogRoot,
  AlertDialog,
} from "./AlertDialog";
import { CategoryPicker } from "./CategoryPicker";
import { ArrowRight, FileText, Plus, Trash2 } from "lucide-react";

export function RoteiroList() {
  const router = useRouter();
  const [roteiros, setRoteiros] = useState<Roteiro[]>([]);
  const [ready, setReady] = useState(false);
  const [toDelete, setToDelete] = useState<Roteiro | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refresh = useCallback(() => {
    setRoteiros(listRoteiros());
  }, []);

  useEffect(() => {
    refresh();
    setReady(true);
  }, [refresh]);

  const handlePickCategory = useCallback(
    (category: RoteiroCategory) => {
      const id = newRoteiroId();
      const now = new Date().toISOString();
      const r: Roteiro = {
        id,
        title: `Novo roteiro — ${new Date().toLocaleString("pt-BR")}`,
        category,
        createdAt: now,
        updatedAt: now,
        currentStep: "premissa",
        outputs: {},
      };
      saveRoteiro(r);
      router.push(`/roteiro/${id}`);
    },
    [router],
  );

  const openPicker = useCallback(() => setPickerOpen(true), []);

  const confirmDelete = useCallback(() => {
    if (!toDelete) return;
    deleteRoteiro(toDelete.id);
    setToDelete(null);
    refresh();
  }, [toDelete, refresh]);

  if (!ready) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Carregando...
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <h2 className="text-xl font-serif">Seus roteiros</h2>
        <Button onClick={openPicker} className="gap-2" size="lg">
          <Plus className="size-4" />
          Novo roteiro
        </Button>
      </div>

      {roteiros.length === 0 ? (
        <Card className="py-16 px-6 flex flex-col items-center gap-3 text-center border-dashed">
          <FileText className="size-10 text-muted-foreground" />
          <h3 className="font-serif text-lg">Nenhum roteiro ainda</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Clique em <span className="font-semibold">Novo roteiro</span> para
            começar. As 5 etapas guiam você da premissa até o roteiro final.
          </p>
          <Button onClick={openPicker} className="mt-2 gap-2">
            <Plus className="size-4" />
            Criar primeiro roteiro
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3">
          {roteiros.map((r) => {
            const completed = STEP_ORDER.filter(
              (s) => !!r.outputs[s]?.content,
            ).length;
            return (
              <Card
                key={r.id}
                className="p-4 sm:p-5 flex items-center gap-4 flex-wrap hover:border-primary/40 transition"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/roteiro/${r.id}`}
                    className="block hover:underline underline-offset-4"
                  >
                    <h3 className="font-serif text-base sm:text-lg truncate">
                      {r.title}
                    </h3>
                  </Link>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                    <Badge variant="outline" className="font-normal">
                      {CATEGORIES[r.category].label}
                    </Badge>
                    <Badge variant="secondary" className="font-normal">
                      {completed} de {STEP_ORDER.length} etapas
                    </Badge>
                    <span>·</span>
                    <span>
                      Atualizado{" "}
                      {new Date(r.updatedAt).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setToDelete(r)}
                    aria-label="Excluir roteiro"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Link href={`/roteiro/${r.id}`}>
                    <Button variant="ghost" size="sm" className="gap-1">
                      Abrir <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={handlePickCategory}
      />

      <AlertDialogRoot open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialog
          title="Excluir roteiro?"
          description={`"${toDelete?.title}" será removido permanentemente do seu navegador.`}
          confirmLabel="Excluir"
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          destructive
        />
      </AlertDialogRoot>
    </>
  );
}
