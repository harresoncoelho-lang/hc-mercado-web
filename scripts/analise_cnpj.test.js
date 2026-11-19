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
