const test = require('node:test');
const assert = require('node:assert/strict');
const { renderizar } = require('../empresa-identificacao-ui');
function ambiente(solicitar) {
  const doc = { createElement(tag) { return { tag, children: [], value: '', checked: false, disabled: false, files: [], append(...nos) { this.children.push(...nos); }, replaceChildren(...nos) { this.children = nos; }, setAttribute(k, v) { this[k] = v; }, focus() { doc.foco = this; } }; } };
  const host = doc.createElement('div'); host.ownerDocument = doc; let ativo = true, aplicado, alterado;
  const ui = renderizar(host, { empresaId: 'empresaA', solicitar, ativo: () => ativo, aplicar: v => { aplicado = v; }, atualizado: v => { alterado = v; } });
  const achar = predicado => { const buscar = e => predicado(e) ? e : e.children.map(buscar).find(Boolean); return buscar(host); };
  return { host, ui, achar, desativar: () => { ativo = false; }, aplicado: () => aplicado, alterado: () => alterado };
}
const empresa = { id: 'empresaA', razao_social: 'Empresa Exemplo', cnpj: '12345678000190' };
const perfil = { status: 'confirmado', versao: 1, confirmadoEm: 'agora', dados: { endereco: 'Rua Exemplo, 1', representante: 'Representante Exemplo', cargo: 'Administrador' }, proveniencia: [] };
test('dados da empresa ficam recolhidos e carregam cadastro canônico sem aplicar na minuta automaticamente', async () => {
  let chamadas = 0;
  const a = ambiente(async p => { chamadas++; assert.deepEqual(p, { acao: 'consultar' }); return { empresa, perfil, documentos: [{ id: 'doc1', arquivo_nome: 'contrato.pdf' }] }; });
  assert.equal(a.achar(e => e.tag === 'details').open, false); assert.equal(chamadas, 0);
  await a.ui.carregar();
  assert.equal(a.achar(e => e.id === 'empresa-identificacao-razao').value, empresa.razao_social);
  assert.equal(a.achar(e => e.id === 'empresa-identificacao-razao').readOnly, true);
  assert.equal(a.aplicado(), undefined);
  await a.achar(e => e.textContent === 'Aplicar identificação confirmada à minuta').onclick();
  assert.equal(a.aplicado().empresa.id, empresa.id);
});
test('confirmação manual exige revisão e não envia documentos ou dados para IA', async () => {
  const pedidos = [];
  const a = ambiente(async p => { pedidos.push(p); return p.acao === 'confirmar' ? { empresa, perfil } : { empresa, perfil: null, documentos: [] }; });
  await a.ui.carregar();
  for (const [campo, valor] of Object.entries(perfil.dados)) { const input = a.achar(e => e.id === `empresa-identificacao-${campo}`); input.value = valor; input.oninput(); }
  const salvar = a.achar(e => e.textContent === 'Salvar identificação confirmada');
  assert.equal(salvar.disabled, true);
  const revisao = a.achar(e => e.id === 'empresa-identificacao-revisao'); revisao.checked = true; revisao.onchange();
  assert.equal(salvar.disabled, false); await salvar.onclick();
  assert.deepEqual(pedidos[1], { acao: 'confirmar', revisado: true, razaoSocial: empresa.razao_social, cnpj: empresa.cnpj, dados: perfil.dados, proveniencia: [] });
  assert.equal(a.aplicado(), undefined);
});
test('troca de contexto e resposta de outra empresa não preenchem dados nem editor', async () => {
  let resolver;
  const a = ambiente(() => new Promise(r => { resolver = r; })); const pendente = a.ui.carregar();
  a.desativar(); resolver({ empresa, perfil, documentos: [] }); await pendente;
  assert.equal(a.achar(e => e.id === 'empresa-identificacao-razao').value, '');
  const b = ambiente(async () => ({ empresa: { ...empresa, id: 'empresaB' }, perfil, documentos: [] }));
  await b.ui.carregar(); assert.equal(b.achar(e => e.id === 'empresa-identificacao-razao').value, ''); assert.equal(b.aplicado(), undefined);
});
test('extração manual conserva anexo e formulário editável e mostra limite sem gerar documento', async () => {
  const a = ambiente(async p => p.acao === 'consultar' ? { empresa, perfil: null, documentos: [{ id: 'doc1', arquivo_nome: 'contrato.pdf' }] } : { documentoId: 'doc1', hash: 'a'.repeat(64), modo: 'manual', sugestoes: {}, avisos: ['PDF escaneado: preencha manualmente.'], evidencias: [] });
  await a.ui.carregar(); a.achar(e => e.id === 'empresa-identificacao-documento').value = 'doc1';
  await a.achar(e => e.textContent === 'Extrair sugestões do PDF selecionado').onclick();
  assert.ok(a.achar(e => e.textContent === 'PDF escaneado: preencha manualmente.'));
  assert.equal(a.achar(e => e.id === 'empresa-identificacao-endereco').disabled, false);
  assert.equal(a.aplicado(), undefined);
});
test('upload recusa tamanho e conteúdo inválido antes de enviar arquivo', async () => {
  const pedidos=[];
  const a=ambiente(async p => {pedidos.push(p);return {empresa,perfil:null,documentos:[]};});
  await a.ui.carregar();
  const arquivo=a.achar(e=>e.type==='file'), enviar=a.achar(e=>e.textContent==='Anexar PDF');
  arquivo.files=[{name:'contrato.pdf',size:4*1024*1024+1}]; await enviar.onclick();
  arquivo.files=[{name:'contrato.pdf',size:5,arrayBuffer:async()=>new TextEncoder().encode('falso').buffer}]; await enviar.onclick();
  assert.equal(pedidos.length,1); assert.ok(a.achar(e=>e.textContent==='O arquivo não é um PDF válido.'));
});
test('dois uploads selecionam o novo documento e conservam os campos em edição', async () => {
  const documentos=[];let extraido;
  const a=ambiente(async p=>{
    if(p.acao==='anexar'){const documento={id:`doc${documentos.length+1}`,arquivo_nome:p.nome};documentos.push(documento);return {documento};}
    if(p.acao==='extrair'){extraido=p.documentoId;return {documentoId:extraido,modo:'manual',sugestoes:{},avisos:[],evidencias:[]};}
    return {empresa,perfil:null,documentos};
  });
  await a.ui.carregar();
  const campo=a.achar(e=>e.id==='empresa-identificacao-endereco');campo.value='Endereço em edição';campo.oninput();
  const arquivo=a.achar(e=>e.type==='file'), enviar=a.achar(e=>e.textContent==='Anexar PDF');
  for(const nome of ['primeiro.pdf','correto.pdf']){arquivo.files=[{name:nome,size:5,arrayBuffer:async()=>new TextEncoder().encode('%PDF-').buffer}];await enviar.onclick();}
  assert.equal(a.achar(e=>e.id==='empresa-identificacao-documento').value,'doc2');
  assert.equal(campo.value,'Endereço em edição');
  await a.achar(e=>e.textContent==='Extrair sugestões do PDF selecionado').onclick();assert.equal(extraido,'doc2');
});
test('recarregar e aplicar preservam o documento selecionado se ele ainda existe', async () => {
  const a=ambiente(async()=>({empresa,perfil,documentos:[{id:'antigo',arquivo_nome:'antigo.pdf'},{id:'atual',arquivo_nome:'atual.pdf'}]}));
  await a.ui.carregar();const seletor=a.achar(e=>e.id==='empresa-identificacao-documento');seletor.value='atual';
  await a.ui.carregar();assert.equal(seletor.value,'atual');
  await a.achar(e=>e.textContent==='Aplicar identificação confirmada à minuta').onclick();assert.equal(seletor.value,'atual');
  assert.equal(a.aplicado().empresa.id,empresa.id);
});
test('sugestão é explícita e editar o valor remove sua proveniência', async () => {
  const pedidos=[];
  const a=ambiente(async p=>{pedidos.push(p);if(p.acao==='extrair')return {documentoId:'doc1',hash:'a'.repeat(64),modo:'sugestoes',sugestoes:{endereco:'Rua Sugerida'},avisos:[],evidencias:[{campo:'endereco',pagina:1,trecho:'Endereço: Rua Sugerida',valor:'Rua Sugerida'}]};return {empresa,perfil,documentos:[{id:'doc1',arquivo_nome:'contrato.pdf'}]};});
  await a.ui.carregar(); await a.achar(e=>e.textContent==='Extrair sugestões do PDF selecionado').onclick();
  const campo=a.achar(e=>e.id==='empresa-identificacao-endereco'); assert.equal(campo.value,'Rua Exemplo, 1');
  a.achar(e=>e.textContent==='Usar endereco: Rua Sugerida').onclick(); assert.equal(campo.value,'Rua Sugerida');
  campo.value='Rua Corrigida';campo.oninput();const revisao=a.achar(e=>e.id==='empresa-identificacao-revisao');revisao.checked=true;revisao.onchange();
  await a.achar(e=>e.textContent==='Salvar identificação confirmada').onclick();assert.deepEqual(pedidos.at(-1).proveniencia,[]);
});
test('três campos em três páginas do mesmo contrato conservam todas as provas ao confirmar', async () => {
  const pedidos=[], dados={endereco:'Rua Sugerida',representante:'Representante Sugerido',cargo:'Sócio administrador'};
  const a=ambiente(async p=>{pedidos.push(p);if(p.acao==='extrair')return {documentoId:'doc1',hash:'a'.repeat(64),modo:'sugestoes',sugestoes:dados,avisos:[],evidencias:Object.entries(dados).map(([campo,valor],i)=>({campo,valor,pagina:i+1,trecho:`${campo}: ${valor}`}))};return {empresa,perfil,documentos:[{id:'doc1',arquivo_nome:'contrato.pdf'}]};});
  await a.ui.carregar();await a.achar(e=>e.textContent==='Extrair sugestões do PDF selecionado').onclick();
  for(const [campo,valor]of Object.entries(dados))a.achar(e=>e.textContent===`Usar ${campo}: ${valor}`).onclick();
  const revisao=a.achar(e=>e.id==='empresa-identificacao-revisao');revisao.checked=true;revisao.onchange();
  await a.achar(e=>e.textContent==='Salvar identificação confirmada').onclick();
  assert.deepEqual(pedidos.at(-1).dados,dados);assert.deepEqual(pedidos.at(-1).proveniencia.map(p=>p.pagina),[1,2,3]);
});
