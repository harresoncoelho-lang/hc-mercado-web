// Robô CEIS/CNEP: leitura do CSV real (amostra pequena em fixtures/sancoes_cgu), PF descartada, upsert e sumiço.
// Amostra: 3 linhas reais de PJ por cadastro (arquivo de 18/11/2026) + 1 linha de PF fictícia.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const robo = require("./coletar_sancoes_cgu");

const amostra = (c) => fs.readFileSync(path.join(__dirname, "fixtures/sancoes_cgu", `${c}_amostra.csv`));
const zipDe = (bytes) => { const z = new AdmZip(); z.addFile("20261119_CEIS.csv", bytes); return z.toBuffer(); };

test("lê o CEIS real (Windows-1252, ';', aspas): só PJ, campos normalizados", () => {
  const r = robo.lerSancoes(amostra("CEIS"), "CEIS", "2026-11-19");
  assert.equal(r.descartadasPF, 1);
  assert.equal(r.invalidas, 0);
  assert.deepEqual(r.linhas.map((l) => l.codigo_sancao), ["356526", "125035", "48059"]);
  const s = r.linhas[0];
  assert.equal(s.cnpj, "12365820000166");
  assert.equal(s.razao_social, "SNE PARTNER SERVICE LTDA");
  assert.equal(s.tipo_sancao, "Suspensão"); // acento certo = encoding certo
  assert.equal(s.data_inicio, "2025-07-18");
  assert.equal(s.data_fim, "2027-07-18");
  assert.equal(s.uf_orgao, "DF");
  assert.equal(s.data_carga, "2026-11-19");
  assert.equal(s.fora_da_lista, false);
  assert.equal(r.linhas[2].data_fim, null); // sem prazo
  // Nada de pessoa física nem do texto livre de observações.
  const tudo = JSON.stringify(r.linhas);
  assert.ok(!tudo.includes("00000000191") && !tudo.includes("PESSOA FICTICIA"));
  assert.ok(r.linhas.every((l) => !("observacoes" in l) && /^\d{14}$/.test(l.cnpj)));
});

test("lê o CNEP real com valor da multa", () => {
  const r = robo.lerSancoes(amostra("CNEP"), "CNEP", "2026-11-19");
  assert.equal(r.descartadasPF, 1);
  assert.deepEqual(r.linhas.map((l) => [l.codigo_sancao, l.valor_multa]), [["336269", 0], ["105606", 8029.51], ["119878", 135408.18]]);
});

test("CSV: aspas duplicadas, ';' e quebra de linha dentro do campo", () => {
  assert.deepEqual(robo.lerCsv('"a";"b ""x"";c"\r\n"linha\r\ndois";""\r\n'), [["a", 'b "x";c'], ["linha\r\ndois", ""]]);
});

test("layout mudou (coluna ausente) falha alto em vez de gravar errado", () => {
  assert.throws(() => robo.lerSancoes(Buffer.from('"CADASTRO";"X"\r\n"CEIS";"1"\r\n'), "CEIS", "2026-11-19"), /coluna "CÓDIGO DA SANÇÃO" ausente/);
});

test("ZIP: extrai o único CSV; resposta que não é ZIP é recusada", () => {
  assert.deepEqual(robo.csvDoZip(zipDe(amostra("CEIS"))), amostra("CEIS"));
  assert.throws(() => robo.csvDoZip(Buffer.from("<Error>AccessDenied</Error>")), /não é ZIP/);
});

test("dia de Brasília: 02:00 UTC ainda é o dia anterior", () => {
  const t = Date.parse("2026-11-19T02:00:00Z");
  assert.equal(robo.diaBrasilia(t), "20261118");
  assert.equal(robo.diaBrasilia(t, -1), "20261117");
});

