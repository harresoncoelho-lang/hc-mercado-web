const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "painel.html"), "utf8");
const inicio = html.indexOf("  function dadosStatusOperacional(");
const fim = html.indexOf("  function classePrazoKanban(", inicio);
assert.ok(inicio > 0 && fim > inicio);
const codigo = html.slice(inicio, fim);

function criarBanco(existente = null, prazos = []) {
  const gravacoes = [];
  const consultas = [];
  const banco = {
    from(tabela) {
      const consulta = { tabela, filtros: [], acao: "select", dados: null };
      consultas.push(consulta);
      const builder = {
        select() { return this; },
        eq(campo, valor) { consulta.filtros.push([campo, valor]); return this; },
        maybeSingle: async () => ({ data: existente, error: null }),
        single: async () => ({ data: { id: "processo-novo", objeto: consulta.dados.objeto }, error: null }),
        insert(dados) { consulta.acao = "insert"; consulta.dados = dados; return this; },
        update(dados) { consulta.acao = "update"; consulta.dados = dados; return this; },
        then(resolve) {
          const data = consulta.acao === "select" && tabela === "operacao_prazos_processo" ? prazos : null;
          resolve({ data, error: null });
        },
      };
      return builder;
    },
  };
  return { banco, gravacoes, consultas };
}

function preparar(existente, prazos) {
  const { banco, consultas } = criarBanco(existente, prazos);
  const contexto = {
    window: { __sbClient: banco },
    Map, Set, Promise, Object, Number, String, Date,
    localStorage: { getItem: () => "empresa" },
    document: {},
    console,
    setTimeout,
    clearTimeout,
    aguardarSupabaseAutenticado: async () => {},
    linkPncp: numero => numero ? `https://pncp.gov.br/${numero}` : null,
    numeroOperacional: valor => valor == null ? null : Number(valor),
    dataOperacional: (valor, comHora) => valor ? (comHora ? new Date(valor).toISOString() : new Date(valor).toISOString().slice(0, 10)) : null,
  };
  // A consulta da empresa é isolada, para testar o contrato de sincronização sem
  // depender da rede ou da sessão real do usuário.
  const codigoTestavel = codigo.replace(
    "const { organizacaoId, empresa } = await empresaOperacionalParaDossie(empresaId);",
    'const organizacaoId = "org", empresa = { id: "empresa" };'
  );
  vm.runInNewContext(`${codigoTestavel}\nthis.sincronizar = sincronizarDossieOperacional; this.status = dadosStatusOperacional;`, contexto);
  return { sincronizar: contexto.sincronizar, status: contexto.status, consultas };
}

test("Kanban distingue interesse, participação, vitória sem itens e derrota", () => {
  const { status } = preparar();
  assert.deepEqual(JSON.parse(JSON.stringify(status("interesse"))), {
    estagio: "triagem", decisao: "em_analise", resultado: "nao_apurado",
  });
  assert.equal(status("participando").resultado, "em_disputa");
  assert.equal(status("ganhei").resultado, "vitoria_sem_detalhamento");
  assert.equal(status("perdi").decisao, "participar");
  assert.equal(status("perdi").resultado, "sem_vitoria");
});

test("usa o cliente Supabase autenticado do painel, não variável de outro escopo", async () => {
  const banco = {
    rpc: async nome => { assert.equal(nome, "bootstrap_operacao"); return { data: "org", error: null }; },
    from(tabela) {
      assert.equal(tabela, "operacao_empresas");
      return { select() { return this; }, eq() { return this; }, order: async () => ({ data: [{ id: "empresa", razao_social: "Empresa de teste" }], error: null }) };
    },
  };
  const contexto = {
    window: { __sbClient: banco },
    localStorage: { getItem: () => "empresa" },
    aguardarSupabaseAutenticado: async () => {},
  };
  vm.runInNewContext(`${codigo}\nthis.empresa = empresaOperacionalParaDossie;`, contexto);
  const resultado = await contexto.empresa();
  assert.equal(resultado.organizacaoId, "org");
  assert.equal(resultado.empresa.id, "empresa");
});

