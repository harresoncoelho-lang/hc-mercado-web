// Robô da esteira do edital (tarefa E7): executa as tarefas que o gatilho iniciar_esteira_processo
// (supabase/operacao_esteira.sql) cria quando um processo do PNCP entra no Funil.
// Uso: node scripts/esteira_processos.js
// Env obrigatória: SUPABASE_SERVICE_ROLE_KEY.
// Env opcionais: LOTE_ESTEIRA (5 tarefas por rodada), LIMITE_MINUTOS_ESTEIRA (10),
// MAX_TENTATIVAS_ESTEIRA (5), BACKOFF_MINUTOS_ESTEIRA (5, dobra a cada falha),
// ESPERA_DOSSIE_MINUTOS_ESTEIRA (30), ESPERA_LEITURA_HORAS_ESTEIRA (6),
// PAUSA_ITEM_MS_ESTEIRA (1500 entre itens do PNCP),
// ESTEIRA_SEGUNDA_PASSADA ("1" liga a segunda passada de IA; desligada por padrão).
//
// Etapas:
//   itens       lista os itens do PNCP e grava um a um por gravar_importacao_pncp (p_usuario = criado_por).
//               Retomável: pula itens já em operacao_origens_pncp. Pausa de 500 ms; teto de 1000 itens.
//               Item recusado de vez (HTTP 400 do RPC, 422 da fonte) vai para detalhe.recusados e é pulado.
//   exigencias  espera o dossiê (dossies_editais); junta regras + IA, classifica, marca incomum, mede
//               cobertura por documento e grava operacao_exigencias_processo (upsert; não toca resposta).
//               Declaração com modelo literal no anexo do edital leva modelo_texto + modelo_fonte {documento, pagina}.
//   cruzamento  é a view operacao_exigencias_situacao (calculada na leitura): só marca feito.
//   historico   licitação anterior do mesmo órgão e produto (scripts/historico_licitacoes.js): grava nas
//               tabelas historico_* e deixa o casamento item a item no detalhe. No fim da rodada, com tempo
//               sobrando, completa as consultas avulsas pendentes (participantes pelo arquivo de propostas)
//               e a fila da análise por CNPJ (scripts/analise_cnpj.js).
// Regra fixa: nunca grava em operacao_processos (atualizado_em é controle de concorrência do kit).
const { restFetch } = require("./supabase_dados");
const { buscarFonteItem, listarNumerosItens } = require("../netlify/functions/_pncp_item_fonte");
const { referencia } = require("../netlify/functions/importar-item-pncp");
const ex = require("../netlify/functions/_exigencias");
const { detectarModeloDoEdital, escolherModelo } = require("../declaracoes-modelos.js");
const historico = require("./historico_licitacoes");
const analiseCnpj = require("./analise_cnpj");

const LOTE = Math.max(1, Number(process.env.LOTE_ESTEIRA || 5));
const LIMITE_MS = Math.max(1, Number(process.env.LIMITE_MINUTOS_ESTEIRA || 10)) * 60000;
const MAX_TENTATIVAS = Math.max(1, Number(process.env.MAX_TENTATIVAS_ESTEIRA || 5));
const BACKOFF_MS = Math.max(1, Number(process.env.BACKOFF_MINUTOS_ESTEIRA || 5)) * 60000;
const ESPERA_DOSSIE_MS = Math.max(1, Number(process.env.ESPERA_DOSSIE_MINUTOS_ESTEIRA || 30)) * 60000;
const ESPERA_LEITURA_MS = Math.max(1, Number(process.env.ESPERA_LEITURA_HORAS_ESTEIRA || 6)) * 3600000;
// Reserva da tarefa: se o robô morrer no meio, a tarefa volta à fila quando a reserva vence.
const RESERVA_MS = LIMITE_MS + 5 * 60000;
// Não usa a cadência global de 7 s de reservar_importacao_pncp (essa é da tela): o robô roda
// serial, uma tarefa por vez, fora do horário de pico; a pausa própria basta para não pesar no PNCP.
const PAUSA_ITEM_MS = Math.max(0, Number(process.env.PAUSA_ITEM_MS_ESTEIRA ?? 1500));
const TETO_ITENS = 1000;
const MAX_ALERTAS_DETALHE = 20;

