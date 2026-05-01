/**
 * MyStoriesLena — Main process do Electron.
 *
 * MODOS DE EXECUÇÃO (em ordem de prioridade):
 *
 *  1. NEXT_DEV_URL setado → conecta no dev server externo (npm run electron:dev)
 *  2. MYSTORIESLENA_SOURCE_DIR setado e válido → "modo LIVE": roda Next dev a
 *     partir da pasta-fonte do projeto. Útil pro autor: edita o código aqui no
 *     Claude e basta fechar/abrir o app pra ver as mudanças. Sem reinstalar,
 *     sem build manual.
 *  3. App empacotado → roda o standalone bundle do .next (modo padrão pros
 *     colegas que recebem o instalador).
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const net = require("net");
const http = require("http");

let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch {
  autoUpdater = null;
}

// Logger persistente. Escreve em:
//   Windows: %USERPROFILE%\AppData\Roaming\MyStoriesLena\logs\main.log
//   macOS:   ~/Library/Logs/MyStoriesLena/main.log
// Sem isso, tela branca em prod era impossivel de debugar — usuaria nao
// tinha nada pra mandar.
let log;
try {
  log = require("electron-log/main");
  log.initialize();
  log.transports.file.level = "info";
  log.transports.file.maxSize = 5 * 1024 * 1024;
  // Faz console.log/error/warn no main escrever no arquivo tambem.
  Object.assign(console, log.functions);
} catch (e) {
  // Fallback: se electron-log nao existe (dev sem npm install), usa console
  // padrao. App ainda funciona, so nao tem logs persistentes.
  log = { info: console.log, warn: console.warn, error: console.error };
  console.warn("[boot] electron-log indisponivel:", e?.message || e);
}

const isDev = !!process.env.NEXT_DEV_URL;
const DEV_URL = process.env.NEXT_DEV_URL || "";

let mainWindow = null;
let serverProc = null;
let appUrl = null;
let runtimeMode = "packaged";
// Watchdog do server packaged: se o `node server.js` morrer durante uso normal
// (OOM, exception nao tratada), tentamos respawnar antes de mostrar erro.
let serverRestartCount = 0;
let serverIsRespawning = false;
const MAX_SERVER_RESTARTS = 3;
const SERVER_RESTART_BACKOFF_MS = [1000, 3000, 7000];

function findFreePort(start = 17310) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", () => tryPort(p + 1));
      srv.listen(p, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    };
    tryPort(start);
  });
}

/**
 * Detecta a pasta-fonte do projeto. Se MYSTORIESLENA_SOURCE_DIR estiver
 * definida e for uma pasta de projeto Next válida (com package.json + node_modules
 * + next instalado), retorna o caminho. Caso contrário, retorna null.
 */
function detectSourceDir() {
  const envPath = process.env.MYSTORIESLENA_SOURCE_DIR;
  if (!envPath) return null;
  if (!fs.existsSync(envPath)) {
    console.warn(
      `[live] MYSTORIESLENA_SOURCE_DIR aponta pra ${envPath} mas a pasta não existe.`,
    );
    return null;
  }
  const pkgPath = path.join(envPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.warn(
      `[live] MYSTORIESLENA_SOURCE_DIR=${envPath} não tem package.json — modo LIVE desativado.`,
    );
    return null;
  }
  const nextBin = path.join(envPath, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    console.warn(
      `[live] node_modules/next não encontrado em ${envPath}. Rode "npm install" — modo LIVE desativado.`,
    );
    return null;
  }
  return envPath;
}

function getResourcesPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  return path.join(__dirname, "..", ".next", "standalone");
}

/**
 * Resolve o caminho do binário claude (nativo usado pelo Claude Agent SDK).
 * O nome do pacote e a extensão variam por plataforma:
 *   win32-x64    → claude-agent-sdk-win32-x64/claude.exe
 *   darwin-arm64 → claude-agent-sdk-darwin-arm64/claude
 *   darwin-x64   → claude-agent-sdk-darwin-x64/claude
 *   linux-x64    → claude-agent-sdk-linux-x64/claude
 */
