// Robô de consolidação da BASE DE EMPRESAS que participam de licitação (Fase 1).
//
// Por que isso existe: a ideia é construir, aos poucos, uma base própria de empresas que
// realmente participam/vencem licitações no Brasil (CNPJ + em quais UFs/segmentos atuam),
// pra no futuro oferecer essa lista (com filtro por estado/segmento) como ferramenta de
// prospecção pra clientes da HC. Isso é Fase 1: só CONSOLIDAR os CNPJs que já enxergamos
// nos dados que os outros robôs já coletam — nenhuma chamada externa nova ainda, nenhum
// enriquecimento cadastral (razão social completa, sócios, endereço, telefone). Isso fica
// pra Fase 2 (outro robô, que vai enriquecer cada CNPJ novo contra a base pública da Receita
// Federal).
//
// Fontes usadas nesta fase:
//   - data/contratos_recentes.json -> contratos assinados nacionalmente (todos os setores),
//     coletados por scripts/atualizar_dados.js. Tem CNPJ do fornecedor, UF/município do
//     órgão comprador, valor e data.
//   - data/mercado_segmentos.json  -> empresas vencedoras de atas de registro de preço nos
//     segmentos que a HC monitora (expediente, limpeza, hospitalar etc). Tem CNPJ + segmentos
//     já classificados + UFs de atuação.
//
// O arquivo de saída (data/empresas.json) é ACUMULATIVO: cada execução funde o que achou de
// novo com o que já existia, então mesmo depois que um contrato "sai" da janela de retenção
// de contratos_recentes.json, a empresa continua na base de empresas (só não ganha contagem
// nova até aparecer de novo em algum contrato/ata futuro).
//
// Uso: node scripts/coletar_empresas.js

function normalizarCnpj(cnpj) {
  const digitos = String(cnpj || "").replace(/\D/g, "");
  return digitos.length === 14 ? digitos : null;
}

async function lerJsonExistente(caminho) {
  try {
    const fs = await import("node:fs/promises");
    const texto = await fs.readFile(caminho, "utf8");
    return JSON.parse(texto);
  } catch (e) {
    return null;
  }
}

// Garante que cada campo tipo "conjunto" (ufs, municipios, segmentos, orgaos) vira array
// antes de gravar em JSON, já que Set não serializa. Também limita o tamanho de listas que
// poderiam crescer sem controle (ex: uma empresa gigante que aparece em milhares de contratos
// com dezenas de órgãos diferentes) pra não inflar o arquivo à toa.
function finalizarRegistro(reg, LIMITE_LISTA = 25) {
  return {
    cnpj: reg.cnpj,
    nome: reg.nome || "",
    ufs: Array.from(reg.ufs).sort(),
    municipios: Array.from(reg.municipios).slice(0, LIMITE_LISTA).sort(),
    segmentos: Array.from(reg.segmentos).sort(),
    orgaosDistintos: Array.from(reg.orgaos).slice(0, LIMITE_LISTA).sort(),
    quantidadeContratos: reg.quantidadeContratos,
    valorTotalContratado: Math.round(reg.valorTotalContratado * 100) / 100,
    primeiraAparicao: reg.primeiraAparicao,
    ultimaAparicao: reg.ultimaAparicao,
    fontes: Array.from(reg.fontes).sort(),
  };
}

function novoRegistro(cnpj) {
  return {
    cnpj,
    nome: "",
    ufs: new Set(),
    municipios: new Set(),
    segmentos: new Set(),
    orgaos: new Set(),
    quantidadeContratos: 0,
    valorTotalContratado: 0,
    primeiraAparicao: null,
    ultimaAparicao: null,
    fontes: new Set(),
  };
}

function atualizarDataExtremos(reg, dataStr) {
  if (!dataStr) return;
  if (!reg.primeiraAparicao || dataStr < reg.primeiraAparicao) reg.primeiraAparicao = dataStr;
  if (!reg.ultimaAparicao || dataStr > reg.ultimaAparicao) reg.ultimaAparicao = dataStr;
}

