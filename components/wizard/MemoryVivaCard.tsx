"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Anchor,
  BookOpen,
  Calendar,
  CheckCircle2,
  Flame,
  Hash,
  Heart,
  ListChecks,
  MapPin,
  Sparkles,
  UserCircle2,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Character {
  nome?: string;
  idade?: number | null;
  tracos?: string[];
  arco_atual?: string;
}

interface Secondary {
  nome?: string;
  papel?: string;
  relacao_com_fmc?: string;
  relacao_com_mmc?: string;
  ultimo_aparicoes?: string;
}

interface TimelineEntry {
  dia?: number | string;
  dia_semana?: string;
  eventos?: string[];
}

interface Local {
  nome?: string;
  descricao?: string;
  caracteristicas_fixas?: string;
}

interface CapituloEscrito {
  numero?: number;
  parte?: string;
  titulo?: string;
  resumo_uma_linha?: string;
  cliffhanger?: string;
  contagem_palavras?: number;
}

interface NumeroComPeso {
  detalhe?: string;
  significado?: string;
}

interface CenaIntima {
  capitulo?: number;
  parte?: string;
  resumo?: string;
}

interface MemoryVivaData {
  parte_atual?: string;
  capitulo_atual?: number;
  timeline?: TimelineEntry[];
  locais?: Local[];
  personagens?: {
    FMC?: Character;
    MMC?: Character;
    secundarios?: Secondary[];
  };
  ganchos_abertos?: string[];
  ganchos_resolvidos?: string[];
  muletas_frasais_detectadas?: string[];
  numeros_e_detalhes_com_peso?: NumeroComPeso[];
  capitulos_escritos?: CapituloEscrito[];
  cenas_intimas_acontecidas?: CenaIntima[];
  notas_para_proximo_capitulo?: string[];
}

interface Props {
  memoryJson: string;
}

