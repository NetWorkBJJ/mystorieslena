"use client";

import { useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ImagePlus, Trash2, AlertCircle } from "lucide-react";
import type { RoteiroReferenceImage } from "@/types/roteiro";
import { useWizard } from "@/store/wizard";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB (limite de upload)
// Acima disso ou de COMPRESS_MAX_DIM, recomprime pra JPEG. A imagem só é
// usada como referência visual pelos agentes — alta resolução/peso só
// inflava localStorage e payload das chamadas /api/agent/*.
const COMPRESS_MAX_BYTES = 400 * 1024; // 400 KB
const COMPRESS_MAX_DIM = 1024;
const COMPRESS_QUALITY = 0.85;
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao decodificar imagem."));
    img.src = src;
  });
}

// Tamanho aproximado do payload de um data URL base64 (cada 4 chars = 3 bytes).
function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// Se a imagem já está pequena (≤400KB) e em dimensão razoável (≤1024px),
// devolve original. Senão, renderiza num canvas com no máximo 1024×1024 e
// exporta JPEG q0.85. GIF animado fica reduzido a um único frame — aceitável
// pra uso como referência visual estática.
async function compressIfNeeded(
  file: File,
  originalDataUrl: string,
): Promise<{
  dataUrl: string;
  mimeType: RoteiroReferenceImage["mimeType"];
  size: number;
}> {
  const originalMime = file.type as RoteiroReferenceImage["mimeType"];
  let img: HTMLImageElement;
  try {
    img = await loadImage(originalDataUrl);
  } catch {
    return { dataUrl: originalDataUrl, mimeType: originalMime, size: file.size };
  }
  const maxDim = Math.max(img.width, img.height);
  if (file.size <= COMPRESS_MAX_BYTES && maxDim <= COMPRESS_MAX_DIM) {
    return { dataUrl: originalDataUrl, mimeType: originalMime, size: file.size };
  }
  const scale = Math.min(1, COMPRESS_MAX_DIM / maxDim);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dataUrl: originalDataUrl, mimeType: originalMime, size: file.size };
  }
  ctx.drawImage(img, 0, 0, w, h);
  const compressedDataUrl = canvas.toDataURL("image/jpeg", COMPRESS_QUALITY);
  return {
    dataUrl: compressedDataUrl,
    mimeType: "image/jpeg",
    size: dataUrlByteLength(compressedDataUrl),
  };
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
        const originalDataUrl = await readFileAsDataURL(file);
        const compressed = await compressIfNeeded(file, originalDataUrl);
        setReferenceImage({
          dataUrl: compressed.dataUrl,
          mimeType: compressed.mimeType,
          filename: file.name,
          size: compressed.size,
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
