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
  let documento = "", bloco = "";
  const partes = texto.split(/(?=^--- .+ ---$)/m).flatMap((fonte) => /^\[Página \d+\]$/m.test(fonte)
    ? fonte.split(/(?=^--- .+ ---$|^\[Página \d+\]$)/m)
    : dividirSemPaginas(fonte, limite - (fonte.match(/^--- .+ ---$/m)?.[0].length || 0) - 1, (parte) => cabe(`${fonte.match(/^--- .+ ---$/m)?.[0] || ""}\n${parte}`)));
  for (const parte of partes) {
    const marcador = parte.match(/^--- .+ ---$/m)?.[0];
    if (marcador) documento = marcador;
    if (!cabe(`${documento}\n${parte}`)) throw new Error("Uma página excede o limite de análise por etapa. É necessário dividir o documento na origem.");
    if (bloco && !cabe(bloco + parte)) {
      blocos.push(bloco); bloco = documento ? `${documento}\n` : "";
    }
    bloco += parte;
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

function dividirPaginaDensa(bloco) {
  if (bloco.length <= 1200) return [];
  const documento = bloco.match(/^--- .+ ---$/m)?.[0] || "";
  const pagina = bloco.match(/^\[Página \d+\]$/m)?.[0] || "";
  const candidatos = [];
  const semMarcadores = (parte) => parte.replace(/^--- .+ ---$|^\[Página \d+\]$|^\[EXIGÊNCIA .+\]$/gm, "").trim();
  for (const marco of bloco.matchAll(/^\[EXIGÊNCIA .+\]$|\n[ \t]*\n/gm)) {
    const corte = marco[0].startsWith("[") ? marco.index : marco.index + marco[0].length;
    const esquerda = bloco.slice(0, corte), restante = bloco.slice(corte);
    if (!semMarcadores(esquerda) || !semMarcadores(restante)) continue;
    const ativa = [...esquerda.matchAll(/^\[EXIGÊNCIA .+\]$/gm)].at(-1)?.[0];
    const prefixo = [documento, pagina, !restante.trimStart().startsWith("[EXIGÊNCIA ") ? ativa : ""].filter(Boolean).join("\n") + "\n";
    const direita = prefixo + restante;
    const maior = Math.max(Buffer.byteLength(esquerda), Buffer.byteLength(direita));
    if (maior < Buffer.byteLength(bloco)) candidatos.push({ partes: [esquerda, direita], maior });
  }
  return candidatos.sort((a, b) => a.maior - b.maior)[0]?.partes || [];
}

function dividirBlocoRejeitado(bloco, permitirPaginaDensa = false) {
  const tamanho = Buffer.byteLength(bloco, "utf8");
  const candidatos = [];
  for (const marcador of bloco.matchAll(/^(?:--- .+ ---|\[Página \d+\])$/gm)) {
    if (!marcador.index) continue;
    const esquerda = bloco.slice(0, marcador.index);
    const direita = bloco.slice(marcador.index);
    if (!esquerda.replace(/^--- .+ ---$|^\[Página \d+\]$/gm, "").trim()) continue;
    const documento = [...esquerda.matchAll(/^--- .+ ---$/gm)].at(-1)?.[0];
    const partes = [esquerda, direita.startsWith("--- ") || !documento ? direita : `${documento}\n${direita}`];
    const tamanhos = partes.map((parte) => Buffer.byteLength(parte, "utf8"));
    if (tamanhos.every((bytes) => bytes < tamanho)) candidatos.push({ partes, maior: Math.max(...tamanhos) });
  }
  if (candidatos.length) return candidatos.sort((a, b) => a.maior - b.maior)[0].partes;
  // Truncamento comprovado permite dividir uma página em parágrafos íntegros.
  // Para recusa de entrada, PDF permanece indivisível. DOCX admite redução por parágrafo,
  // mas o mínimo impede centenas de tentativas quando o próprio prompt é recusado.
  if (/^\[Página \d+\]$/m.test(bloco)) return permitirPaginaDensa ? dividirPaginaDensa(bloco) : [];
  if (bloco.length <= 4000) return [];
  const documento = bloco.match(/^--- .+ ---$/m)?.[0];
  return dividirSemPaginas(bloco, Math.ceil(bloco.length / 2)).map((parte, i) => i && documento ? `${documento}\n${parte}` : parte);
}

function reduzirEtapaRecusada(estado) {
  const indice = estado.resultados.length;
  const partes = dividirBlocoRejeitado(estado.blocos[indice], estado.diagnostico?.finalizacao === "length");
  if (partes.length < 2) {
    estado.falhas = 3;
    estado.ultimoErro = "O provedor não concluiu nem a menor parte segura do documento. A análise foi interrompida; os resultados já salvos foram preservados.";
    return;
  }
  estado.blocos.splice(indice, 1, ...partes);
  estado.falhas = 0;
}

function respostaProgresso(estado, agora = Date.now()) {
  return { emProcessamento: true, progresso: {
    concluidas: estado.resultados.length, total: estado.blocos.length,
    aguardarSegundos: Math.max(1, Math.ceil(((estado.proximaEtapaEm || agora) - agora) / 1000)),
  }, resposta: `Análise dos documentos: ${estado.resultados.length} de ${estado.blocos.length} etapas concluídas.`, estrutura: null, fonteLida: true, erro: null };
}

async function executarEtapa({ store, chave, inicial, executar, usuario, autorizar, dividir = dividirFonte, permitirDivisao = true, retomar = false, agora = Date.now() }) {
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
  const precisaReduzir = () => permitirDivisao && (estado.diagnostico?.status === 413 || estado.diagnostico?.finalizacao === "length");
  if (retomar && estado.falhas >= 3 && !precisaReduzir()) {
    estado.falhas = 0;
    const retomada = await store.setJSON(chave, estado, { onlyIfMatch: registro.etag });
    if (!retomada.modified) return lerVencedor();
    if (!retomada.etag) throw new Error("Retomada sem identificador de versão.");
    registro = { data: estado, etag: retomada.etag };
  }
  if (estado.falhas >= 3 && !retomar) return { falhou: true, erro: estado.ultimoErro || "Esta etapa falhou três vezes. Tente novamente mais tarde.", estado };
  if (estado.proximaEtapaEm > agora) return { pendente: respostaProgresso(estado, agora), estado };
  // Reserva a etapa antes da chamada externa. CAS impede dois navegadores de
  // consumir simultaneamente a mesma etapa; a reserva expira após uma interrupção.
  const disponibilidadeAnterior = estado.proximaEtapaEm;
  estado.proximaEtapaEm = agora + INTERVALO_ETAPAS_MS;
  let reserva = await store.setJSON(chave, estado, { onlyIfMatch: registro.etag });
  if (!reserva.modified) return lerVencedor();
  if (!reserva.etag) throw new Error("Reserva sem identificador de versão.");
  if (precisaReduzir() && estado.falhas > 0) {
    // Retoma também jobs já interrompidos sem reenviar o payload recusado/truncado.
    reduzirEtapaRecusada(estado);
    const ajuste = await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
    if (!ajuste.modified) return lerVencedor();
    return estado.falhas >= 3 ? { falhou: true, erro: estado.ultimoErro, estado } : { pendente: respostaProgresso(estado), estado };
  }
  if (usuario && !(estado.usuariosComCota || []).includes(usuario)) {
    const cota = await autorizar();
    if (!cota.ok) {
      estado.proximaEtapaEm = disponibilidadeAnterior;
      await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
      return { falhou: true, erro: cota.erro, status: cota.status, estado };
    }
    // Persiste a cobrança antes da IA: retry e etapas seguintes usam a mesma cota.
    estado.usuariosComCota = [...(estado.usuariosComCota || []), usuario];
    reserva = await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
    if (!reserva.modified) return lerVencedor();
    if (!reserva.etag) throw new Error("Cota sem identificador de versão.");
  }
  const resposta = await executar(estado.blocos[estado.resultados.length], estado.resultados.length);
  if (resposta.quota) {
    // A cota é individual; não bloqueia o estado compartilhado do edital.
    estado.proximaEtapaEm = disponibilidadeAnterior;
    await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
    return { falhou: true, erro: resposta.erro, status: resposta.quota, estado };
  }
  if (resposta.estrutura) { estado.resultados.push(resposta.estrutura); estado.falhas = 0; delete estado.ultimaRespostaNaoEstruturada; }
  else {
    estado.falhas++;
    estado.ultimoErro = resposta.erro || "A síntese desta etapa não foi concluída.";
    estado.diagnostico = resposta.diagnostico || null;
    // Evidência temporária somente no job privado da leitura canônica. Não integra
    // respostaProgresso nem o JSON público; desaparece quando a etapa é concluída.
    if (resposta.diagnostico?.parsing && typeof resposta.texto === "string") estado.ultimaRespostaNaoEstruturada = resposta.texto.slice(0, 32000);
    if (precisaReduzir()) reduzirEtapaRecusada(estado);
  }
  const espera = Math.max(65, Number(resposta.diagnostico?.limites?.["retry-after"]) || 0);
  estado.proximaEtapaEm = Date.now() + espera * 1000;
  const conclusao = await store.setJSON(chave, estado, { onlyIfMatch: reserva.etag });
  if (!conclusao.modified) return lerVencedor();
  if (estado.resultados.length === estado.blocos.length) return { estrutura: conciliarEstruturas(estado.resultados), estado };
  if (estado.falhas >= 3) return { falhou: true, erro: estado.ultimoErro, estado };
  return { pendente: respostaProgresso(estado), estado };
}

module.exports = { dividirFonte, dividirBlocoRejeitado, conciliarEstruturas, respostaProgresso, executarEtapa };
