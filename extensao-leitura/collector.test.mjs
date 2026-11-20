import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { collectSnapshot } from './collector.mjs';
import { validateContext } from './adapter.mjs';

function node(text, options = {}) {
  return { tag: options.tag || 'p', tagName: (options.tag || 'p').toUpperCase(), getAttribute: name => name === 'role' ? options.role : options.attributes?.[name] ?? null, textContent: text, children: options.children || [],
    closest: selector => selector === 'div#usuarioAtual > div[role="tab"]' ? (options.supplierHeader ? {} : null) : options.hidden || null,
    matches: selector => options.selectors?.includes(selector) || (selector === 'span.ml-1.text-nowrap' && options.tag === 'span' && options.identityLeaf === true) || (selector === 'app-identificacao-compra > p.compra' && options.purchaseHeading === true),
    querySelectorAll: selector => options.queries?.[selector] || [],
    parentElement: options.supplierHeader ? { tagName: 'SPAN', children: Array(options.wrapperChildren ?? 2).fill({}), parentElement: { matches: selector => selector === 'div#usuarioAtual > div[role="tab"]' && !options.distantHeader } } : null,
    checkVisibility: options.unsupported ? undefined : () => !options.transparent,
    getClientRects: () => options.offscreen ? [] : [{ width: options.zeroArea ? 0 : 400, height: options.zeroArea ? 0 : 600 }], style: options.style || { display: 'block', visibility: 'visible' } };
}
function collect(nodes, href = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=78882005000412026', onRead = () => {}) {
  return vm.runInNewContext(`(${collectSnapshot.toString()})()`, {
    URL, location: { href },
    document: { querySelectorAll: selector => { onRead(); return nodes.filter(element => element.matches(selector) || selector.split(',').includes(element.tag)); } }, getComputedStyle: element => element.style,
  });
}

test('destino inválido impede qualquer leitura DOM e não devolve URL ou token', () => {
  const base = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas';
  for (const href of [base.replace('cadastro-propostas', 'outro-cadastro') + '?token=valor-exemplo', base + '?compra=78882005000412026&token=valor-exemplo', base + '?compra=78882005000412026#token', base.replace('https:', 'http:') + '?compra=78882005000412026', base.replace('https://', 'https://user:secret@') + '?compra=78882005000412026', base + '?compra=1', base + '?compra=78882005000412026&compra=78882005000412026']) {
    let reads = 0;
    const result = collect([node('CNPJ do fornecedor: 12.345.678/0001-95')], href, () => reads++);
    assert.equal(reads, 0);
    assert.equal(result.url, '');
    assert.equal(result.collectionComplete, false);
    assert.equal(result.supplierLabels.length, 0);
    assert.equal(/token|secret|valor-exemplo/.test(JSON.stringify(result)), false);
  }
});

