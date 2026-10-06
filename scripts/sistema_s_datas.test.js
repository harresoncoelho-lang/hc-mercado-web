const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  function dataBrParaIso(");
const fim = html.indexOf("  // Busca oportunidades abertas do Sistema S/AM", inicio);
assert.ok(inicio >= 0 && fim > inicio, "normalização do Sistema S deve existir");
const contexto = vm.createContext({});
vm.runInContext(html.slice(inicio, fim), contexto);

test("SENAC/AM mantém abertura sem fabricar data de publicação", () => {
  const registro = vm.runInContext('normalizarSistemaS({ fonte: "SENAC/AM", numero: "007/2026", dataAbertura: "15/10/2026" })', contexto);
  assert.equal(registro.encerramento, "2026-10-15");
  assert.equal(registro.publicacao, null);
});

test("SESC/AM preserva publicação e abertura como campos distintos", () => {
  const registro = vm.runInContext('normalizarSistemaS({ fonte: "SESC/AM", dataPublicacao: "05/10/2026", dataAbertura: "15/10/2026" })', contexto);
  assert.equal(registro.publicacao, "2026-10-05");
  assert.equal(registro.encerramento, "2026-10-15");
});

test("cache legado do boletim remove datas falsas do SENAC antes da primeira pintura", () => {
  const inicioCache = html.indexOf("  const BOL_CACHE_VERSAO =");
  const fimCache = html.indexOf("  function metaBoletim(", inicioCache);
  assert.ok(inicioCache >= 0 && fimCache > inicioCache);
  const armazenamento = new Map();
  const cacheContexto = vm.createContext({
    normalizarUfs: (ufs) => ufs,
    localStorage: {
      getItem: (chave) => armazenamento.get(chave),
      setItem: (chave, valor) => armazenamento.set(chave, valor),
    },
  });
  vm.runInContext(html.slice(inicioCache, fimCache), cacheContexto);
  const filtro = { ufs: ["AM"], palavrasRaw: "evento" };
  const chave = cacheContexto.chaveCacheBoletim(filtro);
  armazenamento.set(chave, JSON.stringify({ salvoEm: "2026-10-05T23:00:00Z", resultados: [
    { fonte: "SENAC/AM", numeroControlePNCP: "008/2026", publicacao: "2026-10-13", encerramento: "2026-10-13" },
    { fonte: "SENAC/AM", numeroControlePNCP: "007/2026", publicacao: "2026-10-15", encerramento: "2026-10-15" },
    { fonte: "SESC/AM", publicacao: "2026-10-05", encerramento: "2026-10-15" },
  ] }));
  const cache = cacheContexto.lerCacheResultadoBoletim(filtro);
  assert.equal(cache.resultados[0].publicacao, null);
  assert.equal(cache.resultados[1].publicacao, null);
  assert.equal(cache.resultados[0].encerramento, "2026-10-13");
  assert.equal(cache.resultados[1].encerramento, "2026-10-15");
  assert.equal(cache.resultados[2].publicacao, "2026-10-05");
  cacheContexto.salvarCacheResultadoBoletim(filtro, cache.resultados);
  assert.equal(JSON.parse(armazenamento.get(chave)).resultados[0].publicacao, null);
});
