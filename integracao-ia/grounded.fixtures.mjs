// Dados inteiramente fictícios; não representam exigência de um edital real.
export const fixtureContext = () => ({ usuarioId: 'user-a', organizacaoId: 'org-a', ativo: true,
  empresas: [{ empresaId: 'empresa-a', cnpj: '11222333000181' }], scopes: ['documentos:read'] });
export const fixtureRequest = () => ({ empresaId: 'empresa-a', cnpj: '11222333000181', processoId: 'proc-a', documentoId: 'doc-a' });
export const fixtureEvidence = () => ({ organizacaoId: 'org-a', ...fixtureRequest(), id: 'ev-1', pagina: 2,
  trecho: 'Neste edital fictício, a proposta informa a marca de cada item.', fonte: 'https://example.test/edital-ficticio', versao: '2' });
export const fixtureDocumentState = () => ({ organizacaoId: 'org-a', ...fixtureRequest(), versao: '2', situacao: 'vigente' });
export const fixtureAnswer = () => ({ status: 'conclusao', afirmacoes: [{ tipo: 'exigencia', texto: 'O trecho exige informar a marca de cada item.', referencias: [{ evidenciaId: 'ev-1', pagina: 2, fonte: 'https://example.test/edital-ficticio', versao: '2' }] }] });
export const fixtureRepository = (changes = {}) => ({ read: async () => ({ records: [fixtureEvidence()], hasMore: false, documentState: fixtureDocumentState(), ...changes }) });
