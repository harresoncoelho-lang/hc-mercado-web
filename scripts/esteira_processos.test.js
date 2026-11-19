const test = require("node:test");
const assert = require("node:assert/strict");
const { rodar, reservar, buscarCandidatas, estadoAposFalha, erroCurto, modelosDoEdital, MAX_TENTATIVAS } = require("./esteira_processos");

const T = Date.parse("2026-11-18T12:00:00.000Z");
const ORG = "22222222-2222-2222-2222-222222222222", EMP = "11111111-1111-1111-1111-111111111111";
const PROC = "33333333-3333-3333-3333-333333333333", USR = "44444444-4444-4444-4444-444444444444";
const COMPRA = "11222333000181-1-41/2026";
const resposta = (dados) => new Response(JSON.stringify(dados), { headers: { "content-type": "application/json" } });

function tarefa(etapa, extra = {}) {
  return { organizacao_id: ORG, empresa_id: EMP, processo_id: PROC, etapa, estado: "pendente", tentativas: 0,
    proximo_em: new Date(T - 1000).toISOString(), detalhe: {}, erro: null, criado_por: USR, ...extra };
}

// PostgREST mínimo em memória: só os caminhos que o robô usa.
function supabaseFalso({ tarefas = [], origens = [], dossie = null, falharProcesso = false, perfil = null } = {}) {
  const db = { tarefas, origens, dossie, exigencias: [], gravados: [], perfil, leiturasPerfil: [] };
  const filtro = (params, chave) => decodeURIComponent(params.get(chave) || "").replace(/^eq\./, "");
  db.rest = async (caminho, opcoes = {}) => {
    const [tabela, consulta = ""] = caminho.split("?");
    const params = new URLSearchParams(consulta);
    const metodo = opcoes.method || "GET";
    if (tabela === "operacao_esteira_tarefas" && metodo === "GET") {
      const estados = params.get("estado").slice(4, -1).split(",");
      const limite = Date.parse(params.get("proximo_em").slice(4));
      return resposta(db.tarefas.filter((t) => estados.includes(t.estado) && Date.parse(t.proximo_em) <= limite)
        .sort((a, b) => Date.parse(a.proximo_em) - Date.parse(b.proximo_em)).slice(0, Number(params.get("limit"))).map((t) => ({ ...t })));
    }
    if (tabela === "operacao_esteira_tarefas" && metodo === "PATCH") {
      const casa = db.tarefas.filter((t) => t.processo_id === filtro(params, "processo_id") && t.etapa === filtro(params, "etapa") &&
        (!params.has("estado") || t.estado === filtro(params, "estado")) &&
        (!params.has("proximo_em") || Date.parse(t.proximo_em) === Date.parse(filtro(params, "proximo_em"))));
      for (const t of casa) Object.assign(t, JSON.parse(opcoes.body));
      return resposta(casa.map((t) => ({ ...t })));
    }
    if (tabela === "operacao_processos") {
      if (falharProcesso) throw new Error(`Supabase REST ${caminho} -> HTTP 500: {"detalhe":"cpf 123.456.789-00"}`);
      return resposta([{ id: PROC, empresa_id: EMP, organizacao_id: ORG, url_origem: null, origem_externa_id: COMPRA, numero: null }]);
    }
    if (tabela === "operacao_origens_pncp") return resposta(db.origens.map((n) => ({ numero_item: n })));
    if (tabela === "rpc/gravar_importacao_pncp") {
      const corpo = JSON.parse(opcoes.body);
      db.gravados.push(corpo);
      db.origens.push(corpo.p_numero);
      return resposta({ itemId: `item-${corpo.p_numero}`, estado: "importado" });
    }
    if (tabela === "operacao_perfil_empresa") {
      db.leiturasPerfil.push(params.get("select"));
      if (db.perfil === "sem_coluna") throw new Error(`Supabase REST ${caminho} -> HTTP 400: column uf_sede does not exist`);
      return resposta(db.perfil ? [{ uf_sede: db.perfil.uf_sede ?? null }] : []);
    }
    if (tabela === "dossies_editais") return resposta(db.dossie ? [{ status: "pronto", versao: 1, dossie: db.dossie }] : []);
    if (tabela === "operacao_exigencias_processo" && metodo === "GET") {
      return resposta(db.exigencias.filter((e) => e.processo_id === filtro(params, "processo_id"))
        .map(({ codigo, origem, tipo_documento = null }) => ({ codigo, origem, tipo_documento })));
    }
    if (tabela === "operacao_exigencias_processo") {
      for (const linha of JSON.parse(opcoes.body)) {
        const atual = db.exigencias.find((e) => e.processo_id === linha.processo_id && e.codigo === linha.codigo);
        if (atual) Object.assign(atual, linha);
        else db.exigencias.push({ resposta: "pendente", ...linha });
      }
      return resposta(null);
    }
    throw new Error(`caminho não previsto no teste: ${caminho}`);
  };
  return db;
}

