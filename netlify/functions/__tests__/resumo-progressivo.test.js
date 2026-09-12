const test = require("node:test");
const assert = require("node:assert/strict");
const { dividirFonte, conciliarEstruturas, executarEtapa } = require("../_resumo_progressivo");

function memoria() {
  let estado = null, versao = 0;
  return {
    async getWithMetadata() { return estado ? { data: JSON.parse(JSON.stringify(estado)), etag: String(versao) } : null; },
    async setJSON(_chave, valor, opcoes = {}) {
      if ((opcoes.onlyIfNew && estado) || (opcoes.onlyIfMatch && opcoes.onlyIfMatch !== String(versao))) return { modified: false };
      estado = JSON.parse(JSON.stringify(valor)); versao++; return { modified: true, etag: String(versao) };
    },
  };
}

const fonte = `--- Edital ---\n[Página 1]\n${"Prazo e documentos. ".repeat(1800)}\n[Página 2]\n${"Condições da habilitação. ".repeat(1200)}\n[Página 3]\nEntrega em 30 dias. Pagamento em 30 dias.`;

test("blocos conservam todas as páginas completas e sua referência documental", () => {
  const blocos = dividirFonte(fonte);
  assert.equal(blocos.length, 2);
  assert.ok(blocos.every((bloco) => bloco.length <= 45000 && bloco.includes("--- Edital ---")));
  for (const pagina of fonte.split(/(?=\[Página \d+\])/).slice(1)) assert.ok(blocos.some((bloco) => bloco.includes(pagina)));
});

test("DOCX extenso sem páginas é dividido sem perder parágrafos nem conteúdo", () => {
  const titulo = "--- Termo de referência.docx ---\n";
  const paragrafos = Array.from({ length: 180 }, (_, indice) => `${indice + 1}. Exigência documental ${"com suas condições e alternativas ".repeat(12)}fim do parágrafo.\n`);
  const texto = titulo + paragrafos.join("");
  const blocos = dividirFonte(texto);
  assert.ok(blocos.length > 1);
  assert.ok(blocos.every((bloco) => bloco.length <= 45000 && bloco.startsWith(titulo)));
  for (const paragrafo of paragrafos) assert.ok(blocos.some((bloco) => bloco.includes(paragrafo)));
  assert.equal(blocos.map((bloco) => bloco.replace(titulo, "")).join(""), paragrafos.join(""));
});

test("anexo sem quebras de linha e PDF paginado podem coexistir sem corte de página", () => {
  const titulo = "--- Anexo.docx ---\n";
  const anexo = "Condição extensa sem parágrafos. ".repeat(1800);
  const pdf = "--- Edital.pdf ---\n[Página 1]\nUma página íntegra do edital.";
  const blocos = dividirFonte(titulo + anexo + "\n" + pdf);
  assert.ok(blocos.length > 1);
  assert.ok(blocos.some((bloco) => bloco.includes(pdf)));
  const reconstruido = blocos.join("").split(titulo).join("");
  assert.equal(reconstruido, anexo + "\n" + pdf);
});

test("progresso retoma resultados e não chama provedor durante cooldown", async () => {
  const store = memoria(); let chamadas = 0;
  const executar = async () => { chamadas++; return { estrutura: { documentosHabilitacao: [`Documento ${chamadas} [R000${chamadas}]`], entregaExecucao: { prazo: "30 dias" } } }; };
  const inicial = { texto: fonte, coberturaLeitura: { parcial: false } };
  const primeira = await executarEtapa({ store, chave: "pncp", inicial, executar });
  assert.equal(primeira.pendente.progresso.concluidas, 1);
  assert.equal(primeira.pendente.progresso.total, 2);
  await executarEtapa({ store, chave: "pncp", inicial, executar });
  assert.equal(chamadas, 1);
  const final = await executarEtapa({ store, chave: "pncp", inicial, executar, agora: Date.now() + 66000 });
  assert.equal(chamadas, 2);
  assert.equal(final.estrutura.documentosHabilitacao.length, 2);
  assert.equal(final.estrutura.entregaExecucao.prazo, "30 dias");
});

test("duas abas concorrentes executam a etapa uma vez", async () => {
  const store = memoria(); let chamadas = 0;
  const executar = async () => { chamadas++; await new Promise((resolve) => setTimeout(resolve, 5)); return { estrutura: { resumoGeral: "Dados lidos" } }; };
  await Promise.all([1, 2].map(() => executarEtapa({ store, chave: "pncp", inicial: { texto: fonte }, executar })));
  assert.equal(chamadas, 1);
});

