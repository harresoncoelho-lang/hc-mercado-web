const TOOLS = Object.freeze({
  listar_empresas_autorizadas: { scope: 'empresas:read', fields: ['id', 'nome'] },
  buscar_oportunidades: { scope: 'oportunidades:read', fields: ['id', 'titulo', 'fonte', 'versao'], query: true },
  obter_itens: { scope: 'itens:read', fields: ['id', 'descricao', 'quantidade', 'unidade', 'fonte', 'versao'], process: true },
  consultar_esteira: { scope: 'esteira:read', fields: ['id', 'titulo', 'etapa', 'fonte', 'versao'] },
  consultar_evidencia_documental: { scope: 'documentos:read', fields: ['id', 'trecho', 'pagina', 'fonte', 'versao'], process: true, document: true, query: true },
});

const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const cnpj = value => typeof value === 'string' && /^\d{14}$/.test(value);
const MAX_OFFSET = 1_000_000;
function fail(code) { throw Object.assign(new Error(code), { code }); }

function authorizedContext(context, scope) {
  if (!plain(context) || context.ativo !== true || !id(context.usuarioId) || !id(context.organizacaoId)
    || !Array.isArray(context.scopes) || !context.scopes.includes(scope)
    || !Array.isArray(context.empresas) || context.empresas.length < 1 || context.empresas.length > 1000
    || context.empresas.some(e => !plain(e) || !id(e.empresaId) || !cnpj(e.cnpj))) fail('acesso_negado');
  const identities = new Map();
  for (const e of context.empresas) {
    if (identities.has(e.empresaId) && identities.get(e.empresaId) !== e.cnpj) fail('acesso_negado');
    identities.set(e.empresaId, e.cnpj);
  }
  return [...identities].map(([empresaId, number]) => Object.freeze({ empresaId, cnpj: number }));
}

function queryFor(tool, input, companies) {
  if (!plain(input)) fail('entrada_invalida');
  const listing = tool === TOOLS.listar_empresas_autorizadas;
  const allowed = ['limit', 'offset', ...(!listing ? ['empresaId', 'cnpj'] : []),
    ...(tool.process ? ['processoId'] : []), ...(tool.document ? ['documentoId'] : []), ...(tool.query ? ['consulta'] : [])];
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !allowed.includes(key))) fail('entrada_invalida');
  if (Object.values(Object.getOwnPropertyDescriptors(input)).some(d => !('value' in d))) fail('entrada_invalida');
  const limit = input.limit === undefined ? 20 : input.limit;
  const offset = input.offset === undefined ? 0 : input.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('entrada_invalida');
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) fail('entrada_invalida');
  if (!listing && (!id(input.empresaId) || !cnpj(input.cnpj))) fail('entrada_invalida');
  if (!listing && !companies.some(e => e.empresaId === input.empresaId && e.cnpj === input.cnpj)) fail('acesso_negado');
  if ((tool.process && !id(input.processoId)) || (tool.document && !id(input.documentoId))) fail('entrada_invalida');
  if (input.consulta !== undefined && (typeof input.consulta !== 'string' || input.consulta.length > 500)) fail('entrada_invalida');
  const query = { limit, offset };
  for (const key of ['processoId', 'documentoId', 'consulta']) if (input[key] !== undefined) query[key] = input[key];
  return { query: Object.freeze(query), companies: listing ? companies : companies.filter(e => e.empresaId === input.empresaId) };
}

function safeSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

function projectRows(response, tool, request) {
  if (!plain(response) || !Array.isArray(response.records) || response.records.length > request.query.limit
    || typeof response.hasMore !== 'boolean' || (response.hasMore && response.records.length === 0)) fail('resposta_invalida');
  const records = response.records.map(record => {
    if (!plain(record) || record.organizacaoId !== request.scope.organizacaoId
      || !request.scope.empresas.some(e => record.empresaId === e.empresaId && record.cnpj === e.cnpj)
      || (tool === TOOLS.listar_empresas_autorizadas && record.id !== record.empresaId)
      || !id(record.id) || (tool.process && record.processoId !== request.query.processoId)
      || (tool.document && record.documentoId !== request.query.documentoId)) fail('resposta_invalida');
    const result = {};
    for (const field of tool.fields) {
      const value = record[field];
      if (value === undefined) fail('resposta_invalida');
      if (field === 'pagina') {
        if (!Number.isInteger(value) || value < 1) fail('resposta_invalida');
      } else if (typeof value !== 'string' || !value.trim() || value.length > 4000 || (field === 'fonte' && !safeSource(value))) fail('resposta_invalida');
      result[field] = value;
    }
    return result;
  });
  const nextOffset = response.hasMore ? request.query.offset + records.length : null;
  if (nextOffset !== null && nextOffset > MAX_OFFSET) fail('limite_paginacao');
  return { records, hasMore: response.hasMore, nextOffset };
}

// Contexto vem do adaptador confiável de identidade, nunca dos argumentos do modelo.
export async function executeRead(context, toolName, input, repository) {
  if (typeof toolName !== 'string' || !Object.hasOwn(TOOLS, toolName)) fail('ferramenta_indisponivel');
  const tool = TOOLS[toolName];
  const companies = authorizedContext(context, tool.scope);
  const selected = queryFor(tool, input, companies);
  const request = Object.freeze({ tool: toolName, scope: Object.freeze({
    usuarioId: context.usuarioId, organizacaoId: context.organizacaoId, empresas: Object.freeze(selected.companies),
  }), query: selected.query });
  let response;
  try { response = await repository.read(request); } catch { fail('consulta_indisponivel'); }
  revalidateAuthorizedRead(context, { scopeName: tool.scope, usuarioId: request.scope.usuarioId,
    organizacaoId: request.scope.organizacaoId, empresas: companies });
  return projectRows(response, tool, request);
}

// Compartilha autorização e revalidação; não concede vigência documental.
export function authorizeSelectedAnnexRead(context, selectors) {
  const scopeName = 'documentos:read';
  const empresas = Object.freeze(authorizedContext(context, scopeName));
  if (!plain(selectors) || Reflect.ownKeys(selectors).some(k => !['empresaId', 'cnpj', 'processoId', 'documentoId'].includes(k))) fail('entrada_invalida');
  queryFor(TOOLS.consultar_evidencia_documental, selectors, empresas);
  return Object.freeze({ scopeName, usuarioId: context.usuarioId, organizacaoId: context.organizacaoId, empresas,
    empresaId: selectors.empresaId, cnpj: selectors.cnpj, processoId: selectors.processoId, documentoId: selectors.documentoId });
}
export function revalidateAuthorizedRead(context, snapshot) {
  const current = authorizedContext(context, snapshot.scopeName);
  if (context.usuarioId !== snapshot.usuarioId || context.organizacaoId !== snapshot.organizacaoId
    || current.length !== snapshot.empresas.length
    || !current.every(e => snapshot.empresas.some(previous => previous.empresaId === e.empresaId && previous.cnpj === e.cnpj))) fail('acesso_negado');
}
