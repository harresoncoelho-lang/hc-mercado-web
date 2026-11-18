// Catálogo do sistema CRM: só devolve o que o token do usuário permite, recusa sem token e não aprovado.
// O REST fictício imita a RLS: cada token só enxerga linhas da própria organização.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler } = require("../contextos-operacao");

const U = "11111111-1111-4111-8111-111111111111";
const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001", ORG_B = "bbbbbbbb-0000-4000-8000-000000000001";
const EMP_A = "aaaaaaaa-0000-4000-8000-000000000002", EMP_A2 = "aaaaaaaa-0000-4000-8000-000000000003";
const EMP_B = "bbbbbbbb-0000-4000-8000-000000000002";
const PROC_A = "aaaaaaaa-0000-4000-8000-000000000004", PROC_A2 = "aaaaaaaa-0000-4000-8000-000000000005";
const PROC_B = "bbbbbbbb-0000-4000-8000-000000000004";

function banco() {
  return {
    clientes: [{ id: U, status: "aprovado" }],
    operacao_membros: [{ usuario_id: U, organizacao_id: ORG_A, empresa_id: EMP_A, papel: "operador" }],
    operacao_empresas: [
      { id: EMP_A, organizacao_id: ORG_A, razao_social: "A", ativo: true },
      { id: EMP_A2, organizacao_id: ORG_A, razao_social: "A2", ativo: true },
      { id: EMP_B, organizacao_id: ORG_B, razao_social: "B", ativo: true },
    ],
    operacao_processos: [
      { id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A },
      { id: PROC_A2, empresa_id: EMP_A2, organizacao_id: ORG_A },
      { id: PROC_B, empresa_id: EMP_B, organizacao_id: ORG_B },
    ],
  };
}

function filtrar(linhas, sp) {
  let r = linhas;
  for (const [k, v] of sp) {
    if (k === "select" || k === "order") continue;
    if (v.startsWith("eq.")) r = r.filter((l) => String(l[k]) === v.slice(3));
    else if (v.startsWith("in.(")) { const lista = v.slice(4, -1).split(","); r = r.filter((l) => lista.includes(String(l[k]))); }
  }
  return r;
}

// RLS fictícia: org do usuário via membros; cada tabela só mostra linhas dessa org.
function instalarFetch(b, { linhas } = {}) {
  const chamadas = [];
  global.fetch = async (url, op = {}) => {
    const u = new URL(url), h = op.headers || {};
    chamadas.push({ caminho: u.pathname, auth: h.Authorization, apikey: h.apikey });
    if (u.pathname === "/auth/v1/user") return h.Authorization === "Bearer TOKEN-U" ? Response.json({ id: U }) : new Response("{}", { status: 401 });
    if (h.Authorization !== "Bearer TOKEN-U") return new Response("[]", { status: 401 });
    const tabela = u.pathname.replace("/rest/v1/", "");
    const orgs = b.operacao_membros.filter((m) => m.usuario_id === U).map((m) => m.organizacao_id);
    const visiveis = tabela === "clientes" ? b.clientes.filter((c) => c.id === U)
      : tabela === "operacao_membros" ? b.operacao_membros.filter((m) => m.usuario_id === U)
      : b[tabela].filter((l) => orgs.includes(l.organizacao_id));
    if (linhas && tabela === "operacao_processos") return Response.json(Array.from({ length: linhas }, () => b.operacao_processos[0]));
    return Response.json(filtrar(visiveis, u.searchParams));
  };
  return chamadas;
}

const evento = (headers = { authorization: "Bearer TOKEN-U" }, httpMethod = "GET") => ({ httpMethod, headers });

async function comFetch(fn) {
  const anterior = global.fetch;
  try { return await fn(); } finally { global.fetch = anterior; }
}

test("devolve só a empresa do vínculo e seus processos, lendo com o token do usuário", () => comFetch(async () => {
  const chamadas = instalarFetch(banco());
  const r = await handler(evento());
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Cache-Control"], "no-store");
  const corpo = JSON.parse(r.body);
  assert.deepEqual(corpo, { userId: U, empresas: [{ empresaId: EMP_A, razaoSocial: "A" }], contextos: [{ empresaId: EMP_A, processoId: PROC_A }] });
  for (const c of chamadas.filter((x) => x.caminho.startsWith("/rest/"))) {
    assert.equal(c.auth, "Bearer TOKEN-U");
    assert.match(c.apikey, /^sb_publishable_/);
  }
}));

test("membro da organização inteira vê todas as empresas dela, nunca a de outra organização", () => comFetch(async () => {
  const b = banco();
  b.operacao_membros[0].empresa_id = null;
  instalarFetch(b);
  const corpo = JSON.parse((await handler(evento())).body);
  assert.deepEqual(corpo.empresas.map((e) => e.empresaId).sort(), [EMP_A, EMP_A2].sort());
  assert.deepEqual(corpo.contextos.map((c) => c.processoId).sort(), [PROC_A, PROC_A2].sort());
}));

test("papel leitura ou sem vínculo: lista vazia", () => comFetch(async () => {
  const b = banco();
  b.operacao_membros[0].papel = "leitura";
  instalarFetch(b);
  assert.deepEqual(JSON.parse((await handler(evento())).body), { userId: U, empresas: [], contextos: [] });
}));

test("sem token recusa com 401 antes de ler o banco; token inválido também", () => comFetch(async () => {
  const chamadas = instalarFetch(banco());
  assert.equal((await handler(evento({}))).statusCode, 401);
  assert.equal(chamadas.length, 0);
  assert.equal((await handler(evento({ authorization: "Bearer OUTRO" }))).statusCode, 401);
  assert.equal(chamadas.some((c) => c.caminho.startsWith("/rest/")), false);
}));

test("cadastro não aprovado recebe 403 sem catálogo", () => comFetch(async () => {
  const b = banco();
  b.clientes[0].status = "pendente";
  const chamadas = instalarFetch(b);
  const r = await handler(evento());
  assert.equal(r.statusCode, 403);
  assert.equal(chamadas.some((c) => c.caminho.includes("operacao_")), false);
}));

test("fonte no limite de linhas falha fechado (503), sem lista truncada; método errado é 405", () => comFetch(async () => {
  instalarFetch(banco(), { linhas: 1000 });
  const r = await handler(evento());
  assert.equal(r.statusCode, 503);
  assert.equal(JSON.parse(r.body).contextos, undefined);
  assert.equal((await handler(evento(undefined, "POST"))).statusCode, 405);
}));
