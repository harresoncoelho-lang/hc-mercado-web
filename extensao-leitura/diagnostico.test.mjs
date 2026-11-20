import test from 'node:test';
import assert from 'node:assert/strict';
import { ehPortal, estruturaPagina, origensLicitaPlena, resumoDiagnostico } from './diagnostico.mjs';

// DOM mínimo: só o que estruturaPagina usa (localName, id, classList, getAttribute, children, textContent, value).
const el = (localName, { id = '', cls = [], attrs = {}, texto = '', value } = {}, filhos = []) => ({
  localName, id, classList: cls, children: filhos, value,
  getAttribute: a => attrs[a] ?? null,
  get textContent() { return texto + filhos.map(f => f.textContent).join(''); },
});
const PAGINA = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=16013705000332026&token=abc';
function documento() {
  const corpo = el('body', {}, [
    el('header', { cls: ['br-header'] }, [el('span', { texto: 'Usuário: 123.456.789-09 - FULANA DE TAL' })]),
    el('div', { cls: ['cp-itens-card', 'ng-star-inserted', '_ngcontent-abc-123'] }, [
      el('label', { attrs: { for: 'valor' }, texto: 'Valor unitário (R$)' }),
      el('input', { id: 'valor', attrs: { 'data-test': 'input-valor-proposta', maxlength: '18', value: '11,87' }, value: '11,87' }),
      el('input', { attrs: { 'data-test': 'input-marca-fabricante', placeholder: 'digite a marca e o fabricante' }, value: '' }),
      el('select', { value: 'x' }, [el('option', { texto: 'EMPRESA FULANA 97048143215' })]),
      el('button', { texto: 'Salvar item 33442649000111' }),
      el('iframe', { attrs: { src: 'https://newassets.hcaptcha.com/captcha/v1/abc?sitekey=b8bb' } }),
      el('a', { attrs: { href: '/comprasnet-web/seguro/fornecedor/compras?compra=16013705000332026' } }),
      el('script', { texto: 'var cpf="12345678909"' }),
    ]),
  ]);
  return { body: corpo, title: 'Compras.gov - 16013705000332026', readyState: 'complete', querySelectorAll: () => [] };
}

test('diagnóstico guarda só estrutura: sem valor digitado, sem texto corrido, sem CPF/CNPJ, sem parâmetros de URL', () => {
  const d = estruturaPagina({ href: PAGINA, document: documento(), fluxo: 'preencher', motivo: 'sem_itens', extensao: '0.4.0' });
  assert.equal(d.status, 'ok');
  const json = JSON.stringify(d);
  assert.doesNotMatch(json, /11,87|FULANA|123\.456|97048143215|33442649000111|12345678909|token|sitekey|abc\?/);
  assert.doesNotMatch(json, /"value"/);
  assert.deepEqual(d.pagina, { host: 'cnetmobile.estaleiro.serpro.gov.br', caminho: '/comprasnet-web/seguro/fornecedor/cadastro-propostas', compra: '16013705000332026', titulo: 'Compras.gov - #', largura: null, carregando: false });
  const input = d.nos.find(n => n.a?.['data-test'] === 'input-valor-proposta');
  assert.deepEqual([input.preenchido, input.a.maxlength, input.id], [true, '18', 'valor']);
  assert.equal(d.nos.find(n => n.a?.['data-test'] === 'input-marca-fabricante').preenchido, false);
  assert.equal(d.nos.find(n => n.t === 'label').tx, 'Valor unitário (R$)');
  assert.equal(d.nos.find(n => n.t === 'button').tx, 'Salvar item #');
  assert.equal(d.nos.find(n => n.t === 'option').tx, undefined);
  assert.equal(d.nos.find(n => n.t === 'iframe').src, 'newassets.hcaptcha.com');
  assert.equal(d.nos.find(n => n.t === 'a').href, '/comprasnet-web/seguro/fornecedor/compras');
  assert.equal(d.nos.some(n => n.t === 'script'), false);
  assert.deepEqual(d.nos.find(n => n.c?.includes('cp-itens-card')).c, ['cp-itens-card']);
  assert.ok(Object.keys(d.seletores).every(s => !s.includes('mensagens-texto')), 'só os seletores do fluxo pedido');
  assert.match(resumoDiagnostico(d), /nenhum valor digitado[\s\S]*Não achei: div\.cp-itens-card/);
});

test('diagnóstico recusa página fora do portal do governo e corta páginas enormes', () => {
  for (const href of ['https://www.google.com/', 'https://licitaplena.com.br/sistema', 'https://u:p@cnetmobile.estaleiro.serpro.gov.br/x', 'file:///c:/x.html', 'lixo']) {
    assert.deepEqual(estruturaPagina({ href, document: documento(), fluxo: 'gravar' }), { status: 'fora_do_portal' }, href);
  }
  const muitos = el('body', {}, Array.from({ length: 5000 }, () => el('div')));
  const d = estruturaPagina({ href: PAGINA, document: { body: muitos, title: '', readyState: 'loading', querySelectorAll: () => [] }, fluxo: 'gravar' });
  assert.equal(d.nos.length, 4000);
  assert.equal(d.cortado, true);
  assert.equal(d.pagina.carregando, true);
});

test('origens do LicitaPlena excluem o portal; ehPortal só aceita hosts do governo', () => {
  const m = { optional_host_permissions: ['https://licitaplena.com.br/*', 'https://cnetmobile.estaleiro.serpro.gov.br/*', 'http://127.0.0.1/*'] };
  assert.deepEqual(origensLicitaPlena(m), ['https://licitaplena.com.br/*', 'http://127.0.0.1/*']);
  assert.equal(ehPortal('https://www.comprasnet.gov.br/livre/pregao/ata0.asp'), true);
  assert.equal(ehPortal('https://cnetmobile.estaleiro.serpro.gov.br.evil.com/'), false);
  assert.equal(ehPortal(undefined), false);
});
