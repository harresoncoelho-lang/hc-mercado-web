const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../_comprasnet_antigo");

// Páginas reais do ComprasNet antigo (nov/2026), em ISO-8859-1 como o portal serve. IFAM 23/2022 (grupos) e INPA 13/2022 (itens com marca).
const pasta = path.join(__dirname, "fixtures", "comprasnet-antigo");
const bytes = (nome) => fs.readFileSync(path.join(pasta, nome));
const html = (nome) => bytes(nome).toString("latin1");

// Servidor falso do portal: devolve o arquivo certo por página e registra o que foi pedido.
function portal({ ata4 = "ata4.html", forn = "fornecedor-ifam.html", termo = "termo-ifam.html", trocas = [] } = {}) {
  const pedidos = [];
  const fetchImpl = async (url, op = {}) => {
    const u = new URL(url);
    pedidos.push({ url: String(url), metodo: op.method || "GET", corpo: op.body ? String(op.body) : null });
    const arq = { "/livre/pregao/ata4.asp": ata4, "/livre/pregao/ata2.asp": "ata2.html", "/livre/pregao/FornecedorResultadoDecreto.asp": forn, "/livre/pregao/termojulg.asp": termo }[u.pathname];
    if (!arq) return new Response("nada", { status: 404 });
    let b = bytes(arq);
    if (trocas.length) { let t = b.toString("latin1"); for (const [de, para] of trocas) t = t.split(de).join(para); b = Buffer.from(t, "latin1"); }
    return new Response(b, { status: 200 });
  };
  return { fetchImpl, pedidos };
}
const relogio = () => { let t = 1000; const esperas = []; return { agora: () => t, esperar: async (ms) => { esperas.push(ms); t += ms; }, esperas, passar: (ms) => { t += ms; } }; };

test("lista ata4: número sem zeros + ano, UASG, modalidade e data de realização", () => {
  assert.deepEqual(C.lerLista(html("ata4.html")), [{ tipo: "E", numprp: "232022", uasg: "158142", modalidade: 5, data: "2022-12-05" }]);
  assert.equal(C.lerPrgcod(html("ata2.html")), "1099276");
  assert.deepEqual(C.lerLista("<html>nada</html>"), []);
});

test("Resultado por Fornecedor: vencedores, valores e MARCA / fabricante / modelo / descrição ofertada (item a item)", () => {
  const f = C.lerFornecedores(html("fornecedor-inpa.html"));
  assert.equal(f[0].ni, "07944100000115");
  assert.equal(f[0].nome, "PROC9 INDUSTRIA QUIMICA LTDA");
  const item1 = f[0].linhas[0];
  assert.equal(item1.numero, 1);
  assert.equal(item1.marca, "Proc9");
  assert.equal(item1.fabricante, "Proc9");
  assert.equal(item1.modelo, "proc9");
  assert.equal(item1.unitario, 147.12);
  assert.equal(item1.global, 1471.2);
  assert.match(item1.ofertado, /^Ácido Sulfúrico, aspecto/); // acento do ISO-8859-1 decodificado
});

test("Resultado por Fornecedor de pregão por grupo: linha 'Grupo N' sem número de item e sem marca", () => {
  const f = C.lerFornecedores(html("fornecedor-ifam.html"));
  assert.deepEqual(f.map((x) => x.ni), ["08759521000139", "25044767000143"]);
  assert.equal(f[0].linhas[0].numero, null);
  assert.equal(f[0].linhas[0].grupo, "Grupo 1");
  assert.equal(f[0].linhas[0].marca, null);
  assert.equal(f[0].linhas[0].global, 618804.36);
});

test("termo de adjudicação: situação, vencedor com CNPJ, lance e quantidade; cancelamento traz o MOTIVO literal", () => {
  const t = C.lerTermo(html("termo-ifam.html"));
  assert.equal(t.length, 2);
  assert.deepEqual([t[0].numero, t[0].grupo, t[0].situacao, t[0].ni, t[0].lance, t[0].qtd_lance], [1, "Grupo 1", "Adjudicado", "08759521000139", 5689.01, 36]);
  const c = C.lerTermo(html("termo-cancelado.html"));
  assert.equal(c.length, 1);
  assert.equal(c[0].situacao, "Cancelado no julgamento");
  assert.equal(c[0].motivo, "Por não haver propostas validas para continuidade do item.");
  assert.equal(c[0].ni, null);
});

test("valor unitário: o do Resultado por Fornecedor; sem ele, o lance do termo; termo em valor total (INPA) vira unitário", () => {
  const inpa = C.juntar(C.lerTermo(html("termo-inpa.html")), C.lerFornecedores(html("fornecedor-inpa.html")));
  assert.equal(inpa.get(1).valor_unitario, 147.12);   // lance do termo = 1.471,20 (total de 10 litros); unitário 147,12
  assert.equal(inpa.get(1).valor_estimado, 147.12);   // critério 1.471,20 também é total
  assert.equal(inpa.get(1).marca, "Proc9");
  const ifam = C.juntar(C.lerTermo(html("termo-ifam.html")), C.lerFornecedores(html("fornecedor-ifam.html")));
  assert.equal(ifam.get(1).valor_unitario, 5689.01);  // grupo: o lance do termo é unitário (36 x 5.689,01 + ... = total do grupo 618.804,36)
  assert.equal(ifam.get(1).marca, null);               // grupo não traz marca por item: fica null, não "sem marca"
  assert.equal(36 * 5689.01 + 24 * 5890 + 12 * 3280 + 36 * 6480, 618804.36);
});

