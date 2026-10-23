const normalizar = (texto) => String(texto || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const LISTAS = ["documentosCredenciamento", "documentosHabilitacao", "requisitosProposta", "declaracoesExigidas"];
const TEMAS = [/certificado(?:s)? digital(?:is)?/, /falencia/, /recuperacao judicial/];
const { conferirFatosDocumentais } = require("./_resumo_documental");
const { validarFatosDaFonte, completarDossieDaFonte } = require("./_edital_operacional");

// shortcut: bloqueia os temas sem suporte encontrados na auditoria; não substitui revisão semântica de todas as cláusulas.
function conferirEvidenciasDoResumo(dossie) {
  if (!dossie?.textoEdital || !dossie?.estrutura) return dossie;
  const resultado = globalThis.structuredClone(dossie);
  const estrutura = resultado.estrutura;
  const fonte = normalizar(resultado.textoEdital);
  const compativel = ["mistral", "openrouter", "cloudflare"].includes(resultado.provedorIA);
  const enviados = compativel ? Math.min(resultado.textoEdital.length, 200000) : resultado.textoEdital.length;
  if (resultado.provedorIA) estrutura.coberturaSintese = { ...estrutura.coberturaSintese, parcial: enviados < resultado.textoEdital.length, caracteresFonte: resultado.textoEdital.length, caracteresEnviados: enviados };
  const removidas = resultado.validacaoExigencias?.removidas || [];
  for (const campo of LISTAS) {
    if (!Array.isArray(estrutura[campo])) continue;
    estrutura[campo] = estrutura[campo].filter((item) => {
      const texto = typeof item === "string" ? item : item?.texto;
      const semFonte = TEMAS.filter((tema) => tema.test(normalizar(texto)) && !tema.test(fonte));
      if (!semFonte.length) return true;
      removidas.push({ campo, texto, motivo: "Tema da exigência não localizado no texto oficial lido" });
      return false;
    });
  }
  if (removidas.length) resultado.validacaoExigencias = { metodo: "temas_sem_suporte_na_fonte", removidas };
  const observacoes = [estrutura.resumoGeral, ...(estrutura.pendenciasParaConferencia || [])].map(normalizar);
  if (observacoes.some((texto) => /(?:apenas|somente|so) (?:o |um |os )?(?:extrato\/?aviso|extrato|aviso)\b/.test(texto))) {
    estrutura.coberturaLeitura = { ...estrutura.coberturaLeitura, parcial: true, editalIntegralAusente: true };
  }
  completarDossieDaFonte(estrutura, resultado.textoEdital);
  const conferido = conferirFatosDocumentais(resultado);
  validarFatosDaFonte(conferido.estrutura, conferido.textoEdital, { campos: ["identificacao.modalidade", "identificacao.numero", "detalhes.valorEstimado"] });
  return conferido;
}

module.exports = { conferirEvidenciasDoResumo };
