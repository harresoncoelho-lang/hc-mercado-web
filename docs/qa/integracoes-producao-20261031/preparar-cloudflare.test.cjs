const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const alvo = path.join(__dirname, 'preparar-cloudflare.cjs');

test('preparação exige implementação local sem execução ao importar', () => {
  assert.ok(fs.existsSync(alvo), 'Falta preparação isolada com verificações');
});

test('destino é filho novo e não permite caminhos, traversal ou reutilização', () => {
  if (!fs.existsSync(alvo)) return;
  const { destinoNovo } = require(alvo);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'licitaplena-destino-'));
  assert.equal(destinoNovo(root, 'rodada-01'), path.join(root, 'rodada-01'));
  for (const nome of ['../outro', '.', '..', 'a/b', 'a\\b', 'C:\\x', '']) assert.throws(() => destinoNovo(root, nome));
  fs.mkdirSync(path.join(root, 'existente'));
  assert.throws(() => destinoNovo(root, 'existente'), /existe/);
});

test('manifesto rejeita arquivo novo, ausente, duplicado e caminho privado', () => {
  if (!fs.existsSync(alvo)) return;
  const { exigirSelecao } = require(alvo);
  const aprovados = ['index.html', 'kit-documentos.css'];
  assert.doesNotThrow(() => exigirSelecao([...aprovados].reverse(), aprovados));
  for (const entrada of [['index.html'], [...aprovados, 'qa.json'], [...aprovados, 'index.html'], ['../privado', 'index.html']]) assert.throws(() => exigirSelecao(entrada, aprovados));
});

test('segredos são recusados e chave pública não é tratada como credencial administrativa', () => {
  if (!fs.existsSync(alvo)) return;
  const { conferirConteudo } = require(alvo);
  const jwt = role => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'ficticia'].join('.');
  assert.doesNotThrow(() => conferirConteudo('supabase-config.js', 'const anon="sb_publishable_exemplo_publico";'));
  assert.doesNotThrow(() => conferirConteudo('publico.json', JSON.stringify({ key: jwt('anon') })));
  for (const [nome, dado] of [['a.js', jwt('service_role')], ['a.js', jwt('authenticated')], ['a.txt', '-----BEGIN PRIVATE KEY-----'], ['a.js', 'sb_secret_' + 'X'.repeat(32)], ['a.json', '{"access_token":"ficticio"}']]) assert.throws(() => conferirConteudo(nome, dado), /credencial|segredo/i);
});

test('preloader bloqueia HTTP, HTTPS, fetch, TCP e TLS antes de enviar rede', () => {
  const bloqueador = path.join(__dirname, 'bloquear-rede-build.cjs');
  if (!fs.existsSync(bloqueador)) return;
  const script = `const assert=require('node:assert/strict'); let n=0;
  for(const fn of [()=>require('node:http').get('http://example.invalid'),()=>require('node:https').request('https://example.invalid'),()=>require('node:net').connect(443,'example.invalid'),()=>require('node:tls').connect(443,'example.invalid'),()=>require('node:dgram').createSocket('udp4'),()=>require('node:dns').lookup('example.invalid',()=>{})]){assert.throws(fn,/Rede bloqueada/);n++}
  fetch('https://example.invalid').then(()=>process.exit(9),e=>{assert.match(e.message,/Rede bloqueada/);console.log(n+1)});`;
  const r = spawnSync(process.execPath, ['--require', bloqueador, '-e', script], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), '7');
});
test('inputs do metafile são relativos à pasta functions; reais ausentes não viram virtuais',()=>{
  const {inventariarFontes}=require(alvo);const root=fs.mkdtempSync(path.join(os.tmpdir(),'licitaplena-inputs-'));fs.mkdirSync(path.join(root,'functions'));fs.mkdirSync(path.join(root,'netlify'));
  fs.writeFileSync(path.join(root,'netlify','handler.js'),'QA');
  const meta={inputs:{'../netlify/handler.js':{bytes:2},'node-built-in-modules:node:crypto':{bytes:0}}};
  const dados=inventariarFontes(meta,path.join(root,'functions'));assert.equal(dados[0].sha256.length,64);assert.equal(dados[1].tipo,'builtin');
  assert.throws(()=>inventariarFontes({inputs:{'../netlify/ausente.js':{bytes:1}}},path.join(root,'functions')),/ausente/);
  assert.throws(()=>inventariarFontes({inputs:{'../netlify/handler.js':{bytes:3}}},path.join(root,'functions')),/tamanho/);
});
test('seleção de dados publicáveis exclui histórico privado por destinatário',()=>{
  const {DADOS_PUBLICOS}=require(alvo);assert.equal(DADOS_PUBLICOS.length,5);assert(!DADOS_PUBLICOS.includes('editais_vistos.json'));
});