const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const q = encodeURIComponent;

class ErroPermanente extends Error {}

// Erro gravado na tarefa: curto e sem corpo de resposta (o corpo pode ecoar dados do processo).
function erroCurto(erro) {
  const m = String(erro?.message || erro || "erro desconhecido");
  const rest = /^Supabase REST ([^?\s]+)\S* -> HTTP (\d+)/.exec(m);
  return (rest ? `Supabase ${rest[1]} HTTP ${rest[2]}` : m).slice(0, 300);
}

// Backoff exponencial: 5, 10, 20, 40 min...; na 5ª falha vira 'falhou' e para de tentar.
function estadoAposFalha(tarefa, erro, agora) {
  const tentativas = (Number(tarefa.tentativas) || 0) + 1;
  const falhou = erro instanceof ErroPermanente || erro instanceof historico.ErroHistorico || tentativas >= MAX_TENTATIVAS;
  return { estado: falhou ? "falhou" : "pendente", tentativas, erro: erroCurto(erro),
    proximo_em: iso(agora + (falhou ? 0 : BACKOFF_MS * 2 ** (tentativas - 1))) };
}

async function json(rest, caminho, opcoes) {
  return (await rest(caminho, opcoes)).json();
}

// Candidatas: pendente/aguardando_leitura vencidas e 'executando' com reserva vencida (robô morto).
async function buscarCandidatas(rest, agora, lote = LOTE) {
  return json(rest, `operacao_esteira_tarefas?estado=in.(pendente,aguardando_leitura,executando)&proximo_em=lte.${q(iso(agora))}` +
    `&select=organizacao_id,empresa_id,processo_id,etapa,estado,tentativas,proximo_em,detalhe,criado_por&order=proximo_em.asc&limit=${lote}`);
}

// Reserva atômica: o PATCH só casa se estado e proximo_em ainda são os lidos. Dois robôs na mesma
// linha: o Postgres serializa o UPDATE e o segundo não encontra mais a condição (0 linhas).
// Reserva vencida = a rodada anterior morreu nessa tarefa: conta tentativa, para um item que
// derruba o processo acabar em 'falhou' em vez de repetir para sempre.
async function reservar(rest, tarefa, agora) {
  const tentativas = (Number(tarefa.tentativas) || 0) + (tarefa.estado === "executando" ? 1 : 0);
  const linhas = await json(rest, `operacao_esteira_tarefas?processo_id=eq.${q(tarefa.processo_id)}&etapa=eq.${q(tarefa.etapa)}` +
    `&estado=eq.${q(tarefa.estado)}&proximo_em=eq.${q(tarefa.proximo_em)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ estado: "executando", proximo_em: iso(agora + RESERVA_MS), tentativas }),
  });
  return Array.isArray(linhas) && linhas.length === 1 ? linhas[0] : null;
}

async function atualizarTarefa(rest, tarefa, campos) {
  await rest(`operacao_esteira_tarefas?processo_id=eq.${q(tarefa.processo_id)}&etapa=eq.${q(tarefa.etapa)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(campos),
  });
}

async function carregarProcesso(rest, tarefa) {
  const [p] = await json(rest, `operacao_processos?id=eq.${q(tarefa.processo_id)}&empresa_id=eq.${q(tarefa.empresa_id)}` +
    `&organizacao_id=eq.${q(tarefa.organizacao_id)}&select=id,empresa_id,organizacao_id,url_origem,origem_externa_id,numero`);
  if (!p) throw new ErroPermanente("Processo indisponível.");
  return p;
}

// Recusa permanente de UM item: validação do RPC (PT400 -> HTTP 400, inclusive número fora do integer) ou
// quantidade do PNCP sem representação (422 da fonte). 403/404/409 são do processo inteiro e seguem como falha.
function itemRecusado(erro) {
  return erro?.status === 422 || /^Supabase REST rpc\/gravar_importacao_pncp -> HTTP 400\b/.test(String(erro?.message || ""));
}