function pncpFalso(total) {
  const chamadas = [];
  const fetchPncp = async (url) => {
    chamadas.push(url);
    if (url.includes("/itens?")) {
      const pagina = Number(new URL(url).searchParams.get("pagina"));
      const tamanho = Number(new URL(url).searchParams.get("tamanhoPagina"));
      const inicio = (pagina - 1) * tamanho;
      return resposta(Array.from({ length: Math.max(0, Math.min(tamanho, total - inicio)) }, (_, i) => ({ numeroItem: inicio + i + 1 })));
    }
    const numero = Number(url.split("/").pop());
    return resposta({ numeroItem: numero, descricao: `Material ${numero}`, quantidade: 2, unidadeMedida: "UN" });
  };
  return { fetchPncp, chamadas };
}

const relogio = () => T;

test("reserva é atômica: dois robôs na mesma tarefa, só um vence", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("cruzamento")] });
  const [candidata] = await buscarCandidatas(db.rest, T);
  const [a, b] = await Promise.all([reservar(db.rest, candidata, T), reservar(db.rest, candidata, T)]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal(db.tarefas[0].estado, "executando");
  // Rodadas concorrentes inteiras: a tarefa é executada uma única vez.
  const db2 = supabaseFalso({ tarefas: [tarefa("cruzamento")] });
  const [r1, r2] = await Promise.all([rodar({ rest: db2.rest, agora: relogio }), rodar({ rest: db2.rest, agora: relogio })]);
  assert.equal((r1.feito || 0) + (r2.feito || 0), 1);
  assert.equal(db2.tarefas[0].estado, "feito");
});

test("reserva vencida conta tentativa e, no teto, vira 'falhou' sem executar", async () => {
  const vencida = (tentativas) => tarefa("cruzamento", { estado: "executando", tentativas, proximo_em: new Date(T - 1000).toISOString() });
  const db = supabaseFalso({ tarefas: [vencida(1)] });
  assert.deepEqual(await rodar({ rest: db.rest, agora: relogio }), { feito: 1 });
  assert.equal(db.tarefas[0].tentativas, 2);
  const db2 = supabaseFalso({ tarefas: [vencida(MAX_TENTATIVAS - 1)] });
  assert.deepEqual(await rodar({ rest: db2.rest, agora: relogio }), { falhou: 1 });
  assert.equal(db2.tarefas[0].estado, "falhou");
  assert.equal(db2.tarefas[0].tentativas, MAX_TENTATIVAS);
});

test("tarefa 'executando' com reserva vencida volta à fila; reserva vigente não", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("cruzamento", { estado: "executando", proximo_em: new Date(T + 60000).toISOString() })] });
  assert.equal((await buscarCandidatas(db.rest, T)).length, 0);
  assert.equal((await buscarCandidatas(db.rest, T + 120000)).length, 1);
});

test("itens: retoma pulando os já importados, grava com o usuário da tarefa e pausa entre itens", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("itens")], origens: [1] });
  const { fetchPncp, chamadas } = pncpFalso(3);
  const pausas = [];
  const r = await rodar({ rest: db.rest, fetchPncp, agora: relogio, esperar: async (ms) => { pausas.push(ms); } });
  assert.deepEqual(r, { feito: 1 });
  assert.deepEqual(db.gravados.map((g) => g.p_numero), [2, 3]);
  assert.ok(db.gravados.every((g) => g.p_usuario === USR && g.p_compra === COMPRA && /^[a-f0-9]{64}$/.test(g.p_hash)));
  assert.deepEqual(db.gravados[0].p_referencia, { url_origem: null, origem_externa_id: COMPRA, numero: null });
  assert.equal(chamadas.some((u) => u.endsWith("/itens/1")), false);
  assert.deepEqual(pausas, [1500]);
  assert.deepEqual(db.tarefas[0].detalhe, { total: 3, importados: 2, jaImportados: 1, colisoesManuais: [] });
});

