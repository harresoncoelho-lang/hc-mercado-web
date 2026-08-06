// Robô de ENRIQUECIMENTO CADASTRAL da base SICAF pura (Fase 4b).
//
// scripts/enriquecer_empresas.js só enriquece as empresas que já ganharam algum contrato
// (data/empresas.json, ~11 mil CNPJs). Mas o cadastro SICAF completo coletado por
// coletar_fornecedores_sicaf.js (data/fornecedores/{UF}.json) tem centenas de milhares de
// fornecedores habilitados a licitar que ainda não venceram nada — e esses nunca recebiam
// telefone/e-mail. Este robô fecha essa lacuna: usa a mesma fonte rápida e gratuita
// (minhareceita.org, espelho do CNPJ da Receita) pra gravar um campo "enriquecimento" direto
// em cada registro dos arquivos por UF.
//
// Como o cadastro SICAF é MUITO maior (centenas de milhares de CNPJs) que o orçamento de
// tempo de uma execução, o robô:
//   1) pula CNPJs que já têm enriquecimento completo vindo de data/empresas.json (esses já
//      são cobertos pelo robô principal, não faz sentido consultar de novo aqui);
//   2) divide o orçamento de tempo igualmente entre todos os estados, pra nenhuma UF ficar
//      pra trás só por vir depois no alfabeto;
//   3) prioriza dentro de cada UF quem está habilitado a licitar agora.
// O backfill completo é gradual e roda automaticamente todo dia junto com o resto do robô.
//
// Uso: node scripts/enriquecer_sicaf.js
// Variáveis de ambiente opcionais:
//   LIMITE_MINUTOS=25          -> orçamento de tempo desta execução (total, todas as UFs)
//   RENOVAR_APOS_DIAS=365      -> re-enriquece cadastros com mais desse tempo
//   ATRASO_MS=350              -> pausa entre requisições (educado com a API pública)

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "25");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const RENOVAR_APOS_DIAS = parseInt(process.env.RENOVAR_APOS_DIAS || "365", 10);
const ATRASO_MS = parseInt(process.env.ATRASO_MS || "350", 10);
const BASE_URL = "https://minhareceita.org";

const ESTADOS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "SEM_UF",
];

const inicioExecucao = Date.now();
function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}
function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function precisaEnriquecer(reg, agora) {
  const enr = reg.enriquecimento;
  if (!enr) return true;
  if (enr.falhouEm && !enr.enriquecidoEm) {
    const dias = (agora - new Date(enr.falhouEm).getTime()) / (1000 * 60 * 60 * 24);
    return dias >= 7;
  }
  if (!enr.enriquecidoEm) return true;
  const diasDesde = (agora - new Date(enr.enriquecidoEm).getTime()) / (1000 * 60 * 60 * 24);
  return diasDesde >= RENOVAR_APOS_DIAS;
}

async function buscarCnpj(cnpj) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(`${BASE_URL}/${cnpj}`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, status: resp.status };
    const dados = await resp.json();
    if (!dados || dados.cnpj !== cnpj) return { ok: false, status: "formato_inesperado" };
    return { ok: true, dados };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: String((e && e.message) || e) };
  }
}