async function etapaItens(tarefa, { rest, fetchPncp, esperar, prazoFinal, agora }) {
  if (!tarefa.criado_por) throw new ErroPermanente("Tarefa sem usuário de origem para gravar os itens.");
  const p = await carregarProcesso(rest, tarefa);
  const ref = referencia(p);
  const compra = `${ref.cnpj}-1-${ref.seq}/${ref.ano}`;
  const numeros = await listarNumerosItens(ref.cnpj, ref.ano, ref.seq, { fetch: fetchPncp });
  // Truncar esconderia itens: acima do teto a tarefa falha com motivo claro, sem retentar.
  if (numeros.length > TETO_ITENS) throw new ErroPermanente(`Edital com ${numeros.length} itens, acima do teto de ${TETO_ITENS}; importe manualmente.`);
  const feitos = new Set((await json(rest, `operacao_origens_pncp?processo_id=eq.${q(p.id)}&compra=eq.${q(compra)}&select=numero_item`))
    .map((l) => l.numero_item));
  const detalhe = { total: numeros.length, importados: 0, jaImportados: 0, colisoesManuais: [], recusados: [], totalRecusados: 0 };
  const escopo = { p_usuario: tarefa.criado_por, p_empresa: p.empresa_id, p_processo: p.id, p_organizacao: p.organizacao_id };
  const p_referencia = { url_origem: p.url_origem || null, origem_externa_id: p.origem_externa_id || null, numero: p.numero || null };
  let primeiro = true;
  for (const numero of numeros) {
    if (feitos.has(numero)) { detalhe.jaImportados += 1; continue; }
    if (!primeiro) await esperar(PAUSA_ITEM_MS);
    primeiro = false;
    if (agora() >= prazoFinal) return { parcial: true, detalhe };
    let r;
    try {
      const { url, item, hash, snapshot } = await buscarFonteItem(ref, numero, { fetchImpl: fetchPncp });
      r = await json(rest, "rpc/gravar_importacao_pncp", { method: "POST", body: JSON.stringify({ ...escopo,
        p_compra: compra, p_numero: numero, p_url: url, p_hash: hash, p_item: item, p_snapshot: snapshot, p_referencia }) });
    } catch (erro) {
      // Item recusado de vez (dado do item inválido): registra e segue. Repetir não muda nada e travaria a tarefa.
      if (!itemRecusado(erro)) throw erro;
      detalhe.totalRecusados += 1;
      if (detalhe.recusados.length < MAX_ALERTAS_DETALHE) detalhe.recusados.push({ numero, erro: erroCurto(erro) });
      continue;
    }
    // Item manual com o mesmo número: não liga sozinho (regra do RPC); fica registrado para o usuário.
    if (r?.estado === "colisao_manual") detalhe.colisoesManuais.push(numero);
    else if (!r || !["importado", "inalterado", "fonte_alterada"].includes(r.estado)) throw new Error(`Gravação do item ${numero} não confirmada.`);
    else detalhe.importados += 1;
  }
  return { detalhe };
}

// Esqueleto da segunda passada (ESTEIRA_SEGUNDA_PASSADA=1). Sem provedor injetado não chama IA nenhuma.
async function segundaPassada(textoFonte, textoPorDocumento, chamarIA) {
  const { blocos, omitidos } = ex.blocosParaSegundaPassada(textoPorDocumento);
  if (!blocos.length || typeof chamarIA !== "function") return { aceitas: [], descartadas: 0, omitidos: omitidos.length, blocos: blocos.length };
  const { aceitas, descartadas } = ex.validarSegundaPassada(await chamarIA(blocos), textoFonte);
  return { aceitas: aceitas.map((a, i) => ({ ...a, id: ex.codigoEstavel("SP", a.trechoLiteral), trecho: a.trechoLiteral })),
    descartadas: descartadas.length, omitidos: omitidos.length, blocos: blocos.length };
}

