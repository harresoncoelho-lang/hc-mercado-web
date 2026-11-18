// QA local: CPU amostrada pelo inspector, nunca equivalência à cota Cloudflare.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const QA = path.resolve(__dirname, '../integracoes-producao-20261031');
const HARNESS_SHA = '09ec248f77fb2040b46c961ba7ed1a63ffcbc7ba312dcf4842279fcada9c12b3';
const BUNDLE_SHA = 'dab78768da8bab84401ed92051cd8dc462e2838df97f3263f9e098a444ba925d';
const sha = value => createHash('sha256').update(value).digest('hex');
const escrever = (arquivo, value) => fs.writeFileSync(arquivo, JSON.stringify(value, null, 2), { flag: 'wx' });

function resumirPerfil(profile) {
  assert(Number.isFinite(profile.startTime) && profile.endTime >= profile.startTime);
  const nodes = new Map(profile.nodes.map(n => [n.id, n.callFrame.functionName]));
  const samples = profile.samples || [], deltas = profile.timeDeltas || [];
  assert.equal(samples.length, deltas.length, 'Perfil sem deltas completos');
  let total = 0, idle = 0, gc = 0;
  for (let i = 0; i < samples.length; i++) {
    assert(nodes.has(samples[i]) && Number.isFinite(deltas[i]) && deltas[i] >= 0);
    total += deltas[i];
    if (nodes.get(samples[i]) === '(idle)') idle += deltas[i];
    if (nodes.get(samples[i]) === '(garbage collector)') gc += deltas[i];
  }
  return { amostras: samples.length, janelaMs: (profile.endTime - profile.startTime) / 1000,
    amostradoMs: total / 1000, ativoAmostradoMs: samples.length ? (total - idle) / 1000 : null,
    ociosoMs: idle / 1000, gcMs: gc / 1000,
    limite: 'Estimativa amostrada local, inclui overhead do profiler; não é CPU faturada nem valida cota remota.' };
}

function urlInspector(url) {
  const endpoint = new URL('/core:user:produto', url);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Inspector deve ser loopback');
  assert(['http:', 'ws:'].includes(endpoint.protocol) && endpoint.port, 'Inspector local sem porta explícita');
  endpoint.protocol = 'ws:';
  return endpoint;
}

async function conectarInspector(url, WebSocket) {
  const socket = new WebSocket(url); const pendentes = new Map(); let id = 0;
  const falhar = erro => { for (const p of pendentes.values()) { clearTimeout(p.timer); p.reject(erro); } pendentes.clear(); };
  socket.on('error', falhar);
  socket.on('close', () => falhar(new Error('Inspector encerrado')));
  socket.on('message', bytes => {
    let data; try { data = JSON.parse(String(bytes)); } catch (e) { falhar(e); return; }
    const p = pendentes.get(data.id); if (!p) return;
    pendentes.delete(data.id); clearTimeout(p.timer);
    if (data.error) p.reject(new Error(JSON.stringify(data.error))); else p.resolve(data.result);
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Inspector não abriu em 5 s')), 5000);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', e => { clearTimeout(timer); reject(e); });
    });
  } catch (e) { socket.terminate(); throw e; }
  return { comando(method, params = {}) {
    return new Promise((resolve, reject) => {
      const chave = ++id;
      const timer = setTimeout(() => { pendentes.delete(chave); reject(new Error('Timeout inspector: ' + method)); }, 5000);
      pendentes.set(chave, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: chave, method, params }), e => { if (e) falhar(e); });
    });
  }, async fechar() {
    falhar(new Error('Encerramento do QA'));
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Inspector não encerrou em 3 s')), 3000); socket.once('close', () => { clearTimeout(timer); resolve(); }); socket.terminate(); });
  } };
}

