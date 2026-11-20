/* global document -- usado só dentro de p.waitForFunction (roda no navegador) */
// E2E das etapas 7 (resultado) e 8 (contrato e empenho) da esteira, com dado REAL e público:
// compra 04378626000197-1-000122/2025 (UFAM, pregão 90022/2025, restaurante universitário), vencedora BMS (CNPJ 03.090.004/0001-04),
// contrato 00001/2026 no PNCP e no Contratos.gov.br (id 797807). Só o banco local é alterado; tudo é desfeito no fim.
//   PORTA_TESTE=8807 node ambiente-teste/servidor.cjs   (outro terminal)
//   SITE_TESTE=http://127.0.0.1:8807 PRINTS=<pasta> node ambiente-teste/e2e-contrato-empenho.cjs
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/Users/harre/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { banco, passo, exigir, novaPagina, seed, chaves, SITE, PRINTS, resultados } = require('./e2e.cjs');
const fs = require('node:fs');

const COMPRA = '04378626000197-1-000122/2025';
const CNPJ_BMS = '03090004000104';
async function servico(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(chaves.API_URL + caminho, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { apikey: chaves.SERVICE_ROLE_KEY, Authorization: 'Bearer ' + chaves.SERVICE_ROLE_KEY, 'content-type': 'application/json', Prefer: 'return=representation', ...extra } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho}: ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const tarefas = (id) => banco(`operacao_esteira_tarefas?processo_id=eq.${id}&select=etapa,estado,detalhe,erro,proximo_em&order=etapa`);

// Só as tarefas do processo (sem consultas avulsas e análise por CNPJ, que são de outros E2E e usam rede por minutos).
function robo(_script, env = {}) {
  const RAIZ = path.resolve(__dirname, '..');
  const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'redirecionar-fetch.cjs'), '-e', "require('./scripts/esteira_processos').rodar({ completarConsultas: false, lote: 20 })"],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, AMBIENTE_TESTE_REDIRECIONAR: '1', ...env }, timeout: 420000 });
  return { status: r.status, saida: (r.stdout + r.stderr).slice(-3000) };
}

