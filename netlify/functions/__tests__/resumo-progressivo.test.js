const test = require("node:test");
const assert = require("node:assert/strict");
const { dividirFonte, dividirBlocoRejeitado, conciliarEstruturas, executarEtapa } = require("../_resumo_progressivo");

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

test("etapas limitam JSON UTF-8 completo preservando páginas e IDs globais do catálogo", () => {
  const { montarCorpoGroq, mensagensDaEtapa } = require("../lib/ia-edital").__test;
  const paginas = Array.from({ length: 12 }, (_, i) => `[Página ${i + 1}]\n${i + 1}. Exigência documental. ${"Ação e habilitação: condições, órgão, preços. ".repeat(150)}\n`);
  const texto = `--- Edital ---\n${paginas.join("")}`;
  const indice = paginas.map((_, i) => `[R${String(i + 1).padStart(4, "0")}] documentosHabilitacao: [Edital, página ${i + 1}], cláusulas ${i + 1}`).join("\n");
  const mensagens = (bloco) => mensagensDaEtapa("Instruções completas. ".repeat(300), "Ficha com órgão e objeto", indice, bloco);
  const bytes = (bloco) => Buffer.byteLength(JSON.stringify(montarCorpoGroq("groq/compound-mini", mensagens(bloco), { maxTokens: 6000, json: true })), "utf8");
  const blocos = dividirFonte(texto, 45000, (bloco) => bytes(bloco) <= 48000);
  assert.ok(blocos.length > 1);
  assert.ok(blocos.every((bloco) => bytes(bloco) <= 48000));
  for (const pagina of paginas) assert.ok(blocos.some((bloco) => bloco.includes(pagina)));
  const ultimo = mensagens(blocos.at(-1))[1].content;
  assert.match(ultimo, /R0012/);
  assert.doesNotMatch(ultimo, /R0001/);
  assert.ok(texto.endsWith(paginas.at(-1)));
});

test("DOCX com caracteres multibyte conserva conteúdo sob orçamento do JSON", () => {
  const corpo = "Cláusula: ação, órgão e habilitação.\n".repeat(4000);
  const rotulo = "--- Edital.docx ---\n";
  const bytes = (bloco) => Buffer.byteLength(JSON.stringify({ instructions: "Regras. ".repeat(1000), content: bloco }), "utf8");
  const blocos = dividirFonte(rotulo + corpo, 45000, (bloco) => bytes(bloco) <= 48000);
  assert.ok(blocos.every((bloco) => bytes(bloco) <= 48000));
  assert.equal(blocos.map((bloco) => bloco.replace(rotulo, "")).join(""), corpo);
});

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
  const { sanitizarListasDoDossie } = require("../lib/ia-edital").__test;
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

test("413 subdivide só a etapa recusada e preserva ordem, páginas e resultados anteriores", async () => {
  const store = memoria();
  const paginas = Array.from({ length: 4 }, (_, i) => `[Página ${i + 1}]\n${i + 1}. Exigência ${"condição e ação. ".repeat(300)}\n`);
  const rejeitado = `--- Edital ---\n${paginas.join("")}`;
  await store.setJSON("pncp", { texto: rejeitado, blocos: ["Etapa concluída", rejeitado, "Última etapa"], resultados: [{ resumoGeral: "Preservado" }], falhas: 0, proximaEtapaEm: 0, expiraEm: Date.now() + 86400000 });
  let chamadas = 0;
  const retorno = await executarEtapa({ store, chave: "pncp", inicial: {}, executar: async () => { chamadas++; return { diagnostico: { status: 413 }, erro: "Request Entity Too Large" }; } });
  assert.equal(chamadas, 1);
  assert.equal(retorno.pendente.progresso.concluidas, 1);
  const estado = (await store.getWithMetadata()).data;
  assert.equal(estado.falhas, 0);
  assert.deepEqual(estado.resultados, [{ resumoGeral: "Preservado" }]);
  assert.equal(estado.blocos[0], "Etapa concluída");
  assert.equal(estado.blocos.at(-1), "Última etapa");
  const novos = estado.blocos.slice(1, -1);
  assert.equal(novos.length, 2);
  for (const pagina of paginas) assert.ok(novos.some((parte) => parte.includes(pagina)));
  assert.ok(novos.every((parte) => Buffer.byteLength(parte) < Buffer.byteLength(rejeitado)));
  await executarEtapa({ store, chave: "pncp", inicial: {}, executar: async () => { chamadas++; return {}; } });
  assert.equal(chamadas, 1, "cooldown permanece ativo");
});

