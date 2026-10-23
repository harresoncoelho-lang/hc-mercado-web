const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('abrir edital A, fechar e abrir B preserva um único host e uma Central antes da análise crítica', () => {
  const html = fs.readFileSync(path.join(__dirname, '../painel.html'), 'utf8');
  class Elemento {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.classList = { add() {}, remove() {} }; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    appendChild(no) { no.remove(); no.parentNode = this; this.children.push(no); return no; }
    append(...nos) { nos.forEach(no => this.appendChild(no)); }
    insertBefore(no, referencia) { if (no === referencia) return no; no.remove(); no.parentNode = this; const indice = this.children.indexOf(referencia); this.children.splice(indice < 0 ? this.children.length : indice, 0, no); return no; }
    replaceWith(no) { const pai = this.parentNode; pai.insertBefore(no, this); this.remove(); }
    set innerHTML(_valor) { this.children.forEach(no => { no.parentNode = null; }); this.children = []; }
    setAttribute() {}
    addEventListener() {}
    querySelector(seletor) { return percorrer(this).find(no => seletor === '[data-resumo-estrutura]' && no.dataset.resumoEstrutura) || null; }
  }
  const percorrer = no => no.children.flatMap(filho => [filho, ...percorrer(filho)]);
  const raiz = new Elemento('body'), corpo = new Elemento('main'); raiz.append(corpo);
  const ids = ['modal-ia-conversa', 'modal-ia-defesa', 'modal-ia-checklist-doc', 'modal-ia-objeto', 'modal-ia-pergunta', 'modal-ia-form', 'modal-ia-alternar-pergunta', 'modal-ia-cartoes-topo', 'modal-ia-consideracoes', 'modal-ia-baixar', 'modal-ia-checklist-email', 'modal-ia-imprimir', 'modal-ia-fundo'];
  for (const id of ids) { const no = new Elemento('div'); no.id = id; corpo.append(no); }
  const doc = { getElementById: id => percorrer(raiz).find(no => no.id === id) || null, createElement: tag => new Elemento(tag), createTextNode: texto => Object.assign(new Elemento('text'), { textContent: texto }), querySelector: () => corpo };
  let fechamentos = 0;
  const contexto = vm.createContext({ document: doc, iaGeracaoModal: 0, iaTemporizadorResumo: null, iaRequisicaoAtual: null, iaCarregando: false, empresaOperacionalId: 'qa', clearTimeout, setTimeout,
    bloquearAcoesResumo() {}, idOportunidade: edital => edital.numeroControlePNCP, lerMapa: () => ({}), enriquecerEditalComDetalhePncp: () => new Promise(() => {}), carregarItensDoResumoIA() {}, carregarCapagNoResumo() {}, lerCacheLocalResumo: () => null, montarFichaImediata: edital => ({ identificacao: { numero: edital.numeroControlePNCP } }), chamarIA() {}, aplicarDadosOficiaisNaEstruturaIA: est => est, renderizarCartoesTopoIA() {},
    ResumoModelo: { montarVisual: () => ({ secoes: [{ titulo: 'Análise crítica', campos: [{ rotulo: 'Estado', valor: 'Conferir' }] }] }) },
    atualizarCentralDefesa() { const host = doc.getElementById('modal-ia-defesa'); if (!host) return; host.innerHTML = ''; const central = new Elemento('section'); central.className = 'defesa-central'; central.edital = contexto.iaEditalAtual.numeroControlePNCP; host.append(central); host._defesa = { fechar() { fechamentos++; } }; },
  });
  const recortar = (inicio, fim) => html.slice(html.indexOf(inicio), html.indexOf(fim, html.indexOf(inicio)));
  vm.runInContext([recortar('  function cancelarConsultaResumo()', '  function oferecerNovaAnalise('), recortar('  function renderizarEstruturaIA(', '  function atualizarCentralDefesa('), recortar('  function abrirModalIA(', '  document.getElementById("modal-ia-fechar").addEventListener')].join('\n'), contexto);
  for (const numeroControlePNCP of ['11111111000111-1-000001/2026', '22222222000122-1-000002/2026']) {
    contexto.abrirModalIA({ numeroControlePNCP });
    const nos = percorrer(raiz), host = doc.getElementById('modal-ia-defesa');
    assert.equal(nos.filter(no => no.id === 'modal-ia-defesa').length, 1);
    assert.equal(nos.filter(no => no.className === 'defesa-central').length, 1);
    assert.equal(host.children[0].edital, numeroControlePNCP);
    const critica = host.parentNode.children.find(no => no.dataset.resumoSecao === 'Análise crítica');
    assert.ok(host.parentNode.children.indexOf(host) < host.parentNode.children.indexOf(critica));
    contexto.fecharModalIA();
    assert.equal(doc.getElementById('modal-ia-defesa').parentNode, corpo);
  }
  assert.equal(fechamentos, 2);
});