const textoOuNulo = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function linhaExigencia(tarefa, e, geradoEm) {
  const pagina = Number(e.pagina);
  return { organizacao_id: tarefa.organizacao_id, empresa_id: tarefa.empresa_id, processo_id: tarefa.processo_id,
    codigo: String(e.id).slice(0, 40), categoria: e.categoria || ex.classificar(e), texto: textoOuNulo(e.texto, 2000),
    documento: textoOuNulo(e.documento, 300), pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : null,
    trecho: textoOuNulo(e.trecho, 1200), origem: e.origem, incomum: Boolean(e.incomum),
    motivo_incomum: textoOuNulo(e.motivoIncomum, 500), gerado_em: geradoEm };
}

// Modelo literal do edital (anexo "MODELO DE DECLARAÇÃO"), por documento. Texto externo: só vira texto
// (sem controle, sem marcação de página, teto de tamanho); quem gera a peça ainda escapa "{{" e o usuário revisa.
const MAX_MODELO = 18000; // abaixo dos 20000 do rascunho: o preenchimento das lacunas aumenta o texto.
function modelosDoEdital(textoPorDocumento) {
  const saida = [];
  for (const [documento, texto] of Object.entries(textoPorDocumento)) {
    for (const m of detectarModeloDoEdital(texto)) {
      const pagina = Number([...texto.slice(0, m.posicao + 1).matchAll(/^\[Página (\d+)\]\s*$/gm)].pop()?.[1]) || null;
      // eslint-disable-next-line no-control-regex -- PDF extraído traz \f e afins, que o rascunho recusa
      const limpo = m.texto.replace(/^\[Página \d+\]\s*$/gm, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (!limpo || limpo.length > MAX_MODELO) continue;
      saida.push({ texto: limpo, documento: documento.slice(0, 300), pagina, codigo: escolherModelo(limpo.slice(0, 1500))?.codigo || null });
    }
  }
  return saida;
}

// Casa exigência de declaração e modelo do edital pelo mesmo tema da biblioteca.
// shortcut: exigência genérica ("declarações do Anexo III") ou modelo sem tema reconhecido não casa e cai na biblioteca; casar pela referência ao anexo se isso aparecer nos editais reais.
function modeloDaExigencia(l, modelos) {
  const codigo = l.categoria === "declaracao" && modelos.length ? escolherModelo(`${l.texto} ${l.trecho || ""}`)?.codigo : null;
  const m = codigo && modelos.find((x) => x.codigo === codigo);
  return m ? { modelo_texto: m.texto, modelo_fonte: { documento: m.documento, pagina: m.pagina } } : { modelo_texto: null, modelo_fonte: null };
}

// Só a coluna uf_sede: o perfil guarda CPF e banco, que o robô nunca lê. Banco sem a coluna
// (operacao_perfil_empresa.sql antigo) ou falha na leitura: segue sem UF, como antes.
async function lerUfSede(rest, tarefa) {
  try {
    const [p] = await json(rest, `operacao_perfil_empresa?empresa_id=eq.${q(tarefa.empresa_id)}&organizacao_id=eq.${q(tarefa.organizacao_id)}&select=uf_sede`);
    return typeof p?.uf_sede === "string" ? p.uf_sede : undefined;
  } catch { return undefined; }
}

async function etapaExigencias(tarefa, { rest, agora, segundaPassadaLigada, chamarIA }) {
  const processo = await carregarProcesso(rest, tarefa);
  const [linha] = await json(rest, `dossies_editais?numero_controle_pncp=eq.${q(processo.origem_externa_id)}&select=status,versao,dossie`);
  const dossie = linha?.dossie;
  if (typeof dossie?.textoEdital !== "string" || !dossie.textoEdital.trim()) return { esperarDossie: true };
  const textoFonte = dossie.textoEdital;
  const textoPorDocumento = ex.separarPorDocumento(textoFonte);
  const { exigencias, avisos } = ex.juntarExigencias({ dossieIA: dossie, textoFonte });
  let todas = exigencias;
  let resumoSegunda = null;
  if (segundaPassadaLigada) {
    resumoSegunda = await segundaPassada(textoFonte, textoPorDocumento, chamarIA);
    todas = [...exigencias, ...resumoSegunda.aceitas.map((a) => ({ ...a, categoria: ex.classificar(a) }))];
    delete resumoSegunda.aceitas;
  }
  const marcadas = ex.marcarIncomuns(todas, { ufSede: await lerUfSede(rest, tarefa) });
  const cobertura = ex.coberturaPorDocumento({ documentos: dossie.estrutura?.coberturaLeitura, exigencias: marcadas, textoPorDocumento });
  const etapa = ex.estadoDaEtapa(cobertura);
  const geradoEm = iso(agora());
  const atuais = await json(rest, `operacao_exigencias_processo?processo_id=eq.${q(tarefa.processo_id)}&select=codigo,origem,tipo_documento`);
  // Sem coluna de origem do tipo: o já gravado (por quem for) vence; o mapeamento só preenche vazio.
  // PostgREST exige as mesmas chaves em todas as linhas do lote, então tipo_documento vai sempre.
  const tipoAtual = new Map(atuais.map((l) => [l.codigo, l.tipo_documento]));
  const linhas = marcadas.map((e) => linhaExigencia(tarefa, e, geradoEm)).filter((l) => l.texto)
    .map((l) => ({ ...l, tipo_documento: tipoAtual.get(l.codigo) || ex.tipoDocumentoDaExigencia(l.texto, l.categoria) }));
  const modelos = modelosDoEdital(textoPorDocumento);
  for (const l of linhas) Object.assign(l, modeloDaExigencia(l, modelos));
  // Exigência que não consta mais na leitura nova não é apagada (pode ter resposta); só fica listada.
  const novos = new Set(linhas.map((l) => l.codigo));
  const removidas = atuais.filter((l) => l.origem !== "manual").map((l) => l.codigo).filter((c) => !novos.has(c));
  // Idempotente: upsert por (processo_id, codigo) sem a coluna resposta, que é do usuário.
  if (linhas.length) {
    await rest("operacao_exigencias_processo?on_conflict=processo_id,codigo", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(linhas),
    });
  }
  return { aguardandoLeitura: etapa.estado === "aguardando_leitura", detalhe: {
    situacao: etapa.estado, mensagem: etapa.mensagem, exigencias: linhas.length, incomuns: linhas.filter((l) => l.incomum).length,
    naoLidos: etapa.naoLidos, alertas: etapa.alertas.slice(0, MAX_ALERTAS_DETALHE).map(({ documento, pagina, mensagem }) => ({ documento, pagina, mensagem })),
    totalAlertas: etapa.alertas.length, avisos, removidas, modelosDoEdital: linhas.filter((l) => l.modelo_texto).length, dossie: { status: linha.status, versao: linha.versao },
    ...(resumoSegunda ? { segundaPassada: resumoSegunda } : {}) } };
}