async function executar(execucao, inspecionar = false) {
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(execucao));
  assert.equal(sha(fs.readFileSync(path.join(QA, 'testar-worker.cjs'))), HARNESS_SHA);
  const { criarFixture, isolamentoHost, auditarConfig, encerrarInstancia, opcoesWorker, ids } = require(path.join(QA, 'testar-worker.cjs'));
  const { RAIZ, SAIDAS, CACHE, conferirProtegidos } = require(path.join(QA, 'preparar-cloudflare.cjs'));
  assert.equal(path.resolve(process.cwd()), path.resolve(RAIZ), 'Executar no worktree revisado');
  const rodada = path.join(SAIDAS, 'rodada-04-leitor-pdf'), worker = path.join(rodada, 'worker/index.js');
  const contents = fs.readFileSync(worker, 'utf8'); assert.equal(sha(contents), BUNDLE_SHA);
  const destino = path.join(rodada, execucao); assert(!fs.existsSync(destino), 'Não sobrescrever evidências'); fs.mkdirSync(destino);
  const configPath = path.join(destino, 'config.json'), anterior = process.env.MINIFLARE_WORKERD_CONFIG_DEBUG;
  const protegidos = conferirProtegidos(), f = criarFixture(), medidas = [];
  let instancia, inspector, erro = null;
  const guard = isolamentoHost({ antesDeSpawn() {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    escrever(configPath + '.auditoria.json', auditarConfig(config));
    const produto = config.services.find(x => x.name === 'core:user:produto').worker;
    assert.equal(produto.modules.length, 1);
    const sufixo = '\n//# sourceURL=' + require('node:url').pathToFileURL(path.join(RAIZ, 'index.js')).href + '\n';
    assert([contents, contents + sufixo].includes(produto.modules[0].esModule), 'Código compilado divergiu além do sourceURL conhecido');
    if (inspecionar) throw new Error('CONFIGURACAO_INSPECIONADA_SEM_WORKERD');
  } });
  escrever(path.join(destino, 'inicio.json'), { utc: new Date().toISOString(), scriptSha256: sha(fs.readFileSync(__filename)), harnessSha256: HARNESS_SHA, bundleSha256: BUNDLE_SHA,
    authBancoStorage: 'Fixtures fictícias; zero servidor real', tipo: 'Perfil local pós-inicialização; startup remoto não medido', inspecionar });
  process.env.MINIFLARE_WORKERD_CONFIG_DEBUG = configPath;
  const watchdog = setTimeout(async () => { try { await guard.encerrarFilhos(true); escrever(path.join(destino, 'watchdog.json'), { filhos: guard.filhos }); } finally { process.exit(1); } }, 120000); watchdog.unref();
  try {
    const { Miniflare, Log, LogLevel } = require(path.join(CACHE, 'miniflare'));
    const options = opcoesWorker(contents, true, f.outbound, new Log(LogLevel.ERROR)); options.inspectorPort = 0;
    instancia = new Miniflare(options); const t0 = performance.now(); await instancia.ready;
    escrever(path.join(destino, 'prontidao.json'), { wallMs: performance.now() - t0, limite: 'Inclui processos, sockets e auxiliares; não é startup CPU do Worker.' });
    inspector = await conectarInspector(urlInspector(await instancia.getInspectorURL()), require(path.join(CACHE, 'ws')));
    await inspector.comando('Profiler.enable'); await inspector.comando('Profiler.setSamplingInterval', { interval: 1000 });
    const chamar = async (rota, body) => {
      assert(['empresa-identificacao', 'kit-documentos'].includes(rota));
      const r = await instancia.dispatchFetch('https://licitaplena.com.br/api/' + rota, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://licitaplena.com.br', Authorization: 'Bearer QA_USER' }, body: JSON.stringify(body) });
      const texto = await r.text(); assert.equal(r.status, 200, rota + '/' + body.acao + ': ' + texto.slice(0,200)); return JSON.parse(texto);
    };
    const medir = async (nome, rota, body, validar) => {
      const base = f.chamadas.length; await inspector.comando('Profiler.start'); const t = performance.now();
      let result; try { result = await chamar(rota, body); } finally {
        const wallMs = performance.now() - t, { profile } = await inspector.comando('Profiler.stop');
        escrever(path.join(destino, nome + '.cpuprofile'), profile);
        medidas.push({ nome, wallMs, chamadasFixture: f.chamadas.length - base, ...resumirPerfil(profile) });
        escrever(path.join(destino, nome + '.json'), medidas.at(-1));
      }
      validar(result); return result;
    };
    const cadastro = { empresaId: ids.empresa }, kit = { empresaId: ids.empresa, processoId: ids.processo };
    await medir('01-consultar', 'empresa-identificacao', { ...cadastro, acao: 'consultar' }, x => assert.equal(x.empresa.cnpj, f.empresa.cnpj));
    for (const nome of ['02-pdf-primeiro', '03-pdf-repetido', '04-pdf-repetido']) await medir(nome, 'empresa-identificacao', { ...cadastro, acao: 'extrair', documentoId: ids.pdf }, x => { assert.equal(x.modo, 'sugestoes'); assert.equal(x.evidencias.length, 4); assert.equal(x.hash, sha(f.pdf)); });
    await chamar('empresa-identificacao', { ...cadastro, acao: 'confirmar', revisado: true, razaoSocial: f.empresa.razao_social, cnpj: f.empresa.cnpj, dados: { endereco: 'RUA DE TESTES 100', representante: 'ANA TESTE', cargo: 'SOCIA' }, proveniencia: [] });
    const target = { ...kit, documentoId: ids.proposta, versaoEsperada: 1 };
    await chamar('kit-documentos', { ...target, acao: 'salvar', versaoEsperada: 0, tipo: 'proposta', proposta: { itemIds: [ids.item1, ids.item2], unidades: { [ids.item1]: 'un', [ids.item2]: 'un' }, validade: '30 dias', prazoEntrega: '10 dias', pagamento: '30 dias' } });
    const pre = await medir('05-proposta-previa', 'kit-documentos', { ...target, acao: 'preparar' }, x => { assert.match(x.previa.texto, /Total da proposta: R\$ 3,71/); assert(!x.previa.texto.includes('NAO SELECIONADO')); });
    const reviewed = { ...target, revisado: true, revisaoHash: pre.revisaoHash };
    await chamar('kit-documentos', { ...reviewed, acao: 'confirmarRevisao' });
    const Zip = require(path.join(RAIZ, 'node_modules/adm-zip'));
    for (const nome of ['06-proposta-exportar', '07-proposta-exportar']) await medir(nome, 'kit-documentos', { ...reviewed, acao: 'exportar' }, x => { const zip = new Zip(Buffer.from(x.arquivoBase64, 'base64')); assert(zip.test()); assert.match(zip.readAsText('word/document.xml'), /3,71/); });
    assert.equal(f.negados.length, 0); assert.equal(guard.bloqueados.length, 0);
  } catch (e) { erro = { mensagem: e.message, stack: e.stack }; }
  finally {
    try { await inspector?.fechar(); } catch (e) { erro ||= { mensagem: e.message }; }
    try { if (instancia) await encerrarInstancia(instancia, guard); } catch (e) { erro ||= { mensagem: e.message }; }
    try { await new Promise(resolve => setImmediate(resolve)); await guard.encerrarFilhos(); assert(guard.filhos.every(x => x.encerrado)); } catch (e) { erro ||= { mensagem: e.message }; }
    guard.restaurar(); clearTimeout(watchdog);
    if (anterior === undefined) delete process.env.MINIFLARE_WORKERD_CONFIG_DEBUG; else process.env.MINIFLARE_WORKERD_CONFIG_DEBUG = anterior;
    try { assert.deepEqual(conferirProtegidos(), protegidos); assert.equal(sha(fs.readFileSync(worker)), BUNDLE_SHA); } catch (e) { erro ||= { mensagem: e.message }; }
    escrever(path.join(destino, 'resultado.json'), { utc: new Date().toISOString(), erro, medidas, protegidos, filhos: guard.filhos, negados: f.negados, bloqueadosHost: guard.bloqueados, chamadasFixture: f.chamadas.length });
  }
  if (erro) throw new Error(erro.mensagem);
  return { destino, medidas: medidas.length, filhosEncerrados: guard.filhos.every(x => x.encerrado) };
}

function lerArgumentos(args) {
  assert(args.length === 1 || args.length === 2, 'Uso: perf-worker.cjs nome-da-execucao [--inspecionar]');
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args[0]), 'Nome de execução inválido');
  assert(args.length === 1 || args[1] === '--inspecionar', 'Flag desconhecida; permitido somente --inspecionar');
  return { execucao: args[0], inspecionar: args.length === 2 };
}
module.exports = { resumirPerfil, urlInspector, executar, lerArgumentos };
if (require.main === module) {
  try {
    const args = lerArgumentos(process.argv.slice(2));
    executar(args.execucao, args.inspecionar).then(x => console.log(JSON.stringify(x)), e => { console.error(e.message); process.exitCode = 1; });
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
