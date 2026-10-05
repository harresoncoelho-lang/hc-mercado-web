const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("central operacional mantém o script inline sintaticamente válido", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
  const scripts = html.split("<script>").slice(1).map((trecho) => trecho.split("</script>")[0]);
  assert.equal(scripts.length, 2);
  scripts.forEach((script, indice) => new vm.Script(script, { filename: `operacao-inline-${indice + 1}.js` }));
});

test("salvar documento conclui após currentTarget do evento ficar nulo", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
  const inicio = html.indexOf("  async function enviarArquivo(");
  const fim = html.indexOf("  async function selecionarEmpresaExistente(", inicio);
  assert.ok(inicio > 0 && fim > inicio);
  const chamadas = [];
  const formulario = {
    dados: new Map([["tipo", "Certidão Federal"], ["arquivo", { name: "certidao.pdf" }]]),
    reset() { chamadas.push("reset"); },
  };
  const evento = { currentTarget: formulario, preventDefault() {} };
  const botao = { disabled: false };
  const contexto = {
    estado: { orgId: "org", empresaId: "empresa" },
    FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } },
    crypto: { randomUUID: () => "arquivo" },
    sb: {
      storage: { from: () => ({ async upload() { chamadas.push("upload"); evento.currentTarget = null; return { error: null }; } }) },
      from: () => ({ async insert(dados) { chamadas.push("insert"); assert.equal(dados.arquivo_nome, "certidao.pdf"); return { error: null }; } }),
    },
    $: () => botao,
    fecharModal: () => chamadas.push("fechar"),
    carregarDocumentos: async () => chamadas.push("recarregar"),
    aviso: (mensagem, tipo) => chamadas.push(`${tipo}:${mensagem}`),
  };
  vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.salvarDocumento = salvarDocumento;`, contexto);
  await contexto.salvarDocumento(evento);
  assert.deepEqual(chamadas, ["upload", "insert", "reset", "fechar", "info:Documento salvo com sucesso.", "recarregar"]);
  assert.equal(botao.disabled, false);
});

test("falha ao atualizar a lista não transforma documento gravado em falha de salvamento", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
  const inicio = html.indexOf("  async function enviarArquivo(");
  const fim = html.indexOf("  async function selecionarEmpresaExistente(", inicio);
  const mensagens = [];
  const formulario = { dados: new Map([["tipo", "Certidão Federal"]]), reset() {} };
  const contexto = {
    estado: { orgId: "org", empresaId: "empresa" },
    FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } },
    sb: { from: () => ({ async insert() { return { error: null }; } }) },
    $: () => ({ disabled: false }),
    fecharModal: () => {},
    carregarDocumentos: async () => { throw new Error("rede indisponível"); },
    aviso: (mensagem) => mensagens.push(mensagem),
  };
  vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.salvarDocumento = salvarDocumento;`, contexto);
  await contexto.salvarDocumento({ currentTarget: formulario, preventDefault() {} });
  assert.deepEqual(mensagens, ["Documento salvo com sucesso.", "Documento salvo, mas não foi possível atualizar a lista: rede indisponível"]);
});

test("formulário sem arquivo não envia objeto File vazio ao Storage", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
  const inicio = html.indexOf("  async function enviarArquivo(");
  const fim = html.indexOf("  async function abrirArquivo(", inicio);
  let envios = 0;
  const contexto = { sb: { storage: { from: () => ({ upload: async () => { envios++; return { error: null }; } }) } } };
  vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.enviarArquivo = enviarArquivo;`, contexto);
  assert.deepEqual(Object.keys(await contexto.enviarArquivo({ name: "" })), []);
  assert.equal(envios, 0);
});

test("salvar compromisso não depende de currentTarget após a gravação", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
  const inicio = html.indexOf("  async function salvarEvento(");
  const fim = html.indexOf("  function exportar(", inicio);
  const chamadas = [];
  const formulario = {
    dados: new Map([["categoria", "sessao"], ["titulo", "Sessão do pregão"], ["vencimento", "2026-10-20T10:00"]]),
    reset() { chamadas.push("reset"); },
  };
  const evento = { currentTarget: formulario, preventDefault() {} };
  const contexto = {
    estado: { orgId: "org", empresaId: "empresa" },
    FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } },
    sb: { from: () => ({ async insert() { evento.currentTarget = null; chamadas.push("insert"); return { error: null }; } }) },
    aviso: () => {},
    fecharModal: () => chamadas.push("fechar"),
    carregarAgenda: async () => chamadas.push("recarregar"),
  };
  vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.salvarEvento = salvarEvento;`, contexto);
  await contexto.salvarEvento(evento);
  assert.deepEqual(chamadas, ["insert", "reset", "fechar", "recarregar"]);
});

test("agenda mantém compromissos vencidos visíveis", async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "operacao.html"), "utf8");
  const inicio = html.indexOf("  async function carregarAgenda(");
  const fim = html.indexOf("  async function enviarArquivo(", inicio);
  const alvo = { innerHTML: "" };
  const registros = [
    { titulo: "Sessão pendente", categoria: "sessao", vencimento: "2020-01-01T10:00:00Z" },
    { titulo: "Prazo futuro", categoria: "proposta", vencimento: "2099-01-01T10:00:00Z" },
  ];
  const query = {
    select() { return this; }, eq() { return this; }, is() { return this; },
    order() { return this; }, async limit() { return { data: registros, error: null }; },
  };
  const contexto = {
    estado: { empresaId: "empresa" }, sb: { from: () => query }, $: () => alvo,
    esc: valor => String(valor),
  };
  vm.runInNewContext(`${html.slice(inicio, fim)}\nthis.carregarAgenda = carregarAgenda;`, contexto);
  await contexto.carregarAgenda();
  assert.match(alvo.innerHTML, /Em atraso · sessao/);
  assert.match(alvo.innerHTML, /Prazo futuro/);
});