test("itens: tempo da rodada esgotado devolve à fila sem gastar tentativa e a próxima rodada continua", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("itens")] });
  const { fetchPncp } = pncpFalso(3);
  let agora = T;
  // Cada pausa "gasta" 6 minutos: o 3º item já cai fora do limite de 10 min.
  const r = await rodar({ rest: db.rest, fetchPncp, agora: () => agora, esperar: async () => { agora += 6 * 60000; } });
  assert.deepEqual(r, { parcial: 1 });
  assert.equal(db.tarefas[0].estado, "pendente");
  assert.equal(db.tarefas[0].tentativas, 0);
  assert.deepEqual(db.origens, [1, 2]);
  await rodar({ rest: db.rest, fetchPncp, agora: () => agora, esperar: async () => {} });
  assert.deepEqual(db.origens, [1, 2, 3]);
  assert.equal(db.tarefas[0].estado, "feito");
});

test("itens: acima do teto de 1000 falha de vez, sem truncar nem gravar", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("itens")] });
  const { fetchPncp } = pncpFalso(1001);
  await rodar({ rest: db.rest, fetchPncp, agora: relogio, esperar: async () => {} });
  assert.equal(db.tarefas[0].estado, "falhou");
  assert.match(db.tarefas[0].erro, /1001 itens/);
  assert.equal(db.gravados.length, 0);
});

test("exigências sem dossiê reagenda sem gastar tentativa", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")] });
  const r = await rodar({ rest: db.rest, agora: relogio });
  assert.deepEqual(r, { aguardando_dossie: 1 });
  assert.equal(db.tarefas[0].estado, "pendente");
  assert.equal(db.tarefas[0].tentativas, 0);
  assert.equal(Date.parse(db.tarefas[0].proximo_em), T + 30 * 60000);
});

test("erro: tentativas+1, backoff exponencial e erro curto sem o corpo da resposta", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("exigencias", { tentativas: 2 })], falharProcesso: true });
  await rodar({ rest: db.rest, agora: relogio });
  const t = db.tarefas[0];
  assert.equal(t.estado, "pendente");
  assert.equal(t.tentativas, 3);
  assert.equal(Date.parse(t.proximo_em), T + 20 * 60000);
  assert.equal(t.erro, "Supabase operacao_processos HTTP 500");
  assert.doesNotMatch(t.erro, /cpf|123/);
  assert.equal(Date.parse(estadoAposFalha({ tentativas: 0 }, new Error("x"), T).proximo_em), T + 5 * 60000);
  assert.equal(erroCurto(new Error("a".repeat(900))).length, 300);
});

test(`falhou após ${MAX_TENTATIVAS} tentativas`, async () => {
  const db = supabaseFalso({ tarefas: [tarefa("exigencias", { tentativas: MAX_TENTATIVAS - 1 })], falharProcesso: true });
  await rodar({ rest: db.rest, agora: relogio });
  assert.equal(db.tarefas[0].estado, "falhou");
  assert.equal(db.tarefas[0].tentativas, MAX_TENTATIVAS);
  assert.equal((await buscarCandidatas(db.rest, T + 86400000)).length, 0);
});

const DOSSIE = {
  textoEdital: "--- Edital (#1) ---\n[Página 1]\n8.1. A licitante deverá apresentar declaração de que não emprega menor de dezoito anos em trabalho noturno, sob pena de inabilitação.\n" +
    "8.2. Prova de regularidade perante a Justiça do Trabalho mediante certidão negativa de débitos trabalhistas (CNDT).\n",
  estrutura: {
    declaracoesExigidas: ["Declaração de que não emprega menor de dezoito anos em trabalho noturno"],
    documentosHabilitacao: [{ texto: "Certidão negativa de débitos trabalhistas (CNDT)", categoria: "Fiscal, social e trabalhista" }],
    coberturaLeitura: { documentosLidos: ["Edital (#1)"], documentosNaoLidos: [] },
  },
};

test("exigências: grava de forma idempotente e preserva a resposta do usuário", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie: DOSSIE });
  const r1 = await rodar({ rest: db.rest, agora: relogio });
  assert.deepEqual(r1, { feito: 1 });
  const total = db.exigencias.length;
  assert.ok(total >= 2);
  assert.ok(db.exigencias.every((e) => e.processo_id === PROC && e.texto && !("resposta" in e && e.resposta !== "pendente")));
  assert.ok(db.exigencias.some((e) => e.categoria === "declaracao" && e.documento === "Edital (#1)" && e.pagina === 1));
  assert.equal(db.tarefas[0].detalhe.situacao, "pronto");
  db.exigencias[0].resposta = "atendo";
  Object.assign(db.tarefas[0], { estado: "pendente", proximo_em: new Date(T - 1).toISOString() });
  await rodar({ rest: db.rest, agora: relogio });
  assert.equal(db.exigencias.length, total);
  assert.equal(db.exigencias[0].resposta, "atendo");
  assert.deepEqual(db.tarefas[0].detalhe.removidas, []);
});

