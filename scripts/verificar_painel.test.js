const assert = require("node:assert/strict");
const test = require("node:test");

const { verificarScriptsInline } = require("./verificar_painel");

test("painel mantém todos os scripts inline sintaticamente válidos", () => {
  assert.ok(verificarScriptsInline() > 0);
});

test("boletim sincroniza o Kanban com um dossiê operacional", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  assert.match(html, /sincronizarDossieOperacional/);
  assert.match(html, /origem_externa_id/);
});

test("resumo dos filtros não depende de helper declarado em script posterior", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf('const CHAVE = "hc_oportunidades_filtros_colapsado"');
  const fim = html.indexOf("// Histórico de Compras segue", inicio);
  const bloco = html.slice(inicio, fim);
  assert.ok(inicio >= 0 && fim > inicio);
  assert.doesNotMatch(bloco, /ufsDoSelect\(/);
  assert.doesNotMatch(bloco, /textoUfs\(/);
});

test("status usa a atualização real das tabelas que migraram para o Supabase", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  assert.match(html, /tabelaSupabase: "contratos"/);
  assert.match(html, /tabelaSupabase: "mercado_atas"/);
  assert.match(html, /await aguardarSupabaseAutenticado\(\);/);
});

test("diagnóstico limita a amostra rica de contratos para evitar resposta pesada", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  assert.match(html, /consultarContratosSupabase\(\{ palavras, dias, cnpjFornecedor, uf, limite = 1000 \}\)/);
  assert.match(html, /const limiteSeguro = Math\.min\(Math\.max\(Number\(limite\) \|\| 1000, 1\), 1000\)/);
  assert.match(html, /from\("mercado_atas"\)\.select\("dado"\)\.limit\(1000\)/);
});

test("dashboard espera a sessão antes de consultar as bases privadas", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("async function carregarVisaoGeralMercado()");
  const fim = html.indexOf("window.__atualizarDashboard", inicio);
  const bloco = html.slice(inicio, fim);
  assert.ok(inicio >= 0 && fim > inicio);
  assert.match(bloco, /await aguardarSupabaseAutenticado\(\);/);
});

test("exportações do edital usam DOCX real e a marca visual oficial", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  assert.match(html, /Gerar Checklist \.docx/);
  assert.match(html, /\/api\/gerar-checklist/);
  assert.match(html, /<strong>LicitaPlena<\/strong>/);
  assert.doesNotMatch(html.slice(html.indexOf("function montarHtmlImpressaoResumo"), html.indexOf("function montarResumoParaCliente")), /marca-sinal/);
});

test("texto preparado para e-mail preserva requisitos e cobertura da leitura", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const trecho = (inicio, fim) => html.slice(html.indexOf(inicio), html.indexOf(fim, html.indexOf(inicio)));
  const contexto = vm.createContext({ ResumoModelo: require("../resumo-modelo"), document: { getElementById: () => null }, formatarPrazoPropostas: () => "", linkPncp: () => "" });
  vm.runInContext([

    trecho("function textoIA(", "// A API de itens"),
    trecho("function formatarDataHoraIA(", "function adicionarSecaoTextoIA("),
    trecho("function avisoCoberturaLeitura(", "function podeGerarChecklist("),
    trecho("function montarResumoParaCliente(", "function abrirModalIA("),
  ].join("\n"), contexto);
  const texto = contexto.montarResumoParaCliente({}, {
    fonteLida: true,
    documentosCredenciamento: ["Procuração do representante [Edital, item 3.1]"],
    requisitosProposta: ["Proposta assinada com validade de 90 dias [Edital, item 5.2]"],
    coberturaLeitura: { parcial: true, documentosLidos: ["Edital"], documentosNaoLidos: ["Anexo II"], motivos: ["Documento escaneado"] },
  });
  assert.match(texto, /Credenciamento e participação: *\n• Procuração do representante \[Edital, item 3\.1\]/);
  assert.match(texto, /Preparação e envio da proposta: *\n• Proposta assinada com validade de 90 dias \[Edital, item 5\.2\]/);
  assert.match(texto, /Leitura parcial/);
  assert.match(texto, /Documentos não lidos: Anexo II/);
  assert.match(texto, /Documento escaneado/);
});

