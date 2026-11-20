// "Enviar diagnóstico" da extensão (extensao-leitura/diagnostico.mjs): quando um fluxo não reconhece a página do
// portal, o usuário manda só a estrutura dela (tags, classes, ids, data-test, rótulos) para a equipe ajustar.
//   POST {versao:1, fluxo, motivo, extensao, pagina{host,caminho,compra,titulo,largura,carregando}, seletores{}, nos[], cortado}
//     -> {ok, id}
// Login e cadastro aprovado obrigatórios; cota diária baixa (é para exceção, não telemetria).
// O servidor não confia na extensão: refaz a allowlist de chaves (nada de "value"), corta tamanhos, mascara CPF
// com _cpf.js e qualquer sequência longa de dígitos; o CHECK da tabela (supabase/extensao_diagnosticos.sql) é a 2ª trava.
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require("./_auth");
const { semCpf, temCpf } = require("./_cpf");

const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";
const LIMITE_DIARIO = 20;
const MAX_CORPO = 1_500_000;
const MAX_NOS = 4000;
const MAX_SELETORES = 60;
const FLUXOS = new Set(["gravar", "preencher", "acompanhar"]);
const HOSTS = new Set(["cnetmobile.estaleiro.serpro.gov.br", "comprasnet.gov.br", "www.comprasnet.gov.br"]);
const ATRIBUTOS = new Set(["data-test", "role", "type", "name", "for", "aria-label", "placeholder", "title", "maxlength", "formcontrolname"]);

// Texto curto, sem CPF e sem dígito em sequência (CNPJ, telefone, processo).
const curto = (v, max = 60) => (typeof v === "string" ? semCpf(v, "#").replace(/\d[\d.\-/\s]{4,}\d/g, "#").replace(/\d{5,}/g, "#").replace(/\s+/g, " ").trim().slice(0, max) : null);
const identificador = (v) => (typeof v === "string" && /^[a-z][a-z0-9-]{0,40}$/.test(v) ? v : null);

function validarDiagnostico(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return { erro: "Pedido inválido." };
  if (d.versao !== 1) return { erro: "versao deve ser 1." };
  if (!FLUXOS.has(d.fluxo)) return { erro: "fluxo inválido." };
  const p = d.pagina && typeof d.pagina === "object" ? d.pagina : {};
  if (!HOSTS.has(p.host)) return { erro: "Só páginas do Compras.gov ou do ComprasNet." };
  if (typeof p.caminho !== "string" || !p.caminho.startsWith("/") || p.caminho.length > 300) return { erro: "caminho inválido." };
  if (!Array.isArray(d.nos) || !d.nos.length || d.nos.length > MAX_NOS) return { erro: `nos deve ter de 1 a ${MAX_NOS} elementos.` };
  const nos = [];
  for (const n of d.nos) {
    const t = identificador(n?.t);
    if (!t) return { erro: "Elemento sem tag válida." };
    const no = { t, p: Number.isInteger(n.p) && n.p >= 0 && n.p <= 60 ? n.p : 0 };
    if (n.id) no.id = curto(n.id);
    if (Array.isArray(n.c)) no.c = n.c.slice(0, 8).map((c) => curto(c, 60)).filter(Boolean);
    if (n.a && typeof n.a === "object") {
      const a = Object.fromEntries(Object.entries(n.a).filter(([k]) => ATRIBUTOS.has(k)).map(([k, v]) => [k, curto(v)]).filter(([, v]) => v));
      if (Object.keys(a).length) no.a = a;
    }
    if (typeof n.src === "string") no.src = curto(n.src, 120);
    if (typeof n.href === "string") no.href = curto(n.href, 200);
    if (typeof n.preenchido === "boolean") no.preenchido = n.preenchido;
    if (n.tx) no.tx = curto(n.tx);
    if (n.cortado === true) no.cortado = true;
    nos.push(no);
  }
  const seletores = Object.fromEntries(Object.entries(d.seletores && typeof d.seletores === "object" ? d.seletores : {}).slice(0, MAX_SELETORES)
    .filter(([k, v]) => typeof k === "string" && k.length <= 120 && Number.isInteger(v) && v >= -1 && v < 1e6).map(([k, v]) => [curto(k, 120), v]));
  const estrutura = {
    pagina: { compra: typeof p.compra === "string" && /^\d{17}$/.test(p.compra) ? p.compra : null, titulo: curto(p.titulo),
      largura: Number.isInteger(p.largura) && p.largura > 0 && p.largura < 20000 ? p.largura : null, carregando: p.carregando === true },
    seletores, nos, cortado: d.cortado === true,
  };
  // Código da compra (17 dígitos) é público e útil; nada mais pode parecer CPF depois da limpeza.
  if (temCpf(JSON.stringify({ ...estrutura, pagina: { ...estrutura.pagina, compra: null } }))) return { erro: "Diagnóstico recusado: parece conter CPF." };
  return { dados: { fluxo: d.fluxo, motivo: curto(d.motivo, 40), versao_extensao: typeof d.extensao === "string" && /^\d{1,3}(\.\d{1,3}){0,3}$/.test(d.extensao) ? d.extensao : null,
    host: p.host, caminho: curto(p.caminho, 300) || "/", estrutura } };
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), "Cache-Control": "no-store" };
  const responder = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === "OPTIONS") return responder(204, {});
  if (event.httpMethod !== "POST") return responder(405, { erro: "Método não permitido." });
  const auth = await exigirUsuarioAprovado(event);
  if (!auth.ok) return responder(auth.status, { erro: auth.erro });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return responder(503, { erro: "Diagnóstico indisponível neste ambiente." });
  if (String(event.body || "").length > MAX_CORPO) return responder(413, { erro: "Página grande demais para o diagnóstico." });
  let corpo;
  try { corpo = JSON.parse(event.body || ""); } catch { return responder(400, { erro: "JSON inválido." }); }
  const v = validarDiagnostico(corpo);
  if (v.erro) return responder(400, { erro: v.erro });
  const limite = await verificarLimiteDiario(auth.userId, "extensao-diagnostico", LIMITE_DIARIO);
  if (!limite.ok) return responder(limite.status, { erro: limite.erro });
  try {
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/extensao_diagnosticos?select=id`, { method: "POST", signal: globalThis.AbortSignal.timeout(15000),
      headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ ...v.dados, enviado_por: auth.userId }) });
    if (!r.ok) throw new Error(`Supabase extensao_diagnosticos HTTP ${r.status}`);
    const [linha] = await r.json();
    return responder(200, { ok: true, id: linha?.id ?? null });
  } catch (e) {
    console.error("extensao-diagnostico:", e.message);
    return responder(502, { erro: "Não foi possível guardar o diagnóstico agora. Tente novamente." });
  }
};

exports.validarDiagnostico = validarDiagnostico;
