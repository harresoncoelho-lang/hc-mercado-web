// O Blob mantém a leitura extremamente rápida; o Supabase é a fonte durável e
// consultável do dossiê (status, versão e conteúdo), inclusive para auditoria.
// Compartilhado entre a rota do resumo e o processamento de segundo plano do Gateway:
// qualquer caminho que conclua um dossiê precisa gravá-lo aqui.
const SUPABASE_URL = "https://lsqjamqvmrcyrvowndiu.supabase.co";

// Dossiê não expira por idade: o edital publicado não muda. Só a versão do formato
// (conferida por quem lê) ou o status invalidam um dossiê.
async function buscarDossiePersistido(numeroControlePNCP) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave || !numeroControlePNCP) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/dossies_editais?numero_controle_pncp=eq.${encodeURIComponent(numeroControlePNCP)}&select=dossie,versao`;
    const resposta = await fetch(url, { headers: { apikey: chave, Authorization: `Bearer ${chave}` } });
    if (!resposta.ok) return null;
    const linha = (await resposta.json())[0];
    if (!linha || !linha.dossie) return null;
    return { ...linha.dossie, versao: linha.versao || linha.dossie.versao };
  } catch (e) {
    return null;
  }
}

async function salvarDossiePersistido(numeroControlePNCP, dossie) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave || !numeroControlePNCP || !dossie) return;
  try {
    const resposta = await fetch(`${SUPABASE_URL}/rest/v1/dossies_editais?on_conflict=numero_controle_pncp`, {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{
        numero_controle_pncp: numeroControlePNCP,
        versao: dossie.versao,
        status: dossie.modoDegradado || dossie.metadadosIndisponiveis || dossie.estrutura?.coberturaLeitura?.parcial ? "parcial" : "pronto",
        fonte_lida: Boolean(dossie.fonteLida),
        dossie,
        atualizado_em: new Date().toISOString(),
        gerado_em: dossie.geradoEm || new Date().toISOString(),
      }]),
    });
    // fetch não lança em 4xx/5xx: sem esta checagem uma gravação recusada passava em silêncio.
    if (!resposta.ok) console.error(`dossies_editais: gravação recusada HTTP ${resposta.status} ${numeroControlePNCP}: ${(await resposta.text().catch(() => "")).slice(0, 300)}`);
  } catch (e) {
    // O resumo atual continua válido mesmo se a camada de auditoria estiver indisponível.
    console.error(`dossies_editais: gravação falhou ${numeroControlePNCP}: ${e.message}`);
  }
}

// Pedido de dossiê feito por um clique sem resumo pronto. Só zera a conclusão: as
// tentativas anteriores continuam valendo, para um edital que sempre falha não voltar
// a ser processado a cada clique. Quem gera é scripts/gerar_dossies_gemini.js.
async function enfileirarDossie(numeroControlePNCP) {
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!chave || !numeroControlePNCP) return;
  try {
    const resposta = await fetch(`${SUPABASE_URL}/rest/v1/fila_dossies?on_conflict=numero_controle_pncp`, {
      method: "POST",
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{ numero_controle_pncp: numeroControlePNCP, concluido_em: null }]),
    });
    if (!resposta.ok) console.error(`fila_dossies: pedido recusado HTTP ${resposta.status} ${numeroControlePNCP}`);
  } catch (e) {
    // A ficha oficial continua sendo exibida; o boletim ainda alimenta a fila.
    console.error(`fila_dossies: pedido falhou ${numeroControlePNCP}: ${e.message}`);
  }
}

module.exports = { buscarDossiePersistido, salvarDossiePersistido, enfileirarDossie };
