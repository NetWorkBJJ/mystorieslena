import { countWords } from "@/lib/word-count";

/**
 * Helpers de exportação HTML do roteiro.
 *
 * Produz HTML estilizado pra colar no Google Docs preservando a hierarquia —
 * PARTE como Heading 1 centralizado, Capítulo como Heading 2 grande e bold,
 * troca de POV (✦ Nome) como Heading 3, fonte Arial 11pt, parágrafos
 * justificados (match exato do default do Docs).
 *
 * O mesmo HTML é usado tanto no download direto (.html), na exportação PDF
 * (printToPDF do Electron) quanto no copy-clipboard pra colar no Google Docs.
 *
 * Tolera dois formatos de marcador (legado e novo):
 *   - "═══ PARTE 1 ═══" (legado)              → <h1> "PARTE 1" centralizado (Heading 1 no Docs)
 *   - "# PARTE 1"                             → <h1> "PARTE 1" centralizado (Heading 1 no Docs)
 *   - "# Capítulo 1 — X" (legado)             → <h2> Capítulo 1 — X (Heading 2 no Docs)
 *   - "## Capítulo 1 — X" (novo)              → <h2> Capítulo 1 — X (Heading 2 no Docs)
 *   - "━━━ NOME ━━━" / "### ✦ Nome"           → <h3> "✦ Nome" (Heading 3 no Docs, subtítulo de POV)
 *
 * A hierarquia h1 (PARTE) > h2 (Capítulo) > h3 (POV) faz o painel "Guias" /
 * "Estrutura do documento" do Google Docs aninhar tudo numa árvore correta:
 * cada Capítulo aparece embaixo da PARTE, e cada troca de POV embaixo do
 * Capítulo. Sem essa hierarquia, só os h3 viravam nó visíveis.
 */

const SANS = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

const STYLE_BODY =
  `font-family: ${SANS}; line-height: 1.5; color: #000; font-size: 11pt; font-weight: 400;`;
// font-weight: 400 explícito no <p> impede o Google Docs de herdar o weight 700
// do <h1> de Capítulo anterior durante o paste (bug visto no Revisor onde
// todo o body saia em negrito). font-family redundante aqui pra travar a fonte
// caso o Docs decida não herdar do body.
const STYLE_PARA =
  `margin: 0 0 11pt 0; text-align: justify; line-height: 1.5; font-size: 11pt; font-weight: 400; font-family: ${SANS};`;
const STYLE_H_CHAPTER =
  `font-family: ${SANS}; font-size: 20pt; font-weight: 700; color: #000; margin: 20pt 0 6pt 0; line-height: 1.15; text-align: left;`;
const STYLE_PART_DIVIDER =
  `text-align: center; margin: 36pt 0 24pt 0; font-family: ${SANS}; font-size: 14pt; font-weight: 700; color: #000;`;
const STYLE_POV_HEADING =
  `font-family: ${SANS}; font-size: 12pt; font-weight: 700; color: #000; margin: 14pt 0 8pt 0; line-height: 1.3; text-align: left;`;
const STYLE_HR =
  "border: none; border-top: 1px solid #999; opacity: 0.5; margin: 24pt auto; width: 40%;";
// Verde Google Docs "Light green 3" — destaque marca-texto pros parágrafos do
// POV do MMC. Aplicado em <span> inline (não no <p>) porque o Docs trata
// background-color em span como destaque de texto e em block como caixa.
const STYLE_HIGHLIGHT_MMC = "background-color: #d9ead3";

function nomeCanonico(s: string): string {
  return s.replace(/^✦\s*/, "").trim().toLowerCase();
}

function preprocessRoteiro(raw: string): string {
  let preprocessed = raw.replace(
    /═{3,}\s*\n\s*(PARTE 1|PARTE 2)\s*\n\s*═{3,}/g,
    (_m, label) => `# ${label}`,
  );
  preprocessed = preprocessed.replace(
    /═{3,}\s*\n\s*ROTEIRO\s*\n\s*═{3,}/g,
    "",
  );
  preprocessed = preprocessed.replace(
    /━{3,}\s*\n\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]*?)\s*\n\s*━{3,}/g,
    (_m, name) => {
      const trimmed = name.trim();
      const formatted = trimmed
        .toLowerCase()
        .replace(/(?:^|\s)\S/g, (s: string) => s.toUpperCase());
      return `### ✦ ${formatted}`;
    },
  );
  return preprocessed;
}

