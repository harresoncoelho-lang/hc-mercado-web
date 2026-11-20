import test from 'node:test';
import assert from 'node:assert/strict';
import endpoint from '../netlify/functions/kit-documentos.js';
import { propostaParaLote } from './proposta-para-lote.mjs';

const ID = { empresa: '11111111-1111-1111-1111-111111111111', processo: '22222222-2222-2222-2222-222222222222', item: '33333333-3333-3333-3333-333333333333', org: '44444444-4444-4444-4444-444444444444', doc: '55555555-5555-5555-5555-555555555555' };
async function fixture(t, quantity = '2.000', price = '12.50', size = 1) {
  const contextoKit = {
    userId: 'usuario',
    empresa: { id: ID.empresa, organizacao_id: ID.org, razao_social: 'Empresa QA', cnpj: '11222333000181' },
    processo: { id: ID.processo, empresa_id: ID.empresa, organizacao_id: ID.org, numero: '41/2026', orgao: 'Órgão fictício', documentos_exigidos: [] },
    perfil: { empresa_id: ID.empresa, organizacao_id: ID.org, versao: 1, confirmado_em: '2026-11-01', dados_confirmados: { endereco: 'Rua QA', representante: 'Ana', cargo: 'Sócia' }, proveniencia: [] },
    itens: [{ id: ID.item, organizacao_id: ID.org, processo_id: ID.processo, tipo: 'item', identificador: 'não usar como ID de portal', descricao: 'Material fictício', quantidade: quantity, valor_unitario_proposta: price, marca: 'Marca QA', modelo: 'Modelo QA' }],
  };
  const raw = { id: ID.doc, empresa_id: ID.empresa, processo_id: ID.processo, organizacao_id: ID.org, versao: 1, tipo: 'proposta', dados: { proposta: { itemIds: [ID.item], unidades: { [ID.item]: 'un' }, validade: '30 dias', prazoEntrega: '10 dias', pagamento: 'Após entrega' } }, criado_por: 'usuario', atualizado_por: 'usuario' };
  for (let i = 1; i < size; i++) contextoKit.itens.push({ ...contextoKit.itens[0], id: `33333333-3333-3333-3333-${String(i).padStart(12, '0')}`, identificador: `rótulo ${i}`, marca: `Marca ${i}` });
  raw.dados.proposta.itemIds = contextoKit.itens.map(i => i.id).reverse();
  raw.dados.proposta.unidades = Object.fromEntries(raw.dados.proposta.itemIds.map(id => [id, 'un']));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(url); let data;
    if (url.includes('/auth/v1/user')) data = { id: contextoKit.userId };
    else if (url.includes('/clientes?')) data = [{ status: 'aprovado' }];
    else if (url.includes('/rpc/identificacao_empresa_habilitada')) data = true;
    else if (url.includes('/operacao_empresas?')) data = [contextoKit.empresa];
    else if (url.includes('/operacao_membros?')) data = [{ usuario_id: contextoKit.userId, organizacao_id: ID.org, empresa_id: ID.empresa, papel: 'operador' }];
    else if (url.includes('/operacao_processos?')) data = [contextoKit.processo];
    else if (url.includes('/operacao_itens_resultado?')) {
      const filtro = new URL(url).searchParams.get('id');
      const ids = filtro?.startsWith('in.(') ? filtro.slice(4, -1).split(',') : null;
      data = ids ? contextoKit.itens.filter(item => ids.includes(item.id)) : contextoKit.itens;
    }
    else if (url.includes('/operacao_identificacao_empresa?')) data = [contextoKit.perfil];
    else if (url.includes('/operacao_documentos?')) data = [];
    else if (url.includes('/operacao_kit_documentos?')) data = [raw];
    else throw new Error('Destino não previsto na fixture');
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  });
  const old = process.env.IDENTIFICACAO_EMPRESA_LOCAL; process.env.IDENTIFICACAO_EMPRESA_LOCAL = '1';
  t.after(() => { if (old === undefined) delete process.env.IDENTIFICACAO_EMPRESA_LOCAL; else process.env.IDENTIFICACAO_EMPRESA_LOCAL = old; });
  const run = async acao => {
    const result = await endpoint.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer FIXTURE' }, body: JSON.stringify({ acao, empresaId: ID.empresa, processoId: ID.processo, documentoId: ID.doc, versaoEsperada: 1 }) });
    assert.equal(result.statusCode, 200); return JSON.parse(result.body);
  };
  const prepared = await run('preparar');
  Object.assign(raw, { revisao_hash: prepared.revisaoHash, revisao_previa: prepared.previa, revisao_versao: 1, revisado_por: 'usuario', revisado_em: '2026-11-01' });
  const abertura = await run('abrir'); assert.equal(abertura.revisaoVigente, true);
  const contextoPortal = { cnpj: contextoKit.empresa.cnpj, uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' };
  const confiavel = { contextoKit, vinculo: { empresaId: ID.empresa, processoId: ID.processo, organizacaoId: ID.org, contextoPortal }, catalogo: contextoKit.itens.map((_, i) => ({ id: String(201 + i), quantidade: quantity, grupo: null, exigidos: ['marca', 'modelo'] })), mapeamento: contextoKit.itens.map((item, i) => ({ itemKitId: item.id, itemPortalId: String(201 + i) })) };
  const snapshot = { url: `https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=${contextoPortal.purchaseId}`, headings: ['Pregão Eletrônico N° 41/2026', 'UASG 788820'], supplierLabels: [`CNPJ do fornecedor: ${contextoPortal.cnpj}`], notices: [], collectionComplete: true };
  return { abertura, snapshot, confiavel, calls };
}

