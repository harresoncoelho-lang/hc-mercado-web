// Catálogo do sistema CRM: só devolve o que o token do usuário permite, recusa sem token e não aprovado.
// O REST fictício imita a RLS: cada token só enxerga linhas da própria organização.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handler, situacaoCertidao, diasDoPrazo, diaBrasilia } = require("../contextos-operacao");

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
      { id: PROC_A, empresa_id: EMP_A, organizacao_id: ORG_A, numero: "10/2026", objeto: "Papel A4", status: "triagem", data_sessao: "2026-12-01T13:00:00+00:00" },
      { id: PROC_A2, empresa_id: EMP_A2, organizacao_id: ORG_A, numero: null, objeto: "Toner", status: "preparacao", data_sessao: null },
      { id: PROC_B, empresa_id: EMP_B, organizacao_id: ORG_B, numero: "99/2026", objeto: "Segredo B", status: "triagem", data_sessao: null },
    ],
    operacao_documentos: [],
    operacao_prazos_processo: [],
    operacao_agenda: [],
  };
}

function filtrar(linhas, sp) {
  let r = linhas;
  for (const [k, v] of sp) {
    if (k === "select" || k === "order") continue;
    if (v.startsWith("eq.")) r = r.filter((l) => String(l[k]) === v.slice(3));
    else if (v.startsWith("neq.")) r = r.filter((l) => String(l[k]) !== v.slice(4));
    else if (v.startsWith("in.(")) { const lista = v.slice(4, -1).split(","); r = r.filter((l) => lista.includes(String(l[k]))); }
    else if (v === "is.null") r = r.filter((l) => l[k] === null || l[k] === undefined);
    // Faixas de data (gte/lt/lte) podem repetir a coluna: o laço recebe cada uma.
    else if (/^(gte|lt|lte)\./.test(v)) {
      const [op, valor] = [v.slice(0, v.indexOf(".")), v.slice(v.indexOf(".") + 1)];
      const d = (l) => Date.parse(l[k]) - Date.parse(valor);
      r = r.filter((l) => (op === "gte" ? d(l) >= 0 : op === "lt" ? d(l) < 0 : d(l) <= 0));
    }
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
  assert.deepEqual(corpo, { userId: U, empresas: [{ empresaId: EMP_A, razaoSocial: "A" }], contextos: [{ empresaId: EMP_A, processoId: PROC_A, numero: "10/2026", objeto: "Papel A4", status: "triagem", prazo: "2026-12-01T13:00:00+00:00" }], certidoes: [], prazos: [] });
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
  assert.deepEqual(JSON.parse((await handler(evento())).body), { userId: U, empresas: [], contextos: [], certidoes: [], prazos: [] });
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

test("processo arquivado não entra no catálogo, nem se a fonte ignorar o filtro", () => comFetch(async () => {
  const b = banco();
  b.operacao_membros[0].empresa_id = null;
  b.operacao_processos[1].status = "arquivado";
  const chamadas = instalarFetch(b);
  const corpo = JSON.parse((await handler(evento())).body);
  assert.deepEqual(corpo.contextos.map((c) => c.processoId), [PROC_A]);
  assert.ok(chamadas.some((c) => c.caminho === "/rest/v1/operacao_processos"));
  // Fonte que devolve o arquivado mesmo assim: o handler descarta de novo.
  const rls = global.fetch;
  global.fetch = async (url, op) => (new URL(url).pathname === "/rest/v1/operacao_processos" ? Response.json([{ ...b.operacao_processos[1] }]) : rls(url, op));
  assert.deepEqual(JSON.parse((await handler(evento())).body).contextos, []);
}));

test("campos de exibição são sempre string e com tamanho limitado", () => comFetch(async () => {
  const b = banco();
  Object.assign(b.operacao_processos[0], { numero: 123, objeto: "x".repeat(900), status: { a: 1 }, data_sessao: undefined });
  instalarFetch(b);
  const [c] = JSON.parse((await handler(evento())).body).contextos;
  assert.deepEqual({ ...c, objeto: c.objeto.length }, { empresaId: EMP_A, processoId: PROC_A, numero: "", objeto: 500, status: "", prazo: "" });
}));

// ---- Certidões vencendo e próximos prazos ----
// 18/11/2026 às 23:30 em Brasília (02:30 UTC do dia 19): o "hoje" é o dia 18 de Brasília, não o do UTC.
const AGORA = Date.parse("2026-11-18T23:30:00-03:00");
const HOJE = diaBrasilia(AGORA);
const DOC = (n) => `dddddddd-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function comRelogio(fn) {
  const anterior = Date.now;
  Date.now = () => AGORA;
  try { return await comFetch(fn); } finally { Date.now = anterior; }
}

test("certidão: vencida, até 30 dias e mais de 30 dias, pelo dia de Brasília", () => {
  assert.deepEqual(situacaoCertidao("2026-11-17", HOJE), { dias: -1, situacao: "vencido" });
  assert.deepEqual(situacaoCertidao("2026-11-18", HOJE), { dias: 0, situacao: "vencendo" }, "vence hoje em Brasília, embora em UTC já seja dia 19");
  assert.deepEqual(situacaoCertidao("2026-12-18", HOJE), { dias: 30, situacao: "vencendo" });
  assert.equal(situacaoCertidao("2026-12-19", HOJE), null, "31 dias fica fora");
  for (const v of [null, undefined, "", "18/11/2026", "2026-11-18T10:00:00Z"]) assert.equal(situacaoCertidao(v, HOJE), null);
});

test("prazo: janela de hoje até 7 dias, contada pelo dia de Brasília", () => {
  assert.equal(diasDoPrazo("2026-11-18T03:00:00Z", HOJE), 0, "meia-noite de Brasília já é hoje");
  assert.equal(diasDoPrazo("2026-11-18T02:59:00Z", HOJE), null, "23h59 de ontem em Brasília fica fora");
  assert.equal(diasDoPrazo("2026-11-19T02:45:00Z", HOJE), 0, "02h45 UTC do dia 19 ainda é dia 18 em Brasília");
  assert.equal(diasDoPrazo("2026-11-25T10:00:00-03:00", HOJE), 7);
  assert.equal(diasDoPrazo("2026-11-26T03:00:00Z", HOJE), null, "dia 8 fica fora");
  assert.equal(diasDoPrazo("sem data", HOJE), null);
});

function bancoComAlertas() {
  const b = banco();
  b.operacao_membros[0].empresa_id = null; // organização A inteira
  b.operacao_documentos = [
    { id: DOC(1), empresa_id: EMP_A, organizacao_id: ORG_A, tipo: "CND Federal", titulo: null, vencimento: "2026-11-10" },
    { id: DOC(2), empresa_id: EMP_A2, organizacao_id: ORG_A, tipo: "FGTS", titulo: "CRF", vencimento: "2026-12-01" },
    { id: DOC(3), empresa_id: EMP_A, organizacao_id: ORG_A, tipo: "Trabalhista", titulo: null, vencimento: "2027-03-01" },
    { id: DOC(4), empresa_id: EMP_B, organizacao_id: ORG_B, tipo: "Segredo B", titulo: null, vencimento: "2026-11-20" },
  ];
  b.operacao_prazos_processo = [
    { id: DOC(10), organizacao_id: ORG_A, processo_id: PROC_A, categoria: "proposta", titulo: "Prazo de propostas", vencimento: "2026-11-20T13:00:00+00:00", concluido_em: null },
    { id: DOC(11), organizacao_id: ORG_A, processo_id: PROC_A, categoria: "sessao", titulo: "Concluído", vencimento: "2026-11-21T13:00:00+00:00", concluido_em: "2026-11-01T00:00:00+00:00" },
    { id: DOC(12), organizacao_id: ORG_A, processo_id: PROC_A, categoria: "recurso", titulo: "Longe", vencimento: "2026-12-30T13:00:00+00:00", concluido_em: null },
    { id: DOC(13), organizacao_id: ORG_B, processo_id: PROC_B, categoria: "proposta", titulo: "Segredo B", vencimento: "2026-11-20T13:00:00+00:00", concluido_em: null },
  ];
  b.operacao_agenda = [
    { id: DOC(20), organizacao_id: ORG_A, empresa_id: null, categoria: "renovacao", titulo: "Renovar alvará", vencimento: "2026-11-19T12:00:00+00:00", concluido_em: null },
    { id: DOC(21), organizacao_id: ORG_A, empresa_id: EMP_A2, categoria: "entrega", titulo: "Entrega A2", vencimento: "2026-11-22T12:00:00+00:00", concluido_em: null },
    { id: DOC(22), organizacao_id: ORG_B, empresa_id: EMP_B, categoria: "entrega", titulo: "Segredo B", vencimento: "2026-11-19T12:00:00+00:00", concluido_em: null },
  ];
  return b;
}

// Fonte que devolve a tabela inteira (ignora filtros e RLS) para as três tabelas novas.
function fonteSemFiltro(b, trocar = {}) {
  instalarFetch(b);
  const rls = global.fetch;
  global.fetch = async (url, op) => {
    const tabela = new URL(url).pathname.replace("/rest/v1/", "");
    if (trocar[tabela]) return trocar[tabela]();
    if (["operacao_documentos", "operacao_prazos_processo", "operacao_agenda"].includes(tabela)) return Response.json(b[tabela]);
    return rls(url, op);
  };
}

test("certidões e prazos: só da organização do usuário, na janela e em ordem de vencimento", () => comRelogio(async () => {
  instalarFetch(bancoComAlertas());
  const corpo = JSON.parse((await handler(evento())).body);
  assert.deepEqual(corpo.certidoes, [
    { empresaId: EMP_A, tipo: "CND Federal", titulo: "", vencimento: "2026-11-10", dias: -8, situacao: "vencido" },
    { empresaId: EMP_A2, tipo: "FGTS", titulo: "CRF", vencimento: "2026-12-01", dias: 13, situacao: "vencendo" },
  ]);
  assert.deepEqual(corpo.prazos.map((p) => [p.origem, p.titulo, p.dias, p.processoId]), [
    ["agenda", "Renovar alvará", 1, null],
    ["processo", "Prazo de propostas", 2, PROC_A],
    ["agenda", "Entrega A2", 4, null],
  ]);
  assert.equal(JSON.stringify(corpo).includes("Segredo B"), false);
}));

test("membro de uma empresa só vê certidões e prazos dela, nem a agenda geral da organização", () => comRelogio(async () => {
  const b = bancoComAlertas();
  b.operacao_membros[0].empresa_id = EMP_A2;
  instalarFetch(b);
  const corpo = JSON.parse((await handler(evento())).body);
  assert.deepEqual(corpo.certidoes.map((c) => c.empresaId), [EMP_A2]);
  assert.deepEqual(corpo.prazos.map((p) => p.titulo), ["Entrega A2"], "prazo do processo da empresa A e agenda sem empresa ficam fora");
}));

test("fonte que ignora filtros não vaza: outra organização, concluído ou fora da janela é descartado", () => comRelogio(async () => {
  fonteSemFiltro(bancoComAlertas());
  const corpo = JSON.parse((await handler(evento())).body);
  assert.equal(JSON.stringify(corpo).includes("Segredo B"), false);
  assert.equal(corpo.prazos.some((p) => p.titulo === "Concluído" || p.titulo === "Longe"), false);
  assert.equal(corpo.certidoes.some((c) => c.tipo === "Trabalhista"), false);
}));

test("bloco no limite de linhas ou com erro vira null; o catálogo continua", () => comRelogio(async () => {
  const b = bancoComAlertas();
  fonteSemFiltro(b, {
    operacao_documentos: () => Response.json(Array.from({ length: 1000 }, () => b.operacao_documentos[0])),
    operacao_agenda: () => new Response("{}", { status: 500 }),
  });
  const r = await handler(evento());
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Cache-Control"], "no-store");
  const corpo = JSON.parse(r.body);
  assert.equal(corpo.certidoes, null);
  assert.equal(corpo.prazos, null);
  assert.equal(corpo.contextos.length, 2);
}));

test("textos de certidão e prazo são string com tamanho limitado", () => comRelogio(async () => {
  const b = bancoComAlertas();
  Object.assign(b.operacao_documentos[0], { tipo: "x".repeat(500), titulo: { a: 1 } });
  Object.assign(b.operacao_agenda[0], { titulo: "y".repeat(900), categoria: 7 });
  instalarFetch(b);
  const corpo = JSON.parse((await handler(evento())).body);
  assert.equal(corpo.certidoes[0].tipo.length, 120);
  assert.equal(corpo.certidoes[0].titulo, "");
  assert.equal(corpo.prazos[0].titulo.length, 200);
  assert.equal(corpo.prazos[0].categoria, "");
}));
