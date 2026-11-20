const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { validarPregao, cnpjValido, handler } = require("../pregao-gravado");

const EXT = path.join(__dirname, "../../../extensao-leitura");
const ITEM = "https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra/item/1?compra=19302805900082025";

// Saída real do leitor da extensão sobre a fixture real: o contrato entre os dois lados.
async function leituraReal() {
  const { lerPaginaPregao } = await import(pathToFileURL(path.join(EXT, "pregao-leitor.mjs")).href);
  const html = fs.readFileSync(path.join(EXT, "fixtures/comprasgov-item-19302805900082025-1.html"), "utf8");
  const r = lerPaginaPregao({ href: ITEM, html, captcha: false });
  delete r.status;
  delete r.pendentes;
  return r;
}
const base = () => ({ versao: 1, fonte: "comprasgov", compra: "19302805900082025", url: ITEM, cabecalho: { uasg: "193028" },
  itens: [{ numero: 1, propostas: [{ chave: "11222333000181", cnpj: "11222333000181", nome: "ALFA LTDA" }], mensagens: [] }] });

test("CNPJ: dígitos verificadores, sequência repetida e CPF recusados", () => {
  assert.equal(cnpjValido("33442649000111"), true);
  assert.equal(cnpjValido("33442649000112"), false);
  assert.equal(cnpjValido("11111111111111"), false);
  assert.equal(cnpjValido("12345678909"), false);
});

test("leitura real da extensão passa na validação sem perder campos", async () => {
  const v = validarPregao(await leituraReal());
  assert.equal(v.erro, undefined);
  const [item] = v.dados.itens;
  assert.equal(item.propostas.length, 3);
  assert.equal(item.propostas[0].marca, "santa cruz");
  assert.equal(item.mensagens.length, 4);
  assert.equal(v.dados.url, ITEM);
  assert.equal(v.dados.cabecalho.orgao, "SUPERINTENDENCIA DA ZONA FRANCA DE MANAUS/AM");
});

test("validação: compra, CNPJ, CPF, pessoa física, duplicidade, tipos e tamanhos", () => {
  const casos = [
    [(d) => { d.compra = "1930280590008202"; }, /compra/],
    [(d) => { d.compra = "19302805900081800"; }, /compra/],
    [(d) => { d.fonte = "pncp"; }, /fonte/],
    [(d) => { d.versao = 2; }, /versao/],
    [(d) => { d.itens[0].propostas[0].chave = "11222333000182"; d.itens[0].propostas[0].cnpj = "11222333000182"; }, /CNPJ válido/],
    [(d) => { d.itens[0].propostas[0].chave = "12345678909"; }, /CPF não é aceito/],
    [(d) => { d.itens[0].propostas[0].cnpj = "22333444000181"; }, /igual à chave/],
    [(d) => { d.itens[0].propostas[0].chave = "pf:1"; }, /pessoa física não leva documento/],
    [(d) => { d.itens[0].propostas.push({ ...d.itens[0].propostas[0] }); }, /repetida/],
    [(d) => { d.itens.push({ numero: 1 }); }, /repetido/],
    [(d) => { d.itens[0].numero = 0; }, /itens\[0\]\.numero/],
    [(d) => { d.itens[0].propostas[0].valorOfertado = "10"; }, /número inválido/],
    [(d) => { d.itens[0].propostas[0].valorOfertado = -1; }, /número inválido/],
    [(d) => { d.itens[0].propostas[0].uf = "Amazonas"; }, /uf/],
    [(d) => { d.itens[0].propostas[0].marca = "x".repeat(201); }, /máximo 200/],
    [(d) => { d.itens[0].mensagens.push({ texto: "x", tipo: "fofoca" }); }, /tipo/],
    [(d) => { d.itens[0].mensagens.push({ texto: "", tipo: "outro" }); }, /texto: obrigatório/],
    [(d) => { d.itens[0].mensagens.push({ texto: "x", tipo: "outro", dataHora: "07/01/2026" }); }, /data\/hora/],
    [(d) => { d.itens = Array.from({ length: 301 }, (_, i) => ({ numero: i + 1 })); }, /máximo 300/],
    [(d) => { d.itens = []; }, /nada para gravar/],
    [(d) => { d.url = "https://example.test/x"; }, /url/],
  ];
  for (const [mudar, erro] of casos) {
    const d = base();
    mudar(d);
    assert.match(validarPregao(d).erro || "", erro, erro.source);
  }
  assert.equal(validarPregao(null).erro, "Pedido inválido.");
  assert.equal(validarPregao([]).erro, "Pedido inválido.");
});

