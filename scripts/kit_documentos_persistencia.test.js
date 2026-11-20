const test=require('node:test');
const assert=require('node:assert/strict');
const {validarRascunho,documentoPublico}=require('../netlify/functions/_kit_documentos_persistencia');
const documentoId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const base={acao:'salvar',documentoId,versaoEsperada:0,tipo:'declaracao'};

test('rascunho conserva texto incompleto e normaliza referências UUID sem perder unidades',()=>{
 assert.deepEqual(validarRascunho(base,[]),{declaracao:{titulo:'',texto:'',fonte:''}});
 const recebido={...base,tipo:'proposta',proposta:{itemIds:[itemId.toUpperCase()],unidades:{[itemId.toUpperCase()]:' caixa '},pagamento:'\nCondição em revisão\n'}};
 const salvo=validarRascunho(recebido,[{id:itemId}]);
 assert.deepEqual(salvo,{proposta:{itemIds:[itemId],unidades:{[itemId]:' caixa '},validade:'',prazoEntrega:'',pagamento:'\nCondição em revisão\n'}});
 assert.equal(recebido.proposta.itemIds[0],itemId.toUpperCase());
});

test('rascunho recusa referência duplicada por caixa e campos fora da edição permitida',()=>{
 const proposta={...base,tipo:'proposta'};
 for(const dados of [{...proposta,proposta:{itemIds:[itemId,itemId.toUpperCase()]}},{...base,revisadoPor:'forjado'},{...base,declaracao:{cnpj:'forjado'}},JSON.parse(JSON.stringify(base).slice(0,-1)+',"__proto__":{"papel":"gestor"}}')])assert.throws(()=>validarRascunho(dados,[{id:itemId}]),e=>e.status===400);
 assert.throws(()=>validarRascunho({...proposta,proposta:{itemIds:[itemId]}},[]),e=>e.status===404);
});

test('listagem expõe metadados sem conteúdo da peça ou prévia armazenada',()=>{
 const registro={id:documentoId,tipo:'declaracao',dados:{declaracao:{titulo:'Declaração em revisão',texto:'Conteúdo privado'}},versao:3,empresa_id:'empresa',processo_id:'processo',organizacao_id:'org',criado_por:'autor',criado_em:'2026-10-30T10:00:00Z',atualizado_por:'editor',atualizado_em:'2026-10-30T11:00:00Z',revisao_hash:'a'.repeat(64),revisao_previa:{texto:'Prévia privada',fontes:[]},revisao_versao:3,revisado_por:'revisor',revisado_em:'2026-10-30T12:00:00Z'};
 const meta=documentoPublico(registro,false);
 assert.equal(meta.titulo,'Declaração em revisão');assert.equal(meta.versao,3);assert.equal(meta.empresaId,'empresa');assert.equal(meta.revisadoPor,'revisor');
 assert.equal(meta.dados,undefined);assert.equal(meta.revisao,undefined);assert.doesNotMatch(JSON.stringify(meta),/Conteúdo privado|Prévia privada/);
 const aberto=documentoPublico(registro);assert.equal(aberto.dados.declaracao.texto,'Conteúdo privado');assert.equal(aberto.revisao.versao,3);assert.equal(aberto.revisao.revisadoPor,'revisor');
});
