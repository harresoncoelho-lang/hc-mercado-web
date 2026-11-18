import { executeRead, authorizeSelectedAnnexRead, revalidateAuthorizedRead } from './core.mjs';

export const INSTRUCTIONS_VERSION = '1.0.0';
const blocked = motivo => ({ status: 'bloqueada', motivo });
const insufficient = motivo => ({ status: 'insuficiente', motivo });
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function shape(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return required.every(key => Object.hasOwn(descriptors, key))
    && Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && [...required, ...optional].includes(key) && 'value' in descriptors[key]);
}

function normalizeAnswer(candidate) {
  if (shape(candidate, ['status', 'motivo', 'afirmacoes']) && candidate.status === 'insuficiente'
    && text(candidate.motivo, 1000) && Array.isArray(candidate.afirmacoes) && candidate.afirmacoes.length === 0) return { status: 'insuficiente' };
  if (!shape(candidate, ['status', 'afirmacoes']) || candidate.status !== 'conclusao'
    || !Array.isArray(candidate.afirmacoes) || !candidate.afirmacoes.length || candidate.afirmacoes.length > 20) return null;
  const afirmacoes = [];
  for (const claim of candidate.afirmacoes) {
    if (!shape(claim, ['tipo', 'texto', 'referencias']) || !['exigencia', 'recomendacao'].includes(claim.tipo)
      || !text(claim.texto, 4000) || !Array.isArray(claim.referencias) || !claim.referencias.length || claim.referencias.length > 10) return null;
    const referencias = [];
    for (const ref of claim.referencias) {
      if (!shape(ref, ['evidenciaId', 'pagina', 'fonte', 'versao']) || !text(ref.evidenciaId, 100)
        || !Number.isInteger(ref.pagina) || ref.pagina < 1 || !text(ref.fonte, 4000) || !text(ref.versao, 100)) return null;
      referencias.push({ evidenciaId: ref.evidenciaId, pagina: ref.pagina, fonte: ref.fonte, versao: ref.versao });
    }
    afirmacoes.push({ tipo: claim.tipo, texto: claim.texto, referencias });
  }
  return { status: 'conclusao', afirmacoes };
}

// Não interpreta linguagem nem executa o conteúdo do documento ou da resposta.
export async function validateGroundedAnswer(context, request, candidate, repository) {
  const normalized = normalizeAnswer(candidate);
  if (!normalized) return blocked('formato_invalido');
  if (!shape(request, ['empresaId', 'cnpj', 'processoId', 'documentoId'], ['consulta'])) return blocked('consulta_invalida');
  const query = { ...request, limit: 50, offset: 0 };
  const expectedOrganization = context?.organizacaoId;
  let documentState = null;
  const result = await executeRead(context, 'consultar_evidencia_documental', query, {
    read: async authorizedRequest => {
      const response = await repository.read(authorizedRequest);
      const raw = response?.documentState;
      if (shape(raw, ['organizacaoId', 'empresaId', 'cnpj', 'processoId', 'documentoId', 'versao', 'situacao'])) documentState = { ...raw };
      return response;
    },
  });
  if (!documentState || documentState.organizacaoId !== expectedOrganization
    || ['empresaId', 'cnpj', 'processoId', 'documentoId'].some(key => documentState[key] !== query[key])
    || !text(documentState.versao, 100)) return insufficient('situacao_documental_nao_comprovada');
  if (documentState.situacao !== 'vigente') return insufficient('revisao_documental_pendente');
  if (!result.records.length || result.hasMore) return insufficient('evidencia_ausente_ou_parcial');
  const evidence = new Map();
  for (const record of result.records) {
    if (record.versao !== documentState.versao || evidence.has(record.id)) return insufficient('evidencia_conflitante');
    evidence.set(record.id, record);
  }
  if (normalized.status === 'insuficiente') return insufficient('resposta_se_absteve');
  for (const claim of normalized.afirmacoes) {
    for (const ref of claim.referencias) {
      const record = evidence.get(ref.evidenciaId);
      if (!record || ref.pagina !== record.pagina || ref.fonte !== record.fonte || ref.versao !== record.versao) return blocked('referencia_invalida');
    }
  }
  return { status: 'validada_estruturalmente', resposta: normalized, instrucoesVersao: INSTRUCTIONS_VERSION, veracidadeVerificada: false };
}

