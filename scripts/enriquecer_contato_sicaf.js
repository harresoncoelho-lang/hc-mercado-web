// Robô COMPLEMENTAR de contato pro cadastro SICAF puro (Fase 4c) — irmão de
// enriquecer_contato.js, mas pra data/fornecedores/{UF}.json em vez de data/empresas.json.
//
// enriquecer_sicaf.js (Fase 4b) já preenche o básico via minhareceita.org (Receita Federal),
// mas o e-mail lá é opcional e boa parte das empresas nunca preencheu. Esse robô roda depois,
// pega quem já tem cadastro básico do SICAF mas ainda está sem e-mail OU sem telefone, e
// tenta complementar via cnpja.com (open.cnpja.com/office/:cnpj — gratuito, sem chave, mas
// limitado a 5 consultas por minuto por IP).
//
// Como o limite é global (não por estado), processa os pendentes de todas as UFs numa fila
// só, priorizando quem está habilitado a licitar agora, respeitando o ritmo de 5/min.
//
// Uso: node scripts/enriquecer_contato_sicaf.js
// Variáveis de ambiente opcionais:
//   LIMITE_MINUTOS=8           -> orçamento de tempo desta execução
//   RENOVAR_APOS_DIAS=90       -> reverificar contato depois desse tempo
//   ATRASO_MS=13000            -> pausa entre requisições (respeita o limite de 5/min)

const LIMITE_MINUTOS = parseFloat(process.env.LIMITE_MINUTOS || "8");
const LIMITE_MS = LIMITE_MINUTOS * 60 * 1000;
const RENOVAR_APOS_DIAS = parseInt(process.env.RENOVAR_APOS_DIAS || "90", 10);
const ATRASO_MS = parseInt(process.env.ATRASO_MS || "13000", 10);
const BASE_URL = "https://open.cnpja.com/office";

const ESTADOS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO", "SEM_UF",
];

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
  if (!enr || !enr.enriquecidoEm) return false; // ainda não passou pelo enriquecimento básico (minhareceita)
  const jaTemEmail = !!enr.email;
  const jaTemTelefone = enr.telefones && enr.telefones.length > 0;
  if (jaTemEmail && jaTemTelefone) return false;
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
    return { ok: false, status: String((e && e.message) || e) };
  }
}

async function main() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dirFornecedores = path.join(process.cwd(), "data", "fornecedores");

  const agora = Date.now();
  const shards = new Map(); // uf -> dados carregados
  const fila = []; // { uf, reg }

  for (const uf of ESTADOS) {
    const caminho = path.join(dirFornecedores, `${uf}.json`);
    const dados = await lerJsonExistente(caminho);
    if (!dados || !Array.isArray(dados.registros) || dados.registros.length === 0) continue;
    shards.set(uf, dados);
    for (const reg of dados.registros) {
      if (precisaContato(reg, agora)) fila.push({ uf, reg });
    }
  }

  // Prioriza quem está habilitado a licitar agora — mais relevante pra prospecção.
  fila.sort((a, b) => (b.reg.habilitadoLicitar === true ? 1 : 0) - (a.reg.habilitadoLicitar === true ? 1 : 0));

  console.log(`[sicaf-contato] ${fila.length} empresa(s) do SICAF já com cadastro básico mas sem e-mail/telefone completo. Orçamento: ${LIMITE_MINUTOS} min (~${Math.floor(LIMITE_MS / ATRASO_MS)} consultas no máximo).`);

  const ufsAlterados = new Set();
  let emailPreenchido = 0, telefonePreenchido = 0, semDadoNovo = 0, processados = 0;

  for (const { uf, reg } of fila) {
    if (tempoRestanteMs() < ATRASO_MS) {
      console.log(`[sicaf-contato] Orçamento de tempo esgotado após ${processados} consulta(s) nesta execução.`);
      break;
    }
    const resultado = await buscarContato(reg.cnpj);
    processados += 1;

    if (resultado.limitado) {
      console.log(`[sicaf-contato] Limite de 5/min atingido — encerrando esta execução mais cedo (${processados} consultas feitas).`);
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
      reg.enriquecimento.contatoVerificadoEm = new Date().toISOString();
      reg.enriquecimento.contatoFonte = `cnpja_open_falhou(${resultado.status})`;
    }

    ufsAlterados.add(uf);
    await dormir(ATRASO_MS);
  }

  for (const uf of ufsAlterados) {
    const dados = shards.get(uf);
    dados.atualizadoEm = new Date().toISOString();
    const caminho = path.join(dirFornecedores, `${uf}.json`);
    await fs.writeFile(caminho, JSON.stringify(dados), "utf8");
  }

  console.log(
    `[sicaf-contato] Concluído: ${processados} consulta(s), ${emailPreenchido} e-mail(s) novo(s), ` +
    `${telefonePreenchido} telefone(s) novo(s), ${semDadoNovo} sem dado adicional, ${ufsAlterados.size} arquivo(s) de UF salvos.`
  );
}

main().catch((e) => {
  console.error("Erro fatal no robô de contato SICAF:", e);
  process.exit(1);
});
