// Sanções vigentes e passadas de um CNPJ, lidas da tabela sancoes_empresas (carga diária da CGU pelo
// robô scripts/coletar_sancoes_cgu.js). Não chama a API do Portal da Transparência (sem token, sem cota):
// é só leitura no Supabase com o token do PRÓPRIO usuário, e a RLS (authenticated) é a barreira.
//   GET /api/sancoes-cnpj?cnpj=00000000000000  (Authorization: Bearer <sessão>)
// Resposta: { cnpj, vigentes:[...], expiradas:[...], cargaEm } ; cache privado curto (dado muda 1x/dia).
// Sem verificarLimiteDiario: a mesma leitura já é possível direto pelo PostgREST com a sessão, e o
// contador custaria uma escrita a cada consulta.
const { cabecalhosPadrao, exigirUsuarioLogado } = require('./_auth');
const { sancoesDoCnpj } = require('../../sancoes-ui.js');

const URL_SB = 'https://lsqjamqvmrcyrvowndiu.supabase.co';
const ANON = 'sb_publishable_yH695cc52QUKYfFEgV5RwQ_0a8GLIeb';
const MAX_LINHAS = 500;
const COLUNAS = 'cadastro,codigo_sancao,cnpj,razao_social,tipo_sancao,orgao_sancionador,uf_orgao,esfera_orgao,abrangencia,data_inicio,data_fim,data_publicacao,fundamentacao,numero_processo,valor_multa,data_carga,fora_da_lista';
// Brasília é UTC-3 fixo (mesma conta de contextos-operacao).
const hojeBrasilia = (agora = Date.now()) => new Date(agora - 3 * 36e5).toISOString().slice(0, 10);

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), 'Cache-Control': 'private, max-age=300' };
  const resposta = (status, body) => ({ statusCode: status, headers: status === 200 ? headers : { ...headers, 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return resposta(204, {});
  if (event.httpMethod !== 'GET') return resposta(405, { erro: 'Método não permitido.' });
  const auth = await exigirUsuarioLogado(event);
  if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
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
exports.hojeBrasilia = hojeBrasilia;
