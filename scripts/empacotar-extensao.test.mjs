import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { FONTE, arquivosDaExtensao, conferirManifesto, empacotar } from './empacotar-extensao.mjs';

test('pacote da extensão: manifesto conferido, só arquivos alcançáveis, sem teste/fixture/README', async () => {
  const destino = await mkdtemp(path.join(tmpdir(), 'lp-zip-'));
  try {
    const r = await empacotar({ destino });
    const zip = new AdmZip(r.arquivo);
    const nomes = zip.getEntries().map(e => e.entryName).sort();
    for (const f of ['manifest.json', 'popup.html', 'popup.css', 'acompanhar-worker.mjs', 'acompanhar-chat.mjs', 'diagnostico.mjs', 'diagnostico-popup.mjs', 'pregao-leitor.mjs', 'preencher-proposta.mjs', 'icone.png']) assert.ok(nomes.includes(f), f);
    assert.equal(nomes.some(n => /test|fixtures|README/.test(n)), false);
    assert.equal(JSON.parse(zip.readAsText('manifest.json')).version, r.versao);
    assert.match(path.basename(r.arquivo), new RegExp(`^licitaplena-extensao-${r.versao.replace(/\./g, '\\.')}\\.zip$`));
  } finally { await rm(destino, { recursive: true, force: true }); }
});

test('manifesto: recusa permissão a mais, site local, content_scripts e CSP com rede', () => {
  const ok = { manifest_version: 3, version: '1.2.3', permissions: ['activeTab'], action: { default_popup: 'p.html' }, background: { service_worker: 'w.mjs' }, content_security_policy: { extension_pages: "connect-src 'none'" } };
  assert.deepEqual(conferirManifesto(ok), []);
  for (const [mudar, erro] of [
    [m => { m.permissions.push('tabs'); }, /tabs/],
    [m => { m.optional_host_permissions = ['http://127.0.0.1/*']; }, /127\.0\.0\.1/],
    [m => { m.content_scripts = []; }, /content_scripts/],
    [m => { m.host_permissions = ['<all_urls>']; }, /host_permissions/],
    [m => { m.content_security_policy.extension_pages = "connect-src https:"; }, /CSP/],
    [m => { m.version = '0.4'; }, /version/],
  ]) {
    const m = structuredClone(ok); mudar(m);
    assert.match(conferirManifesto(m).join('\n'), erro);
  }
});

test('arquivo importado que não existe, ou import externo, aborta o pacote', async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), 'lp-ext-'));
  try {
    await cp(FONTE, pasta, { recursive: true });
    await writeFile(path.join(pasta, 'gravar.mjs'), `import './sumiu.mjs';\n${await readFile(path.join(pasta, 'gravar.mjs'), 'utf8')}`);
    await assert.rejects(arquivosDaExtensao(pasta), /sumiu\.mjs/);
    await writeFile(path.join(pasta, 'gravar.mjs'), "import x from 'https://cdn.example.com/x.mjs';\n");
    await assert.rejects(arquivosDaExtensao(pasta), /externo/);
  } finally { await rm(pasta, { recursive: true, force: true }); }
});
