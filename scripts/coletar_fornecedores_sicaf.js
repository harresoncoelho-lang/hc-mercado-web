// Robô de coleta do CADASTRO DE FORNECEDORES DO GOVERNO FEDERAL (SICAF), via a API oficial
// nova do Compras.gov.br (dadosabertos.compras.gov.br/modulo-fornecedor).
//
// Por que isso existe: data/empresas.json (coletar_empresas.js) só tem empresas que JÁ
// GANHARAM algum contrato/ata visto pelos nossos robôs — hoje pouco mais de 11 mil CNPJs.
// O SICAF é o cadastro completo de fornecedores HABILITADOS a participar de licitação no
// governo federal, tenham ganhado contrato ou não: ~826 mil empresas ativas. Isso é um
// universo de prospecção muito maior do que só "quem já ganhou".
//
// POR QUE NÃO VAI PRO MESMO data/empresas.json: 826 mil registros nesse arquivo passariam de
// 150 MB — estoura o limite de 100 MB por arquivo do GitHub e travaria o navegador ao carregar
// a aba "Base de Empresas" (que baixa o arquivo inteiro). Solução: cada empresa do SICAF vai
// pro arquivo do seu estado, em data/fornecedores/{UF}.json — o site só baixa o arquivo do
// estado que o usuário está filtrando, nunca tudo de uma vez.
//
// A API do SICAF não tem filtro por UF (só cnpj, cpf, naturezaJuridicaId, porteEmpresaId,
// codigoCnae, ativo) — então o robô simplesmente pagina por TODO o cadastro (826 mil / 500 por
// página = ~1.654 páginas) e distribui cada registro no arquivo do seu estado conforme vai
// encontrando. Como são muitas páginas, isso é incremental por orçamento de tempo (como os
// outros robôs) — o progresso (qual página parou) fica salvo em
// data/fornecedores/_progresso.json, pra continuar de onde parou no dia seguinte. A varredura
// completa deve levar bastante tempo (potencialmente semanas de execuções diárias) — isso é
// esperado.
//
// Uso: node scripts/coletar_fornecedores_sicaf.js
// Variáveis de ambiente opcionais:
//   LIMITE_MINUTOS=12   -> orçamento de tempo desta execução
//   TAMANHO_PAGINA=500  -> registros por página (máximo aceito pela API)
//   ATRASO_MS=250       -> pausa entre páginas (educado com a API pública)

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "12");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const TAMANHO_PAGINA = parseInt(process.env.TAMANHO_PAGINA || "500", 10);
const ATRASO_MS = parseInt(process.env.ATRASO_MS || "250", 10);
const BASE_URL = "https://dadosabertos.compras.gov.br/modulo-fornecedor/1_consultarFornecedor";

const ESTADOS_VALIDOS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB",
  "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);
const UF_DESCONHECIDA = "SEM_UF";

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

function normalizarCnpj(cnpj) {
  const digitos = String(cnpj || "").replace(/\D/g, "");
  return digitos.length === 14 ? digitos : null;
}

function ufDoRegistro(uf) {
  const sigla = String(uf || "").trim().toUpperCase();
  return ESTADOS_VALIDOS.has(sigla) ? sigla : UF_DESCONHECIDA;
}

