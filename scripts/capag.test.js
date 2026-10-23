const test = require("node:test");
const assert = require("node:assert/strict");
const { consultarCapag } = require("../capag");
const base = { posicao: "2026-09-01", coletadoEm: "2026-10-22", fonte: "https://www.tesourotransparente.gov.br/ckan/dataset/capag-municipios", municipios: [{ ibge: "1302306", municipio: "Jutaí", uf: "AM", nota: "C", indicadores: [{ nome: "Endividamento", nota: "A", valor: 0.0359 }] }] };
test("CAPAG corresponde ao ente municipal e UF, sem emprestar nota a federal ou Câmara", () => {
  const e = { orgao: "MUNICIPIO DE JUTAI", municipio: "Jutaí", uf: "AM", esferaId: "M" };
  assert.equal(consultarCapag(base, e).nota, "C");
  for (const outro of [{ uf: "SP" }, { esferaId: "F" }, { orgao: "Câmara Municipal de Jutaí" }, { orgao: "Instituto Federal" }, { codigoMunicipioIbge: "1234567" }]) assert.equal(consultarCapag(base, { ...e, ...outro }).disponivel, false);
});
test("CAPAG sem nota ou sem base informa ausência e nunca converte N.D. em aprovação", () => {
  const e = { orgao: "Prefeitura Municipal de Jutaí", municipio: "Jutaí", uf: "AM" };
  assert.equal(consultarCapag(null, e).disponivel, false);
  const r = consultarCapag({ ...base, municipios: [{ ...base.municipios[0], nota: "N.D." }] }, e);
  assert.equal(r.disponivel, false);
  assert.match(r.motivo, /não disponível/i);
});
test("snapshot CAPAG real conserva data e indicadores oficiais de Jutaí", () => {
  const dados = require("../data/capag-municipios.json");
  const r = consultarCapag(dados, { orgao: "MUNICIPIO DE JUTAI", municipio: "Jutaí", uf: "AM" });
  assert.equal(r.nota, "C");
  assert.equal(r.posicao, "2026-09-01");
  assert.equal(r.indicadores.length, 3);
  assert.ok(Math.abs(r.indicadores[0].valor - 0.03592800571747181) < 0.00000001);
});

test("CAPAG real de Sant'Ana aceita apóstrofo convencional sem perder a identidade do ente", () => {
  const dados = require("../data/capag-municipios.json");
  const registros = dados.municipios.filter(r => r.ibge === "4317103");
  assert.equal(registros.length, 1);
  assert.equal(registros[0].municipio, "Sant'Ana do Livramento");
  assert.equal(registros[0].uf, "RS");
  assert.equal(registros[0].nota, "C");
  const edital = { orgao: "MUNICIPIO DE SANTANA DO LIVRAMENTO", municipio: "Sant'Ana do Livramento", uf: "RS", esferaId: "M", codigoMunicipioIbge: "4317103" };
  for (const municipio of ["Sant'Ana do Livramento", "Sant’Ana do Livramento", "Santana do Livramento"]) {
    const resultado = consultarCapag(dados, { ...edital, municipio });
    assert.equal(resultado.disponivel, true, municipio);
    assert.equal(resultado.nota, "C");
    assert.equal(resultado.ibge, "4317103");
  }
  for (const outro of [{ uf: "SC" }, { codigoMunicipioIbge: "4317104" }, { municipio: "Sant-Ana do Livramento" }, { municipio: "Sant Ana do Livramento" }, { orgao: "Autarquia Municipal de Santana do Livramento" }, { orgao: "Câmara Municipal de Sant'Ana do Livramento" }]) {
    assert.equal(consultarCapag(dados, { ...edital, ...outro }).disponivel, false);
  }
  assert.equal(consultarCapag({ ...dados, municipios: [...registros, ...registros] }, edital).disponivel, false);
});

test("CAPAG cobre 26 UFs e todas as notas em pregão e dispensa, sem depender do edital de Jutaí", () => {
  const dados = require("../data/capag-municipios.json");
  assert.equal(dados.municipios.length, 5568);
  assert.equal(new Set(dados.municipios.map((r) => r.ibge)).size, dados.municipios.length);
  assert.equal(new Set(dados.municipios.map((r) => r.uf)).size, 26);
  assert.match(dados.fonte, /^https:\/\/www\.tesourotransparente\.gov\.br\/.+\.xlsx$/);
  assert.match(dados.sha256, /^[a-f0-9]{64}$/);
  assert.match(dados.posicao, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(dados.coletadoEm, /^\d{4}-\d{2}-\d{2}$/);
  const amostras = new Map();
  for (const registro of dados.municipios) {
    assert.match(registro.ibge, /^\d{7}$/);
    assert.equal(registro.indicadores.length, 3);
    if (!amostras.has(registro.uf)) amostras.set(registro.uf, registro);
    if (!amostras.has(registro.nota)) amostras.set(registro.nota, registro);
  }
  for (const registro of amostras.values()) {
    for (const modalidadeNome of ["Pregão eletrônico", "Dispensa de licitação"]) {
      const resultado = consultarCapag(dados, {
        orgao: `Prefeitura Municipal de ${registro.municipio}`, municipio: registro.municipio,
        uf: registro.uf, esferaId: "M", codigoMunicipioIbge: registro.ibge, modalidadeNome,
      });
      assert.equal(resultado.disponivel, /^[ABCD]\+?$/.test(registro.nota), `${registro.ibge}: ${modalidadeNome}`);
      if (resultado.disponivel) {
        assert.equal(resultado.nota, registro.nota);
        assert.equal(resultado.ibge, registro.ibge);
        assert.equal(resultado.fonte, dados.fonte);
        assert.equal(resultado.posicao, dados.posicao);
        assert.equal(resultado.coletadoEm, dados.coletadoEm);
        assert.equal(resultado.indicadores.length, 3);
        assert.match(resultado.observacao, /não mede histórico nem garante pontualidade/);
      } else assert.match(resultado.motivo, /não disponível/);
    }
  }
});

test("CAPAG recusa entes independentes e homônimos sem confirmação inequívoca", () => {
  const edital = { orgao: "Prefeitura Municipal de Jutaí", municipio: "Jutaí", uf: "AM" };
  for (const orgao of ["Fundo Municipal de Saúde de Jutaí", "Secretaria Municipal de Educação de Jutaí", "Autarquia Municipal de Jutaí", "Governo do Estado do Amazonas"]) {
    assert.equal(consultarCapag(base, { ...edital, orgao }).disponivel, false);
  }
  assert.equal(consultarCapag({ ...base, municipios: [...base.municipios, base.municipios[0]] }, edital).disponivel, false);
  assert.equal(consultarCapag(base, { ...edital, municipio: "Tefé" }).disponivel, false);
  assert.equal(consultarCapag(base, { ...edital, esferaId: "D" }).disponivel, false);
});

test("build local inclui o módulo CAPAG e o painel usa a mesma integração em qualquer modalidade", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { arquivosDaRaiz } = require("./montar_publico");
  assert.ok(arquivosDaRaiz().includes("capag.js"));
  const painel = fs.readFileSync(path.join(__dirname, "../painel.html"), "utf8");
  assert.match(painel, /<script src="capag\.js"><\/script>/);
  assert.match(painel, /fetch\("data\/capag-municipios\.json"\)/);
  assert.match(painel, /iaCapagAtual = Capag\.consultarCapag\(base, edital\)/);
});