async function consolidarEmpresas(dirDados) {
  const path = await import("node:path");

  // 1) Recarrega a base já acumulada (se existir) como ponto de partida — reconvertendo
  // listas de volta pra Set/Map pra poder continuar agregando normalmente.
  const mapa = new Map();
  const existentes = await lerJsonExistente(path.join(dirDados, "empresas.json"));
  if (existentes && Array.isArray(existentes.registros)) {
    for (const r of existentes.registros) {
      const reg = novoRegistro(r.cnpj);
      reg.nome = r.nome || "";
      reg.ufs = new Set(r.ufs || []);
      reg.municipios = new Set(r.municipios || []);
      reg.segmentos = new Set(r.segmentos || []);
      reg.orgaos = new Set(r.orgaosDistintos || []);
      reg.quantidadeContratos = r.quantidadeContratos || 0;
      reg.valorTotalContratado = r.valorTotalContratado || 0;
      reg.primeiraAparicao = r.primeiraAparicao || null;
      reg.ultimaAparicao = r.ultimaAparicao || null;
      reg.fontes = new Set(r.fontes || []);
      mapa.set(r.cnpj, reg);
    }
  }

  // 2) Contratos nacionais (todos os setores) — fonte principal de volume.
  const contratos = await lerJsonExistente(path.join(dirDados, "contratos_recentes.json"));
  let vistosContratos = 0;
  if (contratos && Array.isArray(contratos.registros)) {
    for (const c of contratos.registros) {
      const cnpj = normalizarCnpj(c.cnpjFornecedor);
      if (!cnpj) continue;
      if (!mapa.has(cnpj)) mapa.set(cnpj, novoRegistro(cnpj));
      const reg = mapa.get(cnpj);
      if (c.nomeFornecedor) reg.nome = c.nomeFornecedor;
      if (c.uf) reg.ufs.add(c.uf);
      if (c.municipio) reg.municipios.add(c.municipio);
      if (c.orgao) reg.orgaos.add(c.orgao);
      for (const s of c.segmentos || []) reg.segmentos.add(s);
      reg.quantidadeContratos += 1;
      reg.valorTotalContratado += Number(c.valor || 0);
      atualizarDataExtremos(reg, c.dataAssinatura);
      reg.fontes.add("contratos_pncp");
      vistosContratos += 1;
    }
  }

  // 3) Empresas vencedoras de atas de registro de preço nos segmentos monitorados — já vem
  // com segmentos/UFs pré-classificados, então é um sinal de qualidade mais alta.
  const mercado = await lerJsonExistente(path.join(dirDados, "mercado_segmentos.json"));
  let vistosMercado = 0;
  if (mercado && Array.isArray(mercado.empresas)) {
    for (const e of mercado.empresas) {
      const cnpj = normalizarCnpj(e.cnpj);
      if (!cnpj) continue;
      if (!mapa.has(cnpj)) mapa.set(cnpj, novoRegistro(cnpj));
      const reg = mapa.get(cnpj);
      if (e.nome) reg.nome = e.nome;
      for (const uf of e.ufs || []) reg.ufs.add(uf);
      for (const s of e.segmentos || []) reg.segmentos.add(s);
      reg.fontes.add("atas_mercado_segmentos");
      vistosMercado += 1;
    }
  }

  const registros = Array.from(mapa.values())
    .map((r) => finalizarRegistro(r))
    .sort((a, b) => b.valorTotalContratado - a.valorTotalContratado);

  console.log(
    `[empresas] Consolidado: ${vistosContratos} ocorrência(s) de contratos_recentes.json, ` +
    `${vistosMercado} ocorrência(s) de mercado_segmentos.json. Base total: ${registros.length} empresas únicas (por CNPJ).`
  );

  return {
    atualizadoEm: new Date().toISOString(),
    fase: 1,
    observacao:
      "Fase 1: só consolidação de CNPJs vistos em contratos/atas já coletados pelos outros robôs. " +
      "Ainda não tem enriquecimento cadastral (sócios, endereço, telefone) — isso é Fase 2.",
    fontes: ["contratos_recentes.json", "mercado_segmentos.json"],
    totalEmpresas: registros.length,
    registros,
  };
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dirDados = path.join(process.cwd(), "data");
  await fs.mkdir(dirDados, { recursive: true });

  const resultado = await consolidarEmpresas(dirDados);
  await fs.writeFile(path.join(dirDados, "empresas.json"), JSON.stringify(resultado), "utf8");
  console.log("Gravado data/empresas.json");
}

main().catch((e) => {
  console.error("Erro fatal no robô de consolidação de empresas:", e);
  process.exit(1);
});
