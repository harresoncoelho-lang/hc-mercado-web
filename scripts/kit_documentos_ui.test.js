const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function carregar() {
  const contexto = { globalThis: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../kit-documentos-ui.js'), 'utf8'), contexto);
  return contexto.globalThis.LicitaKitDocumentos;
}
test('geração descarta respostas antigas mesmo no ciclo A → B → A e após fechar', async () => {
  const kit = carregar().criarControle();
  const antigo = kit.abrir({ empresaId: 'A', processoId: '1' });
  kit.abrir({ empresaId: 'B', processoId: '2' });
  const atual = kit.abrir({ empresaId: 'A', processoId: '1' });
  assert.equal(kit.vigente(antigo), false);
  assert.equal(kit.vigente(atual), true);
  kit.fechar();
  assert.equal(kit.vigente(atual), false);
});
test('qualquer alteração invalida hash e revisão e impede exportação sem nova prévia', () => {
  const kit = carregar().criarControle();
  kit.abrir({ documentoId: 'A', versao: 1 });
  kit.preparada('hash'); kit.confirmada({id:'A',versao:1,revisao:{hash:'hash'}}, kit.geracao);
  assert.equal(kit.podeExportar(), true);
  kit.alterar();
  assert.equal(kit.podeExportar(), false);
  kit.confirmada({id:'A',versao:1,revisao:{hash:'hash'}}, kit.geracao);
  assert.equal(kit.podeExportar(), false);
});
test('revisão histórica e clique local não autorizam exportar; confirmação exige peça, versão e geração atuais', () => {
  const kit = carregar().criarControle();
  const g = kit.abrir({documentoId:'A',versao:2,revisao:{hash:'historico'}});
  assert.equal(kit.podeExportar(),false);
  kit.preparada('atual',g);
  for (const documento of [{id:'B',versao:2,revisao:{hash:'atual'}},{id:'A',versao:1,revisao:{hash:'atual'}},{id:'A',versao:2,revisao:{hash:'historico'}}]) {
    assert.equal(kit.confirmada(documento,g),false);
    assert.equal(kit.podeExportar(),false);
  }
  assert.equal(kit.confirmada({id:'A',versao:2,revisao:{hash:'atual'}},g),true);
  assert.equal(kit.podeExportar(),true);
  kit.abrir({documentoId:'B',versao:2});
  kit.abrir({documentoId:'A',versao:2});
  assert.equal(kit.confirmada({id:'A',versao:2,revisao:{hash:'atual'}},g),false);
  assert.equal(kit.preparada('atrasada',g),false);
  assert.equal(kit.podeExportar(),false);
});
test('seleção permanece independente da página DOM e pode remover item fora catálogo',()=>{
 const s=carregar().criarSelecao();s.definir('a',true,'caixa');s.definir('b',true,'un');
 assert.equal(s.campos().itemIds.length,2);s.restaurar(s.campos());assert.equal(s.unidade('a'),'caixa');s.definir('b',false);assert.equal(s.campos().itemIds.join(','),'a');
 s.restaurar({itemIds:['ausente'],unidades:{ausente:'pacote'}});assert.equal(s.tem('ausente'),true);s.definir('ausente',false);assert.equal(s.campos().itemIds.length,0);
});
test('erro com pendências mostra mensagem de cadastro; erro genérico ou lista vazia mantém a falha', () => {
  const ui = carregar();
  const comPendencia = ui.mensagemFalha({ pendencias: ['Confira órgão.'] });
  const generico = ui.mensagemFalha(new Error('Serviço temporariamente indisponível.'));
  assert.match(comPendencia, /Falta cadastro para preparar a prévia/);
  assert.doesNotMatch(comPendencia, /A operação falhou/);
  assert.match(generico, /A operação falhou/);
  assert.equal(ui.mensagemFalha({ pendencias: [] }), generico);
  assert.equal(ui.mensagemFalha(undefined), generico);
});
test('link de cadastro: sem hook mantém operacao.html original; com hook fica dentro da casca', () => {
  const ui = carregar();
  const padrao = ui.alvoCadastro({ empresaId: 'e 1', processoId: 'p/2' }, null);
  assert.equal(padrao.href, 'operacao.html?aba=identificacao&empresa=e%201&processo=p%2F2');
  assert.equal(padrao.target, '_blank');
  assert.equal(padrao.rel, 'noopener noreferrer');
  assert.equal(padrao.aoClicar, null);
  let recebido = null;
  let prevenido = false;
  const com = ui.alvoCadastro({ empresaId: 'e1', processoId: 'p1' }, (ctx) => { recebido = ctx; });
  assert.equal(com.href, '#identificacao');
  assert.equal(com.target, null);
  assert.equal(com.rel, null);
  com.aoClicar({ preventDefault() { prevenido = true; } });
  assert.equal(prevenido, true);
  assert.deepEqual(JSON.parse(JSON.stringify(recebido)), { empresaId: 'e1', processoId: 'p1' });
});
test('textos do cadastro: com hook dizem que a identificação está nesta página; sem hook mantêm o texto legado', () => {
  const ui = carregar();
  const legado = ui.textosCadastro(null);
  assert.equal(legado.link, 'Conferir dados da empresa (nova aba)');
  assert.equal(legado.aberto, 'Cadastro aberto em outra aba. Consulte novamente os dados antes de preparar a prévia.');
  const casca = ui.textosCadastro(() => {});
  assert.equal(casca.link, 'Conferir dados da empresa');
  assert.doesNotMatch(casca.link + casca.aberto, /nova aba|outra aba/);
  assert.match(casca.aberto, /nesta página/);
});
test('rascunho: marcador do CPF aparece como [CPF do representante] e volta ao marcador ao salvar', () => {
  const { textoParaTela, textoParaSalvar } = carregar();
  const salvo = 'Eu, {{representante}}, CPF {{cpf_representante}}, e de novo {{ cpf_representante }}.';
  const tela = textoParaTela(salvo);
  assert.equal(tela, 'Eu, {{representante}}, CPF [CPF do representante], e de novo [CPF do representante].');
  assert.ok(!/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(tela) && !tela.includes('cpf_representante'));
  assert.equal(textoParaSalvar(tela), 'Eu, {{representante}}, CPF {{cpf_representante}}, e de novo {{cpf_representante}}.');
  assert.equal(textoParaSalvar(textoParaTela('Sem CPF.')), 'Sem CPF.');
  assert.equal(textoParaTela(null), '');
  // Peça legada com o CPF formatado no texto: a tela não mostra o número e salvar grava o marcador.
  assert.equal(textoParaSalvar(textoParaTela('CPF 529.982.247-25, inscrito.')), 'CPF {{cpf_representante}}, inscrito.');
});
test('B5: quantidade do banco com 3 casas aparece sem zeros à direita, vírgula decimal', () => {
  const { quantidadeTexto } = carregar();
  assert.equal(quantidadeTexto('400.000'), '400');
  assert.equal(quantidadeTexto('2.500'), '2,5');
  assert.equal(quantidadeTexto('0.125'), '0,125');
  assert.equal(quantidadeTexto('1000'), '1000');
  assert.equal(quantidadeTexto(null), 'não informado');
});
test('B2: proposta nova usa a "Proposta padrão" do perfil sem sobrescrever o que o usuário digitou', () => {
  const { aplicarPadraoProposta } = carregar();
  const padrao = { validade: '60 dias', prazoEntrega: '15 dias', pagamento: '30 dias' };
  assert.deepEqual({ ...aplicarPadraoProposta({}, padrao) }, padrao);
  assert.deepEqual({ ...aplicarPadraoProposta({ validade: '90 dias' }, padrao) }, { ...padrao, validade: '90 dias' });
  assert.deepEqual({ ...aplicarPadraoProposta({}, null) }, {});
  assert.deepEqual({ ...aplicarPadraoProposta({}, { validade: 5 }) }, {});
});
