// Netlify Function: baixa (proxy) um documento anexado a uma contratação no PNCP e devolve
// com Content-Disposition: attachment, pra forçar o download de verdade no navegador do
// cliente (em vez de abrir a página do PNCP e o cliente ter que procurar o botão de baixar
// lá dentro). Usado pelo botão "📥 Baixar Edital" nos cards do Boletim.
//
// Uso: GET /.netlify/functions/pncp-baixar?cnpj=...&ano=...&sequencial=...&documento=...&nome=...
const BASE_URL = "https://pncp.gov.br/pncp-api/v1/orgaos";

// Ver nota em pncp-proxy.js: alguns endpoints do PNCP resetam a conexão sem User-Agent de
// navegador. Manda em todo fetch pro PNCP por segurança.
const USER_AGENT_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const cnpj = (q.cnpj || "").replace(/\D/g, "");
  const ano = parseInt(q.ano, 10);
  const sequencial = parseInt(q.sequencial, 10);
  const documento = parseInt(q.documento, 10);
  const nomeArquivo = (q.nome || "edital.pdf").replace(/[^\w.\- ]/g, "_");

  if (cnpj.length !== 14 || !ano || !sequencial || !documento) {
    return { statusCode: 400, headers: { "Content-Type": "text/plain" }, body: "Parâmetros inválidos." };
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const resp = await fetch(`${BASE_URL}/${cnpj}/compras/${ano}/${sequencial}/arquivos/${documento}`, {
      headers: { "User-Agent": USER_AGENT_NAVEGADOR },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      return { statusCode: 502, headers: { "Content-Type": "text/plain" }, body: "Não foi possível baixar o arquivo no PNCP." };
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const tipo = resp.headers.get("content-type") || "application/octet-stream";

    // O PNCP costuma nomear o arquivo só "Edital" (sem extensão nenhuma), então o Windows
    // não sabe abrir/reconhecer o tipo do arquivo baixado. Em vez de confiar no nome que veio
    // do PNCP, detecta o formato de verdade pela assinatura binária e garante que o arquivo
    // baixado sempre tenha a extensão certa (.pdf, .zip, .docx etc.), igual o pncp-arquivos.js
    // já faz pro resumo por IA.
    function detectarExtensao(buf) {
      if (buf.slice(0, 5).toString("latin1") === "%PDF-") return ".pdf";
      const b = buf.slice(0, 4);
      const ehZip = b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
      if (ehZip) {
        try {
          const AdmZip = require("adm-zip");
          const zip = new AdmZip(buf);
          const nomes = zip.getEntries().map((e) => e.entryName);
          if (nomes.includes("word/document.xml")) return ".docx";
          if (nomes.includes("xl/workbook.xml")) return ".xlsx";
          if (nomes.includes("ppt/presentation.xml")) return ".pptx";
        } catch (e) {
          // não deu pra abrir como zip — segue como .zip mesmo
        }
        return ".zip";
      }
      if (buf.slice(0, 4).toString("latin1") === "Rar!") return ".rar";
      if (buf.slice(0, 2).toString("latin1") === "PK") return ".zip";
      return ""; // desconhecido — mantém sem extensão em vez de arriscar errado
    }

    const extensaoCorreta = detectarExtensao(buffer);
    let nomeFinal = nomeArquivo;
    if (extensaoCorreta) {
      const jaTemExtensao = new RegExp(`\\${extensaoCorreta}$`, "i").test(nomeFinal);
      if (!jaTemExtensao) {
        // remove qualquer extensão errada que já esteja no nome antes de acrescentar a certa
        nomeFinal = nomeFinal.replace(/\.[a-zA-Z0-9]{1,5}$/, "") + extensaoCorreta;
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": tipo,
        "Content-Disposition": `attachment; filename="${nomeFinal}"`,
        "Access-Control-Allow-Origin": "*",
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, headers: { "Content-Type": "text/plain" }, body: "Erro ao baixar: " + String((e && e.message) || e) };
  }
};
