"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CATEGORIES, CATEGORY_ORDER } from "@/lib/categories";
import type { RoteiroCategory } from "@/lib/categories/types";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Disparado quando o usuário escolhe uma categoria e confirma. */
  onConfirm: (category: RoteiroCategory) => void;
}

/**
 * Modal de seleção de categoria — disparado pelo botão "Novo roteiro" antes
 * de criar o Roteiro. Cada card mostra label + descrição curta. A categoria
 * fica travada depois da criação (cada sub-nicho usa um conjunto de prompts
 * próprio nos 5 steps).
 *
 * Categorias com prompts ainda não enviados (ex.: milionário 3p) entram com
 * `disabled: true` e ficam visualmente desabilitadas até a autora enviar
 * o material. A escolha default é "milionario-1p" — o sub-nicho original.
 */
export function CategoryPicker({ open, onOpenChange, onConfirm }: Props) {
  const [selected, setSelected] = useState<RoteiroCategory>("milionario-1p");

  const isDisabled = (id: RoteiroCategory): boolean => {
    // Romance de Milionário em 3ª pessoa ainda não tem prompts próprios —
    // mostrar visualmente, mas desabilitar a seleção.
    return id === "milionario-3p";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">
            Escolha o sub-nicho
          </DialogTitle>
          <DialogDescription>
            Cada categoria carrega seu próprio jogo de prompts e regras. A
            escolha fica travada depois que o roteiro é criado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {CATEGORY_ORDER.map((id) => {
            const cat = CATEGORIES[id];
            const disabled = isDisabled(id);
            const isSelected = selected === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => !disabled && setSelected(id)}
                disabled={disabled}
                className={cn(
                  "text-left rounded-lg border p-4 transition",
                  disabled && "opacity-50 cursor-not-allowed",
                  !disabled && isSelected && "border-primary bg-primary/5 ring-2 ring-primary/20",
                  !disabled && !isSelected && "hover:border-primary/40 hover:bg-muted/50",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-1 size-4 rounded-full border-2 shrink-0",
                      isSelected && !disabled
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif text-base font-medium">
                      {cat.label}
                      {disabled && (
                        <span className="ml-2 text-xs font-sans text-muted-foreground">
                          (em breve)
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-primary/80 font-medium mt-0.5 uppercase tracking-wide">
                      Canais: {cat.channels}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                      {cat.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              onConfirm(selected);
              onOpenChange(false);
            }}
            disabled={isDisabled(selected)}
            className="gap-2"
          >
            Criar roteiro <ArrowRight className="size-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
