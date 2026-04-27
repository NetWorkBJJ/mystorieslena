/**
 * Preload do Electron — expõe uma API mínima pro renderer (React) interagir
 * com o main process. Mantém contextIsolation ON (segurança) e usa
 * contextBridge.
 */

const { contextBridge, ipcRenderer } = require("electron");

const UPDATER_CHANNELS = [
  "checking-for-update",
  "update-available",
  "update-not-available",
  "download-progress",
  "update-downloaded",
  "error",
];

contextBridge.exposeInMainWorld("mystorieslena", {
  /** Pergunta o modo de runtime atual: "live" | "packaged" | "external-dev". */
  getRuntimeInfo: () => ipcRenderer.invoke("runtime:info"),

  /** Dispara verificação de update no GitHub Releases. */
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),

  /** Inicia download da versão disponível (se houver). */
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),

  /** Reinicia o app pra aplicar update já baixado. */
  quitAndInstall: () => ipcRenderer.invoke("updater:install"),

  /**
   * Exporta o roteiro completo como PDF. Retorna { ok, path } ou
   * { ok: false, canceled: true } se o usuário cancelar o dialog.
   */
  exportRoteiroPdf: (payload) => ipcRenderer.invoke("pdf:save-roteiro", payload),

  /**
   * Verifica se o usuário já fez login na conta Claude.
   * Retorna { loggedIn, hasBinary, binaryPath }.
   */
  getClaudeStatus: () => ipcRenderer.invoke("claude:status"),

  /**
   * Abre janela de terminal externa rodando o claude CLI bundleado, pra
   * usuário fazer login (digita /login dentro do REPL → OAuth no navegador).
   */
  setupClaude: () => ipcRenderer.invoke("claude:setup"),

  /**
   * Assina eventos do auto-updater. Retorna função pra remover assinatura.
   *   onUpdateEvent(({ type, payload }) => {})
   * type pode ser: "checking-for-update", "update-available",
   * "update-not-available", "download-progress", "update-downloaded", "error".
   */
  onUpdateEvent: (cb) => {
    const wrappers = UPDATER_CHANNELS.map((channel) => {
      const handler = (_event, payload) => cb({ type: channel, payload });
      const ipcChannel = `updater:${channel}`;
      ipcRenderer.on(ipcChannel, handler);
      return { ipcChannel, handler };
    });
    return () => {
      for (const { ipcChannel, handler } of wrappers) {
        ipcRenderer.removeListener(ipcChannel, handler);
      }
    };
  },
});
