/* global module, require, TextEncoder, FormData, URL, Blob */
// Catálogo de produtos da empresa (operacao.html > Catálogo de produtos) e resumo custos × vendas (Prontidão e relatório).
// Tabela: supabase/operacao_catalogo_produtos.sql (RLS: leitura = quem acessa a empresa; escrita = gestor/operador).
// Planilha CSV no mesmo padrão de planilha-itens.js (BOM, ';', CRLF, aspas RFC 4180, decimal com vírgula, antifórmula).
// Importação é tudo ou nada: um único upsert (uma transação no PostgREST).
(function (global) {
  'use strict';
  const nodeJs = typeof module !== 'undefined' && module.exports;
  const planilha = nodeJs ? require('./planilha-itens.js') : global.LicitaPlanilhaItens;
  const perfil = nodeJs ? require('./perfil-empresa.js') : global.PerfilEmpresa;

  const COLUNAS = ['id', 'codigo_interno', 'nome', 'descricao', 'marca', 'modelo', 'fabricante', 'unidade', 'custo_unitario', 'fornecedor_nome', 'fornecedor_contato', 'ativo'];
  // Mesmos limites do SQL.
  const LIMITES = { codigo_interno: 60, nome: 300, descricao: 5000, marca: 200, modelo: 200, fabricante: 500, unidade: 100, fornecedor_nome: 200, fornecedor_contato: 300 };
  const MAX_LINHAS = 5000;
  const MAX_BYTES = 2 * 1024 * 1024;
  const FOTO = Object.freeze({ bytes: 1024 * 1024, px: 2000, lado: 1200 });
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // eslint-disable-next-line no-control-regex -- recusa caracteres de controle (exceto quebra de linha na descrição)
  const CONTROLE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

  // ---------- dinheiro ----------
  const centavos = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  const reais = (c) => (c === null ? '' : `${Math.trunc(c / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`);
  const virgula = (v) => (v === null || v === undefined || v === '' ? '' : reais(centavos(v)).replace('.', ','));
  // "12,5" / "12.50" → "12.50"; separador de milhar recusado (igual à planilha de itens).
  function lerCusto(t) {
    if (!/^\d{1,13}([.,]\d{1,2})?$/.test(t)) return null;
    const [i, f = ''] = t.split(/[.,]/);
    return `${i.replace(/^0+(?=\d)/, '')}.${f.padEnd(2, '0')}`;
  }

  // ---------- sugestão por semelhança de descrição ----------
  const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'para', 'com', 'sem', 'por', 'ou', 'um', 'uma', 'tipo', 'cor', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'as', 'os', 'und', 'un', 'unidade']);
  const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Plural simples ("canetas" = "caneta"); suficiente para descrição de edital.
  const tokens = (t) => new Set(normalizar(t).split(' ').filter((p) => p.length > 1 && !STOP.has(p)).map((p) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p)));
  // Pontuação = quanto do nome do produto aparece na descrição do item (0..1), + 0,1 se marca ou modelo aparecem.
  // Só ativos, mínimo de metade do nome coberto; ordem: pontuação, depois mais palavras em comum.
  function sugerirProdutos(descricaoItem, catalogo, limite = 5) {
    const item = tokens(descricaoItem);
    if (!item.size) return [];
    const out = [];
    for (const produto of catalogo || []) {
      if (produto.ativo === false) continue;
      const nome = tokens(produto.nome);
      if (!nome.size) continue;
      const comuns = [...nome].filter((p) => item.has(p)).length;
      const cobertura = comuns / nome.size;
      if (cobertura < 0.5) continue;
      const extra = [...tokens(`${produto.marca || ''} ${produto.modelo || ''}`)].some((p) => item.has(p)) ? 0.1 : 0;
      out.push({ produto, pontuacao: Math.round(Math.min(1, cobertura + extra) * 100) / 100, comuns });
    }
    return out.sort((a, b) => b.pontuacao - a.pontuacao || b.comuns - a.comuns).slice(0, limite).map(({ produto, pontuacao }) => ({ produto, pontuacao }));
  }
  // Campos que o "Usar do catálogo" preenche no item (só os informados no produto; custo 0 não vale como custo).
  function camposParaItem(p) {
    const c = {};
    if (centavos(p.custo_unitario) > 0) c.custoUnitario = reais(centavos(p.custo_unitario));
    for (const [de, para] of [['marca', 'marca'], ['modelo', 'modelo'], ['fabricante', 'fabricante']]) if (p[de]) c[para] = p[de];
    return c;
  }

  // ---------- planilha ----------
  function gerarCsv(produtos) {
    const linhas = [COLUNAS.join(';')];
    for (const p of produtos || []) {
      linhas.push(COLUNAS.map((c) => (c === 'custo_unitario' ? virgula(p.custo_unitario) : c === 'ativo' ? (p.ativo === false ? 'nao' : 'sim') : p[c])).map(planilha.celula).join(';'));
    }
    return `FEFF${linhas.join('\r\n')}\r\n`;
  }
  const semApostrofo = (t) => (/^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t);
  function lerCsv(texto) {
    const falha = (erro) => ({ ok: false, erros: [erro], linhas: [] });
    if (typeof texto !== 'string') return falha('Arquivo de planilha inválido.');
    if (new TextEncoder().encode(texto).length > MAX_BYTES) return falha('A planilha passa de 2 MB. Divida em arquivos menores.');
    const r = planilha.registros(texto.replace(/^FEFF/, ''));
    if (r.erro) return falha(r.erro);
    const [cab, ...resto] = r.registros;
    if (!cab || cab.map((c) => c.trim().toLowerCase()).join(';') !== COLUNAS.join(';')) {
      return falha(`O cabeçalho precisa ser exatamente: ${COLUNAS.join(';')}. Baixe a planilha do catálogo e preencha nela.`);
    }
    const dados = resto.map((valores, k) => ({ linha: k + 2, valores })).filter((l) => l.valores.some((v) => v.trim() !== ''));
    if (dados.length > MAX_LINHAS) return falha(`A planilha tem ${dados.length} produtos; o limite é ${MAX_LINHAS}.`);
    const erros = [], linhas = [];
    for (const { linha, valores } of dados) {
      if (valores.length !== COLUNAS.length) { erros.push(`Linha ${linha}: esperadas ${COLUNAS.length} colunas, encontradas ${valores.length}. Confira se há ";" sobrando ou faltando.`); continue; }
      linhas.push({ linha, valores: Object.fromEntries(COLUNAS.map((c, k) => [c, semApostrofo(valores[k].trim())])) });
    }
    return { ok: erros.length === 0, erros, linhas };
  }
  // Mesma regra para formulário e planilha. Devolve { erros, dados } com valores já no formato do banco.
  function validarProduto(campos) {
    const erros = [], dados = {};
    for (const [c, max] of Object.entries(LIMITES)) {
      const v = String(campos[c] ?? '').trim();
      if (v.length > max || (c !== 'descricao' && /[\r\n]/.test(v)) || CONTROLE.test(v)) erros.push(`Confira ${c.replace('_', ' ')} (até ${max} caracteres, sem caracteres de controle).`);
      dados[c] = v || null;
    }
    if (!dados.nome) erros.push('Informe o nome do produto.');
    const custo = String(campos.custo_unitario ?? '').trim();
    dados.custo_unitario = custo ? lerCusto(custo) : null;
    if (custo && dados.custo_unitario === null) erros.push(`Custo "${custo}": use só números, com vírgula para os centavos (até 2 casas). Ex.: 1234,56`);
    const ativo = normalizar(campos.ativo ?? 'sim');
    if (!['sim', 'nao', ''].includes(ativo)) erros.push('Ativo: escreva sim ou nao.');
    dados.ativo = ativo !== 'nao';
    return { erros, dados };
  }
  // Preço de referência vindo do "Buscar no mercado": só grava com fonte e data (o SQL exige os três juntos).
  function validarReferencia(r) {
    if (!r || r.preco_referencia === null || r.preco_referencia === undefined) return null;
    const preco = lerCusto(String(r.preco_referencia));
    const fonte = String(r.referencia_fonte ?? '').trim();
    const em = String(r.referencia_em ?? '');
    if (!preco || centavos(preco) <= 0 || !fonte || fonte.length > 300 || CONTROLE.test(fonte) || /[\r\n]/.test(fonte) || !/^\d{4}-\d{2}-\d{2}$/.test(em)) return null;
    return { preco_referencia: preco, referencia_fonte: fonte, referencia_em: em };
  }
  const igual = (c, a, b) => (c === 'custo_unitario' ? centavos(a) === centavos(b) : (a ?? null) === (b ?? null));
  // Chave: id (exportado pelo sistema) > código interno > produto novo. Célula vazia não altera (igual à planilha de itens).
  function validarLinhas(linhas, atuais) {
    const porId = new Map((atuais || []).map((p) => [p.id, p]));
    const porCodigo = new Map((atuais || []).filter((p) => p.codigo_interno).map((p) => [p.codigo_interno, p]));
    const vistos = new Set(), resultado = [];
    for (const { linha, valores } of linhas || []) {
      const msg = (m) => resultado.push({ linha, estado: 'erro', mensagens: [`Linha ${linha}: ${m}`], dados: null });
      if (valores.id && !UUID.test(valores.id)) { msg('o id não é deste sistema. Deixe a coluna id vazia para produto novo.'); continue; }
      const atual = valores.id ? porId.get(valores.id) : valores.codigo_interno ? porCodigo.get(valores.codigo_interno) : undefined;
      if (valores.id && !atual) { msg('produto não encontrado nesta empresa. Deixe a coluna id vazia para cadastrar como novo.'); continue; }
      const chave = atual?.id || (valores.codigo_interno ? `codigo:${valores.codigo_interno}` : null);
      if (chave && vistos.has(chave)) { msg('produto repetido na planilha. Deixe uma linha por produto.'); continue; }
      if (chave) vistos.add(chave);
      const campos = { ...(atual || {}), ...Object.fromEntries(Object.entries(valores).filter(([c, v]) => c !== 'id' && v !== '')) };
      if (atual && valores.custo_unitario === '') campos.custo_unitario = virgula(atual.custo_unitario);
      if (atual && valores.ativo === '') campos.ativo = atual.ativo === false ? 'nao' : 'sim';
      const { erros, dados } = validarProduto(campos);
      if (erros.length) { resultado.push({ linha, estado: 'erro', mensagens: erros.map((e) => `Linha ${linha}: ${e}`), dados: null }); continue; }
      const mudou = !atual || Object.keys(dados).some((c) => !igual(c, dados[c], atual[c]));
      resultado.push({ linha, estado: !atual ? 'novo' : mudou ? 'alterado' : 'sem_mudanca', mensagens: [], dados: atual ? { id: atual.id, ...dados } : dados });
    }
    const resumo = { novo: 0, alterado: 0, sem_mudanca: 0, erro: 0 };
    for (const r of resultado) resumo[r.estado] += 1;
    return { ok: resumo.erro === 0 && resultado.length > 0, linhas: resultado, erros: resultado.flatMap((r) => r.mensagens), resumo };
  }

  // ---------- foto ----------
  function validarFoto(bytes) {
    if (bytes.length > FOTO.bytes) return { erro: 'A foto deve ter no máximo 1 MB.' };
    const img = perfil.dimensoesLogo(bytes);
    if (!img) return { erro: 'Envie a foto em PNG ou JPEG.' };
    if (!img.largura || !img.altura || img.largura > FOTO.px || img.altura > FOTO.px) return { erro: 'A foto deve ter no máximo 2000 px de largura e de altura.' };
    return img;
  }
  const caminhoFoto = (org, empresa, hash, ext) => `${org}/${empresa}/catalogo/${hash}.${ext}`;

  // ---------- resumo custos × vendas ----------
  // Itens ganhos (operacao_itens_resultado situacao='ganho' com o processo embutido). Vendido = total homologado do item,
  // ou unitário homologado × quantidade. Custo = custo unitário × quantidade. Processo com item sem custo (ou sem valor)
  // fica fora do lucro e aparece como tal: nunca lucro estimado (erro do PrecificaJá: 87,6% de lucro sem custo).
  function resumoCustosVendas(itens, processosVitoria = []) {
    const porProcesso = new Map();
    for (const i of itens || []) {
      if (i.situacao && i.situacao !== 'ganho') continue;
      const p = i.processo || i.operacao_processos || {};
      const id = i.processo_id || p.id;
      if (!porProcesso.has(id)) porProcesso.set(id, { id, rotulo: p.numero || p.objeto || 'Processo sem número', vendido: 0, custo: 0, semValor: 0, semCusto: 0, itens: 0 });
      const r = porProcesso.get(id);
      const qtd = i.quantidade === null || i.quantidade === undefined || i.quantidade === '' ? null : Number(i.quantidade);
      const vendido = centavos(i.valor_homologado) ?? (qtd === null || centavos(i.valor_unitario_homologado) === null ? null : Math.round(centavos(i.valor_unitario_homologado) * qtd));
      const custo = qtd === null || centavos(i.custo_unitario) === null ? null : Math.round(centavos(i.custo_unitario) * qtd);
      r.itens += 1;
      if (vendido === null) r.semValor += 1; else r.vendido += vendido;
      if (custo === null) r.semCusto += 1; else r.custo += custo;
    }
    for (const p of processosVitoria) {
      if (!porProcesso.has(p.id)) porProcesso.set(p.id, { id: p.id, rotulo: p.numero || p.objeto || 'Processo sem número', vendido: 0, custo: 0, semValor: 0, semCusto: 0, itens: 0 });
    }
    const margem = (lucro, vendido) => (vendido > 0 ? Math.round((lucro / vendido) * 1000) / 10 : null);
    const t = { vendido: 0, vendidoComCusto: 0, custo: 0, lucro: 0, margem: null, completos: 0, semCusto: 0, vendidoSemCusto: 0, semValor: 0, semItens: 0 };
    const processos = [...porProcesso.values()].map((r) => {
      const situacao = !r.itens ? 'sem_itens' : r.semValor ? 'sem_valor' : r.semCusto ? 'sem_custo' : 'completo';
      const completo = situacao === 'completo';
      t.vendido += r.vendido;
      if (completo) { t.completos += 1; t.vendidoComCusto += r.vendido; t.custo += r.custo; t.lucro += r.vendido - r.custo; }
      else if (situacao === 'sem_custo') { t.semCusto += 1; t.vendidoSemCusto += r.vendido; }
      else if (situacao === 'sem_valor') t.semValor += 1;
      else t.semItens += 1;
      return { id: r.id, rotulo: r.rotulo, situacao, vendido: r.vendido, custo: completo ? r.custo : null, lucro: completo ? r.vendido - r.custo : null, margem: completo ? margem(r.vendido - r.custo, r.vendido) : null };
    });
    t.margem = t.completos ? margem(t.lucro, t.vendidoComCusto) : null;
    if (!t.completos) { t.custo = null; t.lucro = null; }
    return { processos, totais: t };
  }

  // ---------- tela ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const brl = (c) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const CAMPOS_FORM = [['nome', 'Nome do produto', 'inteiro'], ['descricao', 'Descrição', 'inteiro'], ['marca', 'Marca'], ['modelo', 'Modelo'], ['fabricante', 'Fabricante'], ['unidade', 'Unidade'],
    ['custo_unitario', 'Custo unitário (R$)'], ['codigo_interno', 'Código interno'], ['fornecedor_nome', 'Fornecedor'], ['fornecedor_contato', 'Contato do fornecedor']];

  // sb = cliente Supabase da página. abrir({ orgId, empresaId }) recarrega para a empresa ativa.
  function montar({ alvo, sb, doc = global.document }) {
    const estado = { orgId: null, empresaId: null, produtos: [], busca: '', editando: null, foto: null, importacao: null, referencia: null, mercado: null };
    const $ = (s) => alvo.querySelector(s);
    alvo.innerHTML = `<div class="card-topo"><div><h2>Catálogo de produtos</h2><p>Cadastre uma vez custo, marca, modelo e fornecedor. No preço por item do processo, "Usar do catálogo" preenche esses campos.</p></div>
      <div class="pdf-acoes"><button class="btn" data-acao="exportar">Baixar planilha</button><label class="btn">Importar planilha<input type="file" accept=".csv,text/csv" data-acao="importar" hidden></label><button class="btn" data-acao="mercado" aria-expanded="false">Buscar no mercado (Compras.gov)</button><button class="btn primario" data-acao="novo">+ Produto</button></div></div>
      <section class="catalogo-mercado card" hidden aria-label="Buscar no mercado"><h2>Buscar no mercado (Compras.gov)</h2><p class="nota">Produtos que órgãos públicos já compraram, com a marca declarada e o preço pago. "Adicionar ao catálogo" preenche nome, marca, modelo, unidade e o preço de referência; o custo continua sendo o do seu fornecedor.</p><div class="catalogo-mercado-busca"></div></section>
      <input type="search" class="catalogo-busca" placeholder="Buscar por nome, marca, modelo ou código" aria-label="Buscar no catálogo" style="width:100%;margin:6px 0 10px">
      <div class="catalogo-importacao" aria-live="polite"></div><form class="catalogo-form card" hidden></form>
      <p class="nota catalogo-status" aria-live="polite"></p><div class="tabela-wrap"><table class="tabela"><thead><tr><th>Produto</th><th>Marca / modelo</th><th>Unidade</th><th>Custo</th><th>Fornecedor</th><th>Situação</th><th></th></tr></thead><tbody class="catalogo-lista"></tbody></table></div>`;
    const status = (t) => { $('.catalogo-status').textContent = t; };

    function filtrados() {
      const q = normalizar(estado.busca);
      return estado.produtos.filter((p) => !q || normalizar([p.nome, p.marca, p.modelo, p.codigo_interno, p.fabricante].join(' ')).includes(q));
    }
    function desenharLista() {
      const lista = filtrados();
      $('.catalogo-lista').innerHTML = lista.length ? lista.map((p) => `<tr><td><strong>${esc(p.nome)}</strong>${p.codigo_interno ? `<br><span class="nota">Cód. ${esc(p.codigo_interno)}</span>` : ''}${p.foto_caminho ? '<br><span class="nota">Com foto</span>' : ''}</td>
        <td>${esc([p.marca, p.modelo].filter(Boolean).join(' / ') || '—')}${p.fabricante ? `<br><span class="nota">${esc(p.fabricante)}</span>` : ''}</td><td>${esc(p.unidade || '—')}</td>
        <td>${p.custo_unitario === null || p.custo_unitario === undefined ? '<span class="tag pendente">Sem custo</span>' : esc(brl(centavos(p.custo_unitario)))}${p.preco_referencia ? `<br><span class="nota" title="${esc(p.referencia_fonte)}">Ref. mercado ${esc(brl(centavos(p.preco_referencia)))}</span>` : ''}</td>
        <td>${esc(p.fornecedor_nome || '—')}${p.fornecedor_contato ? `<br><span class="nota">${esc(p.fornecedor_contato)}</span>` : ''}</td>
        <td><span class="tag ${p.ativo === false ? 'pendente' : 'valido'}">${p.ativo === false ? 'Inativo' : 'Ativo'}</span></td><td><button class="btn" data-editar="${esc(p.id)}">Editar</button></td></tr>`).join('')
        : `<tr><td colspan="7" class="vazio">${estado.produtos.length ? 'Nenhum produto encontrado nesta busca.' : 'Nenhum produto no catálogo. Use "+ Produto" ou importe uma planilha.'}</td></tr>`;
      status(`${estado.produtos.length} produto(s) no catálogo${estado.busca ? ` · ${lista.length} na busca` : ''}.`);
    }
    async function carregar() {
      if (!estado.empresaId) return;
      const { data, error } = await sb.from('operacao_catalogo_produtos').select('*').eq('empresa_id', estado.empresaId).order('nome').limit(MAX_LINHAS);
      if (error) { status(`Catálogo indisponível: ${error.message}`); return; }
      estado.produtos = data || [];
      desenharLista();
    }
    // p sem id = rascunho (ex.: vindo do "Buscar no mercado"): formulário de produto novo já preenchido.
    function abrirForm(p) {
      estado.editando = p?.id ? p : null; estado.foto = null;
      estado.referencia = p && !p.id ? validarReferencia(p) : null;
      const ref = estado.referencia || (p?.preco_referencia ? p : null);
      const f = $('.catalogo-form');
      f.hidden = false;
      f.innerHTML = `<h2>${p?.id ? 'Editar produto' : 'Novo produto'}</h2>${ref ? `<p class="nota catalogo-referencia">Preço de referência do mercado: <strong>${esc(brl(centavos(ref.preco_referencia)))}</strong> · ${esc(ref.referencia_fonte)} · ${esc(String(ref.referencia_em || '').split('-').reverse().join('/'))}. Não é o seu custo: informe abaixo quanto o seu fornecedor cobra.</p>` : ''}<div class="form-grade">${CAMPOS_FORM.map(([c, rot, cls]) => `<div class="${cls || ''}"><label for="cat-${c}">${rot}</label>${c === 'descricao'
        ? `<textarea id="cat-${c}" name="${c}" rows="2" maxlength="${LIMITES[c]}">${esc(p?.[c])}</textarea>`
        : `<input id="cat-${c}" name="${c}" ${c === 'custo_unitario' ? 'inputmode="decimal" placeholder="0,00"' : `maxlength="${LIMITES[c]}"`} ${c === 'nome' ? 'required' : ''} value="${esc(c === 'custo_unitario' ? virgula(p?.[c]) : p?.[c])}">`}</div>`).join('')}
        <div class="inteiro"><label for="cat-foto">Foto (opcional)</label><input id="cat-foto" type="file" accept="image/png,image/jpeg"><img class="catalogo-foto" alt="Foto do produto" hidden style="max-width:160px;max-height:160px;margin-top:6px"><p class="nota">Fica no armazenamento privado da empresa. Fotos grandes são reduzidas no seu navegador.</p></div>
        <div><label><input type="checkbox" name="ativo" ${p?.ativo === false ? '' : 'checked'}> Ativo (aparece nas sugestões)</label></div></div>
        <p class="nota catalogo-form-erro" role="alert"></p><div class="modal-rodape"><button type="button" class="btn" data-acao="cancelar">Cancelar</button><button class="btn primario">Salvar produto</button></div>`;
      f.querySelector('#cat-nome').focus();
      if (p?.foto_caminho) mostrarFotoSalva(p.foto_caminho);
    }
    async function mostrarFotoSalva(caminho) {
      const { data, error } = await sb.storage.from('operacao-documentos').download(caminho);
      if (error || !data) return;
      const bytes = new Uint8Array(await data.arrayBuffer());
      const img = $('.catalogo-foto');
      if (img) { img.src = perfil.dataUrlLogo(bytes, /\.png$/.test(caminho) ? 'png' : 'jpg'); img.hidden = false; }
    }
    // Foto grande do celular vira JPEG de até 1200 px antes de conferir (o dono não precisa redimensionar à mão).
    async function prepararFoto(arquivo) {
      let bytes = new Uint8Array(await arquivo.arrayBuffer());
      if (bytes.length > FOTO.bytes && global.createImageBitmap) {
        const bmp = await global.createImageBitmap(arquivo);
        const escala = Math.min(1, FOTO.lado / Math.max(bmp.width, bmp.height));
        const canvas = doc.createElement('canvas');
        canvas.width = Math.round(bmp.width * escala); canvas.height = Math.round(bmp.height * escala);
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
        bytes = new Uint8Array(await blob.arrayBuffer());
      }
      const img = validarFoto(bytes);
      if (img.erro) throw new Error(img.erro);
      return { bytes, ext: img.ext };
    }
    async function salvarForm(ev) {
      ev.preventDefault();
      // O ouvinte fica no alvo (delegação): o formulário é ev.target, não ev.currentTarget (que é o div e quebrava o FormData).
      const f = ev.target, erro = f.querySelector('.catalogo-form-erro'), botao = f.querySelector('button.primario');
      const campos = Object.fromEntries(new FormData(f));
      campos.ativo = f.querySelector('[name="ativo"]').checked ? 'sim' : 'nao';
      const { erros, dados } = validarProduto(campos);
      if (erros.length) { erro.textContent = erros.join(' '); return; }
      botao.disabled = true;
      try {
        if (estado.foto) {
          const hash = await perfil.sha256Hex(estado.foto.bytes);
          const caminho = caminhoFoto(estado.orgId, estado.empresaId, hash, estado.foto.ext);
          const { error } = await sb.storage.from('operacao-documentos').upload(caminho, estado.foto.bytes, { upsert: false, contentType: estado.foto.ext === 'png' ? 'image/png' : 'image/jpeg' });
          // Mesmo hash = mesma foto já enviada: só registrar.
          if (error && !/exist|duplicate/i.test(error.message || '')) throw error;
          Object.assign(dados, { foto_caminho: caminho, foto_hash: hash });
        }
        if (!estado.editando && estado.referencia) Object.assign(dados, estado.referencia);
        const q = estado.editando
          ? sb.from('operacao_catalogo_produtos').update(dados).eq('id', estado.editando.id)
          : sb.from('operacao_catalogo_produtos').insert({ organizacao_id: estado.orgId, empresa_id: estado.empresaId, ...dados });
        const { error } = await q;
        if (error) throw error;
      } catch (e) {
        erro.textContent = /row-level|permission|42501/i.test(e.message || '') ? 'Seu papel nesta empresa é só de leitura: peça a um gestor para cadastrar.'
          : /codigo_idx|duplicate key/i.test(e.message || '') ? 'Já existe um produto com este código interno.' : `Não foi possível salvar: ${e.message}`;
        botao.disabled = false;
        return;
      }
      f.hidden = true; estado.editando = null; estado.referencia = null;
      await carregar();
      status('Produto salvo.');
    }
    function alternarMercado(botao) {
      const caixa = $('.catalogo-mercado');
      caixa.hidden = !caixa.hidden;
      botao.setAttribute('aria-expanded', String(!caixa.hidden));
      if (caixa.hidden) return;
      if (!estado.mercado && global.MercadoComprasGov) {
        estado.mercado = global.MercadoComprasGov.montar({ alvo: $('.catalogo-mercado-busca'), doc, rotuloUsar: 'Adicionar ao catálogo',
          aoUsar: (item, resumo) => { abrirForm(global.MercadoComprasGov.produtoParaCatalogo(item, resumo)); $('.catalogo-form').scrollIntoView?.({ block: 'start' }); } });
      }
      estado.mercado?.campo.focus();
    }
    function exportar() {
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(new Blob([gerarCsv(estado.produtos)], { type: 'text/csv;charset=utf-8' }));
      a.download = 'catalogo-produtos.csv'; a.click(); URL.revokeObjectURL(a.href);
    }
    async function importar(arquivo) {
      const caixa = $('.catalogo-importacao');
      const lido = lerCsv(await arquivo.text());
      const v = lido.ok ? validarLinhas(lido.linhas, estado.produtos) : { ok: false, erros: lido.erros, resumo: null, linhas: [] };
      estado.importacao = v.ok ? v : null;
      caixa.innerHTML = `<div class="card"><h2>Prévia da importação</h2>${v.resumo ? `<p>${v.resumo.novo} novo(s), ${v.resumo.alterado} alterado(s), ${v.resumo.sem_mudanca} sem mudança, ${v.resumo.erro} com erro.</p>` : ''}
        ${v.erros.length ? `<ul class="nota">${v.erros.slice(0, 50).map((e) => `<li>${esc(e)}</li>`).join('')}</ul><p class="nota">Nada foi gravado. Corrija a planilha e importe de novo.</p>` : ''}
        <div class="modal-rodape"><button type="button" class="btn" data-acao="fechar-importacao">Fechar</button>${v.ok && (v.resumo.novo + v.resumo.alterado) ? '<button type="button" class="btn primario" data-acao="confirmar-importacao">Confirmar importação</button>' : ''}</div></div>`;
    }
    async function confirmarImportacao(botao) {
      const linhas = estado.importacao.linhas.filter((l) => l.estado === 'novo' || l.estado === 'alterado');
      const base = { codigo_interno: null, descricao: null, marca: null, modelo: null, fabricante: null, unidade: null, custo_unitario: null, fornecedor_nome: null, fornecedor_contato: null };
      // Mesmas chaves em todas as linhas: o upsert em lote do PostgREST exige.
      const lote = linhas.map((l) => ({ ...base, id: l.dados.id || global.crypto.randomUUID(), organizacao_id: estado.orgId, empresa_id: estado.empresaId, ...l.dados }));
      botao.disabled = true;
      const { error } = await sb.from('operacao_catalogo_produtos').upsert(lote, { onConflict: 'id' });
      if (error) { $('.catalogo-importacao').insertAdjacentHTML('beforeend', `<p class="nota" role="alert">Nada foi gravado: ${esc(error.message)}</p>`); botao.disabled = false; return; }
      $('.catalogo-importacao').innerHTML = ''; estado.importacao = null;
      await carregar();
      status(`Importação concluída: ${lote.length} produto(s) gravado(s).`);
    }

    alvo.addEventListener('click', (e) => {
      const acao = e.target.closest('[data-acao]')?.dataset.acao, editar = e.target.closest('[data-editar]')?.dataset.editar;
      if (editar) abrirForm(estado.produtos.find((p) => p.id === editar));
      else if (acao === 'novo') abrirForm(null);
      else if (acao === 'mercado') alternarMercado(e.target.closest('[data-acao]'));
      else if (acao === 'cancelar') { $('.catalogo-form').hidden = true; estado.editando = null; estado.referencia = null; }
      else if (acao === 'exportar') exportar();
      else if (acao === 'fechar-importacao') { $('.catalogo-importacao').innerHTML = ''; estado.importacao = null; }
      else if (acao === 'confirmar-importacao') confirmarImportacao(e.target);
    });
    alvo.addEventListener('change', async (e) => {
      if (e.target.dataset.acao === 'importar' && e.target.files[0]) { await importar(e.target.files[0]); e.target.value = ''; }
      if (e.target.id === 'cat-foto' && e.target.files[0]) {
        const erro = $('.catalogo-form-erro');
        try {
          estado.foto = await prepararFoto(e.target.files[0]);
          const img = $('.catalogo-foto'); img.src = perfil.dataUrlLogo(estado.foto.bytes, estado.foto.ext); img.hidden = false; erro.textContent = '';
        } catch (x) { estado.foto = null; erro.textContent = x.message; e.target.value = ''; }
      }
    });
    // Só o formulário do produto: a busca do mercado tem o próprio submit dentro do mesmo alvo.
    alvo.addEventListener('submit', (ev) => { if (ev.target.classList?.contains('catalogo-form')) salvarForm(ev); });
    $('.catalogo-busca').addEventListener('input', (e) => { estado.busca = e.target.value; desenharLista(); });

    return {
      abrir({ orgId, empresaId }) { Object.assign(estado, { orgId, empresaId, produtos: [], busca: '' }); $('.catalogo-busca').value = ''; $('.catalogo-form').hidden = true; $('.catalogo-importacao').innerHTML = ''; return carregar(); },
      produtos: () => estado.produtos,
    };
  }

  // Cartão "Custos × vendas" (Prontidão e relatório). Só lê: itens ganhos e processos com vitória da empresa ativa.
  async function carregarResumo({ alvo, sb, empresaId }) {
    alvo.innerHTML = '<p class="nota">Carregando…</p>';
    const [itens, procs] = await Promise.all([
      sb.from('operacao_itens_resultado').select('processo_id,situacao,quantidade,valor_homologado,valor_unitario_homologado,custo_unitario,operacao_processos!inner(id,numero,objeto,empresa_id)')
        .eq('situacao', 'ganho').eq('operacao_processos.empresa_id', empresaId).limit(10000),
      sb.from('operacao_processos').select('id,numero,objeto').eq('empresa_id', empresaId).in('situacao_resultado', ['vitoria_total', 'vitoria_parcial']).limit(2000),
    ]);
    if (itens.error || procs.error) { alvo.innerHTML = `<p class="nota">Resumo indisponível: ${esc((itens.error || procs.error).message)}</p>`; return null; }
    const r = resumoCustosVendas(itens.data, procs.data);
    desenharResumo(alvo, r);
    return r;
  }
  function desenharResumo(alvo, { processos, totais: t }) {
    if (!processos.length) { alvo.innerHTML = '<p class="nota">Nenhum processo ganho ou item ganho registrado nesta empresa.</p>'; return; }
    const ROT = { completo: '', sem_custo: '<span class="tag pendente">Sem custo informado</span>', sem_valor: '<span class="tag pendente">Sem valor homologado</span>', sem_itens: '<span class="tag pendente">Itens ganhos não detalhados</span>' };
    alvo.innerHTML = `<div class="form-grade"><div><span class="nota">Valor vendido (todos os processos ganhos)</span><br><strong>${brl(t.vendido)}</strong></div>
      <div><span class="nota">Vendido com custo informado (base do lucro)</span><br><strong>${brl(t.vendidoComCusto)}</strong></div>
      <div><span class="nota">Custo (processos com custo)</span><br><strong>${brl(t.custo)}</strong></div>
      <div><span class="nota">Lucro bruto</span><br><strong>${brl(t.lucro)}</strong></div><div><span class="nota">Margem</span><br><strong>${t.margem === null ? '—' : `${String(t.margem).replace('.', ',')}%`}</strong></div></div>
      ${t.semCusto ? `<p class="nota">${t.semCusto} processo(s) sem custo informado (${brl(t.vendidoSemCusto)} vendidos) ficam fora do lucro e da margem. Informe o custo por item no processo.</p>` : ''}
      <p class="nota rolar-dica">Arraste a tabela para o lado para ver custo, lucro e margem.</p>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Processo</th><th>Vendido</th><th>Custo</th><th>Lucro</th><th>Margem</th></tr></thead><tbody>${processos.map((p) => `<tr><td>${esc(p.rotulo)}${ROT[p.situacao] ? `<br>${ROT[p.situacao]}` : ''}</td><td>${brl(p.vendido)}</td><td>${brl(p.custo)}</td><td>${brl(p.lucro)}</td><td>${p.margem === null ? '—' : `${String(p.margem).replace('.', ',')}%`}</td></tr>`).join('')}</tbody></table></div>`;
  }

  const api = { COLUNAS, MAX_LINHAS, FOTO, normalizar, sugerirProdutos, camposParaItem, gerarCsv, lerCsv, validarProduto, validarReferencia, validarLinhas, validarFoto, caminhoFoto, resumoCustosVendas, montar, carregarResumo, desenharResumo };
  global.CatalogoProdutos = api;
  if (nodeJs) module.exports = api;
})(globalThis);