export function MemoryVivaCard({ memoryJson }: Props) {
  let data: MemoryVivaData | null = null;
  try {
    data = JSON.parse(memoryJson) as MemoryVivaData;
  } catch {
    return <RawFallback raw={memoryJson} />;
  }

  if (!data) return <RawFallback raw={memoryJson} />;

  const capitulosEscritos = data.capitulos_escritos ?? [];
  const ganchosAbertos = data.ganchos_abertos ?? [];
  const ganchosResolvidos = data.ganchos_resolvidos ?? [];
  const numerosComPeso = data.numeros_e_detalhes_com_peso ?? [];
  const muletas = data.muletas_frasais_detectadas ?? [];
  const notas = data.notas_para_proximo_capitulo ?? [];
  const cenasIntimas = data.cenas_intimas_acontecidas ?? [];
  const locais = data.locais ?? [];
  const timeline = data.timeline ?? [];
  const secundarios = data.personagens?.secundarios ?? [];

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.03] via-background to-background overflow-hidden">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-primary/15 bg-primary/[0.05]">
        <div className="size-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="size-4 text-primary" />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <h3 className="font-serif text-base tracking-tight">
            Memória Viva do roteiro
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Estado atualizado — usado automaticamente no próximo capítulo
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data.parte_atual && (
            <Badge variant="secondary" className="font-normal text-xs">
              {data.parte_atual}
            </Badge>
          )}
          {typeof data.capitulo_atual === "number" && (
            <Badge variant="secondary" className="font-normal text-xs">
              Cap. {data.capitulo_atual}
            </Badge>
          )}
          {capitulosEscritos.length > 0 && (
            <Badge variant="secondary" className="font-normal text-xs">
              {capitulosEscritos.length} escrito{capitulosEscritos.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </header>

      <div className="p-5 flex flex-col gap-6">
        {(data.personagens?.FMC || data.personagens?.MMC) && (
          <Section icon={<Users className="size-3.5" />} title="Personagens principais">
            <div className="grid sm:grid-cols-2 gap-3">
              {data.personagens?.FMC && (
                <CharacterCard role="FMC" character={data.personagens.FMC} />
              )}
              {data.personagens?.MMC && (
                <CharacterCard role="MMC" character={data.personagens.MMC} />
              )}
            </div>
          </Section>
        )}

        {secundarios.length > 0 && (
          <Section
            icon={<UserCircle2 className="size-3.5" />}
            title="Secundários"
            count={secundarios.length}
          >
            <div className="grid sm:grid-cols-2 gap-2">
              {secundarios.map((s, i) => (
                <div
                  key={i}
                  className="rounded-md border bg-card px-3 py-2 flex flex-col gap-0.5"
                >
                  <span className="text-sm font-medium">
                    {s.nome ?? "(sem nome)"}
                  </span>
                  {s.papel && (
                    <span className="text-xs text-muted-foreground leading-snug">
                      {s.papel}
                    </span>
                  )}
                  {(s.relacao_com_fmc || s.relacao_com_mmc) && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.relacao_com_fmc && s.relacao_com_fmc !== "Nenhuma" && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          FMC: {s.relacao_com_fmc}
                        </span>
                      )}
                      {s.relacao_com_mmc && s.relacao_com_mmc !== "Nenhuma" && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          MMC: {s.relacao_com_mmc}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {locais.length > 0 && (
          <Section
            icon={<MapPin className="size-3.5" />}
            title="Locais"
            count={locais.length}
          >
            <div className="flex flex-col gap-2">
              {locais.map((l, i) => (
                <div
                  key={i}
                  className="rounded-md border bg-card p-3 flex flex-col gap-1"
                >
                  <span className="text-sm font-medium">
                    {l.nome ?? "(sem nome)"}
                  </span>
                  {l.descricao && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {l.descricao}
                    </p>
                  )}
                  {l.caracteristicas_fixas && (
                    <p className="text-[11px] text-muted-foreground/80 leading-relaxed border-l-2 border-primary/30 pl-2 mt-1">
                      <span className="font-semibold">Fixo:</span>{" "}
                      {l.caracteristicas_fixas}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {timeline.length > 0 && (
          <Section
            icon={<Calendar className="size-3.5" />}
            title="Timeline"
            count={timeline.length}
          >
            <ol className="flex flex-col gap-2">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <div className="shrink-0 flex flex-col items-center gap-0.5 pt-1">
                    <span className="size-6 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center">
                      D{t.dia ?? "?"}
                    </span>
                    {t.dia_semana && (
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                        {shortWeekday(t.dia_semana)}
                      </span>
                    )}
                  </div>
                  <ul className="flex-1 flex flex-col gap-1 pt-1">
                    {(t.eventos ?? []).map((e, j) => (
                      <li
                        key={j}
                        className="text-xs text-foreground/90 leading-relaxed"
                      >
                        • {e}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {(ganchosAbertos.length > 0 || ganchosResolvidos.length > 0) && (
          <Section icon={<Anchor className="size-3.5" />} title="Ganchos">
            <div className="grid sm:grid-cols-2 gap-3">
              {ganchosAbertos.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                    <AlertTriangle className="size-3" />
                    Abertos ({ganchosAbertos.length})
                  </div>
                  <ul className="flex flex-col gap-1">
                    {ganchosAbertos.map((g, i) => (
                      <li
                        key={i}
                        className="text-xs leading-relaxed rounded border border-amber-200 bg-amber-50/50 px-2 py-1.5 text-amber-950"
                      >
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ganchosResolvidos.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide flex items-center gap-1">
                    <CheckCircle2 className="size-3" />
                    Resolvidos ({ganchosResolvidos.length})
                  </div>
                  <ul className="flex flex-col gap-1">
                    {ganchosResolvidos.map((g, i) => (
                      <li
                        key={i}
                        className="text-xs leading-relaxed rounded border border-emerald-200 bg-emerald-50/50 px-2 py-1.5 text-emerald-950 line-through decoration-emerald-400/50"
                      >
                        {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {numerosComPeso.length > 0 && (
          <Section
            icon={<Hash className="size-3.5" />}
            title="Números e detalhes com peso"
            count={numerosComPeso.length}
          >
            <div className="flex flex-col gap-1.5">
              {numerosComPeso.map((n, i) => (
                <div
                  key={i}
                  className="flex gap-3 items-start rounded-md border bg-card px-3 py-2"
                >
                  <div className="shrink-0 size-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                    <Flame className="size-3" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium">
                      {n.detalhe ?? "(sem detalhe)"}
                    </span>
                    {n.significado && (
                      <span className="text-xs text-muted-foreground leading-relaxed">
                        {n.significado}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {muletas.length > 0 && (
          <Section
            icon={<AlertTriangle className="size-3.5" />}
            title="Muletas frasais detectadas"
            count={muletas.length}
          >
            <ul className="flex flex-col gap-1">
              {muletas.map((m, i) => (
                <li
                  key={i}
                  className="text-xs leading-relaxed rounded border border-orange-200 bg-orange-50/50 px-2.5 py-1.5 text-orange-950"
                >
                  {m}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {capitulosEscritos.length > 0 && (
          <Section
            icon={<BookOpen className="size-3.5" />}
            title="Capítulos escritos"
            count={capitulosEscritos.length}
          >
            <div className="flex flex-col gap-2">
              {capitulosEscritos.map((c, i) => (
                <div key={i} className="rounded-md border bg-card p-3 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] font-normal">
                      Cap. {c.numero ?? "?"}
                    </Badge>
                    {c.parte && (
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {c.parte}
                      </Badge>
                    )}
                    <span className="text-sm font-medium truncate">
                      {c.titulo ?? ""}
                    </span>
                    {typeof c.contagem_palavras === "number" && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {c.contagem_palavras.toLocaleString("pt-BR")} palavras
                      </span>
                    )}
                  </div>
                  {c.resumo_uma_linha && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {c.resumo_uma_linha}
                    </p>
                  )}
                  {c.cliffhanger && (
                    <p className="text-[11px] italic text-primary/80 leading-relaxed border-l-2 border-primary/40 pl-2 mt-1">
                      {c.cliffhanger}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {cenasIntimas.length > 0 && (
          <Section
            icon={<Heart className="size-3.5" />}
            title="Cenas íntimas já escritas"
            count={cenasIntimas.length}
          >
            <div className="flex flex-col gap-1.5">
              {cenasIntimas.map((c, i) => (
                <div
                  key={i}
                  className="text-xs rounded-md border border-rose-200 bg-rose-50/40 px-3 py-2"
                >
                  <span className="font-semibold text-rose-900">
                    Cap. {c.capitulo ?? "?"} {c.parte ? `• ${c.parte}` : ""}
                  </span>
                  {c.resumo && (
                    <span className="text-rose-950/80"> — {c.resumo}</span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {notas.length > 0 && (
          <>
            <Separator />
            <Section
              icon={<ListChecks className="size-3.5 text-primary" />}
              title="Notas para o próximo capítulo"
              count={notas.length}
              emphasis
            >
              <ul className="flex flex-col gap-1.5">
                {notas.map((n, i) => (
                  <li
                    key={i}
                    className="text-sm leading-relaxed rounded-md border border-primary/25 bg-primary/[0.04] px-3 py-2 flex gap-2"
                  >
                    <span className="text-primary font-bold shrink-0">→</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  emphasis,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div
        className={cn(
          "flex items-center gap-2",
          emphasis ? "text-primary" : "text-muted-foreground",
        )}
      >
        {icon}
        <span
          className={cn(
            "text-xs font-semibold uppercase tracking-wider",
            emphasis && "text-primary",
          )}
        >
          {title}
        </span>
        {typeof count === "number" && (
          <span className="text-[10px] text-muted-foreground font-normal">
            · {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function CharacterCard({
  role,
  character,
}: {
  role: "FMC" | "MMC";
  character: Character;
}) {
  const colorClass =
    role === "FMC"
      ? "from-rose-50/60 border-rose-200"
      : "from-indigo-50/60 border-indigo-200";
  const roleTextColor = role === "FMC" ? "text-rose-700" : "text-indigo-700";

  return (
    <div
      className={cn(
        "rounded-lg border bg-gradient-to-br to-background p-3 flex flex-col gap-1.5",
        colorClass,
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("text-[10px] font-bold tracking-wider", roleTextColor)}>
          {role}
        </span>
        <span className="text-base font-serif tracking-tight truncate">
          {character.nome ?? "(sem nome)"}
        </span>
        {typeof character.idade === "number" && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {character.idade} anos
          </span>
        )}
      </div>
      {character.arco_atual && (
        <p className="text-xs text-foreground/80 leading-relaxed">
          {character.arco_atual}
        </p>
      )}
      {character.tracos && character.tracos.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {character.tracos.slice(0, 6).map((t, i) => (
            <span
              key={i}
              className="text-[10px] bg-white/60 border rounded px-1.5 py-0.5 text-foreground/75 leading-tight"
            >
              {t}
            </span>
          ))}
          {character.tracos.length > 6 && (
            <span className="text-[10px] text-muted-foreground px-1">
              +{character.tracos.length - 6}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function RawFallback({ raw }: { raw: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground mb-2">
        Não consegui parsear o JSON — exibindo texto cru:
      </p>
      <pre className="text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-60">
        {raw}
      </pre>
    </div>
  );
}

function shortWeekday(full: string): string {
  const m: Record<string, string> = {
    segunda: "SEG",
    terça: "TER",
    quarta: "QUA",
    quinta: "QUI",
    sexta: "SEX",
    sábado: "SÁB",
    domingo: "DOM",
  };
  const key = full.toLowerCase().split("-")[0]!.trim();
  return m[key] ?? full.slice(0, 3).toUpperCase();
}
