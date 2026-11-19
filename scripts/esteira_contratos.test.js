const test = require("node:test");
const assert = require("node:assert/strict");
const { etapaResultado, etapaContrato } = require("./esteira_contratos");

const T = Date.parse("2026-11-19T12:00:00.000Z");
const ORG = "22222222-2222-4222-8222-222222222222", EMP = "11111111-1111-4111-8111-111111111111", PROC = "33333333-3333-4333-8333-333333333333";
const NOSSO = "03090004000104";
const json = (d, status = 200) => new Response(status === 204 ? null : JSON.stringify(d), { status });
const tarefa = (etapa, detalhe = {}) => ({ organizacao_id: ORG, empresa_id: EMP, processo_id: PROC, etapa, estado: "executando", tentativas: 0, detalhe });

function restFalso({ processo = {}, itens = [], ganhos = [], existentes = [], cnpj = NOSSO } = {}) {
  const db = { upserts: [], escritasEmItens: 0 };
  db.rest = async (caminho, opcoes = {}) => {
    const [tabela] = caminho.split("?");
    if (tabela === "operacao_processos") return json([{ id: PROC, empresa_id: EMP, organizacao_id: ORG, url_origem: null, origem_externa_id: "04378626000197-1-122/2025", numero: null, status: "triagem", data_sessao: "2025-12-09T10:00:00Z", ...processo }]);
    if (tabela === "operacao_empresas") return json([{ cnpj }]);
    if (tabela === "operacao_itens_resultado") { if (opcoes.method) db.escritasEmItens++; return json(caminho.includes("situacao=eq.ganho") ? ganhos : itens); }
    if (tabela === "operacao_contratos_publicos") { if (opcoes.method === "POST") { db.upserts.push(...JSON.parse(opcoes.body)); return json([]); } return json(existentes); }
    throw new Error(`rest inesperado: ${caminho}`);
  };
  return db;
}
const deps = (db, fetchPncp, extra = {}) => ({ rest: db.rest, fetchPncp, esperar: async () => {}, agora: () => T, prazoFinal: T + 600000, pausaMs: 0, ...extra });
const ITEM = (n) => ({ id: `i${n}`, tipo: "item", identificador: String(n), situacao: "pendente" });
const RES = (cnpj, nome, total) => [{ niFornecedor: cnpj, nomeRazaoSocialFornecedor: nome, valorUnitarioHomologado: 8, valorTotalHomologado: total, quantidadeHomologada: 1, situacaoCompraItemResultadoNome: "Informado" }];

test("resultado: sugere ganho e perda por item, sem gravar nada em operacao_itens_resultado", async () => {
  const db = restFalso({ itens: [ITEM(1), ITEM(2)] });
  const f = async (url) => {
    if (url.includes("/consulta/v1/")) return json({ existeResultado: true, dataAtualizacaoGlobal: "2026-01-13T15:12:08" });
    if (url.endsWith("/itens/1/resultados")) return json(RES(NOSSO, "BMS", 1000));
    if (url.endsWith("/itens/2/resultados")) return json(RES("11111111000191", "FULANO LTDA", 90));
    throw new Error(url);
  };
  const r = await etapaResultado(tarefa("resultado"), deps(db, f));
  assert.equal(r.estado, "pendente"); // continua conferindo até o usuário confirmar
  assert.equal(r.detalhe.situacao, "sugestao");
  assert.deepEqual(r.detalhe.sugestao.itens.map((i) => [i.numero, i.situacao, i.total]), [[1, "ganho", 1000], [2, "perdido", 90]]);
  assert.equal(db.escritasEmItens, 0);
});

test("resultado: antes da sessão espera; sem resultado publicado reagenda; sem pendência termina", async () => {
  let db = restFalso({ processo: { data_sessao: "2026-12-01T10:00:00Z" } });
  assert.equal((await etapaResultado(tarefa("resultado"), deps(db, async () => { throw new Error("não deveria buscar"); }))).detalhe.situacao, "aguardando_sessao");
  db = restFalso({ itens: [ITEM(1)], processo: { data_sessao: "2026-11-10T10:00:00Z" } });
  const r = await etapaResultado(tarefa("resultado"), deps(db, async () => json({ existeResultado: false })));
  assert.deepEqual([r.estado, r.detalhe.situacao], ["pendente", "sem_resultado_publicado"]);
  db = restFalso({ itens: [ITEM(1)] }); // sessão há mais de 120 dias sem resultado: desiste
  assert.equal((await etapaResultado(tarefa("resultado"), deps(db, async () => json({ existeResultado: false })))).estado, "feito");
  db = restFalso({ itens: [{ ...ITEM(1), situacao: "ganho" }] });
  assert.equal((await etapaResultado(tarefa("resultado"), deps(db, async () => { throw new Error("x"); }))).estado, "feito");
});

test("resultado: fonte fora do ar vira erro (a tarefa tenta de novo com backoff), não 'sem resultado'", async () => {
  const db = restFalso({ itens: [ITEM(1)] });
  await assert.rejects(etapaResultado(tarefa("resultado"), deps(db, async () => new Response("", { status: 503 }))), /Fonte indisponível/);
});

