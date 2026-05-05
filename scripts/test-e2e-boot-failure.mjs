/**
 * E2E do fluxo de FALHA de boot do Electron (timeout do servidor interno).
 *
 * Roda em duas fases:
 *
 *   FASE 1: ELECTRON_RUN_AS_NODE=1 herdado do shell.
 *     Valida que o early-exit detecta e mostra mensagem util em vez de
 *     crashar com "Cannot read properties of undefined (reading 'commandLine')".
 *
 *   FASE 2: env limpa, source-dir falso com stub de `next dev` que loga
 *     mas nunca expoe /api/health.
 *     Valida via stdout/stderr do main process que:
 *       - appendServerLog capturou o stdout do "next dev" stub
 *       - waitForHealth + livenessProbe deixaram o stub rodar > timeout
 *         original (cap 2x) porque ele estava ativamente logando
 *       - showBootFailureDialog foi chamado
 *
 * NAO valida: clicks no dialog (UI nativo, requer playwright/spectron) e
 * cleanup de orfaos isoladamente (testavel se extrair killOrphanNextDev pra
 * modulo separado — refactor futuro).
 *
 * Como rodar:
 *   node scripts/test-e2e-boot-failure.mjs
 *
 * Exit code 0 = pass, 1 = fail.
 */
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// require('electron') retorna o path do binario nativo (electron.exe no Win).
const electronExe = require("electron");

/**
 * Spawn do Electron com env customizada. Captura stdout/stderr e mata a
 * arvore de processos apos waitMs (dialog Electron eh nativo e bloqueante).
 */
async function runElectron({ extraEnv = {}, waitMs }) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "mlena-e2e-userdata-"));

  // Importante: em Windows, env.X = "" eh DIFERENTE de env sem a key X — o
  // Electron checa getenv() que retorna a string vazia (= "setado") em vez
  // de NULL. Pra realmente unsetar, precisamos delete. Por isso tratamos
  // string vazia / null em extraEnv como "remove".
  const env = { ...process.env };
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === "" || v == null) {
      delete env[k];
    } else {
      env[k] = v;
    }
  }
  // Sanitiza creds vazias que poderiam interferir.
  if (env.ANTHROPIC_API_KEY === "") delete env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_AUTH_TOKEN === "") delete env.ANTHROPIC_AUTH_TOKEN;

  const proc = spawn(
    electronExe,
    [projectRoot, `--user-data-dir=${userDataDir}`, "--no-sandbox"],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => {
    stdout += d.toString();
    process.stdout.write(`[el-out] ${d}`);
  });
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    process.stderr.write(`[el-err] ${d}`);
  });

  let exitCode = null;
  const exitPromise = new Promise((r) =>
    proc.on("exit", (code) => {
      exitCode = code;
      r();
    }),
  );

  // Aguarda timeout OU early-exit do processo (o que vier primeiro).
  await Promise.race([
    new Promise((r) => setTimeout(r, waitMs)),
    exitPromise,
  ]);

  if (exitCode === null) {
    if (process.platform === "win32") {
      try {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true });
      } catch { /* processo ja morreu */ }
    } else {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        try { proc.kill("SIGKILL"); } catch { /* ignore */ }
      }
    }
    await Promise.race([
      exitPromise,
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }

  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch { /* ignore */ }

  return {
    stdout,
    stderr,
    combined: stdout + "\n" + stderr,
    exitCode,
  };
}

/**
 * Cria source-dir falso com um stub de `next dev` que loga continuamente
 * mas nunca abre porta HTTP — forca waitForHealth a estourar deadline.
 */
function makeFakeSourceDir() {
  const sourceDir = mkdtempSync(path.join(tmpdir(), "mlena-e2e-source-"));
  const nextBinDir = path.join(sourceDir, "node_modules", "next", "dist", "bin");
  mkdirSync(nextBinDir, { recursive: true });

  const nextStub = `
const PORT = process.env.PORT || "3000";
console.log("fake-next-dev:starting port=" + PORT);
let i = 0;
setInterval(() => {
  i++;
  console.log("fake-next-dev:compiling tick=" + i + " ts=" + new Date().toISOString());
}, 500);
// Sem listen() — /api/health NUNCA vai responder.
`;
  writeFileSync(path.join(nextBinDir, "next"), nextStub);
  writeFileSync(
    path.join(sourceDir, "package.json"),
    JSON.stringify({ name: "fake-mlena-source", private: true }),
  );
  return sourceDir;
}

