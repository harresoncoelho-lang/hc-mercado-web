// Robô COMPLEMENTAR de contato (Fase 2b) — roda depois de enriquecer_empresas.js.
//
// Por que existe: a Receita Federal (fonte usada em enriquecer_empresas.js, via
// minhareceita.org) tem o campo de e-mail no cadastro, mas boa parte das empresas nunca
// preencheu — então o e-mail fica vazio com muita frequência. Testamos e confirmamos que a
// API pública e gratuita do cnpja.com (https://open.cnpja.com/office/:cnpj — sem chave, sem
// cadastro) às vezes tem e-mail/telefone pra CNPJs onde a Receita não tinha, provavelmente
// porque eles cruzam com outras fontes públicas além do cadastro básico da Receita.
//
// A API do cnpja.com é limitada a 5 consultas por minuto por IP — bem mais restrita que a
// fonte principal. Por isso este robô só roda numa segunda etapa, tratando isso como
// enriquecimento "de luxo": prioriza as empresas com mais contratos (as mais relevantes pra
// prospecção) e só tenta empresas que:
//   1) já passaram pelo enriquecimento cadastral principal (têm razão social etc.), e
//   2) ainda estão sem e-mail OU sem telefone, e
//   3) não foram verificadas contra o cnpja.com nos últimos RENOVAR_APOS_DIAS.
//
// Uso: node scripts/enriquecer_contato.js
// Variáveis de ambiente opcionais:
//   LIMITE_MINUTOS=6           -> orçamento de tempo desta execução
//   RENOVAR_APOS_DIAS=90       -> reverificar contato depois desse tempo
//   ATRASO_MS=13000            -> pausa entre requisições (respeita o limite de 5/min)

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "6");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const RENOVAR_APOS_DIAS = parseInt(process.env.RENOVAR_APOS_DIAS || "90", 10);
const ATRASO_MS = parseInt(process.env.ATRASO_MS || "13000", 10);
const BASE_URL = "https://open.cnpja.com/office";

const inicioExecucao = Date.now();
function tempoRestanteMs() {
  return LIMITE_MS - (Date.now() - inicioExecucao);
}
function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function lerJsonExistente(caminho) {
  try {
    const fs = await import("node:fs/promises");
    const texto = await fs.readFile(caminho, "utf8");
    return JSON.parse(texto);
  } catch (e) {
    return null;
  }
}

function precisaContato(reg, agora) {
  const enr = reg.enriquecimento;
  if (!enr || !enr.enriquecidoEm) return false; // ainda não passou pelo enriquecimento principal
  const jaTemEmail = !!enr.email;
  const jaTemTelefone = enr.telefones && enr.telefones.length > 0;
  if (jaTemEmail && jaTemTelefone) return false; // já está completo, não precisa
  if (!enr.contatoVerificadoEm) return true;
  const diasDesde = (agora - new Date(enr.contatoVerificadoEm).getTime()) / (1000 * 60 * 60 * 24);
  return diasDesde >= RENOVAR_APOS_DIAS;
}

function formatarTelefone(p) {
  if (!p || !p.number) return null;
  return p.area ? `(${p.area}) ${p.number}` : p.number;
}

async function buscarContato(cnpj) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(`${BASE_URL}/${cnpj}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    if (resp.status === 429) return { ok: false, limitado: true };
    if (!resp.ok) return { ok: false, status: resp.status };
    const dados = await resp.json();
    return { ok: true, dados };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, status: String(e && e.message || e) };
  }
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const caminho = path.join(process.cwd(), "data", "empresas.json");

  const base = await lerJsonExistente(caminho);
  if (!base || !Array.isArray(base.registros)) {
    console.log("[contato] data/empresas.json ainda não existe — nada a fazer.");
    return;
  }

  const agora = Date.now();
  const pendentes = base.registros.filter((r) => precisaContato(r, agora));
  pendentes.sort((a, b) => (b.quantidadeContratos || 0) - (a.quantidadeContratos || 0));

  console.log(`[contato] ${pendentes.length} empresa(s) já com cadastro mas sem e-mail/telefone completo. Orçamento: ${LIMITE_MINUTOS} min (~${Math.floor(LIMITE_MS / ATRASO_MS)} consultas no máximo).`);

  let emailPreenchido = 0, telefonePreenchido = 0, semDadoNovo = 0, processados = 0;

  for (const reg of pendentes) {
    if (tempoRestanteMs() < ATRASO_MS) {
      console.log(`[contato] Orçamento de tempo esgotado após ${processados} consulta(s) nesta execução.`);
      break;
    }
    const resultado = await buscarContato(reg.cnpj);
    processados += 1;

    if (resultado.limitado) {
      console.log(`[contato] Limite de 5/min atingido — encerrando esta execução mais cedo (${processados} consultas feitas).`);
      break;
    }

    if (resultado.ok) {
      const emails = resultado.dados.emails || [];
      const phones = resultado.dados.phones || [];
      const emailNovo = emails.length > 0 ? emails[0].address : null;
      const telefonesNovos = phones.map(formatarTelefone).filter(Boolean);

      let mudou = false;
      if (!reg.enriquecimento.email && emailNovo) {
        reg.enriquecimento.email = emailNovo;
        emailPreenchido += 1;
        mudou = true;
      }
      if ((!reg.enriquecimento.telefones || reg.enriquecimento.telefones.length === 0) && telefonesNovos.length > 0) {
        reg.enriquecimento.telefones = telefonesNovos;
        telefonePreenchido += 1;
        mudou = true;
      }
      if (!mudou) semDadoNovo += 1;
      reg.enriquecimento.contatoVerificadoEm = new Date().toISOString();
      reg.enriquecimento.contatoFonte = "cnpja_open";
    } else {
      // CNPJ não encontrado ou erro pontual — marca como verificado mesmo assim, pra não
      // ficar tentando de novo todo dia; RENOVAR_APOS_DIAS garante que tenta de novo depois.
      reg.enriquecimento.contatoVerificadoEm = new Date().toISOString();
      reg.enriquecimento.contatoFonte = `cnpja_open_falhou(${resultado.status})`;
    }

    await dormir(ATRASO_MS);
  }

  await fs.writeFile(caminho, JSON.stringify(base), "utf8");
  console.log(
    `[contato] Concluído: ${processados} consulta(s), ${emailPreenchido} e-mail(s) novo(s), ` +
    `${telefonePreenchido} telefone(s) novo(s), ${semDadoNovo} sem dado adicional.`
  );
}

main().catch((e) => {
  console.error("Erro fatal no robô de contato:", e);
  process.exit(1);
});