// Contrato distinto: referências internas de uma versão selecionada, nunca vigência.
function selectedCandidate(candidate) {
  if (!shape(candidate, ['status', 'afirmacoes']) || candidate.status !== 'conclusao'
    || !Array.isArray(candidate.afirmacoes) || !candidate.afirmacoes.length || candidate.afirmacoes.length > 20) return null;
  const afirmacoes = [];
  for (const claim of candidate.afirmacoes) {
    if (!shape(claim, ['tipo', 'texto', 'referencias']) || !['exigencia', 'recomendacao'].includes(claim.tipo)
      || !text(claim.texto, 4000) || !Array.isArray(claim.referencias) || !claim.referencias.length || claim.referencias.length > 10) return null;
    const referencias = [];
    for (const ref of claim.referencias) {
      if (!shape(ref, ['tipo', 'anexoId', 'versaoHash', 'pagina', 'inicio', 'fim']) || ref.tipo !== 'anexo_interno'
        || !text(ref.anexoId, 100) || !/^[a-f0-9]{64}$/.test(ref.versaoHash)
        || !Number.isInteger(ref.pagina) || ref.pagina < 1 || !Number.isInteger(ref.inicio) || !Number.isInteger(ref.fim)
        || ref.inicio < 0 || ref.fim <= ref.inicio || ref.fim - ref.inicio > 4000) return null;
      referencias.push({ ...ref });
    }
    afirmacoes.push({ tipo: claim.tipo, texto: claim.texto, referencias });
  }
  return { status: 'conclusao', afirmacoes };
}
function selectedDocument(data, scope) {
  const c = data?.contexto;
  if (!shape(c, ['organizacaoId', 'empresaId', 'cnpj', 'processoId', 'anexoId', 'hash'])
    || c.organizacaoId !== scope.organizacaoId || c.empresaId !== scope.empresaId || c.cnpj !== scope.cnpj
    || c.processoId !== scope.processoId || c.anexoId !== scope.documentoId || data.anexoId !== c.anexoId
    || !/^[a-f0-9]{64}$/.test(c.hash) || data.hash !== c.hash || data.vigenciaJuridicaComprovada !== false) return null;
  if (typeof data.selecionada !== 'boolean' || !text(data.extrator_versao, 100)
    || !Array.isArray(data.paginas) || !data.paginas.length || data.paginas.length > 20) return null;
  let size = 0; const paginas = [];
  for (let i = 0; i < data.paginas.length; i++) {
    const p = data.paginas[i];
    if (!shape(p, ['pagina', 'texto']) || p.pagina !== i + 1 || typeof p.texto !== 'string') return null;
    size += p.texto.length; if (size > 150000) return null;
    paginas.push({ pagina: p.pagina, texto: p.texto });
  }
  if (!paginas.some(p => p.texto.trim().length > 30)) return null;
  return { contexto: { ...c }, hash: data.hash, selecionada: data.selecionada, extrator: data.extrator_versao, paginas };
}
export async function validateSelectedAnnexAnswer(context, selectors, candidate, trustedReader) {
  const scope = authorizeSelectedAnnexRead(context, selectors);
  const normalized = selectedCandidate(candidate);
  if (!normalized || typeof trustedReader !== 'function') return blocked('formato_invalido');
  const input = Object.freeze({ acao: 'consultar', empresaId: scope.empresaId, processoId: scope.processoId, anexoId: scope.documentoId });
  let first;
  try { first = selectedDocument(await trustedReader(input), scope); } catch { return insufficient('fonte_indisponivel'); }
  if (!first) return blocked('fonte_ou_contexto_invalido');
  if (!first.selecionada) return insufficient('versao_nao_selecionada');
  for (const claim of normalized.afirmacoes) for (const ref of claim.referencias) {
    const page = first.paginas[ref.pagina - 1];
    if (ref.anexoId !== scope.documentoId || ref.versaoHash !== first.hash || !page
      || ref.fim > page.texto.length || !page.texto.slice(ref.inicio, ref.fim).trim()) return blocked('referencia_invalida');
  }
  let final;
  try { final = selectedDocument(await trustedReader(input), scope); } catch { return insufficient('fonte_indisponivel_no_fechamento'); }
  if (!final || !final.selecionada || JSON.stringify(final) !== JSON.stringify(first)) return insufficient('versao_alterada_no_fechamento');
  revalidateAuthorizedRead(context, scope);
  return { status: 'validada_estruturalmente_na_versao_selecionada', resposta: normalized,
    contexto: first.contexto, versaoHash: first.hash, vigenciaJuridicaComprovada: false, veracidadeVerificada: false,
    escopoRevisao: 'Referências conferidas somente na versão selecionada; não comprova ausência de retificações.' };
}
