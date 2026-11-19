/* global module, require, TextDecoder, Blob, URL, URLSearchParams */
// Cadastro e edição de itens do processo, na casca comercial. Regras espelham o servidor (_itens_processo.js)
// só para feedback imediato; a validação real e a gravação ficam no servidor, com o token do usuário.
// Escopo fixo: empresa e processo do contexto montado. Resposta de outro cadastro é descartada.
// Preço por item (premissas, custo, alvo/limite, referência Compras.gov, simulador) e planilha CSV usam
// precificacao-item.js e planilha-itens.js. Ordem de carga no navegador: precificacao-item.js, este arquivo, planilha-itens.js.
(function (global) {
  'use strict';
  const LIMITE = 999999999999999n; // mesmo limite de escala do kit (decimal() em _kit_documentos.js)
  // eslint-disable-next-line no-control-regex -- remove caracteres de controle de texto digitado
  const CONTROLE = /[\u0000-\u001f\u007f]/;
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const MSG = {
    carregando: 'Carregando itens…',
    erroCarregar: 'Não foi possível carregar os itens. Use Atualizar itens para tentar de novo.',
    salvo: 'Item salvo. Para incluí-lo na proposta, use Atualizar lista na área de proposta.',
    editando: 'Ao salvar, uma revisão já confirmada desta proposta deixa de valer. Prepare e confirme de novo antes de exportar.',
    divergente: 'Resposta de outro cadastro descartada. Recarregue a página.',
    conexao: 'Não foi possível salvar agora. Tente de novo; o mesmo cadastro não será duplicado.',
    numeroImportar: 'Informe o número do item no edital (só números, de 1 a 1000000). Ex.: 3',
    importando: 'Importando item do PNCP…',
    importado: 'Item importado do PNCP. Informe sua oferta (valor unitário) editando o item.',
    inalterado: 'Este item já estava importado e não mudou no PNCP. Nada foi alterado.',
    desligada: 'A importação de itens do PNCP ainda não está ligada. Cadastre o item pelo formulário acima.',
    erroImportar: 'Não foi possível importar o item. Tente de novo em instantes.',
    semReferencia: 'Sem referência automática',
    semPrecos: 'Sem preços para esta unidade. Tente outra unidade na Pesquisa de Preços.',
    erroReferencia: 'A Pesquisa de Preços não respondeu agora. Use Buscar de novo em instantes.',
  };
  // Mesmo texto que o handler importar-item-pncp devolve quando IMPORTACAO_PNCP_LOCAL não está ligada (503).
  const ERRO_DESLIGADA = 'Importação rastreável ainda não habilitada.';
  // Carga preguiçosa: planilha-itens.js exige este arquivo no topo (no servidor e no navegador).
  const modulo = (nome, arquivo) => global[nome] || (typeof module !== 'undefined' && module.exports ? require(arquivo) : null);
  const P = () => modulo('LicitaPrecificacao', './precificacao-item.js');
  const planilha = () => modulo('LicitaPlanilhaItens', './planilha-itens.js');

  // Número do item no edital, mesmo limite do handler (inteiro de 1 a 1000000). Inválido: null.
  function numeroItemImportacao(textoDigitado) {
    const t = typeof textoDigitado === 'string' ? textoDigitado.trim() : '';
    if (!/^[1-9][0-9]{0,6}$/.test(t)) return null;
    const n = Number(t);
    return n <= 1000000 ? n : null;
  }
  // Resposta de /api/importar-item-pncp → { ok, texto }. Mensagem do servidor só como texto curto.
  function respostaImportacao(status, j) {
    const msg = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : '');
    if (status === 200 && j && typeof j.itemId === 'string') {
      if (j.estado === 'inalterado') return { ok: true, texto: MSG.inalterado };
      return { ok: true, texto: msg(j.mensagem) || MSG.importado };
    }
    if (status === 503 && j?.erro === ERRO_DESLIGADA) return { ok: false, texto: MSG.desligada };
    return { ok: false, texto: msg(j?.erro) || MSG.erroImportar };
  }

  // Decimal canônico, positivo e dentro do limite. Retorna BigInt escalado ou null.
  function decimalPositivo(texto, escala) {
    if (typeof texto !== 'string' || !new RegExp(`^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,${escala}})?$`).test(texto)) return null;
    const [inteiro, fracao = ''] = texto.split('.');
    const n = BigInt(inteiro + fracao.padEnd(escala, '0'));
    return n > 0n && n <= LIMITE ? n : null;
  }
  // Mesma regra do servidor: (quantidade × valor) em 1e-5, arredondado meio-para-cima para centavos.
  function totalCentavos(quantidade, valor) {
    const q = decimalPositivo(quantidade, 3), v = decimalPositivo(valor, 2);
    if (q === null || v === null) return null;
    const total = (q * v + 500n) / 1000n;
    return total > LIMITE ? null : total;
  }
  function reais(centavos) {
    return `R$ ${centavos / 100n},${String(centavos % 100n).padStart(2, '0')}`;
  }
  // Linha do cartão do item. Item importado do PNCP chega sem valor ofertado (antes: "R$ null") e com a
  // quantidade do banco em 3 casas ("500.000", que em pt-BR se lê quinhentos mil): mostra "500" e "não informado".
  // Mesma ordem do servidor (_kit_proposta_itens.js ordemItem): número do item em ordem natural, depois id.
  const COLLATOR = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  const ordemItem = (a, b) => COLLATOR.compare(String(a.identificador ?? ''), String(b.identificador ?? '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function linhaQuantidade(i, total) {
    const q = String(i.quantidade ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace('.', ',');
    const v = i.valorUnitario === null || i.valorUnitario === undefined || i.valorUnitario === '' ? 'não informado' : `R$ ${String(i.valorUnitario).replace('.', ',')}`;
    return `Quantidade: ${q}${i.unidade ? ` ${i.unidade}` : ''} · Unitário: ${v} · Total: ${total === null ? 'indisponível' : reais(total)}`;
  }
  function texto(valor, max) {
    if (typeof valor !== 'string' || valor.length > max || CONTROLE.test(valor)) return null;
    return valor.trim();
  }
  // Retorna {ok, erros, dados}. Campos opcionais vazios viram null.
  function validarItemCampos(c) {
    const erros = {};
    const identificador = texto(c.identificador, 180);
    if (!identificador) erros.identificador = 'Informe o identificador do item (até 180 caracteres, sem caracteres de controle).';
    const descricao = texto(c.descricao, 10000);
    if (!descricao) erros.descricao = 'Informe a descrição do item.';
    const marca = texto(c.marca || '', 500), modelo = texto(c.modelo || '', 500);
    if (marca === null) erros.marca = 'Confira a marca (até 500 caracteres).';
    if (modelo === null) erros.modelo = 'Confira o modelo (até 500 caracteres).';
    if (decimalPositivo(c.quantidade, 3) === null) erros.quantidade = 'Quantidade: número positivo com até 3 casas decimais, dentro do limite. Ex.: 2.500';
    if (decimalPositivo(c.valorUnitario, 2) === null) erros.valorUnitario = 'Valor unitário: número positivo com até 2 casas decimais, dentro do limite. Ex.: 1.10';
    if (!erros.quantidade && !erros.valorUnitario && totalCentavos(c.quantidade, c.valorUnitario) === null) erros.total = 'O total do item excede o limite. Confira quantidade e valor unitário.';
    const ok = Object.keys(erros).length === 0;
    return { ok, erros, dados: ok ? { identificador, descricao, marca: marca || null, modelo: modelo || null, quantidade: c.quantidade, valorUnitario: c.valorUnitario } : null };
  }

  // ---------- Preço por item (funções puras, BigInt) ----------
  // Texto canônico do servidor a partir de BigInt escalado ("51.20", "8.500").
  const canonico = (n, casas) => P().formatarDecimal(n, casas).replace(',', '.');
  const pct = (t) => (t === null || t === undefined || t === '' ? 0n : P().lerPercentual(String(t)) ?? 0n);
  const virgula = (t) => (t === null || t === undefined ? '' : String(t).replace('.', ','));
  // Premissa do servidor para exibir no campo: "8.500" → "8,5"; frete "150.00" → "150,00".
  function premissaParaCampo(chave, valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    if (chave === 'frete') return virgula(valor);
    const n = P().lerPercentual(String(valor));
    return n === null ? String(valor) : P().formatarDecimal(n, 3).replace(/,?0+$/, '');
  }
  // Campo digitado → texto do servidor (ou null para limpar). Erro diz o que fazer.
  function premissaDoCampo(chave, digitado) {
    const t = String(digitado ?? '').trim();
    if (!t) return { ok: true, valor: null };
    if (chave === 'frete') {
      const n = P().lerDinheiro(t);
      if (n === null || n > 9999999999999n * 100n) return { ok: false, erro: 'Use reais com vírgula, sem ponto de milhar. Ex.: 1500,00' };
      return { ok: true, valor: canonico(n, 2) };
    }
    const n = P().lerPercentual(t);
    if (n === null || n >= 100000n) return { ok: false, erro: 'Use um número de 0 a 99,999, com vírgula. Ex.: 8,5' };
    return { ok: true, valor: canonico(n, 3) };
  }

  // Alvo e limite de cada item: base = custo + frete rateado por unidade (arredondado para cima: nunca subestima o custo).
  // Alvo usa tributos + garantia + margem desejada; limite usa tributos + garantia + margem mínima.
  // shortcut: o frete é rateado entre os itens carregados na tela; com mais de 100 itens (Carregar mais), carregue todos antes.
  function calcularPrecos(itens, premissas) {
    const p = P(), pr = premissas || {}, out = new Map();
    const fixo = pct(pr.tributos) + pct(pr.garantia);
    const frete = pr.frete ? p.lerDinheiro(String(pr.frete)) ?? 0n : 0n;
    const dados = (itens || []).map((i) => ({ i, custo: i.custoUnitario ? p.lerDinheiro(String(i.custoUnitario)) : null, qtd: decimalPositivo(i.quantidade, 3) }));
    let rateio = null, avisoFrete = '';
    if (frete > 0n) {
      const r = p.freteRateado(dados.map((d) => ({ custoCentavos: d.custo ?? 0n, quantidade: d.qtd ?? 0n })), frete);
      if (r.ok) rateio = r.valores; else avisoFrete = 'Informe o custo dos itens para ratear o frete.';
    }
    dados.forEach((d, k) => {
      if (d.custo === null) { out.set(d.i.id, { semCusto: true, aviso: 'Informe o custo unitário para calcular o preço-alvo e o preço-limite.' }); return; }
      const freteItem = rateio ? rateio[k] : 0n;
      const freteUnidade = freteItem > 0n && d.qtd ? (freteItem * 1000n + d.qtd - 1n) / d.qtd : 0n;
      const base = d.custo + freteUnidade;
      const c = { base, fixo, freteUnidade, aviso: avisoFrete };
      if (pr.margem === null || pr.margem === undefined || pr.margem === '') c.erroAlvo = 'Informe a margem desejada nas premissas.';
      else { const a = p.precoComMargem(base, fixo + pct(pr.margem)); if (a.ok) c.alvo = a.centavos; else c.erroAlvo = a.erro; }
      if (pr.margemMinima === null || pr.margemMinima === undefined || pr.margemMinima === '') c.erroLimite = 'Informe a margem mínima nas premissas.';
      else { const l = p.precoComMargem(base, fixo + pct(pr.margemMinima)); if (l.ok) c.limite = l.centavos; else c.erroLimite = l.erro; }
      out.set(d.i.id, c);
    });
    return out;
  }
  // Escala 4 → centavos, meio para longe do zero (só para exibir lucro).
  const centavosDe4 = (n) => (n >= 0n ? (n + 50n) / 100n : -((-n + 50n) / 100n));
  // Selo com texto: vermelho "Prejuízo" ou "Abaixo do limite", amarelo "Negociação", verde "Boa margem".
  function simularLance(lanceDigitado, calc, quantidade) {
    const p = P();
    const lance = p.lerLance(String(lanceDigitado ?? ''));
    if (lance === null || lance === 0n) return { ok: false, erro: 'Digite o lance em reais, com até 4 casas. Ex.: 70,50' };
    if (!calc || calc.alvo === undefined || calc.limite === undefined) return { ok: false, erro: 'Informe o custo e as margens para simular o lance.' };
    const lucro = p.lucro(lance, calc.base, calc.fixo);
    const c = p.classificarLance(lance, calc.limite, calc.alvo, lucro);
    const textoSelo = c.prejuizo ? 'Prejuízo' : { vermelho: 'Abaixo do limite', amarelo: 'Negociação', verde: 'Boa margem' }[c.cor];
    const qtd = decimalPositivo(quantidade, 3);
    const margem = (lucro * 10000n) / lance; // centésimos de ponto percentual
    return {
      ok: true, cor: c.prejuizo ? 'vermelho' : c.cor, texto: textoSelo,
      margem: `${p.formatarDecimal(margem, 2)}%`,
      lucroUnidade: p.formatarReais(centavosDe4(lucro)),
      lucroTotal: qtd === null ? null : p.formatarReais(centavosDe4((lucro * qtd) / 1000n)),
    };
  }
  // "Usar limite como preço mínimo": mesmo corpo do salvarPrecoItem; o servidor recusa mínimo acima do valor unitário.
  function corpoUsarLimite(item, calc) {
    if (!calc || calc.limite === undefined) return { ok: false, erro: calc?.erroLimite || 'Informe o custo unitário e a margem mínima para calcular o limite.' };
    const vu = decimalPositivo(item.valorUnitario, 2);
    if (vu !== null && calc.limite > vu) return { ok: false, erro: `O preço-limite (${P().formatarReais(calc.limite)}) passa do seu valor unitário (${P().formatarReais(vu)}). Aumente o valor unitário ou revise as margens.` };
    return { ok: true, corpo: { itemId: item.id, custoUnitario: item.custoUnitario ?? null, valorUnitarioMinimo: canonico(calc.limite, 2) } };
  }

  // Unidade do PNCP → sigla da Pesquisa de Preços (tabela do T5, docs/qa/integracao-20261118/T5-referencia-preco.md).
  const SIGLAS = { UNIDADE: 'UN', EMBALAGEM: 'EMB', FRASCO: 'FR', CAIXA: 'CX', ROLO: 'RO', PACOTE: 'PCT', SACO: 'SC', QUILOGRAMA: 'KG', BOBINA: 'BOB', GRAMA: 'G', LITRO: 'L', MILILITRO: 'ML', AMPOLA: 'AM', LATA: 'LT', METRO: 'M', SERINGA: 'SER',
    BOMBONA: 'BOM', GALAO: 'GL', PECA: 'PC', CONJUNTO: 'CJ', SACHE: 'SAC', CENTENA: 'C', BALDE: 'BD', PAR: 'PAR', POTE: 'POTE', BISNAGA: 'BIS', 'FRASCO-AMPOLA': 'FR-AM', BARRA: 'BR', TAMBOR: 'TB', MILHEIRO: 'MIL', GARRAFA: 'GRF', DUZIA: 'DZ',
    'METRO CUBICO': 'M3', 'METRO QUADRADO': 'M2', FOLHA: 'FL', RESMA: 'RES', JOGO: 'JG', COMPRIMIDO: 'COMPR', CAPSULA: 'CAPS', TUBO: 'TBO', CARTELA: 'CTE' };
  const SIGLAS_VALIDAS = new Set(Object.values(SIGLAS));
  // Embalagem sem capacidade não dá resultado confiável (T5, regra 4): sem referência automática.
  const PEDE_CAPACIDADE = new Set(['CX', 'PCT', 'EMB']);
  function unidadeCompras(unidade) {
    if (typeof unidade !== 'string') return null;
    const t = unidade.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!t) return null;
    const direta = SIGLAS[t] || (SIGLAS_VALIDAS.has(t) ? t : null);
    if (direta) return PEDE_CAPACIDADE.has(direta) ? null : { sigla: direta };
    const m = /^(.+?) (\d+(?:[.,]\d+)?) ([A-Z0-9-]+)$/.exec(t);
    if (!m) return null;
    const sigla = SIGLAS[m[1]] || (SIGLAS_VALIDAS.has(m[1]) ? m[1] : null);
    const capacidade = Number(m[2].replace(',', '.'));
    if (!sigla || !(capacidade > 0)) return null;
    return { sigla, capacidade: String(capacidade), medida: m[3] };
  }
  // Resposta de /api/comprasgov-precos?acao=precos → mediana em texto canônico (até 4 casas) ou null.
  function referenciaDeResposta(j) {
    const est = j?.ok ? j.dados?.estatisticas : null;
    const m = Number(est?.mediana);
    if (!est || est.mediana === null || !Number.isFinite(m) || m <= 0) return null;
    const preco = m.toFixed(4).replace(/\.?0+$/, '');
    return preco === '0' ? null : { preco, quantidade: Number.isInteger(est.quantidadePrecos) ? est.quantidadePrecos : null };
  }
  // Referência em 4 casas para exibir: "7.7" → "R$ 7,70"; "2.195" → "R$ 2,195".
  function reaisReferencia(t) {
    const n = P().lerLance(String(t ?? ''));
    if (n === null) return '—';
    if (n % 100n === 0n) return P().formatarReais(n / 100n);
    return `R$ ${P().formatarDecimal(n, 4).replace(/0{1,2}$/, '')}`;
  }

  // ---------- Planilha ----------
  // UTF-8 primeiro; com caractere de substituição, tenta windows-1252 (Excel em pt-BR salva CSV em ANSI).
  function decodificarPlanilha(bytes) {
    const utf8 = new TextDecoder('utf-8').decode(bytes);
    return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  }
  // Prévia linha a linha com o mesmo módulo do servidor. Aplicar só sem nenhum erro (o servidor grava tudo ou nada).
  function previaPlanilha(textoCsv, itensAtuais) {
    const pl = planilha();
    const lida = pl.lerCsv(textoCsv);
    if (!lida.ok) return { erros: lida.erros, linhas: [], resumo: null, alteracoes: 0, podeAplicar: false };
    const v = pl.validarLinhas(lida.linhas, itensAtuais);
    const porId = new Map((itensAtuais || []).map((i) => [i.identificador, i]));
    const linhas = v.linhas.map((l) => ({ linha: l.linha, item: l.item, estado: l.estado, mensagens: l.mensagens, origemPncp: porId.get(l.item)?.origemPncp === true }));
    const alteracoes = v.resumo.novo + v.resumo.alterado;
    const erros = v.linhas.length ? [] : ['A planilha não tem linhas de itens.'];
    return { erros, linhas, resumo: v.resumo, alteracoes, podeAplicar: v.resumo.erro === 0 && alteracoes > 0 && !erros.length };
  }
  // Banco sem operacao_itens_proposta.sql (precoDisponivel false): só "Baixar planilha" com os campos que existem.
  const recursosPreco = (precoDisponivel) => ({ premissas: precoDisponivel === true, precos: precoDisponivel === true, importarPlanilha: precoDisponivel === true, baixarPlanilha: true });

  const PREMISSAS = [['tributos', 'Tributos (%)', 'Ex.: 8,5'], ['garantia', 'Garantia (%)', 'Ex.: 1'], ['margem', 'Margem desejada (%)', 'Ex.: 22'], ['margemMinima', 'Margem mínima (%)', 'Ex.: 8'], ['frete', 'Frete total (R$)', 'Ex.: 1500,00']];
  const ESTADO_LINHA = { novo: 'Novo', alterado: 'Alterado', sem_mudanca: 'Sem mudança', erro: 'Erro' };

  function montar({ alvo, contexto, requisitar = global.fetch.bind(global), aoSalvar = null }) {
    if (!alvo || !contexto || !UUID.test(contexto.empresaId || '') || !UUID.test(contexto.processoId || '')) throw new Error('Contexto de itens inválido');
    let vivo = true, ocupado = false, edicao = null, tentativa = null, itens = [], cursor = null, maisItens = false, geracao = 0;
    let precoDisponivel = null, premissas = null, previa = null, numeroProcesso = '', filaPremissas = Promise.resolve(), filaRef = Promise.resolve();
    const nos = new Map(), lances = new Map(), refEstado = new Map(), refTentada = new Set();
    alvo.innerHTML = `<h2 id="itens-titulo" tabindex="-1">Itens do processo</h2>
      <p data-item-estado role="status" aria-live="polite"></p>
      <section data-premissas class="itens-premissas" aria-labelledby="itens-premissas-titulo" hidden>
        <h3 id="itens-premissas-titulo">Premissas do processo</h3>
        <p class="itens-apoio">Valem para todos os itens. Cada campo salva ao sair dele.</p>
        <div class="itens-premissas-campos" data-premissas-campos></div>
      </section>
      <form data-item-form novalidate>
        <label>Identificador do item <input name="identificador" maxlength="180" autocomplete="off"></label>
        <label>Descrição <textarea name="descricao" maxlength="10000"></textarea></label>
        <label>Marca <input name="marca" maxlength="500" autocomplete="off"></label>
        <label>Modelo <input name="modelo" maxlength="500" autocomplete="off"></label>
        <label>Quantidade <input name="quantidade" inputmode="decimal" autocomplete="off" placeholder="Ex.: 2.500"></label>
        <label>Valor unitário (R$) <input name="valorUnitario" inputmode="decimal" autocomplete="off" placeholder="Ex.: 1.10"></label>
        <p data-item-total></p>
        <p data-item-erros role="alert"></p>
        <div class="itens-acoes"><button type="submit" class="app-primario" data-item-salvar>Salvar item</button><button type="button" data-item-cancelar hidden>Cancelar edição</button></div>
      </form>
      <div class="itens-acoes"><button type="button" data-item-atualizar>Atualizar itens</button><button type="button" data-item-importar-abrir aria-expanded="false" aria-controls="itens-importar">Importar itens do edital (PNCP)</button>
        <button type="button" data-planilha-baixar>Baixar planilha</button><button type="button" data-planilha-importar hidden>Importar planilha</button>
        <input type="file" accept=".csv,text/csv" data-planilha-arquivo aria-label="Arquivo da planilha de itens (CSV)" hidden></div>
      <p data-planilha-estado class="itens-planilha-estado" role="status" aria-live="polite"></p>
      <section data-planilha-previa class="itens-previa" aria-labelledby="itens-previa-titulo" hidden>
        <h3 id="itens-previa-titulo" tabindex="-1">Prévia da planilha</h3>
        <p data-previa-resumo></p>
        <ul data-previa-erros class="itens-previa-erros" role="alert"></ul>
        <div class="tabela-rolagem" tabindex="0" role="region" aria-label="Linhas da planilha"><table><thead><tr><th scope="col">Linha</th><th scope="col">Item</th><th scope="col">Situação</th><th scope="col">Mensagens</th></tr></thead><tbody data-previa-linhas></tbody></table></div>
        <div class="itens-acoes"><button type="button" class="app-primario" data-previa-aplicar disabled>Aplicar alterações</button><button type="button" data-previa-cancelar>Descartar planilha</button></div>
      </section>
      <form data-item-importar id="itens-importar" class="itens-importar" hidden novalidate>
        <label>Número do item no edital <input name="numeroItem" inputmode="numeric" pattern="[0-9]*" maxlength="7" autocomplete="off" placeholder="Ex.: 3"></label>
        <p class="itens-importar-ajuda">Um item por vez, direto do PNCP. Aguarde alguns segundos entre uma importação e outra.</p>
        <p data-item-importar-estado role="status" aria-live="polite"></p>
        <div class="itens-acoes"><button type="submit" class="app-primario" data-item-importar-enviar>Importar este item</button></div>
      </form>
      <div data-item-lista></div>
      <button type="button" data-item-mais hidden>Carregar mais itens</button>`;
    const el = (s) => alvo.querySelector(s);
    const doc = alvo.ownerDocument || global.document;
    // Elemento com texto sempre por textContent/nó de texto: dado do banco nunca vira HTML.
    function h(tag, attrs = {}, ...filhos) {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'texto') e.textContent = v; else if (k === 'classe') e.className = v; else e.setAttribute(k, v === true ? '' : String(v));
      }
      e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
      return e;
    }
    function seloEdital() {
      const s = h('span', { classe: 'selo-edital', title: 'Descrição, quantidade e unidade vêm do edital (PNCP) e não mudam pela planilha.' });
      const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'selo-edital-icone');
      const corpo = doc.createElementNS(ns, 'rect'); for (const [k, v] of Object.entries({ x: 3, y: 7, width: 10, height: 7, rx: 1.5 })) corpo.setAttribute(k, v);
      const arco = doc.createElementNS(ns, 'path'); arco.setAttribute('d', 'M5 7V5a3 3 0 0 1 6 0v2'); arco.setAttribute('fill', 'none');
      svg.append(corpo, arco); s.append(svg, 'Dado do edital');
      return s;
    }
    const form = el('[data-item-form]');
    const campos = () => Object.fromEntries(['identificador', 'descricao', 'marca', 'modelo', 'quantidade', 'valorUnitario'].map((n) => [n, form.elements[n].value]));
    const pedir = (corpo) => requisitar('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ empresaId: contexto.empresaId, processoId: contexto.processoId, ...corpo }) });
    // Chamada que nunca lança: { r, j } com r null se a rede falhou.
    async function chamar(corpo) {
      try { const r = await pedir(corpo); return { r, j: await r.json().catch(() => null) }; } catch { return { r: null, j: null }; }
    }
    function marcar(alvoEstado, t, tipo) { if (!alvoEstado) return; alvoEstado.textContent = t || ''; alvoEstado.dataset.situacao = tipo || ''; }

    function estado(t, tipo) { el('[data-item-estado]').textContent = t || ''; el('[data-item-estado]').dataset.itemEstado = tipo || ''; }
    function atualizarTotal() {
      const c = campos(), t = totalCentavos(c.quantidade, c.valorUnitario);
      el('[data-item-total]').textContent = t === null ? 'Total do item: informe quantidade e valor válidos.' : `Total do item: ${reais(t)}`;
    }
    function bloquear(v) { ocupado = v; for (const s of ['[data-item-salvar]', '[data-item-atualizar]', '[data-item-mais]', '[data-item-importar-enviar]', '[data-planilha-baixar]', '[data-planilha-importar]']) el(s).disabled = v; }

    // ---------- premissas ----------
    function montarPremissas() {
      const caixa = el('[data-premissas-campos]');
      caixa.replaceChildren(...PREMISSAS.map(([chave, rotulo, exemplo]) => {
        const id = `itens-premissa-${chave}`;
        return h('div', { classe: 'itens-campo' },
          h('label', { for: id, texto: rotulo }),
          h('input', { id, 'data-premissa': chave, inputmode: 'decimal', autocomplete: 'off', placeholder: exemplo, 'aria-describedby': `${id}-estado` }),
          h('span', { id: `${id}-estado`, classe: 'itens-campo-estado', 'data-premissa-estado': chave, 'aria-live': 'polite' }));
      }));
    }
    function preencherPremissas() {
      for (const [chave] of PREMISSAS) el(`[data-premissa="${chave}"]`).value = premissaParaCampo(chave, premissas?.[chave]);
    }
    async function carregarPremissas() {
      const { r, j } = await chamar({ acao: 'lerPremissas' });
      if (!vivo) return;
      if (r && r.ok && j?.premissas) { premissas = j.premissas; preencherPremissas(); atualizarPrecos(); return; }
      premissas = premissas || {};
      marcar(el('[data-premissa-estado="tributos"]'), j?.erro || 'Não foi possível ler as premissas. Use Atualizar itens.', 'erro');
      atualizarPrecos();
    }
    function salvarPremissa(chave) {
      const campo = el(`[data-premissa="${chave}"]`), aviso = el(`[data-premissa-estado="${chave}"]`);
      const v = premissaDoCampo(chave, campo.value);
      if (!v.ok) { marcar(aviso, v.erro, 'erro'); campo.setAttribute('aria-invalid', 'true'); return; }
      campo.removeAttribute('aria-invalid');
      if (premissaParaCampo(chave, premissas?.[chave]) === premissaParaCampo(chave, v.valor)) { marcar(aviso, '', ''); return; }
      marcar(aviso, 'Salvando…', 'carregando');
      // Em fila: cada envio leva as cinco premissas já confirmadas pelo servidor, sem corrida entre campos.
      filaPremissas = filaPremissas.then(async () => {
        const corpo = { acao: 'salvarPremissas', ...Object.fromEntries(PREMISSAS.map(([k]) => [k, premissas?.[k] ?? null])), [chave]: v.valor };
        const { r, j } = await chamar(corpo);
        if (!vivo) return;
        if (r && r.ok && j?.premissas) { premissas = j.premissas; marcar(aviso, 'Salvo', 'ok'); atualizarPrecos(); return; }
        marcar(aviso, j?.erro || 'Não foi possível salvar agora. Saia do campo de novo para tentar.', 'erro');
        campo.setAttribute('aria-invalid', 'true');
      });
    }

    // ---------- lista ----------
    function blocoPreco(i) {
      const id = (s) => `itens-${s}-${i.id}`;
      const n = {
        custo: h('input', { id: id('custo'), 'data-custo': i.id, inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ex.: 51,20', 'aria-describedby': id('custo-estado') }),
        custoEstado: h('span', { id: id('custo-estado'), classe: 'itens-campo-estado', 'aria-live': 'polite' }),
        alvo: h('dd'), limite: h('dd'), minimo: h('dd'), aviso: h('p', { classe: 'itens-apoio' }),
        referencia: h('div', { classe: 'itens-referencia' }),
        lance: h('input', { id: id('lance'), 'data-lance': i.id, inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ex.: 70,50', 'aria-describedby': id('simulacao') }),
        simulacao: h('div', { id: id('simulacao'), classe: 'itens-simulacao', 'aria-live': 'polite' }),
        usar: h('button', { type: 'button', 'data-usar-limite': i.id, texto: 'Usar limite como preço mínimo' }),
        usarEstado: h('span', { classe: 'itens-campo-estado', 'aria-live': 'polite' }),
      };
      n.custo.value = virgula(i.custoUnitario);
      n.lance.value = lances.get(i.id) || '';
      nos.set(i.id, n);
      return h('div', { classe: 'itens-preco' },
        h('div', { classe: 'itens-campo' }, h('label', { for: id('custo'), texto: 'Custo unitário (R$)' }), n.custo, n.custoEstado),
        h('dl', { classe: 'itens-precos' },
          h('div', {}, h('dt', { texto: 'Preço-alvo' }), n.alvo),
          h('div', {}, h('dt', { texto: 'Preço-limite' }), n.limite),
          h('div', {}, h('dt', { texto: 'Preço mínimo gravado' }), n.minimo)),
        n.aviso, n.referencia,
        h('div', { classe: 'itens-campo' }, h('label', { for: id('lance'), texto: 'Simular lance (R$)' }), n.lance), n.simulacao,
        h('div', { classe: 'itens-acoes' }, n.usar, n.usarEstado));
    }
    function cartaoItem(i) {
      const t = totalCentavos(i.quantidade, i.valorUnitario);
      const li = h('li', {},
        h('div', { classe: 'itens-cabeca' }, h('strong', { texto: i.identificador }), i.origemPncp === true ? seloEdital() : null),
        h('p', { texto: i.descricao }),
        h('p', { texto: linhaQuantidade(i, t) }),
        h('p', { texto: `Marca: ${i.marca || 'não informada'} · Modelo: ${i.modelo || 'não informado'}` }),
        h('button', { type: 'button', 'data-item-editar': i.id, 'aria-label': `Editar ${i.identificador}`, texto: 'Editar' }));
      if (recursosPreco(precoDisponivel).precos) li.append(blocoPreco(i));
      return li;
    }
    function renderLista() {
      nos.clear();
      const lista = el('[data-item-lista]');
      lista.replaceChildren(itens.length ? h('ul', {}, ...itens.map(cartaoItem)) : h('p', { texto: 'Nenhum item cadastrado neste processo.' }));
      el('[data-item-mais]').hidden = !maisItens;
      const r = recursosPreco(precoDisponivel);
      el('[data-premissas]').hidden = !r.premissas;
      el('[data-planilha-importar]').hidden = !r.importarPlanilha;
      if (!r.importarPlanilha) { previa = null; el('[data-planilha-previa]').hidden = true; }
      atualizarPrecos();
      if (r.precos) for (const i of itens) if (!i.precoReferencia && !refTentada.has(i.id) && i.codigoCatalogo && unidadeCompras(i.unidade)) { refTentada.add(i.id); filaRef = filaRef.then(() => buscarReferencia(i)); }
    }
    function atualizarPrecos() {
      if (!nos.size) return;
      const calc = calcularPrecos(itens, premissas);
      for (const i of itens) {
        const n = nos.get(i.id); if (!n) continue;
        const c = calc.get(i.id);
        n.alvo.textContent = c?.alvo !== undefined ? P().formatarReais(c.alvo) : '—';
        n.limite.textContent = c?.limite !== undefined ? P().formatarReais(c.limite) : '—';
        n.minimo.textContent = i.valorUnitarioMinimo ? `R$ ${virgula(i.valorUnitarioMinimo)}` : 'Não gravado';
        const avisos = c?.semCusto ? [c.aviso] : [c?.erroAlvo, c?.erroLimite, c?.aviso, c?.freteUnidade > 0n ? `Inclui frete rateado de ${P().formatarReais(c.freteUnidade)} por unidade.` : ''];
        n.aviso.textContent = avisos.filter(Boolean).join(' ');
        n.usar.disabled = c?.limite === undefined;
        renderReferencia(i, c);
        renderSimulacao(i, c);
      }
    }
    function renderSimulacao(i, c) {
      const n = nos.get(i.id), digitado = lances.get(i.id) || '';
      n.simulacao.replaceChildren();
      if (!digitado.trim()) { n.simulacao.textContent = 'Digite um lance para ver se ele dá lucro.'; return; }
      const r = simularLance(digitado, c, i.quantidade);
      if (!r.ok) { n.simulacao.textContent = r.erro; return; }
      n.simulacao.append(h('span', { classe: 'selo-lance', 'data-cor': r.cor, texto: r.texto }),
        h('span', { texto: `Margem ${r.margem} · Lucro por unidade ${r.lucroUnidade}${r.lucroTotal ? ` · Lucro total ${r.lucroTotal}` : ''}` }));
    }
    function renderReferencia(i, c) {
      const n = nos.get(i.id); if (!n) return;
      const u = unidadeCompras(i.unidade), automatica = Boolean(i.codigoCatalogo && u);
      const partes = [h('strong', { texto: 'Referência Compras.gov' })];
      if (i.precoReferencia) {
        const em = Date.parse(i.precoReferenciaEm || '');
        partes.push(h('p', { texto: `Mediana ${reaisReferencia(i.precoReferencia)}${Number.isFinite(em) ? ` em ${new Date(em).toLocaleDateString('pt-BR')}` : ''}` }));
        const ref4 = P().lerLance(String(i.precoReferencia));
        if (c?.alvo !== undefined && ref4 !== null) partes.push(h('p', { classe: 'itens-apoio', texto: c.alvo * 100n > ref4 ? 'Seu preço-alvo está acima da mediana: confira se o custo está certo.' : 'Seu preço-alvo está dentro da mediana do mercado.' }));
      }
      if (refEstado.has(i.id)) partes.push(h('p', { classe: 'itens-apoio', texto: refEstado.get(i.id) }));
      if (automatica) partes.push(h('button', { type: 'button', 'data-buscar-referencia': i.id, texto: i.precoReferencia ? 'Buscar de novo' : 'Buscar referência' }));
      else {
        if (!i.precoReferencia) partes.push(h('p', { texto: MSG.semReferencia }));
        partes.push(h('a', { href: 'painel.html#precos', texto: 'Pesquisar na Pesquisa de Preços' }));
      }
      n.referencia.replaceChildren(...partes);
    }
    async function buscarReferencia(i) {
      const u = unidadeCompras(i.unidade);
      if (!vivo || !u || !i.codigoCatalogo) return;
      refEstado.set(i.id, 'Buscando a mediana no Compras.gov…'); atualizarPrecos();
      const q = new URLSearchParams({ acao: 'precos', codigoItemCatalogo: String(i.codigoCatalogo), siglaUnidadeFornecimento: u.sigla });
      if (u.capacidade) { q.set('capacidadeUnidadeFornecimento', u.capacidade); q.set('siglaUnidadeMedida', u.medida); }
      let r = null, j = null;
      try { r = await requisitar(`/api/comprasgov-precos?${q}`, { method: 'GET', credentials: 'same-origin' }); j = await r.json().catch(() => null); } catch { r = null; }
      if (!vivo) return;
      const ref = r && r.ok ? referenciaDeResposta(j) : null;
      if (!ref) { refEstado.set(i.id, r && r.ok && j?.ok ? MSG.semPrecos : MSG.erroReferencia); atualizarPrecos(); return; }
      const salvo = await chamar({ acao: 'salvarReferencia', itemId: i.id, preco: ref.preco, em: new Date().toISOString() });
      if (!vivo) return;
      if (salvo.r && salvo.r.ok && salvo.j?.item) { i.precoReferencia = salvo.j.item.precoReferencia; i.precoReferenciaEm = salvo.j.item.precoReferenciaEm; refEstado.delete(i.id); }
      else refEstado.set(i.id, `Mediana ${reaisReferencia(ref.preco)} encontrada, mas não foi salva: ${salvo.j?.erro || 'tente de novo'}.`);
      atualizarPrecos();
    }
    async function salvarCusto(i) {
      const n = nos.get(i.id); if (!n) return;
      const t = n.custo.value.trim(), c = t ? P().lerDinheiro(t) : null;
      if (t && (c === null || c === 0n)) { marcar(n.custoEstado, 'Use reais com vírgula, maior que zero. Ex.: 51,20', 'erro'); n.custo.setAttribute('aria-invalid', 'true'); return; }
      n.custo.removeAttribute('aria-invalid');
      const valor = c === null ? null : canonico(c, 2);
      if (valor === (i.custoUnitario ? canonico(P().lerDinheiro(String(i.custoUnitario)), 2) : null)) { marcar(n.custoEstado, '', ''); return; }
      marcar(n.custoEstado, 'Salvando…', 'carregando');
      const { r, j } = await chamar({ acao: 'salvarPrecoItem', itemId: i.id, custoUnitario: valor, valorUnitarioMinimo: i.valorUnitarioMinimo ?? null });
      if (!vivo) return;
      if (r && r.ok && j?.item) { i.custoUnitario = j.item.custoUnitario; i.valorUnitarioMinimo = j.item.valorUnitarioMinimo; marcar(nos.get(i.id)?.custoEstado, 'Salvo', 'ok'); atualizarPrecos(); return; }
      marcar(nos.get(i.id)?.custoEstado, j?.erro || 'Não foi possível salvar agora. Saia do campo de novo para tentar.', 'erro');
    }
    async function usarLimite(i) {
      const n = nos.get(i.id);
      const v = corpoUsarLimite(i, calcularPrecos(itens, premissas).get(i.id));
      if (!v.ok) { marcar(n.usarEstado, v.erro, 'erro'); return; }
      n.usar.disabled = true; marcar(n.usarEstado, 'Gravando…', 'carregando');
      const { r, j } = await chamar({ acao: 'salvarPrecoItem', ...v.corpo });
      if (!vivo) return;
      const atual = nos.get(i.id);
      if (r && r.ok && j?.item) { i.valorUnitarioMinimo = j.item.valorUnitarioMinimo; i.custoUnitario = j.item.custoUnitario; atualizarPrecos(); marcar(atual?.usarEstado, `Preço mínimo gravado: R$ ${virgula(i.valorUnitarioMinimo)}`, 'ok'); return; }
      atualizarPrecos(); marcar(atual?.usarEstado, j?.erro || 'Não foi possível gravar agora. Tente de novo.', 'erro');
    }

    // Lista paginada pelo contrato existente (listarItens + afterId/nextCursor). Resposta confere empresa e processo.
    async function carregar({ reiniciar, mensagemFinal = '' }) {
      const g = ++geracao; bloquear(true); estado(MSG.carregando, 'carregando');
      try {
        const corpo = { acao: 'listarItens', empresaId: contexto.empresaId, processoId: contexto.processoId, ...(!reiniciar && cursor ? { afterId: cursor } : {}) };
        const r = await requisitar('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(corpo) });
        const j = await r.json().catch(() => null);
        if (!vivo || g !== geracao) return;
        if (!r.ok || !j) throw new Error(j?.erro || MSG.erroCarregar);
        if (j.empresa?.id !== contexto.empresaId || j.processo?.id !== contexto.processoId) throw new Error(MSG.divergente);
        // Cada página já vem ordenada pelo número do item; a lista acumulada é reordenada pela mesma regra do servidor.
        itens = (reiniciar ? (j.itens || []) : itens.concat(j.itens || [])).sort(ordemItem);
        cursor = j.paginacaoItens?.nextCursor || null; maisItens = j.paginacaoItens?.hasMore === true;
        numeroProcesso = typeof j.processo?.numero === 'string' ? j.processo.numero : '';
        const primeiraVez = precoDisponivel === null;
        precoDisponivel = j.precoDisponivel === true;
        renderLista(); estado(mensagemFinal, mensagemFinal ? 'ok' : '');
        if (primeiraVez && precoDisponivel) void carregarPremissas();
      } catch (e) {
        if (vivo && g === geracao) estado(e.message || MSG.erroCarregar, 'erro');
      } finally { if (vivo && g === geracao) bloquear(false); }
    }
    // Planilha cobre o processo inteiro: lê todas as páginas (até 1000 itens = 10 chamadas), sem mexer na lista da tela.
    async function todosItens() {
      const todos = []; let depois = null;
      for (let n = 0; n < 11; n++) {
        const { r, j } = await chamar({ acao: 'listarItens', ...(depois ? { afterId: depois } : {}) });
        if (!r || !r.ok || !j || j.empresa?.id !== contexto.empresaId || j.processo?.id !== contexto.processoId) throw new Error(j?.erro || MSG.erroCarregar);
        todos.push(...(j.itens || []));
        if (j.paginacaoItens?.hasMore !== true) return todos;
        depois = j.paginacaoItens.nextCursor;
      }
      throw new Error('O processo tem mais itens do que cabem numa planilha (limite de 1000).');
    }
    const avisoPlanilha = (t, tipo) => marcar(el('[data-planilha-estado]'), t, tipo);
    async function baixarPlanilha() {
      if (ocupado || !vivo) return;
      bloquear(true); avisoPlanilha('Preparando a planilha…', 'carregando');
      try {
        const csv = planilha().gerarCsv(await todosItens());
        if (!vivo) return;
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const a = h('a', { href: url, download: `itens-processo-${(numeroProcesso || 'processo').replace(/[^\w-]+/g, '-').slice(0, 60)}.csv`, hidden: true });
        doc.body.append(a); a.click(); a.remove();
        global.setTimeout(() => URL.revokeObjectURL(url), 1000);
        avisoPlanilha(recursosPreco(precoDisponivel).importarPlanilha ? 'Planilha baixada. Preencha no Excel ou LibreOffice e use Importar planilha.' : 'Planilha baixada com os campos disponíveis.', 'ok');
      } catch (e) { if (vivo) avisoPlanilha(e.message || MSG.erroCarregar, 'erro'); }
      finally { if (vivo) bloquear(false); }
    }
    function renderPrevia() {
      const s = el('[data-planilha-previa]');
      s.hidden = !previa;
      if (!previa) return;
      const { resumo, linhas, erros, alteracoes, podeAplicar } = previa;
      el('[data-previa-resumo]').textContent = resumo
        ? `${resumo.novo} novo(s), ${resumo.alterado} alterado(s), ${resumo.sem_mudanca} sem mudança, ${resumo.erro} com erro.${resumo.erro ? ' Corrija as linhas com erro na planilha e importe de novo. Nada foi gravado.' : ''}`
        : 'A planilha não pôde ser lida. Nada foi gravado.';
      el('[data-previa-erros]').replaceChildren(...erros.map((e) => h('li', { texto: e })));
      el('[data-previa-linhas]').replaceChildren(...linhas.map((l) => h('tr', { 'data-estado-linha': l.estado },
        h('td', { texto: String(l.linha) }),
        h('td', {}, h('span', { texto: l.item || '—' }), l.origemPncp ? seloEdital() : null),
        h('td', {}, h('span', { classe: 'selo-linha', 'data-estado-linha': l.estado, texto: ESTADO_LINHA[l.estado] || l.estado })),
        h('td', { texto: l.mensagens.join(' ') || (l.estado === 'sem_mudanca' ? 'Nada muda.' : 'Pronto para gravar.') }))));
      const b = el('[data-previa-aplicar]');
      b.disabled = !podeAplicar;
      b.textContent = alteracoes === 1 ? 'Aplicar 1 alteração' : `Aplicar ${alteracoes} alterações`;
    }
    async function lerArquivo(arquivo) {
      if (!arquivo || ocupado || !vivo) return;
      if (arquivo.size > planilha().MAX_BYTES) { previa = null; renderPrevia(); avisoPlanilha('A planilha passa de 2 MB. Divida em arquivos menores.', 'erro'); return; }
      bloquear(true); avisoPlanilha('Conferindo a planilha…', 'carregando');
      try {
        const textoCsv = decodificarPlanilha(new Uint8Array(await arquivo.arrayBuffer()));
        const atuais = await todosItens();
        if (!vivo) return;
        previa = { ...previaPlanilha(textoCsv, atuais), texto: textoCsv };
        renderPrevia(); avisoPlanilha('', '');
        el('#itens-previa-titulo')?.focus?.();
      } catch (e) { if (vivo) avisoPlanilha(e.message || 'Não foi possível ler o arquivo.', 'erro'); }
      finally { if (vivo) bloquear(false); }
    }
    async function aplicarPlanilha() {
      if (!previa?.podeAplicar || ocupado || !vivo) return;
      bloquear(true); el('[data-previa-aplicar]').disabled = true; avisoPlanilha('Gravando a planilha…', 'carregando');
      const { r, j } = await chamar({ acao: 'importarPlanilha', texto: previa.texto });
      if (!vivo) return;
      bloquear(false);
      if (r && r.ok && Number.isInteger(j?.gravados)) {
        previa = null; renderPrevia();
        if (typeof aoSalvar === 'function' && j.gravados > 0) { try { aoSalvar(); } catch { /* sem efeito na planilha */ } }
        await carregar({ reiniciar: true });
        avisoPlanilha(j.gravados === 1 ? '1 item gravado pela planilha.' : `${j.gravados} itens gravados pela planilha.`, 'ok');
        return;
      }
      // Tudo ou nada: o servidor recusou a planilha inteira. Mostra as linhas dele.
      if (j?.linhas) previa = { ...previa, linhas: previa.linhas.map((l) => ({ ...l, ...(j.linhas.find((x) => x.linha === l.linha) || {}) })), resumo: j.resumo || previa.resumo };
      previa = { ...previa, erros: Array.isArray(j?.erros) ? j.erros.map(String) : [j?.erro || 'Não foi possível gravar agora. Tente de novo.'], podeAplicar: !(Array.isArray(j?.erros) && j.erros.length) };
      renderPrevia(); avisoPlanilha(j?.erro || 'Nada foi gravado.', 'erro');
    }

    // Envio único por tentativa: mesmo id enquanto os dados não mudam; edição usa o id do item.
    async function salvar(ev) {
      ev.preventDefault();
      if (ocupado || !vivo) return;
      const v = validarItemCampos(campos());
      if (!v.ok) { el('[data-item-erros]').textContent = Object.values(v.erros).join(' '); return; }
      el('[data-item-erros]').textContent = '';
      const modo = edicao ? 'editar' : 'criar';
      const chave = JSON.stringify([modo, edicao, v.dados]);
      if (!tentativa || tentativa.chave !== chave) tentativa = { id: edicao || global.crypto.randomUUID(), chave };
      const g = geracao; bloquear(true); estado('Salvando item…', 'carregando');
      let r = null, j = null;
      try {
        r = await requisitar('/api/kit-documentos', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ acao: 'salvarItem', empresaId: contexto.empresaId, processoId: contexto.processoId, modo, item: { id: tentativa.id, ...v.dados } }) });
        j = await r.json().catch(() => null);
      } catch { r = null; }
      if (!vivo || g !== geracao) return;
      bloquear(false);
      if (r && (r.status === 201 || r.status === 200) && j?.item) {
        tentativa = null; edicao = null; form.reset(); el('[data-item-cancelar]').hidden = true; atualizarTotal();
        // Gancho opcional, ANTES da consulta: o kit invalida revisao/exportacao ja com a gravacao confirmada. Falha ali nao afeta o item.
        if (vivo && typeof aoSalvar === 'function') { try { aoSalvar(); } catch { /* sem efeito no cadastro */ } }
        await carregar({ reiniciar: true, mensagemFinal: typeof aoSalvar === 'function' ? 'Item salvo. Catálogo da proposta será atualizado; confira a nova prévia.' : MSG.salvo });
        return;
      }
      if (!r) { estado(MSG.conexao, 'erro'); return; }
      estado(j?.erro || 'Não foi possível salvar o item.', 'erro');
    }

    function editar(id) {
      const i = itens.find((x) => x.id === id);
      if (!i || ocupado) return;
      edicao = id; tentativa = null;
      for (const n of ['identificador', 'descricao', 'marca', 'modelo', 'quantidade', 'valorUnitario']) form.elements[n].value = i[n] ?? '';
      el('[data-item-cancelar]').hidden = false; atualizarTotal(); estado(MSG.editando, 'vazio');
      el('#itens-titulo')?.focus?.();
    }
    // Importação PNCP: mesmo endpoint e regra de processos.html; o servidor confere empresa, processo e vínculo.
    const formImportar = el('[data-item-importar]');
    // Retorno ao lado do botão: no celular o topo do cartão fica fora da tela.
    function avisoImportar(t, tipo) { const p = el('[data-item-importar-estado]'); p.textContent = t || ''; p.dataset.situacao = tipo || ''; }
    async function importar(ev) {
      ev.preventDefault();
      if (ocupado || !vivo) return;
      const numeroItem = numeroItemImportacao(formImportar.elements.numeroItem.value);
      if (numeroItem === null) { avisoImportar(MSG.numeroImportar, 'erro'); formImportar.elements.numeroItem.focus?.(); return; }
      const g = geracao; bloquear(true); avisoImportar(MSG.importando, 'carregando');
      let r = null, j = null;
      try {
        r = await requisitar('/api/importar-item-pncp', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ empresaId: contexto.empresaId, processoId: contexto.processoId, numeroItem }) });
        j = await r.json().catch(() => null);
      } catch { r = null; }
      if (!vivo || g !== geracao) return;
      bloquear(false);
      if (!r) { avisoImportar(MSG.erroImportar, 'erro'); return; }
      const resultado = respostaImportacao(r.status, j);
      if (!resultado.ok) { avisoImportar(resultado.texto, 'erro'); return; }
      formImportar.reset();
      avisoImportar(resultado.texto, 'ok');
      if (typeof aoSalvar === 'function') { try { aoSalvar(); } catch { /* sem efeito na importação */ } }
      await carregar({ reiniciar: true });
    }
    function cancelarEdicao() { edicao = null; tentativa = null; form.reset(); el('[data-item-cancelar]').hidden = true; atualizarTotal(); estado('', ''); }

    form.addEventListener('submit', salvar);
    form.addEventListener('input', atualizarTotal);
    el('[data-item-cancelar]').addEventListener('click', cancelarEdicao);
    el('[data-item-atualizar]').addEventListener('click', () => { void carregar({ reiniciar: true }); });
    el('[data-item-mais]').addEventListener('click', () => { void carregar({ reiniciar: false }); });
    el('[data-item-importar-abrir]').addEventListener('click', (ev) => {
      formImportar.hidden = !formImportar.hidden;
      ev.currentTarget.setAttribute('aria-expanded', String(!formImportar.hidden));
      if (!formImportar.hidden) formImportar.elements.numeroItem.focus?.();
    });
    formImportar.addEventListener('submit', importar);
    el('[data-planilha-baixar]').addEventListener('click', () => { void baixarPlanilha(); });
    el('[data-planilha-importar]').addEventListener('click', () => { const a = el('[data-planilha-arquivo]'); a.value = ''; a.click(); });
    el('[data-planilha-arquivo]').addEventListener('change', (ev) => { void lerArquivo(ev.target.files?.[0]); });
    el('[data-previa-aplicar]').addEventListener('click', () => { void aplicarPlanilha(); });
    el('[data-previa-cancelar]').addEventListener('click', () => { previa = null; renderPrevia(); avisoPlanilha('Planilha descartada. Nada foi gravado.', ''); });
    const itemDe = (id) => itens.find((x) => x.id === id);
    alvo.addEventListener('click', (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.itemEditar) editar(b.dataset.itemEditar);
      else if (b.dataset.usarLimite && itemDe(b.dataset.usarLimite)) void usarLimite(itemDe(b.dataset.usarLimite));
      else if (b.dataset.buscarReferencia && itemDe(b.dataset.buscarReferencia)) { const i = itemDe(b.dataset.buscarReferencia); filaRef = filaRef.then(() => buscarReferencia(i)); }
    });
    // "change" dispara ao sair do campo com valor alterado: é o "salva ao sair dele".
    alvo.addEventListener('change', (ev) => {
      const d = ev.target?.dataset || {};
      if (d.premissa) salvarPremissa(d.premissa);
      else if (d.custo && itemDe(d.custo)) void salvarCusto(itemDe(d.custo));
    });
    alvo.addEventListener('input', (ev) => {
      const d = ev.target?.dataset || {};
      if (d.lance && itemDe(d.lance)) { lances.set(d.lance, ev.target.value); renderSimulacao(itemDe(d.lance), calcularPrecos(itens, premissas).get(d.lance)); }
    });
    montarPremissas();
    atualizarTotal();
    void carregar({ reiniciar: true });

    return {
      fechar() { vivo = false; geracao += 1; alvo.replaceChildren(); },
      temAlteracoesNaoSalvas: () => vivo && (Object.values(campos()).some((v) => v !== '') || edicao !== null || previa?.podeAplicar === true),
    };
  }

  const api = { montar, validarItemCampos, totalCentavos, reais, linhaQuantidade, decimalPositivo, numeroItemImportacao, respostaImportacao, MSG,
    premissaDoCampo, premissaParaCampo, calcularPrecos, simularLance, corpoUsarLimite, unidadeCompras, referenciaDeResposta, decodificarPlanilha, previaPlanilha, recursosPreco };
  global.LicitaItensProcesso = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
