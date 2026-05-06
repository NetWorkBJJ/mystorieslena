/**
 * Helper pra concatenar `partial + delta` no modo "Continuar de onde parou"
 * dos steps Estrutura P1/P2.
 *
 * Mesmo com instrução explícita pra não repetir, modelos LLM às vezes
 * redundantemente reescrevem o final do parcial antes de continuar (ex.:
 * repetem o último capítulo, repetem o cabeçalho de uma tabela). Esse
 * helper detecta um overlap entre o final do `partial` e o começo do
 * `delta`, e ao concatenar descarta a parte duplicada do `delta`.
 *
 * Estratégia: olha o sufixo do partial (até `tailLen` chars, ignorando
 * trailing whitespace) e procura ele dentro dos primeiros `lookaheadLen`
 * chars do delta. Se achar, corta o delta a partir do fim daquele match.
 *
 * Tolerante a whitespace: normaliza runs de whitespace pra um único espaço
 * antes de comparar — assim "cap. 5\n\n" no fim do partial casa com
 * "cap. 5 " no começo do delta.
 *
 * Se nenhum overlap é encontrado, faz concat puro com um \n entre eles
 * (caso o último char do partial não seja whitespace).
 */
export function mergeContinuation(
  partial: string,
  delta: string,
  opts: { tailLen?: number; lookaheadLen?: number } = {},
): string {
  const tailLen = opts.tailLen ?? 200;
  const lookaheadLen = opts.lookaheadLen ?? 400;

  if (!partial) return delta;
  if (!delta) return partial;

  const partialTrim = partial.replace(/\s+$/, "");
  const tail = partialTrim.slice(-tailLen);
  const head = delta.slice(0, lookaheadLen);

  // Tenta achar o tail (com whitespace normalizado) no head do delta.
  const overlapEnd = findOverlapEnd(tail, head);
  if (overlapEnd > 0) {
    // Detectado: corta o head duplicado, mantém o resto do delta.
    return partial + delta.slice(overlapEnd);
  }

  // Sem overlap detectado: concatena puro. Não tentamos inserir \n quando
  // ambos lados estão "limpos" (sem whitespace) porque o caso mais comum é
  // mid-word (checkpoint cortou o stream no meio de uma palavra) — adicionar
  // \n quebraria a palavra. O prompt instrui o modelo a completar palavras
  // partidas, então confiamos que o delta começa correto.
  return partial + delta;
}

/**
 * Busca o maior sufixo do `tail` que aparece como prefixo do `head` (após
 * normalizar whitespace). Retorna o índice no `head` ORIGINAL onde esse
 * match termina, ou 0 se nenhum overlap razoável foi achado.
 *
 * Mínimo de 20 chars de overlap pra evitar falsos positivos com palavras
 * muito comuns ("cena", "Capítulo", etc).
 */
function findOverlapEnd(tail: string, head: string): number {
  const minOverlap = 20;
  if (tail.length < minOverlap || head.length < minOverlap) return 0;

  // Normaliza ambos pra comparação (mas mantém map dos índices originais
  // do head pra retornar índice correto).
  const normTail = tail.replace(/\s+/g, " ").trim();
  const { norm: normHead, indexMap } = normalizeWithMap(head);

  // Tenta sufixos do tail decrescendo do maior pro menor — o maior overlap
  // legítimo vence. Para no primeiro match >= minOverlap.
  for (let len = normTail.length; len >= minOverlap; len--) {
    const candidate = normTail.slice(normTail.length - len);
    if (normHead.startsWith(candidate)) {
      // Match: o overlap normalizado tem `len` chars no normHead.
      // Acha o índice ORIGINAL no head onde o match termina.
      // indexMap[i] = posição no head original do char i do normHead.
      const lastNormIdx = len - 1;
      const origIdx = indexMap[lastNormIdx];
      // origIdx é o índice do último char do match no head original.
      // O fim (exclusivo) é origIdx + 1.
      return origIdx + 1;
    }
  }
  return 0;
}

/**
 * Normaliza whitespace runs pra um único espaço e devolve um mapa
 * `indexMap[i] = índice original` pra reverter posições.
 */
function normalizeWithMap(s: string): { norm: string; indexMap: number[] } {
  let norm = "";
  const indexMap: number[] = [];
  let inSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (!inSpace && norm.length > 0) {
        norm += " ";
        indexMap.push(i);
      }
      inSpace = true;
    } else {
      norm += ch;
      indexMap.push(i);
      inSpace = false;
    }
  }
  // Trim left: se começamos com whitespace, o primeiro char do norm pode
  // ser " " com map errado. Mais simples: trim do norm e ajustar.
  while (norm.startsWith(" ")) {
    norm = norm.slice(1);
    indexMap.shift();
  }
  return { norm, indexMap };
}
