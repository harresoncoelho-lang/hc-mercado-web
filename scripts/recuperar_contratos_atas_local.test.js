const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { recuperar, lerOpcoesCli } = require("./recuperar_contratos_atas_local");
const compra = "11222333000181-1-000001/2026";
const ata = (n, vigenciaFim = "2027-01-01") => ({ numeroControlePNCPAta: `${compra}-${String(n).padStart(6, "0")}`, numeroControlePNCPCompra: compra, vigenciaFim });
const pagina = (n, total = 2) => ({ numeroPagina: n, totalPaginas: total, totalRegistros: total, data: [{ numeroControlePNCP: `contrato-${n}` }] });
async function preparar(t, fila = []) {
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), "pncp-contratos-atas-"));
  t.after(async () => {
    const resolvido = path.resolve(diretorio);
    assert.equal(path.dirname(resolvido), path.resolve(os.tmpdir()));
    assert(path.basename(resolvido).startsWith("pncp-contratos-atas-"));
    await fs.rm(resolvido, { recursive: true, force: true });
  });
  return { diretorio, mercado: { filaPendente: fila, janelasPendentes: [{ inicio: "20260803", fim: "20261004" }] }, inicio: "20261024", fim: "20261027", referencia: "2026-10-28", intervaloMs: 0 };
}
function fonte(chamadas, totalItens = 31) {
  return async (url) => {
    chamadas.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/contratos")) return pagina(Number(u.searchParams.get("pagina")));
    if (u.pathname.includes("/atas/")) return { numeroControlePNCP: ata(Number(u.pathname.split("/").at(-1))).numeroControlePNCPAta, numeroControlePncpCompra: compra, dataVigenciaFim: "2027-01-01", cancelado: false };
    if (u.pathname.endsWith("/itens")) { const inicio = (Number(u.searchParams.get("pagina")) - 1) * 100; return Array.from({ length: Math.min(100, Math.max(0, totalItens - inicio)) }, (_, i) => ({ numeroItem: inicio + i + 1 })); }
    if (u.pathname.endsWith("/resultados")) return [{ numeroControlePNCPCompra: compra, numeroItem: Number(u.pathname.split("/").at(-2)), niFornecedor: "11222333000181" }];
    return { numeroControlePNCP: compra };
  };
}
test("recupera contratos e atas vigentes com mais de trinta itens, sem repetir compra", async (t) => {
  const op = await preparar(t, [ata(1), ata(2), ata(3, "2026-10-01")]);
  const chamadas = [];
  const m = await recuperar({ ...op, buscarRemoto: fonte(chamadas) });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.atasPendentes, 1);
  assert.equal(m.compras[compra].itens, 31);
  assert.equal(chamadas.filter((url) => url.endsWith("/resultados")).length, 31);
  assert.equal(m.atas[ata(3).numeroControlePNCPAta].status, "pendente");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(op.diretorio, "fila-origem-mercado.json"))), op.mercado);
});
test("pagina itens até término real e mantém resultado de cada item", async (t) => {
  const m = await recuperar({ ...await preparar(t, [ata(1)]), buscarRemoto: fonte([], 101) });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.compras[compra].paginasItens, 2);
  assert.equal(m.compras[compra].itensComResultadoConsultado, 101);
});
test("falha preserva páginas e retomada busca apenas falta mais conferência", async (t) => {
  const op = await preparar(t);
  const partial = await recuperar({ ...op, buscarRemoto: async (url) => new URL(url).searchParams.get("pagina") === "1" ? pagina(1) : null });
  assert.equal(partial.contratos.paginas, 1);
  assert.equal(partial.concluidaSelecao, false);
  const chamadas = [];
  const completo = await recuperar({ ...op, buscarRemoto: fonte(chamadas) });
  assert.equal(completo.concluidaSelecao, true);
  assert.deepEqual(chamadas.map((url) => new URL(url).searchParams.get("pagina")), ["2", "1"]);
});
test("duplicação e mudança de primeira página impedem conclusão", async (t) => {
  const op = await preparar(t);
  const m = await recuperar({ ...op, buscarRemoto: async (url) => ({ ...pagina(Number(new URL(url).searchParams.get("pagina"))), data: [{ numeroControlePNCP: "repetido" }] }) });
  assert.equal(m.concluidaSelecao, false); assert.match(m.erro, /duplicado/);
  const op2 = await preparar(t); let vezes = 0;
  const r = await recuperar({ ...op2, buscarRemoto: async (url) => { const n = Number(new URL(url).searchParams.get("pagina")); const dado = pagina(n); if (n === 1 && ++vezes === 2) dado.data[0].numeroControlePNCP = "mudou"; return dado; } });
  assert.equal(r.concluidaSelecao, false); assert.match(r.erro, /Primeira página mudou/);
});
test("resultado cruzado não conclui compra nem ata", async (t) => {
  const normal = fonte([], 1);
  const m = await recuperar({ ...await preparar(t, [ata(1)]), buscarRemoto: async (url) => url.endsWith("/resultados") ? [{ numeroItem: 2, numeroControlePNCPCompra: compra }] : normal(url) });
  assert.equal(m.concluidaSelecao, false); assert.match(m.erro, /outro item/);
  assert.equal(m.atas[ata(1).numeroControlePNCPAta].status, "pendente");
});
test("orçamento e trava impedem rajada/execução concorrente, preservando retomada", async (t) => {
  const op = await preparar(t);
  let count = 0;
  const parcial = await recuperar({ ...op, maxChamadas: 2, buscarRemoto: async (url) => {
    count++;
    const lock = JSON.parse(await fs.readFile(path.join(op.diretorio, "recuperacao.lock")));
    assert.equal(lock.pid, process.pid);
    await assert.rejects(recuperar({ ...op, buscarRemoto: fonte([]) }), /travada/);
    return pagina(Number(new URL(url).searchParams.get("pagina")));
  } });
  assert.equal(count, 2); assert.equal(parcial.concluidaSelecao, false); assert.match(parcial.erro, /Orçamento/);
  assert.equal((await recuperar({ ...op, buscarRemoto: fonte([]) })).concluidaSelecao, true);
});
test("cache adulterado, fonte/consulta diferente e seleção inválida falham fechadas", async (t) => {
  const op = await preparar(t);
  await recuperar({ ...op, maxChamadas: 2, buscarRemoto: fonte([]) });
  const cache = (await fs.readdir(op.diretorio)).find((name) => name.startsWith("resposta-"));
  const arquivo = path.join(op.diretorio, cache), dado = JSON.parse(await fs.readFile(arquivo));
  dado.dado.data[0].numeroControlePNCP = "adulterado"; await fs.writeFile(arquivo, JSON.stringify(dado));
  const m = await recuperar({ ...op, buscarRemoto: fonte([]) });
  assert.equal(m.concluidaSelecao, false); assert.match(m.erro, /Integridade|Cache corrompido/);
  await assert.rejects(recuperar({ ...op, fim: "20261028", buscarRemoto: fonte([]) }), /outra consulta/);
  await assert.rejects(recuperar({ ...op, ataIds: ["inexistente"], buscarRemoto: fonte([]) }), /Seleção/);
});
test("resposta vazia contraditória e itens repetidos não viram cobertura integral", async (t) => {
  const op = await preparar(t);
  const m = await recuperar({ ...op, buscarRemoto: async () => ({ data: [], totalPaginas: 0, totalRegistros: 12 }) });
  assert.equal(m.concluidaSelecao, false);
  const normal = fonte([], 101);
  const r = await recuperar({ ...await preparar(t, [ata(1)]), buscarRemoto: (url) => url.includes("/itens?pagina=2") ? [{ numeroItem: 1 }] : normal(url) });
  assert.equal(r.concluidaSelecao, false); assert.match(r.erro, /repetido/);
});
test("vazio contraditório em itens ou resultados mantém ata pendente", async (t) => {
  for (const alvo of ["/itens?", "/resultados"]) {
    const normal = fonte([], 1);
    const m = await recuperar({ ...await preparar(t, [ata(1)]), buscarRemoto: (url) => url.includes(alvo) ? { data: [], totalPaginas: 0, totalRegistros: 12 } : normal(url) });
    assert.equal(m.concluidaSelecao, false); assert.match(m.erro, /Lista PNCP inválida/);
    assert.equal(m.atas[ata(1).numeroControlePNCPAta].status, "pendente");
  }
});
test("retomada concluída verifica arquivos brutos e pacote consolidado antes de afirmar sucesso", async (t) => {
  for (const prefixo of ["resposta-", "compra-"]) {
    const op = await preparar(t, [ata(1)]);
    assert.equal((await recuperar({ ...op, buscarRemoto: fonte([], 1) })).concluidaSelecao, true);
    const nome = (await fs.readdir(op.diretorio)).find((n) => n.startsWith(prefixo));
    await fs.unlink(path.join(op.diretorio, nome));
    const m = await recuperar({ ...op, buscarRemoto: async () => { throw new Error("Não deveria buscar antes de validar artefatos"); } });
    assert.equal(m.concluidaSelecao, false); assert.match(m.erro, /Integridade local/);
  }
});
test("caminho com helper real preserva motivo de orçamento sem chamada extra", async (t) => {
  const op = await preparar(t), anterior = global.fetch;
  let chamadas = 0, agora = Date.now();
  t.mock.method(Date, "now", () => agora);
  t.mock.method(global, "setTimeout", (callback, atraso) => { agora += atraso; Promise.resolve().then(callback); });
  global.fetch = async (url) => { chamadas++; return new Response(JSON.stringify(pagina(Number(new URL(url).searchParams.get("pagina")))), { status: 200 }); };
  t.after(() => { global.fetch = anterior; });
  const m = await recuperar({ ...op, intervaloMs: 7000, maxChamadas: 2 });
  assert.equal(chamadas, 2); assert.equal(m.concluidaSelecao, false); assert.match(m.erro, /Orçamento/);
});

