import * as React from "react"

import { cn } from "@/lib/utils"

// IMPORTANTE: removemos `field-sizing-content` do default. Essa propriedade
// CSS faz o textarea recalcular o tamanho intrínseco a cada keystroke — em
// textareas grandes (resumo da Premissa com 1.5k+ palavras, edição de capítulo
// com 1k palavras), o relayout era a fonte residual de "leve lentidão ao
// digitar" mesmo com as outras otimizações. Todos os callers passam `rows` e
// `min-h-*`/`resize-y` — o auto-grow não era necessário em lugar nenhum.
// Quem precisar do auto-grow no futuro pode passar `[field-sizing:content]`
// via className e reativar localmente.
function Textarea({
  className,
  spellCheck,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      // spellCheck=false por default: defense in depth caso o
      // webPreferences.spellcheck seja reativado no Electron. Caller pode
      // sobrescrever passando spellCheck explicitamente.
      spellCheck={spellCheck ?? false}
      className={cn(
        "flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
