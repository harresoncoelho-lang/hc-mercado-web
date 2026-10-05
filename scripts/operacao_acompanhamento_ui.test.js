const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const dominio = require("../operacao-acompanhamento");

function preparar() {
  const codigo = fs.readFileSync(path.join(__dirname, "..", "operacao-acompanhamento-ui.js"), "utf8");
  const janela = { LicitaAcompanhamento: dominio };
  vm.runInNewContext(codigo, { window: janela });
  const ouvintes = new Map();
  const elementos = new Map();
  for (const nome of ["resultado", "item", "ocorrencia", "contrato", "anexo"]) {
    elementos.set(`form-${nome}`, { addEventListener(evento, fn) { ouvintes.set(nome, fn); } });
  }
  elementos.set("d-conteudo", { addEventListener() {} });
  elementos.set("d-acompanhamento", { innerHTML: "" });
  elementos.set("btn-salvar-anexo", { disabled: false });
  const estado = { orgId: "org", empresaId: "empresa", itens: [], ocorrencias: [], contratos: [], anexos: [], prazos: [], empenhos: [], detalhesCarregados: true };
  const avisos = [];
  const deps = {
    estado, $: id => elementos.get(id), esc: valor => String(valor ?? "").replaceAll("<", "&lt;"),
    dinheiro: valor => `R$ ${valor}`, data: valor => valor || "—", dataHora: valor => valor || "—",
    linkSeguro: valor => /^https:\/\//.test(valor || "") ? valor : "",
    aviso: mensagem => avisos.push(mensagem), abrir() {}, fechar() {},
    async carregarTudo() {}, abrirDossie() {}, editarProcesso() {},
  };
  return { janela, ouvintes, elementos, estado, avisos, deps };
}

test("dossiê distingue resultado manual de itens ganhos e conserva ocorrências", () => {
  const ambiente = preparar();
  Object.assign(ambiente.estado, {
    itens: [{ processo_id: "p", tipo: "item", identificador: "1", situacao: "ganho", descricao: "Papel", valor_homologado: 50 }],
    ocorrencias: [{ processo_id: "p", ocorrido_em: "2026-10-05T10:00:00Z", categoria: "chat", descricao: "Diligência recebida" }],
  });
  const ui = ambiente.janela.criarAcompanhamentoOperacional(ambiente.deps);
  ui.renderizar({ id: "p", situacao_resultado: "sem_vitoria", valor_homologado: 0 });
  const texto = ambiente.elementos.get("d-acompanhamento").innerHTML;
  assert.match(texto, /Vitória total/);
  assert.match(texto, /R\$ 50/);
  assert.match(texto, /Diligência recebida/);
  assert.doesNotMatch(texto, /R\$ 0/);
});

test("item perdido não recebe valor homologado à empresa", async () => {
  const ambiente = preparar();
  let gravacoes = 0;
  ambiente.deps.sb = { from: () => ({ insert() { gravacoes++; return Promise.resolve({ error: null }); } }) };
  const formulario = { dados: new Map([["processo_id", "p"], ["tipo", "item"], ["identificador", "1"], ["situacao", "perdido"], ["valor_homologado", "100"]]) };
  const contexto = { FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } } };
  // O módulo usa FormData do navegador; o teste injeta a versão controlada no realm.
  const codigo = fs.readFileSync(path.join(__dirname, "..", "operacao-acompanhamento-ui.js"), "utf8");
  const janela = { LicitaAcompanhamento: dominio };
  vm.runInNewContext(codigo, { window: janela, ...contexto });
  const uiComForm = janela.criarAcompanhamentoOperacional(ambiente.deps);
  uiComForm.vincular();
  await ambiente.ouvintes.get("item")({ preventDefault() {}, currentTarget: formulario });
  assert.equal(gravacoes, 0);
  assert.match(ambiente.avisos[0], /só cabe em item ganho/);
});

