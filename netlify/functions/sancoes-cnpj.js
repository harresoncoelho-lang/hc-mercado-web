// Sanções vigentes e passadas de um CNPJ, lidas da tabela sancoes_empresas (carga diária da CGU pelo
// robô scripts/coletar_sancoes_cgu.js). Não chama a API do Portal da Transparência (sem token, sem cota):
// é só leitura no Supabase com o token do PRÓPRIO usuário, e a RLS (authenticated) é a barreira.
//   GET /api/sancoes-cnpj?cnpj=00000000000000  (Authorization: Bearer <sessão>)
// Resposta: { cnpj, vigentes:[...], expiradas:[...], cargaEm } ; cache privado curto (dado muda 1x/dia).
//   POST /api/sancoes-cnpj  {cnpjs:[até 200]}  -> { resultados:{<cnpj>:{vigentes,expiradas}}, cargaEm, hoje }
// O POST é a consulta em lote dos selos de participantes ("Licitação anterior", "Análise por CNPJ"): uma leitura só
// no banco para a tela inteira. Mesma barreira do GET (cadastro aprovado, RLS do próprio usuário); sem fundamentação.
// Sem verificarLimiteDiario: a mesma leitura já é possível direto pelo PostgREST com a sessão, e o
// contador custaria uma escrita a cada consulta.
const { cabecalhosPadrao, exigirUsuarioAprovado } = require('./_auth');
const { sancoesDoCnpj } = require('../../sancoes-ui.js');

const URL_SB = 'https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON = 'sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const MAX_LINHAS = 500;
const MAX_CNPJS_LOTE = 200;
const MAX_LINHAS_LOTE = 5000;
const COLUNAS_LOTE = 'cadastro,codigo_sancao,cnpj,razao_social,tipo_sancao,orgao_sancionador,uf_orgao,esfera_orgao,abrangencia,data_inicio,data_fim,data_publicacao,numero_processo,valor_multa,data_carga,fora_da_lista';
const COLUNAS = 'cadastro,codigo_sancao,cnpj,razao_social,tipo_sancao,orgao_sancionador,uf_orgao,esfera_orgao,abrangencia,data_inicio,data_fim,data_publicacao,fundamentacao,numero_processo,valor_multa,data_carga,fora_da_lista';
// Brasília é UTC-3 fixo (mesma conta de contextos-operacao).
const hojeBrasilia = (agora = Date.now()) => new Date(agora - 3 * 36e5).toISOString().slice(0, 10);

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), 'Cache-Control': 'private, max-age=300' };
  const resposta = (status, body) => ({ statusCode: status, headers: status === 200 ? headers : { ...headers, 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return resposta(204, {});
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') return resposta(405, { erro: 'Método não permitido.' });
  if (String(event.body || '').length > 8000) return resposta(413, { erro: 'Pedido muito grande.' });
  const auth = await exigirUsuarioAprovado(event);
  if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
  if (event.httpMethod === 'POST') return emLote(event, resposta);
  const cnpj = String(event.queryStringParameters?.cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) return resposta(400, { erro: 'Informe um CNPJ válido de 14 dígitos (parâmetro cnpj).' });
  try {
    const r = await fetch(`${URL_SB}/rest/v1/sancoes_empresas?cnpj=eq.${cnpj}&select=${COLUNAS}&order=data_fim.desc.nullsfirst&limit=${MAX_LINHAS}`, {
      headers: { apikey: ANON, Authorization: event.headers?.authorization || event.headers?.Authorization, Accept: 'application/json' },
      signal: globalThis.AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const linhas = await r.json();
    // Lista no teto = possivelmente truncada: falha fechado em vez de dizer "sem sanção" errado.
    if (!Array.isArray(linhas) || linhas.length >= MAX_LINHAS) throw new Error('resposta inválida ou incompleta');
    const { vigentes, expiradas } = sancoesDoCnpj(linhas, cnpj, hojeBrasilia());
    const cargaEm = linhas.reduce((m, l) => (l.data_carga > m ? l.data_carga : m), '') || null;
    return resposta(200, { cnpj, vigentes, expiradas, cargaEm });
  } catch (e) {
    console.warn('sancoes-cnpj:', e.message);
    return resposta(503, { erro: 'Não foi possível consultar as sanções agora. Tente de novo em instantes.' });
  }
};

async function emLote(event, resposta) {
  let corpo;
  try { corpo = JSON.parse(event.body || '{}'); } catch { return resposta(400, { erro: 'Pedido inválido.' }); }
  if (!Array.isArray(corpo?.cnpjs)) return resposta(400, { erro: 'Informe a lista cnpjs.' });
  const cnpjs = [...new Set(corpo.cnpjs.map((c) => String(c || '').replace(/\D/g, '')))];
  if (cnpjs.length > MAX_CNPJS_LOTE) return resposta(400, { erro: `No máximo ${MAX_CNPJS_LOTE} CNPJs por consulta.` });
  if (!cnpjs.length || cnpjs.some((c) => c.length !== 14)) return resposta(400, { erro: 'Cada item de cnpjs deve ter 14 dígitos.' });
  try {
    const r = await fetch(`${URL_SB}/rest/v1/sancoes_empresas?cnpj=in.(${cnpjs.join(',')})&select=${COLUNAS_LOTE}&order=data_fim.desc.nullsfirst&limit=${MAX_LINHAS_LOTE}`, {
      headers: { apikey: ANON, Authorization: event.headers?.authorization || event.headers?.Authorization, Accept: 'application/json' },
      signal: globalThis.AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const linhas = await r.json();
    // No teto = possivelmente truncada: falha fechado em vez de dizer "sem sanção" errado.
    if (!Array.isArray(linhas) || linhas.length >= MAX_LINHAS_LOTE) throw new Error('resposta inválida ou incompleta');
    const hoje = hojeBrasilia();
    const porCnpj = new Map(cnpjs.map((c) => [c, []]));
    for (const l of linhas) porCnpj.get(l.cnpj)?.push(l);
    const resultados = Object.fromEntries(cnpjs.map((c) => [c, sancoesDoCnpj(porCnpj.get(c), c, hoje)]));
    const cargaEm = linhas.reduce((m, l) => (l.data_carga > m ? l.data_carga : m), '') || null;
    return resposta(200, { resultados, cargaEm, hoje });
  } catch (e) {
    console.warn('sancoes-cnpj (lote):', e.message);
    return resposta(503, { erro: 'Não foi possível consultar as sanções agora. Tente de novo em instantes.' });
  }
}
exports.hojeBrasilia = hojeBrasilia;
exports.MAX_CNPJS_LOTE = MAX_CNPJS_LOTE;
