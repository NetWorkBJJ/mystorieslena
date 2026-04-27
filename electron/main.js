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
const net = require("net");
const http = require("http");

let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch {
  autoUpdater = null;
}

const isDev = !!process.env.NEXT_DEV_URL;
const DEV_URL = process.env.NEXT_DEV_URL || "";

let mainWindow = null;
let serverProc = null;
let appUrl = null;
let runtimeMode = "packaged";

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
    roots.push(path.join(process.resourcesPath, "app.asar.unpacked"));
    // No Mac, recursos podem estar em Contents/Resources/app.asar.unpacked.
    roots.push(path.join(process.resourcesPath, "app", "node_modules"));
  } else {
    roots.push(path.join(__dirname, ".."));
  }

  for (const root of roots) {
    for (const sub of subPaths) {
      const full = path.join(root, sub);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
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
    env.MYSTORIESLENA_CLAUDE_EXEC = claudeExe;
    console.log(`[claude] usando binário em: ${claudeExe}`);
  }

  console.log(`[live] iniciando Next dev a partir de ${sourceDir} na porta ${port}`);

  serverProc = spawn(
    process.execPath,
    [nextBin, "dev", "--port", String(port), "--hostname", "127.0.0.1"],
    {
      cwd: sourceDir,
      env,
      stdio: "pipe",
      windowsHide: true,
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
  });

  return `http://127.0.0.1:${port}`;
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
    icon: path.join(__dirname, "icons", "icon.ico"),
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

app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on("before-quit", () => {
  if (serverProc && !serverProc.killed) {
    try {
      serverProc.kill();
    } catch {
      // ignore
    }
  }
});
