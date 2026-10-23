const fs = require('node:fs/promises');
const path = require('node:path');
const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

async function selecionarReferenciaPrivada(body, contexto, sessao, env = process.env) {
  const diretorio = env.DEFESA_MODELOS_PRIVADOS_DIRETORIO;
  if (!diretorio || !path.isAbsolute(diretorio) || !env.DEFESA_MODELOS_USUARIO_ID || sessao?.userId !== env.DEFESA_MODELOS_USUARIO_ID || !contexto.normas.length || (contexto.dispensa && body.tipo === 'impugnacao')) return undefined;
  try {
    const raiz = await fs.realpath(diretorio);
    const arquivo = await fs.realpath(path.join(raiz, 'catalogo-privado.json'));
    if (path.dirname(arquivo) !== raiz || (await fs.stat(arquivo)).size > 64000) return undefined;
    const catalogo = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    if (catalogo.versao !== 1 || catalogo.uso !== 'privado-local-sem-envio-a-IA' || !Array.isArray(catalogo.modelos) || catalogo.modelos.length > 6) return undefined;
    const intencao = normalizar(`${body.questionamento} ${body.objetivo || ''}`);
    const fontes = contexto.fontes.filter(f => !f.declarada).flatMap(f => normalizar(f.texto).split(/[.!?;]+\s*|\bmas\b|\bporem\b/));
    // Descritores são próprios e genéricos; os textos originais dos modelos nunca são lidos aqui.
    const regras = {
      'modelo-1': /qualificacao tecnica|conselho profissional|vinculo profissional|amostras/,
      'modelo-2': /\bcrea\b/,
      'modelo-3': /vinculo empregaticio|relacao empregaticia|carteira de trabalho/,
      'modelo-4': /amostras/,
      'modelo-5': /\bcra\b/,
      'modelo-6': /conselho profissional|registro profissional/,
    };
    const pertinente = id => {
      const relacionadas = fontes.filter(f => regras[id]?.test(f));
      const negativa = /dispensad|facultativ|sem (?:exigencia|obrigatoriedade)|apenas informativ|nao.{0,35}(?:exigid|necessari|obrigatori)/;
      const obrigatoria = /obrigatori|exig[eê]|exigid|devera|devem|apresentara/;
      return relacionadas.some(f => obrigatoria.test(f)) && !relacionadas.some(f => negativa.test(f));
    };
    const candidatos = catalogo.modelos.filter(m => regras[m?.id]?.test(intencao) && pertinente(m.id) &&
      typeof m.rotulo === 'string' && m.rotulo.length <= 160 && Array.isArray(m.dadosEspecificosNecessarios));
    candidatos.sort((a, b) => Number(a.id === 'modelo-1') - Number(b.id === 'modelo-1'));
    const modelo = candidatos[0];
    if (!modelo) return undefined;
    return { id: modelo.id, titulo: modelo.rotulo, referenciaPrivada: true,
      criterio: 'Tema solicitado também aparece nas evidências canônicas. Referência privada de organização da redação, não valida cabimento nem substitui fundamento oficial; conferir condições do caso.',
      camposPendentes: [...new Set(['confirmar cabimento, prazo e canal', ...modelo.dadosEspecificosNecessarios.filter(v => typeof v === 'string' && v.length <= 160)])].slice(0, 12) };
  } catch (_) {
    return undefined;
  }
}

module.exports = { selecionarReferenciaPrivada };
