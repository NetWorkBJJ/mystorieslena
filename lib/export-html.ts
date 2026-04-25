/**
 * Helpers de exportação HTML do roteiro.
 *
 * Produz HTML estilizado fiel ao formato manual usado pela roteirista —
 * fonte serif Georgia, parágrafos justificados, capítulos em heading grande,
 * marcadores de POV (✦ Nome) como sub-heading e separadores de parte
 * elegantes em centralizado dourado.
 *
 * O mesmo HTML é usado tanto no download direto (.html), na exportação PDF
 * (printToPDF do Electron) quanto no copy-clipboard pra colar no Google Docs
 * preservando a hierarquia.
 *
 * Tolera dois formatos de marcador (legado e novo):
 *   - "═══ PARTE 1 ═══" (legado)              → vira separador "PARTE 1"
 *   - "# PARTE 1"                             → vira separador "PARTE 1"
 *   - "# Capítulo 1 — X" (legado)             → vira heading 2 Capítulo 1 — X
 *   - "## Capítulo 1 — X" (novo)              → vira heading 2 Capítulo 1 — X
 *   - "━━━ NOME ━━━" (legado)                 → vira heading 3 ✦ Nome
 *   - "### ✦ Nome" (novo)                     → vira heading 3 ✦ Nome
 */

const SERIF = "Georgia, 'Times New Roman', Times, serif";

const STYLE_BODY = `font-family: ${SERIF}; line-height: 1.7; color: #1a1a1a; font-size: 16px;`;
const STYLE_PARA =
  "margin: 0 0 14px 0; text-align: justify; line-height: 1.7; font-size: 16px;";
const STYLE_H_CHAPTER =
  `font-family: ${SERIF}; font-size: 22px; font-weight: 700; color: #1a1a1a; margin: 36px 0 18px 0; line-height: 1.3;`;
const STYLE_H_POV = `font-family: ${SERIF}; font-size: 16px; font-weight: 700; color: #1a1a1a; margin: 24px 0 14px 0; letter-spacing: 0.02em;`;
const STYLE_PART_DIVIDER = `text-align: center; margin: 56px 0 36px 0; font-family: ${SERIF}; color: #6b1f2d; font-size: 18px; font-weight: 700; letter-spacing: 0.32em; text-transform: uppercase; border-top: 1px solid #d4b87a; border-bottom: 1px solid #d4b87a; padding: 10px 0;`;
const STYLE_HR =
  "border: none; border-top: 1px solid #d4b87a; opacity: 0.6; margin: 24px auto; width: 40%;";

/**
 * Converte o output cru da Escrita em HTML formatado, com hierarquia
 * de headings adequada pra Google Docs e PDF.
 */
export function escritaContentToHtml(raw: string): string {
  const out: string[] = [];
  let inCodeBlock = false;
  let paraBuffer: string[] = [];

  // Pré-processa banners legados pra normalizar pra markdown:
  //  ═══ PARTE 1 ═══ → # PARTE 1
  //  ━━━ NOME ━━━     → ### ✦ Nome
  let preprocessed = raw.replace(
    /═{3,}\s*\n\s*(PARTE 1|PARTE 2)\s*\n\s*═{3,}/g,
    (_m, label) => `# ${label}`,
  );
  // Remove banner ROTEIRO (decorativo, não vai no doc final).
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

  const flushPara = () => {
    if (paraBuffer.length === 0) return;
    const text = paraBuffer.join(" ").trim();
    if (text) {
      out.push(`<p style="${STYLE_PARA}">${inlineFormat(text)}</p>`);
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
          '<pre style="background: #f4f4f4; padding: 8px; border-radius: 4px; font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap;">',
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
      flushPara();
      out.push(`<h3 style="${STYLE_H_POV}">${escapeHtml(h3[1])}</h3>`);
      continue;
    }
    if (h2) {
      flushPara();
      out.push(`<h2 style="${STYLE_H_CHAPTER}">${escapeHtml(h2[1])}</h2>`);
      continue;
    }
    if (h1) {
      // Separador de PARTE — ocupa o nível mais alto da hierarquia.
      // Quebra de página só pra PARTE 2+ (a primeira começa no topo do doc).
      flushPara();
      const isFirstPart = !out.some((s) => s.includes("STYLE_PART_DIVIDER")) &&
        !out.some((s) => /class="part-divider"/.test(s));
      const breakStyle = isFirstPart ? "" : "; page-break-before: always";
      out.push(
        `<div class="part-divider" style="${STYLE_PART_DIVIDER}${breakStyle}">${escapeHtml(h1[1])}</div>`,
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
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 22mm 18mm 22mm; }
  body { ${STYLE_BODY} max-width: 720px; margin: 30px auto; padding: 0 24px; }
  h1.doc-title {
    font-family: ${SERIF};
    font-size: 26px;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0 0 18px 0;
    text-align: center;
    line-height: 1.3;
  }
  h1.doc-title small {
    display: block;
    margin-top: 6px;
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.32em;
    text-transform: uppercase;
    color: #6b1f2d;
    font-style: normal;
  }
  hr.doc-rule { border: none; border-top: 1px solid #d4b87a; margin: 0 auto 28px; width: 35%; }
</style>
</head>
<body>
<h1 class="doc-title">${escapeHtml(title)}<small>MyStoriesLena · Romance Dark</small></h1>
<hr class="doc-rule">
${bodyHtml}
</body>
</html>`;
}

function inlineFormat(text: string): string {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
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