function getClaudeExecutablePath(sourceDir) {
  const platform = process.platform; // "win32" | "darwin" | "linux"
  const arch = process.arch; // "x64" | "arm64"
  const platArch = `${platform}-${arch}`;
  const exe = platform === "win32" ? "claude.exe" : "claude";

  const subPaths = [
    `node_modules/@anthropic-ai/claude-agent-sdk-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-code-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-${platArch}/${exe}`,
    `node_modules/@anthropic-ai/claude-code/bin/${exe}`,
  ];

  const roots = [];
  if (sourceDir) roots.push(sourceDir);
  if (app.isPackaged) {
    // Onde electron-builder pode auto-unpack binarios nativos (raro com nosso
    // files config, mas inofensivo).
    roots.push(path.join(process.resourcesPath, "app.asar.unpacked"));
    // Onde extraResources copia .next/standalone + node_modules tracado.
    // Os subPaths comecam com "node_modules/", entao a raiz NAO inclui isso
    // (bug fixed: antes tinha "app/node_modules", duplicando o segmento).
    roots.push(path.join(process.resourcesPath, "app"));
  } else {
    roots.push(path.join(__dirname, ".."));
  }

  // NOTA: a lista de subPaths está duplicada em lib/claude.ts (fallback
  // runtime). Se mexer aqui, mexa lá também. main.js é CommonJS, lib/ é
  // TS/ESM — bridge custaria mais que duplicar 5 linhas.
  const candidates = [];
  let found = null;
  for (const root of roots) {
    for (const sub of subPaths) {
      const full = path.join(root, sub);
      const exists = fs.existsSync(full);
      candidates.push({ full, exists });
      if (exists && !found) found = full;
    }
  }

  console.log(`[claude] testando ${candidates.length} candidatos do binário native:`);
  for (const c of candidates) {
    console.log(`  ${c.exists ? "✓" : "✗"} ${c.full}`);
  }
  return found;
}

/**
 * Restaura permissao de execucao + remove quarentena do binario claude no Mac/Linux.
 *
 * Por que: arquivos copiados via extraResources pra .app/Contents/Resources/ no
 * Mac as vezes saem sem flag de execucao apos extract do .dmg, ou ficam com
 * atributo com.apple.quarantine herdado do download. O resultado e EACCES ao
 * spawnar — afeta tanto o fluxo de "Conectar conta Claude" quanto a geracao de
 * roteiro (que tambem spawna o binario). Antes, esse reparo so rodava DENTRO do
 * shell script de setup; agora roda no boot, garantindo que qualquer caminho
 * que tente executar o binario funcione.
 *
 * No Windows nao precisa — claude.exe roda sem flag especial.
 */
function prepareNativeBinary(claudeExe) {
  if (!claudeExe || process.platform === "win32") return;
  try {
    fs.chmodSync(claudeExe, 0o755);
    console.log(`[claude] chmod +x aplicado em ${claudeExe}`);
  } catch (e) {
    console.warn(`[claude] chmod falhou (best-effort): ${e?.message || e}`);
  }
  if (process.platform === "darwin") {
    try {
      const { execFileSync } = require("child_process");
      execFileSync("xattr", ["-d", "com.apple.quarantine", claudeExe], {
        stdio: "ignore",
      });
      console.log(`[claude] xattr quarantine removido de ${claudeExe}`);
    } catch {
      // E esperado falhar quando o atributo nao existe — silencioso.
    }
  }
}

/**
 * Modo LIVE: spawn `next dev` a partir da pasta-fonte. Mudanças no código
 * aparecem na próxima abertura do app — basta fechar e abrir.
 */
async function startServerFromSource(sourceDir) {
  const port = await findFreePort();
  const nextBin = path.join(
    sourceDir,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );

  const env = {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "development",
    ELECTRON_RUN_AS_NODE: "1",
    // Desativa banner de telemetria do Next.
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (env.ANTHROPIC_API_KEY === "") delete env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_AUTH_TOKEN === "") delete env.ANTHROPIC_AUTH_TOKEN;
  if (env.ANTHROPIC_BASE_URL === "") delete env.ANTHROPIC_BASE_URL;

  const claudeExe = getClaudeExecutablePath(sourceDir);
  if (claudeExe) {
    prepareNativeBinary(claudeExe);
    env.MYSTORIESLENA_CLAUDE_EXEC = claudeExe;
    console.log(`[claude] usando binário em: ${claudeExe}`);
  }

  console.log(`[live] iniciando Next dev a partir de ${sourceDir} na porta ${port}`);

  // detached:true + windowsHide:true juntos garantem que NEM os workers
  // do Turbopack (que rodam em sub-processos) abram console no Windows.
  // Sem detached, o grandchild herda a falta de console do parent mas
  // pode forçar um novo — que é o que estava acontecendo.
  serverProc = spawn(
    process.execPath,
    [nextBin, "dev", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: sourceDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: true,
    },
  );

  serverProc.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  serverProc.on("exit", (code) => {
    console.log(`[next] exited code=${code}`);
    serverProc = null;
  });

  return `http://127.0.0.1:${port}`;
}

