/* global module, require */
// "Usar do catálogo" no preço por item: sugere produtos do catálogo da empresa pela descrição do item
// e devolve custo, marca, modelo e fabricante para o formulário do item preencher (quem grava é o item).
// Ponto de extensão para itens-processo-ui.js: CatalogoUsar.montarBotao({ doc, descricao, catalogo, aoEscolher }).
(function (global) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./catalogo-produtos.js') : global.CatalogoProdutos;

  // Produtos ativos da empresa (RLS: quem acessa a empresa lê). Chamar uma vez por processo, não por item.
  async function listarAtivos(sb, empresaId) {
    const { data, error } = await sb.from('operacao_catalogo_produtos').select('id,nome,marca,modelo,fabricante,unidade,custo_unitario,codigo_interno,ativo')
      .eq('empresa_id', empresaId).eq('ativo', true).order('nome').limit(C.MAX_LINHAS);
    if (error) throw error;
    return data || [];
  }

  // Botão + lista de sugestões logo abaixo. aoEscolher(campos, produto): campos = C.camposParaItem(produto).
  function montarBotao({ doc = global.document, descricao, catalogo, aoEscolher }) {
    const caixa = doc.createElement('div');
    caixa.className = 'catalogo-usar';
    const botao = doc.createElement('button');
    botao.type = 'button'; botao.className = 'btn'; botao.textContent = 'Usar do catálogo';
    botao.setAttribute('aria-expanded', 'false');
    const lista = doc.createElement('div');
    lista.hidden = true;
    lista.setAttribute('role', 'group'); lista.setAttribute('aria-label', 'Produtos parecidos do catálogo');
    botao.addEventListener('click', () => {
      lista.hidden = !lista.hidden;
      botao.setAttribute('aria-expanded', String(!lista.hidden));
      if (lista.hidden) return;
      lista.replaceChildren();
      const sugestoes = C.sugerirProdutos(typeof descricao === 'function' ? descricao() : descricao, typeof catalogo === 'function' ? catalogo() : catalogo);
      if (!sugestoes.length) {
        const p = doc.createElement('p'); p.className = 'nota';
        p.textContent = 'Nenhum produto parecido no catálogo. Cadastre em Minhas empresas e documentos > Catálogo de produtos.';
        lista.append(p);
        return;
      }
      for (const { produto, pontuacao } of sugestoes) {
        const linha = doc.createElement('div');
        linha.className = 'catalogo-usar-opcao';
        const texto = doc.createElement('span');
        const custo = produto.custo_unitario === null || produto.custo_unitario === undefined ? 'sem custo' : `R$ ${String(C.camposParaItem(produto).custoUnitario || '0.00').replace('.', ',')}`;
        // textContent: nome/marca vêm do banco, nunca viram HTML.
        texto.textContent = `${produto.nome}${produto.marca ? ` · ${produto.marca}` : ''}${produto.modelo ? ` ${produto.modelo}` : ''} · ${custo} · ${Math.round(pontuacao * 100)}% parecido`;
        const usar = doc.createElement('button');
        usar.type = 'button'; usar.className = 'btn primario'; usar.textContent = 'Usar';
        usar.addEventListener('click', () => { aoEscolher(C.camposParaItem(produto), produto); lista.hidden = true; botao.setAttribute('aria-expanded', 'false'); });
        linha.append(texto, ' ', usar);
        lista.append(linha);
      }
    });
    caixa.append(botao, lista);
    return caixa;
  }

  const api = { listarAtivos, montarBotao };
  global.CatalogoUsar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