test("CAPAG aparece com PNCP pendente em novos pregões e dispensas, inclusive resumo em cache", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const html = fs.readFileSync(require("node:path").join(__dirname, "../painel.html"), "utf8");
  const abrir = html.slice(html.indexOf("  function abrirModalIA("), html.indexOf('  document.getElementById("modal-ia-fechar")'));
  const carregar = html.slice(html.indexOf("  async function carregarCapagNoResumo("), html.indexOf("  // Pega o token", html.indexOf("  async function carregarCapagNoResumo(")));
  for (const [modalidade, cache] of [["Pregão", true], ["Dispensa", false]]) {
    let consultas = 0;
    const renderizados = [];
    const elemento = () => ({ innerHTML: "", textContent: "", value: "", style: {}, classList: { add() {} }, setAttribute() {} });
    const elementos = new Map();
    const contexto = vm.createContext({
      document: { getElementById: (id) => { if (!elementos.has(id)) elementos.set(id, elemento()); return elementos.get(id); } },
      iaGeracaoModal: 1, empresaOperacionalId: "empresa-qa", baseCapagPromise: null,
      cancelarConsultaResumo() {}, bloquearAcoesResumo() {}, idOportunidade: e => e.numeroControlePNCP,
      lerMapa: () => ({}), enriquecerEditalComDetalhePncp: () => new Promise(() => {}),
      carregarItensDoResumoIA() {}, lerCacheLocalResumo: () => cache ? { estrutura: { resumoGeral: "Resumo salvo" } } : null,
      montarFichaImediata: () => ({ fonteLida: false }), chamarIA() {},
      renderizarEstruturaIA(est) { contexto.iaEstruturaAtual = est; renderizados.push(contexto.iaCapagAtual); },
      fetch: async () => { consultas++; return { ok: true, json: async () => base }; },
      Capag: require("../capag"), clearTimeout, setTimeout,
    });
    vm.runInContext(`${carregar}\n${abrir}`, contexto);
    contexto.abrirModalIA({ numeroControlePNCP: `00000000000000-1-0000${cache ? "01" : "02"}/2026`, modalidade, publicacao: "2026-10-23", orgao: "Prefeitura Municipal de Jutaí", municipio: "Jutaí", uf: "AM" });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(consultas, 1, `${modalidade}: CAPAG não deve esperar PNCP`);
    assert.equal(contexto.iaCapagAtual.nota, "C");
    assert.match(renderizados[0]?.motivo || "", /Consultando/);
    assert.equal(renderizados.at(-1).nota, "C");
  }
});

test("consulta CAPAG atrasada não altera outro edital e indisponibilidade tem motivo visível", async () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const html = fs.readFileSync(require("node:path").join(__dirname, "../painel.html"), "utf8");
  const inicio = html.indexOf("  async function carregarCapagNoResumo(");
  const carregar = html.slice(inicio, html.indexOf("  // Pega o token", inicio));
  let resolver;
  const contexto = vm.createContext({ iaGeracaoModal: 2, iaEstruturaAtual: {}, iaCapagAtual: { motivo: "Edital atual" },
    baseCapagPromise: new Promise(resolve => { resolver = resolve; }), Capag: require("../capag"), renderizarEstruturaIA() {} });
  vm.runInContext(carregar, contexto);
  const atrasada = contexto.carregarCapagNoResumo({ orgao: "Prefeitura Municipal de Jutaí", municipio: "Jutaí", uf: "AM" }, 1);
  resolver(base); await atrasada;
  assert.equal(contexto.iaCapagAtual.motivo, "Edital atual");
  contexto.baseCapagPromise = Promise.resolve(null);
  await contexto.carregarCapagNoResumo({}, 2);
  assert.equal(contexto.iaCapagAtual.disponivel, false);
  assert.match(contexto.iaCapagAtual.motivo, /Base CAPAG indisponível/);
});
