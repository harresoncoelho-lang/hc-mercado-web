const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("./analise-cnpj-ui.js");

const base = { id_compra: "78882005900332025", uf: "AM", modalidade: "Pregão", orgao_nome: "COMANDO DA MARINHA", descricao: "CAFÉ, TORRADO" };
const linhas = [
  // ganhou no PNCP (ordem 1, homologado 17 x 100)
  { ...base, numero_item: 107, ordem_classificacao: 1, valor_homologado: 17, quantidade_homologada: 100, valor_estimado: 20, vencedor_valor: 17 },
  // perdeu em 2º, lance 18,5 contra 17 do vencedor
  { ...base, numero_item: 110, classificacao: 2, valor_lance: 18.5, vencedor_valor: 17, vencedor_nome: "C R DA SILVA", quantidade: 50 },
  // 1º colocado recusado, item fracassado
  { ...base, numero_item: 108, classificacao: 1, situacao_proposta: "2", situacao_item: "Fracassado", valor_lance: 20 },
  // resultado cancelado não é vitória
  { ...base, id_compra: "19302805900142024", uf: "PA", numero_item: 3, ordem_classificacao: 1, valor_homologado: 5, situacao_resultado: "Cancelado", motivo_cancelamento: "Não assinou a ata" },
  // resultado sem posição (fora de SRP) com valor homologado = vencedor
  { ...base, id_compra: "19302805900142024", uf: "PA", numero_item: 4, valor_homologado: 2, quantidade: 10 },
];

test("resumo: vitórias, derrotas, recusa, fracassado como 1º e valor ganho", () => {
  const r = U.resumir(linhas);
  assert.equal(r.disputas, 5);
  assert.equal(r.compras, 2);
  assert.equal(r.vencidas, 2);
  assert.equal(r.naoVencidas, 3);
  assert.equal(r.vitoria, 40);
  assert.equal(r.valorGanho, 17 * 100 + 2 * 10);
  assert.equal(r.recusadas.length, 1);
  assert.deepEqual(r.fracassados1.map((p) => p.numero_item), [108]);
  assert.ok(Math.abs(r.descontoMedioGanha + 15) < 1e-9);
});

test("resumo: perde vs vencedor só nos pares com os dois preços e sem a recusada", () => {
  const r = U.resumir(linhas);
  assert.equal(r.paresComparados, 1);
  assert.equal(r.precoMedioPerde, 18.5);
  assert.equal(r.precoMedioVencedor, 17);
  assert.ok(Math.abs(r.diferencaMediaPerde - 8.8235) < 0.001);
});

test("resumo: grupos por UF e órgão contam disputas e vitórias", () => {
  const r = U.resumir(linhas);
  assert.deepEqual(r.porUf.map((g) => [g.chave, g.disputas, g.vencidas]), [["AM", 3, 1], ["PA", 2, 1]]);
  assert.equal(r.porOrgao[0].chave, "COMANDO DA MARINHA");
  assert.equal(U.resumir([]).vitoria, null);
});

test("motivos gravados: tipo da mensagem e situação da proposta, sem contar o mesmo item duas vezes", () => {
  const m = U.motivosGravados([
    { id_compra: "1", numero_item: 2, tipo: "desclassificacao", texto: "Pregoeiro: recusada", motivo: "Item 12.3.2 do edital", pregoes_gravados: { url: "https://cnetmobile.estaleiro.serpro.gov.br/x", itens: { 2: { descricao: "Café" } } } },
    { id_compra: "1", numero_item: 2, tipo: "recusa", texto: "de novo" },
    { id_compra: "1", numero_item: 3, tipo: "inabilitacao", texto: "Sem atestado" },
    { id_compra: "1", numero_item: 4, tipo: "convocacao", texto: "Envie a proposta" },
  ], [{ id_compra: "1", numero_item: 5, situacao: "Inabilitada" }, { id_compra: "1", numero_item: 6, situacao: "Desclassificada" }, { id_compra: "1", numero_item: 7, situacao: "Aceita" }]);
  assert.equal(m.desclassificacoes, 2);
  assert.equal(m.inabilitacoes, 2);
  assert.equal(m.lista.length, 3);
  assert.equal(m.lista[0].texto, "Item 12.3.2 do edital");
  assert.equal(m.lista[0].descricao, "Café");
});

test("motivos gravados: selo 'não verificado' até 2 leituras de organizações diferentes concordarem", () => {
  const m = U.motivosGravados([
    { id_compra: "1", numero_item: 2, tipo: "inabilitacao", texto: "x" },
    { id_compra: "1", numero_item: 3, tipo: "recusa", texto: "y", leituras_concordantes: 2 },
  ], [{ id_compra: "1", numero_item: 5, situacao: "Inabilitada", leituras_concordantes: 1 }, { id_compra: "1", numero_item: 6, situacao: "Aceita" }]);
  assert.deepEqual(m.lista.map((x) => [x.verificado, x.leituras]), [[false, 1], [true, 2]]);
  assert.equal(m.naoVerificados, 2);
});

