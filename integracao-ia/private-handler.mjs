import { executeRead } from './core.mjs';
import { validateSelectedAnnexAnswer } from './grounded-answer.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const deny = status => { throw Object.assign(new Error('consulta_recusada'), { status }); };
const respond = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
function baseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw Error();
    return url.origin;
  } catch { throw new Error('configuracao_invalida'); }
}
// Teto transitório comum: 1 MiB. Listagem continua limitada a 4 KiB após discriminar operação.
async function parseBody(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) deny(415);
  if (!request.body) deny(400);
  const reader = request.body.getReader(); const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 1048576) deny(413); chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return { body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes: length }; } catch { deny(400); }
}

// As dependências são código confiável do host. Não há destino/default ou fetch nesta factory.
export function createPrivateReadHandler({ config, verifySession, readRows, readAnnex }) {
  if (!plain(config) || typeof verifySession !== 'function' || typeof readRows !== 'function'
    || !Array.isArray(config.allowedProjectUrls)) throw new Error('configuracao_invalida');
  const projectUrl = baseUrl(config.authProjectUrl);
  if (baseUrl(config.dataProjectUrl) !== projectUrl || !config.allowedProjectUrls.map(baseUrl).includes(projectUrl)) throw new Error('configuracao_invalida');
  const enabled = config.enabled === true;
  return async request => {
    if (!enabled) return respond(503, { erro: 'Leitura indisponível neste ambiente.' });
    if (request.method !== 'POST') return respond(405, { erro: 'Método não permitido.' });
    try {
      const parsed = await parseBody(request), body = parsed.body;
      const documental = body?.ferramenta === 'verificar_resposta_anexo_selecionado';
      if (!documental && parsed.bytes > 4096) deny(413);
      const allowed = documental ? ['ferramenta', 'organizacaoId', 'empresaId', 'cnpj', 'processoId', 'anexoId', 'resposta'] : ['ferramenta', 'organizacaoId', 'empresaId', 'cnpj', 'limit', 'offset'];
      if (!plain(body) || Object.keys(body).some(key => !allowed.includes(key)) || !uuid(body.organizacaoId)) deny(400);
      if (!documental && body.ferramenta !== 'listar_empresas_autorizadas') deny(404);
      if (documental && (!uuid(body.empresaId) || !uuid(body.processoId) || !uuid(body.anexoId) || typeof body.cnpj !== 'string' || !/^\d{14}$/.test(body.cnpj))) deny(400);
      if ((body.empresaId !== undefined || body.cnpj !== undefined)
        && (!uuid(body.empresaId) || typeof body.cnpj !== 'string' || !/^\d{14}$/.test(body.cnpj))) deny(400);
      if ((body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50))
        || (body.offset !== undefined && (!Number.isInteger(body.offset) || body.offset < 0 || body.offset > 1_000_000))) deny(400);
      const authorization = request.headers.get('authorization') || '';
      if (!/^Bearer [^\s]{1,8192}$/.test(authorization)) deny(401);
      if (documental && typeof readAnnex !== 'function') deny(503);
      const rows = async (resource, query) => {
        const result = await readRows({ projectUrl, authorization, method: 'GET', resource, query: new URLSearchParams(query).toString() });
        if (!Array.isArray(result)) deny(503); return result;
      };
      const loadAccess = async () => {
        const user = await verifySession({ projectUrl, authorization });
        if (!plain(user) || !uuid(user.id)) deny(401);
        const clients = await rows('clientes', { id: `eq.${user.id}`, select: 'id,status', limit: '2' });
        if (clients.length !== 1 || clients[0].id !== user.id || clients[0].status !== 'aprovado') deny(403);
        const members = await rows('operacao_membros', { usuario_id: `eq.${user.id}`, organizacao_id: `eq.${body.organizacaoId}`, select: 'usuario_id,organizacao_id,empresa_id,papel', limit: '2' });
        if (members.length !== 1) deny(403);
        const member = { usuario_id: members[0].usuario_id, organizacao_id: members[0].organizacao_id,
          empresa_id: members[0].empresa_id, papel: members[0].papel };
        if (member.usuario_id !== user.id || member.organizacao_id !== body.organizacaoId || !['gestor', 'operador', 'leitura'].includes(member.papel)
          || (member.empresa_id !== null && !uuid(member.empresa_id))) deny(403);
        if (body.empresaId && member.empresa_id && body.empresaId !== member.empresa_id) deny(403);
        const selectedId = body.empresaId || member.empresa_id;
        const companies = await rows('operacao_empresas', { organizacao_id: `eq.${member.organizacao_id}`, ativo: 'eq.true',
          ...(selectedId ? { id: `eq.${selectedId}` } : {}), select: 'id,organizacao_id,razao_social,cnpj,ativo', order: 'id.asc', limit: '1001' });
        if (!companies.length) deny(403);
        if (companies.length > 1000 || new Set(companies.map(c => c.id)).size !== companies.length) deny(503);
        const mapped = companies.map(c => {
          if (!uuid(c.id) || c.organizacao_id !== member.organizacao_id || c.ativo !== true || (selectedId && c.id !== selectedId)) deny(403);
          if (typeof c.cnpj !== 'string' || !/^(?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(c.cnpj)
            || typeof c.razao_social !== 'string' || !c.razao_social.trim() || c.razao_social.length > 4000) deny(503);
          const number = c.cnpj.replace(/\D/g, ''); if (body.cnpj && body.cnpj !== number) deny(403);
          return { id: c.id, organizacaoId: c.organizacao_id, empresaId: c.id, cnpj: number, nome: c.razao_social };
        }).sort((a, b) => a.id.localeCompare(b.id));
        return { userId: user.id, member, companies: mapped };
      };
      const access = await loadAccess();
      const trusted = { usuarioId: access.userId, organizacaoId: access.member.organizacao_id, ativo: true,
        empresas: access.companies.map(c => ({ empresaId: c.id, cnpj: c.cnpj })), scopes: [documental ? 'documentos:read' : 'empresas:read'] };
      const result = documental ? await validateSelectedAnnexAnswer(trusted, { empresaId: body.empresaId, cnpj: body.cnpj, processoId: body.processoId, documentoId: body.anexoId }, body.resposta,
        input => readAnnex(Object.freeze({ ...input, projectUrl, authorization }))) : await executeRead(trusted, 'listar_empresas_autorizadas', { limit: body.limit, offset: body.offset }, {
        read: async req => ({ records: access.companies.slice(req.query.offset, req.query.offset + req.query.limit),
          hasMore: req.query.offset + req.query.limit < access.companies.length }),
      });
      const latest = await loadAccess();
      if (JSON.stringify(latest) !== JSON.stringify(access)) deny(403);
      return respond(200, result);
    } catch (error) {
      const status = error?.code === 'acesso_negado' ? 403 : error?.code === 'entrada_invalida' ? 400 : [400, 401, 403, 404, 413, 415].includes(error?.status) ? error.status : 503;
      return respond(status, { erro: status === 401 ? 'Sessão inválida.' : status === 403 ? 'Acesso não autorizado.' : 'Consulta indisponível ou inválida.' });
    }
  };
}