test("retomada de 413 antigo reduz antes de chamar provedor e página única encerra sem retry idêntico", async () => {
  const store = memoria();
  const bloco = "--- Edital ---\n[Página 1]\nDocumento A.\n[Página 2]\nDocumento B.";
  await store.setJSON("pncp", { texto: bloco, blocos: [bloco], resultados: [], diagnostico: { status: 413 }, falhas: 1, proximaEtapaEm: 0, expiraEm: Date.now() + 86400000 });
  let chamadas = 0;
  const args = { store, chave: "pncp", inicial: {}, executar: async () => { chamadas++; return { diagnostico: { status: 413 }, erro: "Recusado" }; } };
  const divisao = await executarEtapa(args);
  assert.equal(chamadas, 0);
  assert.equal(divisao.pendente.progresso.total, 2);
  const parada = await executarEtapa({ ...args, agora: Date.now() + 66000 });
  assert.equal(parada.falhou, true);
  assert.equal(chamadas, 1);
  const nova = await executarEtapa({ ...args, retomar: true, agora: Date.now() + 132000 });
  assert.equal(nova.falhou, true);
  assert.equal(chamadas, 1);
});

test("subdivisão DOCX preserva texto integral e para em tamanho mínimo", () => {
  const rotulo = "--- Anexo.docx ---\n", corpo = "Condição de habilitação e proposta.\n".repeat(350);
  const partes = dividirBlocoRejeitado(rotulo + corpo);
  assert.ok(partes.length >= 2);
  assert.equal(partes.map((parte) => parte.replace(rotulo, "")).join(""), corpo);
  assert.deepEqual(dividirBlocoRejeitado(rotulo + "Condição curta."), []);
});

test("evidência de formato inválido fica só no job limitado e some após sucesso", async () => {
  const store = memoria();
  const textoModelo = "EVIDENCIA_PRIVADA ".repeat(3000);
  const args = { store, chave: "pncp", inicial: { texto: fonte } };
  const falha = await executarEtapa({ ...args, executar: async () => ({ texto: textoModelo, erro: "Formato incompleto", diagnostico: { status: 200, parsing: "json_invalido" } }) });
  assert.equal((await store.getWithMetadata()).data.ultimaRespostaNaoEstruturada.length, 32000);
  assert.doesNotMatch(JSON.stringify(falha.pendente), /EVIDENCIA_PRIVADA/);
  await executarEtapa({ ...args, agora: Date.now() + 66000, executar: async () => ({ estrutura: { resumoGeral: "Análise válida" } }) });
  assert.equal((await store.getWithMetadata()).data.ultimaRespostaNaoEstruturada, undefined);
});

test("vinte etapas e retry consomem uma cota por usuário no job", async () => {
  const store = memoria(); let cotas = 0, tentativas = 0;
  const opcoes = { store, chave: "cota", inicial: { texto: "fonte" }, usuario: "usuario-a",
    dividir: () => Array(20).fill("página"), autorizar: async () => { cotas++; return { ok: true }; },
    executar: async () => ++tentativas === 1 ? { erro: "Falha temporária" } : ({ estrutura: { resumoGeral: "fato" } }) };
  let resultado;
  for (let i = 0; i < 21; i++) resultado = await executarEtapa({ ...opcoes, agora: Date.now() + (i + 1) * 70000 });
  assert.equal(cotas, 1); assert.equal(resultado.estado.resultados.length, 20);
  assert.ok(resultado.estrutura);
});

