/**
 * Gera os ícones do MyStoriesLena a partir do SVG temático em
 * electron/icons/source.svg.
 *
 * Pipeline: SVG -> PNGs (vários tamanhos via sharp) -> ICO (Windows) + ICNS (macOS) + PNG 512 (Linux/banner).
 * Roda com `npm run icon:build`.
 *
 * Cross-platform: png2icons é puro JS e gera .icns sem precisar do iconutil
 * (que só existe em macOS), então o script funciona em qualquer runner do CI.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico");
const png2icons = require("png2icons");

const SRC = path.join(__dirname, "..", "electron", "icons", "source.svg");
const OUT_DIR = path.join(__dirname, "..", "electron", "icons");
const OUT_ICO = path.join(OUT_DIR, "icon.ico");
const OUT_ICNS = path.join(OUT_DIR, "icon.icns");
const OUT_PNG_512 = path.join(OUT_DIR, "icon.png");

// Tamanhos pra .ico (Windows NSIS / shell).
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`Source SVG não encontrado em ${SRC}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(SRC);

  // PNGs para o .ico
  const icoPngs = [];
  for (const size of ICO_SIZES) {
    const buf = await sharp(svg)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    icoPngs.push(buf);
  }

  // PNG 1024 — fonte para o .icns (png2icons gera todas as variantes a partir dele).
  const png1024 = await sharp(svg)
    .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // PNG 512 — também útil pra Linux/.AppImage e banner.
  const png512 = await sharp(svg).resize(512, 512).png().toBuffer();
  fs.writeFileSync(OUT_PNG_512, png512);

  // ICO (Windows)
  const ico = await pngToIco(icoPngs);
  fs.writeFileSync(OUT_ICO, ico);

  // ICNS (macOS) — png2icons.createICNS aceita um buffer PNG e gera todas as
  // variantes internas (16, 32, 64, 128, 256, 512, 1024 + @2x).
  // BICUBIC é o filtro de melhor qualidade; 0 = sem compressão (Apple aceita).
  const icns = png2icons.createICNS(png1024, png2icons.BICUBIC, 0);
  if (!icns) {
    console.error("Falha ao gerar .icns — png2icons retornou null");
    process.exit(1);
  }
  fs.writeFileSync(OUT_ICNS, icns);

  console.log(`✓ Gerado ${OUT_ICO} (${ICO_SIZES.join(", ")})`);
  console.log(`✓ Gerado ${OUT_ICNS}`);
  console.log(`✓ Gerado ${OUT_PNG_512}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
