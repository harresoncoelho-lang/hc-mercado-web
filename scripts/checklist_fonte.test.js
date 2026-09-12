const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
function extrair(nome) {
  const inicio = html.search(new RegExp(`  (?:async )?function ${nome}\\(`));
  assert.ok(inicio >= 0);
  return html.slice(inicio, html.indexOf("\n  }", inicio) + 4);
}
function contexto() {
  const avisos = [];
  let chamadas = 0;
  const ambiente = vm.createContext({
    escreverMensagemIA: (aviso) => avisos.push(aviso),
    fetch: () => { chamadas++; },
  });
  for (const nome of ["textoIA", "avisoCoberturaLeitura", "podeGerarChecklist", "montarChecklistTexto", "baixarChecklistDocx"]) vm.runInContext(extrair(nome), ambiente);
  return { ambiente, avisos, chamadas: () => chamadas };
}

test("ficha sem leitura não exporta nem chama endpoint DOCX", async () => {
  const { ambiente, avisos, chamadas } = contexto();
  await ambiente.baixarChecklistDocx({}, { fonteLida: false, documentosHabilitacao: ["Requisito presumido"] }, {});
  assert.equal(chamadas(), 0);
  assert.match(avisos[0], /aguarde a leitura/);
  assert.equal(ambiente.podeGerarChecklist({ fonteLida: true, documentosHabilitacao: ["Não informado"] }), false);
});

test("checklist conserva categorias e referências sem truncar requisitos", () => {
  const { ambiente } = contexto();
  const requisito = `${"Documentação exigida expressamente. ".repeat(20)}[Edital (#1), página 12]`;
  const estrutura = {
    fonteLida: true, documentosCredenciamento: [requisito], requisitosProposta: ["Enviar planilha de preços [Edital, p. 18]"],
    documentosHabilitacao: ["Regularidade fiscal: certidão federal [item 7.2]"], declaracoesExigidas: ["Declaração unificada [Anexo II]"],
    anexosDeclaracoes: "Modelo de proposta — Anexo III",
    coberturaLeitura: { parcial: true, documentosLidos: ["Edital"], documentosNaoLidos: ["Anexo técnico"], motivos: ["Arquivo escaneado"] },
  };
  const texto = ambiente.montarChecklistTexto({}, estrutura);
  assert.ok(texto.includes(requisito));
  assert.match(texto, /Preparação e envio da proposta/);
  assert.match(texto, /Regularidade fiscal/);
  assert.match(texto, /Modelo de proposta/);
  assert.match(texto, /Leitura parcial/);
  assert.match(texto, /Anexo técnico/);
  assert.equal(ambiente.podeGerarChecklist(estrutura), true);
});

test("cobertura desconhecida ou análise degradada não promete leitura integral", () => {
  const { ambiente } = contexto();
  assert.match(ambiente.avisoCoberturaLeitura({ fonteLida: true }), /Leitura parcial/);
  assert.match(ambiente.avisoCoberturaLeitura({ fonteLida: true, modoDegradado: true, coberturaLeitura: { parcial: false } }), /Leitura parcial/);
  assert.doesNotMatch(ambiente.avisoCoberturaLeitura({ fonteLida: true, coberturaLeitura: { parcial: false, documentosLidos: ["Edital"] } }), /Leitura parcial/);
});

test("exportação anterior não habilita nem altera o checklist do novo modal pendente", async () => {
  const { ambiente, avisos } = contexto();
  let concluir;
  Object.assign(ambiente, {
    iaGeracaoModal: 1, iaResumoPendente: false,
    aguardarSupabaseAutenticado: async () => {},
    window: { __sbClient: { auth: { getSession: async () => ({ data: { session: { access_token: "teste" } } }) } } },
    fetch: () => new Promise((resolve) => { concluir = resolve; }),
  });
  const botao = { disabled: false, textContent: "Gerar Checklist (.docx)" };
  const exportacao = ambiente.baixarChecklistDocx({}, { fonteLida: true, documentosHabilitacao: ["CNPJ"] }, botao);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(botao.textContent, "Gerando checklist...");
  ambiente.iaGeracaoModal = 2;
  ambiente.iaResumoPendente = true;
  botao.disabled = true;
  botao.textContent = "Gerar Checklist (.docx)";
  concluir({ ok: false, json: async () => ({ erro: "Falha do edital anterior" }) });
  await exportacao;
  assert.equal(botao.disabled, true);
  assert.equal(botao.textContent, "Gerar Checklist (.docx)");
  assert.deepEqual(avisos, []);
  assert.match(extrair("abrirModalIA"), /modal-ia-checklist-doc"\)\.innerHTML = .*Gerar Checklist/);
});

test("erro de exportação no modal atual restaura o botão e comunica a falha", async () => {
  const { ambiente, avisos } = contexto();
  Object.assign(ambiente, {
    iaGeracaoModal: 1, iaResumoPendente: false,
    aguardarSupabaseAutenticado: async () => { throw new Error("Sessão expirada"); },
  });
  const botao = { disabled: false, textContent: "Gerar Checklist (.docx)" };
  await ambiente.baixarChecklistDocx({}, { fonteLida: true, documentosHabilitacao: ["CNPJ"] }, botao);
  assert.equal(botao.disabled, false);
  assert.equal(botao.textContent, "Gerar Checklist (.docx)");
  assert.deepEqual(avisos, ["Sessão expirada"]);
});