test("a empresa solicitada prevalece sobre a preferência salva no navegador", async () => {
  const banco = {
    rpc: async () => ({ data: "org", error: null }),
    from(tabela) {
      assert.equal(tabela, "operacao_empresas");
      return {
        select() { return this; }, eq() { return this; },
        order: async () => ({ data: [
          { id: "hcm", razao_social: "HCM" },
          { id: "rymo", razao_social: "RyMo" },
        ], error: null }),
      };
    },
  };
  const contexto = {
    window: { __sbClient: banco },
    localStorage: { getItem: () => "hcm" },
    aguardarSupabaseAutenticado: async () => {},
  };
  vm.runInNewContext(`${codigo}\nthis.empresa = empresaOperacionalParaDossie;`, contexto);
  assert.equal((await contexto.empresa("rymo")).empresa.id, "rymo");
  await assert.rejects(contexto.empresa("inexistente"), /não está mais disponível/);
});

test("cria dossiê pré-preenchido sem confundir prazo da proposta com sessão", async () => {
  const { sincronizar, consultas } = preparar();
  await sincronizar("PNCP-1", {
    objeto: "Aquisição de papel", orgao: "Órgão público", numeroControlePNCP: "PNCP-1",
    numeroCompra: "41", anoCompra: 2026, codigoUnidade: "12345", fonte: "PNCP",
    valorTotalEstimado: 2500, publicacao: "2026-10-01", encerramento: "2026-10-20T10:00:00Z",
  }, "interesse");
  const processo = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "insert").dados;
  assert.equal(processo.origem_externa_id, "PNCP-1");
  assert.equal(processo.numero, "41/2026");
  assert.equal(processo.uasg, "12345");
  assert.equal(processo.valor_estimado, 2500);
  assert.equal(processo.data_sessao, null);
  assert.equal(processo.situacao_resultado, "nao_apurado");
  const prazo = consultas.find(c => c.tabela === "operacao_prazos_processo" && c.acao === "insert").dados;
  assert.equal(prazo.categoria, "proposta");
  assert.equal(prazo.titulo, "Prazo de propostas (Boletim)");
  assert.equal(prazo.vencimento, "2026-10-20T10:00:00.000Z");
});

test("atualiza só os campos operacionais e conserva dados manuais", async () => {
  const existente = {
    id: "processo-existente", objeto: "Objeto ajustado manualmente", orgao: "Órgão revisado",
    preco_proposta: 1450, decisao: "participar", status: "preparacao",
    resultado: "Status informado no Kanban: Participando (informação do usuário; confira a fonte oficial).",
    data_sessao: "2026-10-20T10:00:00.000Z",
    observacoes: "Pré-preenchido automaticamente a partir do Boletim / Kanban.",
  };
  const prazoExistente = [{ id: "prazo-1", titulo: "Prazo do Boletim: Papel", concluido_em: null }];
  const { sincronizar, consultas } = preparar(existente, prazoExistente);
  await sincronizar("PNCP-1", { objeto: "Papel", orgao: "Outro órgão", encerramento: "2026-10-20T10:00:00Z" }, "perdi");
  const processo = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update").dados;
  assert.equal(processo.status, "perdido");
  assert.equal(processo.decisao, "participar");
  assert.equal(processo.situacao_resultado, "sem_vitoria");
  assert.equal(processo.data_sessao, null);
  assert.equal(processo.objeto, undefined);
  assert.equal(processo.preco_proposta, undefined);
  const atualizacaoPrazo = consultas.find(c => c.tabela === "operacao_prazos_processo" && c.acao === "update").dados;
  assert.equal(atualizacaoPrazo.titulo, "Prazo de propostas (Boletim)");
  assert.equal(consultas.filter(c => c.tabela === "operacao_prazos_processo" && c.acao === "insert").length, 0);
});

test("fonte oficial registrada no dossiê não é substituída pelo Kanban", async () => {
  const existente = {
    id: "processo-existente", objeto: "Papel", fonte_resultado: "https://pncp.gov.br/resultado",
    situacao_resultado: "vitoria_parcial", valor_homologado: 350, resultado: "Conferido no portal",
  };
  const { sincronizar, consultas } = preparar(existente);
  await sincronizar("PNCP-1", { objeto: "Papel" }, "ganhei");
  const atualizacao = consultas.find(c => c.tabela === "operacao_processos" && c.acao === "update").dados;
  assert.equal(atualizacao.status, "homologado");
  assert.equal(atualizacao.situacao_resultado, undefined);
  assert.equal(atualizacao.resultado, undefined);
  assert.equal(atualizacao.valor_homologado, undefined);
});