test("normalização: pessoa física sem nome, CPF mascarado em texto, URL sem parâmetros extras", () => {
  const d = base();
  d.url = `${ITEM}&captcha=TOKEN_SECRETO`;
  d.itens[0].propostas.push({ chave: "pf:1", cnpj: null, nome: "Fulano de Tal" });
  d.itens[0].mensagens.push({ texto: "CPF 123.456.789-09 e 12345678909, 123 456 789 09 e 123.456.789/09", tipo: "outro", motivo: "ver 123.456.789-09" });
  d.itens[0].propostas[0].nome = "FULANA DE TAL 12345678909";
  const v = validarPregao(d);
  assert.equal(v.erro, undefined);
  assert.equal(v.dados.itens[0].propostas[1].nome, "Pessoa física");
  assert.doesNotMatch(JSON.stringify(v.dados), /123\.456|12345678909|123 456|Fulano|TOKEN_SECRETO/);
  assert.equal(v.dados.itens[0].propostas[0].nome, "FULANA DE TAL ***.***.***-**");
  assert.equal(v.dados.semHttps, false);
  assert.equal(v.dados.url, ITEM);
});

function comFetch(respostas) {
  const chamadas = [];
  const original = global.fetch;
  global.fetch = async (url, op = {}) => {
    chamadas.push({ url: String(url), op });
    const r = respostas.find(([padrao]) => padrao.test(String(url)));
    const [, status, corpo] = r || [null, 500, {}];
    return { ok: status < 300, status, json: async () => corpo };
  };
  return { chamadas, restaurar: () => { global.fetch = original; } };
}
const evento = (metodo, extra = {}) => ({ httpMethod: metodo, headers: { origin: "https://licitaplena.com.br", authorization: "Bearer t" }, ...extra });

test("handler: login obrigatório, método, compra do GET e chave de serviço", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const f = comFetch([[/auth\/v1\/user/, 401, {}]]);
  try {
    assert.equal((await handler(evento("POST", { body: "{}" }))).statusCode, 401);
    assert.equal((await handler({ httpMethod: "POST", headers: {} })).statusCode, 401);
    assert.equal((await handler(evento("DELETE"))).statusCode, 405);
  } finally { f.restaurar(); }
  const g = comFetch([[/auth\/v1\/user/, 200, { id: "u1" }], [/rest\/v1\/clientes/, 200, [{ status: "aprovado" }]]]);
  try {
    assert.equal((await handler(evento("GET", { queryStringParameters: { compra: "1;drop" } }))).statusCode, 400);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await handler(evento("GET", { queryStringParameters: { compra: "19302805900082025" } }))).statusCode, 503);
  } finally { g.restaurar(); }
});

