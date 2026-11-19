// "Licitação anterior": motivos dos pregões gravados por usuário, selo de confiança, fonte sem HTTPS e selo de sanção em lote.
const test = require("node:test");
const assert = require("node:assert/strict");

// DOM mínimo: o suficiente para renderizar o cartão e ler o texto/atributos (sem jsdom no projeto).
class No {
  constructor(tag) { this.tag = tag; this.filhos = []; this.className = ""; this.dataset = {}; this.attrs = {}; this.href = ""; }
  append(...xs) { for (const x of xs.flat()) if (x !== null && x !== undefined && x !== "") this.filhos.push(typeof x === "string" ? { texto: x } : x); }
  replaceChildren(...xs) { this.filhos = []; this.append(...xs); }
  setAttribute(k, v) { this.attrs[k] = v; }
  set textContent(t) { this.filhos = t === "" ? [] : [{ texto: String(t) }]; }
  get textContent() { return this.filhos.map((f) => (f.texto !== undefined ? f.texto : f.textContent)).join(""); }
  procurar(pred, achados = []) { for (const f of this.filhos) if (f.tag) { if (pred(f)) achados.push(f); f.procurar(pred, achados); } return achados; }
}
globalThis.document = { createElement: (tag) => new No(tag) };
require("./sancoes-ui.js"); // define globalThis.LicitaSancoes
const U = require("./licitacao-anterior-ui.js");

const ID = "19302805900082025";
const compra = { id_compra: ID, numero: "90008/2025", modalidade: "Pregão", plataforma: "Compras.gov.br", data_publicacao: "2025-08-18", link_origem: "https://cnetmobile.estaleiro.serpro.gov.br/x?compra=" + ID };
const item = { id_compra: ID, numero_item: 1, situacao_item: "Homologado", descricao: "Álcool etílico" };
const cas = { id_compra: ID, numero_item: 1, item_edital: 1, confianca: "alta", regra: "mesmo item de catálogo (CATMAT)" };
const VENCEDOR = "33442649000111", RECUSADA = "22333444000181", SANCIONADA = "11222333000181";
const part = (chave, nome, extra) => ({ id_compra: ID, numero_item: 1, fornecedor_chave: chave, fornecedor_ni: /^\d{14}$/.test(chave) ? chave : null, fornecedor_nome: nome, ...extra });
const visao = () => U.montarVisao({ compras: [compra], itens: [item], casamentos: [cas], alvos: [],
  participacoes: [part(VENCEDOR, "MAX DISTRIBUIDORA", { ordem_classificacao: 1, classificacao: 1, valor_homologado: 10, valor_proposta: 10, marca: "Santa Cruz" }),
    part(RECUSADA, "ALFA COMERCIO", { classificacao: 2, valor_proposta: 9 }), part(SANCIONADA, "BETA LTDA", { classificacao: 3, valor_proposta: 12 })] });
const msg = (extra) => ({ id_compra: ID, numero_item: 1, fornecedor_chave: RECUSADA, data_hora: "2026-01-07T09:44:00", autor: "orgao", tipo: "recusa", texto: "Recusada. Motivo: marca diferente do edital", motivo: "marca diferente do edital", leituras_concordantes: 1, gravado_em: "2026-11-19T10:00:00Z", ...extra });
const pregao = (extra) => ({ id_compra: ID, fonte: "comprasgov", orgao: "SUFRAMA", fonte_sem_https: false, leituras_concordantes: 1, gravado_em: "2026-11-19T10:00:00Z", itens: { 1: { propostas_lidas_em: "2026-11-19T10:00:00Z" } }, ...extra });
const prop = (extra) => ({ id_compra: ID, numero_item: 1, fornecedor_chave: RECUSADA, cnpj: RECUSADA, nome: "ALFA COMERCIO", situacao: "Desclassificada", leituras_concordantes: 1, gravado_em: "2026-11-19T10:00:00Z", ...extra });
const desenhar = (extras) => { const raiz = new No("div"); U.desenhar(raiz, visao(), { extras }); return raiz; };

test("com gravação: situação e motivo literal por participante, com selo 'lido por usuário, não verificado' e a data", () => {
  const raiz = desenhar({ gravado: U.indexarGravado({ pregoes: [pregao()], propostas: [prop()], mensagens: [msg()] }), sancoes: null });
  const t = raiz.textContent;
  assert.match(t, /situação: Desclassificada/);
  assert.match(t, /Recusa em 07\/01\/2026: marca diferente do edital/, "motivo literal, sem o 'Recusada. Motivo:' do texto bruto");
  assert.match(t, /lido por usuário, não verificado · lido em 19\/11\/2026/);
  assert.doesNotMatch(t, /exige captcha\)\. Dica/, "com gravação some a dica de gravar");
  assert.match(t, /Pregão gravado por usuário do LicitaPlena/);
  const [det] = raiz.procurar((n) => n.className === "la-participantes");
  assert.equal(det.open, true, "com motivo a lista de participantes já vem aberta");
});

