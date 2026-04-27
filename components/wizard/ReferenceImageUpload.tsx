"use client";

import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, Trash2, AlertCircle } from "lucide-react";
import type { RoteiroReferenceImage } from "@/types/roteiro";
import { useWizard } from "@/store/wizard";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_MIME: RoteiroReferenceImage["mimeType"][] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Falha ao ler imagem."));
    reader.readAsDataURL(file);
  });
}

export function ReferenceImageUpload() {
  const referenceImage = useWizard((s) => s.roteiro?.referenceImage);
  const setReferenceImage = useWizard((s) => s.setReferenceImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const showError = (msg: string) => {
    if (errorRef.current) {
      errorRef.current.textContent = msg;
      errorRef.current.style.display = "flex";
    }
  };

  const clearError = () => {
    if (errorRef.current) {
      errorRef.current.style.display = "none";
    }
  };

  const handleSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      clearError();
      const file = e.target.files?.[0];
      if (!file) return;
      const mime = file.type as RoteiroReferenceImage["mimeType"];
      if (!ACCEPTED_MIME.includes(mime)) {
        showError(
          `Formato não suportado: ${file.type || "desconhecido"}. Use JPG, PNG, GIF ou WebP.`,
        );
        e.target.value = "";
        return;
      }
      if (file.size > MAX_BYTES) {
        showError(
          `Imagem muito grande (${formatBytes(file.size)}). Limite: 2 MB. Reduza o tamanho e tente de novo.`,
        );
        e.target.value = "";
        return;
      }
      try {
        const dataUrl = await readFileAsDataURL(file);
        setReferenceImage({
          dataUrl,
          mimeType: mime,
          filename: file.name,
          size: file.size,
          uploadedAt: new Date().toISOString(),
        });
        e.target.value = "";
      } catch (err) {
        showError(err instanceof Error ? err.message : "Falha ao ler imagem.");
      }
    },
    [setReferenceImage],
  );

  const handleRemove = useCallback(() => {
    setReferenceImage(null);
    clearError();
  }, [setReferenceImage]);

  const triggerSelect = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleSelect}
        className="hidden"
        aria-label="Imagem de referência"
      />

      {referenceImage ? (
        <div className="rounded-md border bg-card p-3 flex items-start gap-3">
          <div className="relative w-20 h-20 shrink-0 rounded-md overflow-hidden border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={referenceImage.dataUrl}
              alt="Pré-visualização da referência"
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <p className="text-sm font-medium truncate">
              {referenceImage.filename}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {formatBytes(referenceImage.size)} ·{" "}
              {referenceImage.mimeType.replace("image/", "").toUpperCase()}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={triggerSelect}
                className="h-7 text-xs"
              >
                <ImagePlus className="size-3.5" /> Trocar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemove}
                className="h-7 text-xs text-red-700 hover:text-red-800 hover:bg-red-50"
              >
                <Trash2 className="size-3.5" /> Remover
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={triggerSelect}
          className="rounded-md border border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.06] hover:border-primary/40 transition px-4 py-6 flex flex-col items-center gap-2 text-center cursor-pointer"
        >
          <ImagePlus className="size-6 text-primary/70" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-primary">
              Enviar imagem de referência (opcional)
            </span>
            <span className="text-[11px] text-muted-foreground leading-relaxed max-w-md">
              O agente <strong>Estrutura — Parte 1</strong> vai analisar a
              imagem junto com a premissa pra alinhar mood/visual da história.
              JPG · PNG · GIF · WebP · até 2 MB.
            </span>
          </div>
        </button>
      )}

      <p
        ref={errorRef}
        className="hidden items-center gap-1.5 text-xs text-red-700 px-1"
      >
        <AlertCircle className="size-3.5" />
      </p>
    </div>
  );
}
