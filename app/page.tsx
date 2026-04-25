import { RoteiroList } from "@/components/home/RoteiroList";
import { BookOpen, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-dvh bg-background">
      <section className="border-b bg-gradient-to-b from-primary/5 via-background to-background">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-16 pb-14 sm:pt-20 sm:pb-16 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-4 text-primary" />
            <span>Gerador de roteiros · Romance de milionário</span>
          </div>
          <h1 className="font-serif text-4xl sm:text-5xl tracking-tight leading-[1.05]">
            MyStoriesLena
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-xl leading-relaxed">
            Um fluxo guiado em 5 etapas, cada uma com um agente especializado,
            para transformar uma premissa em um roteiro pronto.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground pt-2">
            <div className="flex items-center gap-1.5">
              <BookOpen className="size-3.5" />
              <span>Premissa → Estrutura → Escrita → Revisor</span>
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <RoteiroList />
      </main>

      <footer className="max-w-4xl mx-auto px-4 sm:px-6 py-8 text-xs text-muted-foreground text-center border-t mt-10">
        Os roteiros ficam salvos no seu navegador (LocalStorage). Para
        compartilhar com a equipe, exporte o roteiro final na última etapa.
      </footer>
    </div>
  );
}