test("duas organizações concordando: selo 'verificado'; a data vem da leitura mais recente", () => {
  const raiz = desenhar({ gravado: U.indexarGravado({ pregoes: [pregao({ leituras_concordantes: 2 })], propostas: [prop({ leituras_concordantes: 2, atualizado_em: "2026-11-20T08:00:00Z" })], mensagens: [msg({ leituras_concordantes: 2 })] }) });
  assert.match(raiz.textContent, /verificado \(2 organizações concordando\) · lido em 20\/11\/2026/);
  assert.doesNotMatch(raiz.textContent, /não verificado · lido em 20/);
});

test("fonte sem HTTPS: selo quando a leitura veio de página http do ComprasNet antigo", () => {
  const raiz = desenhar({ gravado: U.indexarGravado({ pregoes: [pregao({ fonte: "comprasnet", fonte_sem_https: true })], propostas: [prop()], mensagens: [msg()] }) });
  assert.match(raiz.textContent, /fonte sem HTTPS/);
  assert.equal(raiz.procurar((n) => n.className === "la-sem-https").length >= 2, true, "no pregão e em cada leitura");
  const sem = desenhar({ gravado: U.indexarGravado({ pregoes: [pregao()], propostas: [prop()], mensagens: [msg()] }) });
  assert.doesNotMatch(sem.textContent, /fonte sem HTTPS/);
});

test("sem gravação: mantém 'abra o pregão (exige captcha)' com link oficial e a dica 'grave com a extensão'", () => {
  const raiz = desenhar({ gravado: U.indexarGravado({}), sancoes: null });
  assert.match(raiz.textContent, /Motivos de desclassificação: abra o pregão \(exige captcha\)\. Dica: grave com a extensão/);
  const [a] = raiz.procurar((n) => n.tag === "a" && n.textContent === "abra o pregão");
  assert.ok(a.href.startsWith("https://cnetmobile.estaleiro.serpro.gov.br/"));
  // Mesma coisa sem nenhum extras (cartão sem cliente supabase).
  assert.match(desenhar(null).textContent, /grave com a extensão/);
});

test("pregão gravado mas item não aberto: avisa para abrir o item; participante só da gravação entra na lista", () => {
  const sem = desenhar({ gravado: U.indexarGravado({ pregoes: [pregao({ itens: {} })] }) });
  assert.doesNotMatch(desenhar({ gravado: U.indexarGravado({ pregoes: [pregao({ itens: {} })], propostas: [prop()] }) }).textContent, /não foi aberto/, "item com leitura de participante conta como aberto");
  assert.match(sem.textContent, /Item 1 não foi aberto na gravação do pregão/);
  const novo = desenhar({ gravado: U.indexarGravado({ pregoes: [pregao()], propostas: [prop({ fornecedor_chave: "44555666000199", cnpj: "44555666000199", nome: "SO NA GRAVACAO", situacao: "Inabilitada" })] }) });
  assert.match(novo.textContent, /lido do pregão gravado · SO NA GRAVACAO/);
  assert.match(novo.textContent, /situação: Inabilitada/);
});

test("mensagem de recusa sem fornecedor fica no item; tipos fora de recusa/desclassificação/inabilitação são ignorados", () => {
  const idx = U.indexarGravado({ pregoes: [pregao()], mensagens: [msg({ fornecedor_chave: null, motivo: "item sem proposta válida" }), msg({ tipo: "convocacao", motivo: "x", texto: "convocada" })] });
  const p = U.participantesDoItem(visao().compras[0].itens[0], idx, ID);
  assert.deepEqual(p.doItem.map((m) => m.texto), ["item sem proposta válida"]);
  assert.equal(p.lista.every((e) => e.motivos.length === 0), true);
});

test("selo de sanção: vencedor e participantes com sanção vigente levam o selo; o resto não; vem do lote", () => {
  const sancoes = { hoje: "2026-11-19", resultados: {
    [SANCIONADA]: { vigentes: [{ cadastro: "CEIS", cnpj: SANCIONADA, data_fim: "2099-01-01", fora_da_lista: false }], expiradas: [] },
    [VENCEDOR]: { vigentes: [], expiradas: [] }, [RECUSADA]: { vigentes: [], expiradas: [{ cadastro: "CNEP", cnpj: RECUSADA, data_fim: "2020-01-01" }] } } };
  const raiz = desenhar({ gravado: U.indexarGravado({}), sancoes });
  const selos = raiz.procurar((n) => n.className === "sancao-selo");
  assert.deepEqual(selos.map((s) => s.dataset.situacao).sort(), ["expirada", "vigente"]);
  assert.match(raiz.textContent, /Empresa com sanção vigente \(CEIS\)/);
  assert.equal(selos.filter((s) => s.dataset.situacao === "vigente")[0].attrs.role, "alert");
});

