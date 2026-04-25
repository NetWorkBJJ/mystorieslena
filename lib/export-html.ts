/**
 * Helpers de exportação HTML do roteiro.
 *
 * O HTML gerado segue exatamente a hierarquia de headings que produz um
 * Google Docs navegável (a barra lateral mostra a estrutura quando há h1/h2/h3):
 *   h1 → "PARTE 1" / "PARTE 2"
 *   h2 → "Capítulo N — Título"
 *   h3 → "✦ Nome do Personagem" (marcador de POV)
 *
 * Tolera dois formatos de marcador (legado e novo):
 *   - "═══ PARTE 1 ═══" (legado, virava decorativo)  → vira h1 PARTE 1
 *   - "# PARTE 1"                                    → vira h1 PARTE 1
 *   - "# Capítulo 1 — X" (legado)                    → vira h2 Capítulo 1 — X
 *   - "## Capítulo 1 — X" (novo)                     → vira h2 Capítulo 1 — X
 *   - "━━━ NOME ━━━" (legado)                        → vira h3 ✦ Nome
 *   - "### ✦ Nome" (novo)                            → vira h3 ✦ Nome
 */

const SERIF_BODY = "Georgia, 'Times New Roman', serif";

/**
 * Constrói HTML do roteiro completo (texto literário + cabeçalhos navegáveis).
 * Use só pra a saída do step Escrita ou pra download manual do roteiro.
 */
export function escritaContentToHtml(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let paraBuffer: string[] = [];

  const flushPara = () => {
    if (paraBuffer.length === 0) return;
    const text = paraBuffer.join(" ").trim();
    if (text) {
      out.push(`<p style="margin: 12px 0; line-height: 1.6;">${inlineFormat(text)}</p>`);
    }
    paraBuffer = [];
  };

  // Detecta banner ═══ X ═══ no formato multi-linha (só funciona com 3 linhas).
  // Pra simplificar, procuramos o padrão como concatenação.
  const fullText = lines.join("\n");

  // Pré-processa: substitui ═══ PARTE N ═══ por linha "# PARTE N".
  let preprocessed = fullText.replace(
    /═{3,}\s*\n\s*(PARTE 1|PARTE 2|ROTEIRO)\s*\n\s*═{3,}/g,
    (_m, label) => (label === "ROTEIRO" ? "" : `# ${label}`),
  );

  // Pré-processa: substitui ━━━ NOME ━━━ por "### ✦ Nome".
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
    const h4 = line.match(/^####\s+(.+)$/);

    if (h4) {
      flushPara();
      out.push(
        `<h4 style="font-family: ${SERIF_BODY}; margin-top: 12px;">${escapeHtml(h4[1])}</h4>`,
      );
      continue;
    }
    if (h3) {
      flushPara();
      out.push(
        `<h3 style="font-family: ${SERIF_BODY}; color: #1a1a1a; margin-top: 18px; font-weight: 600;">${escapeHtml(h3[1])}</h3>`,
      );
      continue;
    }
    if (h2) {
      flushPara();
      out.push(
        `<h2 style="font-family: ${SERIF_BODY}; color: #1a1a1a; margin-top: 32px; margin-bottom: 16px; font-size: 22px; font-weight: 700;">${escapeHtml(h2[1])}</h2>`,
      );
      continue;
    }
    if (h1) {
      flushPara();
      out.push(
        `<h1 style="font-family: ${SERIF_BODY}; color: #6b1f2d; margin-top: 48px; margin-bottom: 24px; font-size: 28px; font-weight: 700; border-bottom: 2px solid #6b1f2d; padding-bottom: 8px;">${escapeHtml(h1[1])}</h1>`,
      );
      continue;
    }

    // Lista bullet
    const bullet = line.match(/^[-•*]\s+(.+)$/);
    if (bullet) {
      flushPara();
      out.push(
        `<p style="margin: 4px 0 4px 16px;">• ${inlineFormat(bullet[1])}</p>`,
      );
      continue;
    }

    // Tarja decorativa solta (não capturada acima — vira separador discreto).
    if (/^[═━─]{5,}/.test(line.trim())) {
      flushPara();
      out.push(
        `<hr style="border: none; border-top: 1px solid #ccc; margin: 16px 0;">`,
      );
      continue;
    }

    paraBuffer.push(line);
  }
  flushPara();
  return out.join("\n");
}

/**
 * HTML completo (com <html><body>) pronto pra clipboard ou download.
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
</head>
<body style="font-family: ${SERIF_BODY}; line-height: 1.6; color: #1a1a1a; max-width: 720px; margin: 40px auto; padding: 0 24px;">
<h1 style="font-family: ${SERIF_BODY}; color: #6b1f2d; font-size: 32px; border-bottom: 2px solid #6b1f2d; padding-bottom: 12px;">${escapeHtml(title)}</h1>
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