test('título compra real com spans é normalizado; breadcrumb e estrutura distinta não substituem título', () => {
  const children = [node('N°', { tag: 'span', hidden: true, attributes: { 'aria-hidden': 'true' } }), node('(SRP)', { tag: 'span' }), node('(Lei 14.133/2021)', { tag: 'span' })];
  const title = 'Pregão Eletrônico N° 41/2026 (SRP) (Lei 14.133/2021)';
  const good = collect([node(title, { purchaseHeading: true, children })]);
  assert.deepEqual(Array.from(good.headings), ['Pregão Eletrônico N° 41/2026']);
  for (const options of [{ children }, { purchaseHeading: true, children: [{}] }, { purchaseHeading: true, children: [...children, node('extra')] }]) {
    assert.equal(collect([node(title, options)]).headings.length, 0);
  }
  const ambiguous = collect([node(title, { purchaseHeading: true, children }), node(title.replace('41/', '42/'), { purchaseHeading: true, children }), node('UASG 788820'), node('CNPJ do fornecedor: 12.345.678/0001-95')]);
  assert.equal(validateContext(ambiguous, { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' }).status, 'contexto_ambiguo');
  const captcha = collect([node(title, { purchaseHeading: true, children }), node('CAPTCHA pendente')]);
  assert.equal(validateContext(captcha, { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' }).status, 'sessao_ou_verificacao_pendente');
});

test('título estrutural malformado ou filho visualmente oculto torna coleta incompleta', () => {
  const children = [node('N°', { tag: 'span' }), node('(SRP)', { tag: 'span' }), node('(Lei 14.133/2021)', { tag: 'span' })];
  const title = 'Pregão Eletrônico N° 41/2026 (SRP) (Lei 14.133/2021)';
  const malformed = collect([node(title, { purchaseHeading: true, children }), node(title.replace('41/2026', '42/XXXX'), { purchaseHeading: true, children })]);
  assert.equal(malformed.collectionComplete, false);
  const hiddenChildren = [node('N°', { tag: 'span', transparent: true, offscreen: true }), ...children.slice(1)];
  assert.equal(collect([node(title, { purchaseHeading: true, children: hiddenChildren })]).collectionComplete, false);
});

test('CNPJ leaf do header observado identifica fornecedor; CPF e nomes não saem', () => {
  const snapshot = collect([
    node(' | 12.345.678/0001-95 ', { tag: 'span', identityLeaf: true, supplierHeader: true }),
    node(' | 123.456.789-00 ', { tag: 'span', identityLeaf: true, supplierHeader: true }),
    node('NOME PRIVADO', { tag: 'span', supplierHeader: true }),
    node('Pregão Eletrônico N° 41/2026'), node('UASG 788820'),
  ]);
  assert.equal(validateContext(snapshot, { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' }).status, 'confirmado');
  assert.deepEqual(Array.from(snapshot.supplierLabels), ['CNPJ do fornecedor: 12.345.678/0001-95']);
  assert.equal(/PRIVADO|123\.456\.789-00/.test(JSON.stringify(snapshot)), false);
});

test('header fora do contrato, oculto ou com múltiplas identidades não confirma', () => {
  for (const options of [{ tag: 'span', identityLeaf: true }, { tag: 'span', supplierHeader: true }, { tag: 'span', identityLeaf: true, supplierHeader: true, hidden: true }, { tag: 'span', identityLeaf: true, supplierHeader: true, children: [{}] }, { tag: 'span', identityLeaf: true, supplierHeader: true, wrapperChildren: 3 }, { tag: 'span', identityLeaf: true, supplierHeader: true, distantHeader: true }]) {
    assert.equal(collect([node(' | 12.345.678/0001-95 ', options)]).supplierLabels.length, 0);
  }
  const snapshot = collect(['12.345.678/0001-95', '11.222.333/0001-81'].map(cnpj => node(` | ${cnpj} `, { tag: 'span', identityLeaf: true, supplierHeader: true })));
  assert.equal(validateContext(snapshot, { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' }).status, 'contexto_ambiguo');
});

test('CNPJ aparente malformado no header não é descartado junto de válido', () => {
  const snapshot = collect(['12.345.678/0001-95', '11.222.333/0001-XX'].map(cnpj => node(` | ${cnpj} `, { tag: 'span', identityLeaf: true, supplierHeader: true })));
  assert.equal(snapshot.collectionComplete, false);
  assert.equal(JSON.stringify(snapshot).includes('XX'), false);
});

test('desafio hCaptcha visível bloqueia identidade antiga sem acessar conteúdo cross-origin', () => {
  const frame = node('', { tag: 'iframe', attributes: { src: 'https://newassets.hcaptcha.com/test-fixture?token=nao-retornar', title: 'Desafio hCaptcha' } });
  Object.defineProperty(frame, 'contentDocument', { get() { throw new Error('Não acessar iframe'); } });
  const snapshot = collect([node('Pregão Eletrônico N° 41/2026'), node('UASG 788820'), node(' | 12.345.678/0001-95 ', { tag: 'span', identityLeaf: true, supplierHeader: true }), frame]);
  assert.equal(validateContext(snapshot, { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' }).status, 'sessao_ou_verificacao_pendente');
  assert.equal(JSON.stringify(snapshot).includes('nao-retornar'), false);
});

test('frame hCaptcha invisível é passivo; visível não identificado permanece inconclusivo', () => {
  const attributes = { src: 'https://newassets.hcaptcha.com/test-fixture' };
  const hidden = collect([node('', { tag: 'iframe', hidden: true, zeroArea: true, attributes })]);
  assert.equal(hidden.notices.length, 0); assert.equal(hidden.collectionComplete, true);
  const ambiguous = collect([node('', { tag: 'iframe', attributes })]);
  assert.equal(ambiguous.collectionComplete, false);
  assert.equal(ambiguous.notices.length, 0); // Não afirma desafio em badge desconhecido.
});

test('aria-hidden não transforma desafio geometricamente visível em frame passivo', () => {
  const frame = node('', { tag: 'iframe', hidden: true, attributes: { 'aria-hidden': 'true', src: 'https://newassets.hcaptcha.com/test-fixture', title: 'Desafio hCaptcha' } });
  const snapshot = collect([node('Pregão Eletrônico N° 41/2026'), node('UASG 788820'), node('CNPJ do fornecedor: 12.345.678/0001-95'), frame]);
  assert.equal(validateContext(snapshot, { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' }).status, 'sessao_ou_verificacao_pendente');
});
test('coleta autocontida reduz texto aos identificadores, sem CPF/endereço/nome', () => {
  const result = collect([
    node('Pregão Eletrônico N° 41/2026 (SRP) (Lei 14.133/2021)'),
    node('UASG 788820 - ÓRGÃO'), node('CNPJ do fornecedor: 12.345.678/0001-95'),
    node('CPF: 123.456.789-00'), node('Logradouro: RUA EXEMPLO'), node('Usuário: NOME EXEMPLO'),
    node('CNPJ do órgão: 11.222.333/0001-81'),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.headings)), ['Pregão Eletrônico N° 41/2026', 'UASG 788820']);
  assert.equal(result.supplierLabels.length, 1);
  assert.equal(/CPF|Logradouro|NOME EXEMPLO|ÓRGÃO/.test(JSON.stringify(result)), false);
});

test('aviso div ou texto segmentado impede confirmar identidade antiga', () => {
  for (const warning of [node('Sessão expirada', { tag: 'div' }), node('Sua sessão expirou', { children: [{}] }), node('Sua sessão expirou', { tag: 'div', role: 'alert', children: [{}] })]) {
    const snapshot = collect([node('Pregão Eletrônico N° 41/2026'), node('UASG 788820'), node('CNPJ do fornecedor: 12.345.678/0001-95'), warning]);
    const expected = { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' };
    assert.equal(validateContext(snapshot, expected).status, 'sessao_ou_verificacao_pendente');
  }
});

test('opacidade própria/ancestral e API de visibilidade ausente nunca confirmam fornecedor', () => {
  for (const options of [{ transparent: true }, { transparent: true, children: [] }, { unsupported: true }]) {
    const snapshot = collect([node('CNPJ do fornecedor: 12.345.678/0001-95', options)]);
    assert.equal(snapshot.supplierLabels.length, 0);
    if (options.unsupported) assert.equal(snapshot.collectionComplete, false);
  }
});

test('rótulo fornecedor malformado junto de válido não é descartado silenciosamente', () => {
  const result = collect([node('CNPJ do fornecedor: 12.345.678/0001-95'), node('CNPJ do fornecedor: inválido')]);
  assert.equal(result.collectionComplete, false);
  assert.equal(JSON.stringify(result).includes('inválido'), false);
});
test('ignora conteúdo oculto e contêineres com filhos', () => {
  const result = collect([
    node('CNPJ do fornecedor: 12.345.678/0001-95', { hidden: true }),
    node('CNPJ do fornecedor: 12.345.678/0001-95', { children: [{}] }),
    node('CNPJ do fornecedor: 12.345.678/0001-95', { style: { display: 'none', visibility: 'visible' } }),
    node('CNPJ do fornecedor: 12.345.678/0001-95', { offscreen: true }),
  ]);
  assert.equal(result.supplierLabels.length, 0);
});
test('coleta incompleta sinaliza limite e aviso não retorna texto sensível', () => {
  const result = collect([node('Sessão expirada para USUÁRIO PRIVADO'), ...Array.from({ length: 5001 }, () => node('irrelevante'))]);
  assert.equal(result.collectionComplete, false);
  assert.equal(result.notices.length, 1);
  assert.equal(JSON.stringify(result).includes('PRIVADO'), false);
});

function card(id, missingQuantity = false, quantity = '6') {
  const cell = text => node(text, { tag: 'div', selectors: ['div.mb-half-half'] });
  const column = children => node('', { tag: 'div', children, selectors: ['div.cp-texto-item.cp-label'] });
  const row = node('', { tag: 'div', children: [column(['Quantidade solicitada', 'Quantidade mínima', 'Unidade fornecimento'].map(cell)), column([missingQuantity ? '' : quantity, '6', 'Unidade'].map(cell))] });
  const heading = node('', { children: [node(id, { tag: 'span' }), node('Descrição pública fictícia', { tag: 'span', selectors: ['span.text-uppercase.pl-1'] })] });
  return node('', { tag: 'div', selectors: ['p-dataview > div.p-dataview-content > div.cp-itens-card.cp-item-expansivel'], queries: {
    'app-identificacao-item > div.dots.cp-item-bold.cp-texto-item-08': [heading],
    ':scope > div.col-md-3.col-sm-12.col-12.row.pr-0.align-items-center.ng-star-inserted > div.col-12.pr-0.pl-1.conteudo-div-centralizado.cp-valor-responsivo > div.row.m-0': [row],
  } });
}
test('página observada integra dez cards ao contexto, sem certificar catálogo ou exigências', () => {
  const context = [node('Pregão Eletrônico N° 41/2026'), node('UASG 788820'), node('CNPJ do fornecedor: 12.345.678/0001-95')];
  const wanted = { cnpj: '12345678000195', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' };
  const cards = Array.from({ length: 10 }, (_, i) => card(String(i + 1)));
  const result = validateContext(collect([...context, ...cards]), wanted);
  assert.equal(result.paginaObservada.parcial, true); assert.equal(result.paginaObservada.itens.length, 10);
  assert.equal(result.paginaObservada.itens[0].grupo, null); assert.equal(result.paginaObservada.itens[0].quantidadeSolicitada, '6');
  for (const invalid of [[...cards, node('CAPTCHA pendente')], [card('1'), card('1')], [card('1', true)]]) {
    assert.equal(validateContext(collect([...context, ...invalid]), wanted).paginaObservada, undefined);
  }
  assert.equal(validateContext(collect(cards), wanted).paginaObservada, undefined);
});

test('quantidade observada tem limite textual, sem converter ou inferir precisão', () => {
  assert.equal(collect([card('1', false, '9'.repeat(64))]).paginaObservada.completa, true);
  assert.equal(collect([card('1', false, '9'.repeat(65))]).paginaObservada.completa, false);
});
