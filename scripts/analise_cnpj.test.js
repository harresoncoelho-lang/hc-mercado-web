const test = require("node:test");
const assert = require("node:assert/strict");
const { completarAnalises } = require("./analise_cnpj");

// Banco falso: responde à fila e registra as escritas.
function bancoFalso(filas) {
  const escritas = [];
  const rest = async (caminho, opcoes = {}) => {
    escritas.push({ caminho, metodo: opcoes.method || "GET", corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    if (caminho.startsWith("historico_cnpj_consultas?situacao=eq.parcial")) return { json: async () => filas };
    if (caminho.startsWith("historico_compras?id_compra=in.")) return { json: async () => [] };
    return { json: async () => [] };
  };
  return { rest, escritas };
}

test("robô: lê cada mês uma vez para todos os CNPJs, grava, tira o mês da fila e fecha a análise", async () => {
  const filas = [
    { cnpj: "48885922000150", compras_pendentes: [], meses_pendentes: ["2026/10", "2026/09"], meses_lidos: [] },
    { cnpj: "38350458000143", compras_pendentes: [], meses_pendentes: ["2026/10"], meses_lidos: [] },
  ];
  const { rest, escritas } = bancoFalso(filas);
  const lidos = [];
  const lerMes = async (mes, filtro) => {
    lidos.push(mes);
    filtro.linha('"numero_uasg";"id_compra";"numero_item";"descricao";"identificacao_participante";"nome_participante";"classificacao";"situacao_proposta";"situacao_item"');
    filtro.linha('"788820";"78882005900332025";"107";"Café";"48885922000150";"F M";"1";"6";"1"');
    return { mes, linhas: 1, bytes: 10 };
  };
  const c = await completarAnalises({ rest, lerMes, fetchPncp: async () => ({ ok: true, status: 200, json: async () => ({}) }), esperar: async () => {} });
  assert.deepEqual(lidos, ["2026/10", "2026/09"]);
  assert.equal(c.meses, 2);
  assert.equal(c.completos, 2);
  const participacoes = escritas.filter((e) => e.caminho.startsWith("historico_participacoes"));
  assert.ok(participacoes.length >= 1);
  assert.equal(participacoes[0].corpo[0].situacao_proposta, "6");
  const fechadas = escritas.filter((e) => e.metodo === "PATCH" && e.corpo.situacao === "completo").map((e) => e.caminho);
  assert.equal(fechadas.length, 2);
});

test("robô: mês que falha fica pendente e a análise continua parcial", async () => {
  const filas = [{ cnpj: "48885922000150", compras_pendentes: [], meses_pendentes: ["2026/10"], meses_lidos: [] }];
  const { rest, escritas } = bancoFalso(filas);
  const c = await completarAnalises({ rest, lerMes: async () => { throw new Error("HTTP 503"); }, esperar: async () => {} });
  assert.equal(c.meses, 0);
  assert.equal(c.completos, 0);
  assert.ok(!escritas.some((e) => e.metodo === "PATCH" && e.corpo.situacao === "completo"));
});

test("robô: prazo da rodada esgotado não lê nada", async () => {
  const filas = [{ cnpj: "48885922000150", compras_pendentes: ["x"], meses_pendentes: ["2026/10"], meses_lidos: [] }];
  const { rest } = bancoFalso(filas);
  const c = await completarAnalises({ rest, lerMes: async () => { throw new Error("não devia ler"); }, agora: () => 10, prazoFinal: 5 });
  assert.equal(c.meses, 0);
  assert.equal(c.compras, 0);
});

test("robô: 3ª falha no mesmo mês marca 'falhou' (não trava a fila); mês novo recomeça a contagem", async () => {
  const agora = () => Date.UTC(2026, 10, 19);
  const quebra = async () => { throw new Error("HTTP 503"); };
  const filas = [{ cnpj: "48885922000150", compras_pendentes: [], meses_pendentes: ["2026/10"], meses_lidos: [], tentativas: 2, mes_falhas: "2026-11" }];
  const { rest, escritas } = bancoFalso(filas);
  await completarAnalises({ rest, lerMes: quebra, agora, esperar: async () => {} });
  const patch = escritas.find((e) => e.metodo === "PATCH");
  assert.equal(patch.corpo.situacao, "falhou");
  assert.equal(patch.corpo.tentativas, 3);
  assert.match(patch.corpo.erro, /falhou 3 vezes/);

  const velhas = [{ cnpj: "48885922000150", compras_pendentes: [], meses_pendentes: ["2026/10"], meses_lidos: [], tentativas: 2, mes_falhas: "2026-10" }];
  const b2 = bancoFalso(velhas);
  await completarAnalises({ rest: b2.rest, lerMes: quebra, agora, esperar: async () => {} });
  const p2 = b2.escritas.find((e) => e.metodo === "PATCH");
  assert.deepEqual([p2.corpo.tentativas, p2.corpo.mes_falhas, p2.corpo.situacao], [1, "2026-11", undefined]);
});

test("robô: poda historico_participacoes dos CNPJs da rodada (teto de linhas e meses)", async () => {
  const filas = [{ cnpj: "48885922000150", compras_pendentes: [], meses_pendentes: [], meses_lidos: [] }];
  const { rest, escritas } = bancoFalso(filas);
  await completarAnalises({ rest, lerMes: async () => ({}), esperar: async () => {} });
  const poda = escritas.find((e) => e.caminho === "rpc/historico_participacoes_podar");
  assert.deepEqual(poda.corpo, { p_cnpjs: ["48885922000150"], p_max_linhas: 5000, p_meses: 37 });
});

// ---------- fila "parcial": prioridade para quem pediu, mais CNPJs por mês lido, mais meses quando sobra tempo ----------
const CAB_ARQ = '"numero_uasg";"id_compra";"numero_item";"descricao";"identificacao_participante";"nome_participante";"classificacao";"situacao_proposta";"situacao_item"';
function bancoFila({ prioritarias = [], todas }) {
  const escritas = [];
  const rest = async (caminho, opcoes = {}) => {
    escritas.push({ caminho, metodo: opcoes.method || "GET", corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    if (caminho.startsWith("historico_cnpj_consultas?situacao=eq.parcial")) return { json: async () => (caminho.includes("pedido_em=gte.") ? prioritarias : todas) };
    return { json: async () => [] };
  };
  return { rest, escritas };
}
const fila = (cnpj, meses) => ({ cnpj, compras_pendentes: [], meses_pendentes: meses, meses_lidos: [] });
const lerMesFalso = (lidos, relogio, custo = 0) => async (mes, filtro) => {
  lidos.push(mes); relogio.t += custo;
  filtro.linha(CAB_ARQ);
  return { mes, linhas: 0, bytes: 0 };
};

test("fila: o mês de quem acabou de pedir é lido antes, mesmo sendo mais antigo; a fila antiga não fica de fora", async () => {
  const velho = fila("11111111000191", ["2026/10"]), novo = fila("22222222000191", ["2026/08"]);
  const { rest } = bancoFila({ prioritarias: [novo], todas: [velho, novo] });
  const lidos = [], r = { t: 0 };
  const c = await completarAnalises({ rest, lerMes: lerMesFalso(lidos, r), agora: () => r.t, esperar: async () => {} });
  assert.deepEqual(lidos, ["2026/08", "2026/10"]);
  assert.equal(c.cnpjs, 2, "sem duplicar quem está nas duas listas");
});

test("fila: mais de 5 CNPJs entram no filtro do mesmo mês (o arquivo é baixado uma vez só) e todos saem do mês", async () => {
  const todas = Array.from({ length: 12 }, (_, i) => fila(`${String(10000000000000 + i)}`, ["2026/10"]));
  const { rest, escritas } = bancoFila({ todas });
  const lidos = [], r = { t: 0 };
  const c = await completarAnalises({ rest, lerMes: lerMesFalso(lidos, r), agora: () => r.t, esperar: async () => {} });
  assert.deepEqual(lidos, ["2026/10"]);
  assert.equal(c.completos, 12);
  assert.equal(escritas.filter((e) => e.metodo === "PATCH" && e.corpo.situacao === "completo").length, 12);
});

test("fila: tempo curto lê só o primeiro mês (sempre começa) e deixa o resto pendente; tempo sobrando lê todos", async () => {
  const montar = () => bancoFila({ todas: [fila("11111111000191", ["2026/10", "2026/09", "2026/08"])] });
  const curto = { t: 0 }, lidosCurto = [];
  const a = await completarAnalises({ rest: montar().rest, lerMes: lerMesFalso(lidosCurto, curto, 60), agora: () => curto.t, prazoFinal: 100, esperar: async () => {} });
  assert.deepEqual(lidosCurto, ["2026/10"], "o 2º mês (60 s de custo medido) não cabe nos 40 s que sobram");
  assert.equal(a.meses, 1);
  assert.equal(a.completos, 0);
  const longo = { t: 0 }, lidosLongo = [];
  const b = await completarAnalises({ rest: montar().rest, lerMes: lerMesFalso(lidosLongo, longo, 60), agora: () => longo.t, prazoFinal: 1000, esperar: async () => {} });
  assert.deepEqual(lidosLongo, ["2026/10", "2026/09", "2026/08"]);
  assert.equal(b.completos, 1);
});

test("fila: mês que falha não trava os seguintes nem os outros CNPJs", async () => {
  const { rest } = bancoFila({ todas: [fila("11111111000191", ["2026/10", "2026/09"]), fila("22222222000191", ["2026/09"])] });
  const lidos = [];
  const lerMes = async (mes, filtro) => { lidos.push(mes); if (mes === "2026/10") throw new Error("HTTP 503"); filtro.linha(CAB_ARQ); return { mes, linhas: 0, bytes: 0 }; };
  const c = await completarAnalises({ rest, lerMes, agora: () => 0, esperar: async () => {} });
  assert.deepEqual(lidos, ["2026/10", "2026/09"]);
  assert.equal(c.meses, 1);
  assert.equal(c.completos, 1, "o CNPJ cujo único mês deu certo fecha; o outro continua parcial para a próxima rodada");
});