test("camadas do CNPJ: automático, gravado (verificado) e pregões com recusa que ainda faltam abrir", () => {
  const r = U.resumir([...linhas, { ...base, id_compra: "ZZ1", numero_item: 1, classificacao: 2, situacao_proposta: "2", valor_lance: 9, link_origem: "https://x.gov.br/p" }]);
  const sem = U.camadasCnpj(r, [], []);
  assert.equal(sem.compras, 3);
  assert.equal(sem.gravadas, 0);
  assert.deepEqual(sem.faltam.map((c) => c.id_compra).sort(), ["78882005900332025", "ZZ1"], "recusa e fracassado como 1º, sem gravação");
  const com = U.camadasCnpj(r, [{ id_compra: "ZZ1", leituras_concordantes: 2 }], [{ id_compra: "78882005900332025", leituras_concordantes: 1 }]);
  assert.equal(com.gravadas, 2);
  assert.equal(com.verificadas, 1);
  assert.equal(com.faltam.length, 0);
});

// ---------- parte 2: contratos por estado e alerta de vulnerabilidade ----------
const contratos = [
  { numero_controle_pncp: "a", uf: "AM", valor_global: 10379826.5, vigencia_fim: "2027-01-30", valor_empenhado: 1500, valor_liquidado: 800, valor_pago: 700, valor_faturado: 800 },
  { numero_controle_pncp: "b", uf: "AM", valor_global: 5959800, vigencia_fim: "2025-09-15" },
  { numero_controle_pncp: "c", uf: null, valor_global: null },
];

test("contratos: total, vigentes, por UF da unidade e valores federais só de quem tem empenho", () => {
  const c = U.resumirContratos(contratos, "2026-11-19");
  assert.equal(c.total, 3);
  assert.equal(c.vigentes, 1);
  assert.equal(c.valorContratado, 10379826.5 + 5959800);
  assert.equal(c.maiorContrato, 10379826.5);
  assert.deepEqual(c.porUf.map((g) => [g.chave, g.contratos, g.vigentes]), [["AM", 2, 1], ["Não informado", 1, 0]]);
  assert.deepEqual([c.federaisComValores, c.valorContratadoFederal, c.empenhado, c.pago, c.faturado], [1, 10379826.5, 1500, 700, 800]);
  assert.equal(U.resumirContratos(null, "2026-11-19").total, 0);
});

test("vulnerabilidade: sanção vigente, situação irregular, recém-aberta, capital baixo, MEI acima do teto e recusas", () => {
  const ct = U.resumirContratos(contratos, "2026-11-19");
  const resumo = { disputas: 10, recusadas: [{ id_compra: "x", numero_item: 1 }, { id_compra: "x", numero_item: 2 }] };
  const mot = { desclassificacoes: 1, inabilitacoes: 0, chaves: new Set(["x|1"]) };
  const a = U.alertasVulnerabilidade({ hoje: "2026-11-19", contratos: ct, resumo, mot,
    sancoes: { vigentes: [{ orgao_sancionador: "UFAM" }], expiradas: [] },
    cadastro: { situacao: "INAPTA", data_situacao: "2026-01-02", motivo_situacao: "OMISSAO DE DECLARACOES", situacao_especial: "RECUPERACAO JUDICIAL",
      data_abertura: "2026-06-01", capital_social: 100000, opcao_mei: true } });
  const niveis = a.map((x) => x.nivel);
  assert.deepEqual(niveis, ["alto", "alto", "alto", "medio", "medio", "medio", "medio"]);
  assert.match(a[0].texto, /vigente.*UFAM/);
  assert.match(a[1].texto, /INAPTA desde 02\/01\/2026 \(OMISSAO/);
  assert.match(a[3].texto, /aberta há 5 mês/);
  assert.match(a[4].texto, /menos de 10%/);
  assert.match(a[6].texto, /^2 desclassificação.*10 disputas \(20%\)/);
});

test("vulnerabilidade: empresa regular e antiga não gera alerta; sanção só encerrada é informativa", () => {
  const ct = U.resumirContratos(contratos, "2026-11-19");
  const cad = { situacao: "ATIVA", motivo_situacao: "SEM MOTIVO", situacao_especial: null, data_abertura: "1999-04-12", capital_social: 6000000, opcao_mei: false };
  assert.deepEqual(U.alertasVulnerabilidade({ hoje: "2026-11-19", contratos: ct, cadastro: cad, sancoes: { vigentes: [], expiradas: [] },
    resumo: { disputas: 3, recusadas: [{ id_compra: "x", numero_item: 1 }] }, mot: { desclassificacoes: 0, inabilitacoes: 0, chaves: new Set() } }), []);
  const so = U.alertasVulnerabilidade({ hoje: "2026-11-19", sancoes: { vigentes: [], expiradas: [{}] } });
  assert.deepEqual(so.map((x) => x.nivel), ["info"]);
});
