// Backfill único: envia o conteúdo ATUAL de data/contratos_recentes.json e
// data/mercado_segmentos.json pro Supabase, e cria os arquivos de metadado
// leves (contratos_meta.json / mercado_meta.json) que passam a ser comitados
// no lugar dos arquivos grandes.
//
// Rodar UMA VEZ, manualmente, depois de aplicar supabase/schema_dados_mercado.sql:
//   SUPABASE_SERVICE_ROLE_KEY="..." node scripts/migrar_dados_supabase.js
//
// Depois disso, scripts/atualizar_dados.js assume a sincronização diária sozinho.

const fs = require("node:fs/promises");
const path = require("node:path");
const { upsertEmLotes } = require("./supabase_dados");

async function main() {
  const dirDados = path.join(process.cwd(), "data");

  console.log("== Migrando contratos_recentes.json ==");
  const contratosPath = path.join(dirDados, "contratos_recentes.json");
  const contratos = JSON.parse(await fs.readFile(contratosPath, "utf8"));
  const linhasContratos = contratos.registros
    .filter((r) => r.numeroControlePNCP)
    .map((r) => ({
      numero_controle_pncp: r.numeroControlePNCP,
      objeto: r.objeto || "",
      uf: r.uf || null,
      cnpj_fornecedor: r.cnpjFornecedor || null,
      data_assinatura: r.dataAssinatura || null,
      dado: r,
    }));
  console.log(`Enviando ${linhasContratos.length} contrato(s) (de ${contratos.registros.length} no arquivo; ` +
    `${contratos.registros.length - linhasContratos.length} sem numeroControlePNCP, ignorado(s))...`);
  const enviados = await upsertEmLotes("contratos", linhasContratos, "numero_controle_pncp");
  console.log(`OK — ${enviados} linha(s) na tabela "contratos".`);

  const { registros: _r, ...contratosMeta } = contratos;
  await fs.writeFile(path.join(dirDados, "contratos_meta.json"), JSON.stringify(contratosMeta), "utf8");
  console.log("Gravado data/contratos_meta.json");

  console.log("\n== Migrando mercado_segmentos.json ==");
  const mercadoPath = path.join(dirDados, "mercado_segmentos.json");
  const mercado = JSON.parse(await fs.readFile(mercadoPath, "utf8"));
  const linhasAtas = (mercado.atas || [])
    .filter((a) => a.numeroControlePNCPAta)
    .map((a) => ({
      numero_controle_pncp_ata: a.numeroControlePNCPAta,
      numero_controle_pncp_compra: a.numeroControlePNCPCompra || null,
      objeto: a.objeto || "",
      uf_orgao: a.ufOrgao || null,
      municipio_orgao: a.municipioOrgao || null,
      segmentos: a.segmentos || [],
      data_assinatura: a.dataAssinatura || null,
      vigencia_fim: a.vigenciaFim || null,
      cancelado: !!a.cancelado,
      enriquecida: !!a.enriquecida,
      dado: a,
    }));
  console.log(`Enviando ${linhasAtas.length} ata(s)...`);
  const enviadasAtas = await upsertEmLotes("mercado_atas", linhasAtas, "numero_controle_pncp_ata");
  console.log(`OK — ${enviadasAtas} linha(s) na tabela "mercado_atas".`);

  const { atas: _a, empresas: _e, ...mercadoMeta } = mercado;
  await fs.writeFile(path.join(dirDados, "mercado_meta.json"), JSON.stringify(mercadoMeta), "utf8");
  console.log("Gravado data/mercado_meta.json");

  console.log("\nBackfill concluído. Agora pode remover contratos_recentes.json e mercado_segmentos.json do git.");
}

main().catch((e) => {
  console.error("Erro no backfill:", e);
  process.exit(1);
});