test("lote: até 200 CNPJs únicos, vencedores primeiro, só 14 dígitos; falha da consulta não derruba o cartão", async () => {
  const v = visao();
  const idx = U.indexarGravado({ propostas: [prop({ fornecedor_chave: "pf:1", cnpj: null }), prop({ fornecedor_chave: "44555666000199", cnpj: "44555666000199" })] });
  assert.deepEqual(U.cnpjsDaVisao(v, idx), [VENCEDOR, RECUSADA, SANCIONADA, "44555666000199"]);
  // 250 participantes: o corte é 200 e o vencedor continua dentro.
  const muitos = U.montarVisao({ compras: [compra], itens: [item], casamentos: [cas], alvos: [],
    participacoes: [part(VENCEDOR, "V", { ordem_classificacao: 1, classificacao: 1, valor_homologado: 1 }), ...Array.from({ length: 250 }, (_, i) => part(String(10000000000000 + i), `F${i}`, { classificacao: i + 2, valor_proposta: 1 }))] });
  const lista = U.cnpjsDaVisao(muitos, null);
  assert.equal(lista.length, 200);
  assert.equal(lista[0], VENCEDOR);
  let chamadas = 0;
  const extras = await U.carregarExtras(v, { cliente: null, sancoes: async (c) => { chamadas++; assert.equal(c.length, 4 - 1); throw new Error("fora do ar"); } });
  assert.equal(chamadas, 1);
  assert.equal(extras.sancoes, null);
  assert.equal(extras.gravado.pregoes.size, 0);
});

test("sancoesEmLote: POST com o token da sessão e a lista; sem sessão ou com erro HTTP devolve null", async () => {
  const pedidos = [];
  const cliente = (token) => ({ auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } });
  const buscar = (ok) => async (url, op) => { pedidos.push({ url, op }); return { ok, json: async () => ({ resultados: { [VENCEDOR]: { vigentes: [], expiradas: [] } }, hoje: "2026-11-19" }) }; };
  const r = await U.sancoesEmLote(cliente("T"), buscar(true))([VENCEDOR]);
  assert.deepEqual(r, { resultados: { [VENCEDOR]: { vigentes: [], expiradas: [] } }, hoje: "2026-11-19" });
  assert.equal(pedidos[0].url, "/api/sancoes-cnpj");
  assert.equal(pedidos[0].op.method, "POST");
  assert.equal(pedidos[0].op.headers.Authorization, "Bearer T");
  assert.deepEqual(JSON.parse(pedidos[0].op.body), { cnpjs: [VENCEDOR] });
  assert.equal(await U.sancoesEmLote(cliente(null), buscar(true))([VENCEDOR]), null);
  assert.equal(await U.sancoesEmLote(cliente("T"), buscar(false))([VENCEDOR]), null);
  assert.equal(await U.sancoesEmLote(cliente("T"), buscar(true))([]), null);
});

test("leitura do pregão gravado usa colunas nomeadas (o banco recusa select *) e tolera tabela ausente", async () => {
  const pedidos = [];
  const consulta = (tabela, erro) => { const q = { select: (c) => { pedidos.push({ tabela, colunas: c }); return q; }, in: () => q, order: () => q, limit: () => q, then: (ok) => ok({ data: erro ? null : [], error: erro }) }; return q; };
  const cliente = (erro) => ({ from: (t) => consulta(t, erro) });
  await U.lerGravados(cliente(null), [ID, "x"]);
  assert.deepEqual(pedidos.map((p) => p.tabela), ["pregoes_gravados", "pregoes_gravados_propostas", "pregoes_gravados_mensagens"]);
  assert.ok(pedidos.every((p) => p.colunas !== "*" && !/gravado_por|atualizado_por/.test(p.colunas)));
  assert.deepEqual(await U.lerGravados(cliente({ code: "42P01" }), [ID]), { pregoes: [], propostas: [], mensagens: [] });
  assert.deepEqual(await U.lerGravados(cliente(null), ["não é id"]), { pregoes: [], propostas: [], mensagens: [] });
});

test("análise por CNPJ: CNPJs dos vencedores das linhas mostradas, únicos e só com 14 dígitos", () => {
  const A = require("./analise-cnpj-ui.js");
  const itens = [{ vencedor_ni: VENCEDOR }, { vencedor_ni: VENCEDOR }, { vencedor_ni: null }, { vencedor_ni: "123" }, { vencedor_ni: RECUSADA }];
  assert.deepEqual(A.cnpjsDosVencedores(itens), [VENCEDOR, RECUSADA]);
  assert.equal(A.cnpjsDosVencedores(Array.from({ length: 300 }, (_, i) => ({ vencedor_ni: String(10000000000000 + i) }))).length, 100, "só as 100 linhas que a tabela mostra");
});
