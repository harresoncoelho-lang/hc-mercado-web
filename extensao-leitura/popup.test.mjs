import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const url = 'https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/cadastro-propostas?compra=78882005000412026';
const snapshot = () => ({ url, headings: ['Pregão Eletrônico N° 41/2026', 'UASG 788820'], supplierLabels: ['CNPJ do fornecedor: 12.345.678/0001-95'], notices: [], collectionComplete: true });
let revision = 0;
async function setup({ changedTab = false, fail = false, wrongUrl = false, editDuringRead = false, missingCnpj = false, changedUrl = false, changedSnapshot = false, editField = 'cnpj', page = false, captcha = false } = {}) {
  const values = { cnpj: '12.345.678/0001-95', uasg: '788820', number: '41', year: '2026', purchaseId: '78882005000412026' };
  const elements = Object.fromEntries([...Object.keys(values), 'read', 'result', 'adopt'].map(key => [key, {
    value: values[key] || '', textContent: '', disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; },
  }]));
  let queries = 0; let injections = 0;
  globalThis.document = { getElementById: key => elements[key] };
  globalThis.chrome = {
    tabs: { query: async () => [{ id: ++queries === 2 && changedTab ? 2 : 1, url: wrongUrl ? 'https://example.test/' : queries === 2 && changedUrl ? url.replace('0041', '0042') : url }] },
    scripting: { executeScript: async request => {
      injections++;
      assert.deepEqual(request.target, { tabId: 1, frameIds: [0] });
      assert.equal('args' in request, false); // CNPJ esperado não é injetado no portal.
      if (fail) throw new Error('Falha que não deve vazar');
      if (editDuringRead) { elements[editField].value = 'alterado'; elements[editField].handlers.input(); }
      const result = snapshot(); if (missingCnpj) result.supplierLabels = [];
      if (page) result.paginaObservada = { completa: true, itens: [{ id: '1', descricao: 'Material fictício', quantidadeSolicitada: '6', unidade: 'Unidade', grupo: null, exigencias: null }] };
      if (captcha) result.notices = ['CAPTCHA pendente'];
      if (changedSnapshot) result.url = url.replace('0041', '0042');
      return [{ frameId: 0, result }];
    } },
  };
  await import(`./popup.mjs?test=${revision++}`);
  return { elements, injections: () => injections, read: () => elements.read.handlers.click() };
}
test('manifest limita permissões e não contém execução automática ou rede', async () => {
  const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'notifications', 'storage']); assert.equal(manifest.background.service_worker, 'acompanhar-worker.mjs');
  for (const key of ['content_scripts', 'host_permissions', 'externally_connectable']) assert.equal(key in manifest, false);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});

test('popup apresenta página parcial só com contexto confirmado e limpa ao editar', async () => {
  const app = await setup({ page: true }); await app.read();
  assert.match(app.elements.result.textContent, /Página observada parcial/);
  assert.match(app.elements.result.textContent, /Item 1: Material fictício/);
  app.elements.cnpj.handlers.input(); assert.doesNotMatch(app.elements.result.textContent, /Material fictício/);
  for (const options of [{ page: true, captcha: true }, { page: true, missingCnpj: true }, { page: true, changedUrl: true }]) {
    const blocked = await setup(options); await blocked.read();
    assert.doesNotMatch(blocked.elements.result.textContent, /Material fictício|Página observada parcial/);
  }
});

test('outra compra na mesma aba/origem e edição de cada campo invalidam leitura pendente', async () => {
  const scenarios = [{ changedUrl: true }, { changedSnapshot: true }, ...['cnpj', 'uasg', 'number', 'year', 'purchaseId'].map(editField => ({ editDuringRead: true, editField }))];
  for (const options of scenarios) {
    const app = await setup(options); await app.read();
    assert.match(app.elements.result.textContent, /mudou durante/);
    assert.equal(app.elements.read.disabled, false);
  }
});
test('leitura manual retorna conferência pontual e não injeta dados esperados', async () => {
  const app = await setup(); await app.read();
  assert.match(app.elements.result.textContent, /nesta leitura.*Escrita não autorizada/);
  assert.equal(app.injections(), 1); assert.equal(app.elements.read.disabled, false);
});
test('contexto esperado inválido e host errado não executam coletor', async () => {
  const app = await setup(); app.elements.cnpj.value = ''; await app.read(); assert.equal(app.injections(), 0);
  const other = await setup({ wrongUrl: true }); await other.read(); assert.equal(other.injections(), 0);
});
test('troca de aba ou edição durante leitura descarta resultado', async () => {
  for (const options of [{ changedTab: true }, { editDuringRead: true }]) {
    const app = await setup(options); await app.read();
    assert.match(app.elements.result.textContent, /mudou durante/);
    assert.doesNotMatch(app.elements.result.textContent, /corresponde/);
  }
});
test('erro de extensão e CNPJ ausente não aparentam conexão', async () => {
  const app = await setup({ fail: true }); await app.read();
  assert.match(app.elements.result.textContent, /Não foi possível/); assert.equal(app.elements.read.disabled, false);
  assert.doesNotMatch(app.elements.result.textContent, /Falha que/);
  const absent = await setup({ missingCnpj: true }); await absent.read();
  assert.match(absent.elements.result.textContent, /Identidade não confirmada/);
});


test('popup captura tentativa durante await e n�o cancela nova associa��o no finally', async t => {
  let active='antiga';const cancelled=[];let release;
  const contexto={cnpj:'12.345.678/0001-95',uasg:'788820',number:'41',year:'2026',purchaseId:'78882005000412026'};
  globalThis.licitaplenaPonteLeitura={obterTentativa:()=>({tentativaId:active,contexto,documentoId:'fixture',versao:1}),vincularPortal:()=>true,concluir:()=>{throw Error('n�o deve concluir');},cancelar:id=>{cancelled.push(id);if(active===id)active=null;}};
  t.after(()=>delete globalThis.licitaplenaPonteLeitura);
  const app=await setup();await app.elements.adopt.handlers.click();
  chrome.scripting.executeScript=()=>new Promise(resolve=>{release=resolve;});
  const reading=app.read();await Promise.resolve();await Promise.resolve();
  assert.equal(app.elements.adopt.disabled,true);
  active='nova';await app.elements.adopt.handlers.click(); // callback sint�tico tamb�m deve respeitar disabled.
  app.elements.cnpj.handlers.input();
  release([{frameId:0,result:snapshot()}]);await reading;
  assert.equal(active,'nova');assert.ok(cancelled.length>0);assert.ok(cancelled.every(id=>id==='antiga'));
  assert.equal(app.elements.adopt.disabled,false);
});
