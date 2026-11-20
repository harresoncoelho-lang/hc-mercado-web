'use strict';
// Descoberta autenticada restrita à allowlist QA explícita.
// - Consulta somente os ids de empresa e processo que estão na allowlist (filtro in.() com UUID validado).
// - Usa o token do próprio usuário (RLS da fonte) pelo transporte QA; não cria endpoint.
// - Não usa limite fixo nem slice: se a fonte atingir o máximo de linhas, falha fechado em vez de truncar.
// - Só devolve pares da allowlist que a fonte confirma com organização e vínculo coerentes.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PAPEIS_ACESSO = ['gestor', 'operador'];
const MAX_PARES = 100;
const MAX_LINHAS = 1000;

function validarAllowlist(allowlist) {
  if (!Array.isArray(allowlist) || !allowlist.length || allowlist.length > MAX_PARES) throw new Error('Allowlist QA inválida');
  const vistos = new Set(), pares = [];
  for (const x of allowlist) {
    if (!x || !UUID.test(x.empresaId || '') || !UUID.test(x.processoId || '')) throw new Error('Allowlist QA inválida');
    const k = x.empresaId + ':' + x.processoId;
    if (vistos.has(k)) continue;
    vistos.add(k);
    pares.push({ empresaId: x.empresaId, processoId: x.processoId });
  }
  return pares;
}

async function lerTabela(transporte, base, publicKey, token, caminho) {
  const r = await transporte(base + '/rest/v1/' + caminho, {
    method: 'GET',
    headers: { apikey: publicKey, Authorization: 'Bearer ' + token, Accept: 'application/json' },
  });
  if (!r.ok) throw Object.assign(new Error('Descoberta indisponível'), { status: r.status });
  const dados = await r.json();
  if (!Array.isArray(dados)) throw new Error('Resposta de descoberta inválida');
  if (dados.length >= MAX_LINHAS) throw new Error('Resposta de descoberta incompleta');
  return dados;
}

const emLista = ids => '(' + ids.join(',') + ')';

async function descobrirContextos({ transporte, restUrl, publicKey, token, userId, allowlist }) {
  if (typeof transporte !== 'function' || typeof restUrl !== 'string' || typeof publicKey !== 'string') throw new Error('Descoberta mal configurada');
  if (typeof token !== 'string' || !token || !UUID.test(userId || '')) throw new Error('Sessão inválida para descoberta');
  const pares = validarAllowlist(allowlist);
  const empresaIds = [...new Set(pares.map(p => p.empresaId))];
  const processoIds = [...new Set(pares.map(p => p.processoId))];
  const ler = caminho => lerTabela(transporte, restUrl, publicKey, token, caminho);

  const empresas = await ler(`operacao_empresas?id=in.${emLista(empresaIds)}&ativo=eq.true&select=id,organizacao_id`);
  const organizacoes = [...new Set(empresas.filter(e => e && UUID.test(e.organizacao_id || '')).map(e => e.organizacao_id))];
  const [membros, processos] = await Promise.all([
    organizacoes.length
      ? ler(`operacao_membros?usuario_id=eq.${userId}&organizacao_id=in.${emLista(organizacoes)}&papel=in.${emLista(PAPEIS_ACESSO)}&select=usuario_id,organizacao_id,empresa_id,papel`)
      : Promise.resolve([]),
    ler(`operacao_processos?id=in.${emLista(processoIds)}&select=id,empresa_id,organizacao_id`),
  ]);

  const empresaPorId = new Map(empresas.filter(e => e && UUID.test(e.id || '')).map(e => [e.id, e]));
  const processoPorId = new Map(processos.filter(p => p && UUID.test(p.id || '')).map(p => [p.id, p]));
  const acessos = membros.filter(m => m && m.usuario_id === userId && PAPEIS_ACESSO.includes(m.papel));

  // Itera sobre a allowlist: linhas extras devolvidas pela fonte nunca entram.
  const autorizados = [];
  for (const par of pares) {
    const empresa = empresaPorId.get(par.empresaId);
    const processo = processoPorId.get(par.processoId);
    if (!empresa || !processo) continue;
    if (processo.empresa_id !== empresa.id || processo.organizacao_id !== empresa.organizacao_id) continue;
    const vinculado = acessos.some(m => m.organizacao_id === empresa.organizacao_id && (m.empresa_id === null || m.empresa_id === empresa.id));
    if (vinculado) autorizados.push({ empresaId: par.empresaId, processoId: par.processoId });
  }
  return autorizados;
}

// Empresas autorizadas mesmo sem processo (preparação inicial e primeiro cadastro de processo).
// Mesma regra de vínculo: token do usuário, membro gestor/operador, empresa nula ou igual.
async function descobrirEmpresas({ transporte, restUrl, publicKey, token, userId, allowlist }) {
  if (typeof transporte !== 'function' || typeof restUrl !== 'string' || typeof publicKey !== 'string') throw new Error('Descoberta mal configurada');
  if (typeof token !== 'string' || !token || !UUID.test(userId || '')) throw new Error('Sessão inválida para descoberta');
  if (!Array.isArray(allowlist) || allowlist.length > MAX_PARES || allowlist.some(id => !UUID.test(id || ''))) throw new Error('Allowlist QA inválida');
  const ids = [...new Set(allowlist)];
  if (!ids.length) return [];
  const ler = caminho => lerTabela(transporte, restUrl, publicKey, token, caminho);
  const empresas = await ler(`operacao_empresas?id=in.${emLista(ids)}&ativo=eq.true&select=id,organizacao_id,razao_social`);
  const organizacoes = [...new Set(empresas.filter(e => e && UUID.test(e.organizacao_id || '')).map(e => e.organizacao_id))];
  const membros = organizacoes.length
    ? await ler(`operacao_membros?usuario_id=eq.${userId}&organizacao_id=in.${emLista(organizacoes)}&papel=in.${emLista(PAPEIS_ACESSO)}&select=usuario_id,organizacao_id,empresa_id,papel`)
    : [];
  const porId = new Map(empresas.filter(e => e && UUID.test(e.id || '')).map(e => [e.id, e]));
  const acessos = membros.filter(m => m && m.usuario_id === userId && PAPEIS_ACESSO.includes(m.papel));
  // Itera a allowlist: linhas extras da fonte nunca entram.
  const autorizadas = [];
  for (const id of ids) {
    const e = porId.get(id);
    if (!e) continue;
    if (acessos.some(m => m.organizacao_id === e.organizacao_id && (m.empresa_id === null || m.empresa_id === e.id))) {
      autorizadas.push({ empresaId: id, razaoSocial: typeof e.razao_social === 'string' ? e.razao_social : '' });
    }
  }
  return autorizadas;
}

module.exports = { descobrirContextos, descobrirEmpresas, validarAllowlist, MAX_LINHAS, MAX_PARES };
