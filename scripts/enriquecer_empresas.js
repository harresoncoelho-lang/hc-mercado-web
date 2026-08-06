// Robô de ENRIQUECIMENTO CADASTRAL da base de empresas (Fase 2).
//
// Pega os CNPJs já consolidados por scripts/coletar_empresas.js (data/empresas.json) e busca
// os dados cadastrais completos de cada um numa fonte pública oficial (Receita Federal, via
// espelho gratuito e sem chave/token: minhareceita.org — construído a partir do dump público
// de dados abertos da própria Receita, https://dadosabertos.rfb.gov.br/CNPJ/). Isso é o que
// transforma a lista "CNPJ + UF + segmento" da Fase 1 numa base de prospecção de verdade:
// razão social completa, nome fantasia, sócios, endereço, telefone, e-mail (quando a empresa
// preencheu), CNAE (segmento de atuação), porte, situação cadastral etc.
//
// IMPORTANTE sobre e-mail: a Receita não obriga esse campo, então boa parte das empresas vai
// aparecer com email vazio — isso é limitação da fonte, não bug do robô.
//
// Por que é incremental por orçamento de tempo: com ~10 mil CNPJs na base e 1 requisição por
// vez (pra não sobrecarregar a API pública), enriquecer tudo de uma vez não cabe numa única
// execução do GitHub Actions. Então cada execução processa só uma fatia (LIMITE_MINUTOS) dos
// CNPJs ainda não enriquecidos (ou enriquecidos há mais de RENOVAR_APOS_DIAS), sempre pegando
// primeiro os que nunca foram tentados. O backfill completo acontece ao longo de vários dias,
// e depois disso o robô passa a só re-enriquecer o que ficou velho ou enriquecer CNPJs novos
// que a Fase 1 foi descobrindo.
//
// Uso: node scripts/enriquecer_empresas.js
// Variáveis de ambiente opcionais:
//   LIMITE_MINUTOS=10          -> orçamento de tempo desta execução
//   RENOVAR_APOS_DIAS=180      -> re-enriquece cadastros com mais desse tempo
//   ATRASO_MS=350              -> pausa entre requisições (educado com a API pública)

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "10");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const RENOVAR_APOS_DIAS = parseInt(process.env.RENOVAR_APOS_DIAS || "180", 10);
const ATRASO_MS = parseInt(process.env.ATRASO_MS || "350", 10);
const BASE_URL = "https://minhareceita.org";

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
  if (!reg.enriquecimento) return true;
  if (reg.enriquecimento.falhouEm && !reg.enriquecimento.enriquecidoEm) {
    // Tentou antes e falhou (CNPJ não encontrado, erro de rede etc.) — só tenta de novo
    // depois de alguns dias, pra não bater sempre no mesmo CNPJ problemático.
    const dias = (agora - new Date(reg.enriquecimento.falhouEm).getTime()) / (1000 * 60 * 60 * 24);
    return dias >= 7;
  }
  if (!reg.enriquecimento.enriquecidoEm) return true;
  const diasDesde = (agora - new Date(reg.enriquecimento.enriquecidoEm).getTime()) / (1000 * 60 * 60 * 24);
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
    return { ok: false, status: String(e && e.message || e) };
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
  const caminho = path.join(process.cwd(), "data", "empresas.json");

  const base = await lerJsonExistente(caminho);
  if (!base || !Array.isArray(base.registros)) {
    console.log("[enriquecer] data/empresas.json ainda não existe ou está vazio — nada a fazer (rode coletar_empresas.js primeiro).");
    return;
  }

  const agora = Date.now();
  const pendentes = base.registros.filter((r) => precisaEnriquecer(r, agora));
  // Prioriza quem já apareceu em mais contratos (empresas mais ativas primeiro — são as mais
  // relevantes pra um cliente que for comprar essa base de prospecção).
  pendentes.sort((a, b) => (b.quantidadeContratos || 0) - (a.quantidadeContratos || 0));

  console.log(`[enriquecer] ${pendentes.length} de ${base.registros.length} empresas precisam de enriquecimento (novo ou vencido). Orçamento: ${LIMITE_MINUTOS} min.`);

  const porCnpj = new Map(base.registros.map((r) => [r.cnpj, r]));
  let sucesso = 0, falha = 0, processados = 0;

  for (const reg of pendentes) {
    if (tempoRestanteMs() < 3000) {
      console.log(`[enriquecer] Orçamento de tempo esgotado após ${processados} CNPJ(s) processado(s) nesta execução.`);
      break;
    }
    const resultado = await buscarCnpj(reg.cnpj);
    processados += 1;
    if (resultado.ok) {
      porCnpj.get(reg.cnpj).enriquecimento = montarEnriquecimento(resultado.dados);
      sucesso += 1;
    } else {
      porCnpj.get(reg.cnpj).enriquecimento = {
        ...(porCnpj.get(reg.cnpj).enriquecimento || {}),
        falhouEm: new Date().toISOString(),
        motivoFalha: String(resultado.status),
      };
      falha += 1;
    }
    await dormir(ATRASO_MS);
  }

  const totalEnriquecidas = base.registros.filter((r) => r.enriquecimento && r.enriquecimento.enriquecidoEm).length;

  const saida = {
    ...base,
    atualizadoEm: new Date().toISOString(),
    fase: 2,
    totalEnriquecidas,
    percentualEnriquecido: base.registros.length ? Math.round((totalEnriquecidas / base.registros.length) * 1000) / 10 : 0,
    registros: base.registros,
  };

  await fs.writeFile(caminho, JSON.stringify(saida), "utf8");
  console.log(
    `[enriquecer] Concluído: ${sucesso} sucesso(s), ${falha} falha(s) nesta execução. ` +
    `Total enriquecido até agora: ${totalEnriquecidas} de ${base.registros.length} (${saida.percentualEnriquecido}%).`
  );
}

main().catch((e) => {
  console.error("Erro fatal no robô de enriquecimento:", e);
  process.exit(1);
});
