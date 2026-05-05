/**
 * E2E que prova: o fix de streaming (commit pós-1.0.50) NÃO grava localStorage
 * por chunk durante geração de Estrutura 1/2 — apenas 2-3x no fluxo todo
 * (state setup + finalização).
 *
 * Pré-condição:
 *   - `npm run dev` rodando em http://localhost:3000
 *   - Playwright instalado: `npx playwright install chromium`
 *
 * Como rodar:
 *   node scripts/test-e2e-stream-no-persist.mjs
 *
 * Sem o fix, este teste falharia: o setOutput per-chunk geraria ~N setItem
 * (1 por chunk do stream). Com o fix, vê-se ratio ≤ 0.05 (≤ 1 setItem por
 * 20 chunks).
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ROTEIRO_ID = "r_e2e_test_" + Date.now().toString(36);

function bigStr(n, c) {
  return c.repeat(n);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Captura erros de console — qualquer erro durante o stream = fail
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push("console.error: " + msg.text());
  });

  await page.goto(BASE);

  // Seed um roteiro pesado (~2 MB) com referenceImage inline + Escrita ~25k
  // palavras + 5 history snapshots — mesmo perfil que estourava OOM no
  // renderer da roteirista quando per-chunk persist estava ativo.
  await page.evaluate(
    ([id, fakeBase64, escritaContent, estruturaContent]) => {
      const dataUrl = "data:image/jpeg;base64," + fakeBase64;
      const escritaSnap = (n) => ({
        id: "snap_e_" + n,
        savedAt: new Date().toISOString(),
        content: escritaContent,
        metadata: { chapters: [] },
        generatedAt: new Date().toISOString(),
      });
      const estruturaSnap = (n) => ({
        id: "snap_s_" + n,
        savedAt: new Date().toISOString(),
        content: estruturaContent,
        generatedAt: new Date().toISOString(),
      });
      const roteiro = {
        id,
        title: "[E2E] heavy roteiro",
        category: "milionario-1p",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentStep: "estrutura1",
        outputs: {
          premissa: { content: "Premissa.", generatedAt: new Date().toISOString() },
          escrita: { content: escritaContent, metadata: { chapters: [] }, generatedAt: new Date().toISOString() },
        },
        referenceImage: {
          dataUrl,
          mimeType: "image/jpeg",
          filename: "test.jpg",
          size: 1_100_000,
          uploadedAt: new Date().toISOString(),
        },
        history: {
          estrutura1: [estruturaSnap(1), estruturaSnap(2), estruturaSnap(3), estruturaSnap(4), estruturaSnap(5)],
          estrutura2: [estruturaSnap(6), estruturaSnap(7), estruturaSnap(8)],
          escrita: [escritaSnap(1), escritaSnap(2)],
        },
      };
      localStorage.setItem("veludo:roteiros", JSON.stringify([roteiro]));
    },
    [ROTEIRO_ID, bigStr(1_500_000, "A"), bigStr(150_000, "x"), bigStr(20_000, "y")],
  );

  // Navega direto pro roteiro
  await page.goto(`${BASE}/roteiro/${ROTEIRO_ID}`);
  await page.waitForLoadState("domcontentloaded");

  // Instala spy e mock antes de clicar Gerar
  await page.evaluate(() => {
    const original = localStorage.setItem.bind(localStorage);
    window.__veludoSpy = {
      callsTotal: 0,
      callsDuringStream: 0,
      callsBeforeStream: 0,
      callsAfterStream: 0,
      streamActive: false,
      streamEnded: false,
    };
    localStorage.setItem = function (key, value) {
      if (key === "veludo:roteiros") {
        window.__veludoSpy.callsTotal++;
        if (window.__veludoSpy.streamActive) window.__veludoSpy.callsDuringStream++;
        else if (window.__veludoSpy.streamEnded) window.__veludoSpy.callsAfterStream++;
        else window.__veludoSpy.callsBeforeStream++;
      }
      return original(key, value);
    };

    const realFetch = window.fetch.bind(window);
    window.__veludoMock = { chunksEmitted: 0, chunkCount: 200 };
    window.fetch = async function (url) {
      const u = typeof url === "string" ? url : url.url;
      if (u.includes("/api/agent/estrutura1") || u.includes("/api/agent/estrutura2")) {
        window.__veludoSpy.streamActive = true;
        const enc = new TextEncoder();
        const body = new ReadableStream({
          async start(controller) {
            for (let i = 0; i < window.__veludoMock.chunkCount; i++) {
              await new Promise((r) => setTimeout(r, 3));
              controller.enqueue(enc.encode(`# Capítulo ${i + 1} — cap ${i + 1}\n\nTexto.\n\n`));
              window.__veludoMock.chunksEmitted++;
            }
            controller.close();
            window.__veludoSpy.streamActive = false;
            window.__veludoSpy.streamEnded = true;
          },
        });
        return new Response(body, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      return realFetch(url);
    };
  });

  // Clica Gerar
  await page.getByRole("button", { name: "Gerar" }).first().click();

  // Espera o stream + finalização
  await page.waitForFunction(
    () => window.__veludoSpy.streamEnded && window.__veludoSpy.callsAfterStream > 0,
    null,
    { timeout: 15_000 },
  );

  // Coleta resultados
  const result = await page.evaluate(() => {
    const raw = localStorage.getItem("veludo:roteiros");
    const arr = JSON.parse(raw);
    const r = arr[0];
    return {
      chunksEmitted: window.__veludoMock.chunksEmitted,
      setItemCalls: window.__veludoSpy.callsTotal,
      callsBeforeStream: window.__veludoSpy.callsBeforeStream,
      callsDuringStream: window.__veludoSpy.callsDuringStream,
      callsAfterStream: window.__veludoSpy.callsAfterStream,
      estruturaChars: r?.outputs?.estrutura1?.content?.length ?? 0,
      estruturaStartsWithCap1: (r?.outputs?.estrutura1?.content ?? "").startsWith("# Capítulo 1"),
      estruturaEndsWithLastCap: (r?.outputs?.estrutura1?.content ?? "").includes(
        `# Capítulo ${window.__veludoMock.chunkCount}`,
      ),
    };
  });

  await browser.close();

  // ─── Asserts ─────────────────────────────────────────────────────────────
  const fails = [];
  // Stream realmente rodou os 200 chunks
  if (result.chunksEmitted !== 200) fails.push(`chunksEmitted=${result.chunksEmitted}, esperado 200`);
  // SEM o fix: ~201 (1 inicial + 200 per-chunk). COM o fix: ≤ 5 (setup + finalização).
  if (result.setItemCalls > 5) fails.push(`setItemCalls=${result.setItemCalls}, esperado ≤5 (anti-pattern gravaria ~201)`);
  // Durante o stream NÃO pode haver per-chunk persist
  if (result.callsDuringStream > 1) fails.push(`callsDuringStream=${result.callsDuringStream}, esperado ≤1`);
  // Conteúdo final tem que estar populado e correto
  if (result.estruturaChars < 1000) fails.push(`estruturaChars=${result.estruturaChars}, esperado >1000`);
  if (!result.estruturaStartsWithCap1) fails.push(`output não começa com "# Capítulo 1"`);
  if (!result.estruturaEndsWithLastCap) fails.push(`output não contém "# Capítulo 200" (último chunk)`);
  if (consoleErrors.length > 0) fails.push(`console errors: ${consoleErrors.join("; ")}`);

  console.log("\n=== E2E result ===");
  console.log(JSON.stringify(result, null, 2));
  console.log("ratio setItem/chunk:", (result.setItemCalls / result.chunksEmitted).toFixed(4));

  if (fails.length > 0) {
    console.error("\n❌ FAIL:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\n✓ PASS — fix de streaming confirmado");
  console.log(`  ${result.chunksEmitted} chunks → apenas ${result.setItemCalls} setItem total`);
  console.log(`  Redução vs anti-pattern: ${(100 - (result.setItemCalls / 201) * 100).toFixed(1)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
