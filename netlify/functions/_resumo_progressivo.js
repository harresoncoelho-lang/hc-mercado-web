const INTERVALO_ETAPAS_MS = 65000;

function dividirSemPaginas(documento, limite, cabe = () => true) {
  const partes = [];
  let restante = documento;
  while (restante.length > limite || !cabe(restante)) {
    let inicio = 1, fim = Math.min(limite, restante.length), tamanho = 0;
    while (inicio <= fim) {
      const meio = Math.floor((inicio + fim) / 2);
      if (cabe(restante.slice(0, meio))) { tamanho = meio; inicio = meio + 1; }
      else fim = meio - 1;
    }
    if (!tamanho) throw new Error("As instruções excedem o orçamento da análise por etapa.");
    // DOCX não tem páginas estáveis: prioriza parágrafos, depois espaços para
    // um parágrafo excepcionalmente extenso. Não descarta nenhum caractere.
    let corte = restante.lastIndexOf("\n", tamanho - 1) + 1;
    if (corte < tamanho / 2) corte = restante.lastIndexOf(" ", tamanho - 1) + 1;
    if (corte < tamanho / 2) corte = tamanho;
    partes.push(restante.slice(0, corte)); restante = restante.slice(corte);
  }
  if (restante) partes.push(restante);
  return partes;
}

function dividirFonte(texto, limite = 45000, cabeRequisicao = () => true) {
  const cabe = (valor) => valor.length <= limite && cabeRequisicao(valor);
  const blocos = [];
  let documento = "", bloco = "", ultimaPagina = "";
  const partes = texto.split(/(?=^--- .+ ---$)/m).flatMap((fonte) => /^\[Página \d+\]$/m.test(fonte)
    ? fonte.split(/(?=^--- .+ ---$|^\[Página \d+\]$)/m)
    : dividirSemPaginas(fonte, limite - (fonte.match(/^--- .+ ---$/m)?.[0].length || 0) - 1, (parte) => cabe(`${fonte.match(/^--- .+ ---$/m)?.[0] || ""}\n${parte}`)));
  for (const parte of partes) {
    const marcador = parte.match(/^--- .+ ---$/m)?.[0];
    if (marcador) documento = marcador;
    if (!cabe(`${documento}\n${parte}`)) throw new Error("Uma página excede o limite de análise por etapa. É necessário dividir o documento na origem.");
    if (bloco && !cabe(bloco + parte)) {
      blocos.push(bloco); bloco = documento ? `${documento}\n` : "";
      if (cabe(bloco + ultimaPagina + parte)) bloco += ultimaPagina;
    }
    bloco += parte;
    if (/^\[Página \d+\]/.test(parte)) ultimaPagina = parte;
    if (marcador) ultimaPagina = "";
  }
  if (bloco) blocos.push(bloco);
  return blocos;
}

function conciliarEstruturas(estruturas) {
  const util = (valor) => typeof valor === "string" && valor.trim() && !/^(não informado|nao informado|não identificado|não consta|não localizado|n\/a)[.\s]*$/i.test(valor.trim());
  const unir = (valores) => {
    if (valores.some(Array.isArray)) return [...new Set(valores.flatMap((v) => Array.isArray(v) ? v : []).filter(util))];
    if (valores.some((v) => v && typeof v === "object")) {
      const objetos = valores.filter((v) => v && typeof v === "object" && !Array.isArray(v));
      return Object.fromEntries([...new Set(objetos.flatMap(Object.keys))].map((chave) => [chave, unir(objetos.map((obj) => obj[chave]))]));
    }
    const textos = [...new Set(valores.filter(util).map((v) => v.trim()))];
    // Mantém todas as formulações: a conciliação não escolhe silenciosamente
    // uma data, condição ou valor em detrimento de outra fonte.
    return textos.length > 1 ? textos.map((v, i) => `Referência ${i + 1}: ${v}`).join("\n") : textos[0] || "Não informado";
  };
  const resultado = unir(estruturas);
  resultado.pendenciasParaConferencia = [...(resultado.pendenciasParaConferencia || []), "Campos com mais de uma referência conservam as formulações encontradas nos documentos. Confira eventuais condições ou divergências entre elas."];
  return resultado;
}