/**
 * Heurística de detecção do MMC: o prompt da Escrita garante que a FMC narra
 * >50% das palavras totais (Parte 1 inteira é FMC, e na Parte 2 ela continua
 * majoritária). Conta palavras por POV ao longo de TODO o roteiro e retorna
 * o nome com MENOS palavras = MMC.
 *
 * Não dá pra contar só ocorrências de `### ✦` porque os POVs alternam — em
 * Parte 2 é comum aparecer 4 marcadores de cada lado e empatar. O que separa
 * os dois é o tamanho dos blocos, não a frequência dos marcadores.
 *
 * Retorna `null` quando não dá pra decidir: POV único, empate no mínimo,
 * ou nenhum POV com palavras (caso típico ao processar Parte 1 isolada).
 */
export function detectMaleLeadName(raw: string): string | null {
  const normalized = preprocessRoteiro(raw);
  const stats = new Map<string, { words: number; display: string }>();

  let currentPov: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (currentPov && buffer.length > 0) {
      const text = buffer.join(" ").trim();
      if (text) {
        const entry = stats.get(currentPov);
        if (entry) entry.words += countWords(text);
      }
    }
    buffer = [];
  };

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();

    const h3 = line.match(/^###\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h1 = line.match(/^#\s+(.+)$/);

    if (h3) {
      flush();
      const display = h3[1].replace(/^✦\s*/, "").trim();
      if (display) {
        currentPov = display.toLowerCase();
        if (!stats.has(currentPov)) {
          stats.set(currentPov, { words: 0, display });
        }
      } else {
        currentPov = null;
      }
      continue;
    }
    if (h2 || h1) {
      flush();
      currentPov = null;
      continue;
    }

    if (!line) {
      flush();
      continue;
    }

    buffer.push(line);
  }
  flush();

  if (stats.size < 2) return null;

  let minWords = Infinity;
  let minName: string | null = null;
  let tied = false;
  for (const { words, display } of stats.values()) {
    if (words === 0) continue;
    if (words < minWords) {
      minWords = words;
      minName = display;
      tied = false;
    } else if (words === minWords) {
      tied = true;
    }
  }
  return tied || minName === null ? null : minName;
}

/**
 * Converte o output cru da Escrita em HTML formatado, com hierarquia
 * de headings adequada pra Google Docs e PDF.
 */
export function escritaContentToHtml(
  raw: string,
  options?: { maleLeadName?: string | null },
): string {
  const out: string[] = [];
  let inCodeBlock = false;
  let paraBuffer: string[] = [];
  let currentPov: string | null = null;

  const maleLeadName =
    options?.maleLeadName === undefined
      ? detectMaleLeadName(raw)
      : options.maleLeadName;
  const maleLeadCanonical = maleLeadName ? nomeCanonico(maleLeadName) : null;

  const preprocessed = preprocessRoteiro(raw);

  const flushPara = () => {
    if (paraBuffer.length === 0) return;
    const text = paraBuffer.join(" ").trim();
    if (text) {
      const inner = inlineFormat(text);
      const isMmcPov =
        maleLeadCanonical !== null && currentPov === maleLeadCanonical;
      const content = isMmcPov
        ? `<span style="${STYLE_HIGHLIGHT_MMC}">${inner}</span>`
        : inner;
      out.push(`<p style="${STYLE_PARA}">${content}</p>`);
    }
    paraBuffer = [];
  };

  for (const rawLine of preprocessed.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      flushPara();
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        out.push(
          '<pre style="background: #f4f4f4; padding: 8px; border-radius: 4px; font-family: Consolas, monospace; font-size: 10pt; white-space: pre-wrap;">',
        );
      } else {
        out.push("</pre>");
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(escapeHtml(line));
      continue;
    }

    if (!line.trim()) {
      flushPara();
      continue;
    }

    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);

    if (h3) {
      // POV markers (### ✦ Nome) viram <h3> estilizado — preserva o ✦ no
      // roteiro final e, ao colar no Google Docs, vira Heading 3 (aparece
      // na barra de navegação).
      flushPara();
      currentPov = nomeCanonico(h3[1]);
      out.push(`<h3 style="${STYLE_POV_HEADING}">${escapeHtml(h3[1])}</h3>`);
      continue;
    }
    if (h2) {
      // Capítulo — sai como <h2> pra virar Heading 2 no Google Docs e aninhar
      // embaixo da PARTE (h1) na árvore de Guias / Estrutura do documento.
      flushPara();
      currentPov = null;
      out.push(`<h2 style="${STYLE_H_CHAPTER}">${escapeHtml(h2[1])}</h2>`);
      continue;
    }
    if (h1) {
      // Separador de PARTE — sai como <h1> pra virar Heading 1 no Google Docs
      // (raiz da árvore de Guias). Mantém centralizado via style inline e
      // adiciona page-break antes da PARTE 2+.
      flushPara();
      currentPov = null;
      const isFirstPart = !out.some((s) => /class="part-divider"/.test(s));
      const breakStyle = isFirstPart ? "" : "; page-break-before: always";
      out.push(
        `<h1 class="part-divider" style="${STYLE_PART_DIVIDER}${breakStyle}">${escapeHtml(h1[1])}</h1>`,
      );
      continue;
    }

    // Lista de bullet (raro no roteiro, mas suporta).
    const bullet = line.match(/^[-•*]\s+(.+)$/);
    if (bullet) {
      flushPara();
      out.push(
        `<p style="margin: 4px 0 4px 16px;">• ${inlineFormat(bullet[1])}</p>`,
      );
      continue;
    }

    // Tarja decorativa solta (separador discreto).
    if (/^[═━─]{5,}/.test(line.trim())) {
      flushPara();
      out.push(`<hr style="${STYLE_HR}">`);
      continue;
    }

    paraBuffer.push(line);
  }
  flushPara();
  return out.join("\n");
}