/**
 * Modo padrão: roda o standalone bundle empacotado.
 */
async function startServerPackaged() {
  const port = await findFreePort();
  const resourcesPath = getResourcesPath();
  const serverEntry = path.join(resourcesPath, "server.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `server.js não encontrado em ${serverEntry}. Rode "npm run build" antes.`,
    );
  }

  const env = {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
  };
  if (env.ANTHROPIC_API_KEY === "") delete env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_AUTH_TOKEN === "") delete env.ANTHROPIC_AUTH_TOKEN;
  if (env.ANTHROPIC_BASE_URL === "") delete env.ANTHROPIC_BASE_URL;

  const claudeExe = getClaudeExecutablePath(null);
  if (claudeExe) {
    prepareNativeBinary(claudeExe);
    env.MYSTORIESLENA_CLAUDE_EXEC = claudeExe;
    console.log(`[claude] usando binário em: ${claudeExe}`);
  } else {
    console.warn(
      "[claude] binário claude.exe não encontrado nos caminhos esperados.",
    );
  }

  serverProc = spawn(process.execPath, [serverEntry], {
    cwd: resourcesPath,
    env,
    stdio: "pipe",
    windowsHide: true,
  });

  serverProc.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  serverProc.on("exit", (code) => {
    console.log(`[next] exited code=${code}`);
    serverProc = null;
    // Watchdog: se a janela ainda esta aberta e o exit foi anormal, tenta
    // respawnar. Sem isso, qualquer crash do server (OOM, exception nao
    // tratada) deixa a UI em tela branca permanente porque http://localhost:port
    // para de responder.
    if (
      code !== 0 &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !app.isQuitting &&
      !serverIsRespawning
    ) {
      void respawnServer();
    }
  });

  return `http://127.0.0.1:${port}`;
}

/**
 * Restart do server packaged apos crash. Tenta ate MAX_SERVER_RESTARTS vezes
 * com backoff exponencial. Quando consegue subir, recarrega a janela.
 * Se esgotar tentativas, mostra dialog pedindo pra reabrir o app.
 */