test("resultado: sugestão já feita e compra sem mudança não repete as chamadas por item", async () => {
  const db = restFalso({ itens: [ITEM(1)] });
  const antes = { situacao: "sugestao", compraAtualizadaEm: "X", sugestao: { itens: [{ numero: 1, situacao: "ganho" }] } };
  const f = async (url) => { if (url.includes("/consulta/v1/")) return json({ existeResultado: true, dataAtualizacaoGlobal: "X" }); throw new Error(`chamou ${url}`); };
  const r = await etapaResultado(tarefa("resultado", antes), deps(db, f));
  assert.deepEqual(r.detalhe.sugestao, antes.sugestao);
});

const CONTRATO_PNCP = { anoContrato: 2026, sequencialContrato: 1, numeroContratoEmpenho: "00001", numeroControlePNCP: "04378626000197-2-000001/2026", tipoContrato: { id: 1, nome: "Contrato (termo inicial)" },
  niFornecedor: NOSSO, nomeRazaoSocialFornecedor: "BMS", dataVigenciaFim: "2027-01-30", valorGlobal: 100, orgaoEntidade: { esferaId: "F" }, unidadeOrgao: { codigoUnidade: "154039" } };

test("contrato: sem vitória espera; com vitória grava só o contrato do nosso CNPJ (PNCP + Contratos.gov) e repete amanhã", async () => {
  let db = restFalso();
  assert.equal((await etapaContrato(tarefa("contrato"), deps(db, async () => { throw new Error("x"); }))).detalhe.situacao, "aguardando_vitoria");
  db = restFalso({ ganhos: [{ id: "i1" }] });
  const chamadas = [];
  const f = async (url) => {
    chamadas.push(url);
    if (url.includes("/contratos/contratacao/")) return json({ data: [CONTRATO_PNCP, { ...CONTRATO_PNCP, niFornecedor: "99999999000199", sequencialContrato: 2 }], paginasRestantes: 0 });
    if (url.endsWith("/termos") || url.includes("/empenhos?pagina")) return json(null, 204);
    if (url.endsWith("/api/contrato/ug/154039")) return json([{ id: 797807, numero: "00001/2026", fornecedor: { cnpj_cpf_idgener: "03.090.004/0001-04" } }, { id: 1, numero: "00001/2026", fornecedor: { cnpj_cpf_idgener: "99.999.999/0001-99" } }]);
    if (url.endsWith("/797807/empenhos")) return json([{ numero: "2026NE1", empenhado: "100,00", liquidado: "100,00", pago: "0,00" }]);
    if (url.endsWith("/797807/historico")) return json([]);
    if (url.endsWith("/797807/faturas")) return json([{ numero: "1", data_liquidacao: "2026-09-01", valorliquido: "100,00", nota_cancelada: "Não" }]);
    throw new Error(`inesperado ${url}`);
  };
  const r = await etapaContrato(tarefa("contrato"), deps(db, f));
  assert.deepEqual([r.estado, r.detalhe.situacao, r.detalhe.contratos], ["pendente", "encontrado", 1]);
  assert.equal(db.upserts.length, 1);
  const l = db.upserts[0];
  assert.deepEqual([l.processo_id, l.fornecedor_cnpj, l.contratos_gov_id, l.valor_pago, l.a_pagar, l.liquidado_sem_pagamento_desde], [PROC, NOSSO, 797807, 0, 100, "2026-09-01"]);
  assert.ok(!chamadas.some((u) => u.includes("/2/")), "contrato de outro fornecedor não é consultado");
});

test("contrato: id do Contratos.gov já conhecido evita baixar a lista da UASG; órgão não federal fica só no PNCP", async () => {
  const db = restFalso({ ganhos: [{ id: "i1" }], existentes: [{ chave: CONTRATO_PNCP.numeroControlePNCP, contratos_gov_id: 797807 }] });
  const f = async (url) => {
    if (url.includes("/contratos/contratacao/")) return json({ data: [CONTRATO_PNCP], paginasRestantes: 0 });
    if (url.endsWith("/termos") || url.includes("/empenhos?pagina")) return json(null, 204);
    if (url.endsWith("/id/797807")) return json({ id: 797807, numero: "00001/2026", valor_global: "100,00" });
    if (/\/797807\/(empenhos|historico|faturas)$/.test(url)) return json([]);
    throw new Error(`inesperado ${url}`);
  };
  await etapaContrato(tarefa("contrato"), deps(db, f));
  assert.equal(db.upserts[0].contratos_gov_id, 797807);
  const estadual = restFalso({ ganhos: [{ id: "i1" }] });
  await etapaContrato(tarefa("contrato"), deps(estadual, async (url) => {
    if (url.includes("/contratos/contratacao/")) return json({ data: [{ ...CONTRATO_PNCP, orgaoEntidade: { esferaId: "E" } }], paginasRestantes: 0 });
    if (url.endsWith("/termos") || url.includes("/empenhos?pagina")) return json(null, 204);
    throw new Error(`não deveria chamar ${url}`);
  }));
  assert.equal(estadual.upserts[0].contratos_gov_id, null);
});

test("contrato: vigência encerrada há mais de 30 dias e nada a pagar encerra a etapa", async () => {
  const db = restFalso({ ganhos: [{ id: "i1" }] });
  const velho = { ...CONTRATO_PNCP, dataVigenciaFim: "2026-01-01", orgaoEntidade: { esferaId: "E" } };
  const r = await etapaContrato(tarefa("contrato"), deps(db, async (url) => (url.includes("/contratos/contratacao/") ? json({ data: [velho], paginasRestantes: 0 }) : json(null, 204))));
  assert.equal(r.estado, "feito");
});