/**
 * Documento HTML completo pronto pra clipboard, download .html ou geração de PDF.
 */
export function buildEscritaHtmlDocument(
  title: string,
  bodyHtml: string,
): string {
  // Sem <title>: quando o HTML é colado no Google Docs, o Docs usa o <title>
  // como cabeçalho de página, deixando o nome do roteiro vazado pro topo do doc
  // ("Novo roteiro — 28/04/2026, 10:34:45"). Omitir resolve.
  void title;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm 22mm 18mm 22mm; }
  body { ${STYLE_BODY} margin: 0; padding: 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Divide o conteúdo cru da Escrita em Parte 1 e Parte 2, já tirando os marcadores
 * `# PARTE 1` / `# PARTE 2` (eles viram nome de aba no Docs, não vão no body).
 *
 * Retorna { parte1, parte2 } como strings cruas (markdown), prontas pra passar
 * pelo `escritaContentToHtml`. Se a Parte 2 não existir (roteiro só com P1),
 * `parte2` vem como string vazia.
 */
export function splitRoteiroByParts(
  raw: string,
): { parte1: string; parte2: string } {
  // Normaliza banners legados primeiro (mesmo que escritaContentToHtml faz).
  const normalized = raw
    .replace(
      /═{3,}\s*\n\s*(PARTE 1|PARTE 2)\s*\n\s*═{3,}/g,
      (_m, label) => `# ${label}`,
    )
    .replace(/═{3,}\s*\n\s*ROTEIRO\s*\n\s*═{3,}/g, "");

  const parte2Match = normalized.match(/^#\s+PARTE 2\s*$/m);

  if (!parte2Match || parte2Match.index === undefined) {
    // Roteiro só com Parte 1 (ou sem marcador): tudo vai pra parte1.
    const parte1Only = normalized.replace(/^#\s+PARTE 1\s*\n?/m, "").trim();
    return { parte1: parte1Only, parte2: "" };
  }

  const parte1Raw = normalized.slice(0, parte2Match.index);
  const parte2Raw = normalized.slice(parte2Match.index + parte2Match[0].length);

  return {
    parte1: parte1Raw.replace(/^#\s+PARTE 1\s*\n?/m, "").trim(),
    parte2: parte2Raw.trim(),
  };
}

function inlineFormat(text: string): string {
  let escaped = escapeHtml(text);
  // Tira pares de ** sem renderizar negrito. Prosa de romance não usa negrito
  // no corpo; quando aparece ** é ruído (o Revisor, ao chamar /api/escrita-fix-
  // wordcount, às vezes recebe do Opus trechos envolvidos em **). Stripar aqui
  // garante export limpo independente do que a IA tenha gerado.
  escaped = escaped.replace(/\*\*/g, "");
  escaped = escaped.replace(/\*(.+?)\*/g, "<em>$1</em>");
  escaped = escaped.replace(/`(.+?)`/g, "<code>$1</code>");
  return escaped;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
