"use client";

import { cn } from "@/lib/utils";
import { STEP_LABELS, STEP_ORDER, type StepId } from "@/types/roteiro";
import { Check } from "lucide-react";

interface Props {
  current: StepId;
  completed: StepId[];
  onSelect?: (step: StepId) => void;
}

export function StepIndicator({ current, completed, onSelect }: Props) {
  const currentIdx = STEP_ORDER.indexOf(current);

  return (
    <div className="w-full">
      <ol className="flex items-center justify-between gap-1 sm:gap-2">
        {STEP_ORDER.map((step, idx) => {
          const isCompleted = completed.includes(step);
          const isCurrent = step === current;

          return (
            <li key={step} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                onClick={() => onSelect?.(step)}
                className="group flex flex-col items-center gap-1.5 min-w-0 transition cursor-pointer"
              >
                <div
                  className={cn(
                    "size-8 sm:size-9 rounded-full flex items-center justify-center text-xs font-semibold border transition",
                    isCurrent &&
                      "bg-primary text-primary-foreground border-primary shadow-sm ring-4 ring-primary/15",
                    isCompleted &&
                      !isCurrent &&
                      "bg-primary/90 text-primary-foreground border-primary/90",
                    !isCurrent &&
                      !isCompleted &&
                      "bg-background text-muted-foreground border-border",
                  )}
                >
                  {isCompleted && !isCurrent ? (
                    <Check className="size-4" strokeWidth={3} />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] sm:text-xs font-medium text-center leading-tight max-w-[80px] truncate",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {STEP_LABELS[step]}
                </span>
              </button>
              {idx < STEP_ORDER.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-[2px] mx-1 sm:mx-2 -mt-5 rounded-full transition",
                    idx < currentIdx ? "bg-primary/80" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