function montarEnriquecimento(dados) {
  const socios = (dados.qsa || []).slice(0, 12).map((s) => ({
    nome: s.nome_socio || "",
    qualificacao: s.qualificacao_socio || "",
    dataEntrada: s.data_entrada_sociedade || null,
  }));
  const telefones = [dados.ddd_telefone_1, dados.ddd_telefone_2].filter(Boolean);

  return {
    razaoSocial: dados.razao_social || "",
    nomeFantasia: dados.nome_fantasia || "",
    situacaoCadastral: dados.descricao_situacao_cadastral || "",
    porte: dados.porte || "",
    naturezaJuridica: dados.natureza_juridica || "",
    capitalSocial: Number(dados.capital_social || 0),
    dataInicioAtividade: dados.data_inicio_atividade || null,
    cnaeDescricao: dados.cnae_fiscal_descricao || "",
    cnaeCodigo: dados.cnae_fiscal || null,
    endereco: {
      logradouro: [dados.descricao_tipo_de_logradouro, dados.logradouro].filter(Boolean).join(" ").trim(),
      numero: dados.numero || "",
      complemento: dados.complemento || "",
      bairro: dados.bairro || "",
      cep: dados.cep || "",
      municipio: dados.municipio || "",
      uf: dados.uf || "",
    },
    telefones,
    email: dados.email || "",
    socios,
    totalSocios: (dados.qsa || []).length,
    enriquecidoEm: new Date().toISOString(),
  };
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dirFornecedores = path.join(process.cwd(), "data", "fornecedores");

  // CNPJs já enriquecidos pela linha principal (empresas que ganharam contrato) não precisam
  // ser reprocessados aqui — economiza chamadas pra fonte gratuita.
  const empresasPath = path.join(process.cwd(), "data", "empresas.json");
  const baseEmpresas = await lerJsonExistente(empresasPath);
  const cnpjsJaEnriquecidos = new Set(
    ((baseEmpresas && baseEmpresas.registros) || [])
      .filter((r) => r.enriquecimento && r.enriquecimento.enriquecidoEm)
      .map((r) => r.cnpj)
  );

  const agora = Date.now();
  let totalProcessados = 0;
  let totalSucesso = 0;
  let totalFalha = 0;
  let ufsAtualizados = 0;

  // Orçamento dividido igualmente entre os estados, pra garantir que todos avancem um pouco a
  // cada execução em vez de sempre gastar tudo nos primeiros da lista (ordem alfabética).
  const orcamentoPorUf = LIMITE_MS / ESTADOS.length;

  for (const uf of ESTADOS) {
    if (tempoRestanteMs() < 3000) {
      console.log(`[sicaf-enriquecer] Orçamento geral esgotado — parando antes de ${uf}.`);
      break;
    }

    const caminho = path.join(dirFornecedores, `${uf}.json`);
    const dados = await lerJsonExistente(caminho);
    if (!dados || !Array.isArray(dados.registros) || dados.registros.length === 0) continue;

    const pendentes = dados.registros.filter(
      (r) => !cnpjsJaEnriquecidos.has(r.cnpj) && precisaEnriquecer(r, agora)
    );
    if (pendentes.length === 0) continue;

    // Prioriza quem está habilitado a licitar agora — mais relevante pra prospecção.
    pendentes.sort((a, b) => (b.habilitadoLicitar === true ? 1 : 0) - (a.habilitadoLicitar === true ? 1 : 0));

    const fimFatiaUf = Date.now() + Math.min(orcamentoPorUf, tempoRestanteMs());
    let mudouAlgo = false;
    let processadosUf = 0;

    for (const reg of pendentes) {
      if (Date.now() >= fimFatiaUf || tempoRestanteMs() < 3000) break;

      const resultado = await buscarCnpj(reg.cnpj);
      totalProcessados += 1;
      processadosUf += 1;

      if (resultado.ok) {
        reg.enriquecimento = montarEnriquecimento(resultado.dados);
        totalSucesso += 1;
      } else {
        reg.enriquecimento = {
          ...(reg.enriquecimento || {}),
          falhouEm: new Date().toISOString(),
          motivoFalha: String(resultado.status),
        };
        totalFalha += 1;
      }
      mudouAlgo = true;
      await dormir(ATRASO_MS);
    }

    if (mudouAlgo) {
      dados.atualizadoEm = new Date().toISOString();
      dados.totalEnriquecidos = dados.registros.filter((r) => r.enriquecimento && r.enriquecimento.enriquecidoEm).length;
      await fs.writeFile(caminho, JSON.stringify(dados), "utf8");
      ufsAtualizados += 1;
      console.log(`[sicaf-enriquecer] ${uf}: ${processadosUf} CNPJ(s) processado(s) nesta execução (${dados.totalEnriquecidos}/${dados.registros.length} enriquecidos no total).`);
    }
  }

  console.log(
    `[sicaf-enriquecer] Concluído: ${totalProcessados} consulta(s) no total ` +
    `(${totalSucesso} sucesso, ${totalFalha} falha), ${ufsAtualizados} estado(s) atualizado(s) nesta execução.`
  );
}

main().catch((e) => {
  console.error("Erro fatal no robô de enriquecimento SICAF:", e);
  process.exit(1);
});