test('integra shape e hash emitidos pelo handler real; preserva valores2→4 e campos', async t => {
  const f = await fixture(t); const before = JSON.stringify(f); const calls = f.calls.length;
  const r = propostaParaLote(f.abertura, f.snapshot, f.confiavel);
  assert.equal(r.valido, true); assert.equal(r.writeAuthorized, false); assert.equal(r.portalAuthorizationRequired, true);
  assert.deepEqual(r.lote.itens[0], { id: '201', grupo: null, quantidade: '2.0000', unitario: '12.5000', marca: 'Marca QA', modelo: 'Modelo QA', fabricante: null, totalExato: '25.00000000', requerRevisaoPrecisao: false });
  assert.equal(r.documentoId, ID.doc); assert.equal(r.versao, 1); assert.equal(f.calls.length, calls); assert.equal(JSON.stringify(f), before);
});

test('revisor, versão, hash e dados atuais divergentes rejeitam revisão', async t => {
  const f = await fixture(t);
  for (const mutate of [x => x.abertura.revisaoVigente = false, x => x.abertura.documento.versao++, x => x.abertura.documento.revisao.versao++, x => x.abertura.documento.revisao.revisadoPor = 'outro', x => x.abertura.documento.revisao.hash = 'a'.repeat(64), x => x.confiavel.contextoKit.itens[0].marca = 'Alterada', x => x.confiavel.contextoKit.userId = 'outro']) {
    const x = structuredClone(f); mutate(x); const r = propostaParaLote(x.abertura, x.snapshot, x.confiavel);
    assert.equal(r.valido, false); assert.equal(r.lote, null); assert.equal(r.writeAuthorized, false);
  }
});

test('CNPJ, empresa, organização, processo e portal não podem cruzar contexto', async t => {
  const f = await fixture(t);
  for (const mutate of [x => x.abertura.documento.empresaId = ID.org, x => x.abertura.documento.organizacaoId = ID.empresa, x => x.confiavel.vinculo.processoId = ID.doc, x => x.confiavel.vinculo.contextoPortal.cnpj = '12345678000195', x => x.snapshot.supplierLabels = ['CNPJ do fornecedor: 12345678000195'], x => x.snapshot.headings[0] = 'Pregão Eletrônico N° 42/2026']) {
    const x = structuredClone(f); mutate(x); assert.equal(propostaParaLote(x.abertura, x.snapshot, x.confiavel).valido, false);
  }
});

test('mapeamento explícito obrigatório e catálogo controla fabricante/grupo/quantidade', async t => {
  const f = await fixture(t);
  for (const mutate of [x => x.confiavel.mapeamento = [], x => x.confiavel.mapeamento[0].itemPortalId = '1', x => x.confiavel.mapeamento.push(x.confiavel.mapeamento[0]), x => x.confiavel.catalogo[0].exigidos.push('fabricante'), x => x.confiavel.catalogo[0].quantidade = '3', x => { x.confiavel.catalogo[0].grupo = 'g'; x.confiavel.catalogo.push({ id: '202', quantidade: '2', grupo: 'g', exigidos: [] }); }]) {
    const x = structuredClone(f); mutate(x); assert.equal(propostaParaLote(x.abertura, x.snapshot, x.confiavel).valido, false);
  }
});

test('total exato diferente do DOCX arredondado bloqueia, sem arredondar silenciosamente', async t => {
  const f = await fixture(t, '0.500', '0.01'); const r = propostaParaLote(f.abertura, f.snapshot, f.confiavel);
  assert.equal(r.valido, false); assert.equal(r.motivo, 'precisao_divergente'); assert.equal(r.lote, null);
});

test('campos privados ou metadados extra nunca são propagados ao lote', async t => {
  const f = await fixture(t); f.abertura.documento.custoPrivado = 'SEGREDO'; f.confiavel.catalogo[0].margem = 'SEGREDO'; f.confiavel.mapeamento[0].apiKey = 'SEGREDO';
  const r = propostaParaLote(f.abertura, f.snapshot, f.confiavel); assert.equal(r.valido, true); assert.doesNotMatch(JSON.stringify(r), /SEGREDO|custoPrivado|margem|apiKey/);
});

test('1000 itens revisados passam e 1001 são bloqueados pelo contrato candidato', async t => {
  const f = await fixture(t, '2.000', '12.50', 1000);
  const valid = propostaParaLote(f.abertura, f.snapshot, f.confiavel);
  assert.equal(valid.valido, true); assert.equal(valid.lote.itens.length, 1000);
  assert.equal(valid.lote.itens[0].id, '1200'); assert.equal(valid.lote.itens[0].marca, 'Marca 999');
  const extra = { ...f.confiavel.contextoKit.itens[0], id: '66666666-6666-6666-6666-666666666666' };
  f.confiavel.contextoKit.itens.push(extra); f.abertura.documento.dados.proposta.itemIds.push(extra.id); f.abertura.documento.dados.proposta.unidades[extra.id] = 'un';
  assert.equal(propostaParaLote(f.abertura, f.snapshot, f.confiavel).motivo, 'dados_kit');
});

test('dados de documento não podem substituir tipo nem provocar queda do adaptador', async t => {
  const f = await fixture(t);
  f.abertura.documento.dados = { tipo: 'declaracao', declaracao: { titulo: 'Outra', texto: 'Texto' } };
  assert.doesNotThrow(() => propostaParaLote(f.abertura, f.snapshot, f.confiavel));
  assert.equal(propostaParaLote(f.abertura, f.snapshot, f.confiavel).motivo, 'dados_kit');
});


