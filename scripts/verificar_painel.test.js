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
  assert.match(html, /Gerar Checklist \(\.docx\)/);
  assert.match(html, /\/.netlify\/functions\/gerar-checklist/);
  assert.match(html, /logo\.png/);
  assert.doesNotMatch(html.slice(html.indexOf("function montarHtmlImpressaoResumo"), html.indexOf("function montarResumoParaCliente")), /marca-sinal/);
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
  assert.match(bloco, /data\/boletim\/\$\{uf\}\.json/);
  assert.match(bloco, /bol-atualizar[\s\S]{0,180}atualizarAoVivo: true/);
  assert.doesNotMatch(bloco, /sessionStorage\.(getItem|setItem)\(chaveCacheBoletim/);
});

test("robô publica uma projeção leve do boletim para cada UF", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const codigo = fs.readFileSync(path.join(__dirname, "atualizar_dados.js"), "utf8");
  assert.match(codigo, /async function gravarBoletinsPorUf/);
  assert.match(codigo, /path\.join\(dirDados, "boletim"\)/);
  assert.match(codigo, /path\.join\(diretorio, `\$\{uf\}\.json`\)/);
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