// Banco fictício: guarda as linhas por chave e aplica o PATCH de sumiço como o PostgREST.
function bancoFalso(linhasIniciais = []) {
  const linhas = new Map(linhasIniciais.map((l) => [`${l.cadastro}|${l.codigo_sancao}`, { ...l }]));
  const patches = [];
  const resposta = (corpo, faixa) => ({ json: async () => corpo, headers: new Headers(faixa ? { "content-range": faixa } : {}) });
  return {
    linhas, patches,
    async upsert(tabela, lote, conflito) {
      assert.equal(tabela, "sancoes_empresas");
      assert.equal(conflito, "cadastro,codigo_sancao");
      for (const l of lote) linhas.set(`${l.cadastro}|${l.codigo_sancao}`, { ...l });
    },
    async rest(caminho, op = {}) {
      const u = new URL(caminho, "http://x/");
      const cad = u.searchParams.get("cadastro").slice(3);
      const doCad = [...linhas.values()].filter((l) => l.cadastro === cad);
      if (op.method === "PATCH") {
        const corte = u.searchParams.get("data_carga").slice(3);
        const alvo = doCad.filter((l) => l.data_carga < corte && !l.fora_da_lista);
        alvo.forEach((l) => Object.assign(l, JSON.parse(op.body)));
        patches.push(caminho);
        return resposta(null, `*/${alvo.length}`);
      }
      if (u.searchParams.get("order")) return resposta(doCad.map((l) => l.data_carga).sort().reverse().slice(0, 1).map((d) => ({ data_carga: d })));
      return resposta([], `0-0/${doCad.filter((l) => !l.fora_da_lista).length}`);
    },
  };
}
const antiga = (codigo, data = "2026-11-18") => ({ cadastro: "CEIS", codigo_sancao: codigo, cnpj: "11222333000181", data_carga: data, fora_da_lista: false });
const fetchCom = (mapa) => async (url) => {
  const v = mapa[url.split("/").pop()];
  if (v instanceof Error) throw v;
  return v ? new Response(v) : new Response("<Error/>", { status: 403 });
};

test("carga: grava PJ, marca o que sumiu sem apagar e cai para ontem se hoje dá 403", async () => {
  const b = bancoFalso([antiga("356526"), antiga("111")]);
  const r = await robo.coletarCadastro("CEIS", ["20261119", "20261118"], {
    ...b, fetch: fetchCom({ "20261118_CEIS.zip": zipDe(amostra("CEIS")) }), fracaoMinima: 0.5, tamanhoLote: 500, tentativas: 1,
  });
  assert.match(r, /CEIS 2026-11-18: já carregado/); // ontem = mesma data já carregada: nada a fazer
  const r2 = await robo.coletarCadastro("CEIS", ["20261119"], {
    ...b, fetch: fetchCom({ "20261119_CEIS.zip": zipDe(amostra("CEIS")) }), fracaoMinima: 0.5, tamanhoLote: 500, tentativas: 1,
  });
  assert.match(r2, /3 PJ gravadas, 1 PF descartadas, 0 inválidas, 1 fora da lista/);
  assert.equal(b.linhas.size, 4); // nada apagado
  assert.equal(b.linhas.get("CEIS|111").fora_da_lista, true);
  assert.ok(b.linhas.get("CEIS|111").fora_da_lista_em);
  assert.equal(b.linhas.get("CEIS|356526").fora_da_lista, false);
  assert.equal(b.linhas.get("CEIS|356526").data_carga, "2026-11-19");
});

test("reaparecer na lista volta fora_da_lista para false", async () => {
  const b = bancoFalso([{ ...antiga("48059"), fora_da_lista: true, fora_da_lista_em: "2026-11-10T10:00:00Z" }]);
  await robo.coletarCadastro("CEIS", ["20261119"], { ...b, fetch: fetchCom({ "20261119_CEIS.zip": zipDe(amostra("CEIS")) }), fracaoMinima: 0.5, tentativas: 1 });
  assert.equal(b.linhas.get("CEIS|48059").fora_da_lista, false);
  assert.equal(b.linhas.get("CEIS|48059").fora_da_lista_em, null);
});

test("arquivo muito menor que o histórico ativo: grava, mas não marca sumiço", async () => {
  const b = bancoFalso(Array.from({ length: 10 }, (_, i) => antiga(String(900 + i))));
  await assert.rejects(robo.coletarCadastro("CEIS", ["20261119"], { ...b, fetch: fetchCom({ "20261119_CEIS.zip": zipDe(amostra("CEIS")) }), fracaoMinima: 0.5, tentativas: 1 }),
    /3 PJ contra 10 ativas; sumiço NÃO marcado/);
  assert.equal(b.patches.length, 0);
  assert.ok([...b.linhas.values()].every((l) => !l.fora_da_lista));
});

test("nenhum arquivo disponível e falha de rede com nova tentativa", async () => {
  const b = bancoFalso();
  await assert.rejects(robo.coletarCadastro("CEIS", ["20261119", "20261118"], { ...b, fetch: fetchCom({}), tentativas: 1 }), /nenhum arquivo disponível/);
  let chamadas = 0;
  const instavel = async () => { chamadas++; if (chamadas < 2) throw new Error("ECONNRESET"); return new Response(zipDe(amostra("CEIS"))); };
  const buf = await robo.baixarZip("CEIS", "20261119", { fetch: instavel, tentativas: 3, pausaMs: 0 });
  assert.equal(chamadas, 2);
  assert.ok(buf.length > 0);
  await assert.rejects(robo.baixarZip("CEIS", "20261119", { fetch: async () => new Response("x", { status: 500 }), tentativas: 2, pausaMs: 0 }), /HTTP 500/);
});