test("resumo local expira após 24 horas e mantém a cópia recente", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("const VERSAO_CACHE_LOCAL_RESUMO =");
  const fim = html.indexOf("function salvarCacheLocalResumo(", inicio);
  const registros = new Map();
  const contexto = vm.createContext({ localStorage: {
    getItem: (chave) => registros.get(chave),
    removeItem: (chave) => registros.delete(chave),
  } });
  vm.runInContext(html.slice(inicio, fim), contexto);
  const edital = { numeroControlePNCP: "01171012000141-1-000005/2026" };
  const chave = contexto.chaveCacheLocalResumo(edital);
  registros.set(`lp-resumo-edital-v17:${edital.numeroControlePNCP}`, JSON.stringify({ salvoEm: Date.now(), estrutura: { resumoGeral: "Cache antigo recente" } }));
  assert.match(chave, /^lp-resumo-edital-v18:/);
  assert.equal(contexto.lerCacheLocalResumo(edital), null);
  registros.set(chave, JSON.stringify({ salvoEm: Date.now() - 25 * 60 * 60 * 1000, estrutura: { resumoGeral: "Antigo" } }));
  assert.equal(contexto.lerCacheLocalResumo(edital), null);
  assert.equal(registros.has(chave), false);
  registros.set(chave, JSON.stringify({ salvoEm: Date.now(), estrutura: { resumoGeral: "Completo antigo sem projeção" } }));
  assert.equal(contexto.lerCacheLocalResumo(edital), null);
  assert.equal(registros.has(chave), false);
  registros.set(chave, JSON.stringify({ salvoEm: Date.now() - 23 * 60 * 60 * 1000, estrutura: { resumoGeral: "Recente", versaoReferenciasQuestionamentos: 2, estruturaSintetica: { resumoGeral: "Recente" } } }));
  assert.equal(contexto.lerCacheLocalResumo(edital).estrutura.resumoGeral, "Recente");
});

test("cache parcial não esconde resumo corrigido no servidor", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("const VERSAO_CACHE_LOCAL_RESUMO =");
  const fim = html.indexOf("function escreverMensagemIA(", inicio);
  const registros = new Map();
  const contexto = vm.createContext({ localStorage: {
    getItem: chave => registros.get(chave),
    setItem: (chave, valor) => registros.set(chave, valor),
    removeItem: chave => registros.delete(chave),
  }, idOportunidade: () => "apui", lerMapa: () => ({}), empresaOperacionalId: null });
  vm.runInContext(html.slice(inicio, fim), contexto);
  const edital = { numeroControlePNCP: "22812960000199-1-000075/2026" };
  const chave = contexto.chaveCacheLocalResumo(edital);
  const parcial = { fonteLida: true, estrutura: { resumoGeral: "100/114", coberturaLeitura: { parcial: true } } };
  registros.set(chave, JSON.stringify({ ...parcial, salvoEm: Date.now() }));
  assert.equal(contexto.lerCacheLocalResumo(edital), null);
  assert.equal(registros.has(chave), false);
  contexto.salvarCacheLocalResumo(edital, parcial);
  assert.equal(registros.has(chave), false);
  contexto.salvarCacheLocalResumo(edital, { fonteLida: true, estrutura: { resumoGeral: "114/114", versaoReferenciasQuestionamentos: 2, estruturaSintetica: { resumoGeral: "114/114" }, coberturaLeitura: { parcial: false } } });
  assert.equal(contexto.lerCacheLocalResumo(edital).estrutura.resumoGeral, "114/114");
});

test("cache completo exige revisão canônica exata das referências e preserva dossiê pronto sem regenerar IA", () => {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("const VERSAO_CACHE_LOCAL_RESUMO ="), fim = html.indexOf("function escreverMensagemIA(", inicio);
  const registros = new Map();
  const contexto = vm.createContext({ localStorage: { getItem: chave => registros.get(chave), setItem: (chave, valor) => registros.set(chave, valor), removeItem: chave => registros.delete(chave) }, idOportunidade: () => "edital", lerMapa: () => ({}), empresaOperacionalId: null });
  vm.runInContext(html.slice(inicio, fim), contexto);
  const edital = { numeroControlePNCP: "11111111000111-1-000001/2026" }, chave = contexto.chaveCacheLocalResumo(edital);
  const estrutura = { hashFonte: "hash-canônico", estruturaSintetica: { versaoReferenciasQuestionamentos: 2 }, coberturaLeitura: { parcial: false }, evidenciasQuestionamentos: [{ texto: "Conferir a regra", evidencias: [] }] };
  for (const versao of [undefined, 1, "2", 3, null]) {
    registros.set(chave, JSON.stringify({ salvoEm: Date.now(), estrutura: { ...estrutura, versaoReferenciasQuestionamentos: versao } }));
    assert.equal(contexto.lerCacheLocalResumo(edital), null, `não reutilizar referência versão ${versao}`);
    assert.equal(registros.has(chave), false);
  }
  contexto.salvarCacheLocalResumo(edital, { fonteLida: true, estrutura: { ...estrutura, versaoReferenciasQuestionamentos: 2 } });
  const pronto = contexto.lerCacheLocalResumo(edital);
  assert.equal(pronto.estrutura.hashFonte, "hash-canônico");
  assert.equal(pronto.estrutura.versaoReferenciasQuestionamentos, 2);
  assert.equal(pronto.estrutura.evidenciasQuestionamentos.length, 1);
  const abrir = html.slice(html.indexOf("  function abrirModalIA("), html.indexOf('  document.getElementById("modal-ia-fechar").addEventListener'));
  assert.match(abrir, /const resumoLocal = lerCacheLocalResumo\(edital\)/);
  assert.match(abrir, /chamarIA\("resumo", null\);/);
  assert.doesNotMatch(abrir, /reprocessarFonte/);
});

