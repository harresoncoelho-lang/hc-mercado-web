// Confere a tabela de alíquotas de reforma-tributaria.js com a Calculadora de Tributos oficial (Receita Federal,
// piloto do Portal da Reforma Tributária). API pública, sem cadastro e sem chave (checado em 19/11/2026):
//   GET  {BASE}/dados-abertos/aliquota-uniao?data=AAAA-MM-DD            → { aliquotaReferencia } (CBS, %)
//   GET  {BASE}/dados-abertos/aliquota-uf?codigoUf=NN&data=AAAA-MM-DD   → { aliquotaReferencia } (IBS estadual, %)
//   404 "Alíquota não encontrada" = ano ainda sem alíquota publicada (de 2027 em diante, até o Senado definir).
// GET /api/conferir-cbs-ibs?ano=2026&uf=AM  (Authorization: Bearer <sessão>)
// Logado e aprovado: a API oficial tem firewall que bloqueia o IP após rajadas (visto ao testar), então não
// vira proxy aberto. 2 subrequisições, 8 s cada; qualquer falha fecha com "não foi possível conferir agora".
const { cabecalhosPadrao, exigirUsuarioAprovado, verificarLimiteDiario } = require('./_auth');
const { ALIQUOTAS } = require('../../reforma-tributaria.js');

const BASE = 'https://piloto-cbs.tributos.gov.br/servico/calculadora-consumo/api/calculadora';
const UFS = { RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53 };
const FALHA = 'Não foi possível conferir agora na calculadora oficial. O cálculo local continua valendo; tente de novo mais tarde.';

// "0.9" (%) → 900n (milésimos de ponto). Rejeita o que não for número de 0 a 100.
function milesimos(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return null;
  return BigInt(Math.round(v * 1000));
}

// buscar(url) → Response. Devolve { ok, publicada, oficial?, confere? } ou { ok:false, erro }.
async function conferir(ano, uf, buscar) {
  const data = `${ano}-07-01`;
  const ler = async (url) => {
    const r = await buscar(url);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const n = milesimos((await r.json())?.aliquotaReferencia);
    if (n === null) throw new Error('resposta sem alíquota');
    return n;
  };
  try {
    const [cbs, ibsUf] = await Promise.all([
      ler(`${BASE}/dados-abertos/aliquota-uniao?data=${data}`),
      ler(`${BASE}/dados-abertos/aliquota-uf?codigoUf=${UFS[uf]}&data=${data}`),
    ]);
    if (cbs === null || ibsUf === null) return { ok: true, publicada: false, texto: `A calculadora oficial ainda não publicou as alíquotas de ${ano}. Use o cálculo como estimativa provisória.` };
    const local = ALIQUOTAS[ano];
    const confere = cbs === local.cbs && ibsUf === local.ibsUf;
    const fmt = (n) => (Number(n) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    return { ok: true, publicada: true, confere, oficial: { cbs: fmt(cbs), ibsUf: fmt(ibsUf) },
      texto: confere ? `Confere com a calculadora oficial: CBS ${fmt(cbs)}% e IBS estadual ${fmt(ibsUf)}% em ${ano}.`
        : `A calculadora oficial mostra CBS ${fmt(cbs)}% e IBS estadual ${fmt(ibsUf)}% em ${ano}, diferente da tabela local. Avise o suporte.` };
  } catch (e) {
    console.warn('conferir-cbs-ibs:', e.message);
    return { ok: false, erro: FALHA };
  }
}

exports.handler = async (event) => {
  const headers = { ...cabecalhosPadrao(event), 'Cache-Control': 'no-store' };
  const resposta = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return resposta(204, {});
  if (event.httpMethod !== 'GET') return resposta(405, { erro: 'Método não permitido.' });
  const q = event.queryStringParameters || {};
  const ano = Number(q.ano), uf = String(q.uf || 'DF').toUpperCase();
  if (!Object.hasOwn(ALIQUOTAS, ano)) return resposta(400, { erro: 'Ano fora da transição da Reforma (2026 a 2033).' });
  if (!Object.hasOwn(UFS, uf)) return resposta(400, { erro: 'UF inválida. Use a sigla, ex.: AM.' });
  const auth = await exigirUsuarioAprovado(event);
  if (!auth.ok) return resposta(auth.status, { erro: auth.erro });
  // Teto diário por usuário: rajada de um usuário faria a Receita bloquear o IP de saída de todos (teste de ataque 19/11, M5).
  const limite = await verificarLimiteDiario(auth.userId, 'conferir-cbs-ibs', 30);
  if (!limite.ok) return resposta(limite.status, { erro: limite.erro });
  const r = await conferir(ano, uf, (url) => fetch(url, { headers: { Accept: 'application/json' }, signal: globalThis.AbortSignal.timeout(8000) }));
  return resposta(r.ok ? 200 : 503, r);
};
exports.conferir = conferir;
