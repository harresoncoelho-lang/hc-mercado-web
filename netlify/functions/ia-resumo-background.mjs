import { getStore } from "@netlify/blobs";
import "openai";
import "js-tiktoken/lite";
import "js-tiktoken/ranks/o200k_base";
import auth from "./_auth.js";
import gateway from "./_resumo_gateway.js";

export const config = { background: true };

export default async (request) => {
  if (request.method !== "POST") return;
  // O robô de dossiês não tem sessão de navegador; a chave só vale se estiver configurada.
  const chaveRobo = process.env.DOSSIES_EDITAIS_CHAVE;
  const ehRobo = Boolean(chaveRobo && request.headers.get("x-licitaplena-dossies-chave") === chaveRobo);
  const sessao = ehRobo ? { ok: true, userId: gateway.USUARIO_ROBO }
    : await auth.exigirUsuarioLogado({ headers: { authorization: request.headers.get("authorization") || "" } });
  if (!sessao.ok) return;
  let corpo;
  try { corpo = await request.json(); } catch { return; }
  await gateway.executarResumo({ store: getStore({ name: "resumos-editais", consistency: "strong" }), chave: corpo?.chave, usuario: sessao.userId });
};
