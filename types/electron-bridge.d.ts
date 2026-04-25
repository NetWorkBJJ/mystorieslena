/**
 * API exposta pelo preload do Electron via contextBridge.
 * Disponível em window.mystorieslena (apenas dentro do Electron).
 */

export interface RuntimeInfo {
  mode: "live" | "packaged" | "external-dev" | string;
  version: string;
  isPackaged: boolean;
  /** true quando o app pode atualizar via GitHub Releases */
  updaterAvailable: boolean;
}

export interface UpdaterCheckResult {
  ok: boolean;
  reason?: string;
  info?: { version?: string } | null;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export type UpdateEvent =
  | { type: "checking-for-update"; payload?: undefined }
  | { type: "update-available"; payload: { version?: string } }
  | { type: "update-not-available"; payload: { version?: string } }
  | { type: "download-progress"; payload: DownloadProgress }
  | { type: "update-downloaded"; payload: { version?: string } }
  | { type: "error"; payload: { message: string } };

export interface ExportPdfPayload {
  html: string;
  filename: string;
  title: string;
}

export interface ExportPdfResult {
  ok: boolean;
  path?: string;
  title?: string;
  canceled?: boolean;
  reason?: string;
}

export interface MyStoriesLenaBridge {
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  checkForUpdates: () => Promise<UpdaterCheckResult>;
  downloadUpdate: () => Promise<{ ok: boolean; reason?: string }>;
  quitAndInstall: () => Promise<{ ok: boolean }>;
  onUpdateEvent: (cb: (event: UpdateEvent) => void) => () => void;
  exportRoteiroPdf: (payload: ExportPdfPayload) => Promise<ExportPdfResult>;
}

declare global {
  interface Window {
    mystorieslena?: MyStoriesLenaBridge;
  }
}

export {};
