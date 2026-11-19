const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("./contrato-publico.js");

const NOSSO = "03090004000104";
const res = (extra) => ({ niFornecedor: NOSSO, nomeRazaoSocialFornecedor: "BMS", valorUnitarioHomologado: 8, valorTotalHomologado: 1125544, quantidadeHomologada: 140693,
  ordemClassificacaoSrp: null, situacaoCompraItemResultadoNome: "Informado", dataCancelamento: null, motivoCancelamento: null, ...extra });

test("resultado: ganho quando o nosso CNPJ é o primeiro resultado ativo", () => {
  const r = cp.classificarItem([res()], "03.090.004/0001-04");
  assert.deepEqual([r.situacao, r.unitario, r.total], ["ganho", 8, 1125544]);
});

test("resultado: perdeu para outro fornecedor, com nome e valor", () => {
  const r = cp.classificarItem([res({ niFornecedor: "11111111000191", nomeRazaoSocialFornecedor: "FULANO LTDA", valorTotalHomologado: 90 })], NOSSO);
  assert.deepEqual([r.situacao, r.fornecedor.nome, r.total, r.motivo], ["perdido", "FULANO LTDA", 90, "Perdeu para FULANO LTDA"]);
});

test("resultado: cadastro de reserva (ordem 2) não é vitória; resultado nosso cancelado vira 'cancelado' com motivo", () => {
  const reserva = cp.classificarItem([res({ niFornecedor: "11111111000191", nomeRazaoSocialFornecedor: "X" }), res({ ordemClassificacaoSrp: 2 })].map((r, i) => (i === 0 ? { ...r, ordemClassificacaoSrp: 1 } : r)), NOSSO);
  assert.equal(reserva.situacao, "perdido");
  assert.match(reserva.motivo, /ordem 2.*venceu X/);
  const cancelado = cp.classificarItem([res({ situacaoCompraItemResultadoNome: "Cancelado", motivoCancelamento: "Não assinou a ata" })], NOSSO);
  assert.deepEqual([cancelado.situacao, /Não assinou a ata/.test(cancelado.motivo)], ["cancelado", true]);
});

test("resultado: sem resultado só vira sugestão se o item for fracassado/deserto; senão fica pendente (null)", () => {
  assert.equal(cp.classificarItem(null, NOSSO, "Homologado"), null);
  assert.equal(cp.classificarItem([], NOSSO, "Em andamento"), null);
  assert.equal(cp.classificarItem(null, NOSSO, "Fracassado").situacao, "cancelado");
});

test("sugestão: só vale para item que o CRM ainda tem pendente; texto resume ganhos e perdas", () => {
  const sug = { itens: [{ numero: 1, situacao: "ganho", total: 1000 }, { numero: 2, situacao: "perdido", total: 90, fornecedor: { nome: "FULANO" } }, { numero: 3, situacao: "ganho", total: 500 }] };
  const crm = [{ tipo: "item", identificador: "1", situacao: "pendente" }, { tipo: "item", identificador: "2", situacao: "pendente" }, { tipo: "item", identificador: "3", situacao: "ganho" }];
  const itens = cp.itensAindaPendentes(sug, crm);
  assert.deepEqual(itens.map((i) => i.numero), [1, 2]);
  assert.equal(cp.textoSugestao(itens, (v) => `R$ ${v}`), "Você ganhou o item 1 (R$ 1000) / perdeu o item 2 para FULANO (R$ 90)");
  assert.deepEqual(cp.itensAindaPendentes(sug, []), []);
  assert.deepEqual(cp.dadosDoItem({ situacao: "perdido", motivo: "m", unitario: 5, total: 5 }, "u"), { situacao: "perdido", motivo: "m", fonte_oficial: "u", valor_unitario_homologado: null, valor_homologado: null });
});

test("numero: formato brasileiro, vazio e lixo nunca viram zero", () => {
  assert.equal(cp.numero("1.078.599,60"), 1078599.6);
  assert.equal(cp.numero("-151.836,55"), -151836.55);
  assert.equal(cp.numero(""), null);
  assert.equal(cp.numero(null), null);
  assert.equal(cp.numero("abc"), null);
});

test("pagamento: pago quita as faturas liquidadas da mais antiga para a mais nova; pago a mais não alerta", () => {
  const f = [{ data_liquidacao: "2026-05-01", valor: 100 }, { data_liquidacao: "2026-03-01", valor: 50 }, { data_liquidacao: "2026-07-01", valor: 70 }, { data_liquidacao: null, valor: 999 }, { data_liquidacao: "2026-01-01", valor: 40, cancelada: true }];
  assert.deepEqual(cp.liquidadoSemPagamento(f, 50), { desde: "2026-05-01", aPagar: 170 });
  assert.deepEqual(cp.liquidadoSemPagamento(f, 80), { desde: "2026-05-01", aPagar: 140 });
  assert.deepEqual(cp.liquidadoSemPagamento(f, 220), { desde: null, aPagar: 0 });
  assert.deepEqual(cp.liquidadoSemPagamento(f, 9999), { desde: null, aPagar: 0 });
});

// Contrato real: UFAM 00001/2026 (compra 90022/2025), PNCP 04378626000197-2-000001/2026 + Contratos.gov id 797807 (valores recortados).
const PNCP = { numeroControlePNCP: "04378626000197-2-000001/2026", numeroContratoEmpenho: "00001", anoContrato: 2026, tipoContrato: { id: 1, nome: "Contrato (termo inicial)" },
  niFornecedor: NOSSO, nomeRazaoSocialFornecedor: "BMS COMERCIO DE PRODUTOS ALIMENTICIOS LTDA", dataVigenciaInicio: "2026-01-30", dataVigenciaFim: "2027-01-30", valorGlobal: 10379826.5 };