test("exigências: código da IA é estável entre dossiês e a que sumiu fica em detalhe.removidas, sem apagar", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie: DOSSIE });
  const rodarCom = async (documentosHabilitacao) => {
    db.dossie = { ...DOSSIE, estrutura: { ...DOSSIE.estrutura, documentosHabilitacao } };
    Object.assign(db.tarefas[0], { estado: "pendente", proximo_em: new Date(T - 1).toISOString() });
    await rodar({ rest: db.rest, agora: relogio });
    return db.tarefas[0].detalhe.removidas;
  };
  const cndt = DOSSIE.estrutura.documentosHabilitacao[0];
  const amostra = { texto: "Amostra do produto em até 3 dias" };
  assert.deepEqual(await rodarCom([cndt]), []);
  const codigoCndt = db.exigencias.find((e) => /^IA-[a-f0-9]{10}$/.test(e.codigo)).codigo;
  // Item novo antes da CNDT: com código sequencial ela mudaria de código e herdaria a resposta errada.
  assert.deepEqual(await rodarCom([amostra, cndt]), []);
  assert.equal(db.exigencias.filter((e) => e.codigo.startsWith("IA-")).length, 2);
  assert.ok(db.exigencias.some((e) => e.codigo === codigoCndt && /CNDT/.test(e.texto)));
  // CNDT some da leitura: não é apagada, só listada.
  assert.deepEqual(await rodarCom([amostra]), [codigoCndt]);
  assert.ok(db.exigencias.some((e) => e.codigo === codigoCndt));
});

test("exigências: preenche tipo_documento pelo mapeamento, sem sobrescrever o já definido", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie: DOSSIE });
  await rodar({ rest: db.rest, agora: relogio });
  const cndt = db.exigencias.find((e) => /CNDT/.test(e.texto));
  const menor = db.exigencias.find((e) => e.categoria === "declaracao");
  assert.equal(cndt.tipo_documento, "CNDT");
  assert.equal(menor.tipo_documento, null);
  // Todas as linhas do lote levam a chave (PostgREST recusa lote com chaves diferentes).
  assert.ok(db.exigencias.every((e) => "tipo_documento" in e));
  cndt.tipo_documento = "Trabalhista (definido à mão)";
  Object.assign(db.tarefas[0], { estado: "pendente", proximo_em: new Date(T - 1).toISOString() });
  await rodar({ rest: db.rest, agora: relogio });
  assert.equal(cndt.tipo_documento, "Trabalhista (definido à mão)");
  assert.equal(menor.tipo_documento, null);
});

test("exigências: UF da sede do perfil entra no incomum; o robô lê só uf_sede", async () => {
  const dossie = { ...DOSSIE, estrutura: { ...DOSSIE.estrutura, documentosHabilitacao: [{ texto: "Certidão negativa de débitos estaduais (SEFAZ/PA)", categoria: "Fiscal, social e trabalhista" }] } };
  const motivo = async (perfil) => {
    const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie, perfil });
    assert.deepEqual(await rodar({ rest: db.rest, agora: relogio }), { feito: 1 });
    assert.deepEqual(db.leiturasPerfil, ["uf_sede"], "nunca select=* (CPF e banco ficam fora)");
    return db.exigencias.find((e) => /estaduais/.test(e.texto)).motivo_incomum;
  };
  assert.match(await motivo({ uf_sede: "AM" }), /UF diferente da sede \(PA; sede AM\)/);
  assert.doesNotMatch(await motivo({ uf_sede: "PA" }) || "", /UF/);
  assert.match(await motivo(null), /UF da sede não informada/);
  // Banco sem a coluna (SQL ainda não reaplicado): a etapa não falha, segue sem UF.
  assert.match(await motivo("sem_coluna"), /UF da sede não informada/);
});

test("exigências: linha manual não entra em removidas", async () => {
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie: DOSSIE });
  db.exigencias.push({ processo_id: PROC, codigo: "M-1", origem: "manual", texto: "x" });
  await rodar({ rest: db.rest, agora: relogio });
  assert.deepEqual(db.tarefas[0].detalhe.removidas, []);
});