async function executarTarefa(tarefa, deps) {
  const { rest, agora } = deps;
  try {
    if (tarefa.etapa === "itens") {
      const r = await etapaItens(tarefa, deps);
      // Tempo da rodada acabou: devolve à fila sem gastar tentativa; a próxima rodada pula o já gravado.
      await atualizarTarefa(rest, tarefa, r.parcial ? { estado: "pendente", proximo_em: iso(agora()), detalhe: r.detalhe, erro: null }
        : { estado: "feito", detalhe: r.detalhe, erro: null });
      return r.parcial ? "parcial" : "feito";
    }
    if (tarefa.etapa === "exigencias") {
      const r = await etapaExigencias(tarefa, deps);
      if (r.esperarDossie) {
        await atualizarTarefa(rest, tarefa, { estado: "pendente", proximo_em: iso(agora() + ESPERA_DOSSIE_MS),
          detalhe: { ...(tarefa.detalhe || {}), situacao: "aguardando_dossie" } });
        return "aguardando_dossie";
      }
      await atualizarTarefa(rest, tarefa, r.aguardandoLeitura
        ? { estado: "aguardando_leitura", proximo_em: iso(agora() + ESPERA_LEITURA_MS), detalhe: r.detalhe, erro: null }
        : { estado: "feito", detalhe: r.detalhe, erro: null });
      return r.aguardandoLeitura ? "aguardando_leitura" : "feito";
    }
    if (tarefa.etapa === "historico") {
      const detalhe = await historico.etapaHistorico(tarefa, deps);
      await atualizarTarefa(rest, tarefa, { estado: "feito", detalhe, erro: null });
      return "feito";
    }
    if (tarefa.etapa === "cruzamento") {
      await atualizarTarefa(rest, tarefa, { estado: "feito", erro: null });
      return "feito";
    }
    throw new ErroPermanente(`Etapa desconhecida: ${tarefa.etapa}`);
  } catch (erro) {
    const novo = estadoAposFalha(tarefa, erro, agora());
    await atualizarTarefa(rest, tarefa, novo);
    console.warn(`[esteira] ${tarefa.etapa} ${tarefa.processo_id}: ${novo.erro} (tentativa ${novo.tentativas}, ${novo.estado})`);
    return novo.estado;
  }
}