const GOV = { contrato: { id: 797807, numero: "00001/2026", vigencia_fim: "2027-01-30", valor_global: "10.379.826,50", fornecedor: { cnpj_cpf_idgener: "03.090.004/0001-04" } },
  empenhos: [{ numero: "2026NE000075", data_emissao: "2026-01-26", empenhado: "1.013.000,00", liquidado: "-151.836,55", pago: "1.412.691,60" }, { numero: "2026NE000300", empenhado: "1.845,00", liquidado: "0,00", pago: "0,00" }],
  historico: [{ numero: "00001/2026", tipo: "Contrato", vigencia_fim: "2027-01-30" }, { numero: "00001/2027", tipo: "Termo Aditivo", data_assinatura: "2027-01-10", vigencia_fim: "2028-01-30", valor_global: "10.379.826,50", novo_valor_global: "11.000.000,00" }],
  faturas: [{ numero: "1833", emissao: "2026-03-03", vencimento: "2026-03-17", data_liquidacao: "2026-03-27", valorliquido: "109.369,55", nota_cancelada: "Não" }] };

test("linha do contrato: junta PNCP e Contratos.gov; vigência vem do último aditivo; ausente fica null", () => {
  const l = cp.montarLinha({ pncp: PNCP, termos: null, empenhosPncp: [], gov: GOV });
  assert.deepEqual([l.chave, l.tipo, l.numero, l.fornecedor_cnpj, l.vigencia_fim, l.valor_global, l.contratos_gov_id],
    ["04378626000197-2-000001/2026", "contrato", "00001/2026", NOSSO, "2028-01-30", 10379826.5, 797807]);
  assert.deepEqual([l.valor_empenhado, l.valor_liquidado, l.valor_pago], [1014845, -151836.55, 1412691.6]);
  assert.equal(l.aditivos.length, 1); // só o termo aditivo; o "Contrato" do histórico não é aditivo
  assert.equal(l.a_pagar, null); // pago (1,4 mi) cobre a única fatura liquidada: sem alerta, mesmo com liquidado negativo
  assert.equal(l.fontes.pncp, "https://pncp.gov.br/app/contratos/04378626000197/2026/1");
  const soPncp = cp.montarLinha({ pncp: PNCP, termos: null, empenhosPncp: [], gov: null });
  assert.deepEqual([soPncp.valor_empenhado, soPncp.valor_pago, soPncp.a_pagar, soPncp.contratos_gov_id], [null, null, null, null]);
});

test("situação: faixas 90/60/30 de vencimento, saldo sem empenho e pagamento atrasado só acima de 30 dias", () => {
  const base = { vigencia_fim: "2027-01-30", valor_global: 1000, valor_empenhado: 400 };
  const hoje = "2026-11-18";
  assert.deepEqual(cp.situacaoContrato(base, hoje).vigencia, { fim: "2027-01-30", dias: 73, nivel: 90 });
  assert.equal(cp.situacaoContrato({ ...base, vigencia_fim: "2026-12-30" }, hoje).vigencia.nivel, 60);
  assert.equal(cp.situacaoContrato({ ...base, vigencia_fim: "2026-12-18" }, hoje).vigencia.nivel, 30);
  assert.equal(cp.situacaoContrato({ ...base, vigencia_fim: "2026-11-17" }, hoje).vigencia.nivel, "vencida");
  assert.equal(cp.situacaoContrato({ ...base, vigencia_fim: "2027-06-01" }, hoje).vigencia.nivel, null);
  assert.equal(cp.situacaoContrato(base, hoje).saldoSemEmpenho, 600);
  assert.equal(cp.situacaoContrato({ ...base, valor_empenhado: 5000 }, hoje).saldoSemEmpenho, 0);
  assert.equal(cp.situacaoContrato({ vigencia_fim: null }, hoje).saldoSemEmpenho, null);
  const pag = (desde) => cp.situacaoContrato({ ...base, a_pagar: 10, liquidado_sem_pagamento_desde: desde }, hoje).pagamento;
  assert.equal(pag("2026-10-19").atrasado, false); // exatamente 30 dias: ainda não
  assert.equal(pag("2026-10-18").atrasado, true);
  assert.equal(pag(null).atrasado, false); // data da liquidação não publicada: informa, não alerta
});

test("alertas do Hoje: empenho não tem alerta de vencimento; pagamento atrasado vale para qualquer tipo", () => {
  const c = { tipo: "empenho", vigencia_fim: "2026-12-01", a_pagar: 10, liquidado_sem_pagamento_desde: "2026-09-01" };
  assert.deepEqual(cp.alertasDoContrato(c, "2026-11-18").map((a) => a.tipo), ["pagamento"]);
  assert.deepEqual(cp.alertasDoContrato({ ...c, tipo: "contrato", a_pagar: null }, "2026-11-18").map((a) => [a.tipo, a.nivel]), [["vencimento", 30]]);
});

test("quadro Contrato: escapa texto externo e mostra os dois alertas", () => {
  const esc = (v) => String(v).replace(/</g, "&lt;");
  const l = { ...cp.montarLinha({ pncp: PNCP, termos: null, empenhosPncp: [], gov: GOV }), objeto: "<script>x</script>", vigencia_fim: "2027-01-30", a_pagar: 50, liquidado_sem_pagamento_desde: "2026-09-01" };
  const html = cp.htmlQuadroContrato([l], "2026-11-18", { esc, dinheiro: (v) => `R$ ${v}`, data: (v) => v || "—" });
  assert.match(html, /data-alerta="vencimento"/);
  assert.match(html, /data-alerta="pagamento"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(cp.htmlQuadroContrato([], "2026-11-18", { esc, dinheiro: String, data: String }), /Ainda não há contrato/);
});
