(function () {
  'use strict';
  // Ligação com o DOM real. A lógica fica em app-comercial-controlador.js (testada com doubles).
  const doc = document;
  let storage = null;
  try { storage = globalThis.localStorage; } catch { storage = null; }
  const C = globalThis.LicitaPlenaComercialControlador;
  // sistema.html marca data-modo="producao" e carrega supabase-js + supabase-config.js. Sem a marca (página
  // do harness QA), o controlador usa as rotas /qa/*. SUPABASE_URL é `const` global, não propriedade de window.
  let autenticacao = null;
  if (doc.documentElement.dataset.modo === 'producao') {
    let cliente = null;
    try {
      if (globalThis.supabase && typeof SUPABASE_URL === 'string' && typeof SUPABASE_ANON_KEY === 'string') {
        cliente = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      }
    } catch { cliente = null; }
    autenticacao = C.criarAutenticacaoSupabase({ cliente, fetch: (...args) => globalThis.fetch(...args) });
  }
  const ctrl = C.criarControlador({
    autenticacao,
    doc,
    fetch: (...args) => globalThis.fetch(...args),
    storage,
    kit: globalThis.LicitaKitDocumentos,
    identificacao: globalThis.OperacaoIdentificacao,
    itens: globalThis.LicitaItensProcesso,
    confirmar: (mensagem) => globalThis.confirm(mensagem),
  });

  let tema = 'light';
  try { if (storage?.getItem('licitaplena.tema') === 'dark') tema = 'dark'; } catch { /* preferência opcional */ }
  doc.documentElement.dataset.theme = tema;

  doc.getElementById('app-login').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const email = f.elements.email.value;
    const password = f.elements.password.value;
    f.elements.password.value = '';
    ctrl.entrar(email, password);
  });
  // Delegação: os botões são recriados a cada renderização do Hoje.
  doc.getElementById('hoje-lista').addEventListener('click', (ev) => {
    const alvo = ev.target instanceof Element ? ev.target : null;
    const abrir = alvo ? alvo.closest('button[data-processo]') : null;
    if (abrir) { ctrl.abrirProcesso(abrir.dataset.empresa, abrir.dataset.processo); return; }
    const preparo = alvo ? alvo.closest('button[data-preparar-empresa]') : null;
    if (preparo) { ctrl.prepararEmpresa(preparo.dataset.prepararEmpresa); return; }
    const novo = alvo ? alvo.closest('button[data-novo-empresa]') : null;
    if (novo) ctrl.abrirNovoProcesso(novo.dataset.novoEmpresa);
  });
  const formNovo = doc.getElementById('form-novo-processo');
  formNovo.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget.elements;
    ctrl.criarProcesso({ objeto: f.objeto.value, numero: f.numero.value, orgao: f.orgao.value, modalidade: f.modalidade.value });
  });
  doc.getElementById('novo-processo-cancelar').addEventListener('click', () => {
    ctrl.fecharNovoProcesso();
    formNovo.reset();
  });
  doc.getElementById('voltar-hoje').addEventListener('click', () => { ctrl.voltarHoje(); });
  doc.getElementById('sair').addEventListener('click', () => { ctrl.sair(); });
  doc.getElementById('tentar').addEventListener('click', () => { ctrl.tentarNovamente(); });
  doc.getElementById('empresa-ativa').addEventListener('change', (ev) => { ctrl.selecionarEmpresa(ev.currentTarget.value); });
  doc.getElementById('processo-ativo').addEventListener('change', (ev) => { ctrl.selecionarProcesso(ev.currentTarget.value); });
  doc.getElementById('tema').addEventListener('click', () => {
    const proximo = doc.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    doc.documentElement.dataset.theme = proximo;
    try { storage?.setItem('licitaplena.tema', proximo); } catch { /* preferência opcional */ }
  });

  ctrl.iniciar();
})();