async function rodar({ rest = restFetch, fetchPncp = (...a) => fetch(...a), esperar = esperarPadrao, agora = Date.now,
  segundaPassadaLigada = process.env.ESTEIRA_SEGUNDA_PASSADA === "1", chamarIA = null, lote = LOTE,
  completarConsultas = rest === restFetch } = {}) {
  const inicio = agora();
  const prazoFinal = inicio + LIMITE_MS;
  const contagem = {};
  const candidatas = await buscarCandidatas(rest, inicio, lote);
  for (const candidata of candidatas) {
    if (agora() >= prazoFinal) break;
    const tarefa = await reservar(rest, candidata, agora());
    if (!tarefa) { contagem.outroRobo = (contagem.outroRobo || 0) + 1; continue; }
    if (candidata.estado === "executando" && tarefa.tentativas >= MAX_TENTATIVAS) {
      await atualizarTarefa(rest, tarefa, { estado: "falhou", erro: "Execução interrompida repetidamente nesta etapa." });
      contagem.falhou = (contagem.falhou || 0) + 1;
      continue;
    }
    const resultado = await executarTarefa(tarefa, { rest, fetchPncp, esperar, agora, prazoFinal, segundaPassadaLigada, chamarIA });
    contagem[resultado] = (contagem[resultado] || 0) + 1;
  }
  // Consulta avulsa só com tempo sobrando: a tarefa do processo vem primeiro. Falha aqui não derruba a rodada.
  if (completarConsultas && agora() < prazoFinal) {
    try { contagem.consultasAvulsas = await historico.completarConsultas({ rest, fetchPncp }); } catch (erro) { console.warn(`[esteira] consultas avulsas: ${erroCurto(erro)}`); }
  }
  // Análise por CNPJ (fila da tela "Analisar concorrente"): retomável mês a mês, para no prazo da rodada.
  if (completarConsultas && agora() < prazoFinal) {
    try { contagem.analisesCnpj = await analiseCnpj.completarAnalises({ rest, fetchPncp, agora, prazoFinal }); } catch (erro) { console.warn(`[esteira] análise por CNPJ: ${erroCurto(erro)}`); }
  }
  console.log(`[esteira] ${candidatas.length} candidata(s): ${JSON.stringify(contagem)}`);
  return contagem;
}

if (require.main === module) {
  rodar().catch((erro) => { console.error(`[esteira] ${erroCurto(erro)}`); process.exitCode = 1; });
}

module.exports = { rodar, reservar, buscarCandidatas, executarTarefa, estadoAposFalha, erroCurto, linhaExigencia, modelosDoEdital, ErroPermanente,
  MAX_TENTATIVAS, TETO_ITENS };
