// Prepara candidato local, nunca publica. Uso: node este-arquivo.cjs --rodada rodada-01 --compilar
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { spawnSync } = require('node:child_process');
const RAIZ = path.resolve(__dirname, '../../..');
const SAIDAS = 'C:/Users/harre/AppData/Local/LicitaPlena/integracoes-producao-20261031';
const CACHE = 'C:/Users/harre/AppData/Local/npm-cache/_npx/827da23dfd673aa2/node_modules';
const ESTATICOS = ['admin.html','cadastro.html','capag.js','contatos-resumo.js','convite.html','decisoes-resumo.js','defesa-licitante.js','defesa-ui.js','empresa-identificacao-ui.js','favicon.png','index.html','kit-documentos-ui.js','kit-documentos.css','login.html','logo-assinatura-azul.png','logo-icone-branco.svg','logo-icone.svg','logo-texto-branco.svg','logo-texto.svg','logo.png','logo.svg','operacao-acompanhamento-ui.js','operacao-acompanhamento.js','operacao-edital.js','operacao-identificacao.css','operacao-identificacao.js','operacao-relatorio.js','operacao.html','painel-design.css','painel.html','politica-cookies.html','politica-privacidade.html','processos.html','responder-oportunidade.html','responder-oportunidade.js','resumo-email.js','resumo-modelo.js','supabase-config.js','termos-de-uso.html','_headers'];
const DADOS = ['capag-municipios.json','contratos_meta.json','convenios.json','editais_vistos.json','mercado_meta.json','sistema_s_am.json'];
const DADOS_PUBLICOS = ['capag-municipios.json','contratos_meta.json','convenios.json','mercado_meta.json','sistema_s_am.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const escrever = (p, objeto) => fs.writeFileSync(p, JSON.stringify(objeto, null, 2), { flag: 'wx' });
function semLinks(local) {
  let atual = path.resolve(local);
  for (;;) { if (fs.existsSync(atual)) assert(!fs.lstatSync(atual).isSymbolicLink(), 'Caminho com link não permitido'); const pai = path.dirname(atual); if (pai === atual) break; atual = pai; }
}
function destinoNovo(root, nome) {
  assert(typeof nome === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nome), 'Identificador de rodada inválido');
  const base = path.resolve(root), destino = path.resolve(base, nome);
  assert.equal(path.dirname(destino), base); semLinks(destino);
  assert(!fs.existsSync(destino), 'Destino já existe; evidências não serão sobrescritas');
  return destino;
}
function exigirSelecao(encontrados, permitidos) {
  assert.equal(new Set(encontrados).size, encontrados.length, 'Arquivo duplicado');
  assert(encontrados.every(n => typeof n === 'string' && /^[a-zA-Z0-9_.-]+$/.test(n) && !n.startsWith('.')), 'Caminho privado ou inválido');
  assert.deepEqual([...encontrados].sort(), [...permitidos].sort(), 'Manifesto mudou; rever seleção antes de copiar');
}
function conferirConteudo(nome, texto) {
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[a-zA-Z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b/.test(texto), 'Possível segredo: ' + nome);
  for (const jwt of texto.matchAll(/\beyJ[a-zA-Z0-9_-]+\.([a-zA-Z0-9_-]+)\.[a-zA-Z0-9_-]+/g)) {
    let payload; try { payload = JSON.parse(Buffer.from(jwt[1], 'base64url').toString()); } catch { throw new Error('Possível credencial JWT: ' + nome); }
    assert.equal(payload.role, 'anon', 'Possível credencial JWT: ' + nome);
  }
  if (nome.endsWith('.json')) {
    const visitar = valor => { if (valor && typeof valor === 'object') for (const [chave, v] of Object.entries(valor)) { assert(!/^(?:password|senha|service_role|api_key|secret|access_token|refresh_token|authorization|credential|credentials)$/i.test(chave), 'Possível credencial JSON: ' + nome); visitar(v); } };
    visitar(JSON.parse(texto));
  }
}
function arquivosDiretos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).map(e => { assert(e.isFile() && !e.isSymbolicLink(), 'Arquivo/diretório inesperado em data'); return e.name; });
}
function conferirProtegidos() {
  const baseline = JSON.parse(fs.readFileSync(path.join(RAIZ, '.superpowers/sdd/2026-10-30-kit-persistente/protegidos-baseline.json'), 'utf8').replace(/^\uFEFF/, ''));
  return baseline.map(e => { const atual = sha(fs.readFileSync(path.join(RAIZ, e.path))); assert.equal(atual, e.sha256.toLowerCase(), 'Protegido alterado: ' + e.path); return { path: e.path, sha256: atual }; });
}
function ambienteBuild(destino) {
  const env = {};
  for (const chave of ['SystemRoot','SYSTEMROOT','WINDIR','SystemDrive','COMSPEC','PATH','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) if (process.env[chave] !== undefined) env[chave] = process.env[chave];
  return { ...env, VOLTA_HOME: 'C:/Users/harre/AppData/Local/Volta', WRANGLER_SEND_METRICS: 'false', WRANGLER_HIDE_BANNER: 'true', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_LOG_PATH: path.join(destino, 'wrangler.log'), CI: 'true', NO_COLOR: '1' };
}
function inventariarFontes(meta, base) {
  return Object.entries(meta.inputs).map(([entrada, info]) => {
    if (entrada.startsWith('node-built-in-modules:')) return {entrada, tipo:'builtin'};
    if (/\/_virtual_unenv_global_polyfill-[^/]+$/.test(entrada)) return {entrada, tipo:'polyfill-virtual'};
    const local = path.resolve(base, entrada);
    if (!fs.existsSync(local) && /\/\.wrangler\/tmp\/pages-[^/]+\/functionsRoutes-[^/]+\.mjs$/.test(entrada)) return {entrada, tipo:'rota-temporaria'};
    assert(fs.existsSync(local), 'Input real ausente: '+entrada);
    const bytes = fs.readFileSync(local); assert.equal(bytes.length, info.bytes, 'Input mudou de tamanho: '+entrada);
    return {entrada, tipo:'arquivo', bytes:bytes.length, sha256:sha(bytes)};
  });
}
function preparar(nome, compilar = false, minificar = false) {
  const destino = destinoNovo(SAIDAS, nome);
  const { arquivosDaRaiz, arquivosDeDados } = require(path.join(RAIZ, 'scripts/montar_publico'));
  exigirSelecao(arquivosDaRaiz(), ESTATICOS); exigirSelecao(arquivosDiretos(path.join(RAIZ, 'data')), DADOS);
  assert.equal(typeof arquivosDeDados,'function','Builder ainda não fornece seleção explícita de dados');exigirSelecao(arquivosDeDados(),DADOS_PUBLICOS);
  const protegidos = conferirProtegidos();
  const selecionados = [...ESTATICOS, ...arquivosDeDados().map(n => 'data/' + n)];
  const itens = selecionados.map(arquivo => {
    const fonte = path.join(RAIZ, arquivo); semLinks(fonte); assert(fs.statSync(fonte).isFile());
    const bytes = fs.readFileSync(fonte); if (!/\.(?:png|ico|jpe?g|webp)$/i.test(arquivo)) conferirConteudo(arquivo, bytes.toString('utf8'));
    return { arquivo, bytes: bytes.length, sha256: sha(bytes) };
  });
  fs.mkdirSync(SAIDAS, { recursive: true }); fs.mkdirSync(destino); fs.mkdirSync(path.join(destino, 'static')); fs.mkdirSync(path.join(destino, 'static/data'));
  escrever(path.join(destino, 'inicio.json'), { utc: new Date().toISOString(), raiz: RAIZ, destino, somenteLocal: true, compilar, minificar, compatibilidade: { data: '2025-09-01', flags: ['nodejs_compat'] } });
  escrever(path.join(destino, 'protegidos-antes.json'), protegidos);
  for (const item of itens) { const bytes = fs.readFileSync(path.join(RAIZ, item.arquivo)); assert.equal(sha(bytes), item.sha256, 'Fonte mudou durante cópia'); fs.writeFileSync(path.join(destino, 'static', item.arquivo), bytes, { flag: 'wx' }); }
  escrever(path.join(destino, 'manifesto-estaticos.json'), itens);
  if (compilar) {
    const pacote = JSON.parse(fs.readFileSync(path.join(CACHE, 'wrangler/package.json'), 'utf8')); assert.equal(pacote.version, '4.151.1');
    const args = ['--require', path.join(__dirname, 'bloquear-rede-build.cjs'), path.join(CACHE, 'wrangler/bin/wrangler.js'), 'pages', 'functions', 'build', path.join(RAIZ, 'functions'), '--outdir', path.join(destino, 'worker'), '--build-output-directory', path.join(destino, 'static'), '--output-routes-path', path.join(destino, 'routes.json'), '--metafile', path.join(destino, 'metafile.json'), '--compatibility-date', '2025-09-01', '--compatibility-flags', 'nodejs_compat'];
    if (minificar) args.push('--minify');
    escrever(path.join(destino, 'comando-build.json'), { executable: process.execPath, args, cwd: destino, wrangler: pacote.version, redeBloqueada: true, ambienteSemSegredos: true });
    const r = spawnSync(process.execPath, args, { cwd: destino, env: ambienteBuild(destino), encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    fs.writeFileSync(path.join(destino, 'build.stdout.log'), r.stdout || '', { flag: 'wx' }); fs.writeFileSync(path.join(destino, 'build.stderr.log'), r.stderr || '', { flag: 'wx' });
    escrever(path.join(destino, 'resultado-build.json'), { exitCode: r.status, signal: r.signal, erro: r.error?.code || null });
    assert.equal(r.status, 0, 'Build falhou; logs preservados em ' + destino);
    const entradas = fs.readdirSync(path.join(destino, 'worker'), { withFileTypes: true });
    const worker = entradas.filter(e => e.isFile()).map(e => { const bytes = fs.readFileSync(path.join(destino, 'worker', e.name)); conferirConteudo(e.name, bytes.toString('utf8')); return { arquivo: e.name, bytes: bytes.length, gzip: gzipSync(bytes).length, sha256: sha(bytes) }; });
    assert(worker.some(e => /\.js$/.test(e.arquivo)), 'Worker compilado ausente'); escrever(path.join(destino, 'manifesto-worker.json'), worker);
    const baseInputs=path.join(RAIZ,'functions');
    escrever(path.join(destino, 'fontes-build.json'), {baseInputs,momentoCaptura:'depois da compilação; tamanho conferido com metafile',utc:new Date().toISOString(),inputs:inventariarFontes(JSON.parse(fs.readFileSync(path.join(destino,'metafile.json'),'utf8')),baseInputs)});
  }
  assert.deepEqual(conferirProtegidos(), protegidos); escrever(path.join(destino, 'protegidos-depois.json'), protegidos);
  return { destino, estaticos: itens.length, compilar, minificar, publicado: false };
}
module.exports = { destinoNovo, exigirSelecao, conferirConteudo, conferirProtegidos, ambienteBuild, inventariarFontes, preparar, RAIZ, SAIDAS, CACHE, DADOS_PUBLICOS };
if (require.main === module) {
  try { const args = process.argv.slice(2); assert((args.length === 3 || args.length === 4 && args[3] === '--minificar') && args[0] === '--rodada' && args[2] === '--compilar', 'Uso: --rodada rodada-nova --compilar [--minificar]'); console.log(JSON.stringify(preparar(args[1], true, args[3] === '--minificar'))); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
