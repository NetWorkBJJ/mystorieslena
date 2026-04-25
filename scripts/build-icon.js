/**
 * Gera o icon.ico do MyStoriesLena a partir do SVG temático em
 * electron/icons/source.svg.
 *
 * Pipeline: SVG -> PNG (vários tamanhos via sharp) -> ICO (via png-to-ico).
 * Roda com `npm run icon:build`.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const pngToIco = require("png-to-ico");

const SRC = path.join(__dirname, "..", "electron", "icons", "source.svg");
const OUT_DIR = path.join(__dirname, "..", "electron", "icons");
const OUT_ICO = path.join(OUT_DIR, "icon.ico");
const OUT_PNG_512 = path.join(OUT_DIR, "icon.png");

// Tamanhos padrão recomendados pra .ico no Windows (NSIS / shell).
const SIZES = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`Source SVG não encontrado em ${SRC}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(SRC);
  const pngBuffers = [];

  for (const size of SIZES) {
    const buf = await sharp(svg)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    pngBuffers.push(buf);
  }

  // PNG 512x512 também — útil pra Linux/.AppImage e como fallback do banner.
  const png512 = await sharp(svg).resize(512, 512).png().toBuffer();
  fs.writeFileSync(OUT_PNG_512, png512);

  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(OUT_ICO, ico);

  console.log(`✓ Gerado ${OUT_ICO} (${SIZES.join(", ")})`);
  console.log(`✓ Gerado ${OUT_PNG_512}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
