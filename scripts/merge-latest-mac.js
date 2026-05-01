/**
 * Mescla dois latest-mac.yml gerados em runners diferentes (arm64 + x64) num
 * único arquivo que o electron-updater entende como release multi-arch.
 *
 * Formato esperado de cada YAML:
 *   version: 1.0.41
 *   files:
 *     - url: MyStoriesLena-1.0.41-<arch>.dmg
 *       sha512: ...
 *       size: ...
 *     - url: MyStoriesLena-1.0.41-<arch>.zip
 *       sha512: ...
 *       size: ...
 *   path: MyStoriesLena-1.0.41-<arch>.dmg
 *   sha512: ...
 *   releaseDate: '...'
 *
 * Estratégia: une os arrays `files` deduplicando por `url`. Preserva `version`
 * e `releaseDate` do segundo arquivo (assume-se que é o mais recente, já que
 * é o que acabou de ser gerado neste job). `path`/`sha512` top-level também
 * vêm do segundo (são fallback do default arch — irrelevantes pro fluxo
 * multi-arch porque o updater itera `files`).
 *
 * Uso:
 *   node scripts/merge-latest-mac.js <yaml-prévio> <yaml-novo> <yaml-saída>
 */

const fs = require("fs");
const yaml = require("js-yaml");

const [, , prevPath, newPath, outPath] = process.argv;

if (!prevPath || !newPath || !outPath) {
  console.error("Uso: node merge-latest-mac.js <prev.yml> <new.yml> <out.yml>");
  process.exit(1);
}

function loadYaml(p) {
  if (!fs.existsSync(p)) {
    console.error(`Arquivo não encontrado: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, "utf8");
  return yaml.load(raw) || {};
}

const prev = loadYaml(prevPath);
const next = loadYaml(newPath);

const prevFiles = Array.isArray(prev.files) ? prev.files : [];
const nextFiles = Array.isArray(next.files) ? next.files : [];

// Une por URL, dando preferência aos arquivos do "next" (mais recente).
const byUrl = new Map();
for (const f of prevFiles) {
  if (f && f.url) byUrl.set(f.url, f);
}
for (const f of nextFiles) {
  if (f && f.url) byUrl.set(f.url, f);
}

const merged = {
  ...prev,
  ...next,
  files: Array.from(byUrl.values()),
};

fs.writeFileSync(outPath, yaml.dump(merged, { lineWidth: -1 }));

console.log(
  `✓ latest-mac.yml mesclado — ${merged.files.length} arquivos (${merged.files
    .map((f) => f.url)
    .join(", ")})`,
);
