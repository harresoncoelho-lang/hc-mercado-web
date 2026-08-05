// Robo de coleta do Sistema S no Amazonas para o HC Licitacoes.
// Roda no GitHub Actions (cron diario) e grava data/sistema_s_am.json.
//
// Fontes (validadas manualmente - sem captcha, sem login, acesso publico):
//   1. SENAC/AM  - https://am.senac.br/licitacoes/            (paginado, ?paged=N)
//   2. SESC/AM   - https://www.sesc-am.com.br/licitacao/       (lista unica, sem paginacao)
//
// SESI/AM e SENAI/AM (portal FIEAM) nao entram aqui: o portal de transparencia deles
// so publica arquivos estaticos (PDF/ODS/XLS) desatualizados (ultimo ano disponivel: 2023),
// entao nao ha o que coletar de forma incremental por enquanto.
//
// Uso: node scripts/coletar_sistema_s_am.js
// Variaveis de ambiente opcionais:
//   MAX_PAGINAS_SENAC=6   -> limite de paginas do SENAC/AM a varrer por execucao (padrao 6 = ~60 processos)
//   LIMITE_MINUTOS=10     -> orcamento de tempo total do robo (padrao 10 min)

const MAX_PAGINAS_SENAC = parseInt(process.env.MAX_PAGINAS_SENAC || "6", 10);
const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "10");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;

const inicioExecucao = Date.now();
function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}

function limparEspacos(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function decodificarEntidades(txt) {
  return (txt || "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&atilde;/g, "ã")
    .replace(/&otilde;/g, "õ").replace(/&ccedil;/g, "ç").replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É").replace(/&Oacute;/g, "Ó").replace(/&Ccedil;/g, "Ç")
    .replace(/&ecirc;/g, "ê").replace(/&acirc;/g, "â").replace(/&ocirc;/g, "ô")
    .replace(/&#8211;/g, "–").replace(/&#8217;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function stripTags(html) {
  return decodificarEntidades(limparEspacos(html.replace(/<[^>]+>/g, " ")));
}

async function fetchHtml(url, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25000);
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; HCLicitacoesBot/1.0; +https://github.com/harresoncoelho-lang/hc-mercado-web)",
          Accept: "text/html",
        },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!resp.ok) {
        console.log(`[fetch] HTTP ${resp.status} em ${url}`);
        if (resp.status >= 500 && i < tentativas - 1) {
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
          continue;
        }
        return null;
      }
      return await resp.text();
    } catch (e) {
      const motivo = e && e.name === "AbortError" ? "timeout" : String((e && e.message) || e);
      console.log(`[fetch] Falha em ${url}: ${motivo}`);
      if (i === tentativas - 1) return null;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}
// ---------- SENAC/AM ----------
// Estrutura confirmada: <ul class="portfolioContainer processos--ul ..."><li class="... clearfix">
//   <div>Nº da Licitação{numero}</div>
//   <div>Modalidade{modalidade}</div>
//   <div>Abertura{data}</div>
//   <div class="object">Objeto{objeto}</div>
//   <div>Situação {situacao}</div>
//   <div>Ação <a href="{link}">Saiba mais</a></div>
// </li></ul>
// Paginacao via ?paged=N.
async function coletarSenacAM() {
  const registros = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS_SENAC; pagina++) {
    if (tempoRestanteMs() < 20000) {
      console.log(`[senac-am] Orcamento de tempo esgotado na pagina ${pagina}.`);
      break;
    }
    const url = pagina === 1 ? "https://am.senac.br/licitacoes/" : `https://am.senac.br/licitacoes/?paged=${pagina}`;
    const html = await fetchHtml(url);
    if (!html) {
      console.log(`[senac-am] Falha ao buscar pagina ${pagina}, parando.`);
      break;
    }

    // Isola cada <li> de processo dentro da ul de licitacoes (ignora o li de cabecalho,
    // que nao tem atributo id="post-...").
    const blocos = html.split(/<li\s+id="post-\d+"/i).slice(1);
    if (blocos.length === 0) {
      console.log(`[senac-am] Nenhum processo encontrado na pagina ${pagina}, parando paginacao.`);
      break;
    }

    let novosNestaPagina = 0;
    for (const blocoBruto of blocos) {
      // Cada bloco vai ate o proximo </li> (aproximado - suficiente pra essa pagina simples).
      const fimIdx = blocoBruto.indexOf("</li>");
      const bloco = fimIdx >= 0 ? blocoBruto.slice(0, fimIdx) : blocoBruto;
      if (!/Nº da Licitação|N&ordm; da Licita/i.test(bloco) && !/Nº da Licita/i.test(stripTags(bloco))) continue;

      const texto = stripTags(bloco);
      const mNumero = texto.match(/N[ºo°]\s*da\s*Licita[çc][aã]o\s*([^\s]+(?:\/\d{2,4})?)/i);
      const mModalidade = texto.match(/Modalidade\s*(.+?)\s*Abertura/i);
      const mAbertura = texto.match(/Abertura\s*(\d{2}\/\d{2}\/\d{4})/);
      const mObjeto = texto.match(/Objeto\s*(.+?)\s*Situa[çc][aã]o/i);
      const mSituacao = texto.match(/Situa[çc][aã]o\s*(.+?)\s*A[çc][aã]o/i);
      const mLink = bloco.match(/href="([^"]+)"[^>]*>\s*Saiba mais/i);

      if (!mNumero || !mObjeto) continue;

      registros.push({
        fonte: "SENAC/AM",
        entidade: "SENAC",
        uf: "AM",
        numero: limparEspacos(mNumero[1]),
        modalidade: mModalidade ? limparEspacos(mModalidade[1]) : "",
        dataAbertura: mAbertura ? mAbertura[1] : null,
        objeto: mObjeto ? limparEspacos(mObjeto[1]) : "",
        situacao: mSituacao ? limparEspacos(mSituacao[1]) : "",
        link: mLink ? decodificarEntidades(mLink[1]) : "https://am.senac.br/licitacoes/",
      });
      novosNestaPagina += 1;
    }

    console.log(`[senac-am] Pagina ${pagina}: ${novosNestaPagina} processo(s).`);
    if (novosNestaPagina === 0) break;
  }
  console.log(`[senac-am] Total coletado: ${registros.length} processo(s).`);
  return registros;
}