function reportPhase(name, checks) {
  console.log(`\n[e2e] === ${name} ===`);
  let pass = true;
  for (const c of checks) {
    if (c.ok) {
      console.log(`  PASS  ${c.name}`);
    } else {
      console.log(`  FAIL  ${c.name}`);
      console.log(`        ${c.hint}`);
      pass = false;
    }
  }
  return pass;
}

// ===========================================================================
// FASE 1: ELECTRON_RUN_AS_NODE detection
// ===========================================================================
console.log("\n[e2e] FASE 1: ELECTRON_RUN_AS_NODE=1 herdado do shell\n");

const phase1 = await runElectron({
  extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
  waitMs: 4000, // early-exit eh imediato — 4s eh folga generosa
});

const phase1Ok = reportPhase("FASE 1", [
  {
    name: "Electron exitou cedo (codigo 1)",
    ok: phase1.exitCode === 1,
    hint: `Esperava exit code 1, recebi ${phase1.exitCode}. Early-exit nao disparou.`,
  },
  {
    name: "Mensagem de erro mencionou ELECTRON_RUN_AS_NODE",
    ok: phase1.combined.includes("ELECTRON_RUN_AS_NODE"),
    hint: "Esperava ver 'ELECTRON_RUN_AS_NODE' na mensagem de erro.",
  },
  {
    name: "Mensagem deu instrucoes de fix (PowerShell/CMD/unset)",
    ok:
      phase1.combined.includes("PowerShell") &&
      phase1.combined.includes("unset"),
    hint: "Esperava instrucoes claras de como limpar a env var.",
  },
  {
    name: "Sem TypeError opaco do Electron",
    ok: !/Cannot read properties of undefined.*commandLine/.test(
      phase1.combined,
    ),
    hint: "Vi o TypeError opaco — early-exit nao protegeu o usuario.",
  },
]);

// ===========================================================================
// FASE 2: timeout do boot em modo LIVE (env limpa)
// ===========================================================================
console.log("\n[e2e] FASE 2: timeout do boot em modo LIVE (env limpa)\n");

const sourceDir = makeFakeSourceDir();
console.log(`[e2e] sourceDir = ${sourceDir}`);

const phase2 = await runElectron({
  extraEnv: {
    MYSTORIESLENA_SOURCE_DIR: sourceDir,
    MYSTORIESLENA_BOOT_TIMEOUT_MS: "5000",
    NEXT_DEV_URL: "", // forca modo LIVE
    ELECTRON_RUN_AS_NODE: "", // garante que limpamos
  },
  // 5s timeout + livenessProbe estende ate 10s (cap 2x). Aguardamos 14s
  // pra dar margem pra dialog aparecer (sera matado por taskkill depois).
  waitMs: 14_000,
});

const phase2Ok = reportPhase("FASE 2", [
  {
    name: "appendServerLog capturou stdout do next dev stub",
    ok:
      phase2.combined.includes("fake-next-dev:starting") ||
      phase2.combined.includes("fake-next-dev:compiling"),
    hint: "Esperava ver linhas 'fake-next-dev:...' no stdout — buffer nao capturou.",
  },
  {
    name: "Prefixo [next] aplicado pelo appendServerLog",
    ok: /\[next\]/.test(phase2.combined),
    hint: "Esperava ver prefixo '[next]' nas linhas — appendServerLog nao foi chamado.",
  },
  {
    name: "Falha no boot foi detectada e logada",
    ok:
      phase2.combined.includes("Falha no boot") ||
      phase2.combined.includes("Timeout aguardando o servidor"),
    hint: "Esperava 'Falha no boot:' ou 'Timeout aguardando o servidor subir' no log.",
  },
  {
    name: "livenessProbe estendeu o deadline (stub rodou > 5s)",
    // Se livenessProbe nao funcionasse, o teste falharia em ~5s. Como o
    // stub mantem lastActivityMs recente (loga a cada 500ms), a probe
    // estende o deadline ate cap 2x (10s). Validamos tick=10+ (>5s rodando).
    ok: /tick=(1[0-9]|[2-9]\d)/.test(phase2.combined),
    hint: "Esperava tick=10+ do stub (>5s de runtime) — livenessProbe nao estendeu o deadline.",
  },
]);

// Cleanup
try {
  rmSync(sourceDir, { recursive: true, force: true });
} catch { /* ignore */ }

// ===========================================================================
// Resultado final
// ===========================================================================
const allOk = phase1Ok && phase2Ok;
if (allOk) {
  console.log("\n[e2e] ALL PHASES PASSED");
  process.exit(0);
} else {
  console.error("\n[e2e] SOME PHASES FAILED");
  process.exit(1);
}
