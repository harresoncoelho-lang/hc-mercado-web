// Preview isolado, sem autenticação ou banco reais. node docs/qa/jornada-cadastro-20261031/t1-servidor.cjs
const fs = require('node:fs'), path = require('node:path');
const { criarServidor: criarServidorKit, cenarios } = require('../servir-kit-documentos-local.cjs');
const raiz = process.env.T1_BASELINE || path.resolve(__dirname, '../../..');
const empresas = cenarios.map(c => c.empresa);
const processos = cenarios.map(c => ({ ...c.processo, objeto: `Compra fictícia ${c.empresa.razao_social}`, status: 'preparacao', criado_em: '2026-10-30' }));
const sdk = `window.qa={sessao:{user:{id:'usuario-ficticio'},access_token:'demonstracao-local-ficticia'},callbacks:[],emitir(sessao){this.sessao=sessao;for(const cb of this.callbacks)cb('SIGNED_IN',sessao);}};
window.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:window.qa.sessao}}),onAuthStateChange(cb){window.qa.callbacks.push(cb);return {data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},rpc:async nome=>({data:nome==='meu_acesso_operacao'?{}:nome==='meu_limite_cnpjs'?10:'organizacao-ficticia',error:null}),from(tabela){const params=new URLSearchParams(location.search);const tabelas={clientes:[{id:'usuario-ficticio',status:params.has('pendente')?'pendente':'aprovado'}],operacao_empresas:params.has('vazio')?[]:${JSON.stringify(empresas)},operacao_processos:${JSON.stringify(processos)}};let rows=tabelas[tabela]||[],single=false;const q=new Proxy({}, {get(_,key){if(key==='then')return (resolve,reject)=>Promise.resolve({data:single?rows[0]:rows,error:null}).then(resolve,reject);if(key==='maybeSingle'||key==='single')return ()=>{single=true;return q};if(key==='eq')return (campo,valor)=>{if(campo!=='organizacao_id'&&campo!=='ativo')rows=rows.filter(r=>r[campo]===valor);return q};if(key==='in')return (campo,ids)=>{rows=rows.filter(r=>ids.includes(r[campo]));return q};if(key==='range')return (a,b)=>{rows=rows.slice(a,b+1);return q};return ()=>q;}});return q;}}}};`;
const arquivos = new Set(['operacao.html', 'processos.html', 'empresa-identificacao-ui.js', 'operacao-identificacao.js', 'operacao-identificacao.css', 'kit-documentos-ui.js', 'kit-documentos.css', 'supabase-config.js', 'operacao-acompanhamento.js', 'operacao-acompanhamento-ui.js', 'operacao-edital.js', 'operacao-relatorio.js', 'logo-icone-branco.svg', 'favicon.png']);
function criarServidor() {
  const servidor = criarServidorKit(), original = servidor.listeners('request')[0], perfis = new Map();
  servidor.removeAllListeners('request');
  servidor.on('request', async (req, res) => {
    if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) return res.writeHead(403).end();
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'");
    if (url.pathname === '/t1-sdk.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(sdk); }
    if (url.pathname === '/login.html') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end('<h1>Sessão encerrada — fixture local</h1>'); }
    if (url.pathname === '/api/empresa-identificacao' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== 'Bearer demonstracao-local-ficticia') return res.writeHead(401).end(JSON.stringify({ erro: 'Sessão fictícia necessária.' }));
      let raw = ''; for await (const parte of req) { raw += parte; if (raw.length > 50000) return res.writeHead(413).end('{}'); }
      try {
        const pedido = JSON.parse(raw), empresa = empresas.find(e => e.id === pedido.empresaId);
        if (!empresa) return res.writeHead(404).end(JSON.stringify({ erro: 'Empresa indisponível.' }));
        if (pedido.acao === 'confirmar') {
          if (!pedido.revisado || !['endereco', 'representante', 'cargo'].every(k => pedido.dados?.[k])) return res.writeHead(400).end(JSON.stringify({ erro: 'Confira os campos.' }));
          perfis.set(empresa.id, { status: 'confirmado', dados: pedido.dados, versao: 1, proveniencia: [] });
        } else if (pedido.acao !== 'consultar') return res.writeHead(400).end('{}');
        return res.end(JSON.stringify({ empresa, perfil: perfis.get(empresa.id) || null, documentos: [] }));
      } catch { return res.writeHead(400).end('{}'); }
    }
    const nome = url.pathname.slice(1);
    const caminho = fs.existsSync(path.join(raiz, nome)) ? path.join(raiz, nome) : path.resolve(__dirname, '../../..', nome);
    if (req.method === 'GET' && arquivos.has(nome) && fs.existsSync(caminho)) {
      let body = fs.readFileSync(caminho);
      if (nome.endsWith('.html')) body = body.toString().replace(/<link[^>]+https:\/\/fonts\.[^>]+>/g, '').replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, '<script src="/t1-sdk.js"></script>');
      res.setHeader('Content-Type', nome.endsWith('.html') ? 'text/html; charset=utf-8' : nome.endsWith('.css') ? 'text/css' : nome.endsWith('.svg') ? 'image/svg+xml' : nome.endsWith('.png') ? 'image/png' : 'text/javascript');
      return res.end(body);
    }
    if (url.pathname === '/api/kit-documentos') return original(req, res);
    res.writeHead(404).end();
  });
  return servidor;
}
if (require.main === module) { const servidor = criarServidor(); servidor.listen(0, '127.0.0.1', () => console.log(`Preview fictício: http://127.0.0.1:${servidor.address().port}/operacao.html?aba=identificacao&empresa=${empresas[0].id}`)); }
module.exports = { criarServidor, empresas, processos };
