const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { recuperarCoberturaLocal } = require("./recuperar_cobertura_local");

function pagina(numero, total = 2) {
  return { numeroPagina: numero, totalPaginas: total, totalRegistros: total,
    data: [{ numeroControlePNCP: `AL-${numero}` }] };
}

async function preparar(t) {
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), "pncp-recuperacao-"));
  t.after(() => fs.rm(diretorio, { recursive: true, force: true }));
  return { diretorio, ufs: ["AL"], dataFinal: "20271028", intervaloMs: 0 };
}

test("falha de rede preserva páginas e retoma somente as faltantes", async (t) => {
  const opcoes = await preparar(t);
  const parcial = await recuperarCoberturaLocal({ ...opcoes, buscarPagina: async (_uf, n) => n === 1 ? pagina(1) : null });
  assert.equal(parcial.ufs.AL.status, "pendente");
  assert.equal(parcial.ufs.AL.paginasSalvas, 1);
  const chamadas = [];
  const completo = await recuperarCoberturaLocal({ ...opcoes, buscarPagina: async (_uf, n) => { chamadas.push(n); return pagina(n); } });
  assert.deepEqual(chamadas, [2, 1]);
  assert.equal(completo.ufs.AL.status, "concluida");
  assert.equal(completo.ufs.AL.registrosUnicos, 2);
});

test("percorre mais de vinte páginas antes de confirmar a UF", async (t) => {
  const resultado = await recuperarCoberturaLocal({ ...await preparar(t), buscarPagina: async (_uf, n) => pagina(n, 21) });
  assert.equal(resultado.ufs.AL.paginasSalvas, 21);
  assert.equal(resultado.ufs.AL.status, "concluida");
});

test("mudança na paginação ou duplicata impede falsa conclusão", async (t) => {
  const opcoes = await preparar(t);
  const resultado = await recuperarCoberturaLocal({ ...opcoes, buscarPagina: async (_uf, n) => ({ ...pagina(n), data: [{ numeroControlePNCP: "duplicado" }] }) });
  assert.equal(resultado.ufs.AL.status, "pendente");
  assert.match(resultado.ufs.AL.erro, /contagem|duplicad/i);
});

test("mudança da primeira página durante coleta impede conclusão", async (t) => {
  let leituras = 0;
  const resultado = await recuperarCoberturaLocal({ ...await preparar(t), buscarPagina: async (_uf, n) => {
    if (n === 1 && ++leituras > 1) return { ...pagina(n), data: [{ numeroControlePNCP: "mudou" }] };
    return pagina(n);
  } });
  assert.equal(resultado.ufs.AL.status, "pendente");
  assert.match(resultado.ufs.AL.erro, /mudou/);
});

test("ordem das propriedades JSON não altera identidade da primeira página", async (t) => {
  let leituras = 0;
  const resultado = await recuperarCoberturaLocal({ ...await preparar(t), buscarPagina: async (_uf, n) => {
    const dado = pagina(n);
    dado.data = n === 1 && ++leituras > 1
      ? [{ objetoCompra: "exemplo", numeroControlePNCP: `AL-${n}` }]
      : [{ numeroControlePNCP: `AL-${n}`, objetoCompra: "exemplo" }];
    return dado;
  } });
  assert.equal(resultado.ufs.AL.status, "concluida");
});

test("resposta inválida não avança checkpoint e interrompe rajada", async (t) => {
  const chamadas = [];
  const resultado = await recuperarCoberturaLocal({ ...await preparar(t), ufs: ["AL", "BA"], buscarPagina: async (uf) => {
    chamadas.push(uf); return { totalPaginas: 1, data: "erro" };
  } });
  assert.deepEqual(chamadas, ["AL"]);
  assert.equal(resultado.ufs.AL.paginasSalvas, 0);
  assert.equal(resultado.ufs.BA.status, "pendente");
});

test("diretório existente não pode misturar consultas diferentes", async (t) => {
  const opcoes = await preparar(t);
  await recuperarCoberturaLocal({ ...opcoes, buscarPagina: async () => ({ data: [], totalPaginas: 0 }) });
  await assert.rejects(recuperarCoberturaLocal({ ...opcoes, dataFinal: "20271029" }), /consulta/);
});

test("checkpoint corrompido é erro explícito, não recuperação vazia", async (t) => {
  const opcoes = await preparar(t);
  await fs.writeFile(path.join(opcoes.diretorio, "manifesto.json"), "{");
  await assert.rejects(recuperarCoberturaLocal(opcoes), SyntaxError);
});

test("fonte com zero páginas e contagem positiva permanece pendente", async (t) => {
  const resultado = await recuperarCoberturaLocal({ ...await preparar(t), buscarPagina: async () => ({ data: [], totalPaginas: 0, totalRegistros: 123 }) });
  assert.equal(resultado.ufs.AL.status, "pendente");
  assert.equal(resultado.ufs.AL.paginasSalvas, 0);
});

test("trava identifica processo e bloqueia segunda execução sem apagar checkpoint", async (t) => {
  const opcoes = await preparar(t);
  let chamada = 0;
  const resultado = await recuperarCoberturaLocal({ ...opcoes, buscarPagina: async () => {
    if (++chamada === 1) {
      const trava = JSON.parse(await fs.readFile(path.join(opcoes.diretorio, "recuperacao.lock"), "utf8"));
      assert.equal(trava.pid, process.pid);
      await assert.rejects(recuperarCoberturaLocal(opcoes), /trava|processo/i);
    }
    return { data: [], totalPaginas: 0 };
  } });
  assert.equal(resultado.ufs.AL.status, "concluida", resultado.ufs.AL.erro);
  await assert.rejects(fs.access(path.join(opcoes.diretorio, "recuperacao.lock")), { code: "ENOENT" });
});
