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

const { app, BrowserWindow, shell, dialog } = require("electron");
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
 * Resolve o caminho do claude.exe (binário nativo usado pelo Claude Agent SDK).
 */
function getClaudeExecutablePath(sourceDir) {
  const candidates = [];

  // Em modo LIVE, prioriza o binário da pasta-fonte (sempre fresco).
  if (sourceDir) {
    candidates.push(
      path.join(
        sourceDir,
        "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
      ),
      path.join(
        sourceDir,
        "node_modules/@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
      ),
      path.join(
        sourceDir,
        "node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe",
      ),
      path.join(
        sourceDir,
        "node_modules/@anthropic-ai/claude-code/bin/claude.exe",
      ),
    );
  }

  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked");
    candidates.push(
      path.join(
        unpacked,
        "node_modules/@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
      ),
      path.join(
        unpacked,
        "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
      ),
      path.join(
        unpacked,
        "node_modules/@anthropic-ai/claude-code/bin/claude.exe",
      ),
      path.join(
        unpacked,
        "node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe",
      ),
    );
  } else {
    const projectRoot = path.join(__dirname, "..");
    candidates.push(
      path.join(
        projectRoot,
        "node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
      ),
      path.join(
        projectRoot,
        "node_modules/@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe",
      ),
    );
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
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
        autoUpdater.on("error", (err) => {
          console.log("[updater] error:", err?.message || err);
        });
        autoUpdater.checkForUpdatesAndNotify().catch(() => {});
      }
    } catch (e) {
      console.log("[updater] skipped:", e?.message || e);
    }
  }
}

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
