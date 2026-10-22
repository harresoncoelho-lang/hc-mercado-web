const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
function funcao(nome) {
  const inicio = html.search(new RegExp(`  (?:async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `${nome} deve existir`);
  return html.slice(inicio, html.indexOf("\n  }", inicio) + 4);
}
function ambiente({ remoto = null, erro = null, cache = {} } = {}) {
  const dados = new Map(Object.entries(cache));
  const escritas = [];
  let alterado;
  const query = { eq(campo, id) { assert.equal(campo, "id"); assert.equal(id, "conta-a"); return this; },
    async maybeSingle() { return { data: alterado || { boletim_filtro: remoto }, error: erro }; },
    select() { return this; } };
  const sb = { from(tabela) { assert.equal(tabela, "clientes"); return {
    select: () => query,
    update(valor) { escritas.push(valor); alterado = valor; return query; },
  }; } };
  const contexto = vm.createContext({
    window: { __clienteIdAtual: "conta-a", __clientePronto: Promise.resolve({ status: "aprovado" }), __sbClient: sb },
    localStorage: { getItem: (k) => dados.get(k) || null, setItem: (k, v) => dados.set(k, v) },
    normalizarUfs: (ufs) => [...new Set((Array.isArray(ufs) ? ufs : String(ufs || "").split(",")).map((s) => s.trim().toUpperCase()).filter((s) => ["AM", "SP"].includes(s)))],
  });
  for (const nome of ["chaveFiltroBoletimConta", "lerFiltroBoletim", "carregarFiltroBoletimConta", "salvarFiltroBoletim"]) vm.runInContext(funcao(nome), contexto);
  return { contexto, dados, escritas };
}
test("navegador vazio recupera filtro salvo na conta", async () => {
  const { contexto } = ambiente({ remoto: { ufs: ["AM"], palavrasRaw: "expediente" } });
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "expediente");
});
test("preferência remota prevalece sobre cache antigo e não lê outra conta", async () => {
  const { contexto } = ambiente({ remoto: { ufs: ["AM"], palavrasRaw: "novo" }, cache: {
    "hc_boletim_filtro:conta-a": JSON.stringify({ ufs: ["SP"], palavrasRaw: "antigo" }),
    "hc_boletim_filtro:conta-b": JSON.stringify({ ufs: ["SP"], palavrasRaw: "privado" }),
  } });
  await contexto.carregarFiltroBoletimConta();
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "novo");
  contexto.window.__clienteIdAtual = "conta-c";
  assert.equal(contexto.lerFiltroBoletim(), null);
});
test("salvar confirma persistência remota antes de trocar filtro local", async () => {
  const { contexto, escritas } = ambiente();
  await contexto.salvarFiltroBoletim(["am", "AM"], "  expediente  ");
  assert.equal(escritas.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(escritas[0])), { boletim_filtro: { ufs: ["AM"], uf: "AM", palavrasRaw: "expediente" } });
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "expediente");
});
test("falha de banco não aparenta sucesso nem apaga filtro anterior", async () => {
  const anterior = { ufs: ["AM"], palavrasRaw: "anterior" };
  const { contexto } = ambiente({ erro: { message: "indisponível" }, cache: { "hc_boletim_filtro:conta-a": JSON.stringify(anterior) } });
  await assert.rejects(contexto.salvarFiltroBoletim(["AM"], "novo"), /indisponível/);
  assert.equal(contexto.lerFiltroBoletim().palavrasRaw, "anterior");
});