async function prepararHistorico(t, fila = [ata(1), ata(2, "2026-01-01")]) {
  const origem = await preparar(t, fila);
  await recuperar({ ...origem, buscarRemoto: fonte([], 1) });
  const destino = await preparar(t, fila);
  return { ...destino, historico: true, snapshotAnterior: origem.diretorio };
}
function fonteHistorico(chamadas, descobertas = [ata(3, "2026-01-01")]) {
  const normal = fonte(chamadas, 1);
  return (url) => {
    if (new URL(url).pathname.endsWith("/atas")) {
      chamadas.push(url);
      return { numeroPagina: 1, totalPaginas: descobertas.length ? 1 : 0, totalRegistros: descobertas.length, data: descobertas };
    }
    return normal(url);
  };
}
function paginaCatalogo(n, total) {
  return { numeroPagina: n, totalPaginas: Math.ceil(total / 500), totalRegistros: total, data: Array.from({ length: Math.min(500, Math.max(0, total - (n - 1) * 500)) }, (_, i) => ata((n - 1) * 500 + i + 1, "2026-01-01")) };
}
function simularHttpComPrazo(t, responder) {
  let agora = Date.now();
  const prazos = new Set(), chamadas = [];
  const avancar = (ms) => {
    agora += ms;
    for (const prazo of prazos) if (prazo.instante <= agora) { prazos.delete(prazo); prazo.callback(); }
  };
  t.mock.method(Date, "now", () => agora);
  t.mock.method(global, "setTimeout", (callback, atraso) => {
    if (atraso >= 25000) { const prazo = { callback, instante: agora + atraso }; prazos.add(prazo); return prazo; }
    avancar(atraso); Promise.resolve().then(callback);
  });
  t.mock.method(global, "clearTimeout", (prazo) => prazos.delete(prazo));
  t.mock.method(global, "fetch", async (url, { signal }) => {
    assert.equal(prazos.size, 1, "O helper precisa manter um único prazo ativo por tentativa.");
    chamadas.push({ url, timeoutMs: [...prazos][0].instante - agora });
    const { dado, cabecalhosMs = 0, corpoMs = 0 } = await responder(url);
    avancar(cabecalhosMs); signal.throwIfAborted();
    return { status: 200, ok: true, text: async () => { avancar(corpoMs); signal.throwIfAborted(); return JSON.stringify(dado); } };
  });
  return chamadas;
}
test("helper real aceita catálogo histórico com resposta de 47 segundos", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]);
  const chamadas = simularHttpComPrazo(t, () => ({ dado: paginaCatalogo(1, 1), cabecalhosMs: 45000, corpoMs: 2000 }));
  const m = await recuperar({ ...op, intervaloMs: 7000 });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.descobertas["20260803-20261004"].registros, 1);
  assert.equal(chamadas.length, 2, "Página inicial e conferência final, sem retentativas.");
  assert(chamadas.every((c) => c.timeoutMs === 60000));
});
test("helper real mantém 25 segundos em detalhes históricos e modo comum", async (t) => {
  const historico = await prepararHistorico(t, [ata(2, "2026-01-01")]);
  const comum = await preparar(t, [ata(1)]);
  let responder = fonteHistorico([], [ata(2, "2026-01-01")]);
  const chamadas = simularHttpComPrazo(t, async (url) => ({ dado: await responder(url) }));
  const m = await recuperar({ ...historico, intervaloMs: 7000 });
  assert.equal(m.concluidaSelecao, true, m.erro);
  const catalogo = chamadas.filter((c) => new URL(c.url).pathname === "/api/consulta/v1/atas");
  assert.equal(catalogo.length, 2);
  assert(catalogo.every((c) => c.timeoutMs === 60000));
  const detalhes = chamadas.filter((c) => !catalogo.includes(c));
  for (const trecho of ["/atas/", "/api/consulta/v1/orgaos/", "/itens?", "/resultados"]) assert(detalhes.some((c) => c.url.includes(trecho)));
  assert(detalhes.every((c) => c.timeoutMs === 25000));
  const anteriores = chamadas.length;
  responder = fonte([], 1);
  const normal = await recuperar({ ...comum, intervaloMs: 7000 });
  assert.equal(normal.concluidaSelecao, true, normal.erro);
  assert(chamadas.slice(anteriores).some((c) => c.url.includes("/contratos?")));
  assert(chamadas.slice(anteriores).every((c) => c.timeoutMs === 25000));
});
test("helper real limita cabeçalhos mais corpo a 60 segundos e preserva página aceita", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]);
  const chamadas = simularHttpComPrazo(t, (url) => {
    const n = Number(new URL(url).searchParams.get("pagina"));
    return { dado: paginaCatalogo(n, 501), cabecalhosMs: 20000, corpoMs: n === 1 ? 27000 : 41000 };
  });
  const m = await recuperar({ ...op, intervaloMs: 7000 });
  assert.equal(m.concluidaSelecao, false);
  assert.match(m.erro, /Fonte indisponível/);
  assert.equal(m.descobertas["20260803-20261004"].paginas, 1);
  assert.equal(m.descobertas["20260803-20261004"].registros, 500);
  assert.deepEqual(chamadas.map((c) => Number(new URL(c.url).searchParams.get("pagina"))), [1, 2, 2, 2, 2]);
  assert.equal(m.chamadasNestaExecucao, 5);
  const nome = m.descobertas["20260803-20261004"].paginasAceitas[1].arquivo;
  const bytes = await fs.readFile(path.join(op.diretorio, nome));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), m.arquivos[nome]);
  assert.equal(JSON.parse(bytes).dado.numeroPagina, 1);
  await assert.rejects(fs.access(path.join(op.diretorio, "recuperacao.lock")), { code: "ENOENT" });
});
test("catálogo aceita crescimento observado após reconferir fronteiras sem sobrescrever o primeiro bruto", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]); let chamadas = 0;
  const m = await recuperar({ ...op, buscarRemoto: (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), ++chamadas === 1 ? 501 : 502) });
  assert.equal(m.concluidaSelecao, true, m.erro);
  const estado = m.descobertas["20260803-20261004"];
  assert.equal(estado.totalInicial, 501);
  assert.equal(estado.totalEsperado, 502);
  assert.equal(estado.registros, 502);
  assert(estado.observacoes.some((o) => o.motivo === "crescimento"));
  const bruto = JSON.parse(await fs.readFile(path.join(op.diretorio, estado.paginasAceitas[1].arquivo)));
  assert.equal(bruto.dado.totalRegistros, 501);
});
test("crescimento na conferência final fica pendente e retoma pela extensão idêntica da última página parcial", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]); let chamadas = 0;
  const buscarRemoto = (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), ++chamadas <= 2 ? 501 : 502);
  const parcial = await recuperar({ ...op, buscarRemoto });
  assert.equal(parcial.concluidaSelecao, false);
  assert.match(parcial.erro, /conferência final/);
  const anterior = parcial.descobertas["20260803-20261004"].paginasAceitas[2].arquivo;
  const bytes = await fs.readFile(path.join(op.diretorio, anterior), "utf8");
  const completo = await recuperar({ ...op, buscarRemoto });
  assert.equal(completo.concluidaSelecao, true, completo.erro);
  assert.equal(completo.descobertas["20260803-20261004"].registros, 502);
  assert.notEqual(completo.descobertas["20260803-20261004"].paginasAceitas[2].arquivo, anterior);
  assert.equal(await fs.readFile(path.join(op.diretorio, anterior), "utf8"), bytes);
});
test("crescimento além da página parcial preserva trecho pendente sem fixar um buraco no catálogo", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]); let chamadas = 0;
  const parcial = await recuperar({ ...op, buscarRemoto: (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), ++chamadas === 1 ? 501 : chamadas === 2 ? 502 : 1001) });
  assert.equal(parcial.concluidaSelecao, false);
  assert.equal(parcial.descobertas["20260803-20261004"].paginas, 1);
  const completo = await recuperar({ ...op, buscarRemoto: (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), 1001) });
  assert.equal(completo.concluidaSelecao, true, completo.erro);
  assert.equal(completo.descobertas["20260803-20261004"].registros, 1001);
});
test("catálogo interrompe queda, reordenação ou campo alterado ao revalidar crescimento", async (t) => {
  for (const caso of ["queda", "ordem", "campo"]) {
    const op = await prepararHistorico(t, [ata(1)]); let chamadas = 0;
    const m = await recuperar({ ...op, buscarRemoto: (url) => {
      const n = Number(new URL(url).searchParams.get("pagina"));
      const dado = paginaCatalogo(n, ++chamadas === 1 ? 501 : chamadas > 2 && caso === "queda" ? 500 : 502);
      if (chamadas > 2 && n === 1 && caso === "ordem") [dado.data[0], dado.data[1]] = [dado.data[1], dado.data[0]];
      if (chamadas > 2 && n === 1 && caso === "campo") dado.data[0].vigenciaFim = "2027-01-01";
      return dado;
    } });
    assert.equal(m.concluidaSelecao, false);
    assert.match(m.erro, /diminuiu|fronteira|Primeira página/);
  }
});
test("catálogo retoma checkpoint legado sem refazer páginas intermediárias nem apagar brutos", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]);
  const parcial = await recuperar({ ...op, maxChamadas: 5, buscarRemoto: (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), 2501) });
  const estado = parcial.descobertas["20260803-20261004"];
  for (const [n, pagina] of Object.entries(estado.paginasAceitas)) {
    const bruto = await fs.readFile(path.join(op.diretorio, pagina.arquivo));
    const rota = JSON.parse(bruto).rota;
    const nome = `resposta-${createHash("sha256").update(estado.snapshot + rota).digest("hex")}.json`;
    await fs.writeFile(path.join(op.diretorio, nome), bruto);
    parcial.arquivos[nome] = createHash("sha256").update(bruto).digest("hex");
    assert.equal(Number(n) <= 5, true);
  }
  delete estado.paginasAceitas; delete estado.totalInicial; delete estado.ancoras; delete estado.observacoes;
  await fs.writeFile(path.join(op.diretorio, "manifesto.json"), JSON.stringify(parcial));
  const chamadas = [];
  const m = await recuperar({ ...op, buscarRemoto: (url) => { const n = Number(new URL(url).searchParams.get("pagina")); chamadas.push(n); return paginaCatalogo(n, 2502); } });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.deepEqual(chamadas, [1, 5, 6, 1, 6]);
  assert.equal(m.descobertas["20260803-20261004"].registros, 2502);
  for (const [nome, valor] of Object.entries(parcial.arquivos)) assert.equal(m.arquivos[nome], valor);
});
test("orçamento histórico mínimo cinco avança após duas âncoras e crescimento com nova reconferência", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]);
  await assert.rejects(recuperar({ ...op, maxChamadas: 4, buscarRemoto: () => assert.fail("Não chamar a fonte") }), /mínimo 5 chamadas/);
  const inicial = await recuperar({ ...op, maxChamadas: 5, buscarRemoto: (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), 3501) });
  assert.equal(inicial.descobertas["20260803-20261004"].paginas, 5);
  let chamadas = 0;
  let m = await recuperar({ ...op, maxChamadas: 5, buscarRemoto: (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), ++chamadas <= 2 ? 3501 : 4001) });
  assert.equal(chamadas, 5);
  assert.equal(m.descobertas["20260803-20261004"].paginas, 6);
  for (let rodada = 0; rodada < 4 && !m.concluidaSelecao; rodada++) m = await recuperar({ ...op, maxChamadas: 5, buscarRemoto: (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), 4001) });
  assert.equal(m.concluidaSelecao, true, m.erro);
});
test("catálogo rejeita metadados e quantidade que não correspondem ao teto de 500", async (t) => {
  for (const alterar of [(d) => { d.totalPaginas = 1; }, (d) => { d.data.pop(); }]) {
    const op = await prepararHistorico(t, [ata(1)]), dado = paginaCatalogo(1, 501);
    alterar(dado);
    const m = await recuperar({ ...op, buscarRemoto: () => dado });
    assert.equal(m.concluidaSelecao, false);
    assert.match(m.erro, /incompatív/);
  }
});
test("histórico certifica catálogo paginado e detalha somente fila original sem alterar origem", async (t) => {
  const op = await prepararHistorico(t), chamadas = [];
  const caminhoOrigem = path.join(op.snapshotAnterior, "manifesto.json");
  const original = await fs.readFile(caminhoOrigem, "utf8");
  const m = await recuperar({ ...op, buscarRemoto: fonteHistorico(chamadas) });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.atasPendentes, 0);
  assert.equal(Object.keys(m.atas).length, 2);
  assert.equal(m.atas[ata(3).numeroControlePNCPAta], undefined);
  const descoberta = m.descobertas["20260803-20261004"];
  assert.equal(descoberta.registros, 1);
  assert.equal(descoberta.referencias, undefined);
  const catalogo = JSON.parse(await fs.readFile(path.join(op.diretorio, descoberta.catalogo)));
  assert.equal(catalogo.registros, 1);
  assert.equal(catalogo.compras, 1);
  const paginaCatalogo = JSON.parse(await fs.readFile(path.join(op.diretorio, catalogo.paginas[0].arquivo)));
  assert.deepEqual(paginaCatalogo.dado.data, [ata(3, "2026-01-01")]);
  assert.equal(chamadas.some((url) => url.includes("/atas/3")), false);
  assert.equal(chamadas.some((url) => url.includes("/contratos") || url.includes("/itens")), false);
  assert.equal(await fs.readFile(caminhoOrigem, "utf8"), original);
  assert(m.importacao.manifestoHash);
});
test("histórico retoma após orçamento sem repetir unidades concluídas e valida a origem em toda retomada", async (t) => {
  const op = await prepararHistorico(t, [ata(1), ...[2, 3, 4, 5].map((n) => ata(n, "2026-01-01"))]);
  const parcial = await recuperar({ ...op, maxChamadas: 5, buscarRemoto: fonteHistorico([]) });
  assert.equal(parcial.concluidaSelecao, false);
  assert.match(parcial.erro, /Orçamento/);
  const chamadas = [];
  const completo = await recuperar({ ...op, buscarRemoto: fonteHistorico(chamadas) });
  assert.equal(completo.concluidaSelecao, true, completo.erro);
  assert.equal(chamadas.filter((url) => new URL(url).pathname.endsWith("/atas")).length, 0);
  assert.equal(chamadas.some((url) => url.includes("/contratos") || url.includes("/itens")), false);
  const arquivos = await fs.readdir(op.snapshotAnterior);
  await fs.appendFile(path.join(op.snapshotAnterior, arquivos.find((n) => n.startsWith("compra-"))), " ");
  const adulterado = await recuperar({ ...op, buscarRemoto: async () => assert.fail("Não acessar rede com origem alterada") });
  assert.equal(adulterado.concluidaSelecao, false);
  assert.match(adulterado.erro, /Integridade/);
});
test("detalhes sob demanda selecionam IDs do catálogo e reutilizam certificados sem redescobrir", async (t) => {
  const historico = await prepararHistorico(t), chamadas = [];
  assert.equal((await recuperar({ ...historico, buscarRemoto: fonteHistorico([]) })).concluidaSelecao, true);
  const destino = await preparar(t, historico.mercado.filaPendente);
  const op = { ...destino, catalogo: historico.diretorio, ataIds: [ata(3).numeroControlePNCPAta], buscarRemoto: fonte(chamadas, 1) };
  const m = await recuperar(op);
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.atas[ata(3).numeroControlePNCPAta].status, "concluida-local");
  assert.equal(m.atas[ata(1).numeroControlePNCPAta].selecionada, false);
  assert.equal(chamadas.length, 1);
  assert(chamadas[0].endsWith("/atas/3"));
  assert.equal((await recuperar(op)).concluidaSelecao, true);
  assert.equal(chamadas.length, 1);
  await assert.rejects(recuperar({ ...op, ataIds: [ata(9).numeroControlePNCPAta] }), /ID ausente do catálogo/);
  const origem = JSON.parse(await fs.readFile(path.join(historico.diretorio, "manifesto.json")));
  await fs.appendFile(path.join(historico.diretorio, origem.descobertas["20260803-20261004"].catalogo), " ");
  await assert.rejects(recuperar(op), /Artefato alterado/);
  assert.equal(chamadas.length, 1);
});
test("descoberta recusa identidade cruzada e vazio contraditório, mas aceita vazio comprovado", async (t) => {
  for (const dado of [
    { numeroPagina: 1, totalPaginas: 1, totalRegistros: 1, data: [{ ...ata(3), numeroControlePNCPCompra: "invalida" }] },
    { data: [], totalPaginas: 0, totalRegistros: 1 },
  ]) {
    const m = await recuperar({ ...await prepararHistorico(t), buscarRemoto: async () => dado });
    assert.equal(m.concluidaSelecao, false);
    assert(m.erro);
  }
  const m = await recuperar({ ...await prepararHistorico(t, [ata(1)]), buscarRemoto: fonteHistorico([], []) });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.descobertas["20260803-20261004"].registros, 0);
});
test("catálogo antigo revalida fronteiras sem renovar namespace nem perder páginas", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]);
  const fonteCatalogo = (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), 2001);
  await recuperar({ ...op, maxChamadas: 5, buscarRemoto: fonteCatalogo });
  const arquivo = path.join(op.diretorio, "manifesto.json"), m = JSON.parse(await fs.readFile(arquivo));
  const antiga = new Date(Date.now() - 7 * 3600000).toISOString();
  m.iniciadoEm = antiga;
  m.descobertas["20260803-20261004"].snapshot = antiga;
  m.descobertas["20260803-20261004"].revalidadoEm = antiga;
  await fs.writeFile(arquivo, JSON.stringify(m));
  const chamadas = [];
  const retomado = await recuperar({ ...op, buscarRemoto: (url) => { chamadas.push(url); return fonteCatalogo(url); } });
  assert.equal(retomado.concluidaSelecao, true, retomado.erro);
  assert.equal(retomado.descobertas["20260803-20261004"].snapshot, antiga);
  assert.notEqual(retomado.descobertas["20260803-20261004"].revalidadoEm, antiga);
  assert.equal(chamadas.filter((url) => new URL(url).pathname.endsWith("/atas")).length, 4);
  for (const [nome, valor] of Object.entries(m.arquivos)) assert.equal(retomado.arquivos[nome], valor);
  assert.equal(chamadas.some((url) => url.includes("/contratos") || url.includes("/itens")), false);
});
test("encadeamento recusa compra parcial vencida sem renovar snapshot nem chamar a fonte", async (t) => {
  const compraNova = compra.replace("000001/", "000002/");
  const nova = { ...ata(2, "2026-01-01"), numeroControlePNCPCompra: compraNova, numeroControlePNCPAta: `${compraNova}-000002` };
  const op = await prepararHistorico(t, [ata(1), nova]), normal = fonteHistorico([]);
  await recuperar({ ...op, maxChamadas: 5, buscarRemoto: (url) => {
    if (!url.includes("/compras/2026/2")) return normal(url);
    if (url.includes("/atas/")) return { numeroControlePNCP: nova.numeroControlePNCPAta, numeroControlePncpCompra: compraNova };
    return url.includes("/itens?") ? [] : { numeroControlePNCP: compraNova };
  } });
  const arquivo = path.join(op.diretorio, "manifesto.json"), m = JSON.parse(await fs.readFile(arquivo));
  const antiga = new Date(Date.now() - 7 * 3600000).toISOString();
  m.compras[compraNova].snapshot = antiga;
  await fs.writeFile(arquivo, JSON.stringify(m));
  const retomado = await recuperar({ ...op, renovarParciais: false, buscarRemoto: () => assert.fail("Compra vencida não permite nova chamada") });
  assert.equal(retomado.concluidaSelecao, false);
  assert.match(retomado.erro, /revalidação coordenada/);
  assert.equal(retomado.compras[compraNova].snapshot, antiga);
});
test("catálogo vencido durante validação local revalida a fonte sem descartar páginas", async (t) => {
  const op = await prepararHistorico(t, [ata(1)]);
  const buscarRemoto = (url) => paginaCatalogo(Number(new URL(url).searchParams.get("pagina")), 2001);
  await recuperar({ ...op, maxChamadas: 5, buscarRemoto });
  const antes = JSON.parse(await fs.readFile(path.join(op.diretorio, "manifesto.json")));
  const snapshot = antes.descobertas["20260803-20261004"].snapshot;
  const limite = Date.parse(snapshot) + 6 * 3600000;
  let agora = limite - 1, expirou = false;
  t.mock.method(Date, "now", () => agora);
  const leitura = fs.readFile.bind(fs);
  t.mock.method(fs, "readFile", async (...args) => {
    const resultado = await leitura(...args);
    if (String(args[0]).startsWith(op.snapshotAnterior)) { agora = limite + 1; expirou = true; }
    return resultado;
  });
  const m = await recuperar({ ...op, renovarParciais: false, buscarRemoto });
  assert.equal(expirou, true);
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.descobertas["20260803-20261004"].snapshot, snapshot);
  assert.equal(m.descobertas["20260803-20261004"].paginas, 5);
});
test("compra histórica pendente retoma resultados por item sem repetir os já preservados", async (t) => {
  const compraNova = compra.replace("000001/", "000002/");
  const nova = { ...ata(1, "2026-01-01"), numeroControlePNCPCompra: compraNova, numeroControlePNCPAta: `${compraNova}-000001` };
  const op = await prepararHistorico(t, [ata(1), nova]);
  const chamadas = [], normal = fonteHistorico(chamadas, [nova]);
  const buscarRemoto = (url) => {
    if (!new URL(url).pathname.includes("/compras/2026/2")) return normal(url);
    chamadas.push(url);
    if (url.includes("/atas/")) return { numeroControlePNCP: nova.numeroControlePNCPAta, numeroControlePncpCompra: compraNova };
    if (url.endsWith("/resultados")) return [{ numeroControlePNCPCompra: compraNova, numeroItem: Number(new URL(url).pathname.split("/").at(-2)) }];
    if (url.includes("/itens?")) return [{ numeroItem: 1 }, { numeroItem: 2 }];
    return { numeroControlePNCP: compraNova };
  };
  const parcial = await recuperar({ ...op, buscarRemoto, maxChamadas: 7 });
  assert.equal(parcial.concluidaSelecao, false);
  assert.equal(parcial.compras[compraNova].itensComResultadoConsultado, 1);
  const completo = await recuperar({ ...op, buscarRemoto });
  assert.equal(completo.concluidaSelecao, true, completo.erro);
  assert.equal(completo.compras[compraNova].itensComResultadoConsultado, 2);
  assert.equal(chamadas.filter((url) => url.endsWith("/itens/1/resultados")).length, 1);
  assert.equal(chamadas.filter((url) => url.endsWith("/itens/2/resultados")).length, 1);
});
test("descoberta paginada rejeita duplicação entre páginas e alteração na reconferência", async (t) => {
  for (const alterar of [false, true]) {
    const op = await prepararHistorico(t, [ata(1)]); let primeira = 0;
    const m = await recuperar({ ...op, buscarRemoto: async (url) => {
      const n = Number(new URL(url).searchParams.get("pagina"));
      const dado = paginaCatalogo(n, 501);
      if (n === 1 && ++primeira > 1) dado.data[0] = ata(999, "2026-01-01");
      if (n === 2 && !alterar) dado.data[0] = ata(500, "2026-01-01");
      return dado;
    } });
    assert.equal(m.concluidaSelecao, false);
    assert.match(m.erro, alterar ? /Primeira página/ : /duplicada/);
  }
});
test("cadência de sete segundos persiste na fronteira entre rodadas imediatas", async (t) => {
  const op = await preparar(t), instantes = [];
  let agora = Date.now();
  t.mock.method(Date, "now", () => agora);
  t.mock.method(global, "setTimeout", (callback, atraso) => { agora += atraso; Promise.resolve().then(callback); });
  const buscarRemoto = (url) => { instantes.push(agora); return pagina(Number(new URL(url).searchParams.get("pagina")), 4); };
  await recuperar({ ...op, intervaloMs: 7000, maxChamadas: 2, buscarRemoto });
  await recuperar({ ...op, intervaloMs: 7000, maxChamadas: 2, buscarRemoto });
  assert.equal(instantes.length, 4);
  assert.equal(instantes[2] - instantes[1], 7000, "A primeira chamada da retomada deve respeitar a última chamada anterior.");
});
test("orçamento de uma chamada é rejeitado com instrução acionável antes da coleta", async (t) => {
  const op = await preparar(t), chamadas = [];
  await assert.rejects(recuperar({ ...op, maxChamadas: 1, buscarRemoto: fonte(chamadas) }), /mínimo 2 chamadas/);
  assert.equal(chamadas.length, 0);
});
test("orçamento mínimo de duas chamadas conclui resultados em retomadas sucessivas", async (t) => {
  const op = await preparar(t, [ata(1)]), chamadas = [], buscarRemoto = fonte(chamadas, 3);
  let m;
  for (let rodada = 0; rodada < 10 && !m?.concluidaSelecao; rodada++) m = await recuperar({ ...op, buscarRemoto, maxChamadas: 2 });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.compras[compra].itensComResultadoConsultado, 3);
  assert.equal(chamadas.filter((url) => url.endsWith("/resultados")).length, 3);
});