async function buscarPagina(pagina) {
  const url = `${BASE_URL}?ativo=true&pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, status: resp.status };
    const texto = await resp.text();
    const dados = JSON.parse(texto);
    if (!Array.isArray(dados.resultado)) return { ok: false, status: "formato_inesperado" };
    return { ok: true, dados };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: String((e && e.message) || e) };
  }
}

function registroParaShard(r) {
  return {
    cnpj: r.cnpj,
    nome: r.nomeRazaoSocialFornecedor || "",
    municipio: r.nomeMunicipio || "",
    codigoCnae: r.codigoCnae || null,
    nomeCnae: r.nomeCnae || "",
    porte: r.porteEmpresaNome || "",
    naturezaJuridica: r.naturezaJuridicaNome || "",
    habilitadoLicitar: !!r.habilitadoLicitar,
  };
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dirFornecedores = path.join(process.cwd(), "data", "fornecedores");
  await fs.mkdir(dirFornecedores, { recursive: true });
  const caminhoProgresso = path.join(dirFornecedores, "_progresso.json");

  let progresso = await lerJsonExistente(caminhoProgresso);
  if (!progresso) {
    progresso = {
      proximaPagina: 1,
      totalPaginas: null,
      totalRegistros: null,
      tamanhoPagina: TAMANHO_PAGINA,
      iniciadoEm: new Date().toISOString(),
      atualizadoEm: null,
      concluidoEm: null,
      porUf: {},
    };
  }
  if (!progresso.porUf) progresso.porUf = {}; // compatibilidade com progresso salvo antes desse campo existir

  if (progresso.concluidoEm) {
    console.log(
      `[sicaf] Varredura completa já concluída em ${progresso.concluidoEm} ` +
      `(${progresso.totalRegistros} fornecedores). Nada a fazer — apague concluidoEm em ` +
      `data/fornecedores/_progresso.json se quiser forçar uma nova varredura completa.`
    );
    return;
  }

  // Cache de shards tocados nesta execução (carrega sob demanda, grava só o que mudou).
  const shards = new Map(); // uf -> Map(cnpj -> registro)
  async function shardDoEstado(uf) {
    if (shards.has(uf)) return shards.get(uf);
    const caminho = path.join(dirFornecedores, `${uf}.json`);
    const existente = await lerJsonExistente(caminho);
    const mapa = new Map();
    if (existente && Array.isArray(existente.registros)) {
      for (const r of existente.registros) mapa.set(r.cnpj, r);
    }
    shards.set(uf, mapa);
    return mapa;
  }

  let paginasProcessadas = 0;
  let registrosVistos = 0;
  let registrosSemCnpj = 0;
  let falhaConsecutiva = 0;

  console.log(
    `[sicaf] Retomando da página ${progresso.proximaPagina}` +
    (progresso.totalPaginas ? ` de ${progresso.totalPaginas}` : "") +
    `. Orçamento: ${LIMITE_MINUTOS} min.`
  );

  while (true) {
    if (progresso.totalPaginas && progresso.proximaPagina > progresso.totalPaginas) {
      progresso.concluidoEm = new Date().toISOString();
      console.log(`[sicaf] Varredura completa! Todas as ${progresso.totalPaginas} páginas foram processadas.`);
      break;
    }
    if (tempoRestanteMs() < 4000) {
      console.log(`[sicaf] Orçamento de tempo esgotado após ${paginasProcessadas} página(s) nesta execução.`);
      break;
    }

    const resultado = await buscarPagina(progresso.proximaPagina);
    if (!resultado.ok) {
      falhaConsecutiva += 1;
      console.log(`[sicaf] Falha na página ${progresso.proximaPagina} (${resultado.status}) — tentativa ${falhaConsecutiva}.`);
      if (falhaConsecutiva >= 4) {
        console.log("[sicaf] Muitas falhas seguidas — encerrando esta execução mais cedo (tenta de novo amanhã).");
        break;
      }
      await dormir(2000 * falhaConsecutiva);
      continue;
    }
    falhaConsecutiva = 0;

    const { dados } = resultado;
    if (progresso.totalPaginas == null) {
      progresso.totalPaginas = dados.totalPaginas || null;
      progresso.totalRegistros = dados.totalRegistros || null;
      console.log(`[sicaf] Cadastro tem ${progresso.totalRegistros} fornecedor(es) ativos em ${progresso.totalPaginas} páginas.`);
    }

    for (const r of dados.resultado) {
      registrosVistos += 1;
      const cnpj = normalizarCnpj(r.cnpj);
      if (!cnpj) {
        registrosSemCnpj += 1; // fornecedor pessoa física (CPF) — fora do escopo desta base
        continue;
      }
      const uf = ufDoRegistro(r.ufSigla);
      const mapa = await shardDoEstado(uf);
      mapa.set(cnpj, registroParaShard({ ...r, cnpj }));
    }

    paginasProcessadas += 1;
    progresso.proximaPagina += 1;
    progresso.atualizadoEm = new Date().toISOString();
    await dormir(ATRASO_MS);
  }

  // Grava só os shards que foram tocados nesta execução.
  for (const [uf, mapa] of shards.entries()) {
    const caminho = path.join(dirFornecedores, `${uf}.json`);
    const registros = Array.from(mapa.values()).sort((a, b) => a.nome.localeCompare(b.nome));
    const saida = {
      uf,
      atualizadoEm: new Date().toISOString(),
      totalRegistros: registros.length,
      registros,
    };
    await fs.writeFile(caminho, JSON.stringify(saida), "utf8");
    // Guarda a contagem por estado no progresso — deixa o site mostrar "X de 826 mil já
    // coletados" sem precisar baixar os 27 arquivos inteiros só pra somar um número.
    progresso.porUf[uf] = registros.length;
  }

  await fs.writeFile(caminhoProgresso, JSON.stringify(progresso), "utf8");

  console.log(
    `[sicaf] Concluído: ${paginasProcessadas} página(s) processada(s), ${registrosVistos} registro(s) vistos ` +
    `(${registrosSemCnpj} sem CNPJ, ignorados), ${shards.size} estado(s) atualizado(s) nesta execução.`
  );
}

main().catch((e) => {
  console.error("Erro fatal no robô de fornecedores SICAF:", e);
  process.exit(1);
});