test("três falhas param retries automáticos e retomada explícita respeita Retry-After", async () => {
  const store = memoria(); let chamadas = 0;
  const executar = async () => { chamadas++; return { erro: "Limite", diagnostico: { limites: { "retry-after": 120 } } }; };
  const args = { store, chave: "pncp", inicial: { texto: fonte }, executar };
  for (let i = 0; i < 3; i++) await executarEtapa({ ...args, agora: Date.now() + i * 121000 });
  const bloqueado = await executarEtapa({ ...args, agora: Date.now() + 400000 });
  assert.equal(bloqueado.falhou, true);
  assert.equal(chamadas, 3);
  const retomada = await executarEtapa({ ...args, retomar: true });
  assert.equal(retomada.pendente.progresso.aguardarSegundos, 120);
  assert.equal(chamadas, 3);
});

test("conciliação conserva divergências e não preenche ausências com suposição", () => {
  const final = conciliarEstruturas([{ entregaExecucao: { prazo: "30 dias [Edital, p. 2]" }, documentosHabilitacao: ["CNPJ"] }, { entregaExecucao: { prazo: "60 dias [TR, p. 8]" }, documentosHabilitacao: ["CNPJ", "Atestado"] }, { entregaExecucao: { prazo: "Não informado" } }]);
  assert.match(final.entregaExecucao.prazo, /30 dias.*Edital[\s\S]*60 dias.*TR/);
  assert.deepEqual(final.documentosHabilitacao, ["CNPJ", "Atestado"]);
});

test("cota individual esgotada não incrementa falhas nem bloqueia outro usuário", async () => {
  const store = memoria();
  const args = { store, chave: "pncp", inicial: { texto: fonte } };
  for (let i = 0; i < 3; i++) {
    const resultado = await executarEtapa({ ...args, executar: async () => ({ quota: 429, erro: "Cota individual" }) });
    assert.equal(resultado.status, 429);
  }
  const estado = (await store.getWithMetadata()).data;
  assert.equal(estado.falhas, 0);
  assert.equal(estado.proximaEtapaEm, 0);
  const outro = await executarEtapa({ ...args, executar: async () => ({ estrutura: { resumoGeral: "Documento analisado" } }) });
  assert.equal(outro.pendente.progresso.concluidas, 1);
});

test("conclusão atrasada não sobrescreve nova reserva vencedora", async () => {
  const store = memoria(); let liberar, iniciou;
  const inicio = new Promise((resolve) => { iniciou = resolve; });
  const espera = new Promise((resolve) => { liberar = resolve; });
  const args = { store, chave: "pncp", inicial: { texto: "--- Edital ---\n[Página 1]\nFonte completa" } };
  const antiga = executarEtapa({ ...args, executar: async () => { iniciou(); await espera; return { estrutura: { resumoGeral: "Resultado antigo" } }; } });
  await inicio;
  await executarEtapa({ ...args, agora: Date.now() + 66000, executar: async () => ({ estrutura: { resumoGeral: "Resultado vencedor" } }) });
  liberar();
  assert.equal((await antiga).estrutura.resumoGeral, "Resultado vencedor");
  assert.equal((await store.getWithMetadata()).data.resultados[0].resumoGeral, "Resultado vencedor");
});

test("sanitização final conserva exigência do quinto bloco além dos limites antigos", () => {
  const { sanitizarListasDoDossie } = require("../ia-edital").__test;
  const estruturas = Array.from({ length: 5 }, (_, bloco) => ({
    outrasInformacoesRelevantes: Array.from({ length: 4 }, (_, item) => `Exigência ${bloco * 4 + item}: documento obrigatório [TR, página ${bloco + 1}]`),
    pendenciasParaConferencia: Array.from({ length: 3 }, (_, item) => `Conferir condição ${bloco * 3 + item}`),
  }));
  const final = sanitizarListasDoDossie(conciliarEstruturas(estruturas));
  assert.equal(final.outrasInformacoesRelevantes.length, 20);
  assert.ok(final.outrasInformacoesRelevantes.some((item) => item.includes("Exigência 19")));
  assert.ok(final.pendenciasParaConferencia.some((item) => item.includes("condição 14")));
});

test("robô conta HTTP202 como pendente, sem anunciar dossiê gerado", async () => {
  const antigoFetch = global.fetch, antigaChave = process.env.DOSSIES_EDITAIS_CHAVE;
  process.env.DOSSIES_EDITAIS_CHAVE = "chave-teste";
  global.fetch = async () => ({ ok: true, status: 202, json: async () => ({ emProcessamento: true, progresso: { concluidas: 1, total: 5 } }) });
  try {
    const { prepararUm } = require("../../../scripts/preparar_dossies_editais");
    assert.equal(await prepararUm({ numeroControlePNCP: "12345678000199-1-1/2026" }), "pendente");
  } finally {
    global.fetch = antigoFetch;
    if (antigaChave === undefined) delete process.env.DOSSIES_EDITAIS_CHAVE;
    else process.env.DOSSIES_EDITAIS_CHAVE = antigaChave;
  }
});
