// Hook de afterPack do electron-builder.
//
// Como o app não tem certificado pago da Apple Developer, o electron-builder
// ficava enviando o .app COMPLETAMENTE sem assinatura — o que faz o macOS
// Sonoma+ falhar com "está danificado" mesmo após `xattr -cr`. A solução é
// re-assinar com identidade ad-hoc ("-"), que gera o `_CodeSignature` interno
// válido (caderno de hashes), sem precisar de cert real.
//
// IMPORTANTE — por que afterPack e não afterSign:
// Quando CSC_IDENTITY_AUTO_DISCOVERY=false, o electron-builder pula o passo
// de signing inteiro, e o hook afterSign NUNCA dispara. afterPack roda sempre
// depois que o .app é montado, então é o gancho certo pra ad-hoc sign manual
// quando não há certificado pago.
//
// Resultado: o usuário final só precisa rodar `xattr -cr` uma vez (pra remover
// a quarentena do navegador). A assinatura interna vai estar OK e a mensagem
// muda de "está danificado" (bloqueia) pra "desenvolvedor não verificado"
// (permite clique-direito → Abrir).

const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[mac-adhoc-sign] Re-assinando ad-hoc: ${appPath}`);
  // Sem --options runtime (hardened runtime exige notarização Apple, que
  // requer certificado pago). Ad-hoc puro basta pra macOS aceitar o app
  // depois que o usuário faz `xattr -cr` pra remover a quarentena.
  execSync(`codesign --force --deep --sign - "${appPath}"`, {
    stdio: "inherit",
  });

  try {
    const out = execSync(`codesign -dv --verbose=2 "${appPath}" 2>&1`, {
      encoding: "utf8",
    });
    console.log(`[mac-adhoc-sign] Verificação:\n${out}`);
  } catch (err) {
    console.warn(
      `[mac-adhoc-sign] Verificação falhou (não-fatal): ${err.message}`,
    );
  }
};