function respostaProgresso(estado, agora = Date.now()) {
  return { emProcessamento: true, progresso: {
    concluidas: estado.resultados.length, total: estado.blocos.length,
    aguardarSegundos: Math.max(1, Math.ceil(((estado.proximaEtapaEm || agora) - agora) / 1000)),
  }, resposta: `Análise dos documentos: ${estado.resultados.length} de ${estado.blocos.length} etapas concluídas.`, estrutura: null, fonteLida: true, erro: null };
}

async function executarEtapa({ store, chave, inicial, executar, dividir = dividirFonte, retomar = false, agora = Date.now() }) {
  const lerVencedor = async () => {
    const vencedor = (await store.getWithMetadata(chave, { type: "json", consistency: "strong" }))?.data;
    if (!vencedor) throw new Error("Estado da análise indisponível.");
    return vencedor.resultados.length === vencedor.blocos.length
      ? { estrutura: conciliarEstruturas(vencedor.resultados), estado: vencedor }
      : { pendente: respostaProgresso(vencedor), estado: vencedor };
  };
  let registro = await store.getWithMetadata(chave, { type: "json", consistency: "strong" });
  if (!registro || registro.data.expiraEm <= agora) {
    const estado = { ...inicial, blocos: dividir(inicial.texto), resultados: [], falhas: 0, proximaEtapaEm: 0, expiraEm: agora + 86400000 };
    await store.setJSON(chave, estado, registro ? { onlyIfMatch: registro.etag } : { onlyIfNew: true });
    registro = await store.getWithMetadata(chave, { type: "json", consistency: "strong" });
  }
  if (!registro?.data) throw new Error("Não foi possível persistir a análise para retomada.");
  const estado = registro.data;
  if (estado.resultados.length === estado.blocos.length) return { estrutura: conciliarEstruturas(estado.resultados), estado };
  if (retomar && estado.falhas >= 3) {
    estado.falhas = 0;
    const retomada = await store.setJSON(chave, estado, { onlyIfMatch: registro.etag });
    if (!retomada.modified) return lerVencedor();
    if (!retomada.etag) throw new Error("Retomada sem identificador de versão.");
    registro = { data: estado, etag: retomada.etag };
  }
  if (estado.falhas >= 3) return { falhou: true, erro: "Esta etapa falhou três vezes. Tente novamente mais tarde.", estado };
  if (estado.proximaEtapaEm > agora) return { pendente: respostaProgresso(estado, agora), estado };
  // Reserva a etapa antes da chamada externa. CAS impede dois navegadores de
  // consumir simultaneamente a mesma etapa; a reserva expira após uma interrupção.
  const disponibilidadeAnterior = estado.proximaEtapaEm;
  estado.proximaEtapaEm = agora + INTERVALO_ETAPAS_MS;
  const reserva = await store.setJSON(chave, estado, { onlyIfMatch: registro.etag });
  if (!reserva.modified) return lerVencedor();
  if (!reserva.etag) throw new Error("Reserva sem identificador de versão.");
  const resposta = await executar(estado.blocos[estado.resultados.length], estado.resultados.length);
  if (resposta.quota) {
    // A cota é individual; não bloqueia o estado compartilhado do edital.
    estado.proximaEtapaEm = disponibilidadeAnterior;
    await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
    return { falhou: true, erro: resposta.erro, status: resposta.quota, estado };
  }
  if (resposta.estrutura) { estado.resultados.push(resposta.estrutura); estado.falhas = 0; }
  else {
    estado.falhas++;
    estado.ultimoErro = resposta.erro || "A síntese desta etapa não foi concluída.";
    estado.diagnostico = resposta.diagnostico || null;
  }
  const espera = Math.max(65, Number(resposta.diagnostico?.limites?.["retry-after"]) || 0);
  estado.proximaEtapaEm = Date.now() + espera * 1000;
  const conclusao = await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
  if (!conclusao.modified) return lerVencedor();
  if (estado.resultados.length === estado.blocos.length) return { estrutura: conciliarEstruturas(estado.resultados), estado };
  if (estado.falhas >= 3) return { falhou: true, erro: estado.ultimoErro, estado };
  return { pendente: respostaProgresso(estado), estado };
}

module.exports = { dividirFonte, conciliarEstruturas, respostaProgresso, executarEtapa };