test("quota negada não bloqueia outro usuário nem o robô", async () => {
  const store = memoria(); let chamadas = 0;
  const opcoes = { store, chave: "cota", inicial: { texto: "fonte" }, dividir: () => ["a", "b"],
    executar: async () => { chamadas++; return { estrutura: { resumoGeral: "fato" } }; } };
  const negado = await executarEtapa({ ...opcoes, usuario: "sem-cota", autorizar: async () => ({ ok: false, status: 429, erro: "cota" }) });
  assert.equal(negado.status, 429); assert.equal(negado.estado.falhas, 0); assert.equal(chamadas, 0);
  const robo = await executarEtapa({ ...opcoes, autorizar: async () => { throw new Error("Robô não consome cota"); } });
  assert.equal(robo.estado.resultados.length, 1); assert.equal(chamadas, 1);
});

test("orçamento inclui instruções ficha catálogo e acentos sem perder páginas", () => {
  const { tokensEntradaResumo, cabeResumo, mensagensDaEtapa, INSTRUCOES_ETAPA } = require("../lib/ia-edital").__test;
  const paginas = Array.from({ length: 20 }, (_, i) => `[Página ${i + 1}]\n${"Habilitação e condições: órgão público. ".repeat(100)}\n`);
  const texto = "--- Edital ---\n" + paginas.join("");
  const mensagens = (bloco) => mensagensDaEtapa(INSTRUCOES_ETAPA, "Ficha oficial", "Catálogo", bloco);
  const blocos = dividirFonte(texto, 45000, (bloco) => cabeResumo(mensagens(bloco)));
  assert.ok(blocos.length > 1);
  for (const bloco of blocos) assert.ok(tokensEntradaResumo(mensagens(bloco)) <= 5000);
  for (const pagina of paginas) assert.equal(blocos.filter((bloco) => bloco.includes(pagina)).length, 1);
});

test("retomada após length divide páginas antes da IA e preserva resultados salvos", async () => {
  const store = memoria();
  const paginas = Array.from({ length: 3 }, (_, i) => `[Página ${i + 4}]\n${"Exigência documental e condições. ".repeat(100)}\n`);
  const bloco = "--- Edital ---\n" + paginas.join("");
  await store.setJSON("pncp", { texto: bloco, blocos: ["concluído", bloco], resultados: [{ resumoGeral: "Salvo" }], falhas: 3, diagnostico: { status: 200, finalizacao: "length", completion_tokens: 2200 }, proximaEtapaEm: 0, expiraEm: Date.now() + 86400000 });
  let chamadas = 0;
  const resultado = await executarEtapa({ store, chave: "pncp", inicial: {}, retomar: true, executar: async () => { chamadas++; return {}; } });
  assert.equal(chamadas, 0); assert.equal(resultado.estado.falhas, 0);
  assert.equal(resultado.estado.blocos.length, 3); assert.equal(resultado.estado.resultados[0].resumoGeral, "Salvo");
  for (const pagina of paginas) assert.ok(resultado.estado.blocos.some((parte) => parte.includes(pagina)));
});

test("página única densa divide parágrafos íntegros e conserva ID ativo e texto", () => {
  const texto = "--- Edital ---\n[Página 4]\n[EXIGÊNCIA R0001 documentosHabilitacao]\n" + "Apresentar documentação jurídica. ".repeat(50) + "\n\n" + "Se houver filial, apresentar sua documentação. ".repeat(50) + "\n";
  assert.deepEqual(dividirBlocoRejeitado(texto), [], "413 mantém regra original de página indivisível");
  const partes = dividirBlocoRejeitado(texto, true);
  assert.equal(partes.length, 2);
  assert.ok(partes.every((parte) => parte.includes("[Página 4]") && parte.includes("[EXIGÊNCIA R0001 documentosHabilitacao]")));
  const limpar = (valor) => valor.replace(/^--- .+ ---\n|^\[Página \d+\]\n|^\[EXIGÊNCIA .+\]\n/gm, "");
  assert.equal(limpar(partes.join("")), limpar(texto));
  assert.ok(partes.every((parte) => Buffer.byteLength(parte) < Buffer.byteLength(texto)));
  assert.deepEqual(dividirBlocoRejeitado("--- Edital ---\n[Página 4]\nParágrafo curto indivisível.", true), []);
});