async function respawnServer() {
  if (serverIsRespawning) return;
  serverIsRespawning = true;
  try {
    while (serverRestartCount < MAX_SERVER_RESTARTS) {
      const attempt = serverRestartCount + 1;
      const backoff = SERVER_RESTART_BACKOFF_MS[serverRestartCount] ?? 7000;
      console.warn(`[watchdog] tentativa ${attempt}/${MAX_SERVER_RESTARTS} de respawn em ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      serverRestartCount += 1;
      try {
        appUrl = await startServerPackaged();
        await waitForHealth(appUrl, 30000);
        console.log(`[watchdog] server respondeu em ${appUrl}, recarregando janela`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(appUrl);
        }
        // Sucesso — reseta contador pra que um proximo crash tenha 3 chances de novo.
        serverRestartCount = 0;
        return;
      } catch (e) {
        console.error(`[watchdog] tentativa ${attempt} falhou:`, e?.message || e);
      }
    }
    // Esgotou as tentativas.
    if (mainWindow && !mainWindow.isDestroyed()) {
      const r = await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "MyStoriesLena travou",
        message: "Não consegui recuperar o servidor interno após várias tentativas.",
        detail:
          "Reabra o aplicativo. Se o problema persistir, abra a pasta de logs (menu Ajuda) e mande pra gente.",
        buttons: ["Sair"],
      });
      if (r.response === 0) app.quit();
    }
  } finally {
    serverIsRespawning = false;
  }
}

function waitForHealth(baseUrl, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`${baseUrl}/api/health`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
        } else {
          res.resume();
          if (Date.now() > deadline) {
            reject(new Error(`/api/health respondeu ${res.statusCode}`));
          } else {
            setTimeout(tick, 400);
          }
        }
      });
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("Timeout aguardando o servidor subir"));
        } else {
          setTimeout(tick, 400);
        }
      });
      req.setTimeout(3000, () => req.destroy());
    };
    tick();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0c0a0a",
    show: true,
    icon: path.join(
      __dirname,
      "icons",
      process.platform === "win32"
        ? "icon.ico"
        : process.platform === "darwin"
          ? "icon.icns"
          : "icon.png",
    ),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Mostra a tela de loading IMEDIATAMENTE — uma só janela.
  // Em modo LIVE adiciona um query param pra UI mostrar mensagem específica.
  const loadingPath = path.join(__dirname, "loading.html");
  const fileUrl = `file:///${loadingPath.replace(/\\/g, "/")}`;
  mainWindow.loadURL(`${fileUrl}?mode=${runtimeMode}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Crash handlers: sem isso, quando o renderer morre (OOM, exception fatal)
  // ou o load falha (server caiu), a janela fica branca silenciosamente.
  // Agora logamos, abrimos DevTools (em packaged) e damos opcao de recarregar.
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("[crash] render-process-gone:", JSON.stringify(details));
    if (app.isPackaged && mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.openDevTools({ mode: "detach" });
      } catch {
        // ignore
      }
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog
      .showMessageBox(mainWindow, {
        type: "error",
        title: "MyStoriesLena travou",
        message: "Ocorreu um erro interno na interface.",
        detail: `Motivo: ${details?.reason ?? "desconhecido"} (exit ${details?.exitCode ?? "?"}).\n\nPosso recarregar a janela.`,
        buttons: ["Recarregar", "Sair"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((r) => {
        if (r.response === 0 && appUrl && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(appUrl);
        } else {
          app.quit();
        }
      })
      .catch(() => {
        // Dialog falhou — best effort.
      });
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    // Ignora canceled (usuario navegou pra outra coisa antes da load terminar)
    // e o load inicial do loading.html (file:// pode falhar em alguns cenarios).
    if (code === -3) return; // ABORTED
    console.warn(`[load] did-fail-load code=${code} desc=${desc} url=${url}`);
    // -102 = CONNECTION_REFUSED — server pode estar reinicializando. Tenta de novo.
    if (code === -102 && appUrl && mainWindow && !mainWindow.isDestroyed()) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(appUrl);
      }, 1500);
    }
  });

  mainWindow.on("unresponsive", () => {
    console.warn("[window] janela unresponsive");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function boot() {
  // Decide qual modo usar antes de criar a janela (afeta a tela de loading).
  const sourceDir = detectSourceDir();
  if (isDev) {
    runtimeMode = "external-dev";
  } else if (sourceDir) {
    runtimeMode = "live";
  } else {
    runtimeMode = "packaged";
  }

  createWindow();

  try {
    if (isDev) {
      appUrl = DEV_URL;
      await waitForHealth(appUrl, 15000).catch(() => null);
    } else if (sourceDir) {
      // MODO LIVE: roda Next dev da pasta-fonte. Pode demorar 5-15s na primeira
      // vez (Next compila os módulos), mas mudanças no código aparecem na hora
      // sem precisar reinstalar nada.
      appUrl = await startServerFromSource(sourceDir);
      await waitForHealth(appUrl, 90000);
    } else {
      // Modo padrão (empacotado).
      appUrl = await startServerPackaged();
      await waitForHealth(appUrl, 60000);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(appUrl);
    }
  } catch (err) {
    console.error("Falha no boot:", err);
    dialog.showErrorBox(
      "Falha ao iniciar o MyStoriesLena",
      `O servidor interno não respondeu:\n\n${err.message}\n\nReinstale o aplicativo ou entre em contato com o suporte.`,
    );
    app.quit();
    return;
  }

  if (autoUpdater && app.isPackaged && runtimeMode === "packaged") {
    try {
      const updateConfigPath = path.join(
        process.resourcesPath,
        "app-update.yml",
      );
      let isPlaceholder = false;
      if (fs.existsSync(updateConfigPath)) {
        const cfg = fs.readFileSync(updateConfigPath, "utf-8");
        if (/SEU_USUARIO_GITHUB/i.test(cfg)) isPlaceholder = true;
      }

      if (isPlaceholder) {
        console.log(
          "[updater] desativado — repo GitHub ainda é placeholder no package.json",
        );
      } else {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        wireUpdaterEvents();
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      }
    } catch (e) {
      console.log("[updater] skipped:", e?.message || e);
    }
  } else if (autoUpdater) {
    // Mesmo em dev/live, preparamos os listeners pra que checagem manual via UI funcione no app empacotado.
    wireUpdaterEvents();
  }
}

/**
 * Registra forwarding de eventos do auto-updater pro renderer process.
 * Chamado uma vez por janela após o webContents estar pronto.
 */
function wireUpdaterEvents() {
  if (!autoUpdater) return;

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(`updater:${channel}`, payload);
    }
  };

  autoUpdater.removeAllListeners("checking-for-update");
  autoUpdater.removeAllListeners("update-available");
  autoUpdater.removeAllListeners("update-not-available");
  autoUpdater.removeAllListeners("download-progress");
  autoUpdater.removeAllListeners("update-downloaded");
  autoUpdater.removeAllListeners("error");

  autoUpdater.on("checking-for-update", () => send("checking-for-update"));
  autoUpdater.on("update-available", (info) =>
    send("update-available", { version: info?.version }),
  );
  autoUpdater.on("update-not-available", (info) =>
    send("update-not-available", { version: info?.version }),
  );
  autoUpdater.on("download-progress", (p) =>
    send("download-progress", {
      percent: p?.percent ?? 0,
      bytesPerSecond: p?.bytesPerSecond ?? 0,
      transferred: p?.transferred ?? 0,
      total: p?.total ?? 0,
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    send("update-downloaded", { version: info?.version }),
  );
  autoUpdater.on("error", (err) => send("error", { message: String(err?.message || err) }));
}

// IPC handlers — endpoints que o renderer chama via preload.js (window.mystorieslena).
ipcMain.handle("runtime:info", () => ({
  mode: runtimeMode, // "live" | "packaged" | "external-dev"
  version: app.getVersion(),
  isPackaged: app.isPackaged,
  updaterAvailable: !!autoUpdater && app.isPackaged && runtimeMode === "packaged",
}));

ipcMain.handle("updater:check", async () => {
  if (!autoUpdater) {
    return { ok: false, reason: "autoUpdater não disponível neste build." };
  }
  if (!app.isPackaged) {
    return {
      ok: false,
      reason: "Atualizações só funcionam no app instalado (não em modo dev/LIVE).",
    };
  }
  if (runtimeMode === "live") {
    return {
      ok: false,
      reason:
        "Modo LIVE ativo — você está lendo direto da pasta de código. Atualizações só funcionam no .exe instalado sem MYSTORIESLENA_SOURCE_DIR.",
    };
  }
  try {
    autoUpdater.autoDownload = false;
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, info: result?.updateInfo ?? null };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
});

ipcMain.handle("updater:download", async () => {
  if (!autoUpdater || !app.isPackaged) {
    return { ok: false, reason: "Updater indisponível." };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
});

ipcMain.handle("updater:install", () => {
  if (!autoUpdater || !app.isPackaged) return { ok: false };
  // isSilent=false (mostra wizard NSIS), isForceRunAfter=true (reabre depois).
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

/**
 * Abre a pasta de logs no explorer/finder. Usado pelo botao "Abrir pasta de
 * logs" no app, pra usuaria conseguir mandar o log quando reportar bug.
 */
ipcMain.handle("log:open-folder", () => {
  try {
    const logFile = log?.transports?.file?.getFile?.()?.path;
    if (logFile) {
      shell.showItemInFolder(logFile);
      return { ok: true, path: logFile };
    }
    // Fallback: abre o diretorio userData direto.
    const userData = app.getPath("logs");
    shell.openPath(userData);
    return { ok: true, path: userData };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
});

/**
 * Gera PDF do roteiro a partir de HTML usando printToPDF nativo do Chromium.
 * Mostra dialog pro usuário escolher onde salvar e grava o arquivo.
 */
ipcMain.handle("pdf:save-roteiro", async (_event, payload) => {
  const html = String(payload?.html ?? "");
  const suggestedName = String(payload?.filename ?? "roteiro.pdf");
  const title = String(payload?.title ?? "Roteiro");

  if (!html.trim()) {
    return { ok: false, reason: "HTML vazio." };
  }

  // Janela invisível dedicada à renderização do PDF.
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 1000,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false,
    },
  });

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await pdfWindow.loadURL(dataUrl);
    // Pequena espera pra fontes/CSS aplicarem antes do print.
    await new Promise((r) => setTimeout(r, 300));

    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "custom",
        top: 0.6,
        bottom: 0.6,
        left: 0.7,
        right: 0.7,
      },
      preferCSSPageSize: false,
    });

    pdfWindow.destroy();

    const result = await dialog.showSaveDialog({
      title: "Salvar roteiro em PDF",
      defaultPath: suggestedName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    fs.writeFileSync(result.filePath, pdfBuffer);
    return { ok: true, path: result.filePath, title };
  } catch (e) {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy();
    return { ok: false, reason: String(e?.message || e) };
  }
});

/**
 * Verifica se o usuário já fez login na conta Claude (Pro/Max).
 *
 * - **Windows / Linux**: o Claude Code CLI guarda o token OAuth em
 *   `~/.claude/.credentials.json` (versões antigas: sem ponto).
 * - **macOS**: a partir do Claude Code CLI 2.x, o token é armazenado no
 *   **Keychain** do sistema, sob o serviço `Claude Code-credentials`. Não
 *   existe arquivo em disco. Para validar, chamamos
 *   `security find-generic-password -s "Claude Code-credentials" -a <user>`.
 *   Esse comando retorna exit code 0 se a entrada existe, sem expor o
 *   conteúdo (precisaria de `-w` pra extrair, que pediria autorização).
 */
function getClaudeAuthStatus() {
  const home = os.homedir();

  if (process.platform === "darwin") {
    try {
      const username = os.userInfo().username;
      // -s = service, -a = account. Sem -w não pede autorização do Keychain
      // — só verifica existência. stdio:"ignore" suprime o output.
      require("child_process").execFileSync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-a", username],
        { stdio: "ignore" },
      );
      return { loggedIn: true, credentialsPath: "Keychain: Claude Code-credentials" };
    } catch {
      // exit != 0 = entrada não existe no keychain. Continua pra checar arquivo
      // (caso muito antigo ou Claude CLI configurado de forma não-padrão).
    }
  }

  const candidates = [
    path.join(home, ".claude", ".credentials.json"),
    path.join(home, ".claude", "credentials.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        if (stat.size > 0) {
          return { loggedIn: true, credentialsPath: p };
        }
      } catch {
        // ignore — vai tentar o próximo
      }
    }
  }
  return { loggedIn: false, credentialsPath: null };
}

/**
 * No Windows, o Claude Code CLI exige bash.exe do Git for Windows.
 * Procuramos nos locais conhecidos de instalação. Retorna null se não achar
 * (vai precisar instalar Git for Windows).
 */
function findGitBashPath() {
  if (process.platform !== "win32") return null;
  const home = os.homedir();
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    path.join(home, "AppData", "Local", "Programs", "Git", "bin", "bash.exe"),
    path.join(home, "scoop", "apps", "git", "current", "bin", "bash.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Tenta encontrar via where bash no PATH.
  try {
    const out = require("child_process")
      .execSync("where bash", { encoding: "utf-8", windowsHide: true })
      .toString();
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const l of lines) {
      if (l.toLowerCase().endsWith("bash.exe") && fs.existsSync(l)) return l;
    }
  } catch {
    // not in PATH
  }
  return null;
}

ipcMain.handle("claude:status", () => {
  const auth = getClaudeAuthStatus();
  const sourceDir = detectSourceDir();
  const claudeExe = getClaudeExecutablePath(sourceDir);
  const gitBashPath = findGitBashPath();
  return {
    loggedIn: auth.loggedIn,
    hasBinary: !!claudeExe,
    binaryPath: claudeExe,
    gitBashPath,
    needsGitBash: process.platform === "win32" && !gitBashPath,
  };
});

/**
 * Abre uma janela de terminal externa rodando o `claude` CLI bundleado.
 * O usuário digita /login dentro do REPL → o Claude abre o navegador pra
 * fazer OAuth → token vai pra ~/.claude/.credentials.json. Quando ela
 * fechar o terminal e voltar pro app, o status é atualizado.
 */
ipcMain.handle("claude:setup", () => {
  const sourceDir = detectSourceDir();
  const claudeExe = getClaudeExecutablePath(sourceDir);
  if (!claudeExe) {
    return {
      ok: false,
      reason:
        "Não encontrei o binário claude bundleado. Reinstale o app e tente de novo.",
    };
  }

  try {
    if (process.platform === "win32") {
      // Escreve um .bat temporário que faz tudo num clique:
      //  1. Procura git-bash em paths conhecidos
      //  2. Se nao achar, instala via winget (Windows 10+/11 tem built-in)
      //  3. Re-verifica e roda claude com CLAUDE_CODE_GIT_BASH_PATH setado
      // Tudo no mesmo .bat pra usuaria so apertar 1 botao.
      const batPath = path.join(os.tmpdir(), "mystorieslena-claude-setup.bat");
      const batContent = `@echo off
title MyStoriesLena - Configurar conta Claude
echo.
echo ===== Conectar conta Claude =====
echo.

REM Procura git-bash nos paths conhecidos.
set "GITBASH="
if exist "C:\\Program Files\\Git\\bin\\bash.exe" set "GITBASH=C:\\Program Files\\Git\\bin\\bash.exe"
if not defined GITBASH if exist "C:\\Program Files (x86)\\Git\\bin\\bash.exe" set "GITBASH=C:\\Program Files (x86)\\Git\\bin\\bash.exe"
if not defined GITBASH if exist "%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe" set "GITBASH=%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe"

if not defined GITBASH (
    echo [1/3] Git for Windows nao encontrado. Vou instalar agora via winget.
    echo       Pode pedir confirmacao do Windows - aceite pra continuar.
    echo.
    where winget >nul 2>nul
    if errorlevel 1 (
        echo Winget nao disponivel neste Windows. Abrindo pagina de download manual...
        start https://git-scm.com/download/win
        echo.
        echo Apos instalar Git for Windows, FECHE esta janela e clique
        echo novamente em 'Conectar conta Claude'.
        pause
        exit /b 1
    )
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    if errorlevel 1 (
        echo.
        echo Falha no winget. Abrindo pagina de download manual...
        start https://git-scm.com/download/win
        pause
        exit /b 1
    )
    echo.
    echo [1/3] OK - Git for Windows instalado.
    echo.
    REM Re-verifica.
    if exist "C:\\Program Files\\Git\\bin\\bash.exe" set "GITBASH=C:\\Program Files\\Git\\bin\\bash.exe"
    if not defined GITBASH if exist "%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe" set "GITBASH=%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe"
    if not defined GITBASH (
        echo Git instalado mas bash.exe nao foi encontrado nos lugares esperados.
        echo Reinicie o MyStoriesLena e tente de novo.
        pause
        exit /b 1
    )
)

set "CLAUDE_CODE_GIT_BASH_PATH=%GITBASH%"

echo [2/3] Pronto pra logar.
echo.
echo ----------------------------------
echo  AGORA:
echo    1. Digite /login e aperte Enter
echo    2. Faca login no navegador que vai abrir
echo    3. Quando o Claude confirmar o login, digite /quit
echo    4. Volte pro MyStoriesLena e clique em 'Ja loguei'
echo ----------------------------------
echo.

"${claudeExe}"

echo.
echo [3/3] Sessao do Claude encerrada.
echo Volte ao MyStoriesLena e clique em 'Ja loguei - verificar'.
echo Pode fechar esta janela.
pause
`;
      fs.writeFileSync(batPath, batContent, "utf-8");
      spawn("cmd.exe", ["/c", "start", "", batPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      }).unref();
    } else if (process.platform === "darwin") {
      // Mesma estratégia no Mac: shell script temporário.
      const shPath = path.join(os.tmpdir(), "mystorieslena-claude-setup.sh");
      const shContent = [
        "#!/bin/bash",
        "set -u",
        `CLAUDE_BIN="${claudeExe}"`,
        "echo",
        "echo '===== Conectar conta Claude ====='",
        "echo",
        // Defensivo: garante que o binario tem flag de execucao e nao esta
        // em quarentena (pode ter herdado do .dmg mesmo apos xattr -cr na
        // .app, ou se o usuario nao rodou xattr antes de abrir).
        'chmod +x "$CLAUDE_BIN" 2>/dev/null || true',
        'xattr -d com.apple.quarantine "$CLAUDE_BIN" 2>/dev/null || true',
        // Falha ruidosa se o binario nao ficou executavel — sem isso, o claude
        // dava erro EACCES enigmatico e a usuaria nao sabia o que fazer.
        'if [ ! -x "$CLAUDE_BIN" ]; then',
        '  echo "ERRO: binario claude sem permissao de execucao em $CLAUDE_BIN"',
        '  echo "Tente reinstalar o MyStoriesLena."',
        "  read -p 'Pressione Enter pra fechar...'",
        "  exit 1",
        "fi",
        "echo 'AGORA:'",
        "echo '  1. Digite /login e aperte Enter'",
        "echo '  2. Faca login no navegador que vai abrir'",
        "echo '  3. Quando o Claude confirmar o login, digite /quit'",
        "echo '  4. Volte pro MyStoriesLena e clique em Ja loguei'",
        "echo",
        "echo '=================================='",
        "echo",
        '"$CLAUDE_BIN"',
        "echo",
        "echo 'Sessao do Claude encerrada. Volte ao MyStoriesLena e clique em Ja loguei.'",
        "echo 'Pode fechar esta janela.'",
        "",
      ].join("\n");
      fs.writeFileSync(shPath, shContent, { mode: 0o755 });
      // `open -a Terminal <script>` abre Terminal.app executando o script.
      // Trocado de osascript pra evitar prompt de permissao de Automation
      // (que algumas usuarias negam, deixando o setup silenciosamente quebrado).
      const child = spawn("open", ["-a", "Terminal", shPath], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", (err) => {
        console.error("[claude:setup] open -a Terminal falhou:", err);
      });
      child.unref();
    } else {
      // Linux best-effort.
      spawn("x-terminal-emulator", ["-e", claudeExe], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
});

/**
 * Apaga as credenciais do Claude CLI pra trocar de conta. O CLI não tem
 * comando de logout — a forma oficial é remover ~/.claude/.credentials.json
 * (e o legado sem ponto). Depois disso, o próximo /login no terminal vai
 * pedir OAuth de novo e gravar credenciais da nova conta.
 */
ipcMain.handle("claude:logout", () => {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".claude", ".credentials.json"),
    path.join(home, ".claude", "credentials.json"),
  ];
  const removed = [];
  try {
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        removed.push(p);
      }
    }
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
});

app.whenReady().then(() => {
  // No macOS, em modo dev (`electron .`), o ícone do Dock por padrão é o do
  // framework Electron (não o do app). O `BrowserWindow.icon` afeta só a
  // janela. Pra ver o ícone customizado também no Dock durante dev, setamos
  // explicitamente via app.dock.setIcon. No `.app` empacotado isso não é
  // necessário — o macOS lê o `.icns` do bundle automaticamente.
  if (process.platform === "darwin" && !app.isPackaged && app.dock) {
    const dockIconPath = path.join(__dirname, "icons", "icon.icns");
    if (fs.existsSync(dockIconPath)) {
      try {
        app.dock.setIcon(dockIconPath);
      } catch (err) {
        console.warn("[dock] setIcon falhou (best-effort):", err?.message || err);
      }
    }
  }
  return boot();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on("before-quit", () => {
  // Sinaliza pro watchdog NAO tentar respawnar quando o server morrer durante
  // shutdown (kill abaixo dispara `exit` com code != 0).
  app.isQuitting = true;
  if (serverProc && !serverProc.killed) {
    try {
      // Em modo detached:true, kill() só mata o processo direto — os
      // workers do Turbopack ficariam orfãos. taskkill /T mata a árvore
      // toda. Em outros OSes usa kill no process group.
      if (process.platform === "win32") {
        const { execSync } = require("child_process");
        execSync(`taskkill /pid ${serverProc.pid} /T /F`, { windowsHide: true });
      } else {
        try {
          process.kill(-serverProc.pid, "SIGTERM");
        } catch {
          serverProc.kill();
        }
      }
    } catch {
      // ignore
    }
  }
});