test("handler POST: valida antes de gastar cota e grava pela RPC com o usuário da sessão", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const f = comFetch([[/auth\/v1\/user/, 200, { id: "u1" }], [/rest\/v1\/clientes/, 200, [{ status: "aprovado" }]], [/rpc\/incrementar_uso/, 200, 1], [/rpc\/gravar_pregao_gravado/, 200, { propostas: 3, mensagens_novas: 4 }]]);
  try {
    const ruim = await handler(evento("POST", { body: JSON.stringify({ ...base(), compra: "x" }) }));
    assert.equal(ruim.statusCode, 400);
    assert.equal(f.chamadas.some((c) => /rpc\//.test(c.url)), false);
    assert.equal((await handler(evento("POST", { body: "x".repeat(2_000_001) }))).statusCode, 413);
    const r = await handler(evento("POST", { body: JSON.stringify(await leituraReal()) }));
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(JSON.parse(r.body), { ok: true, compra: "19302805900082025", propostas: 3, mensagens_novas: 4 });
    const rpc = f.chamadas.find((c) => /gravar_pregao_gravado/.test(c.url));
    const corpo = JSON.parse(rpc.op.body);
    assert.equal(corpo.p_usuario, "u1");
    assert.equal(corpo.p_dados.itens[0].propostas[1].marca, "São Caetano");
    assert.equal(rpc.op.headers.Authorization, "Bearer chave-teste");
  } finally { f.restaurar(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});

test("handler GET: devolve pregão com propostas e mensagens, sem id de quem gravou", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const f = comFetch([[/auth\/v1\/user/, 200, { id: "u1" }], [/rest\/v1\/clientes/, 200, [{ status: "aprovado" }]],
    [/pregoes_gravados\?/, 200, [{ id_compra: "19302805900082025", fonte: "comprasgov", itens: { 1: { descricao: "x" } } }]],
    [/pregoes_gravados_propostas\?/, 200, [{ numero_item: 1, cnpj: "33442649000111", marca: "santa cruz" }]],
    [/pregoes_gravados_mensagens\?/, 200, [{ numero_item: 1, tipo: "recusa", motivo: "m" }]]]);
  try {
    const r = await handler(evento("GET", { queryStringParameters: { compra: "19302805900082025" } }));
    assert.equal(r.statusCode, 200);
    const { pregao } = JSON.parse(r.body);
    assert.equal(pregao.propostas[0].marca, "santa cruz");
    assert.equal(pregao.mensagens[0].tipo, "recusa");
    for (const c of f.chamadas.filter((x) => /rest\/v1\/pregoes/.test(x.url))) assert.doesNotMatch(c.url, /gravado_por|atualizado_por/);
  } finally { f.restaurar(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});

test("B6: só a ata do ComprasNet aceita http, e a leitura sai marcada sem HTTPS", () => {
  const d = base();
  d.url = "http://comprasnet.gov.br/livre/pregao/AtaEletronico.asp?co_no_uasg=158142";
  assert.equal(validarPregao(d).dados.semHttps, true);
  d.url = "http://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=19302805900082025";
  assert.match(validarPregao(d).erro || "", /url/);
});

test("A1/M1: cadastro não aprovado (pendente, suspenso, sem linha) não grava nem lê", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  for (const clientes of [[{ status: "pendente" }], [{ status: "suspenso" }], []]) {
    const f = comFetch([[/auth\/v1\/user/, 200, { id: "u1" }], [/rest\/v1\/clientes/, 200, clientes], [/rpc\//, 200, {}], [/pregoes/, 200, []]]);
    try {
      assert.equal((await handler(evento("POST", { body: JSON.stringify(base()) }))).statusCode, 403);
      assert.equal((await handler(evento("GET", { queryStringParameters: { compra: "19302805900082025" } }))).statusCode, 403);
      assert.equal(f.chamadas.some((c) => /rpc\/|pregoes/.test(c.url)), false);
    } finally { f.restaurar(); }
  }
  const caiu = comFetch([[/auth\/v1\/user/, 200, { id: "u1" }], [/rest\/v1\/clientes/, 500, {}]]);
  try { assert.equal((await handler(evento("POST", { body: JSON.stringify(base()) }))).statusCode, 503); } finally { caiu.restaurar(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});

test("B5: GET tem cota própria, filtro por item, teto de linhas e selo não verificado", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-teste";
  const muitas = Array.from({ length: 2000 }, (_, i) => ({ numero_item: 1, cnpj: String(i), leituras_concordantes: i ? 1 : 2 }));
  const f = comFetch([[/auth\/v1\/user/, 200, { id: "u1" }], [/rest\/v1\/clientes/, 200, [{ status: "aprovado" }]], [/rpc\/incrementar_uso/, 200, 1],
    [/pregoes_gravados\?/, 200, [{ id_compra: "19302805900082025", leituras_concordantes: 1, fonte_sem_https: true, itens: { 1: { leituras_concordantes: 3 } } }]],
    [/pregoes_gravados_propostas\?/, 200, muitas], [/pregoes_gravados_mensagens\?/, 200, []]]);
  try {
    assert.equal((await handler(evento("GET", { queryStringParameters: { compra: "19302805900082025", item: "1;x" } }))).statusCode, 400);
    const r = await handler(evento("GET", { queryStringParameters: { compra: "19302805900082025", item: "1" } }));
    const { pregao } = JSON.parse(r.body);
    assert.equal(pregao.truncado, true);
    assert.equal(pregao.verificado, false);
    assert.equal(pregao.fonte_sem_https, true);
    assert.equal(pregao.itens[1].verificado, true);
    assert.deepEqual([pregao.propostas[0].verificado, pregao.propostas[1].verificado], [true, false]);
    const cota = f.chamadas.find((c) => /incrementar_uso/.test(c.url));
    assert.equal(JSON.parse(cota.op.body).p_funcao, "pregao-gravado-leitura");
    for (const c of f.chamadas.filter((x) => /pregoes_gravados_(propostas|mensagens)\?/.test(x.url))) {
      assert.match(c.url, /numero_item=eq\.1&/);
      assert.match(c.url, /limit=2000$/);
    }
  } finally { f.restaurar(); }
  const estourou = comFetch([[/auth\/v1\/user/, 200, { id: "u1" }], [/rest\/v1\/clientes/, 200, [{ status: "aprovado" }]], [/rpc\/incrementar_uso/, 200, 2001], [/pregoes/, 200, []]]);
  try {
    assert.equal((await handler(evento("GET", { queryStringParameters: { compra: "19302805900082025" } }))).statusCode, 429);
    assert.equal(estourou.chamadas.some((c) => /pregoes/.test(c.url)), false);
  } finally { estourou.restaurar(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
});