test("boletim abre pela coleta do robô e só consulta PNCP por atualização explícita", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("const BOL_CACHE_VERSAO = 2;");
  const fim = html.indexOf("// ---------- Oportunidades ----------", inicio);
  const bloco = html.slice(inicio, fim);
  assert.ok(inicio >= 0 && fim > inicio);
  assert.match(bloco, /localStorage\.getItem\(chaveCacheBoletim\(filtro\)\)/);
  assert.match(bloco, /localStorage\.setItem\(chaveCacheBoletim\(filtro\)/);
  assert.match(bloco, /if \(!atualizarAoVivo\) \{/);
  assert.match(bloco, /resultadosDoRoboParaBoletim\(cacheOportunidades, ufs, palavras\)/);
  assert.match(bloco, /carregarOportunidadesSupabase\(estados\)/);
  assert.match(bloco, /bol-atualizar[\s\S]{0,180}atualizarAoVivo: true/);
  assert.doesNotMatch(bloco, /sessionStorage\.(getItem|setItem)\(chaveCacheBoletim/);
});

test("login não dispara restaurações de ferramentas que ainda estão fechadas", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  assert.doesNotMatch(html, /^\s*restaurarOportunidades\(\);\s*$/m);
  assert.doesNotMatch(html, /^\s*restaurarDiagnostico\(\);\s*$/m);
  assert.doesNotMatch(html, /^\s*restaurarEmpresa\(\);\s*$/m);
  assert.doesNotMatch(html, /^\s*restaurarRaioX\(\);\s*$/m);
  assert.doesNotMatch(html, /^\s*restaurarPrecos\(\);\s*$/m);
  assert.match(html, /nav button\[data-alvo="oportunidades"\][\s\S]{0,500}restaurarOportunidades/);
  assert.match(html, /nav button\[data-alvo="diagnostico"\][\s\S]{0,300}restaurarDiagnostico/);
});

// Cliente Supabase falso: cada "from().select()...range()" devolve uma thenable que resolve
// via "responder", chamado com o estado acumulado da query (inicio/fim pedidos, filtros de
// uf/or aplicados). Cobre o mapeamento de linha (dado jsonb -> registro) e a paginação de
// carregarOportunidadesSupabase/consultarOportunidadesSupabase, que antes só tinham
// chaveOportunidade testado (Task 2 Passo 6 do plano previa também o mapeamento de linha).
function clienteSupabaseFake(responder) {
  return {
    from: () => {
      const estado = {};
      const chain = {
        select: () => chain,
        order: () => chain,
        range: (inicio, fim) => { estado.inicio = inicio; estado.fim = fim; return chain; },
        in: (_coluna, valores) => { estado.uf = valores; return chain; },
        or: (str) => { estado.or = str; return chain; },
        then: (resolve, reject) => Promise.resolve(responder({ ...estado })).then(resolve, reject),
      };
      return chain;
    },
  };
}
function contextoOportunidadesSupabase(responder) {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("async function aguardarSupabaseAutenticado() {");
  const fim = html.indexOf("function sanitizarParaIlike(palavra) {", inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  const contexto = vm.createContext({
    window: { __sbClient: clienteSupabaseFake(responder), __clienteAtual: true },
    console: { error() {}, warn() {} },
  });
  vm.runInContext(html.slice(inicio, fim), contexto);
  return contexto;
}

test("consultarOportunidadesSupabase mapeia cada linha pro seu dado jsonb, sem vazar colunas indexadas", async () => {
  let chamadas = 0;
  const contexto = contextoOportunidadesSupabase(() => {
    chamadas++;
    if (chamadas === 1) return { data: [{ dado: { numeroControlePNCP: "1" }, chave: "1", uf: "AM" }, { dado: { numeroControlePNCP: "2" }, chave: "2", uf: "AM" }], error: null };
    return { data: [], error: null };
  });
  const resultado = await contexto.consultarOportunidadesSupabase([]);
  // JSON.stringify em vez de assert.deepEqual: os objetos vêm do contexto isolado do vm
  // (realm diferente), então deepStrictEqual os rejeitaria mesmo com estrutura idêntica.
  assert.equal(JSON.stringify(resultado), JSON.stringify({ registros: [{ numeroControlePNCP: "1" }, { numeroControlePNCP: "2" }] }));
});

test("paginação avança pelo tamanho real da página, não por um tamanho fixo assumido", async () => {
  // Simula um db-max-rows do projeto Supabase abaixo do PAGINA_OPORTUNIDADES_SUPABASE
  // (1000) pedido pelo código: o servidor nunca devolve mais que 500 linhas por vez,
  // mesmo esse não sendo o fim dos dados. Regressão pro bug em que o loop parava na
  // primeira página curta (pagina.length < tamanho pedido) e truncava o resultado em
  // silêncio.
  const total = 1200;
  let entregues = 0;
  const chamadasRange = [];
  const contexto = contextoOportunidadesSupabase(({ inicio, fim }) => {
    chamadasRange.push([inicio, fim]);
    const restantes = total - entregues;
    const tamanho = Math.min(500, restantes);
    const pagina = Array.from({ length: tamanho }, (_, i) => ({ dado: { id: entregues + i } }));
    entregues += tamanho;
    return { data: pagina, error: null };
  });
  const resultado = await contexto.consultarOportunidadesSupabase([]);
  assert.equal(resultado.registros.length, total);
  assert.equal(resultado.registros[0].id, 0);
  assert.equal(resultado.registros.at(-1).id, total - 1);
  // 500+500+200 preenche os 1200, e uma 4ª chamada com página vazia é quem encerra o loop.
  assert.equal(chamadasRange.length, 4);
});

test("consultarOportunidadesSupabase devolve null e não quebra em erro do Supabase", async () => {
  const contexto = contextoOportunidadesSupabase(() => ({ data: null, error: { message: "falhou" } }));
  assert.equal(await contexto.consultarOportunidadesSupabase([]), null);
});

test("resumo apresenta as seções sem faixa técnica e preserva o diagnóstico interno", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("  function renderizarEstruturaIA(");
  const fim = html.indexOf("  function atualizarCentralDefesa(", inicio);
  function elemento(tag) {
    return { tag, children: [], dataset: {}, style: {}, textContent: "", append(...filhos) { this.children.push(...filhos); }, appendChild(filho) { this.children.push(filho); }, setAttribute() {}, querySelector() { return null; } };
  }
  for (const fonteLida of [false, true]) {
    const conversa = elemento("div");
    const corpo = elemento("div");
    const ambiente = vm.createContext({
      iaEditalAtual: {}, iaItensPncpAtual: [], iaEstruturaAtual: null, iaCapagAtual: null,
      atualizarCentralDefesa() {},
      aplicarDadosOficiaisNaEstruturaIA: (est) => est,
      renderizarCartoesTopoIA() {},
      avisoCoberturaLeitura: () => "Leitura parcial: arquivo.pdf não lido, HTTP 503",
      ResumoModelo: { montarVisual: () => ({ secoes: [{ titulo: "Resumo dos Itens", campos: [{ rotulo: "Descrição", valor: "Papel A4" }] }] }) },
      document: { getElementById: id => id === "modal-ia-defesa" ? null : conversa, querySelector: () => corpo, createElement: elemento, createTextNode: (texto) => ({ textContent: texto }) },
    });
    vm.runInContext(html.slice(inicio, fim), ambiente);
    const entrada = { fonteLida, coberturaLeitura: { parcial: true, documentosNaoLidos: ["arquivo.pdf: HTTP 503"] } };
    ambiente.renderizarEstruturaIA(entrada);
    const visivel = JSON.stringify(conversa);
    assert.match(visivel, /Papel A4/);
    assert.doesNotMatch(visivel, /HTTP 503|Leitura parcial|arquivo\.pdf/);
    assert.equal(ambiente.iaEstruturaAtual.coberturaLeitura, entrada.coberturaLeitura);
  }
});

test("falha técnica não vaza no resumo, mas sessão expirada orienta novo login", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
  const inicio = html.indexOf("  function oferecerNovaAnalise(");
  const fim = html.indexOf("  // O dossiê completo", inicio);
  const mensagens = [];
  const ambiente = vm.createContext({
    console: { warn() {} },
    escreverMensagemIA: (texto) => { mensagens.push(texto); return { appendChild() {} }; },
    document: { createElement: () => ({ addEventListener() {} }) },
  });
  vm.runInContext(html.slice(inicio, fim), ambiente);
  ambiente.oferecerNovaAnalise("HTTP 503: documento indisponível");
  ambiente.oferecerNovaAnalise("Sessão expirada. Faça login novamente.", true);
  assert.equal(mensagens[0], "");
  assert.match(mensagens[1], /Faça login novamente/);
});