// ---------- SESC/AM ----------
// Estrutura confirmada: uma <table class="table"> por processo, com 2 linhas de dados:
//   linha 1: <td>Objeto</td> (cabecalho) seguida de <tr><td>{objeto}</td></tr>
//   linha 2: cabecalho "Nº Processo | Data Publicação | Data Abertura | Modalidade | Status | Ano"
//   linha 3: valores correspondentes
// Sem paginacao - a pagina traz todos os processos filtrados pelo estado padrao (Abertos).
async function coletarSescAM() {
  if (tempoRestanteMs() < 15000) {
    console.log("[sesc-am] Orcamento de tempo esgotado antes de comecar.");
    return [];
  }
  const html = await fetchHtml("https://www.sesc-am.com.br/licitacao/");
  if (!html) {
    console.log("[sesc-am] Falha ao buscar a pagina.");
    return [];
  }

  const registros = [];
  // Cada processo esta dentro de <table class="table">...</table>.
  const blocos = html.split(/<table[^>]*class="[^"]*\btable\b[^"]*"/i).slice(1);
  for (const blocoBruto of blocos) {
    const fimIdx = blocoBruto.indexOf("</table>");
    const bloco = fimIdx >= 0 ? blocoBruto.slice(0, fimIdx) : blocoBruto;
    const texto = stripTags(bloco);

    const mObjeto = texto.match(/Objeto\s*(.+?)\s*N[ºo°]\s*Processo/i);
    const mLinha = texto.match(
      /N[ºo°]\s*Processo\s*Data\s*Publica[çc][aã]o\s*Data\s*Abertura\s*Modalidade\s*Status\s*Ano\s*(\S+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s*(.*?)\s*(Aberto|Fechado|Cancelado)\s+(\d{4})/i
    );
    if (!mObjeto || !mLinha) continue;

    registros.push({
      fonte: "SESC/AM",
      entidade: "SESC",
      uf: "AM",
      numero: limparEspacos(mLinha[1]),
      dataPublicacao: mLinha[2],
      dataAbertura: mLinha[3],
      modalidade: limparEspacos(mLinha[4]),
      situacao: limparEspacos(mLinha[5]),
      ano: mLinha[6],
      objeto: limparEspacos(mObjeto[1]),
      link: "https://www.sesc-am.com.br/licitacao/",
    });
  }
  console.log(`[sesc-am] Total coletado: ${registros.length} processo(s).`);
  return registros;
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dirDados = path.join(process.cwd(), "data");
  await fs.mkdir(dirDados, { recursive: true });

  console.log(`Iniciando coleta Sistema S/AM. Orcamento: ${LIMITE_MINUTOS} min.`);

  const [senac, sesc] = await Promise.all([coletarSenacAM(), coletarSescAM()]);
  const registros = [...senac, ...sesc];

  const resultado = {
    atualizadoEm: new Date().toISOString(),
    fontes: ["SENAC/AM", "SESC/AM"],
    totalRegistros: registros.length,
    registros,
  };

  await fs.writeFile(path.join(dirDados, "sistema_s_am.json"), JSON.stringify(resultado), "utf8");
  console.log(`Gravado data/sistema_s_am.json com ${registros.length} registro(s).`);

  if (registros.length === 0) {
    console.log("AVISO: nenhum registro coletado - verifique se a estrutura das paginas mudou.");
  }
  console.log("Coleta finalizada.");
}

main().catch((e) => {
  console.error("Erro fatal no robo de coleta:", e);
  process.exit(1);
});