test("anexo mantém o formulário após o await e registra o arquivo privado", async () => {
  const ambiente = preparar();
  const chamadas = [];
  const arquivo = { name: "Contrato 12.pdf", size: 1024 };
  const formulario = { dados: new Map([["processo_id", "p"], ["tipo", "contrato"], ["titulo", "Contrato assinado"], ["arquivo", arquivo]]), reset() { chamadas.push("reset"); } };
  const evento = { currentTarget: formulario, preventDefault() {} };
  ambiente.deps.sb = {
    storage: { from: () => ({ async upload() { evento.currentTarget = null; chamadas.push("upload"); return { error: null }; }, async remove() { throw new Error("não deveria remover"); } }) },
    from: () => ({ async insert(dados) { chamadas.push("insert"); assert.equal(dados.tipo, "contrato"); assert.match(dados.arquivo_caminho, /^org\/empresa\/p\//); return { error: null }; } }),
  };
  const codigo = fs.readFileSync(path.join(__dirname, "..", "operacao-acompanhamento-ui.js"), "utf8");
  const janela = { LicitaAcompanhamento: dominio };
  vm.runInNewContext(codigo, {
    window: janela,
    crypto: { randomUUID: () => "arquivo" },
    FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } },
  });
  janela.criarAcompanhamentoOperacional(ambiente.deps).vincular();
  await ambiente.ouvintes.get("anexo")(evento);
  assert.deepEqual(chamadas, ["upload", "insert", "reset"]);
  assert.equal(ambiente.elementos.get("btn-salvar-anexo").disabled, false);
  assert.match(ambiente.avisos[0], /sucesso/);
});

test("resultado manual guarda valor sem confundir estágio com vitória", async () => {
  const ambiente = preparar();
  let payload;
  const formulario = { dados: new Map([["processo_id", "p"], ["situacao_resultado", "vitoria_parcial"], ["valor_homologado", "350.50"]]), reset() {} };
  const evento = { currentTarget: formulario, preventDefault() {} };
  ambiente.deps.sb = { from: () => ({ update(dados) { payload = dados; return { eq() { return { async eq() { evento.currentTarget = null; return { error: null }; } }; } }; } }) };
  const codigo = fs.readFileSync(path.join(__dirname, "..", "operacao-acompanhamento-ui.js"), "utf8");
  const janela = { LicitaAcompanhamento: dominio };
  vm.runInNewContext(codigo, { window: janela, FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } } });
  janela.criarAcompanhamentoOperacional(ambiente.deps).vincular();
  await ambiente.ouvintes.get("resultado")(evento);
  assert.equal(payload.situacao_resultado, "vitoria_parcial");
  assert.equal(payload.valor_homologado, 350.5);
  assert.equal(ambiente.avisos.length, 0);
});

test("falha ao registrar metadados remove o arquivo recém-enviado", async () => {
  const ambiente = preparar();
  const chamadas = [];
  const formulario = { dados: new Map([["processo_id", "p"], ["tipo", "empenho"], ["titulo", "Empenho 12"], ["arquivo", { name: "empenho.pdf", size: 500 }]]), reset() { chamadas.push("reset"); } };
  ambiente.deps.sb = {
    storage: { from: () => ({ async upload() { chamadas.push("upload"); return { error: null }; }, async remove() { chamadas.push("remover"); return { error: null }; } }) },
    from: () => ({ async insert() { chamadas.push("insert"); return { error: new Error("falha na tabela") }; } }),
  };
  const codigo = fs.readFileSync(path.join(__dirname, "..", "operacao-acompanhamento-ui.js"), "utf8");
  const janela = { LicitaAcompanhamento: dominio };
  vm.runInNewContext(codigo, {
    window: janela, crypto: { randomUUID: () => "arquivo" },
    FormData: class { constructor(form) { this.dados = form.dados; } get(chave) { return this.dados.get(chave) || null; } },
  });
  janela.criarAcompanhamentoOperacional(ambiente.deps).vincular();
  await ambiente.ouvintes.get("anexo")({ currentTarget: formulario, preventDefault() {} });
  assert.deepEqual(chamadas, ["upload", "insert", "remover"]);
  assert.equal(ambiente.elementos.get("btn-salvar-anexo").disabled, false);
  assert.match(ambiente.avisos[0], /falha na tabela/);
});