test("números BR e entidades", () => {
  assert.equal(C.numeroBr("R$ 1.471,2000"), 1471.2);
  assert.equal(C.numeroBr("2.800"), 2800);
  assert.equal(C.numeroBr(" - "), null);
  assert.equal(C.numeroBr(""), null);
});

test("lerPregaoAntigo: 4 páginas em https, pausa >= 1,5 s entre todas, nunca a ata com captcha", async () => {
  const { fetchImpl, pedidos } = portal();
  const rel = relogio();
  const leitor = C.criarLeitor({ fetchImpl, esperar: rel.esperar, agora: rel.agora, pausaMs: 100 }); // pausa menor que o piso é elevada ao piso
  const r = await C.lerPregaoAntigo({ uasg: "158142", numero: "00023", ano: 2022 }, leitor);
  assert.equal(r.prgcod, "1099276");
  assert.equal(r.data, "2022-12-05");
  assert.equal(r.url, "https://www.comprasnet.gov.br/livre/pregao/ata2.asp?co_no_uasg=158142&numprp=232022&codigoModalidade=5");
  assert.equal(r.itens.size, 2);
  assert.deepEqual(pedidos.map((p) => new URL(p.url).pathname.split("/").pop()), ["ata4.asp", "ata2.asp", "FornecedorResultadoDecreto.asp", "termojulg.asp"]);
  assert.ok(pedidos.every((p) => p.url.startsWith("https://www.comprasnet.gov.br/livre/pregao/")));
  assert.ok(pedidos.every((p) => !/AtaEletronico/i.test(p.url)));
  assert.match(pedidos[0].corpo, /co_uasg=158142/);
  assert.match(pedidos[0].corpo, /numprp=232022/);
  assert.match(pedidos[3].url, /termojulg\.asp\?prgcod=1099276&Acao=A$/);
  assert.equal(rel.esperas.length, 3);
  assert.ok(rel.esperas.every((ms) => ms >= 1500), `pausas ${rel.esperas}`);
});

test("leitor: ata com captcha e página fora da lista são recusadas antes de qualquer pedido; orçamento acaba", async () => {
  const { fetchImpl, pedidos } = portal();
  const leitor = C.criarLeitor({ fetchImpl, esperar: async () => {}, orcamento: 2 });
  await assert.rejects(() => leitor.pagina("/AtaEletronico.asp?co_no_uasg=158142&numprp=232022&Seq=1"), /fora da lista/);
  await assert.rejects(() => leitor.pagina("/ata4.asp/../AtaEletronico.asp"), /fora da lista/);
  await assert.rejects(() => leitor.pagina("/outra.asp"), /fora da lista/);
  assert.equal(pedidos.length, 0);
  await leitor.pagina("/ata2.asp?co_no_uasg=1&numprp=1&codigoModalidade=5");
  await leitor.pagina("/ata2.asp?co_no_uasg=1&numprp=1&codigoModalidade=5");
  await assert.rejects(() => leitor.pagina("/ata2.asp?x=1"), /Orçamento/);
});

test("lerPregaoAntigo: pregão fora da lista dá null (sem abrir mais nada); HTTP 500 lança; referência inválida lança", async () => {
  const sem = portal({ ata4: "ata2.html" }); // página sem a linha do pregão
  const r = await C.lerPregaoAntigo({ uasg: "158142", numero: "23", ano: 2022 }, C.criarLeitor({ fetchImpl: sem.fetchImpl, esperar: async () => {} }));
  assert.equal(r, null);
  assert.equal(sem.pedidos.length, 1);
  const erro = C.criarLeitor({ fetchImpl: async () => new Response("x", { status: 500 }), esperar: async () => {} });
  await assert.rejects(() => C.lerPregaoAntigo({ uasg: "158142", numero: "23", ano: 2022 }, erro), /HTTP 500/);
  await assert.rejects(() => C.lerPregaoAntigo({ uasg: "x", numero: "23", ano: 2022 }, erro), /inválida/);
});

test("CPF nunca sai: vencedor pessoa física vira 'Pessoa física' e CPF em texto livre some", async () => {
  const termo = html("termo-inpa.html").replace("PROC9 INDUSTRIA QUIMICA LTDA , pelo melhor lance", "FULANA DE TAL 970.481.432-15 , pelo melhor lance").replace("CNPJ/CPF: 07.944.100/0001-15", "CNPJ/CPF: 970.481.432-15");
  const t = C.lerTermo(termo);
  const it = t.find((x) => x.numero === 1);
  assert.equal(it.ni, "97048143215"); // 11 dígitos: o chamador (L.fornecedor) não o grava como documento
  assert.doesNotMatch(String(it.nome), /970/);
  const L = require("../_licitacao_anterior");
  const f = L.fornecedor(it.ni, it.nome, "pp");
  assert.equal(f.fornecedor_ni, null);
  assert.equal(f.fornecedor_nome, "Pessoa física");
});
