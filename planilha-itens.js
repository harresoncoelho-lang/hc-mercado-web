/* global module, require, TextEncoder */
// Planilha de itens do processo (CSV para Excel/LibreOffice em pt-BR). Mesmo módulo no navegador e no servidor
// (as funções do Netlify carregam este arquivo da raiz do repositório). Só prepara e confere: a gravação real (tudo ou nada) fica no servidor.
// - Saída: UTF-8 com BOM, separador ';', CRLF, aspas RFC 4180, decimal com vírgula, antifórmula com apóstrofo.
// - Entrada: a chave é a coluna "item" (identificador). Célula vazia não altera nada. Item de origem PNCP não
//   muda descrição, quantidade nem unidade. Regras de texto e limite são as de validarItemCampos (itens-processo-ui.js).
// Itens atuais no formato público do servidor: { identificador, descricao, quantidade, valorUnitario, marca, modelo,
// unidade, fabricante, valorUnitarioMinimo, origemPncp } com números em texto canônico ("2.500", "1.10").
(function (global) {
  'use strict';
  const itensUi = typeof module !== 'undefined' && module.exports ? require('./itens-processo-ui.js') : global.LicitaItensProcesso;
  const COLUNAS = ['item', 'descricao', 'quantidade', 'unidade', 'valor_unitario', 'marca', 'modelo', 'fabricante', 'preco_minimo'];
  const CHAVE = { item: 'identificador', descricao: 'descricao', quantidade: 'quantidade', unidade: 'unidade', valor_unitario: 'valorUnitario', marca: 'marca', modelo: 'modelo', fabricante: 'fabricante', preco_minimo: 'valorUnitarioMinimo' };
  const CASAS = { quantidade: 3, valor_unitario: 2, preco_minimo: 2 };
  const ROTULO = { quantidade: 'Quantidade', valor_unitario: 'Valor unitário', preco_minimo: 'Preço mínimo' };
  const MAX_LINHAS = 1000;
  const MAX_BYTES = 2 * 1024 * 1024;
  const FORMULA = /^[=+\-@\t\r]/;
  // eslint-disable-next-line no-control-regex -- recusa caracteres de controle em texto livre
  const CONTROLE = /[\u0000-\u001f\u007f]/;

  // ---------- saída ----------
  function celula(v) {
    let t = v === null || v === undefined ? '' : String(v);
    if (FORMULA.test(t)) t = `'${t}`;
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }
  const virgula = (v) => (v === null || v === undefined || v === '' ? '' : String(v).replace('.', ','));
  function gerarCsv(itens) {
    const linhas = [COLUNAS.join(';')];
    for (const i of itens || []) {
      linhas.push([i.identificador, i.descricao, virgula(i.quantidade), i.unidade, virgula(i.valorUnitario), i.marca, i.modelo, i.fabricante, virgula(i.valorUnitarioMinimo)].map(celula).join(';'));
    }
    return `\uFEFF${linhas.join('\r\n')}\r\n`;
  }

  // ---------- leitura ----------
  // RFC 4180 com ';'. Aceita CRLF e LF (planilhas salvas em outros sistemas). Devolve registros ou erro.
  function registros(texto) {
    const out = []; let campo = '', reg = [], aspas = false, i = 0;
    while (i < texto.length) {
      const c = texto[i];
      if (aspas) {
        if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 2; continue; }
        if (c === '"') { aspas = false; i += 1; continue; }
        campo += c; i += 1; continue;
      }
      if (c === '"' && campo === '') { aspas = true; i += 1; continue; }
      if (c === ';') { reg.push(campo); campo = ''; i += 1; continue; }
      if (c === '\r' || c === '\n') {
        reg.push(campo); out.push(reg); campo = ''; reg = [];
        i += c === '\r' && texto[i + 1] === '\n' ? 2 : 1; continue;
      }
      campo += c; i += 1;
    }
    if (aspas) return { erro: 'A planilha tem aspas sem fechamento. Confira a última célula com aspas.' };
    if (campo !== '' || reg.length) { reg.push(campo); out.push(reg); }
    return { registros: out };
  }
  const semApostrofo = (t) => (t.startsWith("'") && FORMULA.test(t.slice(1)) ? t.slice(1) : t);

  function lerCsv(texto) {
    const falha = (erro) => ({ ok: false, erros: [erro], linhas: [] });
    if (typeof texto !== 'string') return falha('Arquivo de planilha inválido.');
    if (new TextEncoder().encode(texto).length > MAX_BYTES) return falha('A planilha passa de 2 MB. Divida em arquivos menores.');
    const r = registros(texto.replace(/^\uFEFF/, ''));
    if (r.erro) return falha(r.erro);
    const [cab, ...resto] = r.registros;
    if (!cab || cab.map((c) => c.trim().toLowerCase()).join(';') !== COLUNAS.join(';')) {
      return falha(`O cabeçalho precisa ser exatamente: ${COLUNAS.join(';')}. Baixe a planilha do sistema e preencha nela.`);
    }
    const dados = resto.map((valores, k) => ({ linha: k + 2, valores })).filter((l) => l.valores.some((v) => v.trim() !== ''));
    if (dados.length > MAX_LINHAS) return falha(`A planilha tem ${dados.length} linhas de itens; o limite é ${MAX_LINHAS}. Divida em arquivos menores.`);
    const erros = []; const linhas = [];
    for (const { linha, valores } of dados) {
      if (valores.length !== COLUNAS.length) { erros.push(`Linha ${linha}: esperadas ${COLUNAS.length} colunas, encontradas ${valores.length}. Confira se há ";" sobrando ou faltando.`); continue; }
      linhas.push({ linha, valores: Object.fromEntries(COLUNAS.map((c, k) => [c, semApostrofo(valores[k].trim())])) });
    }
    return { ok: erros.length === 0, erros, linhas };
  }

  // ---------- conferência ----------
  // Número pt-BR → texto canônico do servidor ("2,500" → "2.5"); zeros além das casas permitidas são aceitos.
  function numero(texto, coluna) {
    const casas = CASAS[coluna];
    if (!/^\d+([.,]\d{1,4})?$/.test(texto)) {
      if (/^\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(texto)) return { erro: `${ROTULO[coluna]} "${texto}": não use separador de milhar. Escreva só os dígitos e a vírgula dos decimais. Ex.: 1234,56` };
      return { erro: `${ROTULO[coluna]} "${texto}": use só números, com vírgula para decimais. Ex.: 2,5` };
    }
    let [int, frac = ''] = texto.split(/[.,]/);
    if (/[1-9]/.test(frac.slice(casas))) return { erro: `${ROTULO[coluna]} "${texto}": no máximo ${casas} casas decimais.` };
    frac = frac.slice(0, casas).replace(/0+$/, '');
    int = int.replace(/^0+(?=\d)/, '');
    return { valor: frac ? `${int}.${frac}` : int };
  }
  const escalado = (t, casas) => { const [i, f = ''] = String(t).split('.'); return BigInt(i + f.padEnd(casas, '0')); };
  const igualNumero = (a, b, casas) => a !== null && a !== undefined && a !== '' && escalado(a, casas) === escalado(b, casas);
  function textoLivre(v, max, rotulo) {
    return v.length > max || CONTROLE.test(v) ? `Confira ${rotulo} (até ${max} caracteres, sem caracteres de controle).` : null;
  }

  function conferirLinha({ linha, valores }, atual) {
    const msgs = []; const mudancas = {};
    for (const col of COLUNAS.slice(1)) {
      const v = valores[col];
      if (v === '') continue;
      let novo = v;
      if (CASAS[col]) { const n = numero(v, col); if (n.erro) { msgs.push(n.erro); continue; } novo = n.valor; }
      const chave = CHAVE[col], antigo = atual ? atual[chave] : null;
      const igual = CASAS[col] ? igualNumero(antigo, novo, CASAS[col]) : (antigo ?? '') === novo;
      if (!igual) mudancas[chave] = novo;
    }
    if (atual?.origemPncp && ['descricao', 'quantidade', 'unidade'].some((k) => k in mudancas)) {
      msgs.push('item importado do PNCP: descrição, quantidade e unidade vêm do edital e não podem ser alteradas.');
    }
    if (!atual) {
      for (const [col, rot] of [['descricao', 'a descrição'], ['quantidade', 'a quantidade'], ['valor_unitario', 'o valor unitário']]) {
        if (valores[col] === '') msgs.push(`item novo: informe ${rot}.`);
      }
    }
    const final = { ...(atual || {}), identificador: valores.item, ...mudancas };
    if (!msgs.length && Object.keys(mudancas).length) {
      const v = itensUi.validarItemCampos({ identificador: final.identificador, descricao: final.descricao, marca: final.marca || '', modelo: final.modelo || '', quantidade: final.quantidade, valorUnitario: final.valorUnitario });
      msgs.push(...Object.values(v.erros));
      if ('unidade' in mudancas) { const e = textoLivre(final.unidade, 100, 'a unidade'); if (e) msgs.push(e); }
      if ('fabricante' in mudancas) { const e = textoLivre(final.fabricante, 500, 'o fabricante'); if (e) msgs.push(e); }
      if (final.valorUnitarioMinimo) {
        const m = itensUi.decimalPositivo(final.valorUnitarioMinimo, 2);
        if (m === null) msgs.push('Preço mínimo: número positivo com até 2 casas decimais, dentro do limite.');
        else if (!v.erros.valorUnitario && m > escalado(final.valorUnitario, 2)) msgs.push('O preço mínimo não pode ser maior que o valor unitário da proposta.');
      }
    }
    const item = valores.item;
    const estado = msgs.length ? 'erro' : !atual ? 'novo' : Object.keys(mudancas).length ? 'alterado' : 'sem_mudanca';
    return { linha, item, estado, mensagens: msgs.map((m) => `Linha ${linha} (item ${item}): ${m}`), mudancas, dados: estado === 'erro' ? null : final };
  }

  // Prévia linha a linha. ok só se nenhuma linha tiver erro (a importação é tudo ou nada).
  function validarLinhas(linhas, itensAtuais) {
    const porId = new Map((itensAtuais || []).map((i) => [i.identificador, i]));
    const vistos = new Set(); const resultado = [];
    for (const l of linhas || []) {
      const item = l.valores.item;
      if (!item) { resultado.push({ linha: l.linha, item: '', estado: 'erro', mensagens: [`Linha ${l.linha}: informe o item (identificador) na primeira coluna.`], mudancas: {}, dados: null }); continue; }
      if (item.length > 180 || CONTROLE.test(item)) { resultado.push({ linha: l.linha, item, estado: 'erro', mensagens: [`Linha ${l.linha} (item ${item.slice(0, 40)}): Informe o identificador do item (até 180 caracteres, sem caracteres de controle).`], mudancas: {}, dados: null }); continue; }
      if (vistos.has(item)) { resultado.push({ linha: l.linha, item, estado: 'erro', mensagens: [`Linha ${l.linha} (item ${item}): item repetido na planilha. Deixe uma linha por item.`], mudancas: {}, dados: null }); continue; }
      vistos.add(item);
      resultado.push(conferirLinha(l, porId.get(item)));
    }
    const resumo = { novo: 0, alterado: 0, sem_mudanca: 0, erro: 0 };
    for (const r of resultado) resumo[r.estado] += 1;
    return { ok: resumo.erro === 0 && resultado.length > 0, linhas: resultado, erros: resultado.flatMap((r) => r.mensagens), resumo };
  }

  // Texto canônico (até 4 casas) → "N.NNNN", formato de validarLote (extensão) e do floor de createMotor (robô).
  function quatroCasas(texto) {
    const [i, f = ''] = String(texto).split('.');
    return `${i}.${f.padEnd(4, '0')}`;
  }

  const api = { COLUNAS, MAX_LINHAS, MAX_BYTES, gerarCsv, lerCsv, validarLinhas, quatroCasas, registros, celula };
  global.LicitaPlanilhaItens = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