async function main() {
  const navegador = await chromium.launch({ channel: 'msedge', headless: true });
  const { usuarios: U, ids } = seed;
  const ctx = {};
  const cnpjAntes = (await banco(`operacao_empresas?id=eq.${ids.empA1}&select=cnpj`))[0].cnpj;
  const p = await novaPagina(navegador, U.gestor);
  try {
    await passo('prepara: empresa com o CNPJ da vencedora real e processo com o ID PNCP da compra', null, async () => {
      await servico('PATCH', `/rest/v1/operacao_empresas?id=eq.${ids.empA1}`, { cnpj: CNPJ_BMS });
      const [proc] = await servico('POST', '/rest/v1/operacao_processos', { organizacao_id: ids.orgA, empresa_id: ids.empA1, objeto: 'Restaurante universitário UFAM (E2E contrato)', numero: '90022/2025',
        orgao: 'Fundação Universidade do Amazonas', origem_externa_id: COMPRA, url_origem: 'https://pncp.gov.br/app/editais/04378626000197/2025/122', status: 'triagem', data_sessao: '2025-12-09T10:00:00-03:00', criado_por: U.gestor.id });
      ctx.proc = proc;
      // Só as etapas deste E2E rodam; as demais (dossiê, histórico, exigências) têm seus próprios E2E.
      await servico('PATCH', `/rest/v1/operacao_esteira_tarefas?processo_id=eq.${proc.id}&etapa=in.(exigencias,cruzamento,historico)`, { estado: 'feito' });
      const t = await tarefas(proc.id);
      exigir(t.length === 6 && t.some((x) => x.etapa === 'resultado') && t.some((x) => x.etapa === 'contrato'), 'gatilho não criou as 6 tarefas: ' + t.map((x) => x.etapa));
      return 'tarefas: ' + t.map((x) => `${x.etapa}/${x.estado}`).join(', ');
    });

    await passo('robô: importa os itens reais e confere o resultado no PNCP (só sugere, não grava)', null, async () => {
      const r = robo('esteira_processos.js', { LIMITE_MINUTOS_ESTEIRA: '8', PAUSA_ITEM_MS_ESTEIRA: '200', LOTE_ESTEIRA: '10' });
      exigir(r.status === 0, 'robô saiu com ' + r.status + ' ' + r.saida.slice(-500));
      const t = Object.fromEntries((await tarefas(ctx.proc.id)).map((x) => [x.etapa, x]));
      exigir(t.itens.estado === 'feito', 'itens: ' + t.itens.estado + ' ' + t.itens.erro);
      exigir(t.resultado.detalhe.situacao === 'sugestao', 'resultado: ' + JSON.stringify(t.resultado.detalhe).slice(0, 300) + t.resultado.erro);
      const itens = await banco(`operacao_itens_resultado?processo_id=eq.${ctx.proc.id}&select=situacao`);
      exigir(itens.every((i) => i.situacao === 'pendente'), 'o robô gravou resultado sozinho');
      ctx.sugestao = t.resultado.detalhe.sugestao.itens;
      exigir(t.contrato.detalhe.situacao === 'aguardando_vitoria', 'contrato antes da vitória: ' + t.contrato.detalhe.situacao);
      const cont = ctx.sugestao.reduce((m, i) => ({ ...m, [i.situacao]: (m[i.situacao] || 0) + 1 }), {});
      return `${itens.length} itens importados; sugestão ${JSON.stringify(cont)}; contrato aguardando vitória`;
    });

    const abrir = async (largura, sufixo, nome) => {
      await p.setViewportSize({ width: largura, height: largura > 500 ? 900 : 812 });
      await p.goto(`${SITE}/processos.html?empresa=${ids.empA1}&processo=${ctx.proc.id}`);
      await p.waitForSelector('#d-acompanhamento .bloco-dossie', { timeout: 30000 });
      return nome;
    };

    await passo('tela: aparece "Você ganhou os itens… / perdeu…" e o usuário confirma com 1 clique', p, async () => {
      await abrir(1280);
      await p.waitForSelector('[data-sugestao-resultado]', { timeout: 15000 });
      const texto = await p.textContent('[data-sugestao-resultado]');
      exigir(/Você ganhou o/.test(texto) && /Nada foi gravado/.test(texto), 'texto da sugestão: ' + texto.slice(0, 300));
      ctx.textoSugestao = texto.replace(/\s+/g, ' ').trim().slice(0, 400);
      await p.screenshot({ path: path.join(PRINTS, '1280-1-sugestao-resultado.png'), fullPage: false });
      await p.setViewportSize({ width: 375, height: 812 });
      await p.locator('[data-sugestao-resultado]').scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(PRINTS, '375-1-sugestao-resultado.png') });
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.click('[data-confirmar-sugestao]');
      await p.waitForFunction(() => !document.querySelector('[data-sugestao-resultado]'), null, { timeout: 15000 });
      const itens = await banco(`operacao_itens_resultado?processo_id=eq.${ctx.proc.id}&select=identificador,situacao,valor_homologado,motivo`);
      const ganhos = itens.filter((i) => i.situacao === 'ganho');
      exigir(ganhos.length === ctx.sugestao.filter((s) => s.situacao === 'ganho').length && ganhos.length > 0, 'itens ganhos gravados: ' + ganhos.length);
      exigir(itens.every((i) => i.situacao !== 'pendente'), 'ainda há item pendente');
      return `${ganhos.length} ganhos, ${itens.length - ganhos.length} outros; "${ctx.textoSugestao.slice(0, 160)}"`;
    });

    await passo('robô: com a vitória confirmada, traz contrato, aditivos, empenhos, liquidado e pago (PNCP + Contratos.gov.br)', null, async () => {
      await servico('PATCH', `/rest/v1/operacao_esteira_tarefas?processo_id=eq.${ctx.proc.id}&etapa=eq.contrato`, { proximo_em: new Date(Date.now() - 1000).toISOString() });
      const r = robo('esteira_processos.js', { LIMITE_MINUTOS_ESTEIRA: '8', LOTE_ESTEIRA: '10' });
      exigir(r.status === 0, 'robô saiu com ' + r.status + ' ' + r.saida.slice(-500));
      const t = Object.fromEntries((await tarefas(ctx.proc.id)).map((x) => [x.etapa, x]));
      exigir(t.contrato.detalhe.situacao === 'encontrado', 'contrato: ' + JSON.stringify(t.contrato.detalhe) + (t.contrato.erro || ''));
      const linhas = await banco(`operacao_contratos_publicos?processo_id=eq.${ctx.proc.id}&select=*`);
      exigir(linhas.length === 1, 'contratos gravados: ' + linhas.length);
      ctx.contrato = linhas[0];
      const c = ctx.contrato;
      exigir(c.fornecedor_cnpj === CNPJ_BMS && c.numero === '00001/2026' && c.contratos_gov_id === 797807, 'contrato errado: ' + [c.numero, c.contratos_gov_id]);
      return `contrato ${c.numero} (Contratos.gov id ${c.contratos_gov_id}); vigência ${c.vigencia_inicio} a ${c.vigencia_fim}; global ${c.valor_global}; empenhado ${c.valor_empenhado}; liquidado ${c.valor_liquidado}; pago ${c.valor_pago}; a pagar ${c.a_pagar} desde ${c.liquidado_sem_pagamento_desde}; ${c.empenhos.length} empenhos, ${c.faturas.length} faturas, ${c.aditivos.length} aditivos`;
    });

    await passo('robô: segunda rodada é idempotente (mesma linha, sem duplicar)', null, async () => {
      await servico('PATCH', `/rest/v1/operacao_esteira_tarefas?processo_id=eq.${ctx.proc.id}&etapa=eq.contrato`, { proximo_em: new Date(Date.now() - 1000).toISOString() });
      const r = robo('esteira_processos.js', { LIMITE_MINUTOS_ESTEIRA: '8', LOTE_ESTEIRA: '10' });
      exigir(r.status === 0, 'robô saiu com ' + r.status);
      const linhas = await banco(`operacao_contratos_publicos?processo_id=eq.${ctx.proc.id}&select=chave,contratos_gov_id`);
      exigir(linhas.length === 1 && linhas[0].contratos_gov_id === 797807, 'duplicou ou perdeu o id: ' + JSON.stringify(linhas));
      return 'ok';
    });

    await passo('tela: quadro "Contrato" com vigência, saldo, empenhado/pago e alerta de vencimento', p, async () => {
      await abrir(1280);
      const quadro = p.locator(`[data-quadro-contrato="${ctx.proc.id}"]`);
      await quadro.waitFor({ timeout: 15000 });
      const texto = (await quadro.textContent()).replace(/\s+/g, ' ');
      exigir(/00001\/2026/.test(texto) && /Empenhado/.test(texto) && /Saldo sem empenho/.test(texto) && /Liquidado \/ pago/.test(texto), 'quadro: ' + texto.slice(0, 400));
      exigir(/data-alerta="vencimento"/.test(await quadro.innerHTML()), 'sem alerta de vencimento (vigência ' + ctx.contrato.vigencia_fim + ')');
      ctx.textoQuadro = texto.slice(0, 700);
      await quadro.scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(PRINTS, '1280-2-quadro-contrato.png') });
      await p.setViewportSize({ width: 375, height: 812 });
      await quadro.scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(PRINTS, '375-2-quadro-contrato.png') });
      return texto.slice(0, 500);
    });

    await passo('Hoje: aviso de contrato a vencer; e, com pagamento atrasado, aviso de pagamento', p, async () => {
      await p.setViewportSize({ width: 1280, height: 1000 });
      await p.goto(`${SITE}/sistema.html`);
      await p.waitForSelector('#hoje-contratos-titulo', { timeout: 20000 });
      let texto = (await p.textContent('#hoje-alertas')).replace(/\s+/g, ' ');
      exigir(/Contratos e pagamentos/.test(texto) && /Contrato vence em/.test(texto), 'Hoje: ' + texto.slice(0, 300));
      const notas = ['vencimento: ok'];
      // Pagamento atrasado: só o que a fonte real publicar. Se o contrato real não tem, o teste cobre com uma LINHA DE TESTE no banco local
      // (data de liquidação antiga), marcada na saída; a linha real é restaurada em seguida.
      const real = ctx.contrato.liquidado_sem_pagamento_desde && ctx.contrato.a_pagar > 0;
      if (!real) {
        await servico('PATCH', `/rest/v1/operacao_contratos_publicos?processo_id=eq.${ctx.proc.id}&chave=eq.${encodeURIComponent(ctx.contrato.chave)}`, { a_pagar: 12345.67, liquidado_sem_pagamento_desde: '2026-09-01' });
        await p.reload();
        await p.waitForSelector('#hoje-contratos-titulo', { timeout: 20000 });
        notas.push('pagamento: SIMULADO no banco local (a fonte real não tem liquidação sem pagamento)');
      } else notas.push('pagamento: dado real');
      texto = (await p.textContent('#hoje-alertas')).replace(/\s+/g, ' ');
      exigir(/Pagamento atrasado/.test(texto) && /Liquidado e sem pagamento há \d+ dias/.test(texto), 'Hoje sem pagamento atrasado: ' + texto.slice(0, 400));
      await p.locator('#hoje-contratos-titulo').scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(PRINTS, '1280-3-hoje-contratos.png') });
      await p.setViewportSize({ width: 375, height: 812 });
      await p.reload();
      await p.waitForSelector('#hoje-contratos-titulo', { timeout: 20000 });
      await p.locator('#hoje-contratos-titulo').scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(PRINTS, '375-3-hoje-contratos.png') });
      if (!real) await servico('PATCH', `/rest/v1/operacao_contratos_publicos?processo_id=eq.${ctx.proc.id}&chave=eq.${encodeURIComponent(ctx.contrato.chave)}`, { a_pagar: ctx.contrato.a_pagar, liquidado_sem_pagamento_desde: ctx.contrato.liquidado_sem_pagamento_desde });
      return notas.join('; ');
    });

    await passo('isolamento: operador da empresa A1 lê; usuário da outra organização não vê o contrato', null, async () => {
      const { comoUsuario } = require('./e2e.cjs');
      const q = `/rest/v1/operacao_contratos_publicos?processo_id=eq.${ctx.proc.id}&select=chave`;
      const outra = await comoUsuario(U.outra_org, q);
      exigir(outra.status === 200 && JSON.parse(outra.corpo).length === 0, 'outra org viu: ' + outra.corpo);
      const op = await comoUsuario(U.operador, q);
      exigir(JSON.parse(op.corpo).length === 1, 'operador não viu: ' + op.corpo);
      const gravar = await comoUsuario(U.gestor, '/rest/v1/operacao_contratos_publicos', { method: 'POST', body: JSON.stringify({ organizacao_id: ids.orgA, empresa_id: ids.empA1, processo_id: ctx.proc.id, chave: 'tentativa-gravar' }) });
      exigir(gravar.status >= 400, 'usuário conseguiu gravar: ' + gravar.status);
      return 'outra org 0 linhas; operador 1; gravar pelo usuário -> ' + gravar.status;
    });
  } finally {
    if (ctx.proc) {
      // As origens do PNCP referenciam os itens sem cascata: saem antes do processo.
      const origens = await banco(`operacao_origens_pncp?processo_id=eq.${ctx.proc.id}&select=item_id`).catch(() => []);
      for (const o of origens) await servico('DELETE', `/rest/v1/operacao_observacoes_pncp?item_id=eq.${o.item_id}`).catch(() => {});
      await servico('DELETE', `/rest/v1/operacao_origens_pncp?processo_id=eq.${ctx.proc.id}`).catch(() => {});
      await servico('DELETE', `/rest/v1/operacao_processos?id=eq.${ctx.proc.id}`).catch((e) => console.log('limpeza processo:', e.message));
    }
    await servico('PATCH', `/rest/v1/operacao_empresas?id=eq.${ids.empA1}`, { cnpj: cnpjAntes }).catch((e) => console.log('limpeza empresa:', e.message));
    await navegador.close();
  }
  fs.writeFileSync(path.join(PRINTS, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const falhas = resultados.filter((r) => !r.ok);
  console.log(falhas.length ? `FALHOU: ${falhas.length}` : 'E2E CONTRATO/EMPENHO OK');
  process.exit(falhas.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FALHOU:', e); process.exit(1); });
