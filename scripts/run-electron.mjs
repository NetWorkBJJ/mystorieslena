#!/usr/bin/env node
/**
 * Wrapper que spawna o Electron com env var ELECTRON_RUN_AS_NODE
 * realmente DELETADA — não apenas setada como string vazia.
 *
 * Por que existe: `cross-env ELECTRON_RUN_AS_NODE= electron .` SETA a var
 * como "" (string vazia). O binário do Electron é C++ e checa via getenv(),
 * que retorna não-NULL para strings vazias. Resultado: o Electron entra em
 * modo Node puro mesmo com a "limpeza" do cross-env, e o app aborta com
 * "ipcMain undefined" antes de qualquer JS rodar.
 *
 * Esse wrapper roda em Node, onde `delete process.env.X` deleta de verdade,
 * e spawna o Electron com env limpa de fato. Funciona em qualquer shell
 * (PowerShell, CMD, bash) sem depender do comportamento do cross-env.
 *
 * Aceita qualquer NEXT_DEV_URL passado via env do parent (concurrently).
 */
import { spawn } from "node:child_process";
import electronPath from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Default pra fluxo `electron:dev` (concurrently → wait-on porta 3000).
// `electron:start` não precisa — usa modo packaged/LIVE direto.
if (!env.NEXT_DEV_URL && process.argv.includes("--dev")) {
  env.NEXT_DEV_URL = "http://localhost:3000";
}

const child = spawn(electronPath, ["."], { stdio: "inherit", env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
