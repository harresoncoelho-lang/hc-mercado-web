// scripts/comprasnet_uasg_cache.js
// Cache de UASG -> UF/Município, usado pra resolver o campo "uasg" (só o
// código numérico) das licitações do módulo Legado em UF/município reais.
// UASGs raramente mudam, então o cache só é refeito se tiver mais de 7 dias
// — evita gastar orçamento de execução do robô com isso todo dia.
// Ver docs/superpowers/specs/2026-08-20-comprasnet-legado-integracao-design.md.

const { buscarBlob, salvarBlob } = require("./supabase_dados");

const IDADE_MAXIMA_CACHE_DIAS = 7;
const BASE_URL = "https://dadosabertos.compras.gov.br/modulo-uasg/1_consultarUasg";

async function fetchComRetentativa(url, tentativas = 2, timeoutMs = 20000) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const resp = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) {
        console.log(`[uasg-cache] HTTP ${resp.status} em ${url}`);
        if (i === tentativas - 1) return null;
        continue;
      }
      return await resp.json();
    } catch (e) {
      console.log(`[uasg-cache] Falha em ${url}: ${String((e && e.message) || e)}`);
      if (i === tentativas - 1) return null;
    }
  }
  return null;
}

async function buscarTodasAsUasgs() {
  const todas = [];
  let pagina = 1;
  let completo = false;
  for (;;) {
    const url = `${BASE_URL}?pagina=${pagina}&tamanhoPagina=500&statusUasg=true`;
    const dados = await fetchComRetentativa(url);
    if (!dados || !Array.isArray(dados.resultado)) break;
    todas.push(...dados.resultado);
    if (pagina >= (dados.totalPaginas || 1)) {
      completo = true;
      break;
    }
    pagina += 1;
  }
  return { registros: todas, completo };
}

// Retorna um Map codigoUasg (string) -> { uf, municipio, nomeUasg }. Rebusca a
// tabela inteira de UASGs só se o cache salvo no Supabase não existir ou tiver
// mais de IDADE_MAXIMA_CACHE_DIAS dias; senão reaproveita o que já tem.
async function obterMapaUasg() {
  const cache = await buscarBlob("dados_robo", "comprasnet_uasg");
  const idadeDias = cache && cache.atualizadoEm
    ? (Date.now() - new Date(cache.atualizadoEm).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;

  let lista;
  if (cache && Array.isArray(cache.uasgs) && idadeDias <= IDADE_MAXIMA_CACHE_DIAS) {
    lista = cache.uasgs;
    console.log(`[uasg-cache] Reaproveitando cache com ${lista.length} UASG(s), ${idadeDias.toFixed(1)} dia(s) de idade.`);
  } else {
    console.log("[uasg-cache] Cache ausente ou velho — rebuscando tabela completa de UASGs...");
    const { registros: brutas, completo } = await buscarTodasAsUasgs();

    if (completo) {
      lista = brutas.map((u) => ({
        codigoUasg: String(u.codigoUasg),
        uf: u.siglaUf || "",
        municipio: u.nomeMunicipioIbge || "",
        nomeUasg: u.nomeUasg || "",
      }));
      await salvarBlob("dados_robo", "comprasnet_uasg", { atualizadoEm: new Date().toISOString(), uasgs: lista });
      console.log(`[uasg-cache] Gravado cache novo com ${lista.length} UASG(s).`);
    } else {
      console.log("[uasg-cache] Coleta incompleta (falha de rede) — mantendo cache anterior, se houver.");
      if (cache && Array.isArray(cache.uasgs)) {
        lista = cache.uasgs;
      } else {
        lista = [];
      }
    }
  }

  const mapa = new Map();
  for (const u of lista) mapa.set(u.codigoUasg, { uf: u.uf, municipio: u.municipio, nomeUasg: u.nomeUasg });
  return mapa;
}

module.exports = { obterMapaUasg };