test("exigências: anexo não lido deixa a etapa aguardando leitura com reagendamento", async () => {
  const dossie = { ...DOSSIE, estrutura: { ...DOSSIE.estrutura, coberturaLeitura: { documentosLidos: ["Edital (#1)"], documentosNaoLidos: ["Termo de Referência (#2): arquivo RAR corrompido"] } } };
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie });
  assert.deepEqual(await rodar({ rest: db.rest, agora: relogio }), { aguardando_leitura: 1 });
  assert.equal(db.tarefas[0].estado, "aguardando_leitura");
  assert.equal(Date.parse(db.tarefas[0].proximo_em), T + 6 * 3600000);
  assert.ok(db.exigencias.length > 0);
});

test("segunda passada desligada por padrão; ligada usa só o provedor injetado e descarta trecho inexistente", async () => {
  let chamadas = 0;
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie: DOSSIE });
  await rodar({ rest: db.rest, agora: relogio, chamarIA: async () => { chamadas += 1; return []; } });
  assert.equal(chamadas, 0);
  const db2 = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie: DOSSIE });
  await rodar({ rest: db2.rest, agora: relogio, segundaPassadaLigada: true, chamarIA: async () => {
    chamadas += 1;
    return [{ texto: "Inventada", documento: "Edital (#1)", pagina: 1, trechoLiteral: "este trecho não existe em lugar nenhum do edital" }];
  } });
  assert.equal(chamadas, 1);
  assert.equal(db2.tarefas[0].detalhe.segundaPassada.descartadas, 1);
  assert.equal(db2.exigencias.some((e) => e.origem === "segunda_passada"), false);
});

test("exigências: declaração com modelo literal no anexo grava modelo_texto e a fonte; as outras levam null", async () => {
  const anexo = "--- Anexos (#2) ---\n[Página 29]\nTexto qualquer.\n[Página 30]\nANEXO III - MODELO DE DECLARAÇÃO\nDECLARAÇÃO DE QUE NÃO EMPREGA MENOR\n" +
    "A empresa ______, CNPJ nº ______, declara que não emprega menor de dezoito anos em trabalho noturno, perigoso ou insalubre.\f\n[Página 31]\nLocal e data.\n" +
    "ANEXO IV - MINUTA DO CONTRATO\nCláusula primeira.\n";
  const db = supabaseFalso({ tarefas: [tarefa("exigencias")], dossie: { ...DOSSIE, textoEdital: DOSSIE.textoEdital + anexo } });
  assert.deepEqual(await rodar({ rest: db.rest, agora: relogio }), { feito: 1 });
  const menor = db.exigencias.find((e) => e.categoria === "declaracao");
  assert.ok(menor.modelo_texto.startsWith("ANEXO III - MODELO DE DECLARAÇÃO\nDECLARAÇÃO DE QUE NÃO EMPREGA MENOR"));
  assert.ok(!/MINUTA|\[Página|\f/.test(menor.modelo_texto), "só o anexo do modelo, sem marcação de página nem controle");
  assert.deepEqual(menor.modelo_fonte, { documento: "Anexos (#2)", pagina: 30 });
  assert.ok(db.exigencias.every((e) => "modelo_texto" in e && "modelo_fonte" in e), "chaves iguais em todo o lote");
  assert.ok(db.exigencias.filter((e) => e.categoria !== "declaracao").every((e) => e.modelo_texto === null && e.modelo_fonte === null));
  assert.equal(db.tarefas[0].detalhe.modelosDoEdital, db.exigencias.filter((e) => e.modelo_texto).length);
  // Sem anexo de modelo (ou modelo de outro tema): nada gravado, a tela cai na biblioteca.
  db.dossie = { ...DOSSIE, textoEdital: DOSSIE.textoEdital + anexo.replace("não emprega menor de dezoito anos em trabalho noturno, perigoso ou insalubre", "possui programa de integridade").replace("NÃO EMPREGA MENOR", "INTEGRIDADE") };
  Object.assign(db.tarefas[0], { estado: "pendente", proximo_em: new Date(T - 1).toISOString() });
  await rodar({ rest: db.rest, agora: relogio });
  assert.equal(menor.modelo_texto, null);
});

test("modelosDoEdital: modelo acima do teto fica de fora", () => {
  const grande = { "Edital (#1)": "ANEXO I - MODELO DE DECLARAÇÃO\n" + "x".repeat(18001) };
  assert.deepEqual(modelosDoEdital(grande), []);
  assert.equal(modelosDoEdital({ "Edital (#1)": "ANEXO I - MODELO DE DECLARAÇÃO\nDeclaro." })[0].pagina, null);
});