async function prepararDetalhes(t) {
  const concluidas = [1, 2, 3, 4, 5].map((n) => ata(n));
  const outraCompra = compra.replace("000001/", "000002/");
  const pendentes = [ata(6, "2026-01-01"), { numeroControlePNCPAta: `${outraCompra}-000001`, numeroControlePNCPCompra: outraCompra, vigenciaFim: "2026-01-01" }];
  const fila = [...concluidas, ...pendentes];
  const origem = await preparar(t, fila), destino = await preparar(t, fila);
  const certificado = await recuperar({ ...origem, buscarRemoto: fonte([], 3) });
  assert.equal(certificado.concluidaSelecao, true, certificado.erro);
  assert.equal(Object.values(certificado.atas).filter((a) => a.status === "concluida-local").length, 5);
  const op = { ...destino, snapshotAnterior: origem.diretorio, ataIds: pendentes.map((a) => a.numeroControlePNCPAta), renovarParciais: false };
  const chamadas = [], normal = fonte(chamadas, 3);
  const buscarRemoto = (url) => {
    if (!url.includes("/compras/2026/2")) return normal(url);
    chamadas.push(url);
    if (url.includes("/atas/")) return { numeroControlePNCP: pendentes[1].numeroControlePNCPAta, numeroControlePncpCompra: outraCompra };
    if (url.endsWith("/resultados")) return [{ numeroControlePNCPCompra: outraCompra, numeroItem: Number(new URL(url).pathname.split("/").at(-2)) }];
    return url.includes("/itens?") ? [1, 2, 3].map((numeroItem) => ({ numeroItem })) : { numeroControlePNCP: outraCompra };
  };
  return { op, certificado, concluidas, outraCompra, chamadas, buscarRemoto };
}
async function inventariarOrigem(diretorio) {
  const nomes = await fs.readdir(diretorio);
  return Object.fromEntries(await Promise.all(nomes.map(async (nome) => [nome, createHash("sha256").update(await fs.readFile(path.join(diretorio, nome))).digest("hex")])));
}
test("IDs explícitos reutilizam contratos/compra certificada e preservam cinco atas na origem", async (t) => {
  const { op, concluidas, chamadas, buscarRemoto } = await prepararDetalhes(t);
  const antes = await inventariarOrigem(op.snapshotAnterior);
  const m = await recuperar({ ...op, buscarRemoto });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert.equal(m.consulta.detalhes, true);
  assert.equal(m.descobertas, undefined);
  assert.equal(chamadas.some((url) => new URL(url).pathname.endsWith("/atas") || url.includes("/contratos")), false);
  assert.equal(chamadas.filter((url) => url.includes("/compras/2026/1") && !url.includes("/atas/")).length, 0);
  assert.equal(m.importacao.manifestoHash, antes["manifesto.json"]);
  assert.deepEqual(await inventariarOrigem(op.snapshotAnterior), antes);
  const origem = JSON.parse(await fs.readFile(path.join(op.snapshotAnterior, "manifesto.json")));
  for (const a of concluidas) assert.equal(origem.atas[a.numeroControlePNCPAta].status, "concluida-local");
});
test("IDs explícitos retomam só resultados faltantes com orçamento de duas chamadas", async (t) => {
  const { op, chamadas, buscarRemoto, outraCompra } = await prepararDetalhes(t);
  let m, rodadas = 0;
  while (!m?.concluidaSelecao && rodadas++ < 20) m = await recuperar({ ...op, buscarRemoto, maxChamadas: 2 });
  assert.equal(m.concluidaSelecao, true, m.erro);
  assert(rodadas > 1);
  assert.equal(m.compras[outraCompra].itensComResultadoConsultado, 3);
  const resultados = chamadas.filter((url) => url.endsWith("/resultados"));
  assert.equal(resultados.length, 3);
  assert.equal(new Set(resultados).size, 3);
  assert.equal(chamadas.some((url) => url.includes("/contratos")), false);
});
test("IDs explícitos recusam compra parcial vencida sem renovar nem perder brutos", async (t) => {
  const { op, buscarRemoto, outraCompra, chamadas } = await prepararDetalhes(t);
  const parcial = await recuperar({ ...op, buscarRemoto, maxChamadas: 4 });
  assert.match(parcial.erro, /Orçamento/);
  assert(parcial.compras[outraCompra]?.snapshot);
  const arquivosAntes = Object.fromEntries(await Promise.all(Object.keys(parcial.arquivos).map(async (nome) => [nome, await fs.readFile(path.join(op.diretorio, nome), "utf8")])));
  chamadas.length = 0;
  const agora = Date.now(); t.mock.method(Date, "now", () => agora + 7 * 3600000);
  const m = await recuperar({ ...op, buscarRemoto });
  assert.equal(m.concluidaSelecao, false);
  assert.match(m.erro, /Snapshot parcial venceu/);
  assert.deepEqual(m.compras, parcial.compras);
  assert.equal(chamadas.length, 0);
  for (const [nome, bytes] of Object.entries(arquivosAntes)) assert.equal(await fs.readFile(path.join(op.diretorio, nome), "utf8"), bytes);
});
test("IDs explícitos validam seleção e origem antes de qualquer chamada", async (t) => {
  const { op, buscarRemoto, chamadas } = await prepararDetalhes(t);
  for (const ataIds of [["ausente"], [op.ataIds[0], op.ataIds[0]], [], undefined]) {
    await assert.rejects(recuperar({ ...op, ataIds, buscarRemoto }), /Seleção|seleção/);
  }
  for (const snapshotAnterior of ["relativa", op.diretorio, __dirname]) {
    await assert.rejects(recuperar({ ...op, snapshotAnterior, buscarRemoto }), /Pasta|pasta|diferentes/);
  }
  assert.equal(chamadas.length, 0);
});
test("IDs explícitos recusam origem incompleta ou com fila/período incompatível", async (t) => {
  for (const campo of ["fila", "periodo", "incompleta"]) {
    const { op, buscarRemoto, chamadas } = await prepararDetalhes(t);
    const arquivo = path.join(op.snapshotAnterior, "manifesto.json"), m = JSON.parse(await fs.readFile(arquivo));
    if (campo === "fila") m.consulta.mercadoHash = "outra-fila";
    if (campo === "periodo") m.consulta.inicio = "20260101";
    if (campo === "incompleta") m.concluidaSelecao = false;
    await fs.writeFile(arquivo, JSON.stringify(m));
    const resultado = await recuperar({ ...op, buscarRemoto });
    assert.equal(resultado.concluidaSelecao, false);
    assert.match(resultado.erro, /Origem não certifica/);
    assert.equal(chamadas.length, 0);
  }
});
test("IDs explícitos recusam artefato adulterado e mudança de origem após checkpoint", async (t) => {
  const { op, buscarRemoto, chamadas, certificado } = await prepararDetalhes(t);
  await recuperar({ ...op, buscarRemoto, maxChamadas: 2 });
  chamadas.length = 0;
  const arquivo = path.join(op.snapshotAnterior, "manifesto.json"), bytes = await fs.readFile(arquivo);
  await fs.appendFile(arquivo, " ");
  const alterado = await recuperar({ ...op, buscarRemoto });
  assert.equal(alterado.concluidaSelecao, false);
  assert.match(alterado.erro, /Manifesto de origem alterado/);
  const outraOrigem = await preparar(t);
  await assert.rejects(recuperar({ ...op, snapshotAnterior: outraOrigem.diretorio, buscarRemoto }), /outra consulta/);
  await fs.writeFile(arquivo, bytes);
  await fs.appendFile(path.join(op.snapshotAnterior, Object.keys(certificado.arquivos)[0]), " ");
  const adulterado = await recuperar({ ...op, buscarRemoto });
  assert.equal(adulterado.concluidaSelecao, false);
  assert.match(adulterado.erro, /Artefato alterado/);
  assert.equal(chamadas.length, 0);
});
test("checkpoint de detalhes e modo comum não se convertem e mantêm validade própria", async (t) => {
  const { op, buscarRemoto } = await prepararDetalhes(t);
  await recuperar({ ...op, buscarRemoto });
  await assert.rejects(recuperar({ ...op, snapshotAnterior: undefined, buscarRemoto }), /outra consulta/);
  const comum = { ...op, ...await preparar(t, op.mercado.filaPendente), snapshotAnterior: undefined };
  assert.equal((await recuperar({ ...comum, buscarRemoto })).concluidaSelecao, true);
  await assert.rejects(recuperar({ ...comum, snapshotAnterior: op.snapshotAnterior, buscarRemoto }), /outra consulta/);
  const agora = Date.now(); t.mock.method(Date, "now", () => agora + 7 * 3600000);
  await assert.rejects(recuperar({ ...comum, buscarRemoto }), /Checkpoint antigo/);
  assert.equal((await recuperar({ ...op, buscarRemoto })).concluidaSelecao, true);
});
test("origem histórica incompleta não vira catálogo através dos IDs explícitos", async (t) => {
  const { op, buscarRemoto, chamadas } = await prepararDetalhes(t);
  const arquivo = path.join(op.snapshotAnterior, "manifesto.json"), m = JSON.parse(await fs.readFile(arquivo));
  m.consulta.historico = true; m.concluidaSelecao = false;
  await fs.writeFile(arquivo, JSON.stringify(m));
  await assert.rejects(recuperar({ ...op, catalogo: op.snapshotAnterior, buscarRemoto }), /Catálogo histórico não concluído/);
  assert.equal(chamadas.length, 0);
});
test("CLI de detalhes lê IDs explícitos e fixa cadência, orçamento e recusa de renovação", async (t) => {
  const { op } = await prepararDetalhes(t);
  const mercado = path.join(op.snapshotAnterior, "fila-origem-mercado.json"), ids = path.join(op.diretorio, "ids.json");
  await fs.writeFile(ids, JSON.stringify(op.ataIds));
  const args = [op.diretorio, mercado, op.inicio, op.fim, op.referencia, "--detalhes", op.snapshotAnterior, ids];
  const options = await lerOpcoesCli(args, {});
  assert.equal(options.intervaloMs, 7000);
  assert.equal(options.maxChamadas, 350);
  assert.equal(options.renovarParciais, false);
  assert.equal(options.snapshotAnterior, op.snapshotAnterior);
  assert.deepEqual(options.ataIds, op.ataIds);
  assert.deepEqual(options.mercado, op.mercado);
  assert.equal((await lerOpcoesCli(args, { RECUPERACAO_MAX_CHAMADAS: "2" })).maxChamadas, 2);
  for (const valor of ["351", "1", "0", "NaN", "2.5"]) await assert.rejects(lerOpcoesCli(args, { RECUPERACAO_MAX_CHAMADAS: valor }), /Orçamento/);
  await assert.rejects(lerOpcoesCli(args.slice(0, -1), {}), /--detalhes/);
  await assert.rejects(lerOpcoesCli([...args, "extra"], {}), /--detalhes/);
  for (const valor of [[], null, "id", [op.ataIds[0], op.ataIds[0]], [""]]) {
    await fs.writeFile(ids, JSON.stringify(valor));
    await assert.rejects(lerOpcoesCli(args, {}), /Seleção/);
  }
});
test("parser da CLI preserva seleções comum, histórica e por catálogo", async (t) => {
  const op = await preparar(t);
  const mercado = path.join(op.diretorio, "mercado.json"); await fs.writeFile(mercado, JSON.stringify(op.mercado));
  const args = [op.diretorio, mercado, op.inicio, op.fim, op.referencia];
  assert.equal((await lerOpcoesCli(args, {})).ataIds, undefined);
  assert.deepEqual((await lerOpcoesCli([...args, "id-1,id-2"], {})).ataIds, ["id-1", "id-2"]);
  const historico = await lerOpcoesCli([...args, "--historico", op.diretorio], {});
  assert.equal(historico.historico, true); assert.equal(historico.snapshotAnterior, op.diretorio);
  const catalogo = await lerOpcoesCli([...args, "--catalogo", op.diretorio, "id-1"], {});
  assert.equal(catalogo.catalogo, op.diretorio); assert.deepEqual(catalogo.ataIds, ["id-1"]);
});
test("CLI executa detalhes com helper real simulado e preserva lock concorrente", async (t) => {
  const { op } = await prepararDetalhes(t);
  const ids = path.join(op.diretorio, "ids.json"), preload = path.join(op.diretorio, "fonte-offline.cjs");
  await fs.writeFile(ids, JSON.stringify(op.ataIds));
  await fs.writeFile(preload, `
    const fs = require('node:fs');
    const fila = JSON.parse(fs.readFileSync(process.argv[3])).filaPendente;
    let agora = Date.now(); Date.now = () => agora;
    global.setTimeout = (fn, ms) => { agora += ms; Promise.resolve().then(fn); };
    global.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/atas') || u.pathname.endsWith('/contratos')) throw new Error('Consulta desnecessária');
      const partes = u.pathname.split('/'), seq = Number(partes[partes.indexOf('compras') + 2]);
      const compra = fila.find((a) => Number(a.numeroControlePNCPCompra.split('-1-')[1].split('/')[0]) === seq)?.numeroControlePNCPCompra;
      if (!compra) throw new Error('Compra fora da fixture');
      let dado = { numeroControlePNCP: compra };
      if (u.pathname.includes('/atas/')) dado = { numeroControlePNCP: compra + '-' + u.pathname.split('/').at(-1).padStart(6, '0'), numeroControlePncpCompra: compra };
      if (u.pathname.endsWith('/itens')) dado = [{ numeroItem: 1 }];
      if (u.pathname.endsWith('/resultados')) dado = [{ numeroControlePNCPCompra: compra, numeroItem: 1 }];
      return new Response(JSON.stringify(dado));
    };
  `);
  const args = [path.join(__dirname, "recuperar_contratos_atas_local.js"), op.diretorio, path.join(op.snapshotAnterior, "fila-origem-mercado.json"), op.inicio, op.fim, op.referencia, "--detalhes", op.snapshotAnterior, ids];
  const executar = () => spawnSync(process.execPath, ["--require", preload, ...args], { encoding: "utf8", env: { ...process.env, RECUPERACAO_MAX_CHAMADAS: "350" } });
  const lock = path.join(op.diretorio, "recuperacao.lock");
  await fs.writeFile(lock, "lock-de-outra-execucao");
  const travado = executar();
  assert.equal(travado.status, 1); assert.match(travado.stderr, /travada/);
  assert.equal(await fs.readFile(lock, "utf8"), "lock-de-outra-execucao");
  await fs.unlink(lock);
  const resultado = executar();
  assert.equal(resultado.status, 0, resultado.stderr + resultado.stdout);
  assert.equal(JSON.parse(resultado.stdout).concluidaSelecao, true);
  const m = JSON.parse(await fs.readFile(path.join(op.diretorio, "manifesto.json")));
  assert.equal(m.chamadasNestaExecucao, 6);
  assert.equal(m.consulta.detalhes, true);
  await assert.rejects(fs.access(lock), { code: "ENOENT" });
});
