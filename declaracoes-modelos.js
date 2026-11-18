/* global module */
// Biblioteca versionada de modelos de declaração (Lei 14.133/2021, LC 123/2006 etc.). Mesmo módulo no navegador e no servidor.
// TODOS os modelos saem com revisaoJuridica 'pendente': o advogado precisa revisar antes de publicar ou exportar.
// Ordem de escolha (esteira E6/E11): modelo do próprio edital (detectarModeloDoEdital) > biblioteca (escolherModelo) >
// "sem modelo: redija a partir do trecho" (quem chama mostra; escolherModelo devolve null).
// Base legal: só artigos conferidos; o que não foi conferido está genérico e marcado "conferir artigo".
(function (global) {
  'use strict';
  const VARIAVEIS = ['razao_social', 'cnpj', 'endereco', 'representante', 'cpf_representante', 'cargo', 'numero_edital', 'orgao', 'objeto', 'cidade', 'data', 'porte', 'nome_fantasia'];
  const VAZIO = '____';

  const ABERTURA = '{{razao_social}}, inscrita no CNPJ sob o nº {{cnpj}}, com sede em {{endereco}}, neste ato representada por {{representante}}, {{cargo}}, inscrito(a) no CPF sob o nº {{cpf_representante}}, para fins de participação no processo licitatório nº {{numero_edital}}, promovido por {{orgao}}, cujo objeto é {{objeto}}, DECLARA, sob as penas da lei, ';
  const FECHO = '\n\n{{cidade}}, {{data}}.\n\n\n______________________________\n{{razao_social}}\n{{representante}} – {{cargo}}';

  // m(codigo, titulo, categoria, baseLegal, corpo, padroes): padrões rodam sobre texto sem acento e em minúsculas.
  const m = (codigo, titulo, categoria, baseLegal, corpo, padroes) =>
    Object.freeze({ codigo, versao: 1, titulo, baseLegal, categoria, texto: ABERTURA + corpo + FECHO, padroes: Object.freeze(padroes), revisaoJuridica: 'pendente' });

  const MODELOS = Object.freeze([
    m('HAB_ART63_I', 'Declaração de cumprimento dos requisitos de habilitação', 'habilitacao', 'Lei 14.133/2021, art. 63, I',
      'que cumpre plenamente os requisitos de habilitação exigidos no edital, estando ciente de que responde pela veracidade das informações prestadas, na forma da lei.',
      [/requisitos? de habilitacao/, /(cumpre|atende|preenche)\w*\W+(plenamente\W+)?(aos\W+|os\W+)?requisitos/, /art(igo)?\.?\s*63,?\s*(inciso\s*)?i\b/]),
    // conferir artigo: base genérica (fato impeditivo é prática de editais; não há inciso conferido na 14.133).
    m('HAB_FATO_IMPEDITIVO', 'Declaração de inexistência de fato impeditivo', 'habilitacao', 'Lei 14.133/2021 (habilitação)',
      'que, até a presente data, inexistem fatos impeditivos à sua habilitação e participação no presente certame, e que está ciente da obrigação de declarar ocorrências posteriores.',
      [/impeditiv/, /fatos?\W+supervenientes?/, /inexistencia de fato/]),
    // conferir artigo: a 14.133 também trata do tema na habilitação social (possível art. 68, VI); aqui só a CF, conferida.
    m('TRAB_MENOR', 'Declaração de não emprego de menor', 'trabalhista', 'CF, art. 7º, XXXIII',
      'que não emprega menor de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre e não emprega menor de 16 (dezesseis) anos, salvo na condição de aprendiz, a partir de 14 (quatorze) anos, em cumprimento ao disposto no art. 7º, inciso XXXIII, da Constituição Federal.',
      [/menor(es)?\W+de\W+(dezoito|18|dezesseis|16)/, /trabalho noturno, perigoso ou insalubre/, /\bxxxiii\b/, /condicao de aprendiz/, /emprego de menor/, /trabalho infantil/]),
    // conferir artigo: elaboração independente vem de norma infralegal anterior; base genérica.
    m('PROP_INDEPENDENTE', 'Declaração de elaboração independente de proposta', 'proposta', 'Lei 14.133/2021 (proposta)',
      'que a proposta apresentada foi elaborada de maneira independente e que seu conteúdo não foi, no todo ou em parte, direta ou indiretamente, informado, discutido ou recebido de qualquer outro participante potencial ou de fato do presente certame, por qualquer meio ou pessoa.',
      [/elaboracao independente/, /elaborad[ao]\W+de\W+(maneira|forma)\W+independente/, /proposta independente/]),
    m('ME_EPP_ENQUADRAMENTO', 'Declaração de enquadramento como ME/EPP', 'me_epp', 'LC 123/2006',
      'que se enquadra na condição de {{porte}}, nos termos da Lei Complementar nº 123/2006, que não se inclui em nenhuma das hipóteses de exclusão previstas nessa Lei Complementar e que está apta a usufruir do tratamento diferenciado e favorecido nela estabelecido.',
      [/microempresa|empresa de pequeno porte/, /\bme\s*\/\s*epp\b/, /(lei complementar|\blc)\W*(n\W*)?123/, /\benquadra/, /tratamento (diferenciado|favorecido)/]),
    // conferir artigo: hipótese de desenquadramento/exclusão dentro da LC 123/2006.
    m('ME_EPP_DESENQUADRAMENTO', 'Declaração de desenquadramento da condição de ME/EPP', 'me_epp', 'LC 123/2006',
      'que deixou de se enquadrar na condição de microempresa ou empresa de pequeno porte, nos termos da Lei Complementar nº 123/2006, e que não fará uso do tratamento diferenciado e favorecido previsto para essas empresas no presente certame.',
      [/desenquadra/, /simples nacional/, /exclus\w+ do simples/, /\bme\s*\/\s*epp\b/, /microempresa|empresa de pequeno porte/]),
    m('HAB_RESERVA_PCD', 'Declaração de cumprimento da reserva de cargos para PcD e reabilitados', 'habilitacao', 'Lei 14.133/2021, art. 63, IV; Lei 8.213/1991, art. 93',
      'que cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas específicas.',
      [/pessoas? com deficiencia|\bpcd\b/, /reabilitad/, /reserva de cargos/, /8\.?213/, /63,?\s*(inciso\s*)?iv\b/]),
    m('PROP_CUSTOS_TRABALHISTAS', 'Declaração de que a proposta compreende os custos trabalhistas', 'proposta', 'Lei 14.133/2021, art. 63, § 1º',
      'que sua proposta econômica compreende a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal, nas leis trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes na data de entrega da proposta.',
      [/direitos trabalhistas/, /convenc\w+ coletiv/, /normas infralegais/, /custos?\b.{0,60}trabalhist/]),
    // conferir artigo: base genérica (CF e impedimentos da 14.133).
    m('TRAB_DEGRADANTE', 'Declaração de ausência de trabalho degradante ou forçado', 'trabalhista', 'Constituição Federal e Lei 14.133/2021',
      'que não possui, em sua cadeia produtiva, empregados executando trabalho degradante ou forçado, e que não utiliza mão de obra em condições análogas às de escravo.',
      [/trabalho degradante/, /trabalho forcado|degradante ou forcado/, /analog\w*\W+(a|as)\W+(de\W+)?escrav/]),
    // conferir artigo: parágrafo do art. 63 sobre vistoria (provável § 2º).
    m('EXEC_VISTORIA_REALIZADA', 'Declaração de vistoria realizada', 'execucao', 'Lei 14.133/2021, art. 63',
      'que, por intermédio de seu representante ou responsável técnico, realizou vistoria no local de execução do objeto, tendo tomado conhecimento de todas as informações e condições locais necessárias à elaboração da proposta e ao cumprimento das obrigações.',
      [/vistori(ou|ado|ada|amos)\b|realiz\w+\W+(a\W+)?(vistoria|visita)/, /vistori/, /visita tecnica/, /local da obra|local dos servicos|local de execucao/]),
    // conferir artigo: parágrafos do art. 63 sobre substituição da vistoria por declaração (prováveis §§ 2º e 3º).
    m('EXEC_VISTORIA_DISPENSA', 'Declaração de dispensa de vistoria', 'execucao', 'Lei 14.133/2021, art. 63',
      'que optou por não realizar a vistoria no local de execução do objeto, que tem pleno conhecimento das condições e peculiaridades inerentes à natureza do trabalho e que assume total responsabilidade por esse fato, não podendo alegar desconhecimento das condições locais para pleitear alteração da proposta ou do contrato.',
      [/vistori|visita tecnica/, /(dispens|renunci|abri\w+\W+mao)\w*\W+(a\W+|da\W+|de\W+|realizar\W+)?(vistoria|visita)/, /nao\W+(realiz|efetu)\w*\W+(a\W+)?(vistoria|visita)/, /condic\w+ locais/, /local da obra|local dos servicos|local de execucao/]),
    // conferir artigo: mesmo tema da vistoria no art. 63.
    m('EXEC_CIENCIA_CONDICOES', 'Declaração de ciência das condições locais e do edital', 'execucao', 'Lei 14.133/2021, art. 63',
      'que tomou conhecimento de todas as informações e condições locais para o cumprimento das obrigações objeto da licitação, bem como de todas as condições estabelecidas no edital e em seus anexos.',
      [/condic\w+ locais/, /conhec\w*\b.{0,60}(local|condic)/, /tomou conhecimento|ciencia (de|das|do)\b/]),
    // conferir artigo: impedimento por vínculo de parentesco com agente público na 14.133.
    m('IMP_PARENTESCO', 'Declaração de inexistência de parentesco com agente público', 'impedimentos', 'Lei 14.133/2021 (impedimentos de participação)',
      'que não possui, entre seus sócios, administradores ou empregados, cônjuge, companheiro ou parente em linha reta, colateral ou por afinidade, até o terceiro grau, de agente público que atue no órgão licitante, que desempenhe função no presente certame ou que atue na fiscalização ou na gestão do contrato.',
      [/parentesco/, /parente/, /conjuge|companheir/, /terceiro grau/, /afinidade/]),
    // conferir artigo: vedação de servidor/dirigente do órgão no quadro da licitante na 14.133.
    m('IMP_SERVIDOR', 'Declaração de que não possui servidor público no quadro', 'impedimentos', 'Lei 14.133/2021 (impedimentos de participação)',
      'que não possui, em seu quadro societário ou de pessoal, servidor público ou dirigente do órgão licitante, nem pessoa que com eles mantenha vínculo vedado pela legislação aplicável.',
      [/servidor/, /servidor(es)?\W+(publico|do orgao|da ativa)/, /quadro (societario|de pessoal|funcional)/, /dirigente/]),
    // conferir artigo: inciso do art. 60 (critério de desempate) relativo a programa de integridade.
    m('DESEMP_INTEGRIDADE', 'Declaração de programa de integridade', 'desempate', 'Lei 14.133/2021, art. 60 (desempate)',
      'que possui programa de integridade implantado, nos termos da regulamentação aplicável, e que se compromete a comprová-lo sempre que solicitado.',
      [/programa de integridade/, /integridade/, /compliance/]),
    // conferir artigo: inciso do art. 60 (critério de desempate) relativo a equidade entre homens e mulheres.
    m('DESEMP_EQUIDADE', 'Declaração de ações de equidade entre homens e mulheres', 'desempate', 'Lei 14.133/2021, art. 60 (desempate)',
      'que desenvolve ações de equidade entre homens e mulheres no ambiente de trabalho, conforme regulamento, e que se compromete a comprová-las sempre que solicitado.',
      [/equidade/, /entre homens e mulheres/, /(igualdade|equidade) de genero/]),
    // conferir artigo: base genérica (desenvolvimento nacional sustentável na 14.133).
    m('AMB_SUSTENTABILIDADE', 'Declaração de sustentabilidade e compromisso ambiental', 'ambiental', 'Lei 14.133/2021 (desenvolvimento nacional sustentável)',
      'que adota práticas de sustentabilidade ambiental em suas atividades, observa a legislação ambiental vigente e se compromete a cumprir os critérios de sustentabilidade previstos no edital, inclusive quanto à destinação adequada de resíduos.',
      [/ambienta/, /meio ambiente/, /sustentab/, /residuos|logistica reversa/]),
    // conferir artigo: base genérica (obrigações do contratado na 14.133).
    m('EXEC_RESPONSABILIDADE', 'Declaração de responsabilidade pelo cumprimento do contrato', 'execucao', 'Lei 14.133/2021 (execução do contrato)',
      'que, caso seja vencedora, assume integral responsabilidade pelo fiel cumprimento das obrigações decorrentes do contrato, inclusive pela qualidade do objeto e pelos encargos trabalhistas, previdenciários, fiscais e comerciais resultantes de sua execução.',
      [/responsabilidade\W+(pelo|pela|integral)/, /fiel\W+(cumprimento|execucao)/, /cumprimento\W+(do\W+contrat|das obrigacoes contratuais)/, /obrigacoes contratuais/]),
    m('INT_ANTICORRUPCAO', 'Declaração de atendimento à Lei Anticorrupção', 'integridade', 'Lei 12.846/2013',
      'que conhece e observa a Lei nº 12.846/2013, que não praticou e se compromete a não praticar atos lesivos contra a administração pública, nacional ou estrangeira, e que mantém conduta ética em todas as fases da licitação e da execução contratual.',
      [/anticorrupcao/, /12\.?846/, /atos lesivos/, /corrupcao/]),
    // conferir artigo: artigo da habilitação fiscal, social e trabalhista na 14.133 (provável art. 68).
    m('HAB_REGULARIDADE', 'Declaração de regularidade fiscal e trabalhista', 'habilitacao', 'Lei 14.133/2021 (habilitação fiscal, social e trabalhista)',
      'que se encontra em situação regular perante as Fazendas federal, estadual e municipal, a Seguridade Social, o Fundo de Garantia do Tempo de Serviço (FGTS) e a Justiça do Trabalho, e que se compromete a manter essa condição durante toda a execução do contrato.',
      [/regularidade fiscal/, /regularidade\W+(social\W+e\W+)?trabalhista/, /\bfgts\b/, /debitos trabalhistas|\bcndt\b/]),
  ]);

  const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');

  const listarModelos = () => MODELOS;
  const obterModelo = (codigo) => MODELOS.find((x) => x.codigo === codigo) || null;

  // Dados são texto puro: sem interpretar HTML (quem exibe escapa), uma passada só (valor com "{{x}}" não é re-substituído)
  // e sem caracteres de controle. Variável fora da lista permitida fica como está (texto literal do edital).
  function preencher(modelo, dados) {
    const faltando = [];
    const d = dados || {};
    const texto = String((modelo && modelo.texto) || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (todo, nome) => {
      if (!VARIAVEIS.includes(nome)) return todo;
      // eslint-disable-next-line no-control-regex -- limpa controle de texto livre
      const v = d[nome] === null || d[nome] === undefined ? '' : String(d[nome]).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
      if (v) return v;
      if (!faltando.includes(nome)) faltando.push(nome);
      return VAZIO;
    });
    return { texto, faltando };
  }

  // Mais padrões acertados = mais específico. Empate exato: vale a ordem da biblioteca (determinístico).
  function escolherModelo(exigenciaTexto) {
    const t = normalizar(exigenciaTexto);
    let melhor = null, acertos = 0;
    for (const mod of MODELOS) {
      const n = mod.padroes.filter((p) => p.test(t)).length;
      if (n > acertos) { melhor = mod; acertos = n; }
    }
    return melhor;
  }

  const ANEXO = /^[ \t]*ANEXO(?=[ \t]+[IVXLC\d]+\b|[ \t]*[-–—:.]|[ \t]*$)/gm;
  // Declaração numerada dentro de um anexo: "DECLARAÇÃO I", "DECLARAÇÃO Nº 2" ou "1) Declaro", "II – DECLARAÇÃO".
  const NUMERADA = /^[ \t]*(?:declara[cç][aã]o\s+(?:n[º°o.]*\s*)?(?:[ivxlc]+|\d+)\b|(?:\d{1,2}|[ivxlc]{1,5})\s*[).–—-]\s*declar)/gim;

  // Fatias literais de `t` entre os inícios dados; posicao = deslocamento no texto original, sem o espaço inicial.
  function fatias(t, inicios, fim) {
    return inicios.map((ini, k) => {
      const bruto = t.slice(ini, k + 1 < inicios.length ? inicios[k + 1] : fim);
      const texto = bruto.trim();
      return { titulo: texto.split(/\r?\n/)[0].trim(), texto, origem: 'edital', posicao: ini + bruto.indexOf(texto[0]) };
    });
  }

  // Todo bloco que começa num título "ANEXO <nº>" (maiúsculo, no início da linha) com "MODELO(S) DE DECLARAÇÃO(ÕES)"
  // nas 3 primeiras linhas, até o próximo título ANEXO. Anexo com 2+ declarações numeradas vira um item por declaração.
  // Texto literal do edital (tem prioridade sobre a biblioteca). Nenhum anexo de modelo: lista vazia.
  function detectarModeloDoEdital(textoAnexo) {
    const t = String(textoAnexo || '');
    const inicios = [...t.matchAll(ANEXO)].map((x) => x.index);
    const saida = [];
    for (const [k, ini] of inicios.entries()) {
      const fim = k + 1 < inicios.length ? inicios[k + 1] : t.length;
      const bloco = t.slice(ini, fim);
      if (!/modelos? de declarac/.test(normalizar(bloco.split(/\r?\n/).slice(0, 3).join(' ')))) continue;
      const numeradas = [...bloco.matchAll(NUMERADA)].map((x) => ini + x.index);
      saida.push(...fatias(t, numeradas.length >= 2 ? numeradas : [ini], fim));
    }
    return saida;
  }

  const api = { VARIAVEIS, VAZIO, listarModelos, obterModelo, preencher, escolherModelo, detectarModeloDoEdital, normalizar };
  global.LicitaDeclaracoes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
