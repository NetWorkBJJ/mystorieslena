/**
 * Endpoint de health-check usado pelo Electron durante o boot — o main process
 * faz polling até receber 200 OK pra esconder a tela de carregamento e mostrar
 * a janela principal.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, ts: Date.now() });
}
