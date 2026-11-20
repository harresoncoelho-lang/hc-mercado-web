// E2E da Análise por CNPJ, parte 2 (cadastro da Receita, alerta de vulnerabilidade, contratos por estado e valores
// faturados), com dado REAL e público: BMS (03.090.004/0001-04, contrato 00001/2026 da UFAM no Contratos.gov.br) e um
// segundo fornecedor do governo (CNPJ_2, padrão Positivo Tecnologia). Só o banco local é alterado.
//   PORTA_TESTE=8834 node ambiente-teste/servidor.cjs   (outro terminal; antes: npm run build:cloudflare)
//   SITE_TESTE=http://127.0.0.1:8834 PRINTS=<pasta> node ambiente-teste/e2e-analise-cnpj-v2.cjs
// O robô roda com MAX_CONTRATOS_GOV_ANALISE_CNPJ=6 e SEM ler o arquivo semanal de propostas (dezenas de MB por mês;
// coberto pelos E2E da parte 1): o mês fica pendente, com 1 tentativa contada.
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { banco, passo, exigir, novaPagina, seed, SITE, PRINTS, resultados } = require('./e2e.cjs');

const CNPJS = [['bms', '03090004000104'], ['segundo', process.env.CNPJ_2 || '81243735000148']];

function robo() {
  const RAIZ = path.resolve(__dirname, '..');
  const codigo = "require('./scripts/analise_cnpj').completarAnalises({ rest: require('./scripts/supabase_dados').restFetch, prazoFinal: Date.now() + 360000," +
    " lerMes: async () => { throw new Error('e2e: arquivo de propostas não lido neste teste'); } }).then((c) => console.log('CONTAGEM ' + JSON.stringify(c)))";
  const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'redirecionar-fetch.cjs'), '-e', codigo],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, AMBIENTE_TESTE_REDIRECIONAR: '1', MAX_CONTRATOS_GOV_ANALISE_CNPJ: '6', PAUSA_MS_ANALISE_CNPJ: '400' }, timeout: 480000 });
  return { status: r.status, saida: (r.stdout + r.stderr).slice(-3000) };
}

async function analisar(p, cnpj) {
  await p.goto(SITE + '/painel.html');
  await p.click('nav button[data-alvo="empresa"]');
  await p.fill('#emp-cnpj', cnpj);
  await p.click('#emp-buscar');
  await p.waitForSelector('#emp-analise-cnpj .acn-contratos', { timeout: 240000 });
}

async function imprimir(p, nome) {
  // Cabeçalho fixo do painel cobriria o topo do bloco no print por elemento.
  await p.addStyleTag({ content: 'header { position: static !important; }' });
  for (const largura of [1280, 375]) {
    await p.setViewportSize({ width: largura, height: 900 });
    await p.waitForTimeout(300);
    await p.locator('#emp-analise-cnpj').screenshot({ path: path.join(PRINTS, `${nome}-${largura}.png`) });
  }
  await p.setViewportSize({ width: 1366, height: 900 });
}

async function main() {
  fs.mkdirSync(PRINTS, { recursive: true });
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await novaPagina(navegador, seed.usuarios.gestor);
  try {
    for (const [nome, cnpj] of CNPJS) {
      await passo(`${nome}: 1ª análise grava cadastro (sem CPF) e a 1ª página de contratos`, null, async () => {
        await analisar(p, cnpj);
        const [cad] = await banco(`empresas_cadastro?cnpj=eq.${cnpj}&select=razao_social,situacao,socios,cnae_principal,capital_social,fonte`);
        exigir(cad && cad.razao_social, 'cadastro não gravado');
        exigir(!/\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\*{3}/.test(JSON.stringify(cad.socios)), 'sócio com documento');
        const contratos = await banco(`historico_contratos_fornecedor?fornecedor_ni=eq.${cnpj}&select=numero_controle_pncp`);
        exigir(contratos.length > 0, 'nenhum contrato gravado');
        return `${cad.razao_social} · ${cad.situacao} · ${cad.socios.length} sócio(s) · ${contratos.length} contrato(s) · fonte ${cad.fonte}`;
      });
    }
    await passo('robô: lê o resto dos contratos e os valores federais no Contratos.gov.br', null, async () => {
      const r = robo();
      exigir(r.status === 0 && /CONTAGEM/.test(r.saida), r.saida);
      return r.saida.split('\n').filter((l) => /CONTAGEM|Contratos\.gov|contratos /.test(l)).join(' | ').slice(0, 600);
    });
    for (const [nome, cnpj] of CNPJS) {
      await passo(`${nome}: UF de cada contrato conferida contra o detalhe do PNCP (unidade contratante)`, null, async () => {
        const amostra = await banco(`historico_contratos_fornecedor?fornecedor_ni=eq.${cnpj}&select=numero_controle_pncp,uf&order=data_assinatura.desc.nullslast&limit=5`);
        const conferidos = [];
        for (const c of amostra) {
          const [, org, seq, ano] = /^(\d{14})-2-0*(\d+)\/(\d{4})$/.exec(c.numero_controle_pncp);
          const d = await fetch(`https://pncp.gov.br/api/pncp/v1/orgaos/${org}/contratos/${ano}/${seq}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then((r) => r.json()).catch(() => null);
          if (!d) continue;
          const uf = d.unidadeSubRogada?.ufSigla || d.unidadeOrgao?.ufSigla;
          exigir(uf === c.uf, `${c.numero_controle_pncp}: busca ${c.uf} x detalhe ${uf}`);
          conferidos.push(`${c.numero_controle_pncp}=${uf}`);
        }
        exigir(conferidos.length, 'PNCP não respondeu a nenhum detalhe');
        return conferidos.join(', ');
      });
      await passo(`${nome}: tela mostra cadastro, alerta de vulnerabilidade e contratos por estado (prints 1280 e 375)`, null, async () => {
        await analisar(p, cnpj);
        const texto = await p.locator('#emp-analise-cnpj').innerText();
        for (const t of ['Alerta de vulnerabilidade', 'Contratos e valores faturados', 'Contratos por estado', 'Capital social', 'CNAE principal']) exigir(texto.includes(t), `faltou "${t}"`);
        await imprimir(p, `analise-cnpj-v2-${nome}`);
        const fed = await banco(`historico_contratos_fornecedor?fornecedor_ni=eq.${cnpj}&valor_empenhado=not.is.null&select=numero_controle_pncp,valor_global,valor_empenhado,valor_pago,valor_faturado`);
        return `${fed.length} contrato(s) federal(is) com empenho: ${fed.slice(0, 3).map((f) => `${f.numero_controle_pncp} global ${f.valor_global} emp ${f.valor_empenhado} pago ${f.valor_pago} fat ${f.valor_faturado}`).join('; ')}`;
      });
    }
  } finally {
    fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify({ quando: new Date().toISOString(), resultados, errosPagina: p.erros }, null, 2));
    await navegador.close();
  }
}
if (require.main === module) main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
