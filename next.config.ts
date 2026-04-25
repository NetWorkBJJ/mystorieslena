import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build standalone para empacotamento Electron — copia apenas as dependências
  // necessárias dentro de .next/standalone/, gerando um servidor mínimo que
  // roda com `node server.js` (sem precisar do Next CLI no destino).
  output: "standalone",
};

export default nextConfig;
