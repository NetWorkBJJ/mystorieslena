"use client";

import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  Hash,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function countWords(text: string): number {
  if (!text) return 0;
  return text
    .replace(/```[\s\S]*?```/g, " ") // Remove code blocks
    .replace(/[#*_`>~|—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

interface WordCountBadgeProps {
  content: string;
  /** Faixa-alvo. Se não passar, mostra só o número. */
  targetMin?: number;
  targetMax?: number;
  /** Margem de tolerância em palavras (dentro do alvo + margin = OK amarelo). */
  margin?: number;
  /** Rótulo opcional pra explicar o contexto. */
  label?: string;
  className?: string;
}

export function WordCountBadge({
  content,
  targetMin,
  targetMax,
  margin = 0,
  label,
  className,
}: WordCountBadgeProps) {
  const count = countWords(content);
  const hasTarget = typeof targetMin === "number" && typeof targetMax === "number";

  let status: "neutral" | "ok" | "warn" | "fail" = "neutral";
  if (hasTarget) {
    if (count >= targetMin! && count <= targetMax!) {
      status = "ok";
    } else if (
      count >= targetMin! - margin &&
      count <= targetMax! + margin
    ) {
      status = "warn";
    } else {
      status = "fail";
    }
  }

  const formatted = count.toLocaleString("pt-BR");

  return (
    <Badge
      className={cn(
        "font-normal gap-1 text-xs",
        status === "ok" &&
          "bg-emerald-100 text-emerald-800 border-emerald-300",
        status === "warn" &&
          "bg-amber-100 text-amber-800 border-amber-300",
        status === "fail" &&
          "bg-red-100 text-red-800 border-red-300",
        status === "neutral" &&
          "bg-secondary text-secondary-foreground border-border",
        className,
      )}
      title={
        hasTarget
          ? `Alvo: ${targetMin?.toLocaleString("pt-BR")}–${targetMax?.toLocaleString("pt-BR")} palavras`
          : undefined
      }
    >
      {status === "ok" && <CheckCircle2 className="size-3" />}
      {status === "warn" && <AlertTriangle className="size-3" />}
      {status === "fail" && <TriangleAlert className="size-3" />}
      {status === "neutral" && <Hash className="size-3" />}
      <span>
        {label ? `${label}: ` : ""}
        {formatted} {count === 1 ? "palavra" : "palavras"}
        {hasTarget && (
          <span className="opacity-75 ml-1">
            (alvo {targetMin?.toLocaleString("pt-BR")}–
            {targetMax?.toLocaleString("pt-BR")})
          </span>
        )}
      </span>
    </Badge>
  );
}
